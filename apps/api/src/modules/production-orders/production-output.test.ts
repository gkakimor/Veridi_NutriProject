import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
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

  const m = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-OUT-${m}`, legalName: `Fornecedor Output Teste ${m}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    // production_outputs bloqueia (RESTRICT) tanto production_orders quanto
    // lots — precisa ser a primeira exclusao. Cascata automatica remove os
    // InventoryMovement FINISHED_GOOD_PRODUCTION associados.
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
    // Lotes de producao (finishedLots) referenciam productionOrderId
    // (RESTRICT) — precisam ser removidos antes da OP.
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

async function createItem(
  type: "RAW_MATERIAL" | "FINISHED_PRODUCT",
  overrides: { controlsLot?: boolean; controlsExpiry?: boolean; requiresQualityRelease?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-OUT-${m}`,
      name: `Item Output Teste ${m}`,
      unitCode: "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: overrides.controlsExpiry ?? false,
      requiresQualityRelease: overrides.requiresQualityRelease ?? false,
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
    payload: { customerId: await fixtureCustomerId(), name: `Produto Output Teste ${marker()}`, finishedProductItemId },
  });
  fixtureProductIds.push(response.json().id);
  return response.json();
}

async function receiveStock(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-OUT-${marker()}`.toUpperCase(),
      itemId,
      supplierId,
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

/** Cria produto + formulacao ACTIVE consumindo `rawMaterial`, libera e retorna a OP RELEASED. */
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

/** Confirma Picking + consome integralmente todas as linhas — leva a OP a IN_PRODUCTION. */
async function moveToInProduction(app: App, order: { id: string; requirements: any[] }) {
  for (const requirement of order.requirements) {
    for (const line of requirement.reservationLines) {
      await app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
        payload: line.lotCode ? { lotCode: line.lotCode } : {},
      });
      await app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/consumptions`,
        payload: { entries: [{ reservationLineId: line.id, quantity: line.quantity }] },
      });
    }
  }
  const refreshed = await app.inject({ method: "GET", url: `/production-orders/${order.id}` });
  return refreshed.json();
}

async function getOrder(app: App, id: string) {
  const response = await app.inject({ method: "GET", url: `/production-orders/${id}` });
  return response.json();
}

describe("ProductionOutput — registro de produção", () => {
  it("registra o usuário autenticado em picking, apontamento e conclusão", async () => {
    // Cada `inject` do harness autentica um usuário próprio: serve de prova
    // de que a ação guarda QUEM executou, não o ator de sistema.
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const released = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100");
    const order = await moveToInProduction(app, released);

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "100", destination: "NEW_LOT", businessLotNumber: "VD-AUDIT" },
    });
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    const final = await getOrder(app, order.id);
    const pickedBy = final.requirements
      .flatMap((requirement: { reservationLines: { pickedBy: string | null }[] }) =>
        requirement.reservationLines,
      )
      .map((line: { pickedBy: string | null }) => line.pickedBy);

    for (const actor of [...pickedBy, final.outputs[0].producedBy, final.completedBy]) {
      expect(actor).toBeTruthy();
      expect(actor).not.toBe("Ambiente local");
    }

    await app.close();
  });


  it("rejeita apontamento fora de IN_PRODUCTION", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100");

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "10", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_transition");

    await app.close();
  });

  it("quantidade deve ser maior que zero", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "0", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation_error");

    await app.close();
  });

  it("cria ProductionOutput + exatamente 1 InventoryMovement FINISHED_GOOD_PRODUCTION, aumenta On Hand", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "1000"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "600", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    expect(response.statusCode).toBe(201);
    const updated = response.json();
    expect(updated.outputs).toHaveLength(1);
    expect(updated.producedQuantity).toBe("600");
    expect(updated.remainingQuantity).toBe("400");

    const finishedLotId = updated.outputs[0].lotId;
    const inventory = await app.inject({ method: "GET", url: `/inventory/${finishedItem.id}` });
    expect(inventory.json().onHand).toBe("600");

    const movements = await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` });
    expect(movements.json().movements).toHaveLength(1);
    expect(movements.json().movements[0].type).toBe("FINISHED_GOOD_PRODUCTION");
    expect(movements.json().movements[0].lotId).toBe(finishedLotId);

    await app.close();
  });

  it("produção parcial: dois apontamentos no mesmo lote somam corretamente, sem perda de precisão", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "1000"),
    );

    const first = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "600", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    const lotId = first.json().outputs[0].lotId;

    const second = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "390", destination: "EXISTING_LOT", lotId },
    });
    expect(second.statusCode).toBe(201);
    const updated = second.json();
    expect(updated.outputs).toHaveLength(2);
    expect(updated.producedQuantity).toBe("990");
    expect(updated.remainingQuantity).toBe("10");
    expect(updated.eligibleFinishedLots).toHaveLength(1);
    expect(updated.eligibleFinishedLots[0].producedQuantity).toBe("990");

    const lot = await app.inject({ method: "GET", url: `/lots/${lotId}` });
    expect(lot.json().producedQuantity).toBe("990");
    expect(lot.json().onHand).toBe("990");

    await app.close();
  });

  it("não permite ultrapassar plannedQuantity (mesmo em lote novo)", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "1000"),
    );

    const first = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "600", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    const lotId = first.json().outputs[0].lotId;
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "390", destination: "EXISTING_LOT", lotId },
    });

    const overage = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "20", destination: "EXISTING_LOT", lotId },
    });
    expect(overage.statusCode).toBe(400);
    expect(overage.json().error).toBe("output_exceeds_planned");
    expect(overage.json().message).toContain("10");

    await app.close();
  });

  it("concorrência: dois apontamentos simultâneos não ultrapassam plannedQuantity somados", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const [respA, respB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/outputs`,
        payload: { quantity: "60", destination: "NEW_LOT", businessLotNumber: "VD-A" },
      }),
      app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/outputs`,
        payload: { quantity: "60", destination: "NEW_LOT", businessLotNumber: "VD-B" },
      }),
    ]);

    const statuses = [respA.statusCode, respB.statusCode].sort();
    expect(statuses).toEqual([201, 400]);

    const final = await getOrder(app, order.id);
    expect(Number(final.producedQuantity)).toBeLessThanOrEqual(100);
    expect(final.producedQuantity).toBe("60");

    await app.close();
  });

  it("concorrência no mesmo lote: dois apontamentos ao lote existente não ultrapassam o planejado", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const first = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "50", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    const lotId = first.json().outputs[0].lotId;

    const [respA, respB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/outputs`,
        payload: { quantity: "30", destination: "EXISTING_LOT", lotId },
      }),
      app.inject({
        method: "POST",
        url: `/production-orders/${order.id}/outputs`,
        payload: { quantity: "30", destination: "EXISTING_LOT", lotId },
      }),
    ]);

    const statuses = [respA.statusCode, respB.statusCode].sort();
    expect(statuses).toEqual([201, 400]);

    const final = await getOrder(app, order.id);
    expect(final.producedQuantity).toBe("80");

    await app.close();
  });

  it("rejeita lote de outra Ordem de Produção", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItemA = await createItem("FINISHED_PRODUCT");
    const finishedItemB = await createItem("FINISHED_PRODUCT");

    const orderA = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItemA.id, rawMaterial.id, "1", "100"),
    );
    const orderB = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItemB.id, rawMaterial.id, "1", "100"),
    );

    const outputA = await app.inject({
      method: "POST",
      url: `/production-orders/${orderA.id}/outputs`,
      payload: { quantity: "10", destination: "NEW_LOT", businessLotNumber: "VD-A" },
    });
    const lotFromA = outputA.json().outputs[0].lotId;

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${orderB.id}/outputs`,
      payload: { quantity: "10", destination: "EXISTING_LOT", lotId: lotFromA },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("finished_lot_wrong_order");

    await app.close();
  });

  it("lote bloqueado não é elegível para novo apontamento", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const first = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "50", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    const lotId = first.json().outputs[0].lotId;
    await app.inject({ method: "POST", url: `/lots/${lotId}/block`, payload: { reason: "Teste" } });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "10", destination: "EXISTING_LOT", lotId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("finished_lot_not_eligible");

    await app.close();
  });

  it("novo lote: origin PRODUCTION, código LT-YYYYMMDD-NNNNNN, businessLotNumber preservado, sem fornecedor/recebimento", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "50", destination: "NEW_LOT", businessLotNumber: "260815-A" },
    });
    const lotId = output.json().outputs[0].lotId;

    const lot = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(lot.origin).toBe("PRODUCTION");
    expect(lot.code).toMatch(/^LT-\d{8}-\d{6}$/);
    expect(lot.businessLotNumber).toBe("260815-A");
    expect(lot.supplierId).toBeNull();
    expect(lot.receiptId).toBeNull();
    expect(lot.productionOrderId).toBe(order.id);
    expect(lot.qrPayload).toBe(`LOT:${lot.code}`);

    await app.close();
  });

  it("item sem controle de lote bloqueia registro de produção", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT", { controlsLot: false });
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "10", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("lot_control_required");

    await app.close();
  });

  it("item com controlsExpiry exige validade no novo lote, e não aceita validade anterior à produção", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT", { controlsExpiry: true });
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const missing = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "10", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("missing_expiry_date");

    const past = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: {
        quantity: "10",
        destination: "NEW_LOT",
        businessLotNumber: "VD-1",
        expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(past.statusCode).toBe(400);
    expect(past.json().error).toBe("expiry_before_produced_at");

    await app.close();
  });

  it("requiresQualityRelease=true cria lote AWAITING_RELEASE; liberação altera Available", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT", { requiresQualityRelease: true });
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "50", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    const lotId = output.json().outputs[0].lotId;

    const beforeRelease = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(beforeRelease.status).toBe("AWAITING_RELEASE");
    expect(beforeRelease.onHand).toBe("50");
    expect(beforeRelease.available).toBe("0");

    await app.inject({ method: "POST", url: `/lots/${lotId}/release` });
    const afterRelease = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(afterRelease.status).toBe("AVAILABLE");
    expect(afterRelease.available).toBe("50");

    await app.close();
  });

  it("requiresQualityRelease=false cria lote AVAILABLE direto", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT", { requiresQualityRelease: false });
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "50", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    const lotId = output.json().outputs[0].lotId;

    const lot = (await app.inject({ method: "GET", url: `/lots/${lotId}` })).json();
    expect(lot.status).toBe("AVAILABLE");
    expect(lot.available).toBe("50");

    await app.close();
  });

  it("requiresQualityRelease=true: não soma novo output em lote já liberado (cria lote novo)", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT", { requiresQualityRelease: true });
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "50", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    const lotId = output.json().outputs[0].lotId;
    await app.inject({ method: "POST", url: `/lots/${lotId}/release` });

    const second = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "10", destination: "EXISTING_LOT", lotId },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("finished_lot_not_eligible");

    await app.close();
  });
});

