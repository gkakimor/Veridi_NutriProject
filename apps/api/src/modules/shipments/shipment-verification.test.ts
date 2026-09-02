import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotStatus, UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
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
    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
    await prisma.productionOrder.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
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
    data: { code: `CLI-CONF-${m}`, legalName: `Cliente Conferência ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createItem(type: "FINISHED_PRODUCT" | "RAW_MATERIAL", controlsExpiry = false) {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "FINISHED_PRODUCT" ? "PA" : "ME"}-CONF-${m}`,
      name: `Item Conferência ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function stockLot(
  itemId: string,
  quantity: string,
  overrides: { expiryDate?: Date; status?: LotStatus } = {},
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-CONF-${marker()}`.toUpperCase(),
      origin: "RECEIPT",
      itemId,
      initialReceivedQuantity: quantity,
      status: overrides.status ?? "AVAILABLE",
      ...(overrides.expiryDate ? { expiryDate: overrides.expiryDate } : {}),
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
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId: await fixtureCustomerId(), name: `Produto Conferência ${marker()}`, finishedProductItemId: finishedItemId },
    })
  ).json();
  fixtureProductIds.push(product.id);
  return product;
}

/** Pedido CONFIRMED + Plano aplicado, com uma ou várias linhas de produto. */
async function createOrder(
  app: App,
  lines: { productId: string; orderedQuantity: string; reserveQuantity: string }[],
) {
  const customer = await createCustomer();
  const created = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: customer.id,
        lines: lines.map((line) => ({
          productId: line.productId,
          orderedQuantity: line.orderedQuantity,
        })),
      },
    })
  ).json();
  fixtureCustomerOrderIds.push(created.id);

  const confirmed = (
    await app.inject({ method: "POST", url: `/customer-orders/${created.id}/confirm` })
  ).json();
  const orderLineByProduct = new Map(
    confirmed.lines.map((line: { id: string; productId: string }) => [line.productId, line.id]),
  );

  await app.inject({
    method: "POST",
    url: `/customer-orders/${created.id}/apply-fulfillment-plan`,
    payload: {
      lines: lines.map((line) => ({
        customerOrderLineId: orderLineByProduct.get(line.productId),
        reserveQuantity: line.reserveQuantity,
        produceQuantity: (Number(line.orderedQuantity) - Number(line.reserveQuantity)).toString(),
      })),
    },
  });

  return created.id as string;
}

async function prepareShipment(app: App, orderId: string) {
  return (await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })).json();
}

async function getShipment(app: App, shipmentId: string) {
  return (await app.inject({ method: "GET", url: `/shipments/${shipmentId}` })).json();
}

async function verifyLine(app: App, shipmentId: string, lineId: string, lotCode: string) {
  return app.inject({
    method: "POST",
    url: `/shipments/${shipmentId}/lines/${lineId}/verify`,
    payload: { lotCode },
  });
}

async function confirmShipment(app: App, shipmentId: string) {
  return app.inject({ method: "POST", url: `/shipments/${shipmentId}/confirm` });
}

async function getInventory(app: App, itemId: string) {
  return (await app.inject({ method: "GET", url: `/inventory/${itemId}` })).json();
}

