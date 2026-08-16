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
    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });

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
    await prisma.lot.deleteMany({
      where: { productionOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.productionOrder.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });

    // Linhas realocadas apontam para a original via replacesLineId — apaga
    // as novas primeiro para nao violar o FK.
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
    data: { code: `CLI-EXP-${m}`, legalName: `Cliente Expedição Teste ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createFinishedItem(overrides: { controlsExpiry?: boolean } = {}) {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-EXP-${m}`,
      name: `Produto Acabado Teste ${m}`,
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

/** Lote de produto acabado com saldo, criado direto (isola do fluxo de OP). */
async function stockFinishedLot(
  itemId: string,
  quantity: string,
  overrides: { expiryDate?: Date | null; status?: LotStatus } = {},
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-EXP-${marker()}`.toUpperCase(),
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

async function createProduct(app: App, finishedItemId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto Expedição Teste ${marker()}`, finishedProductItemId: finishedItemId },
  });
  const product = response.json();
  fixtureProductIds.push(product.id);
  return product;
}

/** Pedido CONFIRMED + Plano aplicado (reserva `reserveQuantity`, produz o resto) -> IN_FULFILLMENT. */
async function createOrderInFulfillment(
  app: App,
  productId: string,
  orderedQuantity: string,
  reserveQuantity: string,
) {
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

  const produce = (Number(orderedQuantity) - Number(reserveQuantity)).toString();
  const applied = await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
    payload: {
      lines: [{ customerOrderLineId: lineId, reserveQuantity, produceQuantity: produce }],
    },
  });
  return applied.json();
}

async function getOrder(app: App, id: string) {
  return (await app.inject({ method: "GET", url: `/customer-orders/${id}` })).json();
}

async function getInventory(app: App, itemId: string) {
  return (await app.inject({ method: "GET", url: `/inventory/${itemId}` })).json();
}

