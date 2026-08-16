import { Prisma } from "@prisma/client";
import type {
  ExpiryRowDTO,
  InventoryPositionRowDTO,
  MovementReportRowDTO,
  ReportPageDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  getOnHandByItems,
  getOnHandByLots,
  getReservedByItems,
  getReservedByLots,
  isLotAvailableForUse,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
import type { ExpiryQuery, InventoryPositionQuery, MovementsQuery } from "./reports.schemas.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function paginate<T>(rows: T[], page: number, pageSize: number): ReportPageDTO<T> {
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: rows.length,
  };
}

/**
 * R-01 — Posicao de Estoque. Fotografia atual por Item/Lote, sempre pelo
 * Inventory Ledger: `initialReceivedQuantity` e historico do recebimento e
 * NUNCA saldo. Item loteado gera uma linha por lote; item sem controle de
 * lote gera uma unica linha no nivel do Item.
 */
export async function getInventoryPosition(
  query: InventoryPositionQuery,
): Promise<ReportPageDTO<InventoryPositionRowDTO>> {
  const prisma = getPrisma();

  const itemWhere: Prisma.ItemWhereInput = {
    ...(query.itemId ? { id: query.itemId } : {}),
    ...(query.itemType ? { type: query.itemType } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const items = await prisma.item.findMany({
    where: itemWhere,
    orderBy: { code: "asc" },
    include: {
      lots: {
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.location ? { location: { contains: query.location, mode: "insensitive" } } : {}),
        },
        include: { supplier: true },
        orderBy: { code: "asc" },
      },
    },
  });

  const lotIds = items.flatMap((item) => item.lots.map((lot) => lot.id));
  const itemIds = items.map((item) => item.id);
  const [onHandByLot, reservedByLot, onHandByItem, reservedByItem] = await Promise.all([
    getOnHandByLots(prisma, lotIds),
    getReservedByLots(prisma, lotIds),
    getOnHandByItems(prisma, itemIds),
    getReservedByItems(prisma, itemIds),
  ]);

  const rows: InventoryPositionRowDTO[] = [];
  for (const item of items) {
    if (item.controlsLot) {
      for (const lot of item.lots) {
        const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
        const reserved = reservedByLot.get(lot.id) ?? new Prisma.Decimal(0);
        const available = isLotAvailableForUse(lot)
          ? Prisma.Decimal.max(onHand.minus(reserved), 0)
          : new Prisma.Decimal(0);
        if (query.onlyWithBalance && onHand.lessThanOrEqualTo(0)) continue;

        rows.push({
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          itemType: item.type,
          unitCode: item.unitCode,
          lotId: lot.id,
          lotCode: lot.code,
          lotOrigin: lot.origin,
          supplierLot: lot.supplierLot,
          businessLotNumber: lot.businessLotNumber,
          supplierName: lot.supplier ? lot.supplier.legalName : null,
          expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
          location: lot.location,
          onHand: onHand.toString(),
          reserved: reserved.toString(),
          available: available.toString(),
          status: lot.status,
          isExpired: isLotExpired(lot),
        });
      }
      continue;
    }

    // Item sem controle de lote: o saldo vive no proprio Item.
    if (query.status || query.location) continue;
    const onHand = onHandByItem.get(item.id) ?? new Prisma.Decimal(0);
    const reserved = reservedByItem.get(item.id) ?? new Prisma.Decimal(0);
    if (query.onlyWithBalance && onHand.lessThanOrEqualTo(0)) continue;

    rows.push({
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      itemType: item.type,
      unitCode: item.unitCode,
      lotId: null,
      lotCode: null,
      lotOrigin: null,
      supplierLot: null,
      businessLotNumber: null,
      supplierName: null,
      expiryDate: null,
      location: null,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: Prisma.Decimal.max(onHand.minus(reserved), 0).toString(),
      status: null,
      isExpired: false,
    });
  }

  return paginate(rows, query.page, query.pageSize);
}

/**
 * R-02 — Vencimentos. Vencimento e sempre a data EFETIVA do lote, nunca o
 * status persistido (nenhum job marca EXPIRED). Ordena do mais critico
 * (vencido ha mais tempo) para o mais distante.
 */
