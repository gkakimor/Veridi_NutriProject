import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Entregas programadas — o compromisso comercial, contra o banco de verdade.
 *
 * O que estes testes protegem não é a tela: é a fronteira. Programar não pode
 * reservar, produzir, expedir nem faturar; a execução continua sendo a
 * Expedição CONFIRMADA, e é dela que todo atendimento vem. E o cancelamento
 * parcial, que é a regra mais delicada da capacidade: a saída física já
 * ocorrida continua descontada, o saldo que restava volta a ser programável, e
 * os 400 originais nunca ressuscitam.
 */

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

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
    await prisma.customerOrderDeliveryLine.deleteMany({
      where: { delivery: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    // A substituta aponta para a original: apaga quem referencia primeiro.
    await prisma.customerOrderDelivery.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds }, replacesDeliveryId: { not: null } },
    });
    await prisma.customerOrderDelivery.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.productionOrder.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
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
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createFinishedItem() {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-ENT-${m}`,
      name: `Produto Acabado Entrega ${m}`,
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

/** Lote de produto acabado com saldo, criado direto (isola do fluxo de OP). */
async function stockFinishedLot(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-ENT-${marker()}`.toUpperCase(),
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
    payload: {
      customerId: await fixtureCustomerId(),
      name: `Produto Entrega ${marker()}`,
      finishedProductItemId: finishedItemId,
    },
  });
  const product = response.json();
  fixtureProductIds.push(product.id);
  return product;
}

/**
 * Pedido CONFIRMED com o Plano aplicado — reserva `reserveQuantity` e produz o
 * resto. É o estado em que um Pedido de verdade recebe cronograma.
 */
async function createOrderInFulfillment(
  app: App,
  productId: string,
  orderedQuantity: string,
  reserveQuantity: string,
) {
  const created = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: {
      customerId: await fixtureCustomerId(),
      lines: [{ productId, orderedQuantity }],
    },
  });
  const orderId = created.json().id;
  fixtureCustomerOrderIds.push(orderId);

  const confirmed = await app.inject({ method: "POST", url: `/customer-orders/${orderId}/confirm` });
  const lineId = confirmed.json().lines[0].id;

  const produce = (Number(orderedQuantity) - Number(reserveQuantity)).toString();
  await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
    payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity, produceQuantity: produce }] },
  });

  return { orderId, lineId };
}

async function getSchedule(app: App, orderId: string) {
  return (await app.inject({ method: "GET", url: `/customer-orders/${orderId}/deliveries` })).json();
}

