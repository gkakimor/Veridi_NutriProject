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

/** Linha de recebimento com custo real informado, como a média a lê. */
interface LinhaComCustoReal {
  receivedQuantity: Prisma.Decimal;
  actualUnitCost: Prisma.Decimal | null;
}

/** A linha com custo real mais recente, como o último custo real a lê. */
interface UltimaLinhaComCustoReal {
  actualUnitCost: Prisma.Decimal | null;
  receipt: { receivedAt: Date; code: string };
}

/**
 * De onde a hierarquia de custo de UM item lê os recebimentos com custo real.
 *
 * A regra — janelas, média ponderada, último real, `NO_COST` — mora só em
 * `referenciaDoItem`. Quem responde as perguntas é que muda: o banco, uma
 * consulta por pergunta (`getItemCostReference`), ou os recebimentos já
 * carregados de uma vez para muitos consumos (`getConsumedLotCostReferences`,
 * DASHBOARD-COST-BATCH-01). As duas respostas têm de ser as mesmas linhas.
 */
interface RecebimentosComCustoDoItem {
  /** Linhas com `actualUnitCost` informado e `receipt.receivedAt` em [inicio, fim]. */
  naJanela(inicio: Date, fim: Date): Promise<LinhaComCustoReal[]>;
  /** A linha com `actualUnitCost` informado de `receipt.receivedAt` mais recente até `fim`. */
  ultimaAte(fim: Date): Promise<UltimaLinhaComCustoReal | null>;
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
function weightedAverage(
  lines: readonly LinhaComCustoReal[],
): { unitCost: Prisma.Decimal; receiptLineCount: number } | null {
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

/** Os recebimentos de um item perguntados ao banco, uma consulta por pergunta. */
function recebimentosNoBanco(prisma: PrismaOrTx, itemId: string): RecebimentosComCustoDoItem {
  return {
    naJanela: (from, to) =>
      prisma.receiptLine.findMany({
        where: {
          itemId,
          actualUnitCost: { not: null },
          receipt: { receivedAt: { gte: from, lte: to } },
        },
        select: { receivedQuantity: true, actualUnitCost: true },
      }),
    // Ultimo custo real conhecido — sem limite de idade, mas nunca de um dia
    // comercial posterior ao da pergunta.
    ultimaAte: (fim) =>
      prisma.receiptLine.findFirst({
        where: {
          itemId,
          actualUnitCost: { not: null },
          receipt: { receivedAt: { lte: fim } },
        },
        orderBy: { receipt: { receivedAt: "desc" } },
        select: { actualUnitCost: true, receipt: { select: { receivedAt: true, code: true } } },
      }),
  };
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
  return referenciaDoItem(recebimentosNoBanco(prisma, itemId), referenceDate);
}

type LimitesDaJanela = typeof limitesDaJanelaDeCusto;

/**
 * A hierarquia de `getItemCostReference`, sobre os recebimentos de quem pergunta.
 * `janelaDeCusto` é sempre `limitesDaJanelaDeCusto` — quem resolve muitos
 * consumos passa a mesma função guardando o resultado por dia na chamada.
 */
async function referenciaDoItem(
  recebimentos: RecebimentosComCustoDoItem,
  referenceDate: Date,
  janelaDeCusto: LimitesDaJanela = limitesDaJanelaDeCusto,
): Promise<CostReference> {
  const janela30 = janelaDeCusto(referenceDate, 30);
  const window30 = weightedAverage(await recebimentos.naJanela(janela30.inicio, janela30.fim));
  if (window30) {
    return {
      unitCost: window30.unitCost,
      source: "ESTIMATED_30D",
      referenceDate,
      details: `Média ponderada de ${window30.receiptLineCount} recebimento(s) nos últimos 30 dias.`,
    };
  }

  const janela90 = janelaDeCusto(referenceDate, 90);
  const window90 = weightedAverage(await recebimentos.naJanela(janela90.inicio, janela90.fim));
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
  const lastReal = await recebimentos.ultimaAte(janela30.fim);
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
  params: ConsumoParaCusto,
): Promise<CostReference> {
  return referenciaDoConsumo(
    {
      custoDoLote: (lotId) =>
        prisma.receiptLine.findFirst({
          where: { lotId, actualUnitCost: { not: null } },
          select: { actualUnitCost: true, lot: { select: { code: true } } },
        }),
      recebimentosDoItem: (itemId) => recebimentosNoBanco(prisma, itemId),
    },
    params,
  );
}

/** O que a referência de custo lê de um consumo. */
export interface ConsumoParaCusto {
  itemId: string;
  lotId: string | null;
  consumedAt: Date;
}

/** A linha de recebimento do lote consumido, como o custo `REAL` a lê. */
interface CustoDoLote {
  actualUnitCost: Prisma.Decimal | null;
  lot: { code: string } | null;
}

/** A hierarquia de `getConsumedLotCostReference`, sobre os dados de quem pergunta. */
async function referenciaDoConsumo(
  fontes: {
    custoDoLote(lotId: string): Promise<CustoDoLote | null>;
    recebimentosDoItem(itemId: string): RecebimentosComCustoDoItem;
    janelaDeCusto?: LimitesDaJanela;
  },
  params: ConsumoParaCusto,
): Promise<CostReference> {
  if (params.lotId) {
    const receiptLine = await fontes.custoDoLote(params.lotId);
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
  return referenciaDoItem(
    fontes.recebimentosDoItem(params.itemId),
    marcadorDoDiaComercialDe(params.consumedAt),
    fontes.janelaDeCusto,
  );
}

/**
 * `getConsumedLotCostReference` de muitos consumos de uma vez — a mesma
 * referência, na mesma ordem da entrada (DASHBOARD-COST-BATCH-01).
 *
 * Consumo a consumo, cada referência custava até quatro consultas: o custo do
 * lote, as duas janelas e o último real. O Painel pergunta por 200 OPs
 * concluídas, e as consultas por consumo eram quase todas as da requisição.
 * Aqui os dados saem em até três consultas para todos, e cada consumo passa
 * pela MESMA hierarquia (`referenciaDoConsumo`/`referenciaDoItem`) lendo do
 * que foi carregado:
 *
 * 1. o custo efetivo dos lotes consumidos — `lotId` é único na linha de
 *    recebimento, uma linha por lote no máximo;
 * 2. para os consumos sem custo de lote, as linhas com custo real dos itens
 *    no intervalo que cobre as janelas de TODOS eles — do início da janela
 *    mais antiga ao fim do dia mais recente;
 * 3. só para item que não tem nenhuma linha até o dia de algum consumo dentro
 *    desse intervalo, o último custo real ANTERIOR ao intervalo — é o único
 *    último real que o intervalo não contém.
 *
 * Nada fica guardado entre chamadas, e `prisma` é o contexto de quem pergunta:
 * dentro do retrato do Painel, a transação dele. Uma pergunta da hierarquia
 * fora do que foi carregado é erro, nunca resposta vazia — custo desconhecido
 * por falta de carga seria um `NO_COST` que o banco não diz.
 */
export async function getConsumedLotCostReferences(
  prisma: PrismaOrTx,
  consumos: readonly ConsumoParaCusto[],
): Promise<CostReference[]> {
  if (consumos.length === 0) return [];

  // A janela de um dia é a mesma para todo consumo desse dia, e cada cálculo
  // pergunta o fuso ao `Intl` (~0,5 ms): guardada por dia, só nesta chamada.
  const janelasDoDia = new Map<string, ReturnType<LimitesDaJanela>>();
  const janelaDeCusto: LimitesDaJanela = (referenceDate, diasParaTras) => {
    const chave = `${referenceDate.getTime()}:${diasParaTras}`;
    let limites = janelasDoDia.get(chave);
    if (!limites) {
      limites = limitesDaJanelaDeCusto(referenceDate, diasParaTras);
      janelasDoDia.set(chave, limites);
    }
    return limites;
  };

  const custoPorLote = await carregarCustoDosLotes(prisma, consumos);
  // Quem cai na fundação do item: consumo sem lote, ou lote sem custo efetivo.
  const semCustoDoLote = consumos.filter(
    (consumo) => !(consumo.lotId && custoPorLote.get(consumo.lotId)?.actualUnitCost),
  );
  const fontes = {
    custoDoLote: async (lotId: string) => custoPorLote.get(lotId) ?? null,
    recebimentosDoItem: await carregarRecebimentosDosItens(prisma, semCustoDoLote, janelaDeCusto),
    janelaDeCusto,
  };
  return Promise.all(consumos.map((consumo) => referenciaDoConsumo(fontes, consumo)));
}

/** Passo 1 de `getConsumedLotCostReferences`: o custo efetivo de cada lote consumido. */
async function carregarCustoDosLotes(
  prisma: PrismaOrTx,
  consumos: readonly ConsumoParaCusto[],
): Promise<Map<string, CustoDoLote>> {
  const lotIds = [...new Set(consumos.flatMap((consumo) => (consumo.lotId ? [consumo.lotId] : [])))];
  if (lotIds.length === 0) return new Map();
  const linhas = await prisma.receiptLine.findMany({
    where: { lotId: { in: lotIds }, actualUnitCost: { not: null } },
    select: { lotId: true, actualUnitCost: true, lot: { select: { code: true } } },
  });
  return new Map<string, CustoDoLote>(linhas.map((linha) => [linha.lotId!, linha]));
}

/**
 * Passos 2 e 3 de `getConsumedLotCostReferences`: os recebimentos com custo real
 * que a hierarquia vai perguntar sobre estes consumos, respondidos do que foi
 * carregado.
 */
async function carregarRecebimentosDosItens(
  prisma: PrismaOrTx,
  consumos: readonly ConsumoParaCusto[],
  janelaDeCusto: LimitesDaJanela,
): Promise<(itemId: string) => RecebimentosComCustoDoItem> {
  const naoCarregado = (itemId: string): never => {
    throw new Error(`Recebimentos do item ${itemId} pedidos fora do que o custo em lote carregou.`);
  };
  const perguntas = consumos.map((consumo) => {
    const referenceDate = marcadorDoDiaComercialDe(consumo.consumedAt);
    return {
      itemId: consumo.itemId,
      janela30: janelaDeCusto(referenceDate, 30),
      janela90: janelaDeCusto(referenceDate, 90),
    };
  });
  if (perguntas.length === 0) {
    return (itemId) => ({
      naJanela: async () => naoCarregado(itemId),
      ultimaAte: async () => naoCarregado(itemId),
    });
  }

  const ms = (instante: Date) => instante.getTime();
  const janelas = perguntas.flatMap(({ janela30, janela90 }) => [janela30, janela90]);
  const inicio = janelas.reduce(
    (menor, janela) => (ms(janela.inicio) < ms(menor) ? janela.inicio : menor),
    janelas[0]!.inicio,
  );
  const fim = janelas.reduce((maior, janela) => (ms(janela.fim) > ms(maior) ? janela.fim : maior), janelas[0]!.fim);
  const itemIds = [...new Set(perguntas.map((pergunta) => pergunta.itemId))];

  const linhasPorItem = new Map<string, (LinhaComCustoReal & UltimaLinhaComCustoReal)[]>(
    itemIds.map((itemId) => [itemId, []]),
  );
  const linhas = await prisma.receiptLine.findMany({
    where: {
      itemId: { in: itemIds },
      actualUnitCost: { not: null },
      receipt: { receivedAt: { gte: inicio, lte: fim } },
    },
    select: {
      itemId: true,
      receivedQuantity: true,
      actualUnitCost: true,
      receipt: { select: { receivedAt: true, code: true } },
    },
  });
  for (const linha of linhas) linhasPorItem.get(linha.itemId)!.push(linha);

  // O último real de um consumo está no intervalo sempre que o item tem linha
  // nele até o dia do consumo. Sem nenhuma, só pode ser anterior ao intervalo.
  const temLinhaAte = (itemId: string, ate: Date) =>
    linhasPorItem.get(itemId)!.some((linha) => ms(linha.receipt.receivedAt) <= ms(ate));
  const semLinhaAteODia = [
    ...new Set(
      perguntas.filter(({ itemId, janela30 }) => !temLinhaAte(itemId, janela30.fim)).map(({ itemId }) => itemId),
    ),
  ];
  const anteriorPorItem = new Map<string, UltimaLinhaComCustoReal | null>(
    semLinhaAteODia.map((itemId) => [itemId, null]),
  );
  if (semLinhaAteODia.length > 0) {
    const anteriores = await prisma.receiptLine.findMany({
      where: {
        itemId: { in: semLinhaAteODia },
        actualUnitCost: { not: null },
        receipt: { receivedAt: { lt: inicio } },
      },
      orderBy: { receipt: { receivedAt: "desc" } },
      distinct: ["itemId"],
      select: { itemId: true, actualUnitCost: true, receipt: { select: { receivedAt: true, code: true } } },
    });
    for (const linha of anteriores) anteriorPorItem.set(linha.itemId, linha);
  }

  return (itemId) => {
    const doItem = linhasPorItem.get(itemId);
    const carregadasAte = (ate: Date) => (doItem && ms(ate) <= ms(fim) ? doItem : naoCarregado(itemId));
    return {
      naJanela: async (desde, ate) =>
        (ms(desde) >= ms(inicio) ? carregadasAte(ate) : naoCarregado(itemId)).filter(
          (linha) => ms(linha.receipt.receivedAt) >= ms(desde) && ms(linha.receipt.receivedAt) <= ms(ate),
        ),
      ultimaAte: async (ate) => {
        let ultima: UltimaLinhaComCustoReal | null = null;
        for (const linha of carregadasAte(ate)) {
          if (ms(linha.receipt.receivedAt) > ms(ate)) continue;
          if (!ultima || ms(linha.receipt.receivedAt) > ms(ultima.receipt.receivedAt)) ultima = linha;
        }
        if (ultima) return ultima;
        return anteriorPorItem.has(itemId) ? anteriorPorItem.get(itemId)! : naoCarregado(itemId);
      },
    };
  };
}
