import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * Prazo e observações depois do plano — a regra do servidor que a tela
 * espelha (VERIDI-AUDIT-QUICK-FIXES-01, D6).
 *
 * Confirmado: previsão de entrega e observações seguem editáveis. Aplicado o
 * plano, o Pedido está em execução e é somente leitura — o prazo E a
 * observação são recusados com `order_locked`. Não há observação "à parte".
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

describe("D6 — prazo e observações: confirmado edita, depois do plano não", () => {
  it("CONFIRMED aceita; IN_FULFILLMENT recusa o prazo e a observação", async () => {
    const prisma = getPrisma();
    const m = marca();
    const acabado = await prisma.item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-D6P-${m}`,
        name: `PA prazo ${m}`,
        unitCode: "un",
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: false,
      },
    });
    itemIds.push(acabado.id);
    const lote = await prisma.lot.create({
      data: { code: `LT-D6P-${m}`.toUpperCase(), origin: "RECEIPT", itemId: acabado.id, initialReceivedQuantity: "10" },
    });
    await prisma.inventoryMovement.create({
      data: {
        itemId: acabado.id,
        lotId: lote.id,
        type: "FINISHED_GOOD_PRODUCTION",
        quantity: "10",
        occurredAt: new Date(),
        sourceType: "FINISHED_GOOD_PRODUCTION",
        createdBy: "Teste",
      },
    });

    const customerId = await fixtureCustomerId();
    const produto = (
      await app.inject({
        method: "POST",
        url: "/products",
        payload: { customerId, name: `Produto prazo ${m}`, finishedProductItemId: acabado.id },
      })
    ).json();
    produtoIds.push(produto.id);
    const criado = (
      await app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: { customerId, lines: [{ productId: produto.id, orderedQuantity: "10" }] },
      })
    ).json();
    pedidoIds.push(criado.id);
    const confirmado = (await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })).json();

    const noConfirmado = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${criado.id}`,
      payload: { requestedDeliveryDate: "2026-10-15", notes: "Entregar pela manhã" },
    });
    expect(noConfirmado.statusCode, noConfirmado.body).toBe(200);

    const plano = await app.inject({
      method: "POST",
      url: `/customer-orders/${criado.id}/apply-fulfillment-plan`,
      payload: { lines: [{ customerOrderLineId: confirmado.lines[0].id, reserveQuantity: "10", produceQuantity: "0" }] },
    });
    expect(plano.statusCode, plano.body).toBe(200);
    expect(plano.json().status).toBe("IN_FULFILLMENT");

    const prazo = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${criado.id}`,
      payload: { requestedDeliveryDate: "2026-10-20" },
    });
    expect(prazo.statusCode).toBe(400);
    expect(prazo.json().error).toBe("order_locked");

    const observacao = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${criado.id}`,
      payload: { notes: "Mudou a janela de entrega" },
    });
    expect(observacao.statusCode).toBe(400);
    expect(observacao.json().error).toBe("order_locked");

    const depois = (await app.inject({ method: "GET", url: `/customer-orders/${criado.id}` })).json();
    expect(depois.notes).toBe("Entregar pela manhã");
    expect(depois.requestedDeliveryDate).toBe("2026-10-15T00:00:00.000Z");
  });
});