describe("ProductionOrder — conclusão (COMPLETED)", () => {
  it("não permite concluir sem nenhum ProductionOutput", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );

    const response = await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("no_production_outputs");

    await app.close();
  });

  it("conclui exatamente com o planejado, sem completionReason", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "100", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });

    const response = await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.producedQuantity).toBe("100");
    expect(body.remainingQuantity).toBe("0");
    expect(body.completionReason).toBeNull();
    expect(body.completedAt).not.toBeNull();
    expect(body.completedBy).not.toBeNull();

    await app.close();
  });

  it("menos que o planejado exige completionReason; sem motivo é rejeitado", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "90", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });

    const rejected = await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe("missing_completion_reason");

    const accepted = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/complete`,
      payload: { completionReason: "Perda operacional no processo" },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.remainingQuantity).toBe("10");
    expect(body.completionReason).toBe("Perda operacional no processo");

    await app.close();
  });

  it("libera reserva remanescente: matemática crítica On Hand/Reserved/Available antes e depois da conclusão", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "100");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "30", "1");
    const line = order.requirements[0].reservationLines[0];

    const beforeConsumption = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(beforeConsumption.json().onHand).toBe("100");
    expect(beforeConsumption.json().reserved).toBe("30");
    expect(beforeConsumption.json().available).toBe("70");

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: line.lotCode ? { lotCode: line.lotCode } : {},
    });
    // Consome so 28 dos 30 reservados — 2 ficam reservados e nunca sao consumidos.
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: "28" }] },
    });

    const beforeComplete = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(beforeComplete.json().onHand).toBe("72");
    expect(beforeComplete.json().reserved).toBe("2");
    expect(beforeComplete.json().available).toBe("70");

    const movementsBefore = await app.inject({ method: "GET", url: `/inventory-movements?itemId=${rawMaterial.id}` });
    const movementCountBefore = movementsBefore.json().movements.length;

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    const completed = await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe("COMPLETED");

    const afterComplete = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(afterComplete.json().onHand).toBe("72");
    expect(afterComplete.json().reserved).toBe("0");
    expect(afterComplete.json().available).toBe("72");

    // Liberar reserva nunca cria InventoryMovement.
    const movementsAfter = await app.inject({ method: "GET", url: `/inventory-movements?itemId=${rawMaterial.id}` });
    expect(movementsAfter.json().movements.length).toBe(movementCountBefore);

    // Reservation vira historico RELEASED, nunca apagada.
    const orderAfter = await getOrder(app, order.id);
    expect(orderAfter.reservation.status).toBe("RELEASED");
    expect(orderAfter.reservation.lines).toHaveLength(1);

    await app.close();
  });

  it("OP COMPLETED bloqueia novo output, novo consumo e cancelamento", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(rawMaterial.id, "1000");
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const order = await moveToInProduction(
      app,
      await createReleasedOrder(app, finishedItem.id, rawMaterial.id, "1", "100"),
    );
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "100", destination: "NEW_LOT", businessLotNumber: "VD-1" },
    });
    await app.inject({ method: "POST", url: `/production-orders/${order.id}/complete`, payload: {} });

    const output = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-2" },
    });
    expect(output.statusCode).toBe(400);
    expect(output.json().error).toBe("invalid_transition");

    const consumption = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: "does-not-matter", quantity: "1" }] },
    });
    expect(consumption.statusCode).toBe(400);
    expect(consumption.json().error).toBe("order_not_released");

    const cancel = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/cancel`,
      payload: { reason: "Teste" },
    });
    expect(cancel.statusCode).toBe(400);

    await app.close();
  });
});
