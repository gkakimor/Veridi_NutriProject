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
 */

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

/** Soma de custos conhecidos; `null` quando nenhum entrou — nunca `"0"` inventado. */
function somaConhecida(valores: (Prisma.Decimal | null)[]): string | null {
  const conhecidos = valores.filter((valor): valor is Prisma.Decimal => valor !== null);
  if (conhecidos.length === 0) return null;
  return conhecidos.reduce((soma, valor) => soma.plus(valor), new Decimal(0)).toString();
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
   */
  const [consumptions, gruposPorItem, gruposPorDestino] = await Promise.all([
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
  ]);

  const itens = await prisma.item.findMany({
    where: { id: { in: [...new Set(gruposPorItem.map((grupo) => grupo.itemId))] } },
    select: { id: true, code: true, name: true },
  });
  const itemPorId = new Map(itens.map((item) => [item.id, item]));

  const byItem = gruposPorItem
    .map((grupo): InternalConsumptionReportItemGroupDTO => {
      const item = itemPorId.get(grupo.itemId);
      return {
        itemId: grupo.itemId,
        itemCode: item?.code ?? "",
        itemName: item?.name ?? "",
        uomCode: grupo.uomCode,
        consumptionCount: grupo._count._all,
        quantity: (grupo._sum.quantity ?? new Decimal(0)).toString(),
        knownCostTotal: somaConhecida([grupo._sum.totalCost]),
        missingCostCount: grupo._count._all - grupo._count.totalCost,
      };
    })
    .sort((a, b) => porValorConhecido(a, b) || a.itemCode.localeCompare(b.itemCode));

  const byPurpose = gruposPorDestino
    .map(
      (grupo): InternalConsumptionReportPurposeGroupDTO => ({
        purpose: grupo.purpose,
        consumptionCount: grupo._count._all,
        knownCostTotal: somaConhecida([grupo._sum.totalCost]),
        missingCostCount: grupo._count._all - grupo._count.totalCost,
      }),
    )
    .sort(
      (a, b) =>
        porValorConhecido(a, b) ||
        // Sem destino por último entre iguais; o resto em ordem alfabética.
        (a.purpose === null ? 1 : b.purpose === null ? -1 : a.purpose.localeCompare(b.purpose)),
    );

  // Cada consumo está em exatamente um destino: os grupos somam o recorte.
  const consumptionCount = byPurpose.reduce((soma, grupo) => soma + grupo.consumptionCount, 0);
  const missingCostCount = byPurpose.reduce((soma, grupo) => soma + grupo.missingCostCount, 0);

  return {
    rows: consumptions.map(internalConsumptionToDTO),
    ...pageMeta(pagination, consumptionCount),
    summary: {
      consumptionCount,
      knownCostCount: consumptionCount - missingCostCount,
      missingCostCount,
      knownCostTotal: somaConhecida(gruposPorDestino.map((grupo) => grupo._sum.totalCost)),
      distinctItemCount: new Set(gruposPorItem.map((grupo) => grupo.itemId)).size,
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
