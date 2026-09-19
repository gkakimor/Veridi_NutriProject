import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import {
  abrirTransacaoDoTeste,
  esperarAte,
  esperarParadaEm,
  paradasEm,
} from "../../test-support/corrida-sob-trava.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Cancelar OP sob concorrência (DOCUMENT-TRANSITION-CONCURRENCY-01, risco R-O1
 * do discovery).
 *
 * Consumo e pesagem travam a OP, baixam estoque e, no primeiro consumo, levam
 * a ordem de LIBERADA a EM PRODUÇÃO. O cancelamento decidia sobre uma leitura
 * sem trava: via LIBERADA, liberava a reserva e esperava só no UPDATE — que,
 * depois do commit do consumo, gravava CANCELADA por cima de EM PRODUÇÃO, com
 * consumo real e reserva liberada.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let app: App;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    const parts = await prisma.productionOrderPart.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    await prisma.recipeWeighing.deleteMany({
      where: { productionOrderPartId: { in: parts.map((row) => row.id) } },
    });
    await prisma.productionOrderPart.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.inventoryMovement.deleteMany({
      where: { productionConsumption: { productionOrderId: { in: fixtureProductionOrderIds } } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    await prisma.materialReservationLine.deleteMany({
      where: { reservationId: { in: reservations.map((row) => row.id) } },
    });
    await prisma.materialReservation.deleteMany({
      where: { id: { in: reservations.map((row) => row.id) } },
    });
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    const versions = await prisma.formulationVersion.findMany({
      where: { productId: { in: fixtureProductIds } },
      select: { id: true },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersionId: { in: versions.map((row) => row.id) } },
    });
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
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function criarItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", controlsLot: boolean) {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-CORRIDA-${m}`,
      name: `Item Corrida OP ${m}`,
      unitCode: type === "RAW_MATERIAL" ? "kg" : "un",
      controlsLot,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/** Saldo de 100 kg — com lote quando o item controla lote. */
async function estocar(itemId: string, comLote: boolean) {
  const prisma = getPrisma();
  const lot = comLote
    ? await prisma.lot.create({
        data: {
          code: `LT-CORRIDA-OP-${marker()}`,
          itemId,
          initialReceivedQuantity: "100",
          status: "AVAILABLE",
        },
      })
    : null;
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot?.id ?? null,
      type: "RECEIPT_IN",
      quantity: "100",
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
  return lot;
}

/**
 * OP LIBERADA de 1 un de um produto cuja formulação pede 30 kg de uma
 * matéria-prima — reserva feita e parte criada, pronta para consumir ou pesar.
 */
async function opLiberada(options: { comLote: boolean }) {
  const materiaPrima = await criarItem("RAW_MATERIAL", options.comLote);
  const lot = await estocar(materiaPrima.id, options.comLote);
  const acabado = await criarItem("FINISHED_PRODUCT", true);

  const product = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: await fixtureCustomerId(),
      name: `Produto Corrida OP ${marker()}`,
      finishedProductItemId: acabado.id,
    },
  });
  expect(product.statusCode, product.body).toBe(201);
  const productId: string = product.json().id;
  fixtureProductIds.push(productId);

  const versao = await app.inject({
    method: "POST",
    url: `/products/${productId}/formulation-versions`,
    payload: {},
  });
  const versionId: string = versao.json().id;
  const componentes = await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: { basisQuantity: "1", components: [{ itemId: materiaPrima.id, quantity: "30", unitCode: "kg" }] },
  });
  expect(componentes.statusCode, componentes.body).toBe(200);
  const ativa = await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });
  expect(ativa.statusCode, ativa.body).toBe(200);

  const criada = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity: "1", numberOfParts: 1 },
  });
  expect(criada.statusCode, criada.body).toBe(201);
  const orderId: string = criada.json().id;
  fixtureProductionOrderIds.push(orderId);
  await aplicarRoteiroDeTeste(orderId);
  const planejada = await app.inject({ method: "POST", url: `/production-orders/${orderId}/plan` });
  expect(planejada.statusCode, planejada.body).toBe(200);
  const liberada = await app.inject({ method: "POST", url: `/production-orders/${orderId}/release` });
  expect(liberada.statusCode, liberada.body).toBe(200);
  const order = liberada.json();
  expect(order.status).toBe("RELEASED");

  return {
    orderId,
    requirementId: order.requirements[0].id as string,
    lineId: order.requirements[0].reservationLines[0].id as string,
    lotCode: lot?.code ?? null,
  };
}

