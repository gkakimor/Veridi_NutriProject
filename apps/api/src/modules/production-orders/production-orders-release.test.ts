import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotStatus, UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];

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
    data: { code: `FOR-REL-${marker}`, legalName: `Fornecedor Release Teste ${marker}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.receipt.deleteMany({ where: { purchaseOrderId: { in: fixturePurchaseOrderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureProductionOrderIds.length > 0) {
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);
    if (reservationIds.length > 0) {
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
      code: `${prefix}-REL-${m}`,
      name: `Item Release Teste ${m}`,
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
    payload: { name: `Produto Release Teste ${marker()}`, finishedProductItemId },
  });
  fixtureProductIds.push(response.json().id);
  return response.json();
}

/** Cria um produto com Finished Product Item + formulação V1 ACTIVE com os componentes informados. */
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

/** Cria uma OP PLANNED para o produto/quantidade informados. */
async function createPlannedOrder(app: App, productId: string, plannedQuantity: string) {
  const created = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity },
  });
  fixtureProductionOrderIds.push(created.json().id);
  const planned = await app.inject({
    method: "POST",
    url: `/production-orders/${created.json().id}/plan`,
  });
  return planned.json();
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
      code: `LT-REL-${m}`,
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

async function createOnOrder(app: App, itemId: string, orderedQuantity: string) {
  const created = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId,
      orderDate: new Date().toISOString(),
      lines: [{ itemId, orderedQuantity }],
    },
  });
  fixturePurchaseOrderIds.push(created.json().id);
  await app.inject({ method: "POST", url: `/purchase-orders/${created.json().id}/confirm` });
}

describe("Production Orders — RELEASE (PLANNED → RELEASED)", () => {
  it("PLANNED com estoque suficiente libera: status, releasedAt/releasedBy, Reservation ACTIVE", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "100");

    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "30", unitCode: "kg" },
    ]);

    const planned = await createPlannedOrder(app, product.id, "1");
    expect(planned.status).toBe("PLANNED");

    const released = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });
    expect(released.statusCode).toBe(200);
    const body = released.json();
    expect(body.status).toBe("RELEASED");
    expect(body.releasedAt).not.toBeNull();
    expect(body.releasedBy).not.toBeNull();
    expect(body.reservation).not.toBeNull();
    expect(body.reservation.status).toBe("ACTIVE");
    expect(body.reservation.lines).toHaveLength(1);
    expect(body.reservation.lines[0].itemId).toBe(rawMaterial.id);
    expect(body.reservation.lines[0].lotId).toBeNull();
    expect(body.reservation.lines[0].quantity).toBe("30");

    // On Hand nunca muda, Reserved aumenta, Available reduz — nenhum
    // InventoryMovement criado pelo RELEASE.
    const inventory = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventory.json().onHand).toBe("100");
    expect(inventory.json().reserved).toBe("30");
    expect(inventory.json().available).toBe("70");

    const movements = await app.inject({
      method: "GET",
      url: `/inventory-movements?itemId=${rawMaterial.id}`,
    });
    expect(movements.json().movements).toHaveLength(1);
    expect(movements.json().movements[0].sourceType).toBe("MANUAL_ADJUSTMENT");

    await app.close();
  });

  it("DRAFT não libera", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const created = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id },
    });
    fixtureProductionOrderIds.push(created.json().id);

    const release = await app.inject({
      method: "POST",
      url: `/production-orders/${created.json().id}/release`,
    });
    expect(release.statusCode).toBe(400);
    expect(release.json().error).toBe("invalid_transition");

    await app.close();
  });

  it("RELEASED não libera novamente", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "1");
    await app.inject({ method: "POST", url: `/production-orders/${planned.id}/release` });

    const secondRelease = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });
    expect(secondRelease.statusCode).toBe(400);
    expect(secondRelease.json().error).toBe("invalid_transition");

    await app.close();
  });

  it("shortage bloqueia release; OP continua PLANNED; nenhuma reserva parcial", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "70");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "100", unitCode: "kg" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "1");

    const release = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });
    expect(release.statusCode).toBe(400);
    expect(release.json().error).toBe("release_validation_failed");

    const fetched = await app.inject({ method: "GET", url: `/production-orders/${planned.id}` });
    expect(fetched.json().status).toBe("PLANNED");
    expect(fetched.json().reservation).toBeNull();

    const inventory = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventory.json().reserved).toBe("0");

    await app.close();
  });

  it("On Order não permite release mesmo cobrindo o total nominal", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "70");
    await createOnOrder(app, rawMaterial.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "100", unitCode: "kg" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "1");

    const release = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });
    expect(release.statusCode).toBe(400);
    expect(release.json().error).toBe("release_validation_failed");

    await app.close();
  });

  it("reserva cobre todos os Requirements de uma OP multi-componente", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawA = await createItem("RAW_MATERIAL", { controlsLot: false });
    const rawB = await createItem("PACKAGING", { controlsLot: false, unitCode: "un" });
    await receiveStockNoLot(app, rawA.id, "50");
    await receiveStockNoLot(app, rawB.id, "200");

    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawA.id, quantity: "20", unitCode: "kg" },
      { itemId: rawB.id, quantity: "100", unitCode: "un" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "1");

    const released = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });
    expect(released.statusCode).toBe(200);
    const lines = released.json().reservation.lines as { itemId: string; quantity: string }[];
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.itemId === rawA.id)?.quantity).toBe("20");
    expect(lines.find((l) => l.itemId === rawB.id)?.quantity).toBe("100");

    await app.close();
  });

  it("FEFO determina os lotes reservados; múltiplos lotes cobrem um único Requirement", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: true, controlsExpiry: true });
    const earlyLot = await receiveStock(rawMaterial.id, "30", {
      expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    const laterLot = await receiveStock(rawMaterial.id, "50", {
      expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "70", unitCode: "kg" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "1");

    const released = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });
    expect(released.statusCode).toBe(200);
    const lines = released.json().reservation.lines as { lotId: string; quantity: string }[];
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.lotId === earlyLot.id)?.quantity).toBe("30");
    expect(lines.find((l) => l.lotId === laterLot.id)?.quantity).toBe("40");

    await app.close();
  });

  it("FEFO no RELEASE recalcula com o estoque atual — segunda OP vê disponibilidade líquida reduzida", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: true, controlsExpiry: true });
    await receiveStock(rawMaterial.id, "30", { expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) });
    await receiveStock(rawMaterial.id, "50", { expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) });

    const { product: productA } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "20", unitCode: "kg" },
    ]);
    const plannedA = await createPlannedOrder(app, productA.id, "1");
    const releasedA = await app.inject({
      method: "POST",
      url: `/production-orders/${plannedA.id}/release`,
    });
    expect(releasedA.statusCode).toBe(200);
    // 20kg saem do lote mais proximo do vencimento (30kg) — sobra 10kg
    // disponivel nele, 50kg intactos no outro.

    const { product: productB } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "40", unitCode: "kg" },
    ]);
    const draftB = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: productB.id, plannedQuantity: "1" },
    });
    fixtureProductionOrderIds.push(draftB.json().id);

    const requirement = draftB.json().requirements[0];
    expect(requirement.available).toBe("60");
    expect(requirement.suggestedAllocations).toHaveLength(2);
    expect(requirement.suggestedAllocations[0].suggestedQuantity).toBe("10");
    expect(requirement.suggestedAllocations[1].suggestedQuantity).toBe("30");

    await app.close();
  });

  it("item sem controle de lote: ReservationLine com lotId null", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "40");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "15", unitCode: "kg" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "1");

    const released = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });
    expect(released.json().reservation.lines[0].lotId).toBeNull();
    expect(released.json().reservation.lines[0].quantity).toBe("15");

    await app.close();
  });
});

describe("Production Orders — RELEASE concorrente", () => {
  it("duas OPs disputando o mesmo estoque: só uma libera, Reserved nunca dobra", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "100");

    const { product: productA } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "80", unitCode: "kg" },
    ]);
    const { product: productB } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "80", unitCode: "kg" },
    ]);

    const plannedA = await createPlannedOrder(app, productA.id, "1");
    const plannedB = await createPlannedOrder(app, productB.id, "1");

    const [responseA, responseB] = await Promise.all([
      app.inject({ method: "POST", url: `/production-orders/${plannedA.id}/release` }),
      app.inject({ method: "POST", url: `/production-orders/${plannedB.id}/release` }),
    ]);

    const statuses = [responseA.statusCode, responseB.statusCode].sort();
    expect(statuses).toEqual([200, 400]);

    const failed = responseA.statusCode === 400 ? responseA : responseB;
    expect(failed.json().error).toBe("release_validation_failed");

    const inventory = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventory.json().reserved).toBe("80");
    expect(inventory.json().available).toBe("20");

    await app.close();
  });
});

describe("Production Orders — cancelamento de OP RELEASED", () => {
  it("cancelar RELEASED libera a reserva: On Hand intacto, Reserved volta a 0, Available restaurado", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "100");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "30", unitCode: "kg" },
    ]);
    const planned = await createPlannedOrder(app, product.id, "1");
    const released = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/release`,
    });
    expect(released.json().status).toBe("RELEASED");

    const beforeCancel = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(beforeCancel.json().reserved).toBe("30");

    const cancelled = await app.inject({
      method: "POST",
      url: `/production-orders/${planned.id}/cancel`,
      payload: { reason: "Ordem cancelada após liberação" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    expect(cancelled.json().reservation.status).toBe("RELEASED");
    expect(cancelled.json().reservation.releasedAt).not.toBeNull();
    expect(cancelled.json().reservation.releaseReason).toBe("Ordem cancelada após liberação");

    const afterCancel = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(afterCancel.json().onHand).toBe("100");
    expect(afterCancel.json().reserved).toBe("0");
    expect(afterCancel.json().available).toBe("100");

    const movements = await app.inject({
      method: "GET",
      url: `/inventory-movements?itemId=${rawMaterial.id}`,
    });
    // Continua so o movimento original de entrada — cancelar RELEASED nunca
    // cria InventoryMovement (nada fisico mudou).
    expect(movements.json().movements).toHaveLength(1);

    await app.close();
  });
});