async function addDelivery(
  app: App,
  orderId: string,
  scheduledDate: string,
  lines: { customerOrderLineId: string; quantity: string }[],
) {
  return app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/deliveries`,
    payload: { scheduledDate, lines },
  });
}

/** Expede `quantity` a partir de uma entrega programada, pelo fluxo oficial. */
async function shipFromDelivery(
  app: App,
  orderId: string,
  deliveryId: string,
  quantity: string,
  lotCode: string,
) {
  const draft = (
    await app.inject({
      method: "POST",
      url: `/customer-orders/${orderId}/shipments`,
      payload: { deliveryId },
    })
  ).json();

  const reservationLineId = draft.lines[0].customerOrderReservationLineId;
  await app.inject({
    method: "PATCH",
    url: `/shipments/${draft.id}`,
    payload: { lines: [{ customerOrderReservationLineId: reservationLineId, quantity }] },
  });

  const comLinhas = (await app.inject({ method: "GET", url: `/shipments/${draft.id}` })).json();
  for (const line of comLinhas.lines) {
    await app.inject({
      method: "POST",
      url: `/shipments/${draft.id}/lines/${line.id}/verify`,
      payload: { lotCode },
    });
  }

  const confirmed = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
  return { draftId: draft.id, confirmed };
}

/** Expede `quantity` pelo fluxo GERAL do Pedido — sem contexto de entrega. */
async function shipFromOrder(app: App, orderId: string, quantity: string, lotCode: string) {
  const draft = (
    await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })
  ).json();

  const reservationLineId = draft.lines[0].customerOrderReservationLineId;
  await app.inject({
    method: "PATCH",
    url: `/shipments/${draft.id}`,
    payload: { lines: [{ customerOrderReservationLineId: reservationLineId, quantity }] },
  });

  const comLinhas = (await app.inject({ method: "GET", url: `/shipments/${draft.id}` })).json();
  for (const line of comLinhas.lines) {
    await app.inject({
      method: "POST",
      url: `/shipments/${draft.id}/lines/${line.id}/verify`,
      payload: { lotCode },
    });
  }

  const confirmed = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
  return { draftId: draft.id, draft: comLinhas, confirmed };
}

describe("entregas programadas de um Pedido", () => {
  it("programa o Pedido inteiro em duas datas e zera o saldo programável", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const inicial = await getSchedule(app, orderId);
    expect(inicial.deliveries).toHaveLength(0);
    expect(inicial.schedulable[0].schedulableQuantity).toBe("1000");

    const a = await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "400" },
    ]);
    expect(a.statusCode).toBe(201);

    const b = await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "600" },
    ]);
    expect(b.statusCode).toBe(201);

    const schedule = b.json();
    expect(schedule.deliveries).toHaveLength(2);
    expect(schedule.deliveries.map((d: { sequence: number }) => d.sequence)).toEqual([1, 2]);
    expect(schedule.schedulable[0].schedulableQuantity).toBe("0");
    expect(schedule.schedulable[0].scheduledPendingQuantity).toBe("1000");
    for (const delivery of schedule.deliveries) {
      expect(delivery.status).toBe("SCHEDULED");
      expect(delivery.totalFulfilledQuantity).toBe("0");
    }
  });

  it("recusa programar acima do saldo, ainda que por uma casa decimal", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "400" },
    ]);
    await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "600" },
    ]);

    const excesso = await addDelivery(app, orderId, "2026-12-15", [
      { customerOrderLineId: lineId, quantity: "0.000000000001" },
    ]);
    expect(excesso.statusCode).toBe(400);
    expect(excesso.json().error).toBe("exceeds_schedulable_quantity");
  });

  it("recusa o mesmo produto duas vezes na mesma entrega", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const duplicada = await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "100" },
      { customerOrderLineId: lineId, quantity: "100" },
    ]);
    expect(duplicada.statusCode).toBe(400);
    expect(duplicada.json().error).toBe("duplicate_delivery_line");
  });

  it("programar não reserva, não produz, não expede e não fatura", async () => {
    const app = buildTestApp();
    const prisma = getPrisma();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const antes = {
      reservas: await prisma.customerOrderReservationLine.count({
        where: { reservation: { customerOrderId: orderId } },
      }),
      movimentos: await prisma.inventoryMovement.count({ where: { itemId: item.id } }),
      ops: await prisma.productionOrder.count({ where: { customerOrderId: orderId } }),
      expedicoes: await prisma.shipment.count({ where: { customerOrderId: orderId } }),
      faturamentos: await prisma.billing.count({ where: { customerOrderId: orderId } }),
    };

    await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "400" },
    ]);

    expect(
      await prisma.customerOrderReservationLine.count({
        where: { reservation: { customerOrderId: orderId } },
      }),
    ).toBe(antes.reservas);
    expect(await prisma.inventoryMovement.count({ where: { itemId: item.id } })).toBe(
      antes.movimentos,
    );
    expect(await prisma.productionOrder.count({ where: { customerOrderId: orderId } })).toBe(
      antes.ops,
    );
    expect(await prisma.shipment.count({ where: { customerOrderId: orderId } })).toBe(
      antes.expedicoes,
    );
    expect(await prisma.billing.count({ where: { customerOrderId: orderId } })).toBe(
      antes.faturamentos,
    );
  });
});

describe("concorrência", () => {
  /**
   * Duas pessoas programando ao mesmo tempo contra o mesmo saldo.
   *
   * Sem o `FOR UPDATE` no Pedido as duas leriam 1.000 disponíveis e as duas
   * passariam, deixando 1.200 prometidos num Pedido de 1.000. A validação
   * acontece DENTRO da transação, e o banco é a autoridade — não a tela.
   */
  it("duas criações simultâneas contra saldo insuficiente: uma passa, a outra recusa", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const [uma, outra] = await Promise.all([
      addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "600" },
      ]),
      addDelivery(app, orderId, "2026-11-15", [
        { customerOrderLineId: lineId, quantity: "600" },
      ]),
    ]);

    const codigos = [uma.statusCode, outra.statusCode].sort();
    expect(codigos).toEqual([201, 400]);

    const recusada = uma.statusCode === 400 ? uma : outra;
    expect(recusada.json().error).toBe("exceeds_schedulable_quantity");

    const schedule = await getSchedule(app, orderId);
    const ativas = schedule.deliveries.filter(
      (d: { status: string }) => d.status !== "CANCELLED",
    );
    expect(ativas).toHaveLength(1);
    expect(schedule.schedulable[0].scheduledPendingQuantity).toBe("600");
    expect(schedule.schedulable[0].schedulableQuantity).toBe("400");
  });
});

describe("atendimento pela Expedição confirmada", () => {
  it("atende parcialmente uma entrega e deixa a outra intacta", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];
    await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "600" },
    ]);

    const { confirmed } = await shipFromDelivery(app, orderId, a.id, "250", lot.code);
    expect(confirmed.statusCode).toBe(200);

    const schedule = await getSchedule(app, orderId);
    const entregaA = schedule.deliveries.find((d: { id: string }) => d.id === a.id);
    const entregaB = schedule.deliveries.find((d: { id: string }) => d.id !== a.id);

    expect(entregaA.totalFulfilledQuantity).toBe("250");
    expect(entregaA.totalRemainingQuantity).toBe("150");
    expect(entregaA.status).toBe("PARTIALLY_FULFILLED");
    expect(entregaA.shipments).toHaveLength(1);

    expect(entregaB.totalFulfilledQuantity).toBe("0");
    expect(entregaB.status).toBe("SCHEDULED");

    // O expedido saiu do saldo do Pedido; o pendente da programação encolheu
    // na mesma medida, então programável continua zero.
    expect(schedule.schedulable[0].shippedQuantity).toBe("250");
    expect(schedule.schedulable[0].scheduledPendingQuantity).toBe("750");
    expect(schedule.schedulable[0].schedulableQuantity).toBe("0");
  });

  it("rascunho de expedição não conta como atendimento", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    const draft = (
      await app.inject({
        method: "POST",
        url: `/customer-orders/${orderId}/shipments`,
        payload: { deliveryId: a.id },
      })
    ).json();
    expect(draft.status).toBe("DRAFT");

    const schedule = await getSchedule(app, orderId);
    const entregaA = schedule.deliveries[0];
    expect(entregaA.totalFulfilledQuantity).toBe("0");
    expect(entregaA.status).toBe("SCHEDULED");
    // O rascunho aparece — quem abre a entrega precisa saber que já existe
    // separação em curso — mas não entrega nada.
    expect(entregaA.shipments.map((s: { status: string }) => s.status)).toEqual(["DRAFT"]);
    expect(lot.code).toBeTruthy();
  });

  it("a expedição preparada a partir de uma entrega propõe só o que ela prometia", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    const draft = (
      await app.inject({
        method: "POST",
        url: `/customer-orders/${orderId}/shipments`,
        payload: { deliveryId: a.id },
      })
    ).json();

    // Sem o teto da promessa a proposta viria com os 1.000 reservados.
    const total = draft.lines.reduce(
      (soma: number, line: { quantity: string }) => soma + Number(line.quantity),
      0,
    );
    expect(total).toBe(400);
  });
});

describe("cancelamento", () => {
  it("cancela uma entrega intacta e devolve tudo ao saldo programável", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    const cancelada = await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${a.id}/cancel`,
      payload: { reason: "Cliente adiou a compra" },
    });
    expect(cancelada.statusCode).toBe(200);

    const schedule = cancelada.json();
    expect(schedule.deliveries[0].status).toBe("CANCELLED");
    expect(schedule.deliveries[0].cancelReason).toBe("Cliente adiou a compra");
    expect(schedule.schedulable[0].schedulableQuantity).toBe("1000");
  });

  it("exige motivo", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    const semMotivo = await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${a.id}/cancel`,
      payload: {},
    });
    expect(semMotivo.statusCode).toBe(400);
    expect(semMotivo.json().error).toBe("validation_error");
  });

  /**
   * A regra central da decisão do PO: cancelar não apaga execução. As 250 que
   * saíram continuam ligadas à entrega e continuam visíveis nela; só as 150
   * pendentes voltam a ser programáveis.
   */
  it("cancela uma entrega parcialmente atendida preservando o que saiu", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "400");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "400", "400");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    await shipFromDelivery(app, orderId, a.id, "250", lot.code);

    const cancelada = (
      await app.inject({
        method: "POST",
        url: `/customer-order-deliveries/${a.id}/cancel`,
        payload: { reason: "Cliente cancelou o restante" },
      })
    ).json();

    const entregaA = cancelada.deliveries[0];
    expect(entregaA.status).toBe("CANCELLED");
    expect(entregaA.totalQuantity).toBe("400");
    expect(entregaA.totalFulfilledQuantity).toBe("250");
    expect(entregaA.totalRemainingQuantity).toBe("150");
    expect(entregaA.shipments).toHaveLength(1);

    // Só o pendente volta: 400 − 250 expedidas = 150. Nunca os 400.
    expect(cancelada.schedulable[0].shippedQuantity).toBe("250");
    expect(cancelada.schedulable[0].scheduledPendingQuantity).toBe("0");
    expect(cancelada.schedulable[0].schedulableQuantity).toBe("150");
  });

  it("recusa cancelar uma entrega inteiramente atendida", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "400");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "400", "400");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    await shipFromDelivery(app, orderId, a.id, "400", lot.code);

    const recusa = await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${a.id}/cancel`,
      payload: { reason: "tentativa" },
    });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().error).toBe("delivery_already_fulfilled");
  });
});

