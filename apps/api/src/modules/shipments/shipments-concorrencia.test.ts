import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import {
  abrirTransacaoDoTeste,
  acompanhar,
  esperarAte,
  esperarParadaEm,
  paradasEm,
} from "../../test-support/corrida-sob-trava.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Transição da Expedição sob concorrência (DOCUMENT-TRANSITION-CONCURRENCY-01,
 * riscos R-S1 e R-S2 do discovery).
 *
 * A confirmação é a única saída física: trava a Expedição, grava um
 * SHIPMENT_OUT por linha e vira CONFIRMED na mesma transação. Cancelar, editar
 * a separação e conferir lote só valem em rascunho — e decidiam isso sobre uma
 * leitura SEM trava. Com as duas operações intercaladas, a segunda gravava
 * depois do commit da primeira: Expedição CANCELLED com SHIPMENT_OUT (R-S1), e
 * a edição que lera o rascunho apagava as linhas já confirmadas — o FK
 * `inventory_movements.shipmentLineId` é ON DELETE CASCADE e levava o
 * SHIPMENT_OUT junto (R-S2).
 *
 * Cada caso segura, numa transação do teste, uma trava que a primeira operação
 * toma depois da raiz, e prova pelo `pg_blocking_pids` quem parou em quem.
 */

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let app: App;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
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
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  await app?.close();
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Pedido de 100 kg, todo reservado num lote só, com a Expedição em rascunho e o
 * lote já conferido — pronta para confirmar. Uma linha só: a edição reescreve
 * as linhas, e com uma linha o ponto em que ela para é um só.
 */
async function rascunhoConferido() {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-CORRIDA-${m}`,
      name: `Produto Acabado Corrida ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  const lot = await prisma.lot.create({
    data: {
      code: `LT-CORRIDA-${m}`.toUpperCase(),
      origin: "RECEIPT",
      itemId: item.id,
      initialReceivedQuantity: "1000",
      status: "AVAILABLE",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId: item.id,
      lotId: lot.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity: "1000",
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "Teste",
    },
  });

  const customerId = await fixtureCustomerId();
  const product = await app.inject({
    method: "POST",
    url: "/products",
    payload: { customerId, name: `Produto Corrida ${m}`, finishedProductItemId: item.id },
  });
  expect(product.statusCode, product.body).toBe(201);
  fixtureProductIds.push(product.json().id);

  const created = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: { customerId, lines: [{ productId: product.json().id, orderedQuantity: "100" }] },
  });
  expect(created.statusCode, created.body).toBe(201);
  const orderId: string = created.json().id;
  fixtureCustomerOrderIds.push(orderId);
  const confirmed = await app.inject({ method: "POST", url: `/customer-orders/${orderId}/confirm` });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  const plano = await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
    payload: {
      lines: [{ customerOrderLineId: confirmed.json().lines[0].id, reserveQuantity: "100", produceQuantity: "0" }],
    },
  });
  expect(plano.statusCode, plano.body).toBe(200);

  const draft = await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` });
  expect(draft.statusCode, draft.body).toBe(201);
  const shipment = draft.json();
  expect(shipment.lines).toHaveLength(1);
  const line = shipment.lines[0];
  const verified = await conferir(shipment.id, line.id, lot.code);
  expect(verified.statusCode, verified.body).toBe(200);

  return {
    itemId: item.id,
    lotCode: lot.code,
    orderId,
    shipmentId: shipment.id as string,
    lineId: line.id as string,
    reservationLineId: line.customerOrderReservationLineId as string,
  };
}

function confirmar(shipmentId: string) {
  return app.inject({ method: "POST", url: `/shipments/${shipmentId}/confirm` });
}

function cancelar(shipmentId: string) {
  return app.inject({
    method: "POST",
    url: `/shipments/${shipmentId}/cancel`,
    payload: { reason: "Cliente desistiu da entrega" },
  });
}

function editar(shipmentId: string, reservationLineId: string, quantity: string) {
  return app.inject({
    method: "PATCH",
    url: `/shipments/${shipmentId}`,
    payload: { lines: [{ customerOrderReservationLineId: reservationLineId, quantity }] },
  });
}

function conferir(shipmentId: string, lineId: string, lotCode: string) {
  return app.inject({
    method: "POST",
    url: `/shipments/${shipmentId}/lines/${lineId}/verify`,
    payload: { lotCode },
  });
}

async function saldoFisico(itemId: string): Promise<string> {
  const resposta = await app.inject({ method: "GET", url: `/inventory/${itemId}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json().onHand;
}

