import { Prisma } from "@prisma/client";
import type { CostQuality, CostSource, FinishedGoodRowDTO, FinishedGoodsListResponse } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  getOnHandByLots,
  getReservedByLots,
  isLotAvailableForUse,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
import { getProductionOrderMaterialCost } from "../costs/costs.service.js";
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
): Promise<FinishedGoodsListResponse> {
  const prisma = getPrisma();

  const where: Record<string, unknown> = { origin: "PRODUCTION" };
  if (query.status) where["status"] = query.status;
  if (query.productionOrderId) where["productionOrderId"] = query.productionOrderId;
  if (query.productId) {
    where["productionOrder"] = { is: { productId: query.productId } };
  }
  if (query.dateFrom || query.dateTo) {
    where["productionOutputs"] = {
      some: {
        producedAt: {
          ...(query.dateFrom ? { gte: query.dateFrom } : {}),
          ...(query.dateTo ? { lte: query.dateTo } : {}),
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

  const [lots, total] = await Promise.all([
    prisma.lot.findMany({
      where,
      include: {
        item: true,
        productionOutputs: { orderBy: { producedAt: "asc" } },
        productionOrder: { include: { product: true } },
      },
      orderBy: { code: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.lot.count({ where }),
  ]);

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
      const cost = await getProductionOrderMaterialCost(orderId);
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

  return { rows, page: query.page, pageSize: query.pageSize, total };
}
