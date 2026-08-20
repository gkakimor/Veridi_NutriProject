import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureSupplierIds: string[] = [];

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
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });

    await prisma.productionOutput.deleteMany({
      where: { productionOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({ where: { reservationId: { in: reservationIds } } });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    // Lotes de produto acabado gerados (origin=PRODUCTION) referenciam a OP
    // via productionOrderId (RESTRICT) — precisam sumir antes da OP.
    await prisma.lot.deleteMany({
      where: { productionOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
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
    // OCs manuais (nao vinculadas a customerOrderId) tambem podem referenciar
    // estes itens — precisa limpar por itemId, nao so por customerOrderId.
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    // OCs manuais restantes (linhas ja limpas por itemId acima) — o
    // cabecalho ainda bloqueia a exclusao do Supplier via FK.
    await prisma.purchaseOrder.deleteMany({ where: { supplierId: { in: fixtureSupplierIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-PS-${m}`, legalName: `Cliente Compra Teste ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createSupplier(overrides: { active?: boolean } = {}) {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-PS-${m}`, legalName: `Fornecedor Compra Teste ${m}`, active: overrides.active ?? true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createRawMaterial() {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-PS-${m}`,
      name: `Item Compra Teste ${m}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function adjustStock(app: App, itemId: string, quantity: string) {
  // Entrada de estoque que falha em silêncio reaparece dez linhas adiante
  // como "estoque disponível insuficiente" — mensagem que culpa o release
  // por um lançamento que nunca aconteceu.
  const response = await app.inject({
    method: "POST",
    url: "/inventory-adjustments",
    payload: { itemId, type: "ADJUSTMENT_IN", quantity, reason: "Estoque inicial para teste" },
  });
  expect(response.statusCode, `ajuste de estoque falhou: ${response.body}`).toBe(201);
}

async function createProductWithFormulation(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
  overrides: { basisQuantity?: string; withFormulation?: boolean } = {},
) {
  const m = marker();
  const finishedItem = await getPrisma().item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-PS-${m}`,
      name: `Item Finalizado Compra Teste ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(finishedItem.id);

  const productResp = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto Compra Teste ${m}`, finishedProductItemId: finishedItem.id },
  });
  const product = productResp.json();
  fixtureProductIds.push(product.id);

  if (overrides.withFormulation === false) {
    return { product, finishedItem };
  }

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

async function applyPlan(
  app: App,
  orderId: string,
  lines: { customerOrderLineId: string; reserveQuantity: string; produceQuantity: string }[],
) {
  const response = await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
    payload: { lines },
  });
  return response.json();
}

async function planAndRelease(app: App, opId: string) {
  const planned = await app.inject({ method: "POST", url: `/production-orders/${opId}/plan` });
  expect(planned.statusCode, `plan falhou: ${planned.body}`).toBe(200);
  const released = await app.inject({ method: "POST", url: `/production-orders/${opId}/release` });
  /*
   * Falhar aqui, com o corpo da resposta.
   *
   * Sem esta checagem, uma recusa do release virava `order.requirements is
   * not iterable` dez linhas adiante — erro de JavaScript no lugar do motivo
   * real, que estava no corpo HTTP e era descartado.
   */
  expect(released.statusCode, `release falhou: ${released.body}`).toBe(200);
  return released.json();
}

async function consumeAllLines(app: App, opId: string, order: { requirements: { reservationLines: { id: string; quantity: string }[] }[] }, quantityOverride?: string) {
  for (const requirement of order.requirements) {
    for (const line of requirement.reservationLines) {
      await app.inject({
        method: "POST",
        url: `/production-orders/${opId}/picking/${line.id}/confirm`,
        payload: {},
      });
      await app.inject({
        method: "POST",
        url: `/production-orders/${opId}/consumptions`,
        payload: { entries: [{ reservationLineId: line.id, quantity: quantityOverride ?? line.quantity }] },
      });
    }
  }
  const refreshed = await app.inject({ method: "GET", url: `/production-orders/${opId}` });
  return refreshed.json();
}

async function getSuggestion(app: App, orderId: string) {
  const response = await app.inject({ method: "GET", url: `/customer-orders/${orderId}/purchase-suggestion` });
  return response;
}

describe("Sugestão de Compra — análise", () => {
  it("agrega o mesmo Item entre OPs/Products diferentes do mesmo Pedido", async () => {
    const app = buildTestApp();
    await app.ready();

    const vitaminC = await createRawMaterial();
    const { product: productA } = await createProductWithFormulation(app, [
      { itemId: vitaminC.id, quantity: "30", unitCode: "kg" },
    ]);
    const { product: productB } = await createProductWithFormulation(app, [
      { itemId: vitaminC.id, quantity: "20", unitCode: "kg" },
    ]);

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: productA.id, orderedQuantity: "1" },
      { productId: productB.id, orderedQuantity: "1" },
    ]);
    await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
      { customerOrderLineId: order.lines[1].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);

    const response = await getSuggestion(app, order.id);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const row = body.rows.find((r: { itemId: string }) => r.itemId === vitaminC.id);
    expect(row).toBeDefined();
    expect(row.remainingRequired).toBe("50");
    expect(row.operationalShortage).toBe("50");

    await app.close();
  });

  it("consumo real reduz remainingRequired; reserva própria da OP conta como cobertura", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createRawMaterial();
    await adjustStock(app, rawMaterial.id, "1000");
    const { product } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "100", unitCode: "kg" },
    ]);

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    const applied = await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);
    const opId = applied.generatedProductionOrders[0].id;

    const released = await planAndRelease(app, opId);
    expect(released.reservation.lines[0].quantity).toBe("100");

    const beforeConsumption = await getSuggestion(app, order.id);
    const rowBefore = beforeConsumption.json().rows.find((r: { itemId: string }) => r.itemId === rawMaterial.id);
    expect(rowBefore.remainingRequired).toBe("100");
    expect(rowBefore.ownReserved).toBe("100");
    expect(rowBefore.operationalShortage).toBe("0");

    await consumeAllLines(app, opId, released, "40");

    const afterConsumption = await getSuggestion(app, order.id);
    const rowAfter = afterConsumption.json().rows.find((r: { itemId: string }) => r.itemId === rawMaterial.id);
    expect(rowAfter.remainingRequired).toBe("60");
    expect(rowAfter.ownReserved).toBe("60");
    expect(rowAfter.operationalShortage).toBe("0");

    await app.close();
  });

  it("OP sem Requirements (sem Formulação ativa) vira pendência de planejamento, fora da soma quantitativa", async () => {
    const app = buildTestApp();
    await app.ready();

    const { product } = await createProductWithFormulation(app, [], { withFormulation: false });
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "10" }]);
    const applied = await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "10" },
    ]);
    expect(applied.generatedProductionOrders[0].status).toBe("DRAFT");

    const response = await getSuggestion(app, order.id);
    const body = response.json();
    expect(body.rows).toHaveLength(0);
    expect(body.pendingProductionOrders).toHaveLength(1);
    expect(body.pendingProductionOrders[0].id).toBe(applied.generatedProductionOrders[0].id);

    await app.close();
  });

  it("OP CANCELLED e OP COMPLETED não contribuem para a necessidade de compra", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterialA = await createRawMaterial();
    const { product: productA } = await createProductWithFormulation(app, [
      { itemId: rawMaterialA.id, quantity: "10", unitCode: "kg" },
    ]);
    const rawMaterialB = await createRawMaterial();
    await adjustStock(app, rawMaterialB.id, "1000");
    const { product: productB } = await createProductWithFormulation(app, [
      { itemId: rawMaterialB.id, quantity: "5", unitCode: "kg" },
    ]);

    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [
      { productId: productA.id, orderedQuantity: "1" },
      { productId: productB.id, orderedQuantity: "1" },
    ]);
    const applied = await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
      { customerOrderLineId: order.lines[1].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);
    const opA = applied.generatedProductionOrders[0];
    const opB = applied.generatedProductionOrders[1];

    // Cancela a OP A (ainda DRAFT).
    await app.inject({ method: "POST", url: `/production-orders/${opA.id}/cancel`, payload: { reason: "Teste" } });

    // Conclui a OP B (consome, produz e finaliza — Output/Complete exigem
    // IN_PRODUCTION, que só começa no primeiro consumo real confirmado).
    const releasedB = await planAndRelease(app, opB.id);
    await consumeAllLines(app, opB.id, releasedB);
    const outputResponse = await app.inject({
      method: "POST",
      url: `/production-orders/${opB.id}/outputs`,
      payload: { quantity: "1", destination: "NEW_LOT", businessLotNumber: "VD-PS-1" },
    });
    expect(outputResponse.statusCode).toBe(201);
    const completeResponse = await app.inject({
      method: "POST",
      url: `/production-orders/${opB.id}/complete`,
      payload: {},
    });
    expect(completeResponse.statusCode).toBe(200);

    const response = await getSuggestion(app, order.id);
    const body = response.json();
    expect(body.rows.find((r: { itemId: string }) => r.itemId === rawMaterialA.id)).toBeUndefined();
    expect(body.rows.find((r: { itemId: string }) => r.itemId === rawMaterialB.id)).toBeUndefined();
    expect(body.pendingProductionOrders).toHaveLength(0);

    await app.close();
  });

  it("On Order não reduz a falta física, mas reduz a compra adicional sugerida", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createRawMaterial();
    const supplier = await createSupplier();
    const { product } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "100", unitCode: "kg" },
    ]);
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);

    const before = (await getSuggestion(app, order.id)).json();
    const rowBefore = before.rows.find((r: { itemId: string }) => r.itemId === rawMaterial.id);
    expect(rowBefore.operationalShortage).toBe("100");
    expect(rowBefore.suggestedAdditionalPurchase).toBe("100");

    // OC manual confirmada (ORDERED) para o mesmo material — On Order sobe.
    const poCreated = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: supplier.id,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: rawMaterial.id, orderedQuantity: "40" }],
      },
    });
    await app.inject({ method: "POST", url: `/purchase-orders/${poCreated.json().id}/confirm` });

    const after = (await getSuggestion(app, order.id)).json();
    const rowAfter = after.rows.find((r: { itemId: string }) => r.itemId === rawMaterial.id);
    expect(rowAfter.onOrder).toBe("40");
    expect(rowAfter.operationalShortage).toBe("100");
    expect(rowAfter.suggestedAdditionalPurchase).toBe("60");

    await app.close();
  });

  it("matemática crítica: Remaining 100 / Own 30 / Available 20 / On Order 20 / Draft 10 → New Suggested 20", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createRawMaterial();
    const supplier = await createSupplier();
    const { product } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "100", unitCode: "kg" },
    ]);
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    const applied = await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);
    const opId = applied.generatedProductionOrders[0].id;
    await app.inject({ method: "POST", url: `/production-orders/${opId}/plan` });
    const planned = (await app.inject({ method: "GET", url: `/production-orders/${opId}` })).json();
    const requirementId = planned.requirements[0].id;

    // Seed direto: Own Reserved = 30 (isola a matemática da agregação —
    // RELEASE normal sempre cobre 100% do Requirement, nunca uma reserva
    // parcial deliberada como este cenário exige).
    const prisma = getPrisma();
    const reservation = await prisma.materialReservation.create({
      data: { productionOrderId: opId, status: "ACTIVE", createdBy: "Teste" },
    });
    await prisma.materialReservationLine.create({
      data: {
        reservationId: reservation.id,
        productionOrderRequirementId: requirementId,
        itemId: rawMaterial.id,
        quantity: "30",
      },
    });

    // Global Available = 20 — On Hand precisa cobrir a reserva seedada
    // (30) mais o que sobra livre (20): On Hand 50 - Reserved 30 = 20.
    await adjustStock(app, rawMaterial.id, "50");

    // On Order = 20.
    const poOrdered = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: supplier.id,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: rawMaterial.id, orderedQuantity: "20" }],
      },
    });
    await app.inject({ method: "POST", url: `/purchase-orders/${poOrdered.json().id}/confirm` });

    // Draft PO deste Pedido = 10.
    await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: rawMaterial.id, supplierId: supplier.id, quantity: "10" }] },
    });

    const response = await getSuggestion(app, order.id);
    const row = response.json().rows.find((r: { itemId: string }) => r.itemId === rawMaterial.id);
    expect(row.remainingRequired).toBe("100");
    expect(row.ownReserved).toBe("30");
    expect(row.available).toBe("20");
    expect(row.operationalShortage).toBe("50");
    expect(row.onOrder).toBe("20");
    expect(row.draftPurchaseQuantity).toBe("10");
    expect(row.newSuggestedPurchase).toBe("20");

    await app.close();
  });

  it("só disponível para pedido IN_FULFILLMENT", async () => {
    const app = buildTestApp();
    await app.ready();

    const { product } = await createProductWithFormulation(app, [], { withFormulation: false });
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);

    const response = await getSuggestion(app, order.id);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("order_not_in_fulfillment");

    await app.close();
  });
});

