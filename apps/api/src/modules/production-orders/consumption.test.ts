import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotStatus, UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let supplierId: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-CONS-${marker}`, legalName: `Fornecedor Consumo Teste ${marker}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
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

async function createItem(
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  overrides: { unitCode?: string; controlsLot?: boolean; controlsExpiry?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "ME" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-CONS-${m}`,
      name: `Item Consumo Teste ${m}`,
      unitCode: overrides.unitCode ?? "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: overrides.controlsExpiry ?? false,
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
    payload: { name: `Produto Consumo Teste ${marker()}`, finishedProductItemId },
  });
  fixtureProductIds.push(response.json().id);
  return response.json();
}

async function createProductWithActiveFormulation(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
  overrides: { basisQuantity?: string } = {},
) {
  const finishedItem = await createItem("FINISHED_PRODUCT");
  const product = await createProduct(app, finishedItem.id);

  const created = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  const versionId = created.json().id;

  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: { basisQuantity: overrides.basisQuantity ?? "1", components },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  return { product, finishedItem, formulationVersionId: versionId };
}

async function createReleasedOrder(app: App, productId: string, plannedQuantity: string) {
  const created = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity },
  });
  fixtureProductionOrderIds.push(created.json().id);
  await app.inject({ method: "POST", url: `/production-orders/${created.json().id}/plan` });
  const released = await app.inject({
    method: "POST",
    url: `/production-orders/${created.json().id}/release`,
  });
  return released.json();
}

async function receiveStock(
  itemId: string,
  quantity: string,
  overrides: { status?: LotStatus; expiryDate?: Date | null } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-CONS-${m}`.toUpperCase(),
      itemId,
      supplierId,
      initialReceivedQuantity: quantity,
      status: overrides.status ?? "AVAILABLE",
      ...(overrides.expiryDate !== undefined ? { expiryDate: overrides.expiryDate } : {}),
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

async function receiveStockNoLot(app: App, itemId: string, quantity: string) {
  await app.inject({
    method: "POST",
    url: "/inventory-adjustments",
    payload: { itemId, type: "ADJUSTMENT_IN", quantity, reason: "Estoque inicial para teste" },
  });
}

/** Cria OP RELEASED de item sem lote, com Picking ja confirmado — pronta para consumir. */
async function createPickedOrder(app: App, requiredQuantity: string, stockQuantity: string) {
  const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
  await receiveStockNoLot(app, rawMaterial.id, stockQuantity);
  const { product } = await createProductWithActiveFormulation(app, [
    { itemId: rawMaterial.id, quantity: requiredQuantity, unitCode: "kg" },
  ]);
  const order = await createReleasedOrder(app, product.id, "1");
  const lineId = order.requirements[0].reservationLines[0].id;
  await app.inject({
    method: "POST",
    url: `/production-orders/${order.id}/picking/${lineId}/confirm`,
    payload: {},
  });
  return { rawMaterial, order, lineId };
}

describe("Consumo real — regras básicas", () => {
  it("exige Picking confirmado antes do consumo", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "100");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "30", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const lineId = order.requirements[0].reservationLines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "10" }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("picking_required");

    await app.close();
  });

  it("primeiro consumo muda RELEASED → IN_PRODUCTION e registra startedAt/startedBy", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, lineId } = await createPickedOrder(app, "30", "100");
    expect(order.status).toBe("RELEASED");
    expect(order.startedAt).toBeNull();

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "10" }] },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("IN_PRODUCTION");
    expect(body.startedAt).not.toBeNull();
    expect(body.startedBy).not.toBeNull();

    await app.close();
  });

  it("cria ProductionConsumption e exatamente um InventoryMovement PRODUCTION_CONSUMPTION", async () => {
    const app = buildTestApp();
    await app.ready();
    const { rawMaterial, order, lineId } = await createPickedOrder(app, "30", "100");

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "10" }] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().consumptions).toHaveLength(1);
    expect(response.json().consumptions[0].quantity).toBe("10");
    expect(response.json().consumptions[0].itemId).toBe(rawMaterial.id);

    const movements = await app.inject({
      method: "GET",
      url: `/inventory-movements?itemId=${rawMaterial.id}`,
    });
    const consumptionMovements = movements
      .json()
      .movements.filter((m: { type: string }) => m.type === "PRODUCTION_CONSUMPTION");
    expect(consumptionMovements).toHaveLength(1);
    expect(consumptionMovements[0].quantity).toBe("10");

    await app.close();
  });

  it("item sem lote consome corretamente", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, lineId } = await createPickedOrder(app, "30", "100");

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "30" }] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().requirements[0].remainingReservedQuantity).toBe("0");

    await app.close();
  });

  it("consumo parcial e múltiplos consumos acumulam corretamente", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, lineId } = await createPickedOrder(app, "30", "100");

    const first = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "10" }] },
    });
    expect(first.json().requirements[0].consumedQuantity).toBe("10");
    expect(first.json().requirements[0].remainingReservedQuantity).toBe("20");

    const second = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "18" }] },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().requirements[0].consumedQuantity).toBe("28");
    expect(second.json().requirements[0].remainingReservedQuantity).toBe("2");
    expect(second.json().consumptions).toHaveLength(2);

    await app.close();
  });

  it("consumo exatamente igual ao reservado zera o restante", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, lineId } = await createPickedOrder(app, "30", "100");

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "30" }] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().requirements[0].allocatedQuantity).toBe("30");
    expect(response.json().requirements[0].consumedQuantity).toBe("30");
    expect(response.json().requirements[0].remainingReservedQuantity).toBe("0");

    await app.close();
  });

  it("não excede o que ainda resta reservado", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, lineId } = await createPickedOrder(app, "30", "100");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "28" }] },
    });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "3" }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("consumption_exceeds_reserved");

    await app.close();
  });

  it("não consome lote que ficou inelegível entre o Picking e o consumo", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(rawMaterial.id, "30");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const lineId = order.requirements[0].reservationLines[0].id;
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${lineId}/confirm`,
      payload: { lotCode: lot.code },
    });

    await getPrisma().lot.update({ where: { id: lot.id }, data: { status: "BLOCKED" } });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "5" }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("consumption_lot_not_eligible");

    await app.close();
  });

  it("histórico de consumo preserva todos os eventos, não só o total", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, lineId } = await createPickedOrder(app, "30", "100");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "10" }] },
    });
    const final = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "18" }] },
    });

    const consumptions = final.json().consumptions as { quantity: string }[];
    expect(consumptions).toHaveLength(2);
    expect(consumptions.map((c) => c.quantity).sort()).toEqual(["10", "18"]);

    await app.close();
  });

  it("não permite cancelar OP depois de IN_PRODUCTION", async () => {
    const app = buildTestApp();
    await app.ready();
    const { order, lineId } = await createPickedOrder(app, "30", "100");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "5" }] },
    });

    const cancelAttempt = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/cancel`,
      payload: { reason: "Tentativa de cancelamento" },
    });
    expect(cancelAttempt.statusCode).toBe(400);
    expect(cancelAttempt.json().error).toBe("invalid_transition");

    await app.close();
  });
});