async function prepareShipment(app: App, orderId: string) {
  return app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` });
}

async function setShipmentLines(
  app: App,
  shipmentId: string,
  lines: { customerOrderReservationLineId: string; quantity: string }[],
) {
  return app.inject({ method: "PATCH", url: `/shipments/${shipmentId}`, payload: { lines } });
}

describe("Expedição — rascunho (separação)", () => {
  it("gera EXP-000001, não altera On Hand nem Reserved, permite uma única DRAFT por pedido", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "600", "600");

    const before = await getInventory(app, finishedItem.id);
    expect(before.onHand).toBe("1000");
    expect(before.reserved).toBe("600");
    expect(before.available).toBe("400");

    const draft = await prepareShipment(app, order.id);
    expect(draft.statusCode).toBe(201);
    expect(draft.json().code).toMatch(/^EXP-\d{6}$/);
    expect(draft.json().status).toBe("DRAFT");
    expect(draft.json().totalQuantity).toBe("600");

    // DRAFT nunca é realidade física.
    const after = await getInventory(app, finishedItem.id);
    expect(after.onHand).toBe("1000");
    expect(after.reserved).toBe("600");
    expect(after.available).toBe("400");
    expect((await getOrder(app, order.id)).status).toBe("IN_FULFILLMENT");

    const second = await prepareShipment(app, order.id);
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("draft_shipment_exists");

    await app.close();
  });

  it("não permite quantidade acima do reservado disponível", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "600", "600");
    const draft = (await prepareShipment(app, order.id)).json();
    const reservationLineId = draft.lines[0].customerOrderReservationLineId;

    const response = await setShipmentLines(app, draft.id, [
      { customerOrderReservationLineId: reservationLineId, quantity: "700" },
    ]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("exceeds_reserved_remaining");

    await app.close();
  });

  it("cancelar DRAFT exige motivo e não altera estoque; permite criar outra depois", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "600", "600");
    const draft = (await prepareShipment(app, order.id)).json();

    const withoutReason = await app.inject({
      method: "POST",
      url: `/shipments/${draft.id}/cancel`,
      payload: {},
    });
    expect(withoutReason.statusCode).toBe(400);

    const cancelled = await app.inject({
      method: "POST",
      url: `/shipments/${draft.id}/cancel`,
      payload: { reason: "Separação refeita" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");

    const inventory = await getInventory(app, finishedItem.id);
    expect(inventory.onHand).toBe("1000");
    expect(inventory.reserved).toBe("600");

    const another = await prepareShipment(app, order.id);
    expect(another.statusCode).toBe(201);

    await app.close();
  });
});

describe("Expedição — confirmação", () => {
  it("MATEMÁTICA CRÍTICA: On Hand 1000/Reserved 600 → expede 200 → 800/400/400 → expede 400 → 400/0/400", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "600", "600");

    const initial = await getInventory(app, finishedItem.id);
    expect(initial.onHand).toBe("1000");
    expect(initial.reserved).toBe("600");
    expect(initial.available).toBe("400");

    // Expedição 1: 200.
    const draft1 = (await prepareShipment(app, order.id)).json();
    const reservationLineId = draft1.lines[0].customerOrderReservationLineId;
    await setShipmentLines(app, draft1.id, [
      { customerOrderReservationLineId: reservationLineId, quantity: "200" },
    ]);
    const confirmed1 = await app.inject({ method: "POST", url: `/shipments/${draft1.id}/confirm` });
    expect(confirmed1.statusCode).toBe(200);
    expect(confirmed1.json().status).toBe("CONFIRMED");

    const after1 = await getInventory(app, finishedItem.id);
    expect(after1.onHand).toBe("800");
    expect(after1.reserved).toBe("400");
    expect(after1.available).toBe("400");

    // Expedição 2: os 400 restantes.
    const draft2 = (await prepareShipment(app, order.id)).json();
    expect(draft2.totalQuantity).toBe("400");
    const confirmed2 = await app.inject({ method: "POST", url: `/shipments/${draft2.id}/confirm` });
    expect(confirmed2.statusCode).toBe(200);

    const after2 = await getInventory(app, finishedItem.id);
    expect(after2.onHand).toBe("400");
    expect(after2.reserved).toBe("0");
    expect(after2.available).toBe("400");

    await app.close();
  });

  it("cria exatamente 1 SHIPMENT_OUT por linha, identificável pela Expedição de origem", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "500");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "500", "500");

    const draft = (await prepareShipment(app, order.id)).json();
    const confirmed = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
    expect(confirmed.statusCode).toBe(200);

    const movements = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` })
    ).json();
    const shipmentMovements = movements.movements.filter(
      (m: { type: string }) => m.type === "SHIPMENT_OUT",
    );
    expect(shipmentMovements).toHaveLength(1);
    expect(shipmentMovements[0].quantity).toBe("500");
    expect(shipmentMovements[0].shipmentCode).toBe(draft.code);
    expect(shipmentMovements[0].sourceType).toBe("SHIPMENT");

    await app.close();
  });

  it("expedição parcial deixa PARTIALLY_SHIPPED; a segunda completa e vira SHIPPED", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const draft1 = (await prepareShipment(app, order.id)).json();
    const reservationLineId = draft1.lines[0].customerOrderReservationLineId;
    await setShipmentLines(app, draft1.id, [
      { customerOrderReservationLineId: reservationLineId, quantity: "400" },
    ]);
    await app.inject({ method: "POST", url: `/shipments/${draft1.id}/confirm` });

    const partial = await getOrder(app, order.id);
    expect(partial.status).toBe("PARTIALLY_SHIPPED");
    expect(partial.lines[0].shippedQuantity).toBe("400");
    expect(partial.lines[0].outstandingQuantity).toBe("600");

    const draft2 = (await prepareShipment(app, order.id)).json();
    await app.inject({ method: "POST", url: `/shipments/${draft2.id}/confirm` });

    const shipped = await getOrder(app, order.id);
    expect(shipped.status).toBe("SHIPPED");
    expect(shipped.lines[0].shippedQuantity).toBe("1000");
    expect(shipped.lines[0].outstandingQuantity).toBe("0");
    // Pedido totalmente expedido nunca mantém compromisso ativo.
    expect(shipped.reservation.status).toBe("RELEASED");
    expect(shipped.reservation.releaseReason).toBe("ORDER_SHIPPED");
    expect(shipped.shipments).toHaveLength(2);

    await app.close();
  });

  it("expedição única cobrindo tudo vai direto para SHIPPED", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const draft = (await prepareShipment(app, order.id)).json();
    await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });

    expect((await getOrder(app, order.id)).status).toBe("SHIPPED");

    await app.close();
  });

  it("FEFO em múltiplos lotes: expede os dois lotes reservados", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem({ controlsExpiry: true });
    const lotA = await stockFinishedLot(finishedItem.id, "400", {
      expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    const lotB = await stockFinishedLot(finishedItem.id, "500", {
      expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "600", "600");

    const draft = (await prepareShipment(app, order.id)).json();
    expect(draft.lines).toHaveLength(2);
    const byLot = new Map(draft.lines.map((l: { lotId: string; quantity: string }) => [l.lotId, l.quantity]));
    expect(byLot.get(lotA.id)).toBe("400");
    expect(byLot.get(lotB.id)).toBe("200");

    await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });

    const lotADetail = (await app.inject({ method: "GET", url: `/lots/${lotA.id}` })).json();
    expect(lotADetail.onHand).toBe("0");
    const lotBDetail = (await app.inject({ method: "GET", url: `/lots/${lotB.id}` })).json();
    expect(lotBDetail.onHand).toBe("300");

    await app.close();
  });

  it("rejeita lote bloqueado, vencido ou aguardando liberação no momento da saída", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem({ controlsExpiry: true });
    const lot = await stockFinishedLot(finishedItem.id, "500", {
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "500", "500");
    const draft = (await prepareShipment(app, order.id)).json();

    // O lote vence DEPOIS da reserva, ANTES da expedição.
    await getPrisma().lot.update({
      where: { id: lot.id },
      data: { expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const expired = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
    expect(expired.statusCode).toBe(400);
    expect(expired.json().error).toBe("lot_not_shippable");

    await getPrisma().lot.update({
      where: { id: lot.id },
      data: { expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), status: "AWAITING_RELEASE" },
    });
    const awaiting = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
    expect(awaiting.statusCode).toBe(400);
    expect(awaiting.json().error).toBe("lot_not_shippable");

    await getPrisma().lot.update({ where: { id: lot.id }, data: { status: "BLOCKED" } });
    const blocked = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe("lot_not_shippable");

    await app.close();
  });

  it("CONFIRMED é imutável — não edita, não confirma de novo, não cancela", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "300");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "300", "300");
    const draft = (await prepareShipment(app, order.id)).json();
    await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });

    const edit = await app.inject({ method: "PATCH", url: `/shipments/${draft.id}`, payload: { notes: "x" } });
    expect(edit.statusCode).toBe(400);
    expect(edit.json().error).toBe("shipment_not_draft");

    const reconfirm = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
    expect(reconfirm.statusCode).toBe(400);

    const cancel = await app.inject({
      method: "POST",
      url: `/shipments/${draft.id}/cancel`,
      payload: { reason: "Tentativa" },
    });
    expect(cancel.statusCode).toBe(400);
    expect(cancel.json().error).toBe("shipment_not_draft");

    await app.close();
  });

  it("pedido SHIPPED bloqueia nova expedição, nova reserva e cancelamento", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "300");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "300", "300");
    const draft = (await prepareShipment(app, order.id)).json();
    await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });

    const newShipment = await prepareShipment(app, order.id);
    expect(newShipment.statusCode).toBe(400);
    expect(newShipment.json().error).toBe("order_not_shippable");

    const reservationStatus = await app.inject({
      method: "GET",
      url: `/customer-orders/${order.id}/reservation-status`,
    });
    expect(reservationStatus.statusCode).toBe(400);

    const cancel = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/cancel`,
      payload: { reason: "Tentativa" },
    });
    expect(cancel.statusCode).toBe(400);
    expect(cancel.json().error).toBe("cancellation_blocked");

    await app.close();
  });

  it("uma única expedição DRAFT por pedido é garantida no próprio banco (índice parcial)", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "100", "100");
    await prepareShipment(app, order.id);

    // Segunda DRAFT direto no banco (contornando o service) — o índice
    // parcial `WHERE status = 'DRAFT'` precisa recusar por si só, não só a
    // validação da aplicação.
    const prisma = getPrisma();
    await expect(
      prisma.shipment.create({
        data: {
          code: `EXP-DUP-${marker()}`,
          customerOrderId: order.id,
          status: "DRAFT",
          createdBy: "Teste",
        },
      }),
    ).rejects.toThrow();

    await app.close();
  });

  it("concorrência: duas confirmações simultâneas da mesma expedição não expedem em dobro", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "100", "100");

    const draft = (await prepareShipment(app, order.id)).json();
    const reservationLineId = draft.lines[0].customerOrderReservationLineId;
    await setShipmentLines(app, draft.id, [
      { customerOrderReservationLineId: reservationLineId, quantity: "80" },
    ]);

    const [respA, respB] = await Promise.all([
      app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` }),
      app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` }),
    ]);

    const statuses = [respA.statusCode, respB.statusCode].sort();
    expect(statuses).toEqual([200, 400]);

    // Saiu exatamente 80 — nunca 160.
    const inventory = await getInventory(app, finishedItem.id);
    expect(inventory.onHand).toBe("920");
    expect(inventory.reserved).toBe("20");

    const movements = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` })
    ).json();
    expect(movements.movements.filter((m: { type: string }) => m.type === "SHIPMENT_OUT")).toHaveLength(1);

    await app.close();
  });
});

