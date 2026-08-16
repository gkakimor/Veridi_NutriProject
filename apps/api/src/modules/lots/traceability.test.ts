import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let supplierId: string;
let supplierName: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const m = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  supplierName = `Fornecedor Rastreabilidade Teste ${m}`;
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-TRACE-${m}`, legalName: supplierName },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOutput.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds }, replacesLineId: { not: null } },
      });
      await prisma.materialReservationLine.deleteMany({ where: { reservationId: { in: reservationIds } } });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-TRC-${m}`,
      name: `Item Rastreabilidade Teste ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createProduct(app: App, finishedProductItemId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto Rastreabilidade Teste ${marker()}`, finishedProductItemId },
  });
  fixtureProductIds.push(response.json().id);
  return response.json();
}

async function receiveStock(itemId: string, quantity: string, supplierLot: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-TRC-${marker()}`.toUpperCase(),
      itemId,
      supplierId,
      supplierLot,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity,
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
  return lot;
}

async function createReleasedOrder(
  app: App,
  finishedItemId: string,
  rawMaterialId: string,
  rawQuantityPerBasis: string,
  plannedQuantity: string,
) {
  const product = await createProduct(app, finishedItemId);
  const created = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  const versionId = created.json().id;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: {
      basisQuantity: plannedQuantity,
      components: [{ itemId: rawMaterialId, quantity: rawQuantityPerBasis, unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  const orderCreated = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId: product.id, plannedQuantity },
  });
  fixtureProductionOrderIds.push(orderCreated.json().id);
  await app.inject({ method: "POST", url: `/production-orders/${orderCreated.json().id}/plan` });
  const released = await app.inject({
    method: "POST",
    url: `/production-orders/${orderCreated.json().id}/release`,
  });
  return released.json();
}

describe("Rastreabilidade bidirecional (backward/forward)", () => {
  it("backward: lote de produto acabado mostra a OP e os materiais REALMENTE consumidos", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const rawLot = await receiveStock(rawMaterial.id, "50", "FORN-LOTE-X");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "20", "1");
    const line = order.requirements[0].reservationLines[0];
    expect(line.lotId).toBe(rawLot.id);

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: rawLot.code },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: "20" }] },
    });

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-BACKWARD" },
    });
    const finishedLotId = output.json().outputs[0].lotId;
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    const traceability = await app.inject({ method: "GET", url: `/lots/${finishedLotId}/traceability` });
    expect(traceability.statusCode).toBe(200);
    const body = traceability.json();
    expect(body.kind).toBe("FINISHED_GOOD");
    expect(body.productionOrderId).toBe(order.id);
    expect(body.producedQuantity).toBe("1");
    expect(body.consumedMaterials).toHaveLength(1);
    expect(body.consumedMaterials[0].lotId).toBe(rawLot.id);
    expect(body.consumedMaterials[0].lotCode).toBe(rawLot.code);
    expect(body.consumedMaterials[0].supplierLot).toBe("FORN-LOTE-X");
    expect(body.consumedMaterials[0].supplierName).toBe(supplierName);
    expect(body.consumedMaterials[0].quantity).toBe("20");

    await app.close();
  });

  it("forward: lote de matéria-prima mostra a OP e o(s) lote(s) de produto acabado gerados", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const rawLot = await receiveStock(rawMaterial.id, "50", "FORN-LOTE-Y");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "15", "1");
    const line = order.requirements[0].reservationLines[0];

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: rawLot.code },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: "15" }] },
    });

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-FORWARD" },
    });
    const finishedLotId = output.json().outputs[0].lotId;
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    const traceability = await app.inject({ method: "GET", url: `/lots/${rawLot.id}/traceability` });
    expect(traceability.statusCode).toBe(200);
    const body = traceability.json();
    expect(body.kind).toBe("RAW_MATERIAL");
    expect(body.usedIn).toHaveLength(1);
    expect(body.usedIn[0].productionOrderId).toBe(order.id);
    expect(body.usedIn[0].consumedQuantity).toBe("15");
    expect(body.usedIn[0].finishedLots).toHaveLength(1);
    expect(body.usedIn[0].finishedLots[0].lotId).toBe(finishedLotId);
    expect(body.usedIn[0].finishedLots[0].producedQuantity).toBe("1");

    await app.close();
  });

  it("CRÍTICO: lote apenas reservado e NUNCA consumido não aparece como matéria-prima utilizada", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const originalLot = await receiveStock(rawMaterial.id, "30", "FORN-ORIGINAL");
    const alternateLot = await receiveStock(rawMaterial.id, "30", "FORN-ALTERNATIVO");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "20", "1");
    const originalLine = order.requirements[0].reservationLines[0];
    expect(originalLine.lotId).toBe(originalLot.id);

    // Substitui ANTES de qualquer Picking/Consumo — o lote original nunca
    // e fisicamente tocado, so o alternativo e realmente consumido.
    const substituted = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${originalLine.id}/substitute`,
      payload: { lotCode: alternateLot.code },
    });
    const newLine = substituted.json().requirements[0].reservationLines.find(
      (l: { replacesLineId: string | null }) => l.replacesLineId === originalLine.id,
    );
    expect(newLine.lotId).toBe(alternateLot.id);
    expect(newLine.pickingStatus).toBe("CONFIRMED");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: newLine.id, quantity: "20" }] },
    });

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-CRITICO" },
    });
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    // O lote original: so reservado, jamais consumido — usedIn vazio.
    const originalTraceability = (
      await app.inject({ method: "GET", url: `/lots/${originalLot.id}/traceability` })
    ).json();
    expect(originalTraceability.kind).toBe("RAW_MATERIAL");
    expect(originalTraceability.usedIn).toHaveLength(0);

    // O lote alternativo: realmente consumido — aparece corretamente.
    const alternateTraceability = (
      await app.inject({ method: "GET", url: `/lots/${alternateLot.id}/traceability` })
    ).json();
    expect(alternateTraceability.usedIn).toHaveLength(1);
    expect(alternateTraceability.usedIn[0].consumedQuantity).toBe("20");

    // Genealogia do lote de produto acabado tambem so cita o lote realmente
    // consumido (alternativo) — nunca o originalmente reservado.
    const finishedLotId = output.json().outputs[0].lotId;
    const finishedTraceability = (
      await app.inject({ method: "GET", url: `/lots/${finishedLotId}/traceability` })
    ).json();
    expect(finishedTraceability.consumedMaterials).toHaveLength(1);
    expect(finishedTraceability.consumedMaterials[0].lotId).toBe(alternateLot.id);

    await app.close();
  });

  it("404 para lote inexistente", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: `/lots/00000000-0000-0000-0000-000000000000/traceability` });
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