describe("Sugestão de Compra — geração de OC DRAFT", () => {
  it("gera OC DRAFT com origin CUSTOMER_ORDER, unitPrice null, nunca ORDERED", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createRawMaterial();
    const supplier = await createSupplier();
    const { product } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);

    const response = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: rawMaterial.id, supplierId: supplier.id, quantity: "15" }] },
    });
    expect(response.statusCode).toBe(201);
    const updatedOrder = response.json();
    expect(updatedOrder.linkedPurchaseOrders).toHaveLength(1);
    expect(updatedOrder.linkedPurchaseOrders[0].status).toBe("DRAFT");

    const poId = updatedOrder.linkedPurchaseOrders[0].id;
    const po = (await app.inject({ method: "GET", url: `/purchase-orders/${poId}` })).json();
    expect(po.origin).toBe("CUSTOMER_ORDER");
    expect(po.customerOrderId).toBe(order.id);
    expect(po.customerOrderCode).toBe(order.code);
    expect(po.status).toBe("DRAFT");
    expect(po.lines).toHaveLength(1);
    expect(po.lines[0].itemId).toBe(rawMaterial.id);
    expect(po.lines[0].unitCode).toBe("kg");
    expect(po.lines[0].orderedQuantity).toBe("15");
    expect(po.lines[0].unitPrice).toBeNull();

    // Pedido continua IN_FULFILLMENT.
    const reloadedOrder = (await app.inject({ method: "GET", url: `/customer-orders/${order.id}` })).json();
    expect(reloadedOrder.status).toBe("IN_FULFILLMENT");

    await app.close();
  });

  it("agrupa por fornecedor: 2 itens mesmo Supplier → 1 OC; Suppliers diferentes → OCs diferentes", async () => {
    const app = buildTestApp();
    await app.ready();

    const itemA = await createRawMaterial();
    const itemB = await createRawMaterial();
    const supplierX = await createSupplier();
    const supplierY = await createSupplier();
    const { product } = await createProductWithFormulation(app, [
      { itemId: itemA.id, quantity: "1", unitCode: "kg" },
    ]);
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);

    const response = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: {
        lines: [
          { itemId: itemA.id, supplierId: supplierX.id, quantity: "5" },
          { itemId: itemB.id, supplierId: supplierX.id, quantity: "3" },
        ],
      },
    });
    expect(response.json().linkedPurchaseOrders).toHaveLength(1);
    expect(response.json().linkedPurchaseOrders[0].lineCount).toBe(2);

    const secondResponse = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: itemA.id, supplierId: supplierY.id, quantity: "2" }] },
    });
    expect(secondResponse.json().linkedPurchaseOrders).toHaveLength(2);

    await app.close();
  });

  it("rejeita fornecedor inativo, item inválido, quantidade 0 não cria linha, tudo zero não cria OC", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createRawMaterial();
    const inactiveSupplier = await createSupplier({ active: false });
    const activeSupplier = await createSupplier();
    const { product, finishedItem } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "1", unitCode: "kg" },
    ]);
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);

    const inactiveSupplierResponse = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: rawMaterial.id, supplierId: inactiveSupplier.id, quantity: "5" }] },
    });
    expect(inactiveSupplierResponse.statusCode).toBe(400);
    expect(inactiveSupplierResponse.json().error).toBe("inactive_supplier");

    // O item acabado deste próprio cenário, não "qualquer produto acabado do
    // banco": este banco é compartilhado com o app local, e escavar registro
    // alheio é o começo de um teste que mexe no que não é dele.
    const invalidItemResponse = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: finishedItem.id, supplierId: activeSupplier.id, quantity: "5" }] },
    });
    expect(invalidItemResponse.statusCode).toBe(400);
    expect(invalidItemResponse.json().error).toBe("invalid_item_type");

    const zeroResponse = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: rawMaterial.id, supplierId: activeSupplier.id, quantity: "0" }] },
    });
    expect(zeroResponse.statusCode).toBe(400);
    expect(zeroResponse.json().error).toBe("empty_purchase_drafts");

    await app.close();
  });

  it("rejeita geração para pedido que não está em atendimento", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createRawMaterial();
    const supplier = await createSupplier();
    const { product } = await createProductWithFormulation(app, [], { withFormulation: false });
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);

    const response = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: rawMaterial.id, supplierId: supplier.id, quantity: "5" }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("order_not_in_fulfillment");

    await app.close();
  });
});