async function getOrder(app: App, orderId: string) {
  return (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json();
}

describe("Conferência de lote — identidade", () => {
  it("aceita o lote reservado, grava a auditoria e não movimenta estoque", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const lot = await stockLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const orderId = await createOrder(app, [
      { productId: product.id, orderedQuantity: "400", reserveQuantity: "400" },
    ]);
    const draft = await prepareShipment(app, orderId);

    const before = await getInventory(app, finishedItem.id);
    expect(before.onHand).toBe("1000");
    expect(before.reserved).toBe("400");
    expect(before.available).toBe("600");

    const line = draft.lines[0];
    expect(line.requiresVerification).toBe(true);
    expect(line.verifiedAt).toBeNull();

    const response = await verifyLine(app, draft.id, line.id, lot.code);
    expect(response.statusCode).toBe(200);
    const verified = response.json();
    expect(verified.lines[0].verifiedAt).not.toBeNull();
    expect(verified.lines[0].verifiedBy).not.toBeNull();
    expect(verified.verification).toEqual({
      productCount: 1,
      lotsRequired: 1,
      lotsVerified: 1,
      allLotsVerified: true,
    });

    // Conferir é auditoria: nada saiu, nada mudou de saldo.
    const after = await getInventory(app, finishedItem.id);
    expect(after.onHand).toBe("1000");
    expect(after.reserved).toBe("400");
    expect(after.available).toBe("600");

    const movements = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` })
    ).json();
    expect(movements.movements.filter((m: { type: string }) => m.type === "SHIPMENT_OUT")).toHaveLength(0);

    // Um scan por LOTE, nunca por unidade: 400 unidades = 1 conferência.
    expect(verified.lines[0].quantity).toBe("400");

    await app.close();
  });

  it("aceita o código puro e o payload de QR (LOT:<code>) — mesmo padrão do lote", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const lot = await stockLot(finishedItem.id, "600");
    const product = await createProduct(app, finishedItem.id);

    const orderA = await createOrder(app, [
      { productId: product.id, orderedQuantity: "100", reserveQuantity: "100" },
    ]);
    const draftA = await prepareShipment(app, orderA);
    const pure = await verifyLine(app, draftA.id, draftA.lines[0].id, lot.code);
    expect(pure.statusCode).toBe(200);

    const orderB = await createOrder(app, [
      { productId: product.id, orderedQuantity: "100", reserveQuantity: "100" },
    ]);
    const draftB = await prepareShipment(app, orderB);
    const payload = await verifyLine(app, draftB.id, draftB.lines[0].id, `LOT:${lot.code}`);
    expect(payload.statusCode).toBe(200);

    // O QR do lote existente já é exatamente esse payload.
    const lotDetail = (await app.inject({ method: "GET", url: `/lots/${lot.id}` })).json();
    expect(lotDetail.qrPayload).toBe(`LOT:${lot.code}`);

    await app.close();
  });

  it("recusa lote de outro produto acabado e lote de componente da OP", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const lot = await stockLot(finishedItem.id, "500");
    const product = await createProduct(app, finishedItem.id);

    // Outro produto acabado, com lote próprio.
    const otherFinishedItem = await createItem("FINISHED_PRODUCT");
    const otherLot = await stockLot(otherFinishedItem.id, "500");
    // Componente que poderia ter alimentado a OP — genealogia não torna um
    // lote de matéria-prima expedível.
    const componentItem = await createItem("RAW_MATERIAL");
    const componentLot = await stockLot(componentItem.id, "500");

    const orderId = await createOrder(app, [
      { productId: product.id, orderedQuantity: "200", reserveQuantity: "200" },
    ]);
    const draft = await prepareShipment(app, orderId);
    const lineId = draft.lines[0].id;

    const wrongProduct = await verifyLine(app, draft.id, lineId, otherLot.code);
    expect(wrongProduct.statusCode).toBe(400);
    expect(wrongProduct.json().error).toBe("lot_mismatch");
    expect(wrongProduct.json().message).toContain(lot.code);
    expect(wrongProduct.json().message).toContain(otherLot.code);

    const component = await verifyLine(app, draft.id, lineId, componentLot.code);
    expect(component.statusCode).toBe(400);
    expect(component.json().error).toBe("lot_mismatch");

    const unknown = await verifyLine(app, draft.id, lineId, "LT-NAO-EXISTE-000001");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toBe("lot_not_found");

    // Nenhuma substituição silenciosa: a linha continua apontando para o
    // lote reservado e sem conferência.
    const after = await getShipment(app, draft.id);
    expect(after.lines[0].lotCode).toBe(lot.code);
    expect(after.lines[0].verifiedAt).toBeNull();

    await app.close();
  });

  it("recusa linha de outra expedição e lote bloqueado, aguardando Qualidade ou vencido", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const finishedItem = await createItem("FINISHED_PRODUCT", true);
    const lot = await stockLot(finishedItem.id, "800", {
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const product = await createProduct(app, finishedItem.id);

    const orderA = await createOrder(app, [
      { productId: product.id, orderedQuantity: "200", reserveQuantity: "200" },
    ]);
    const draftA = await prepareShipment(app, orderA);
    const orderB = await createOrder(app, [
      { productId: product.id, orderedQuantity: "200", reserveQuantity: "200" },
    ]);
    const draftB = await prepareShipment(app, orderB);

    // Linha existe, mas pertence a outra Expedição/outro Pedido.
    const foreignLine = await verifyLine(app, draftA.id, draftB.lines[0].id, lot.code);
    expect(foreignLine.statusCode).toBe(404);

    await prisma.lot.update({ where: { id: lot.id }, data: { status: "BLOCKED" } });
    const blocked = await verifyLine(app, draftA.id, draftA.lines[0].id, lot.code);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe("lot_not_shippable");

    await prisma.lot.update({ where: { id: lot.id }, data: { status: "AWAITING_RELEASE" } });
    const awaiting = await verifyLine(app, draftA.id, draftA.lines[0].id, lot.code);
    expect(awaiting.statusCode).toBe(400);
    expect(awaiting.json().error).toBe("lot_not_shippable");

    await prisma.lot.update({
      where: { id: lot.id },
      data: { status: "AVAILABLE", expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const expired = await verifyLine(app, draftA.id, draftA.lines[0].id, lot.code);
    expect(expired.statusCode).toBe(400);
    expect(expired.json().error).toBe("lot_not_shippable");

    await app.close();
  });
});

describe("Conferência de lote — confirmação da expedição", () => {
  it("bloqueia a confirmação sem conferência e libera depois dela", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const lot = await stockLot(finishedItem.id, "500");
    const product = await createProduct(app, finishedItem.id);
    const orderId = await createOrder(app, [
      { productId: product.id, orderedQuantity: "500", reserveQuantity: "500" },
    ]);
    const draft = await prepareShipment(app, orderId);

    const blocked = await confirmShipment(app, draft.id);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe("unverified_shipment_lines");
    expect(blocked.json().message).toBe("Existem lotes ainda não conferidos nesta expedição.");

    // Nada saiu do estoque na tentativa recusada.
    const stillIntact = await getInventory(app, finishedItem.id);
    expect(stillIntact.onHand).toBe("500");

    await verifyLine(app, draft.id, draft.lines[0].id, lot.code);
    const confirmed = await confirmShipment(app, draft.id);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("CONFIRMED");

    // Exatamente 1 SHIPMENT_OUT por ShipmentLine, só na confirmação.
    const movements = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` })
    ).json();
    const out = movements.movements.filter((m: { type: string }) => m.type === "SHIPMENT_OUT");
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe("500");

    // Histórico read-only mantém quem conferiu e quando.
    const final = await getShipment(app, draft.id);
    expect(final.lines[0].verifiedAt).not.toBeNull();
    expect(final.lines[0].verifiedBy).not.toBeNull();
    const reverify = await verifyLine(app, draft.id, final.lines[0].id, lot.code);
    expect(reverify.statusCode).toBe(400);
    expect(reverify.json().error).toBe("shipment_not_draft");

    await app.close();
  });

  it("exige conferência de TODOS os lotes do mesmo produto", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT", true);
    const lotA = await stockLot(finishedItem.id, "300", {
      expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    const lotB = await stockLot(finishedItem.id, "200", {
      expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });
    const product = await createProduct(app, finishedItem.id);
    const orderId = await createOrder(app, [
      { productId: product.id, orderedQuantity: "500", reserveQuantity: "500" },
    ]);
    const draft = await prepareShipment(app, orderId);
    expect(draft.lines).toHaveLength(2);
    expect(draft.verification.lotsRequired).toBe(2);

    const lineA = draft.lines.find((line: { lotId: string }) => line.lotId === lotA.id);
    const lineB = draft.lines.find((line: { lotId: string }) => line.lotId === lotB.id);

    const partial = (await verifyLine(app, draft.id, lineA.id, lotA.code)).json();
    expect(partial.verification.lotsVerified).toBe(1);
    expect(partial.verification.allLotsVerified).toBe(false);
    expect(partial.products[0].status).toBe("PARTIAL");

    const blocked = await confirmShipment(app, draft.id);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe("unverified_shipment_lines");

    // Dois lotes = duas conferências, nunca 500 leituras.
    const complete = (await verifyLine(app, draft.id, lineB.id, lotB.code)).json();
    expect(complete.verification).toEqual({
      productCount: 1,
      lotsRequired: 2,
      lotsVerified: 2,
      allLotsVerified: true,
    });
    expect(complete.products[0].status).toBe("VERIFIED");

    expect((await confirmShipment(app, draft.id)).statusCode).toBe(200);

    await app.close();
  });

  it("mantém a conferência ao salvar a separação de novo", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const lot = await stockLot(finishedItem.id, "500");
    const product = await createProduct(app, finishedItem.id);
    const orderId = await createOrder(app, [
      { productId: product.id, orderedQuantity: "500", reserveQuantity: "500" },
    ]);
    const draft = await prepareShipment(app, orderId);
    await verifyLine(app, draft.id, draft.lines[0].id, lot.code);

    // O operador ajusta a quantidade depois de conferir o lote: a
    // identificação física continua valendo — quantidade é outro conceito.
    const updated = (
      await app.inject({
        method: "PATCH",
        url: `/shipments/${draft.id}`,
        payload: {
          lines: [
            {
              customerOrderReservationLineId: draft.lines[0].customerOrderReservationLineId,
              quantity: "300",
            },
          ],
        },
      })
    ).json();
    expect(updated.lines[0].quantity).toBe("300");
    expect(updated.lines[0].verifiedAt).not.toBeNull();
    expect(updated.verification.allLotsVerified).toBe(true);

    expect((await confirmShipment(app, draft.id)).statusCode).toBe(200);

    await app.close();
  });
});