export async function getExpiryReport(query: ExpiryQuery): Promise<ReportPageDTO<ExpiryRowDTO>> {
  const prisma = getPrisma();
  const now = new Date();

  let expiryFilter: Prisma.DateTimeFilter;
  switch (query.window) {
    case "EXPIRED":
      expiryFilter = { lt: now };
      break;
    case "D7":
      expiryFilter = { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) };
      break;
    case "D30":
      expiryFilter = { gte: now, lte: new Date(now.getTime() + 30 * DAY_MS) };
      break;
    case "D60":
      expiryFilter = { gte: now, lte: new Date(now.getTime() + 60 * DAY_MS) };
      break;
    case "CUSTOM":
      expiryFilter = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
      break;
  }

  const lots = await prisma.lot.findMany({
    where: {
      expiryDate: expiryFilter,
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.itemType ? { item: { is: { type: query.itemType } } } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: "insensitive" } },
              { businessLotNumber: { contains: query.search, mode: "insensitive" } },
              { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
              { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { item: true },
    orderBy: { expiryDate: "asc" },
  });

  const lotIds = lots.map((lot) => lot.id);
  const [onHandByLot, reservedByLot] = await Promise.all([
    getOnHandByLots(prisma, lotIds),
    getReservedByLots(prisma, lotIds),
  ]);

  const rows: ExpiryRowDTO[] = [];
  for (const lot of lots) {
    const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
    // Lote zerado nao e problema operacional.
    if (query.onlyWithBalance && onHand.lessThanOrEqualTo(0)) continue;

    const reserved = reservedByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const available = isLotAvailableForUse(lot)
      ? Prisma.Decimal.max(onHand.minus(reserved), 0)
      : new Prisma.Decimal(0);
    const expiryDate = lot.expiryDate!;

    rows.push({
      itemId: lot.itemId,
      itemCode: lot.item.code,
      itemName: lot.item.name,
      unitCode: lot.item.unitCode,
      lotId: lot.id,
      lotCode: lot.code,
      lotOrigin: lot.origin,
      businessLotNumber: lot.businessLotNumber,
      supplierLot: lot.supplierLot,
      expiryDate: expiryDate.toISOString(),
      daysToExpiry: Math.ceil((expiryDate.getTime() - now.getTime()) / DAY_MS),
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      status: lot.status,
      isExpired: isLotExpired(lot),
      location: lot.location,
    });
  }

  return paginate(rows, query.page, query.pageSize);
}

/**
 * R-03 — Movimentacoes. Le direto o `InventoryMovement` (a fonte de verdade
 * do saldo) e resolve o documento de origem pelos vinculos 1:1 que cada
 * tipo ja possui — nenhum resolvedor generico, nenhum tipo perdido caso o
 * enum cresca.
 */
export async function getMovementsReport(
  query: MovementsQuery,
): Promise<ReportPageDTO<MovementReportRowDTO>> {
  const prisma = getPrisma();

  // Objeto montado dinamicamente e tipado no fim: `exactOptionalPropertyTypes`
  // nao aceita spread condicional direto sobre campos de enum do Prisma.
  const where = {
    ...(query.itemId ? { itemId: query.itemId } : {}),
    ...(query.lotId ? { lotId: query.lotId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    ...(query.from || query.to
      ? {
          occurredAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
            { lot: { is: { code: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  } as Prisma.InventoryMovementWhereInput;

  const [movements, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      include: {
        item: true,
        lot: true,
        receiptLine: { include: { receipt: true } },
        productionConsumption: { include: { productionOrder: true } },
        productionOutput: { include: { productionOrder: true } },
        shipmentLine: { include: { shipment: true } },
      },
      orderBy: { occurredAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  const rows = movements.map((movement): MovementReportRowDTO => {
    let documentCode: string | null = null;
    let documentKind: MovementReportRowDTO["documentKind"] = null;
    let documentId: string | null = null;

    if (movement.receiptLine) {
      documentCode = movement.receiptLine.receipt.code;
      documentKind = "RECEIPT";
      documentId = movement.receiptLine.receiptId;
    } else if (movement.productionConsumption) {
      documentCode = movement.productionConsumption.productionOrder.code;
      documentKind = "PRODUCTION_ORDER";
      documentId = movement.productionConsumption.productionOrderId;
    } else if (movement.productionOutput) {
      documentCode = movement.productionOutput.productionOrder.code;
      documentKind = "PRODUCTION_ORDER";
      documentId = movement.productionOutput.productionOrderId;
    } else if (movement.shipmentLine) {
      documentCode = movement.shipmentLine.shipment.code;
      documentKind = "SHIPMENT";
      documentId = movement.shipmentLine.shipmentId;
    }

    return {
      id: movement.id,
      occurredAt: movement.occurredAt.toISOString(),
      type: movement.type,
      itemId: movement.itemId,
      itemCode: movement.item.code,
      itemName: movement.item.name,
      lotId: movement.lotId,
      lotCode: movement.lot ? movement.lot.code : null,
      quantity: movement.quantity.toString(),
      unitCode: movement.item.unitCode,
      sourceType: movement.sourceType,
      documentCode,
      documentKind,
      documentId,
      reason: movement.reason,
      createdBy: movement.createdBy,
    };
  });

  return { rows, page: query.page, pageSize: query.pageSize, total };
}
