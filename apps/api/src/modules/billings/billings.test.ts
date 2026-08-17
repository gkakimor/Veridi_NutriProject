import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

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
    await prisma.billingLine.deleteMany({
      where: { billing: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.billing.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });

    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });

    await prisma.productionOrder.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });

    await prisma.customerOrderReservationLine.deleteMany({
      where: {
        reservation: { customerOrderId: { in: fixtureCustomerOrderIds } },
        replacesLineId: { not: null },
      },
    });
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
    data: { code: `CLI-FAT-${m}`, legalName: `Cliente Faturamento Teste ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createFinishedItem() {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-FAT-${m}`,
      name: `Produto Acabado Faturamento ${m}`,
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

async function stockFinishedLot(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-FAT-${marker()}`.toUpperCase(),
      origin: "RECEIPT",
      itemId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
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

async function createProduct(app: App, finishedItemId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto Faturamento Teste ${marker()}`, finishedProductItemId: finishedItemId },
  });
  const product = response.json();
  fixtureProductIds.push(product.id);
  return product;
}

/** Pedido CONFIRMED + Plano aplicado reservando tudo -> IN_FULFILLMENT. */
async function createOrderInFulfillment(app: App, productId: string, orderedQuantity: string, reserve: string) {
  const customer = await createCustomer();
  const created = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: { customerId: customer.id, lines: [{ productId, orderedQuantity }] },
  });
  const orderId = created.json().id;
  fixtureCustomerOrderIds.push(orderId);
  const confirmed = await app.inject({ method: "POST", url: `/customer-orders/${orderId}/confirm` });
  const lineId = confirmed.json().lines[0].id;

  const produce = (Number(orderedQuantity) - Number(reserve)).toString();
  const applied = await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
    payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: reserve, produceQuantity: produce }] },
  });
  return applied.json();
}

/**
 * Item loteado só sai depois de conferido fisicamente — a expedição não
 * confirma sem isso.
 */