describe("Reserva complementar", () => {
  it("produto AWAITING_RELEASE não é reservável; após liberação Quality passa a ser", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "600");
    const product = await createProduct(app, finishedItem.id);
    // Pedido de 1000: reserva 600 disponíveis, produz 400.
    const order = await createOrderInFulfillment(app, product.id, "1000", "600");

    // A produção "chega" como lote aguardando Qualidade.
    const producedLot = await stockFinishedLot(finishedItem.id, "400", { status: "AWAITING_RELEASE" });

    const blocked = (
      await app.inject({ method: "GET", url: `/customer-orders/${order.id}/reservation-status` })
    ).json();
    expect(blocked.lines[0].stillToReserve).toBe("400");
    expect(blocked.lines[0].currentAvailable).toBe("0");
    expect(blocked.lines[0].suggestedAdditionalReserve).toBe("0");

    const rejected = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/reserve-available`,
      payload: { lines: [{ customerOrderLineId: order.lines[0].id, quantity: "400" }] },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe("insufficient_available");

    // Qualidade libera.
    await app.inject({ method: "POST", url: `/lots/${producedLot.id}/release` });

    const afterRelease = (
      await app.inject({ method: "GET", url: `/customer-orders/${order.id}/reservation-status` })
    ).json();
    expect(afterRelease.lines[0].currentAvailable).toBe("400");
    expect(afterRelease.lines[0].suggestedAdditionalReserve).toBe("400");

    const beforeReserve = await getInventory(app, finishedItem.id);
    const movementsBefore = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` })
    ).json().movements.length;

    const reserved = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/reserve-available`,
      payload: { lines: [{ customerOrderLineId: order.lines[0].id, quantity: "400" }] },
    });
    expect(reserved.statusCode).toBe(200);

    const afterReserve = await getInventory(app, finishedItem.id);
    expect(afterReserve.onHand).toBe(beforeReserve.onHand);
    expect(afterReserve.reserved).toBe("1000");
    expect(afterReserve.available).toBe("0");

    // Reserva nunca cria movimento de estoque.
    const movementsAfter = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${finishedItem.id}` })
    ).json().movements.length;
    expect(movementsAfter).toBe(movementsBefore);

    await app.close();
  });

  it("não reserva acima do pendente do pedido", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "1000");
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "600", "600");

    const response = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/reserve-available`,
      payload: { lines: [{ customerOrderLineId: order.lines[0].id, quantity: "100" }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("excessive_reserve_request");

    await app.close();
  });

  it("concorrência: dois pedidos disputando o mesmo saldo não over-reservam", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    await stockFinishedLot(finishedItem.id, "100");
    const product = await createProduct(app, finishedItem.id);
    const orderA = await createOrderInFulfillment(app, product.id, "80", "0");
    const orderB = await createOrderInFulfillment(app, product.id, "80", "0");

    const [respA, respB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/customer-orders/${orderA.id}/reserve-available`,
        payload: { lines: [{ customerOrderLineId: orderA.lines[0].id, quantity: "80" }] },
      }),
      app.inject({
        method: "POST",
        url: `/customer-orders/${orderB.id}/reserve-available`,
        payload: { lines: [{ customerOrderLineId: orderB.lines[0].id, quantity: "80" }] },
      }),
    ]);

    const statuses = [respA.statusCode, respB.statusCode].sort();
    expect(statuses).toEqual([200, 400]);

    const inventory = await getInventory(app, finishedItem.id);
    expect(inventory.reserved).toBe("80");
    expect(Number(inventory.reserved)).toBeLessThanOrEqual(100);

    await app.close();
  });
});

