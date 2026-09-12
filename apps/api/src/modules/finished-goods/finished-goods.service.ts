import { Prisma } from "@prisma/client";
import type { CostQuality, CostSource, FinishedGoodRowDTO, FinishedGoodsListResponse } from "@veridi/shared";
import { intervaloDeDiasComerciais } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  getOnHandByLots,
  getReservedByLots,
  isLotAvailableForUse,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
import { findProductionOrderMaterialCost } from "../costs/costs.service.js";
import type { ListFinishedGoodsQuery } from "./finished-goods.schemas.js";

/**
 * Visao operacional de Produto Acabado — SEMPRE somente leitura. Nao ha
 * entidade nova nem segundo estoque: cada linha e um `Lot` com
 * `origin = PRODUCTION`, e os numeros vem das fontes que ja sao verdade
 * (ProductionOutput, Inventory Ledger, status do lote, servico de custo).
 * Produto acabado nasce so por ProductionOrder -> ProductionOutput, entao
 * esta tela nunca cria nada.
 */
export async function listFinishedGoods(
  query: ListFinishedGoodsQuery,
  pagination: Pagination = query,
): Promise<FinishedGoodsListResponse> {
  const prisma = getPrisma();

  const where: Record<string, unknown> = { origin: "PRODUCTION" };
  if (query.status) where["status"] = query.status;
  if (query.productionOrderId) where["productionOrderId"] = query.productionOrderId;
  if (query.productId) {
    where["productionOrder"] = { is: { productId: query.productId } };
  }
  // Período por dia comercial, fim EXCLUSIVO — mesma conversão das outras
  // listas. O apontamento das 22h pertence ao dia em que a fábrica o fez.
  const periodo = intervaloDeDiasComerciais(query.dateFrom, query.dateTo);
  if (periodo.inicio || periodo.fimExclusivo) {
    where["productionOutputs"] = {
      some: {
        producedAt: {
          ...(periodo.inicio ? { gte: periodo.inicio } : {}),
          ...(periodo.fimExclusivo ? { lt: periodo.fimExclusivo } : {}),
        },
      },
    };
  }
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { businessLotNumber: { contains: query.search, mode: "insensitive" } },
      { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
      { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
      { productionOrder: { is: { code: { contains: query.search, mode: "insensitive" } } } },
      { productionOrder: { is: { productName: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  // Um retrato so. A tela le a tabela inteira de lotes de producao, e cada
  // linha traz relacoes OBRIGATORIAS (`item`) que o Prisma busca em consultas
  // separadas. Fora de uma transacao cada consulta enxerga um instante
  // diferente do banco: uma linha lida no primeiro instante e apagada antes do
  // segundo derruba a listagem inteira ("Field item is required to return
  // data, got `null`"). `RepeatableRead` fixa o snapshot — e faz `total`
  // concordar com `rows`, que antes podiam vir de instantes distintos.
  const [lots, total] = await prisma.$transaction(
    [
      prisma.lot.findMany({
        where,
        include: {
          item: true,
          productionOutputs: { orderBy: { producedAt: "asc" } },
          productionOrder: { include: { product: true } },
        },
        orderBy: { code: "desc" },
        ...pageArgs(pagination),
      }),
      prisma.lot.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  const lotIds = lots.map((lot) => lot.id);
  const [onHandByLot, reservedByLot] = await Promise.all([
    getOnHandByLots(prisma, lotIds),
    getReservedByLots(prisma, lotIds),
  ]);

  // Custo e resolvido por OP (varios lotes de uma mesma OP compartilham a
  // mesma referencia unitaria — sem rateio ficticio) e cada OP e
  // consultada UMA vez, nunca por linha.
  const productionOrderIds = [
    ...new Set(lots.map((lot) => lot.productionOrderId).filter((id): id is string => id !== null)),
  ];
  const costByOrder = new Map<string, { unitCost: string | null; quality: CostQuality; source: CostSource | null }>();
  await Promise.all(
    productionOrderIds.map(async (orderId) => {
      const cost = await findProductionOrderMaterialCost(orderId);
      // A OP pode ter deixado de existir entre a leitura dos lotes e esta:
      // linha obsoleta fica sem custo, a tela inteira nao cai por causa dela.
      if (!cost) return;
      // Origem predominante: so faz sentido anunciar uma quando o custo e
      // utilizavel; em PARTIAL/NO_COST o valor nem e apresentado.
      const sources = new Set(cost.consumptions.map((consumption) => consumption.costSource));
      const source: CostSource | null =
        cost.quality === "REAL" ? "REAL" : sources.size === 1 ? [...sources][0]! : null;
      costByOrder.set(orderId, { unitCost: cost.materialUnitCost, quality: cost.quality, source });
    }),
  );

  const rows: FinishedGoodRowDTO[] = lots.map((lot) => {
    // Produzido e sempre a soma dos apontamentos reais — nunca confundido
    // com saldo atual, que vem do ledger.
    const producedQuantity = lot.productionOutputs.reduce(
      (sum, output) => sum.plus(output.quantity),
      new Prisma.Decimal(0),
    );
    const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const reserved = reservedByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const available = isLotAvailableForUse(lot)
      ? Prisma.Decimal.max(onHand.minus(reserved), 0)
      : new Prisma.Decimal(0);

    const cost = lot.productionOrderId ? costByOrder.get(lot.productionOrderId) : undefined;
    const order = lot.productionOrder;
    const usingSnapshot = order?.productCode !== null && order?.productCode !== undefined;

    return {
      lotId: lot.id,
      lotCode: lot.code,
      businessLotNumber: lot.businessLotNumber,
      productId: order ? order.productId : null,
      productCode: order ? (usingSnapshot ? order.productCode : order.product.code) : null,
      productName: order ? (usingSnapshot ? order.productName : order.product.name) : null,
      itemId: lot.itemId,
      itemCode: lot.item.code,
      itemName: lot.item.name,
      unitCode: lot.item.unitCode,
      productionOrderId: lot.productionOrderId,
      productionOrderCode: order ? order.code : null,
      producedAt: lot.productionOutputs[0]?.producedAt.toISOString() ?? null,
      producedQuantity: producedQuantity.toString(),
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      status: lot.status,
      isExpired: isLotExpired(lot),
      expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
      location: lot.location,
      // `materialUnitCost` do serviço já é `null` em PARTIAL/NO_COST —
      // um custo parcial nunca é exibido como se fosse completo.
      materialUnitCost: cost?.unitCost ?? null,
      costQuality: cost?.quality ?? "NO_COST",
      costSource: cost?.source ?? null,
    };
  });

  return { rows, ...pageMeta(pagination, total) };
}
