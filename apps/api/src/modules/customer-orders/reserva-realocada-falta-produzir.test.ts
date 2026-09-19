import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { marcadorDoDiaComercialDeTeste } from "../../test-support/dia-comercial.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * Reserva realocada não conta duas vezes no "falta produzir" —
 * VERIDI-AUDIT-QUICK-FIXES-01, D3.
 *
 * Realocar (lote reservado venceu) libera a linha original — ela fica como
 * histórico, com `releasedAt` e a quantidade de quando nasceu — e cria linhas
 * novas no lote elegível. O Pedido somava as DUAS no reservado restante:
 * pedido de 100 com 60 reservados, depois de realocar os 60, "via" 120
 * reservados e zerava a falta de produção. Os 40 que ninguém produz somem da
 * tela, e a OP do saldo passa a ser recusada.
 *
 * O histórico continua na reserva; ele só não compõe o reservado efetivo — a
 * mesma régua (`releasedAt: null`) da Expedição e do ledger.
 */

const app = buildTestApp();
const pedidoIds: string[] = [];
const produtoIds: string[] = [];
const itemIds: string[] = [];

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

beforeAll(async () => {
  const unidade: { code: string; label: string; dimension: UomDimension; toBaseFactor: string } = {
    code: "un",
    label: "Unidade",
    dimension: "COUNT",
    toBaseFactor: "1",
  };
  await getPrisma().unitOfMeasure.upsert({ where: { code: unidade.code }, update: {}, create: unidade });
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (pedidoIds.length > 0) {
    await prisma.productionOrder.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: pedidoIds } }, replacesLineId: { not: null } },
    });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: pedidoIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.customerOrder.deleteMany({ where: { id: { in: pedidoIds } } });
  }
  if (produtoIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: produtoIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  await app.close();
});

async function loteDeAcabado(itemId: string, quantidade: string, validade: Date) {
  const prisma = getPrisma();
  const lote = await prisma.lot.create({
    data: {
      code: `LT-D3R-${marca()}`.toUpperCase(),
      origin: "PRODUCTION",
      itemId,
      initialReceivedQuantity: quantidade,
      status: "AVAILABLE",
      expiryDate: validade,
      createdBy: "Teste",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lote.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity: quantidade,
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "Teste",
    },
  });
  return lote;
}

/**
 * Pedido de 100: 60 reservados do lote A e 40 mandados produzir — e a OP dos
 * 40 cancelada. Sobra o caso que interessa: 40 que ninguém vai produzir.
 */
async function pedidoCom60Reservados() {
  const prisma = getPrisma();
  const m = marca();
  const acabado = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-D3R-${m}`,
      name: `PA reserva realocada ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: false,
    },
  });
  itemIds.push(acabado.id);
  const loteA = await loteDeAcabado(acabado.id, "60", marcadorDoDiaComercialDeTeste(10));

  const customerId = await fixtureCustomerId();
  const produto = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId, name: `Produto reserva realocada ${m}`, finishedProductItemId: acabado.id },
    })
  ).json();
  produtoIds.push(produto.id);

  const criado = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId, lines: [{ productId: produto.id, orderedQuantity: "100" }] },
    })
  ).json();
  pedidoIds.push(criado.id);
  const confirmado = (await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })).json();
  const lineId = confirmado.lines[0].id as string;

  const aplicado = await app.inject({
    method: "POST",
    url: `/customer-orders/${criado.id}/apply-fulfillment-plan`,
    payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: "60", produceQuantity: "40" }] },
  });
  expect(aplicado.statusCode, aplicado.body).toBe(200);
  const opId = aplicado.json().generatedProductionOrders[0].id as string;
  const cancelada = await app.inject({
    method: "POST",
    url: `/production-orders/${opId}/cancel`,
    payload: { reason: "Teste D3: produção dos 40 suspensa" },
  });
  expect(cancelada.statusCode, cancelada.body).toBe(200);

  return { orderId: criado.id as string, lineId, acabado, loteA };
}

describe("D3 — linha de reserva liberada fica no histórico, fora do reservado efetivo", () => {
  it("realocar os 60 reservados mantém a falta de produção em 40 e a OP do saldo possível", async () => {
    const { orderId, lineId, acabado, loteA } = await pedidoCom60Reservados();

    const antes = (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json();
    // 100 pedidos − 60 reservados − OP cancelada = 40 a produzir.
    expect(antes.lines[0].pendingProductionQuantity).toBe("40");
    const linhaOriginalId = antes.reservation.lines[0].id as string;

    // O lote A vence com a reserva em cima; chega um lote B novo.
    await getPrisma().lot.update({ where: { id: loteA.id }, data: { expiryDate: marcadorDoDiaComercialDeTeste(-1) } });
    const loteB = await loteDeAcabado(acabado.id, "60", marcadorDoDiaComercialDeTeste(90));

    const realocado = await app.inject({
      method: "POST",
      url: `/customer-orders/${orderId}/reallocate-reservation-line`,
      payload: { customerOrderReservationLineId: linhaOriginalId },
    });
    expect(realocado.statusCode, realocado.body).toBe(200);

    const depois = (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json();

    // O histórico continua lá, inteiro: a linha liberada e a que a substituiu.
    const original = depois.reservation.lines.find((l: { id: string }) => l.id === linhaOriginalId);
    expect(original.releasedAt).not.toBeNull();
    expect(original.quantity).toBe("60");
    expect(original.lotId).toBe(loteA.id);
    const nova = depois.reservation.lines.find(
      (l: { replacesLineId: string | null }) => l.replacesLineId === linhaOriginalId,
    );
    expect(nova.lotId).toBe(loteB.id);
    expect(nova.quantity).toBe("60");

    // Reservado efetivo continua 60 — a falta de produção continua 40.
    expect(depois.lines[0].pendingProductionQuantity, "falta produzir depois da realocação").toBe("40");

    // A OP do saldo refaz a conta sob trava: os 40 continuam produzíveis.
    const saldo = await app.inject({
      method: "POST",
      url: `/customer-orders/${orderId}/remainder-production-order`,
      payload: { customerOrderLineId: lineId },
    });
    expect(saldo.statusCode, saldo.body).toBe(201);
    const ops = saldo.json().generatedProductionOrders as { plannedQuantity: string; status: string }[];
    expect(ops.filter((op) => op.status !== "CANCELLED").map((op) => op.plannedQuantity)).toEqual(["40"]);
    expect(saldo.json().lines[0].pendingProductionQuantity).toBe("0");
  });
});