describe("Consumo real — matemática crítica de Reserved/Available", () => {
  it("consumir estoque já reservado não reduz Available novamente", async () => {
    const app = buildTestApp();
    await app.ready();
    const { rawMaterial, order, lineId } = await createPickedOrder(app, "30", "100");

    let inventory = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventory.json().onHand).toBe("100");
    expect(inventory.json().reserved).toBe("30");
    expect(inventory.json().available).toBe("70");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "10" }] },
    });

    inventory = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventory.json().onHand).toBe("90");
    expect(inventory.json().reserved).toBe("20");
    expect(inventory.json().available).toBe("70");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: lineId, quantity: "18" }] },
    });

    inventory = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventory.json().onHand).toBe("72");
    expect(inventory.json().reserved).toBe("2");
    expect(inventory.json().available).toBe("70");

    await app.close();
  });
});

describe("Consumo real — concorrência", () => {
  it("duas requisições consumindo o restante da mesma linha: só uma passa", async () => {
    const app = buildTestApp();
    await app.ready();
    const { lineId, order } = await createPickedOrder(app, "10", "100");

    const attempt = (quantity: string) =>
      app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/consumptions`,
        payload: { entries: [{ reservationLineId: lineId, quantity }] },
      });

    const [first, second] = await Promise.all([attempt("8"), attempt("8")]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 400]);

    const finalOrder = await app.inject({ method: "GET", url: `/production-orders/${order.id}` });
    expect(finalOrder.json().requirements[0].consumedQuantity).toBe("8");

    await app.close();
  });
});