describe("Sugestão de Compra — ciclo de vida do rascunho", () => {
  it("gerar Draft aumenta draftPurchaseQuantity; confirmar a OC zera Draft e sobe On Order", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createRawMaterial();
    const supplier = await createSupplier();
    const { product } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "50", unitCode: "kg" },
    ]);
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);

    const generated = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: rawMaterial.id, supplierId: supplier.id, quantity: "50" }] },
    });
    const poId = generated.json().linkedPurchaseOrders[0].id;

    const afterDraft = (await getSuggestion(app, order.id)).json();
    const rowAfterDraft = afterDraft.rows.find((r: { itemId: string }) => r.itemId === rawMaterial.id);
    expect(rowAfterDraft.draftPurchaseQuantity).toBe("50");
    expect(rowAfterDraft.onOrder).toBe("0");
    expect(rowAfterDraft.newSuggestedPurchase).toBe("0");

    await app.inject({ method: "POST", url: `/purchase-orders/${poId}/confirm` });

    const afterConfirm = (await getSuggestion(app, order.id)).json();
    const rowAfterConfirm = afterConfirm.rows.find((r: { itemId: string }) => r.itemId === rawMaterial.id);
    expect(rowAfterConfirm.draftPurchaseQuantity).toBe("0");
    expect(rowAfterConfirm.onOrder).toBe("50");

    await app.close();
  });

  it("cancelar a OC vinculada devolve a necessidade de compra (deixa de contar Draft e On Order)", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = await createRawMaterial();
    const supplier = await createSupplier();
    const { product } = await createProductWithFormulation(app, [
      { itemId: rawMaterial.id, quantity: "30", unitCode: "kg" },
    ]);
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);

    const generated = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/purchase-drafts`,
      payload: { lines: [{ itemId: rawMaterial.id, supplierId: supplier.id, quantity: "30" }] },
    });
    const poId = generated.json().linkedPurchaseOrders[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${poId}/cancel`,
      payload: { reason: "Teste de cancelamento" },
    });

    const after = (await getSuggestion(app, order.id)).json();
    const row = after.rows.find((r: { itemId: string }) => r.itemId === rawMaterial.id);
    expect(row.draftPurchaseQuantity).toBe("0");
    expect(row.onOrder).toBe("0");
    expect(row.newSuggestedPurchase).toBe("30");

    await app.close();
  });
});