/**
 * A Expedição e as saídas dela, lidas do banco. Invariantes que nenhuma
 * intercalação pode quebrar:
 * - fora de CONFIRMED, nenhum SHIPMENT_OUT;
 * - em CONFIRMED, exatamente um SHIPMENT_OUT por linha com quantidade, com a
 *   mesma quantidade, apontando para uma linha que existe e tem o retrato da
 *   confirmação.
 */
async function conferirInvariantes(shipmentId: string) {
  const prisma = getPrisma();
  const shipment = await prisma.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  const saidas = await prisma.inventoryMovement.findMany({
    where: { type: "SHIPMENT_OUT", sourceType: "SHIPMENT", sourceId: shipmentId },
  });
  if (shipment.status !== "CONFIRMED") {
    expect(saidas, `Expedição ${shipment.status} com SHIPMENT_OUT`).toHaveLength(0);
    return { shipment, saidas };
  }
  const linhas = shipment.lines.filter((linha) => linha.quantity.greaterThan(0));
  expect(saidas, "uma saída por linha confirmada").toHaveLength(linhas.length);
  for (const linha of linhas) {
    const saida = saidas.find((movimento) => movimento.shipmentLineId === linha.id);
    expect(saida, `saída da linha ${linha.id}`).toBeDefined();
    expect(saida!.quantity.toString()).toBe(linha.quantity.toString());
    expect(linha.productCode, "retrato da confirmação na linha").not.toBeNull();
  }
  return { shipment, saidas };
}