async function verifyAllLots(app: App, shipmentId: string) {
  const shipment = (await app.inject({ method: "GET", url: `/shipments/${shipmentId}` })).json();
  for (const line of shipment.lines) {
    if (!line.requiresVerification) continue;
    await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/lines/${line.id}/verify`,
      payload: { lotCode: line.lotCode },
    });
  }
}

/** Cria e confirma uma Expedição da quantidade informada. */
async function shipQuantity(app: App, orderId: string, quantity?: string) {
  const draft = (await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })).json();
  if (quantity) {
    await app.inject({
      method: "PATCH",
      url: `/shipments/${draft.id}`,
      payload: {
        lines: [{ customerOrderReservationLineId: draft.lines[0].customerOrderReservationLineId, quantity }],
      },
    });
  }
  await verifyAllLots(app, draft.id);
  const confirmed = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
  return confirmed.json();
}

async function createBilling(app: App, shipmentId: string) {
  return app.inject({ method: "POST", url: "/billings", payload: { shipmentId } });
}

async function getOrder(app: App, id: string) {
  return (await app.inject({ method: "GET", url: `/customer-orders/${id}` })).json();
}

async function getInventory(app: App, itemId: string) {
  return (await app.inject({ method: "GET", url: `/inventory/${itemId}` })).json();
}

describe("Faturamento — criação", () => {
  it("gera FAT-000001 copiando fielmente as linhas da Expedição confirmada", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    const lot = await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);

    const response = await createBilling(app, shipment.id);
    expect(response.statusCode).toBe(201);
    const billing = response.json();
    expect(billing.code).toMatch(/^FAT-\d{6}$/);
    expect(billing.status).toBe("DRAFT");
    expect(billing.shipmentId).toBe(shipment.id);
    expect(billing.customerOrderId).toBe(order.id);
    expect(billing.shipmentCode).toBe(shipment.code);
    expect(billing.customerOrderCode).toBe(order.code);
    expect(billing.lines).toHaveLength(1);
    // Quantidade idêntica ao expedido — nunca recalculada do Pedido.
    expect(billing.lines[0].quantity).toBe("400");
    expect(billing.lines[0].lotId).toBe(lot.id);
    expect(billing.lines[0].unitPrice).toBeNull();
    expect(billing.totalQuantity).toBe("400");
    expect(billing.hasCompletePricing).toBe(false);
    expect(billing.totalAmount).toBeNull();

    await app.close();
  });

  it("filtra faturamentos por cliente — a pergunta mais frequente da tela", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);

    // Dois clientes distintos, um faturamento cada.
    const orderA = await createOrderInFulfillment(app, product.id, "100", "100");
    const shipmentA = await shipQuantity(app, orderA.id);
    const billingA = (await createBilling(app, shipmentA.id)).json();

    const orderB = await createOrderInFulfillment(app, product.id, "100", "100");
    const shipmentB = await shipQuantity(app, orderB.id);
    const billingB = (await createBilling(app, shipmentB.id)).json();

    expect(billingA.customerId).not.toBe(billingB.customerId);

    const onlyA = await app.inject({
      method: "GET",
      url: `/billings?customerId=${billingA.customerId}&pageSize=100`,
    });
    expect(onlyA.statusCode).toBe(200);
    const codes = onlyA.json().billings.map((row: { code: string }) => row.code);
    expect(codes).toContain(billingA.code);
    expect(codes).not.toContain(billingB.code);

    await app.close();
  });

  it("rejeita Expedição DRAFT e Expedição CANCELLED", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");

    const draft = (await app.inject({ method: "POST", url: `/customer-orders/${order.id}/shipments` })).json();
    const draftAttempt = await createBilling(app, draft.id);
    expect(draftAttempt.statusCode).toBe(400);
    expect(draftAttempt.json().error).toBe("shipment_not_billable");

    await app.inject({
      method: "POST",
      url: `/shipments/${draft.id}/cancel`,
      payload: { reason: "Teste de cancelamento" },
    });
    const cancelledAttempt = await createBilling(app, draft.id);
    expect(cancelledAttempt.statusCode).toBe(400);
    expect(cancelledAttempt.json().error).toBe("shipment_not_billable");

    await app.close();
  });

  it("apenas um faturamento ativo por Expedição; CANCELLED libera a vaga", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);

    const first = (await createBilling(app, shipment.id)).json();

    const second = await createBilling(app, shipment.id);
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("active_billing_exists");

    await app.inject({
      method: "POST",
      url: `/billings/${first.id}/cancel`,
      payload: { reason: "Refazer faturamento" },
    });

    const third = await createBilling(app, shipment.id);
    expect(third.statusCode).toBe(201);

    await app.close();
  });

  it("índice único parcial garante um ativo por Expedição mesmo contornando o service", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);
    await createBilling(app, shipment.id);

    const prisma = getPrisma();
    await expect(
      prisma.billing.create({
        data: {
          code: `FAT-DUP-${marker()}`,
          customerOrderId: order.id,
          shipmentId: shipment.id,
          status: "DRAFT",
          createdBy: "Teste",
        },
      }),
    ).rejects.toThrow();

    await app.close();
  });

  it("concorrência: duas criações simultâneas geram apenas um faturamento ativo", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);

    const [respA, respB] = await Promise.all([
      createBilling(app, shipment.id),
      createBilling(app, shipment.id),
    ]);
    const statuses = [respA.statusCode, respB.statusCode].sort();
    expect(statuses).toEqual([201, 400]);

    const billings = (await app.inject({ method: "GET", url: `/billings?shipmentId=${shipment.id}` })).json();
    expect(billings.billings.filter((b: { status: string }) => b.status !== "CANCELLED")).toHaveLength(1);

    await app.close();
  });

  it("não permite alterar quantidade, lote ou linhas do faturamento", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);
    const billing = (await createBilling(app, shipment.id)).json();

    // O schema só aceita `unitPrice` por linha — quantidade/lote/produto
    // nem são endereçáveis pela API.
    const response = await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: {
        lines: [{ billingLineId: billing.lines[0].id, unitPrice: "10", quantity: "999", lotId: "outro" }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().lines[0].quantity).toBe("400");
    expect(response.json().lines[0].lotId).toBe(billing.lines[0].lotId);
    expect(response.json().lines).toHaveLength(1);

    await app.close();
  });
});

describe("Faturamento — preço e valor", () => {
  it("preço opcional; total só existe com pricing completo; Decimal sem float", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    // Dois lotes → duas linhas de expedição → duas linhas de faturamento.
    await stockFinishedLot(finishedItem.id, "250");
    await stockFinishedLot(finishedItem.id, "150");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);
    const billing = (await createBilling(app, shipment.id)).json();
    expect(billing.lines).toHaveLength(2);

    // Só uma linha com preço → total indisponível.
    const partial = await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: { lines: [{ billingLineId: billing.lines[0].id, unitPrice: "15.90" }] },
    });
    expect(partial.json().lines[0].unitPrice).toBe("15.90");
    expect(partial.json().lines[0].lineTotal).toBe("3975.00");
    expect(partial.json().hasCompletePricing).toBe(false);
    expect(partial.json().totalAmount).toBeNull();

    // Todas com preço → total exato.
    const complete = await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: { lines: [{ billingLineId: billing.lines[1].id, unitPrice: "15.90" }] },
    });
    expect(complete.json().hasCompletePricing).toBe(true);
    expect(complete.json().totalAmount).toBe("6360.00");

    await app.close();
  });

  it("preço negativo rejeitado; zero aceito; preço limpável", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "100");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "100", "100");
    const shipment = await shipQuantity(app, order.id);
    const billing = (await createBilling(app, shipment.id)).json();

    const negative = await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: { lines: [{ billingLineId: billing.lines[0].id, unitPrice: "-5" }] },
    });
    expect(negative.statusCode).toBe(400);
    expect(negative.json().error).toBe("validation_error");

    const zero = await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: { lines: [{ billingLineId: billing.lines[0].id, unitPrice: "0" }] },
    });
    expect(zero.statusCode).toBe(200);
    expect(zero.json().lines[0].unitPrice).toBe("0.00");
    expect(zero.json().totalAmount).toBe("0.00");

    const cleared = await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: { lines: [{ billingLineId: billing.lines[0].id, unitPrice: "" }] },
    });
    expect(cleared.json().lines[0].unitPrice).toBeNull();
    expect(cleared.json().totalAmount).toBeNull();

    await app.close();
  });
});

describe("Faturamento — emissão e cancelamento", () => {
  it("emite sem preço, grava issuedAt/By e vira imutável", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);
    const billing = (await createBilling(app, shipment.id)).json();

    // Preço nunca é gate para emitir.
    const issued = await app.inject({ method: "POST", url: `/billings/${billing.id}/issue` });
    expect(issued.statusCode).toBe(200);
    expect(issued.json().status).toBe("ISSUED");
    expect(issued.json().issuedAt).not.toBeNull();
    expect(issued.json().issuedBy).not.toBeNull();
    expect(issued.json().totalAmount).toBeNull();

    const edit = await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: { notes: "tentativa" },
    });
    expect(edit.statusCode).toBe(400);
    expect(edit.json().error).toBe("billing_not_draft");

    const reissue = await app.inject({ method: "POST", url: `/billings/${billing.id}/issue` });
    expect(reissue.statusCode).toBe(400);

    const cancel = await app.inject({
      method: "POST",
      url: `/billings/${billing.id}/cancel`,
      payload: { reason: "tentativa" },
    });
    expect(cancel.statusCode).toBe(400);
    expect(cancel.json().error).toBe("billing_not_draft");

    await app.close();
  });

  it("emissão não altera Shipment, status do Pedido nem estoque", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);

    const inventoryBefore = await getInventory(app, finishedItem.id);
    const movementsBefore = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` })
    ).json().movements.length;
    const orderStatusBefore = (await getOrder(app, order.id)).status;

    const billing = (await createBilling(app, shipment.id)).json();

    // DRAFT não altera nada.
    const inventoryAfterDraft = await getInventory(app, finishedItem.id);
    expect(inventoryAfterDraft.onHand).toBe(inventoryBefore.onHand);

    await app.inject({ method: "POST", url: `/billings/${billing.id}/issue` });

    const inventoryAfter = await getInventory(app, finishedItem.id);
    expect(inventoryAfter.onHand).toBe(inventoryBefore.onHand);
    expect(inventoryAfter.reserved).toBe(inventoryBefore.reserved);
    expect(inventoryAfter.available).toBe(inventoryBefore.available);

    const movementsAfter = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` })
    ).json().movements.length;
    expect(movementsAfter).toBe(movementsBefore);

    const shipmentAfter = (await app.inject({ method: "GET", url: `/shipments/${shipment.id}` })).json();
    expect(shipmentAfter.status).toBe("CONFIRMED");
    expect(shipmentAfter.totalQuantity).toBe(shipment.totalQuantity);
    expect((await getOrder(app, order.id)).status).toBe(orderStatusBefore);

    await app.close();
  });

  it("cancelar DRAFT exige motivo, não conta como faturado e devolve a Expedição para faturável", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);
    const billing = (await createBilling(app, shipment.id)).json();

    const withoutReason = await app.inject({
      method: "POST",
      url: `/billings/${billing.id}/cancel`,
      payload: {},
    });
    expect(withoutReason.statusCode).toBe(400);

    const cancelled = await app.inject({
      method: "POST",
      url: `/billings/${billing.id}/cancel`,
      payload: { reason: "Dados incorretos" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");

    const orderAfter = await getOrder(app, order.id);
    expect(orderAfter.lines[0].billedQuantity).toBe("0");
    expect(orderAfter.billingStatus).toBe("PENDING");

    const awaiting = (await app.inject({ method: "GET", url: "/billings/awaiting" })).json();
    const row = awaiting.rows.find((r: { shipmentId: string }) => r.shipmentId === shipment.id);
    expect(row.billingStatus).toBe("PENDING");

    await app.close();
  });

  it("concorrência: duas emissões simultâneas do mesmo faturamento", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);
    const billing = (await createBilling(app, shipment.id)).json();

    const [respA, respB] = await Promise.all([
      app.inject({ method: "POST", url: `/billings/${billing.id}/issue` }),
      app.inject({ method: "POST", url: `/billings/${billing.id}/issue` }),
    ]);
    const statuses = [respA.statusCode, respB.statusCode].sort();
    expect(statuses).toEqual([200, 400]);

    const final = (await app.inject({ method: "GET", url: `/billings/${billing.id}` })).json();
    expect(final.status).toBe("ISSUED");
    // Faturado uma única vez.
    expect((await getOrder(app, order.id)).lines[0].billedQuantity).toBe("400");

    await app.close();
  });
});

describe("Faturamento — progresso do Pedido", () => {
  it("DRAFT não conta como faturado; Expedição fica 'em preparação'", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "400");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "400", "400");
    const shipment = await shipQuantity(app, order.id);
    await createBilling(app, shipment.id);

    const orderAfter = await getOrder(app, order.id);
    expect(orderAfter.lines[0].shippedQuantity).toBe("400");
    expect(orderAfter.lines[0].billedQuantity).toBe("0");
    expect(orderAfter.lines[0].unbilledShippedQuantity).toBe("400");
    expect(orderAfter.billingStatus).toBe("PENDING");

    const shipmentAfter = (await app.inject({ method: "GET", url: `/shipments/${shipment.id}` })).json();
    expect(shipmentAfter.billingStatus).toBe("DRAFT");
    expect(shipmentAfter.billingCode).toMatch(/^FAT-\d{6}$/);

    await app.close();
  });

  it("PROGRESSO COMPLETO: 1000 pedido, 400+600 expedidos e faturados → BILLED", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "1000", "1000");

    // Expedição 1: 400 → faturada.
    const shipment1 = await shipQuantity(app, order.id, "400");
    const billing1 = (await createBilling(app, shipment1.id)).json();
    await app.inject({ method: "POST", url: `/billings/${billing1.id}/issue` });

    const afterFirst = await getOrder(app, order.id);
    expect(afterFirst.lines[0].orderedQuantity).toBe("1000");
    expect(afterFirst.lines[0].shippedQuantity).toBe("400");
    expect(afterFirst.lines[0].billedQuantity).toBe("400");
    expect(afterFirst.status).toBe("PARTIALLY_SHIPPED");
    expect(afterFirst.billingStatus).toBe("PARTIALLY_BILLED");

    // Expedição 2: os 600 restantes, ainda não faturada.
    const shipment2 = await shipQuantity(app, order.id);
    const beforeSecondBilling = await getOrder(app, order.id);
    expect(beforeSecondBilling.lines[0].shippedQuantity).toBe("1000");
    expect(beforeSecondBilling.lines[0].billedQuantity).toBe("400");
    expect(beforeSecondBilling.lines[0].unbilledShippedQuantity).toBe("600");
    expect(beforeSecondBilling.status).toBe("SHIPPED");
    expect(beforeSecondBilling.billingStatus).toBe("PARTIALLY_BILLED");

    const billing2 = (await createBilling(app, shipment2.id)).json();
    expect(billing2.lines[0].quantity).toBe("600");
    await app.inject({ method: "POST", url: `/billings/${billing2.id}/issue` });

    const final = await getOrder(app, order.id);
    expect(final.lines[0].shippedQuantity).toBe("1000");
    expect(final.lines[0].billedQuantity).toBe("1000");
    expect(final.lines[0].unbilledShippedQuantity).toBe("0");
    expect(final.status).toBe("SHIPPED");
    expect(final.billingStatus).toBe("BILLED");
    expect(final.billings).toHaveLength(2);

    await app.close();
  });

  it("fatura Expedição de um Pedido apenas PARTIALLY_SHIPPED", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "1000", "1000");
    const shipment = await shipQuantity(app, order.id, "400");

    expect((await getOrder(app, order.id)).status).toBe("PARTIALLY_SHIPPED");

    const billing = (await createBilling(app, shipment.id)).json();
    const issued = await app.inject({ method: "POST", url: `/billings/${billing.id}/issue` });
    expect(issued.statusCode).toBe(200);
    expect(issued.json().lines[0].quantity).toBe("400");

    await app.close();
  });

  it("aguardando faturamento lista só Expedições CONFIRMED sem faturamento emitido", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "1000", "1000");
    const shipment = await shipQuantity(app, order.id, "400");

    const pending = (await app.inject({ method: "GET", url: "/billings/awaiting" })).json();
    const pendingRow = pending.rows.find((r: { shipmentId: string }) => r.shipmentId === shipment.id);
    expect(pendingRow).toBeDefined();
    expect(pendingRow.billingStatus).toBe("PENDING");
    expect(pendingRow.totalQuantity).toBe("400");
    expect(pendingRow.customerOrderCode).toBe(order.code);

    const billing = (await createBilling(app, shipment.id)).json();
    const inPreparation = (await app.inject({ method: "GET", url: "/billings/awaiting" })).json();
    expect(
      inPreparation.rows.find((r: { shipmentId: string }) => r.shipmentId === shipment.id).billingStatus,
    ).toBe("DRAFT");

    await app.inject({ method: "POST", url: `/billings/${billing.id}/issue` });
    const afterIssue = (await app.inject({ method: "GET", url: "/billings/awaiting" })).json();
    expect(afterIssue.rows.find((r: { shipmentId: string }) => r.shipmentId === shipment.id)).toBeUndefined();

    await app.close();
  });
});