describe("reprogramação", () => {
  it("entrega intacta: a substituta nasce com a quantidade inteira", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "400");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "400", "400");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    const depois = (
      await app.inject({
        method: "POST",
        url: `/customer-order-deliveries/${a.id}/reschedule`,
        payload: { scheduledDate: "2026-11-15", reason: "Cliente pediu para adiar" },
      })
    ).json();

    const original = depois.deliveries.find((d: { id: string }) => d.id === a.id);
    const substituta = depois.deliveries.find((d: { id: string }) => d.id !== a.id);

    expect(original.status).toBe("CANCELLED");
    expect(original.replacedByDeliveryId).toBe(substituta.id);
    expect(substituta.replacesDeliveryId).toBe(a.id);
    expect(substituta.scheduledDate).toBe("2026-11-15");
    expect(substituta.totalQuantity).toBe("400");
    expect(depois.schedulable[0].schedulableQuantity).toBe("0");
  });

  /**
   * O caso do handoff: 400 prometidas, 250 atendidas, o cliente move o resto.
   * A substituta nasce com 150 — nunca com 400.
   */
  it("entrega parcial: a substituta nasce só com o saldo pendente", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "400");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "400", "400");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    await shipFromDelivery(app, orderId, a.id, "250", lot.code);

    const depois = (
      await app.inject({
        method: "POST",
        url: `/customer-order-deliveries/${a.id}/reschedule`,
        payload: { scheduledDate: "2026-11-15", reason: "Cliente adiou o restante" },
      })
    ).json();

    const original = depois.deliveries.find((d: { id: string }) => d.id === a.id);
    const substituta = depois.deliveries.find((d: { id: string }) => d.id !== a.id);

    expect(original.status).toBe("CANCELLED");
    expect(original.totalQuantity).toBe("400");
    expect(original.totalFulfilledQuantity).toBe("250");

    expect(substituta.totalQuantity).toBe("150");
    expect(substituta.totalFulfilledQuantity).toBe("0");
    expect(substituta.replacesDeliverySequence).toBe(original.sequence);
    expect(depois.schedulable[0].schedulableQuantity).toBe("0");
  });

  it("recusa reprogramar uma entrega inteiramente atendida", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "400");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "400", "400");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    await shipFromDelivery(app, orderId, a.id, "400", lot.code);

    const recusa = await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${a.id}/reschedule`,
      payload: { scheduledDate: "2026-11-15", reason: "tentativa" },
    });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().error).toBe("delivery_already_fulfilled");
  });

  it("a cadeia A → B → C fica inteira, e só a última está vigente", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    await stockFinishedLot(item.id, "400");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "400", "400");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    const passo1 = (
      await app.inject({
        method: "POST",
        url: `/customer-order-deliveries/${a.id}/reschedule`,
        payload: { scheduledDate: "2026-11-15", reason: "primeiro adiamento" },
      })
    ).json();
    const b = passo1.deliveries.find((d: { id: string }) => d.id !== a.id);

    const passo2 = (
      await app.inject({
        method: "POST",
        url: `/customer-order-deliveries/${b.id}/reschedule`,
        payload: { scheduledDate: "2026-12-15", reason: "segundo adiamento" },
      })
    ).json();

    expect(passo2.deliveries).toHaveLength(3);
    const porId = new Map(passo2.deliveries.map((d: { id: string }) => [d.id, d]));
    const finalA = porId.get(a.id) as { status: string; replacedByDeliveryId: string };
    const finalB = porId.get(b.id) as {
      status: string;
      replacesDeliveryId: string;
      replacedByDeliveryId: string;
    };
    const c = passo2.deliveries.find(
      (d: { id: string }) => d.id !== a.id && d.id !== b.id,
    ) as { status: string; replacesDeliveryId: string; scheduledDate: string };

    expect(finalA.status).toBe("CANCELLED");
    expect(finalA.replacedByDeliveryId).toBe(b.id);
    expect(finalB.status).toBe("CANCELLED");
    expect(finalB.replacesDeliveryId).toBe(a.id);
    expect(c.replacesDeliveryId).toBe(b.id);
    expect(c.status).toBe("SCHEDULED");
    expect(c.scheduledDate).toBe("2026-12-15");
  });
});

describe("fronteira com a Expedição", () => {
  it("confirmar nunca entrega mais do que a entrega programada prometia", async () => {
    const app = buildTestApp();
    const prisma = getPrisma();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    const draft = (
      await app.inject({
        method: "POST",
        url: `/customer-orders/${orderId}/shipments`,
        payload: { deliveryId: a.id },
      })
    ).json();

    /*
     * Rompe o teto POR FORA do serviço — é o que uma corrida entre duas
     * confirmações produziria. A revalidação da confirmação precisa pegar.
     */
    await prisma.shipmentLine.updateMany({
      where: { shipmentId: draft.id },
      data: { quantity: "500" },
    });

    const comLinhas = (await app.inject({ method: "GET", url: `/shipments/${draft.id}` })).json();
    for (const line of comLinhas.lines) {
      await app.inject({
        method: "POST",
        url: `/shipments/${draft.id}/lines/${line.id}/verify`,
        payload: { lotCode: lot.code },
      });
    }

    const recusa = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().error).toBe("exceeds_scheduled_quantity");
  });

  it("Pedido sem cronograma continua expedindo como sempre", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "400");
    const product = await createProduct(app, item.id);
    const { orderId } = await createOrderInFulfillment(app, product.id, "400", "400");

    const draft = (
      await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })
    ).json();
    expect(draft.lines.length).toBeGreaterThan(0);

    for (const line of draft.lines) {
      await app.inject({
        method: "POST",
        url: `/shipments/${draft.id}/lines/${line.id}/verify`,
        payload: { lotCode: lot.code },
      });
    }
    const confirmed = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
    expect(confirmed.statusCode).toBe(200);

    const schedule = await getSchedule(app, orderId);
    expect(schedule.deliveries).toHaveLength(0);
    expect(schedule.schedulable[0].shippedQuantity).toBe("400");
    expect(schedule.schedulable[0].schedulableQuantity).toBe("0");
  });
});


/**
 * COM-04b — a quantidade expedida ATRAVESSA promessas.
 *
 * O defeito original: uma linha só ganhava vínculo quando cabia INTEIRA numa
 * promessa. Expedir 500 contra entregas de 400 e 600 não cabia em nenhuma,
 * ficava sem vínculo, e o cronograma jurava que nada tinha sido entregue.
 */
describe("alocação de expedição geral entre várias entregas", () => {
  it("500 contra A=400 e B=600 atende 400 em A e 100 em B", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "400" },
    ]);
    await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "600" },
    ]);

    const { draft, confirmed } = await shipFromOrder(app, orderId, "500", lot.code);
    expect(confirmed.statusCode).toBe(200);

    // A quantidade virou DUAS linhas do mesmo lote e da mesma reserva.
    expect(draft.lines).toHaveLength(2);
    expect(new Set(draft.lines.map((l: { lotCode: string }) => l.lotCode)).size).toBe(1);
    expect(
      new Set(
        draft.lines.map((l: { customerOrderReservationLineId: string }) => l.customerOrderReservationLineId),
      ).size,
    ).toBe(1);

    const schedule = await getSchedule(app, orderId);
    const [a, b] = schedule.deliveries;
    expect(a.totalFulfilledQuantity).toBe("400");
    expect(a.status).toBe("FULFILLED");
    expect(b.totalFulfilledQuantity).toBe("100");
    expect(b.status).toBe("PARTIALLY_FULFILLED");
  });

  it("a expedição seguinte fecha o que restou da segunda entrega", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "400" },
    ]);
    await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "600" },
    ]);

    await shipFromOrder(app, orderId, "500", lot.code);
    const segunda = await shipFromOrder(app, orderId, "500", lot.code);
    expect(segunda.confirmed.statusCode).toBe(200);

    const schedule = await getSchedule(app, orderId);
    expect(schedule.deliveries.map((d: { status: string }) => d.status)).toEqual([
      "FULFILLED",
      "FULFILLED",
    ]);
    expect(schedule.deliveries[1].totalFulfilledQuantity).toBe("600");
    expect(schedule.schedulable[0].schedulableQuantity).toBe("0");
  });

  it("com saldo parcial em A, 300 fecha A e começa B", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];
    await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "600" },
    ]);

    // 250 pela entrega A: sobra 150 nela.
    await shipFromDelivery(app, orderId, a.id, "250", lot.code);
    // Agora 300 pelo fluxo geral: 150 fecham A e 150 vão para B.
    await shipFromOrder(app, orderId, "300", lot.code);

    const schedule = await getSchedule(app, orderId);
    expect(schedule.deliveries[0].totalFulfilledQuantity).toBe("400");
    expect(schedule.deliveries[0].status).toBe("FULFILLED");
    expect(schedule.deliveries[1].totalFulfilledQuantity).toBe("150");
  });

  /*
   * Expedir não exige cronograma completo: o Pedido tem saldo real, e a parte
   * que nenhuma promessa esperava sai sem vínculo — não é erro.
   */
  it("o que passa das promessas sai sem vínculo, e a expedição segue válida", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "400" },
    ]);

    const { draft, confirmed } = await shipFromOrder(app, orderId, "500", lot.code);
    expect(confirmed.statusCode).toBe(200);

    const comVinculo = draft.lines.filter((l: { deliverySequence: number | null }) => l.deliverySequence !== null);
    const semVinculo = draft.lines.filter((l: { deliverySequence: number | null }) => l.deliverySequence === null);
    expect(comVinculo).toHaveLength(1);
    expect(comVinculo[0].quantity).toBe("400");
    expect(semVinculo).toHaveLength(1);
    expect(semVinculo[0].quantity).toBe("100");

    const schedule = await getSchedule(app, orderId);
    expect(schedule.deliveries[0].status).toBe("FULFILLED");
    expect(schedule.schedulable[0].shippedQuantity).toBe("500");
  });

  it("Pedido sem cronograma: nenhuma linha ganha vínculo e nada muda", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "500");
    const product = await createProduct(app, item.id);
    const { orderId } = await createOrderInFulfillment(app, product.id, "500", "500");

    const { draft, confirmed } = await shipFromOrder(app, orderId, "500", lot.code);
    expect(confirmed.statusCode).toBe(200);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].deliverySequence).toBeNull();
  });

  it("entrega cancelada não recebe alocação nova", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];
    await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "600" },
    ]);

    await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${a.id}/cancel`,
      payload: { reason: "Cliente desistiu de outubro" },
    });

    await shipFromOrder(app, orderId, "400", lot.code);

    const schedule = await getSchedule(app, orderId);
    const cancelada = schedule.deliveries.find((d: { id: string }) => d.id === a.id);
    const viva = schedule.deliveries.find((d: { id: string }) => d.id !== a.id);
    expect(cancelada.totalFulfilledQuantity).toBe("0");
    expect(viva.totalFulfilledQuantity).toBe("400");
  });

  it("duas promessas no MESMO dia são servidas pela sequência", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "100" },
    ]);
    await addDelivery(app, orderId, "2026-10-15", [
      { customerOrderLineId: lineId, quantity: "100" },
    ]);
    await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "500" },
    ]);

    await shipFromOrder(app, orderId, "250", lot.code);

    const schedule = await getSchedule(app, orderId);
    const porSequencia = new Map(
      schedule.deliveries.map((d: { sequence: number; totalFulfilledQuantity: string }) => [
        d.sequence,
        d.totalFulfilledQuantity,
      ]),
    );
    expect(porSequencia.get(1)).toBe("100");
    expect(porSequencia.get(2)).toBe("100");
    expect(porSequencia.get(3)).toBe("50");
  });
});

