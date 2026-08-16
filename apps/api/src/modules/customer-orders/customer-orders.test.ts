import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
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
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createCustomer(overrides: { active?: boolean } = {}) {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: {
      code: `CLI-CO-${m}`,
      legalName: `Cliente Pedido Teste ${m}`,
      active: overrides.active ?? true,
    },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createFinishedItem(overrides: { active?: boolean } = {}) {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-CO-${m}`,
      name: `Item Pedido Teste ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: overrides.active ?? true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createProduct(
  app: App,
  overrides: { finishedItemId?: string | null; active?: boolean } = {},
) {
  const finishedItem = overrides.finishedItemId === undefined ? await createFinishedItem() : null;
  const finishedProductItemId = overrides.finishedItemId === undefined ? finishedItem!.id : overrides.finishedItemId;

  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      name: `Produto Pedido Teste ${marker()}`,
      ...(finishedProductItemId ? { finishedProductItemId } : {}),
    },
  });
  const product = response.json();
  fixtureProductIds.push(product.id);

  if (overrides.active === false) {
    await app.inject({ method: "POST", url: `/products/${product.id}/deactivate` });
    const refreshed = await app.inject({ method: "GET", url: `/products/${product.id}` });
    return refreshed.json();
  }
  return product;
}

async function createDraftOrder(
  app: App,
  customerId: string,
  lines: { productId: string; orderedQuantity: string }[] = [],
) {
  const response = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: { customerId, lines },
  });
  fixtureCustomerOrderIds.push(response.json().id);
  return response.json();
}

