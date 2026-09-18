import type { Prisma } from "@prisma/client";
import type {
  InternalConsumptionReportDTO,
  InternalConsumptionReportFilterOptionsDTO,
  InternalConsumptionReportItemGroupDTO,
  InternalConsumptionReportPurposeGroupDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { Decimal } from "../../lib/decimal.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  internalConsumptionInclude,
  internalConsumptionToDTO,
} from "../internal-consumption/internal-consumption.service.js";
import { periodoDeInstante } from "./report-period.js";
import type { InternalConsumptionReportQuery } from "./reports.schemas.js";

/**
 * R-21 — Uso e consumo (INTERNAL-CONSUMPTION-REPORT-01, Fatia 3).
 *
 * Read model sobre `InternalConsumption`, e só sobre ele: custo, origem do
 * custo, quantidade, unidade e quem registrou são os SNAPSHOTS gravados no
 * `CI-`. Nada aqui chama a hierarquia de custo — o relatório histórico não
 * recalcula a despesa pelo custo de hoje, e uma compra posterior não a
 * reescreve.
 *
 * Custo desconhecido é `null` do começo ao fim. O valor total soma SÓ os
 * consumos com custo conhecido, e quantos ficaram de fora sai ao lado — nunca
 * um zero que misturaria "não custou nada" com "não se sabe quanto custou".
 *
 * LÍQUIDO DOS ESTORNOS (INTERNAL-CONSUMPTION-REVERSAL-01, R21-a): o estorno
 * abate o consumo na data do CI. Os agrupamentos saem do banco pelo bruto e
 * os estornos dos CIs do recorte são descontados depois — o `groupBy` do
 * Prisma não subtrai. CI estornado por inteiro continua na lista, marcado, e
 * sai da contagem de Consumos, Sem custo e Itens distintos. O custo estornado
 * é a cópia gravada no ECI-, nunca recalculada.
 */

type Numeros = {
  consumptionCount: number;
  quantity: Prisma.Decimal;
  /** Consumos que CONTAM com custo conhecido. */
  knownCostCount: number;
  missingCostCount: number;
  /** Soma líquida dos custos conhecidos — só vale quando `knownCostCount > 0`. */
  knownCost: Prisma.Decimal;
};

type ConsumoEstornado = {
  itemId: string;
  uomCode: string;
  purpose: string | null;
  totalCost: Prisma.Decimal | null;
  quantidadeEstornada: Prisma.Decimal;
  custoEstornado: Prisma.Decimal;
  estornadoPorInteiro: boolean;
};

/** Desconta de um grupo o que os estornos de um CI tiraram dele. */
function descontar(numeros: Numeros, estornado: ConsumoEstornado): void {
  numeros.quantity = numeros.quantity.minus(estornado.quantidadeEstornada);
  if (estornado.totalCost !== null) numeros.knownCost = numeros.knownCost.minus(estornado.custoEstornado);
  if (!estornado.estornadoPorInteiro) return;
  numeros.consumptionCount -= 1;
  if (estornado.totalCost === null) numeros.missingCostCount -= 1;
  else numeros.knownCostCount -= 1;
}

/** O valor que o DTO leva: `null` quando nenhum consumo que conta tem custo. */
function valorConhecido(numeros: Numeros): string | null {
  return numeros.knownCostCount === 0 ? null : numeros.knownCost.toString();
}