describe("Conferência de lote — pedido com vários produtos", () => {
  it("expede A total, B parcial e C nenhum: pedido segue PARTIALLY_SHIPPED", async () => {
    const app = buildTestApp();
    await app.ready();

    const itemA = await createItem("FINISHED_PRODUCT");
    const itemB = await createItem("FINISHED_PRODUCT");
    const itemC = await createItem("FINISHED_PRODUCT");
    const lotA = await stockLot(itemA.id, "500");
    const lotB = await stockLot(itemB.id, "200");
    const productA = await createProduct(app, itemA.id);
    const productB = await createProduct(app, itemB.id);
    const productC = await createProduct(app, itemC.id);

    const orderId = await createOrder(app, [
      { productId: productA.id, orderedQuantity: "500", reserveQuantity: "500" },
      { productId: productB.id, orderedQuantity: "300", reserveQuantity: "200" },
      // Produto C não tem estoque: entra no pedido só como produção.
      { productId: productC.id, orderedQuantity: "200", reserveQuantity: "0" },
    ]);

    const draft = await prepareShipment(app, orderId);
    expect(draft.lines).toHaveLength(2);
    // Todos os produtos do Pedido aparecem — inclusive o que ainda não tem
    // reserva, para o operador não achar que o pedido está completo.
    expect(draft.products).toHaveLength(3);

    const groupC = draft.products.find(
      (group: { productId: string }) => group.productId === productC.id,
    );
    expect(groupC.shippingNow).toBe("0");
    expect(groupC.lotsRequired).toBe(0);
    expect(groupC.status).toBe("PENDING");
    expect(groupC.outstandingQuantity).toBe("200");

    const lineA = draft.lines.find((line: { lotId: string }) => line.lotId === lotA.id);
    const lineB = draft.lines.find((line: { lotId: string }) => line.lotId === lotB.id);
    await verifyLine(app, draft.id, lineA.id, lotA.code);
    await verifyLine(app, draft.id, lineB.id, lotB.code);

    const ready = await getShipment(app, draft.id);
    expect(ready.verification.productCount).toBe(2);
    expect(ready.verification.lotsRequired).toBe(2);
    expect(ready.verification.lotsVerified).toBe(2);

    expect((await confirmShipment(app, draft.id)).statusCode).toBe(200);

    const order = await getOrder(app, orderId);
    expect(order.status).toBe("PARTIALLY_SHIPPED");
    const shippedByProduct = new Map(
      order.lines.map((line: { productId: string; shippedQuantity: string }) => [
        line.productId,
        line.shippedQuantity,
      ]),
    );
    expect(shippedByProduct.get(productA.id)).toBe("500");
    expect(shippedByProduct.get(productB.id)).toBe("200");
    expect(shippedByProduct.get(productC.id)).toBe("0");

    await app.close();
  });
});

