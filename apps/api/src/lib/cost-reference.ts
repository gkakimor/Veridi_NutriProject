import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { CostSource } from "@veridi/shared";
import { diaCivilDeslocado, diaDoInstantePorExtenso, limitesDoDiaComercial } from "@veridi/shared";
import {
  diaDaColunaDeData,
  marcadorDeHojeComercial,
  marcadorDoDiaComercialDe,
} from "./business-day.js";
// Precisão canônica do motor decimal — `PRODUCT_RULES.md` §59.
import "./decimal.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * A JANELA DE INSTANTES elegível para uma pergunta de custo.
 *
 * Duas grandezas diferentes se encontram aqui, e confundi-las era o defeito:
 *
 * - `referenceDate` é DATA CIVIL — o marcador de meia-noite UTC do dia que a
 *   pessoa escolheu na tela. Lido em UTC, porque é assim que ele foi gravado.
 * - `Receipt.receivedAt` é INSTANTE — o momento real em que a carga entrou.
 *
 * A ponte entre as duas é o dia comercial de São Paulo, e é o `Intl` que
 * decide seu deslocamento em cada data — nunca `-03:00` escrito à mão. O dia
 * 09/09 começa em `2026-09-09T03:00:00.000Z` e termina em
 * `2026-09-10T02:59:59.999Z`.
 *
 * Enquanto o limite de cima era o fim do dia UTC, todo recebimento lançado
 * entre 21:00 e 23:59 de São Paulo caía FORA do próprio dia: quem lançava a
 * compra às 22h e perguntava o custo daquela data recebia uma fonte antiga —
 * ou `NO_COST` —, com o custo real já gravado no banco. A borda de baixo
 * errava pelo mesmo motivo e no sentido oposto: começava três horas cedo
 * demais e deixava entrar a noite do dia anterior à janela.
 *
 * As duas bordas são dias comerciais inteiros, e a contagem de dias não muda:
 * `diasParaTras` recua no CALENDÁRIO, nunca no relógio — subtrair `30 x 24h`
 * de um instante atravessa a meia-noite comercial na hora errada.
 *
 * Exportada porque é a definição da elegibilidade temporal, e é ela que os
 * testes de borda interrogam: uma segunda cópia divergiria em silêncio.
 */
export function limitesDaJanelaDeCusto(
  referenceDate: Date,
  diasParaTras: number,
): { inicio: Date; fim: Date } {
  const dia = diaDaColunaDeData(referenceDate);
  return {
    inicio: limitesDoDiaComercial(diaCivilDeslocado(dia, -diasParaTras)).inicio,
    fim: limitesDoDiaComercial(dia).fim,
  };
}

export interface CostReference {
  /** `null` quando `source = "NO_COST"` — desconhecido NUNCA e zero. */
  unitCost: Prisma.Decimal | null;
  source: CostSource;
  referenceDate: Date;
  details: string | null;
}

/**
 * Media PONDERADA POR QUANTIDADE dos custos reais de uma janela:
 *
 *   sum(receivedQuantity x actualUnitCost) / sum(receivedQuantity)
 *
 * Nunca media simples — 10kg@10 + 90kg@20 e 19, nao 15. So entram
 * ReceiptLines com `actualUnitCost` REALMENTE informado; preco de OC,
 * estimativas anteriores, Billing e custo de produto acabado nunca
 * participam.
 */
async function weightedAverageInWindow(
  prisma: PrismaOrTx,
  itemId: string,
  from: Date,
  to: Date,
): Promise<{ unitCost: Prisma.Decimal; receiptLineCount: number } | null> {
  const lines = await prisma.receiptLine.findMany({
    where: {
      itemId,
      actualUnitCost: { not: null },
      receipt: { receivedAt: { gte: from, lte: to } },
    },
    select: { receivedQuantity: true, actualUnitCost: true },
  });
  if (lines.length === 0) return null;

  let totalValue = new Prisma.Decimal(0);
  let totalQuantity = new Prisma.Decimal(0);
  for (const line of lines) {
    totalValue = totalValue.plus(line.receivedQuantity.times(line.actualUnitCost!));
    totalQuantity = totalQuantity.plus(line.receivedQuantity);
  }
  // Recebimentos de quantidade zero nao deveriam existir, mas nunca
  // dividir por zero por causa de dado inesperado.
  if (totalQuantity.lessThanOrEqualTo(0)) return null;

  return { unitCost: totalValue.dividedBy(totalQuantity), receiptLineCount: lines.length };
}