describe("Realocação de reserva", () => {
  it("preserva o expedido, libera o remanescente e realoca via FEFO mantendo a genealogia", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem({ controlsExpiry: true });
    const lotA = await stockFinishedLot(finishedItem.id, "100", {
      expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "100", "100");

    // Expede 40 do lote A.
    const draft = (await prepareShipment(app, order.id)).json();
    const originalLineId = draft.lines[0].customerOrderReservationLineId;
    await setShipmentLines(app, draft.id, [
      { customerOrderReservationLineId: originalLineId, quantity: "40" },
    ]);
    await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });

    // Lote A vence antes de expedir o restante; chega um lote B novo.
    await getPrisma().lot.update({
      where: { id: lotA.id },
      data: { expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const lotB = await stockFinishedLot(finishedItem.id, "60", {
      expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });

    const realloc = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/reallocate-reservation-line`,
      payload: { customerOrderReservationLineId: originalLineId },
    });
    expect(realloc.statusCode).toBe(200);

    const updated = await getOrder(app, order.id);
    const original = updated.reservation.lines.find((l: { id: string }) => l.id === originalLineId);
    expect(original.releasedAt).not.toBeNull();
    // O já expedido continua referenciando o lote original — genealogia preservada.
    expect(original.lotId).toBe(lotA.id);
    expect(original.shippedQuantity).toBe("40");

    const newLine = updated.reservation.lines.find(
      (l: { replacesLineId: string | null }) => l.replacesLineId === originalLineId,
    );
    expect(newLine.lotId).toBe(lotB.id);
    expect(newLine.quantity).toBe("60");

    // A expedição confirmada continua apontando para o lote original.
    const shipment = (await app.inject({ method: "GET", url: `/shipments/${draft.id}` })).json();
    expect(shipment.lines[0].lotId).toBe(lotA.id);

    // Reserved total do item continua coerente: só os 60 realocados.
    const inventory = await getInventory(app, finishedItem.id);
    expect(inventory.reserved).toBe("60");

    await app.close();
  });

  it("sem estoque suficiente faz rollback completo (linha original permanece ativa)", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem({ controlsExpiry: true });
    const lotA = await stockFinishedLot(finishedItem.id, "100", {
      expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    const product = await createProduct(app, finishedItem.id);
    const order = await createOrderInFulfillment(app, product.id, "100", "100");
    const orderDetail = await getOrder(app, order.id);
    const lineId = orderDetail.reservation.lines[0].id;

    // Lote vence e não há nenhum outro lote para substituir.
    await getPrisma().lot.update({
      where: { id: lotA.id },
      data: { expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const response = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/reallocate-reservation-line`,
      payload: { customerOrderReservationLineId: lineId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("insufficient_available");

    // Rollback: a linha original nunca foi liberada.
    const after = await getOrder(app, order.id);
    expect(after.reservation.lines.find((l: { id: string }) => l.id === lineId).releasedAt).toBeNull();

    await app.close();
  });
});

describe("Hardening — bloqueio de lote reservado", () => {
  it("lote com reserva de Pedido do Cliente não pode ser bloqueado", async () => {
    const app = buildApp();
    await app.ready();

    const finishedItem = await createFinishedItem();
    const lot = await stockFinishedLot(finishedItem.id, "500");
    const product = await createProduct(app, finishedItem.id);
    await createOrderInFulfillment(app, product.id, "500", "500");

    const response = await app.inject({
      method: "POST",
      url: `/lots/${lot.id}/block`,
      payload: { reason: "Tentativa de bloqueio" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("reservada");

    await app.close();
  });
});