describe("CustomerOrder — CRUD e transições", () => {
  it("cria DRAFT e gera código PED-000001 sequencial", async () => {
    const app = buildApp();
    await app.ready();

    const customer = await createCustomer();
    const order = await createDraftOrder(app, customer.id);
    expect(order.status).toBe("DRAFT");
    expect(order.code).toMatch(/^PED-\d{6}$/);

    await app.close();
  });

  it("cliente obrigatório e precisa estar ativo", async () => {
    const app = buildApp();
    await app.ready();

    const missing = await app.inject({ method: "POST", url: "/customer-orders", payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("validation_error");

    const inactiveCustomer = await createCustomer({ active: false });
    const response = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: inactiveCustomer.id },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("inactive_customer");

    await app.close();
  });

  it("linha exige Product ativo com Finished Product Item válido e quantidade > 0", async () => {
    const app = buildApp();
    await app.ready();

    const customer = await createCustomer();
    const productWithoutFinishedItem = await createProduct(app, { finishedItemId: null });
    const inactiveProduct = await createProduct(app, { active: false });
    const validProduct = await createProduct(app);

    const missingFinishedItem = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: customer.id,
        lines: [{ productId: productWithoutFinishedItem.id, orderedQuantity: "10" }],
      },
    });
    expect(missingFinishedItem.statusCode).toBe(400);
    expect(missingFinishedItem.json().error).toBe("missing_finished_item");

    const inactive = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: customer.id, lines: [{ productId: inactiveProduct.id, orderedQuantity: "10" }] },
    });
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json().error).toBe("inactive_product");

    const zeroQuantity = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: customer.id, lines: [{ productId: validProduct.id, orderedQuantity: "0" }] },
    });
    expect(zeroQuantity.statusCode).toBe(400);
    expect(zeroQuantity.json().error).toBe("validation_error");

    await app.close();
  });

  it("não permite o mesmo Product duas vezes no mesmo pedido", async () => {
    const app = buildApp();
    await app.ready();

    const customer = await createCustomer();
    const product = await createProduct(app);

    const response = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: customer.id,
        lines: [
          { productId: product.id, orderedQuantity: "10" },
          { productId: product.id, orderedQuantity: "5" },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("duplicate_product");

    await app.close();
  });

  it("DRAFT é livremente editável (cliente, linhas, observações)", async () => {
    const app = buildApp();
    await app.ready();

    const customer = await createCustomer();
    const otherCustomer = await createCustomer();
    const productA = await createProduct(app);
    const productB = await createProduct(app);
    const order = await createDraftOrder(app, customer.id, [{ productId: productA.id, orderedQuantity: "10" }]);

    const updated = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${order.id}`,
      payload: {
        customerId: otherCustomer.id,
        notes: "Observação atualizada",
        lines: [{ productId: productB.id, orderedQuantity: "20" }],
      },
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json();
    expect(body.customerId).toBe(otherCustomer.id);
    expect(body.notes).toBe("Observação atualizada");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].productId).toBe(productB.id);
    expect(body.lines[0].orderedQuantity).toBe("20");

    await app.close();
  });

  it("confirmação exige ao menos uma linha; DRAFT -> CONFIRMED congela snapshot", async () => {
    const app = buildApp();
    await app.ready();

    const customer = await createCustomer();
    const product = await createProduct(app);
    const empty = await createDraftOrder(app, customer.id);

    const emptyConfirm = await app.inject({ method: "POST", url: `/customer-orders/${empty.id}/confirm` });
    expect(emptyConfirm.statusCode).toBe(400);
    expect(emptyConfirm.json().error).toBe("empty_order");

    const order = await createDraftOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "10" }]);
    const confirmed = await app.inject({ method: "POST", url: `/customer-orders/${order.id}/confirm` });
    expect(confirmed.statusCode).toBe(200);
    const body = confirmed.json();
    expect(body.status).toBe("CONFIRMED");
    expect(body.confirmedAt).not.toBeNull();
    expect(body.customerCode).toBe(customer.code);
    expect(body.lines[0].productCode).toBe(product.code);
    expect(body.lines[0].finishedItemId).not.toBeNull();

    await app.close();
  });

  it("CONFIRMED congela produtos/quantidades — só previsão de entrega e observações continuam editáveis", async () => {
    const app = buildApp();
    await app.ready();

    const customer = await createCustomer();
    const product = await createProduct(app);
    const order = await createDraftOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "10" }]);
    await app.inject({ method: "POST", url: `/customer-orders/${order.id}/confirm` });

    const blockedLines = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${order.id}`,
      payload: { lines: [{ productId: product.id, orderedQuantity: "99" }] },
    });
    expect(blockedLines.statusCode).toBe(400);
    expect(blockedLines.json().error).toBe("order_locked");

    const allowedNotes = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${order.id}`,
      payload: { notes: "Ainda pode mudar" },
    });
    expect(allowedNotes.statusCode).toBe(200);
    expect(allowedNotes.json().notes).toBe("Ainda pode mudar");

    await app.close();
  });

  it("snapshot preservado mesmo após inativar Customer/Product depois da confirmação", async () => {
    const app = buildApp();
    await app.ready();

    const customer = await createCustomer();
    const product = await createProduct(app);
    const order = await createDraftOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "10" }]);
    await app.inject({ method: "POST", url: `/customer-orders/${order.id}/confirm` });

    await getPrisma().customer.update({ where: { id: customer.id }, data: { active: false } });
    await app.inject({ method: "POST", url: `/products/${product.id}/deactivate` });

    const reloaded = await app.inject({ method: "GET", url: `/customer-orders/${order.id}` });
    expect(reloaded.statusCode).toBe(200);
    const body = reloaded.json();
    expect(body.customerCode).toBe(customer.code);
    expect(body.lines[0].productCode).toBe(product.code);

    await app.close();
  });

  it("cancelamento exige motivo; DRAFT e CONFIRMED (sem plano aplicado) podem cancelar", async () => {
    const app = buildApp();
    await app.ready();

    const customer = await createCustomer();
    const product = await createProduct(app);
    const draft = await createDraftOrder(app, customer.id, [{ productId: product.id, orderedQuantity: "10" }]);

    const withoutReason = await app.inject({
      method: "POST",
      url: `/customer-orders/${draft.id}/cancel`,
      payload: {},
    });
    expect(withoutReason.statusCode).toBe(400);

    const cancelled = await app.inject({
      method: "POST",
      url: `/customer-orders/${draft.id}/cancel`,
      payload: { reason: "Cliente desistiu" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    expect(cancelled.json().cancelReason).toBe("Cliente desistiu");

    const confirmedOrder = await createDraftOrder(app, customer.id, [
      { productId: product.id, orderedQuantity: "10" },
    ]);
    await app.inject({ method: "POST", url: `/customer-orders/${confirmedOrder.id}/confirm` });
    const cancelConfirmed = await app.inject({
      method: "POST",
      url: `/customer-orders/${confirmedOrder.id}/cancel`,
      payload: { reason: "Revisão comercial" },
    });
    expect(cancelConfirmed.statusCode).toBe(200);
    expect(cancelConfirmed.json().status).toBe("CANCELLED");

    await app.close();
  });
});