describe("Conferência de lote — mesmo lote em pedidos diferentes", () => {
  it("LT-A com 1000: PED-A reserva 300, PED-B reserva 500, EXP-A expede 200", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const lot = await stockLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);

    const orderA = await createOrder(app, [
      { productId: product.id, orderedQuantity: "300", reserveQuantity: "300" },
    ]);
    const orderB = await createOrder(app, [
      { productId: product.id, orderedQuantity: "500", reserveQuantity: "500" },
    ]);

    // O mesmo lote atende dois clientes: o contexto comercial vem da
    // Expedição, nunca do lote.
    const before = await getInventory(app, finishedItem.id);
    expect(before.onHand).toBe("1000");
    expect(before.reserved).toBe("800");
    expect(before.available).toBe("200");

    const draftA = await prepareShipment(app, orderA);
    await app.inject({
      method: "PATCH",
      url: `/shipments/${draftA.id}`,
      payload: {
        lines: [
          {
            customerOrderReservationLineId: draftA.lines[0].customerOrderReservationLineId,
            quantity: "200",
          },
        ],
      },
    });
    const updatedA = await getShipment(app, draftA.id);
    await verifyLine(app, draftA.id, updatedA.lines[0].id, lot.code);
    expect((await confirmShipment(app, draftA.id)).statusCode).toBe(200);

    const after = await getInventory(app, finishedItem.id);
    expect(after.onHand).toBe("800");
    expect(after.reserved).toBe("600");
    expect(after.available).toBe("200");

    const orderADetail = await getOrder(app, orderA);
    expect(orderADetail.reservation.lines[0].reservedRemaining).toBe("100");
    const orderBDetail = await getOrder(app, orderB);
    expect(orderBDetail.reservation.lines[0].reservedRemaining).toBe("500");

    // EXP-B continua podendo conferir exatamente o MESMO lote depois.
    const draftB = await prepareShipment(app, orderB);
    const verifiedB = await verifyLine(app, draftB.id, draftB.lines[0].id, `LOT:${lot.code}`);
    expect(verifiedB.statusCode).toBe(200);

    await app.close();
  });
});
