import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotStatus, UomDimension } from "@prisma/client";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.productionOrder.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
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
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-FP-${m}`, legalName: `Cliente Plano Teste ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createItem(
  type: "RAW_MATERIAL" | "FINISHED_PRODUCT",
  overrides: { controlsExpiry?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-FP-${m}`,
      name: `Item Plano Teste ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: overrides.controlsExpiry ?? false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function receiveRawStock(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-FPR-${marker()}`.toUpperCase(),
      itemId,
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

async function receiveFinishedStock(
  itemId: string,
  quantity: string,
  overrides: { expiryDate?: Date | null; status?: LotStatus } = {},
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-FPF-${marker()}`.toUpperCase(),
      origin: "RECEIPT",
      itemId,
      initialReceivedQuantity: quantity,
      status: overrides.status ?? "AVAILABLE",
      ...(overrides.expiryDate !== undefined ? { expiryDate: overrides.expiryDate } : {}),
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity,
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "Teste",
    },
  });
  return lot;
}

/** Produto + Item PA (controlsExpiry opcional) + Formulação ACTIVE consumindo `components`. */
async function createProductWithFormulation(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
  overrides: { basisQuantity?: string; finishedControlsExpiry?: boolean } = {},
) {
  const finishedItem = await createItem("FINISHED_PRODUCT", {
    ...(overrides.finishedControlsExpiry !== undefined ? { controlsExpiry: overrides.finishedControlsExpiry } : {}),
  });
  const productResp = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto Plano Teste ${marker()}`, finishedProductItemId: finishedItem.id },
  });
  const product = productResp.json();
  fixtureProductIds.push(product.id);

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

  return { product, finishedItem };
}

async function createConfirmedOrder(
  app: App,
  customerId: string,
  lines: { productId: string; orderedQuantity: string }[],
) {
  const created = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: { customerId, lines },
  });
  fixtureCustomerOrderIds.push(created.json().id);
  const confirmed = await app.inject({
    method: "POST",
    url: `/customer-orders/${created.json().id}/confirm`,
  });
  return confirmed.json();
}

describe("Plano de Atendimento — análise", () => {
  it("default: pedido 1000 / available 600 -> reserve 600 / produce 400, impacto de material agregado", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product, finishedItem } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    await receiveFinishedStock(finishedItem.id, "600");

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "1000" },
    ]);

    const plan = await app.inject({ method: "GET", url: `/customer-orders/${order.id}/fulfillment-plan` });
    expect(plan.statusCode).toBe(200);
    const body = plan.json();
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].suggestedReserveQuantity).toBe("600");
    expect(body.lines[0].suggestedProductionQuantity).toBe("400");
    expect(body.lines[0].situation).toBe("REQUER_PRODUCAO");
    expect(body.materialImpact).toHaveLength(1);
    expect(body.materialImpact[0].itemId).toBe(rawMaterial.id);
    expect(body.materialImpact[0].requiredQuantity).toBe("400");

    await app.close();
  });

  it("available >= ordered -> reserve integral, produce 0, sem impacto de material", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product, finishedItem } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    await receiveFinishedStock(finishedItem.id, "1200");

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "1000" },
    ]);

    const plan = (await app.inject({ method: "GET", url: `/customer-orders/${order.id}/fulfillment-plan` })).json();
    expect(plan.lines[0].suggestedReserveQuantity).toBe("1000");
    expect(plan.lines[0].suggestedProductionQuantity).toBe("0");
    expect(plan.lines[0].situation).toBe("ESTOQUE_SUFICIENTE");
    expect(plan.materialImpact).toHaveLength(0);

    await app.close();
  });

  it("available 0 -> reserve 0, produce integral", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "1000" },
    ]);

    const plan = (await app.inject({ method: "GET", url: `/customer-orders/${order.id}/fulfillment-plan` })).json();
    expect(plan.lines[0].suggestedReserveQuantity).toBe("0");
    expect(plan.lines[0].suggestedProductionQuantity).toBe("1000");

    await app.close();
  });

  it("consultar o plano nunca altera estoque, nunca cria reserva/OP", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product, finishedItem } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    await receiveFinishedStock(finishedItem.id, "600");

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "1000" },
    ]);

    await app.inject({ method: "GET", url: `/customer-orders/${order.id}/fulfillment-plan` });
    await app.inject({ method: "GET", url: `/customer-orders/${order.id}/fulfillment-plan` });

    const inventory = await app.inject({ method: "GET", url: `/inventory/${finishedItem.id}` });
    expect(inventory.json().onHand).toBe("600");
    expect(inventory.json().reserved).toBe("0");

    const reloaded = (await app.inject({ method: "GET", url: `/customer-orders/${order.id}` })).json();
    expect(reloaded.status).toBe("CONFIRMED");
    expect(reloaded.reservation).toBeNull();
    expect(reloaded.generatedProductionOrders).toHaveLength(0);

    await app.close();
  });

  it("impacto de material agrega o mesmo item entre Products diferentes do mesmo pedido", async () => {
    const app = buildApp();
    await app.ready();

    const vitaminC = await createItem("RAW_MATERIAL");
    const { product: productA, finishedItem: finishedA } = await createProductWithFormulation(app, [
      { itemId: vitaminC.id, quantity: "30", unitCode: "kg" },
    ]);
    const { product: productB, finishedItem: finishedB } = await createProductWithFormulation(app, [
      { itemId: vitaminC.id, quantity: "20", unitCode: "kg" },
    ]);

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: productA.id, orderedQuantity: "1" },
      { productId: productB.id, orderedQuantity: "1" },
    ]);

    const plan = (await app.inject({ method: "GET", url: `/customer-orders/${order.id}/fulfillment-plan` })).json();
    expect(plan.materialImpact).toHaveLength(1);
    expect(plan.materialImpact[0].itemId).toBe(vitaminC.id);
    expect(plan.materialImpact[0].requiredQuantity).toBe("50");

    void finishedA;
    void finishedB;
    await app.close();
  });
});

describe("Plano de Atendimento — aplicação", () => {
  it("aceita ajuste manual cobrindo 100% do pedido; rejeita cobertura incompleta e reserva acima do disponível", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveRawStock(rawMaterial.id, "10000");
    const { product, finishedItem } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    await receiveFinishedStock(finishedItem.id, "600");

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "1000" },
    ]);
    const lineId = order.lines[0].id;

    const incomplete = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
      payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: "400", produceQuantity: "500" }] },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error).toBe("incomplete_plan_coverage");

    const excessive = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
      payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: "700", produceQuantity: "300" }] },
    });
    expect(excessive.statusCode).toBe(400);
    expect(excessive.json().error).toBe("excessive_reserve");

    const accepted = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
      payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: "400", produceQuantity: "600" }] },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json();
    expect(body.status).toBe("IN_FULFILLMENT");
    expect(body.reservation.status).toBe("ACTIVE");
    expect(body.reservation.lines.reduce((sum: number, l: { quantity: string }) => sum + Number(l.quantity), 0)).toBe(400);
    expect(body.generatedProductionOrders).toHaveLength(1);
    expect(body.generatedProductionOrders[0].plannedQuantity).toBe("600");

    await app.close();
  });

  it("reserva por FEFO em múltiplos lotes; On Hand não muda, Reserved sobe, Available desce, sem InventoryMovement novo", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product, finishedItem } = await createProductWithFormulation(
      app,
      [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
      { finishedControlsExpiry: true },
    );
    const lotA = await receiveFinishedStock(finishedItem.id, "400", {
      expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    const lotB = await receiveFinishedStock(finishedItem.id, "500", {
      expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "600" },
    ]);
    const lineId = order.lines[0].id;

    const movementsBefore = await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` });
    const movementCountBefore = movementsBefore.json().movements.length;

    const applied = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
      payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: "600", produceQuantity: "0" }] },
    });
    expect(applied.statusCode).toBe(200);
    const reservationLines = applied.json().reservation.lines as { lotId: string; quantity: string }[];
    expect(reservationLines).toHaveLength(2);
    const byLot = new Map(reservationLines.map((l) => [l.lotId, l.quantity]));
    expect(byLot.get(lotA.id)).toBe("400");
    expect(byLot.get(lotB.id)).toBe("200");
    expect(applied.json().generatedProductionOrders).toHaveLength(0);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${finishedItem.id}` });
    expect(inventory.json().onHand).toBe("900");
    expect(inventory.json().reserved).toBe("600");
    expect(inventory.json().available).toBe("300");

    const movementsAfter = await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` });
    expect(movementsAfter.json().movements.length).toBe(movementCountBefore);

    await app.close();
  });

  it("concorrência: dois pedidos disputando o mesmo saldo — só um consegue reservar", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product, finishedItem } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    await receiveFinishedStock(finishedItem.id, "100");

    const customerA = await createCustomer();
    const customerB = await createCustomer();
    const orderA = await createConfirmedOrder(app, customerA.id, [
      { productId: product.id, orderedQuantity: "80" },
    ]);
    const orderB = await createConfirmedOrder(app, customerB.id, [
      { productId: product.id, orderedQuantity: "80" },
    ]);

    const [respA, respB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/customer-orders/${orderA.id}/apply-fulfillment-plan`,
        payload: { lines: [{ customerOrderLineId: orderA.lines[0].id, reserveQuantity: "80", produceQuantity: "0" }] },
      }),
      app.inject({
        method: "POST",
        url: `/customer-orders/${orderB.id}/apply-fulfillment-plan`,
        payload: { lines: [{ customerOrderLineId: orderB.lines[0].id, reserveQuantity: "80", produceQuantity: "0" }] },
      }),
    ]);

    const statuses = [respA.statusCode, respB.statusCode].sort();
    expect(statuses).toEqual([200, 400]);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${finishedItem.id}` });
    expect(Number(inventory.json().reserved)).toBeLessThanOrEqual(100);
    expect(inventory.json().reserved).toBe("80");

    await app.close();
  });

  it("OP gerada: origin CUSTOMER_ORDER, ligada à linha, DRAFT, navega de volta ao Pedido", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveRawStock(rawMaterial.id, "10000");
    const { product } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "250" },
    ]);
    const lineId = order.lines[0].id;

    const applied = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
      payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: "0", produceQuantity: "250" }] },
    });
    expect(applied.statusCode).toBe(200);
    const generated = applied.json().generatedProductionOrders[0];
    expect(generated.plannedQuantity).toBe("250");
    expect(generated.status).toBe("DRAFT");

    const opDetail = (await app.inject({ method: "GET", url: `/production-orders/${generated.id}` })).json();
    expect(opDetail.origin).toBe("CUSTOMER_ORDER");
    expect(opDetail.customerOrderId).toBe(order.id);
    expect(opDetail.customerOrderCode).toBe(order.code);
    expect(opDetail.customerOrderLineId).toBe(lineId);
    expect(opDetail.status).toBe("DRAFT");

    await app.close();
  });

  it("pedido em atendimento bloqueia cancelamento simples (reserva/OP já existem)", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const { product, finishedItem } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    await receiveFinishedStock(finishedItem.id, "500");

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "500" },
    ]);
    await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
      payload: { lines: [{ customerOrderLineId: order.lines[0].id, reserveQuantity: "500", produceQuantity: "0" }] },
    });

    const cancel = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/cancel`,
      payload: { reason: "Tentativa de cancelar" },
    });
    expect(cancel.statusCode).toBe(400);
    expect(cancel.json().error).toBe("cancellation_blocked");

    await app.close();
  });
});