describe("Expedição — confirmar × cancelar (R-S1)", () => {
  it("o cancelamento espera a confirmação, relê CONFIRMED e recusa: nenhuma saída sem Expedição válida", async () => {
    const f = await rascunhoConferido();

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let confirmacao!: ReturnType<typeof confirmar>;
    let cancelamento!: ReturnType<typeof cancelar>;
    try {
      // A confirmação trava a Expedição e, logo depois, o Pedido: o teste
      // segura o Pedido, e ela para ali com a Expedição já travada.
      await t0.tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${f.orderId} FOR UPDATE`;
      confirmacao = confirmar(f.shipmentId);
      disparadas.push(confirmacao);
      const pidConfirmacao = await esperarParadaEm(t0.pid, "a confirmação parar no Pedido");

      cancelamento = cancelar(f.shipmentId);
      disparadas.push(cancelamento);
      await esperarParadaEm(pidConfirmacao, "o cancelamento parar na Expedição da confirmação");
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    // Primeiro o que o banco guardou; depois o que cada rota respondeu.
    const { shipment, saidas } = await conferirInvariantes(f.shipmentId);
    expect(shipment.status).toBe("CONFIRMED");
    expect(shipment.cancelledAt).toBeNull();
    expect(shipment.cancelReason).toBeNull();
    expect(saidas).toHaveLength(1);
    expect(await saldoFisico(f.itemId)).toBe("900");

    const confirmada = await confirmacao;
    const cancelada = await cancelamento;
    expect(confirmada.statusCode, confirmada.body).toBe(200);
    expect(cancelada.statusCode, cancelada.body).toBe(400);
    expect(cancelada.json().error).toBe("shipment_not_draft");
  });

  it("cancelar vence primeiro: a confirmação espera, relê CANCELLED e recusa — nenhum SHIPMENT_OUT", async () => {
    const f = await rascunhoConferido();

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let confirmacao!: ReturnType<typeof confirmar>;
    let cancelamento!: ReturnType<typeof cancelar>;
    try {
      // O teste segura a própria Expedição: o cancelamento chega primeiro à
      // fila e a confirmação entra atrás dele.
      await t0.tx.$queryRaw`SELECT id FROM shipments WHERE id = ${f.shipmentId} FOR UPDATE`;
      cancelamento = cancelar(f.shipmentId);
      disparadas.push(cancelamento);
      const pidCancelamento = await esperarParadaEm(t0.pid, "o cancelamento parar na Expedição");

      confirmacao = confirmar(f.shipmentId);
      disparadas.push(confirmacao);
      await esperarAte("a confirmação entrar na fila da Expedição", async () => {
        const paradas = new Set([...(await paradasEm(t0.pid)), ...(await paradasEm(pidCancelamento))]);
        paradas.delete(pidCancelamento);
        return paradas.size > 0;
      });
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    const { shipment, saidas } = await conferirInvariantes(f.shipmentId);
    expect(shipment.status).toBe("CANCELLED");
    expect(shipment.cancelReason).toBe("Cliente desistiu da entrega");
    expect(saidas).toHaveLength(0);
    expect(await saldoFisico(f.itemId)).toBe("1000");

    const cancelada = await cancelamento;
    const confirmada = await confirmacao;
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    expect(confirmada.statusCode, confirmada.body).toBe(400);
    expect(confirmada.json().error).toBe("shipment_not_draft");
  });
});

describe("Expedição — editar ou conferir × confirmar (R-S2)", () => {
  it("a edição que leu o rascunho antes da confirmação não apaga a linha confirmada nem o SHIPMENT_OUT", async () => {
    const f = await rascunhoConferido();

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let edicao!: ReturnType<typeof editar>;
    let confirmacao!: ReturnType<typeof confirmar>;
    try {
      // A edição reescreve a separação: DELETE das linhas e INSERT das novas.
      // O teste segura a linha em FOR KEY SHARE — o DELETE espera, e a
      // confirmação, que só grava colunas que não são chave, passaria.
      await t0.tx.$queryRaw`SELECT id FROM shipment_lines WHERE "shipmentId" = ${f.shipmentId} FOR KEY SHARE`;
      edicao = editar(f.shipmentId, f.reservationLineId, "80");
      disparadas.push(edicao);
      const pidEdicao = await esperarParadaEm(t0.pid, "a edição parar no DELETE da linha");

      confirmacao = confirmar(f.shipmentId);
      disparadas.push(confirmacao);
      // Com a Expedição travada pela edição, a confirmação espera por ela. Sem
      // essa trava, a confirmação correria inteira aqui — e a edição apagaria
      // depois o que ela confirmou.
      const confirmacaoAcompanhada = acompanhar(confirmacao);
      await esperarAte(
        "a confirmação parar na edição ou terminar",
        async () => confirmacaoAcompanhada.terminou() || (await paradasEm(pidEdicao)).length > 0,
      );
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    // A edição entrou primeiro; a confirmação expediu o que ela deixou.
    const { shipment, saidas } = await conferirInvariantes(f.shipmentId);
    expect(shipment.status).toBe("CONFIRMED");
    expect(shipment.lines).toHaveLength(1);
    expect(saidas).toHaveLength(1);
    expect(saidas[0]!.quantity.toString()).toBe("80");
    expect(await saldoFisico(f.itemId)).toBe("920");

    const editada = await edicao;
    const confirmada = await confirmacao;
    expect(editada.statusCode, editada.body).toBe(200);
    expect(confirmada.statusCode, confirmada.body).toBe(200);
  });

  it("confirmar vence primeiro: a edição espera, relê CONFIRMED e recusa sem tocar na linha nem no movimento", async () => {
    const f = await rascunhoConferido();

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let confirmacao!: ReturnType<typeof confirmar>;
    let edicao!: ReturnType<typeof editar>;
    try {
      await t0.tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${f.orderId} FOR UPDATE`;
      confirmacao = confirmar(f.shipmentId);
      disparadas.push(confirmacao);
      const pidConfirmacao = await esperarParadaEm(t0.pid, "a confirmação parar no Pedido");

      edicao = editar(f.shipmentId, f.reservationLineId, "80");
      disparadas.push(edicao);
      await esperarParadaEm(pidConfirmacao, "a edição parar na Expedição da confirmação");
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    // A linha histórica é a mesma de antes, com a quantidade confirmada.
    const { shipment, saidas } = await conferirInvariantes(f.shipmentId);
    expect(shipment.status).toBe("CONFIRMED");
    expect(shipment.lines.map((linha) => linha.id)).toEqual([f.lineId]);
    expect(shipment.lines[0]!.quantity.toString()).toBe("100");
    expect(saidas).toHaveLength(1);
    expect(saidas[0]!.shipmentLineId).toBe(f.lineId);
    expect(await saldoFisico(f.itemId)).toBe("900");

    const confirmada = await confirmacao;
    const editada = await edicao;
    expect(confirmada.statusCode, confirmada.body).toBe(200);
    expect(editada.statusCode, editada.body).toBe(400);
    expect(editada.json().error).toBe("shipment_not_draft");
  });

  it("conferência × confirmação: a conferência espera, relê CONFIRMED e recusa — a conferência gravada não muda", async () => {
    const f = await rascunhoConferido();
    const prisma = getPrisma();
    const antes = await prisma.shipmentLine.findUniqueOrThrow({ where: { id: f.lineId } });
    expect(antes.verifiedAt).not.toBeNull();

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let confirmacao!: ReturnType<typeof confirmar>;
    let conferencia!: ReturnType<typeof conferir>;
    try {
      await t0.tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${f.orderId} FOR UPDATE`;
      confirmacao = confirmar(f.shipmentId);
      disparadas.push(confirmacao);
      const pidConfirmacao = await esperarParadaEm(t0.pid, "a confirmação parar no Pedido");

      // Segunda leitura do mesmo lote — o operador escaneou de novo.
      conferencia = conferir(f.shipmentId, f.lineId, f.lotCode);
      disparadas.push(conferencia);
      const conferenciaAcompanhada = acompanhar(conferencia);
      await esperarAte(
        "a conferência parar na confirmação ou terminar",
        async () => conferenciaAcompanhada.terminou() || (await paradasEm(pidConfirmacao)).length > 0,
      );
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    const { shipment } = await conferirInvariantes(f.shipmentId);
    expect(shipment.status).toBe("CONFIRMED");
    expect(shipment.lines[0]!.verifiedAt?.toISOString()).toBe(antes.verifiedAt!.toISOString());
    expect(shipment.lines[0]!.verifiedBy).toBe(antes.verifiedBy);

    const confirmada = await confirmacao;
    const conferida = await conferencia;
    expect(confirmada.statusCode, confirmada.body).toBe(200);
    expect(conferida.statusCode, conferida.body).toBe(400);
    expect(conferida.json().error).toBe("shipment_not_draft");
  });
});

describe("Expedição — conflito de concorrência vira 409", () => {
  it("o cancelamento cuja transação expira esperando a trava devolve 409 concurrent_write e não grava nada", async () => {
    const f = await rascunhoConferido();

    const t0 = await abrirTransacaoDoTeste();
    let cancelamento!: ReturnType<typeof cancelar>;
    try {
      await t0.tx.$queryRaw`SELECT id FROM shipments WHERE id = ${f.shipmentId} FOR UPDATE`;
      cancelamento = cancelar(f.shipmentId);
      await esperarParadaEm(t0.pid, "o cancelamento parar na Expedição");
      // A transação interativa do serviço vale 5 s. Segurar além disso é o que
      // produz o P2028 — a espera aqui é o gatilho, não a prova de ordem.
      await new Promise((resolve) => setTimeout(resolve, 5_500));
    } finally {
      await t0.soltar();
    }

    const { shipment } = await conferirInvariantes(f.shipmentId);
    expect(shipment.status).toBe("DRAFT");
    expect(shipment.cancelledAt).toBeNull();
    expect(shipment.cancelReason).toBeNull();

    const resposta = await cancelamento;
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json().error).toBe("concurrent_write");
  }, 20_000);
});