/** O recorte — o MESMO `where` para as linhas, o resumo e os agrupamentos. */
function whereDoRelatorio(query: InternalConsumptionReportQuery): Prisma.InternalConsumptionWhereInput {
  const periodo = periodoDeInstante(query);
  return {
    ...(query.itemId ? { itemId: query.itemId } : {}),
    // Destino exato: o texto gravado é a identidade do destino até existir o
    // Centro de Custo (INTERNAL-CONSUMPTION-COST-CENTER-01).
    ...(query.purpose ? { purpose: query.purpose } : {}),
    ...(query.registeredByUserId ? { registeredByUserId: query.registeredByUserId } : {}),
    ...(query.costSource ? { costSource: query.costSource } : {}),
    // "Com custo" é custo TOTAL conhecido — o mesmo campo que o valor soma.
    ...(query.hasCost === true ? { totalCost: { not: null } } : {}),
    ...(query.hasCost === false ? { totalCost: null } : {}),
    ...(periodo ? { occurredAt: periodo } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}

/** Maior valor conhecido primeiro; sem custo por último, e então por volume. */
function porValorConhecido(
  a: { knownCostTotal: string | null; consumptionCount: number },
  b: { knownCostTotal: string | null; consumptionCount: number },
): number {
  if (a.knownCostTotal !== null && b.knownCostTotal !== null) {
    const diferenca = new Decimal(b.knownCostTotal).comparedTo(a.knownCostTotal);
    if (diferenca !== 0) return diferenca;
  } else if (a.knownCostTotal !== b.knownCostTotal) {
    return a.knownCostTotal === null ? 1 : -1;
  }
  return b.consumptionCount - a.consumptionCount;
}

export async function getInternalConsumptionReport(
  query: InternalConsumptionReportQuery,
  pagination: Pagination = query,
): Promise<InternalConsumptionReportDTO> {
  const prisma = getPrisma();
  const where = whereDoRelatorio(query);

  /*
   * Resumo e agrupamentos cobrem o FILTRO inteiro, não a página, e saem do
   * banco agregados. `_count.totalCost` conta só os não nulos: a diferença
   * para `_count._all` é exatamente "sem custo", sem uma segunda consulta.
   * Os estornos saem agregados por CI, só dos CIs do recorte.
   */
  const [consumptions, gruposPorItem, gruposPorDestino, estornosPorConsumo] = await Promise.all([
    prisma.internalConsumption.findMany({
      where,
      include: internalConsumptionInclude,
      orderBy: [{ occurredAt: "desc" }, { code: "desc" }],
      ...pageArgs(pagination),
    }),
    prisma.internalConsumption.groupBy({
      by: ["itemId", "uomCode"],
      where,
      _count: { _all: true, totalCost: true },
      _sum: { quantity: true, totalCost: true },
    }),
    prisma.internalConsumption.groupBy({
      by: ["purpose"],
      where,
      _count: { _all: true, totalCost: true },
      _sum: { totalCost: true },
    }),
    prisma.internalConsumptionReversal.groupBy({
      by: ["originalConsumptionId"],
      where: { originalConsumption: { is: where } },
      _sum: { quantity: true, totalCost: true },
    }),
  ]);

  // Os CIs que têm estorno: o que cada um tira do grupo do item e do destino.
  const somaPorConsumo = new Map(estornosPorConsumo.map((grupo) => [grupo.originalConsumptionId, grupo._sum]));
  const consumosEstornados: ConsumoEstornado[] = somaPorConsumo.size
    ? (
        await prisma.internalConsumption.findMany({
          where: { id: { in: [...somaPorConsumo.keys()] } },
          select: { id: true, itemId: true, uomCode: true, purpose: true, quantity: true, totalCost: true },
        })
      ).map((consumo) => {
        const soma = somaPorConsumo.get(consumo.id);
        const quantidadeEstornada = soma?.quantity ?? new Decimal(0);
        return {
          itemId: consumo.itemId,
          uomCode: consumo.uomCode,
          purpose: consumo.purpose,
          totalCost: consumo.totalCost,
          quantidadeEstornada,
          custoEstornado: soma?.totalCost ?? new Decimal(0),
          estornadoPorInteiro: quantidadeEstornada.greaterThanOrEqualTo(consumo.quantity),
        };
      })
    : [];

  const brutos = (grupo: {
    _count: { _all: number; totalCost: number };
    _sum: { quantity?: Prisma.Decimal | null; totalCost: Prisma.Decimal | null };
  }): Numeros => ({
    consumptionCount: grupo._count._all,
    quantity: grupo._sum.quantity ?? new Decimal(0),
    knownCostCount: grupo._count.totalCost,
    missingCostCount: grupo._count._all - grupo._count.totalCost,
    knownCost: grupo._sum.totalCost ?? new Decimal(0),
  });

  // Id do item (UUID) e código de unidade não têm ":": a chave não colide.
  const chaveDoItem = (itemId: string, uomCode: string) => `${itemId}:${uomCode}`;
  const porItem = new Map(gruposPorItem.map((grupo) => [chaveDoItem(grupo.itemId, grupo.uomCode), brutos(grupo)]));
  const porDestino = new Map(gruposPorDestino.map((grupo) => [grupo.purpose, brutos(grupo)]));
  const recorte: Numeros = {
    consumptionCount: 0,
    quantity: new Decimal(0),
    knownCostCount: 0,
    missingCostCount: 0,
    knownCost: new Decimal(0),
  };
  for (const numeros of porDestino.values()) {
    recorte.consumptionCount += numeros.consumptionCount;
    recorte.knownCostCount += numeros.knownCostCount;
    recorte.missingCostCount += numeros.missingCostCount;
    recorte.knownCost = recorte.knownCost.plus(numeros.knownCost);
  }
  // Cada consumo está em exatamente um destino: a lista mostra todos, os
  // estornados por inteiro inclusive.
  const listados = recorte.consumptionCount;

  for (const estornado of consumosEstornados) {
    const doItem = porItem.get(chaveDoItem(estornado.itemId, estornado.uomCode));
    const doDestino = porDestino.get(estornado.purpose);
    if (doItem) descontar(doItem, estornado);
    if (doDestino) descontar(doDestino, estornado);
    descontar(recorte, estornado);
  }

  const itemIds = [...new Set(gruposPorItem.map((grupo) => grupo.itemId))];
  const itens = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, code: true, name: true },
  });
  const itemPorId = new Map(itens.map((item) => [item.id, item]));

  // Grupo cujos consumos foram todos estornados por inteiro não tem o que
  // resumir: sai do agrupamento, como sai de Consumos e de Itens distintos.
  const byItem = gruposPorItem
    .flatMap((grupo): InternalConsumptionReportItemGroupDTO[] => {
      const numeros = porItem.get(chaveDoItem(grupo.itemId, grupo.uomCode))!;
      if (numeros.consumptionCount === 0) return [];
      const item = itemPorId.get(grupo.itemId);
      return [
        {
          itemId: grupo.itemId,
          itemCode: item?.code ?? "",
          itemName: item?.name ?? "",
          uomCode: grupo.uomCode,
          consumptionCount: numeros.consumptionCount,
          quantity: numeros.quantity.toString(),
          knownCostTotal: valorConhecido(numeros),
          missingCostCount: numeros.missingCostCount,
        },
      ];
    })
    .sort((a, b) => porValorConhecido(a, b) || a.itemCode.localeCompare(b.itemCode));

  const byPurpose = gruposPorDestino
    .flatMap((grupo): InternalConsumptionReportPurposeGroupDTO[] => {
      const numeros = porDestino.get(grupo.purpose)!;
      if (numeros.consumptionCount === 0) return [];
      return [
        {
          purpose: grupo.purpose,
          consumptionCount: numeros.consumptionCount,
          knownCostTotal: valorConhecido(numeros),
          missingCostCount: numeros.missingCostCount,
        },
      ];
    })
    .sort(
      (a, b) =>
        porValorConhecido(a, b) ||
        // Sem destino por último entre iguais; o resto em ordem alfabética.
        (a.purpose === null ? 1 : b.purpose === null ? -1 : a.purpose.localeCompare(b.purpose)),
    );

  return {
    rows: consumptions.map(internalConsumptionToDTO),
    ...pageMeta(pagination, listados),
    summary: {
      consumptionCount: recorte.consumptionCount,
      knownCostCount: recorte.knownCostCount,
      missingCostCount: recorte.missingCostCount,
      knownCostTotal: valorConhecido(recorte),
      distinctItemCount: new Set(byItem.map((grupo) => grupo.itemId)).size,
      reversedConsumptionCount: consumosEstornados.length,
    },
    byItem,
    byPurpose,
  };
}

/**
 * Opções dos filtros de Destino/uso e Usuário — dos consumos que existem,
 * não de um cadastro: só destino já escrito e só quem já registrou. O nome é
 * o atual do usuário; a linha do relatório continua com o nome do registro.
 */
export async function getInternalConsumptionReportFilterOptions(): Promise<InternalConsumptionReportFilterOptionsDTO> {
  const prisma = getPrisma();
  const [destinos, registrantes] = await Promise.all([
    prisma.internalConsumption.groupBy({
      by: ["purpose"],
      where: { purpose: { not: null } },
      orderBy: { purpose: "asc" },
    }),
    prisma.internalConsumption.groupBy({ by: ["registeredByUserId"] }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: registrantes.map((grupo) => grupo.registeredByUserId) } },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return {
    purposes: destinos.flatMap((grupo) => (grupo.purpose === null ? [] : [grupo.purpose])),
    users,
  };
}