function cancelar(orderId: string) {
  return app.inject({
    method: "POST",
    url: `/production-orders/${orderId}/cancel`,
    payload: { reason: "Cliente cancelou o pedido" },
  });
}

function consumir(orderId: string, lineId: string) {
  return app.inject({
    method: "POST",
    url: `/production-orders/${orderId}/consumptions`,
    payload: { entries: [{ reservationLineId: lineId, quantity: "10" }] },
  });
}

function pesar(orderId: string, requirementId: string, lotCode: string) {
  return app.inject({
    method: "POST",
    url: `/production-orders/${orderId}/parts/1/weighings`,
    payload: { requirementId, lotCode, actualQuantity: "10" },
  });
}

/**
 * A OP, a reserva e o consumo dela, lidos do banco. Invariante que nenhuma
 * intercalação pode quebrar: OP CANCELADA não tem consumo nem movimento de
 * consumo, e a reserva dela está liberada; OP com consumo está EM PRODUÇÃO com a
 * reserva ativa.
 */
async function conferirInvariantes(orderId: string) {
  const prisma = getPrisma();
  const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
  const consumos = await prisma.productionConsumption.findMany({ where: { productionOrderId: orderId } });
  const movimentos = await prisma.inventoryMovement.findMany({
    where: { type: "PRODUCTION_CONSUMPTION", sourceId: orderId },
  });
  const reservas = await prisma.materialReservation.findMany({ where: { productionOrderId: orderId } });
  expect(movimentos, "um movimento por consumo").toHaveLength(consumos.length);
  if (order.status === "CANCELLED") {
    expect(consumos, "OP CANCELADA com consumo").toHaveLength(0);
    expect(reservas.every((reserva) => reserva.status === "RELEASED"), "reserva da OP cancelada liberada").toBe(true);
  }
  if (consumos.length > 0) {
    expect(order.status, "OP com consumo real").toBe("IN_PRODUCTION");
    expect(reservas.map((reserva) => reserva.status)).toEqual(["ACTIVE"]);
  }
  return { order, consumos, reservas };
}

