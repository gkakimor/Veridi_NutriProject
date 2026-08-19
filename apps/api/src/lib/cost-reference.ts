import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { CostSource } from "@veridi/shared";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `referenceDate` e DIA DE CALENDARIO, nao instante.
 *
 * Uma data vinda da tela chega como meia-noite. Comparar `receivedAt <= ela`
 * jogava para fora todo recebimento do PROPRIO dia: quem lancava a compra as
 * 20h e perguntava o custo daquela data recebia `NO_COST`, com o custo ja
 * gravado no banco. O dia inteiro conta — quem pergunta por 18/08 esta
 * perguntando pelo dia 18, nao pelo primeiro instante dele.
 *
 * A janela de tras nao muda: continua contada a partir da data pedida.
 */
function fimDoDia(date: Date): Date {
  const fim = new Date(date);
  fim.setUTCHours(23, 59, 59, 999);
  return fim;
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
  referenceDate: Date = new Date(),
): Promise<CostReference> {
  const limite = fimDoDia(referenceDate);
  const window30 = await weightedAverageInWindow(
    prisma,
    itemId,
    new Date(referenceDate.getTime() - 30 * DAY_MS),
    limite,
  );
  if (window30) {
    return {
      unitCost: window30.unitCost,
      source: "ESTIMATED_30D",
      referenceDate,
      details: `Média ponderada de ${window30.receiptLineCount} recebimento(s) nos últimos 30 dias.`,
    };
  }

  const window90 = await weightedAverageInWindow(
    prisma,
    itemId,
    new Date(referenceDate.getTime() - 90 * DAY_MS),
    limite,
  );
  if (window90) {
    return {
      unitCost: window90.unitCost,
      source: "ESTIMATED_90D",
      referenceDate,
      details: `Média ponderada de ${window90.receiptLineCount} recebimento(s) nos últimos 90 dias.`,
    };
  }

  // Ultimo custo real conhecido — sem limite de idade, mas nunca posterior
  // a referenceDate.
  const lastReal = await prisma.receiptLine.findFirst({
    where: {
      itemId,
      actualUnitCost: { not: null },
      receipt: { receivedAt: { lte: limite } },
    },
    orderBy: { receipt: { receivedAt: "desc" } },
    select: { actualUnitCost: true, receipt: { select: { receivedAt: true, code: true } } },
  });
  if (lastReal?.actualUnitCost) {
    return {
      unitCost: lastReal.actualUnitCost,
      source: "LAST_REAL_COST",
      referenceDate,
      details: `Último custo real conhecido (${lastReal.receipt.code}, ${lastReal.receipt.receivedAt.toLocaleDateString("pt-BR")}).`,
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
  referenceDate: Date = new Date(),
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

  return getItemCostReference(prisma, params.itemId, params.consumedAt);
}