/**
 * O CTA de uma entrega REPRESENTA aquela entrega.
 *
 * Uma separação aberta pela promessa de novembro fica em novembro: ela não
 * consome outubro por ser anterior, e passar do que novembro pedia é recusa —
 * nunca transbordo para dezembro.
 */
describe("separação aberta a partir de uma entrega", () => {
  it("não consome a entrega anterior, mesmo sendo mais antiga", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];
    const b = (
      await addDelivery(app, orderId, "2026-11-15", [
        { customerOrderLineId: lineId, quantity: "600" },
      ])
    ).json().deliveries[1];

    await shipFromDelivery(app, orderId, b.id, "100", lot.code);

    const schedule = await getSchedule(app, orderId);
    const entregaA = schedule.deliveries.find((d: { id: string }) => d.id === a.id);
    const entregaB = schedule.deliveries.find((d: { id: string }) => d.id === b.id);
    expect(entregaA.totalFulfilledQuantity).toBe("0");
    expect(entregaA.status).toBe("SCHEDULED");
    expect(entregaB.totalFulfilledQuantity).toBe("100");
  });

  it("acima do saldo da entrega é recusado, sem vazar para a próxima", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const b = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "100" },
      ])
    ).json().deliveries[0];
    await addDelivery(app, orderId, "2026-11-15", [
      { customerOrderLineId: lineId, quantity: "900" },
    ]);

    const draft = (
      await app.inject({
        method: "POST",
        url: `/customer-orders/${orderId}/shipments`,
        payload: { deliveryId: b.id },
      })
    ).json();

    const recusa = await app.inject({
      method: "PATCH",
      url: `/shipments/${draft.id}`,
      payload: {
        lines: [
          {
            customerOrderReservationLineId: draft.lines[0].customerOrderReservationLineId,
            quantity: "150",
          },
        ],
      },
    });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().error).toBe("exceeds_scheduled_quantity");

    const schedule = await getSchedule(app, orderId);
    expect(schedule.deliveries[1].totalFulfilledQuantity).toBe("0");
    expect(lot.code).toBeTruthy();
  });
});