describe("Sugestão de Compra — concorrência", () => {
  it("duas gerações simultâneas não corrompem dados (lock no CustomerOrder)", async () => {
    const app = buildTestApp();
    await app.ready();

    const itemA = await createRawMaterial();
    const itemB = await createRawMaterial();
    const supplier = await createSupplier();
    const { product } = await createProductWithFormulation(app, [
      { itemId: itemA.id, quantity: "1", unitCode: "kg" },
    ]);
    const customer = await createCustomer();
    const order = await createConfirmedOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "1" }]);
    await applyPlan(app, order.id, [
      { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" },
    ]);

    const [responseA, responseB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/customer-orders/${order.id}/purchase-drafts`,
        payload: { lines: [{ itemId: itemA.id, supplierId: supplier.id, quantity: "10" }] },
      }),
      app.inject({
        method: "POST",
        url: `/customer-orders/${order.id}/purchase-drafts`,
        payload: { lines: [{ itemId: itemB.id, supplierId: supplier.id, quantity: "20" }] },
      }),
    ]);

    expect(responseA.statusCode).toBe(201);
    expect(responseB.statusCode).toBe(201);

    const final = (await app.inject({ method: "GET", url: `/customer-orders/${order.id}` })).json();
    expect(final.linkedPurchaseOrders).toHaveLength(2);
    const totalLines = final.linkedPurchaseOrders.reduce((sum: number, po: { lineCount: number }) => sum + po.lineCount, 0);
    expect(totalLines).toBe(2);

    await app.close();
  });
});