/**
 * Referencia unitaria de custo de um Item numa data.
 *
 * Hierarquia de fallback, sem nenhum atalho silencioso:
 *   ESTIMATED_30D -> ESTIMATED_90D -> LAST_REAL_COST -> NO_COST
 *
 * `REAL` nunca vem daqui: e atribuido por quem conhece a aquisicao exata
 * (ex.: o lote realmente consumido). **O preco da OC jamais e usado como
 * ultimo recurso** — se nao ha custo real historico, o resultado e
 * `NO_COST` com `unitCost = null`.
 *
 * `referenceDate` e sempre respeitada: recebimentos posteriores ao DIA dela
 * nunca entram no calculo, para que uma consulta historica (ex.: custo de
 * um consumo antigo) nao use compras que aconteceram depois.
 */
export async function getItemCostReference(
  prisma: PrismaOrTx,
  itemId: string,
  referenceDate: Date = marcadorDeHojeComercial(),
): Promise<CostReference> {
  const janela30 = limitesDaJanelaDeCusto(referenceDate, 30);
  const window30 = await weightedAverageInWindow(prisma, itemId, janela30.inicio, janela30.fim);
  if (window30) {
    return {
      unitCost: window30.unitCost,
      source: "ESTIMATED_30D",
      referenceDate,
      details: `Média ponderada de ${window30.receiptLineCount} recebimento(s) nos últimos 30 dias.`,
    };
  }

  const janela90 = limitesDaJanelaDeCusto(referenceDate, 90);
  const window90 = await weightedAverageInWindow(prisma, itemId, janela90.inicio, janela90.fim);
  if (window90) {
    return {
      unitCost: window90.unitCost,
      source: "ESTIMATED_90D",
      referenceDate,
      details: `Média ponderada de ${window90.receiptLineCount} recebimento(s) nos últimos 90 dias.`,
    };
  }

  // Ultimo custo real conhecido — sem limite de idade, mas nunca de um dia
  // comercial posterior ao da pergunta. O fim do dia e o MESMO das janelas.
  const lastReal = await prisma.receiptLine.findFirst({
    where: {
      itemId,
      actualUnitCost: { not: null },
      receipt: { receivedAt: { lte: janela30.fim } },
    },
    orderBy: { receipt: { receivedAt: "desc" } },
    select: { actualUnitCost: true, receipt: { select: { receivedAt: true, code: true } } },
  });
  if (lastReal?.actualUnitCost) {
    return {
      unitCost: lastReal.actualUnitCost,
      source: "LAST_REAL_COST",
      referenceDate,
      // `receivedAt` é INSTANTE: o dia que se lê nele é o dia comercial. Em
      // UTC, uma compra das 22:30 aparecia com a data do dia seguinte.
      details: `Último custo real conhecido (${lastReal.receipt.code}, ${diaDoInstantePorExtenso(lastReal.receipt.receivedAt)}).`,
    };
  }

  return { unitCost: null, source: "NO_COST", referenceDate, details: null };
}

/**
 * Versao em lote para varios Items na MESMA data de referencia — evita
 * N+1 obvio em Formulacao com muitos componentes. Sem cache/Redis: e so
 * a mesma funcao resolvida em paralelo.
 */
export async function getItemCostReferences(
  prisma: PrismaOrTx,
  itemIds: string[],
  referenceDate: Date = marcadorDeHojeComercial(),
): Promise<Map<string, CostReference>> {
  const unique = [...new Set(itemIds)];
  const entries = await Promise.all(
    unique.map(async (itemId) => [itemId, await getItemCostReference(prisma, itemId, referenceDate)] as const),
  );
  return new Map(entries);
}

/**
 * Custo do material REALMENTE consumido. Prioridade absoluta: o custo
 * efetivo do lote efetivamente consumido (`REAL`). So quando esse lote
 * nao tem custo informado — ou quando o consumo nao tem lote — cai no
 * fallback historico do Item, sempre com a data do proprio consumo (nunca
 * "hoje"), para nao usar compras posteriores ao consumo.
 *
 * Consumo sem lote nunca e classificado como `REAL`: nao ha
 * rastreabilidade ate uma aquisicao especifica.
 */
export async function getConsumedLotCostReference(
  prisma: PrismaOrTx,
  params: { itemId: string; lotId: string | null; consumedAt: Date },
): Promise<CostReference> {
  if (params.lotId) {
    const receiptLine = await prisma.receiptLine.findFirst({
      where: { lotId: params.lotId, actualUnitCost: { not: null } },
      select: { actualUnitCost: true, lot: { select: { code: true } } },
    });
    if (receiptLine?.actualUnitCost) {
      return {
        unitCost: receiptLine.actualUnitCost,
        source: "REAL",
        referenceDate: params.consumedAt,
        details: `Custo efetivo do lote ${receiptLine.lot?.code ?? ""} realmente consumido.`.trim(),
      };
    }
  }

  // `consumedAt` é INSTANTE; a fundação pergunta por DATA CIVIL. O consumo
  // das 22:30 de São Paulo pertence ao dia comercial em que a pessoa estava
  // trabalhando, não ao dia UTC que já virou.
  return getItemCostReference(prisma, params.itemId, marcadorDoDiaComercialDe(params.consumedAt));
}