/**
 * Separação em andamento tranca a promessa que ela prepara.
 *
 * Não é a execução histórica que bloqueia — 250 já confirmadas continuam
 * permitindo cancelar o saldo. É o rascunho: alterar o compromisso por baixo de
 * uma separação em curso deixaria quem confere lote apontando para uma promessa
 * que mudou de forma.
 */
describe("rascunho de expedição tranca a entrega", () => {
  async function comRascunho() {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "1000");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "1000", "1000");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    const draft = (
      await app.inject({
        method: "POST",
        url: `/customer-orders/${orderId}/shipments`,
        payload: { deliveryId: a.id },
      })
    ).json();

    return { app, orderId, deliveryId: a.id as string, draftId: draft.id as string, lot };
  }

  it("recusa cancelar e recusa reprogramar enquanto o rascunho existe", async () => {
    const { app, deliveryId } = await comRascunho();

    const cancelar = await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${deliveryId}/cancel`,
      payload: { reason: "tentativa" },
    });
    expect(cancelar.statusCode).toBe(400);
    expect(cancelar.json().error).toBe("delivery_has_draft_shipment");

    const reprogramar = await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${deliveryId}/reschedule`,
      payload: { scheduledDate: "2026-11-15", reason: "tentativa" },
    });
    expect(reprogramar.statusCode).toBe(400);
    expect(reprogramar.json().error).toBe("delivery_has_draft_shipment");
  });

  it("cancelado o rascunho, a entrega volta a aceitar cancelamento", async () => {
    const { app, deliveryId, draftId } = await comRascunho();

    const cancelarExpedicao = await app.inject({
      method: "POST",
      url: `/shipments/${draftId}/cancel`,
      payload: { reason: "Separação desfeita" },
    });
    expect(cancelarExpedicao.statusCode).toBe(200);

    const cancelar = await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${deliveryId}/cancel`,
      payload: { reason: "Cliente desistiu" },
    });
    expect(cancelar.statusCode).toBe(200);
    expect(cancelar.json().deliveries[0].status).toBe("CANCELLED");
  });

  /**
   * A confirmação NÃO realoca em silêncio.
   *
   * O índice de uma separação por Pedido já impede duas separações do mesmo
   * Pedido disputarem o mesmo saldo. O que sobra é o saldo encolher por outro
   * caminho entre separar e confirmar — e aí a resposta é recusar, com o
   * vínculo intacto. Mover a linha para a promessa seguinte apagaria a
   * evidência do que estava sendo preparado.
   */
  it("saldo que encolhe entre separar e confirmar recusa, e não muda o vínculo", async () => {
    const { app, deliveryId, draftId, lot } = await comRascunho();
    const prisma = getPrisma();

    const linhaDoRascunho = await prisma.shipmentLine.findFirstOrThrow({
      where: { shipmentId: draftId },
    });
    expect(linhaDoRascunho.customerOrderDeliveryLineId).not.toBeNull();

    // A promessa encolhe por fora: 400 prometidas viram 100.
    await prisma.customerOrderDeliveryLine.updateMany({
      where: { deliveryId },
      data: { quantity: "100" },
    });

    await app.inject({
      method: "POST",
      url: `/shipments/${draftId}/lines/${linhaDoRascunho.id}/verify`,
      payload: { lotCode: lot.code },
    });

    const recusa = await app.inject({ method: "POST", url: `/shipments/${draftId}/confirm` });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().error).toBe("exceeds_scheduled_quantity");

    const depois = await prisma.shipmentLine.findUniqueOrThrow({
      where: { id: linhaDoRascunho.id },
    });
    expect(depois.customerOrderDeliveryLineId).toBe(linhaDoRascunho.customerOrderDeliveryLineId);
  });

  it("expedição CONFIRMADA não tranca: o parcial continua cancelável", async () => {
    const app = buildTestApp();
    const item = await createFinishedItem();
    const lot = await stockFinishedLot(item.id, "400");
    const product = await createProduct(app, item.id);
    const { orderId, lineId } = await createOrderInFulfillment(app, product.id, "400", "400");

    const a = (
      await addDelivery(app, orderId, "2026-10-15", [
        { customerOrderLineId: lineId, quantity: "400" },
      ])
    ).json().deliveries[0];

    await shipFromDelivery(app, orderId, a.id, "250", lot.code);

    const cancelar = await app.inject({
      method: "POST",
      url: `/customer-order-deliveries/${a.id}/cancel`,
      payload: { reason: "Cliente cancelou o restante" },
    });
    expect(cancelar.statusCode).toBe(200);
    expect(cancelar.json().schedulable[0].schedulableQuantity).toBe("150");
  });
});