describe("OP — consumo ou pesagem × cancelar (R-O1)", () => {
  it("o cancelamento espera o consumo, relê EM PRODUÇÃO e recusa: nada de OP cancelada com consumo", async () => {
    const f = await opLiberada({ comLote: false });
    const picking = await app.inject({
      method: "POST",
      url: `/production-orders/${f.orderId}/picking/${f.lineId}/confirm`,
      payload: {},
    });
    expect(picking.statusCode, picking.body).toBe(200);

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let consumo!: ReturnType<typeof consumir>;
    let cancelamento!: ReturnType<typeof cancelar>;
    try {
      // O consumo trava a OP e, logo depois, as linhas de reserva: o teste
      // segura a linha, e ele para ali com a OP já travada.
      await t0.tx.$queryRaw`SELECT id FROM material_reservation_lines WHERE id = ${f.lineId} FOR UPDATE`;
      consumo = consumir(f.orderId, f.lineId);
      disparadas.push(consumo);
      const pidConsumo = await esperarParadaEm(t0.pid, "o consumo parar na linha de reserva");

      cancelamento = cancelar(f.orderId);
      disparadas.push(cancelamento);
      await esperarParadaEm(pidConsumo, "o cancelamento parar na OP do consumo");
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    const { order, consumos } = await conferirInvariantes(f.orderId);
    expect(order.status).toBe("IN_PRODUCTION");
    expect(order.cancelledAt).toBeNull();
    expect(order.cancelReason).toBeNull();
    expect(consumos).toHaveLength(1);

    const consumido = await consumo;
    const cancelada = await cancelamento;
    expect(consumido.statusCode, consumido.body).toBe(201);
    expect(cancelada.statusCode, cancelada.body).toBe(400);
    expect(cancelada.json().error).toBe("invalid_transition");
  });

  it("pesagem × cancelar: o cancelamento espera a pesagem, relê EM PRODUÇÃO e recusa", async () => {
    const f = await opLiberada({ comLote: true });

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let pesagem!: ReturnType<typeof pesar>;
    let cancelamento!: ReturnType<typeof cancelar>;
    try {
      // A pesagem trava a OP e marca a conferência da linha de reserva: o
      // teste segura a linha, e ela para ali com a OP já travada.
      await t0.tx.$queryRaw`SELECT id FROM material_reservation_lines WHERE id = ${f.lineId} FOR UPDATE`;
      pesagem = pesar(f.orderId, f.requirementId, f.lotCode!);
      disparadas.push(pesagem);
      const pidPesagem = await esperarParadaEm(t0.pid, "a pesagem parar na linha de reserva");

      cancelamento = cancelar(f.orderId);
      disparadas.push(cancelamento);
      await esperarParadaEm(pidPesagem, "o cancelamento parar na OP da pesagem");
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    const { order, consumos } = await conferirInvariantes(f.orderId);
    expect(order.status).toBe("IN_PRODUCTION");
    expect(order.cancelledAt).toBeNull();
    expect(consumos).toHaveLength(1);
    const pesagens = await getPrisma().recipeWeighing.count({
      where: { productionOrderPart: { productionOrderId: f.orderId } },
    });
    expect(pesagens).toBe(1);

    const pesada = await pesagem;
    const cancelada = await cancelamento;
    expect(pesada.statusCode, pesada.body).toBe(201);
    expect(cancelada.statusCode, cancelada.body).toBe(400);
    expect(cancelada.json().error).toBe("invalid_transition");
  });

  it("cancelar vence primeiro: o consumo espera, relê CANCELADA e recusa — reserva liberada, nenhum consumo", async () => {
    const f = await opLiberada({ comLote: false });
    const picking = await app.inject({
      method: "POST",
      url: `/production-orders/${f.orderId}/picking/${f.lineId}/confirm`,
      payload: {},
    });
    expect(picking.statusCode, picking.body).toBe(200);

    const t0 = await abrirTransacaoDoTeste();
    const disparadas: Promise<unknown>[] = [];
    let cancelamento!: ReturnType<typeof cancelar>;
    let consumo!: ReturnType<typeof consumir>;
    try {
      // O teste segura a própria OP: o cancelamento chega primeiro à fila e o
      // consumo entra atrás dele.
      await t0.tx.$queryRaw`SELECT id FROM production_orders WHERE id = ${f.orderId} FOR UPDATE`;
      cancelamento = cancelar(f.orderId);
      disparadas.push(cancelamento);
      const pidCancelamento = await esperarParadaEm(t0.pid, "o cancelamento parar na OP");

      consumo = consumir(f.orderId, f.lineId);
      disparadas.push(consumo);
      await esperarAte("o consumo entrar na fila da OP", async () => {
        const paradas = new Set([...(await paradasEm(t0.pid)), ...(await paradasEm(pidCancelamento))]);
        paradas.delete(pidCancelamento);
        return paradas.size > 0;
      });
    } finally {
      await t0.soltar();
      await Promise.allSettled(disparadas);
    }

    const { order, consumos, reservas } = await conferirInvariantes(f.orderId);
    expect(order.status).toBe("CANCELLED");
    expect(order.cancelReason).toBe("Cliente cancelou o pedido");
    expect(consumos).toHaveLength(0);
    expect(reservas.map((reserva) => reserva.status)).toEqual(["RELEASED"]);

    const cancelada = await cancelamento;
    const consumido = await consumo;
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    expect(consumido.statusCode, consumido.body).toBe(400);
    expect(consumido.json().error).toBe("order_not_released");
  });
});

describe("OP — conflito de concorrência vira 409", () => {
  it("o cancelamento escolhido como vítima de um deadlock devolve 409 concurrent_write e não grava nada", async () => {
    const f = await opLiberada({ comLote: false });

    const t0 = await abrirTransacaoDoTeste();
    let cancelamento!: ReturnType<typeof cancelar>;
    try {
      // O cancelamento trava a OP e depois libera a reserva: o teste segura a
      // reserva, e ele para ali com a OP travada. Quando o teste pede a OP, as
      // duas transações esperam uma pela outra — o banco derruba a que esperava
      // antes, o cancelamento.
      await t0.tx.$queryRaw`SELECT id FROM material_reservations WHERE "productionOrderId" = ${f.orderId} FOR UPDATE`;
      cancelamento = cancelar(f.orderId);
      await esperarParadaEm(t0.pid, "o cancelamento parar na reserva");
      await t0.tx.$queryRaw`SELECT id FROM production_orders WHERE id = ${f.orderId} FOR UPDATE`;
    } finally {
      await t0.soltar();
    }

    const { order, reservas } = await conferirInvariantes(f.orderId);
    expect(order.status).toBe("RELEASED");
    expect(order.cancelledAt).toBeNull();
    expect(reservas.map((reserva) => reserva.status)).toEqual(["ACTIVE"]);

    const resposta = await cancelamento;
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json().error).toBe("concurrent_write");
  }, 20_000);
});
