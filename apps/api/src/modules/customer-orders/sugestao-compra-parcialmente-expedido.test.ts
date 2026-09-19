import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";

/**
 * Sugestão de Compra depois da expedição parcial —
 * VERIDI-AUDIT-QUICK-FIXES-01, D5.
 *
 * Expedir parte do Pedido o leva a PARTIALLY_SHIPPED, e o Pedido continua
 * operacional: reservar, realocar e gerar OP do saldo seguem aceitos. A OP
 * que ainda vai produzir o resto pode ter falta de material — e a Sugestão de
 * Compra recusava tudo que não fosse IN_FULFILLMENT. O "Ver sugestão de
 * compra" da OP levava a um Pedido sem a funcionalidade.
 *
 * Pedido finalizado (SHIPPED) continua fora: não há o que suprir.
 */

const app = buildTestApp();
const pedidoIds: string[] = [];
const produtoIds: string[] = [];
const itemIds: string[] = [];
const fornecedorIds: string[] = [];

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

beforeAll(async () => {
  const unidade: { code: string; label: string; dimension: UomDimension; toBaseFactor: string } = {
    code: "kg",
    label: "Quilograma",
    dimension: "MASS",
    toBaseFactor: "1000",
  };
  await getPrisma().unitOfMeasure.upsert({ where: { code: unidade.code }, update: {}, create: unidade });
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (pedidoIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrder: { customerOrderId: { in: pedidoIds } } } });
    await prisma.purchaseOrder.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.shipmentLine.deleteMany({ where: { shipment: { customerOrderId: { in: pedidoIds } } } });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrder: { customerOrderId: { in: pedidoIds } } },
    });
    await prisma.productionOrder.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: pedidoIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.customerOrder.deleteMany({ where: { id: { in: pedidoIds } } });
  }
  if (produtoIds.length > 0) {
    const versoes = await prisma.formulationVersion.findMany({
      where: { productId: { in: produtoIds } },
      select: { id: true },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersionId: { in: versoes.map((versao) => versao.id) } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: produtoIds } } });
    await prisma.product.deleteMany({ where: { id: { in: produtoIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (fornecedorIds.length > 0) {
    await prisma.purchaseOrder.deleteMany({ where: { supplierId: { in: fornecedorIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: fornecedorIds } } });
  }
  await app.close();
});

async function criarItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const m = marca();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-D5S-${m}`,
      name: `Item D5 ${m}`,
      unitCode: "kg",
      controlsLot: type === "FINISHED_PRODUCT",
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  itemIds.push(item.id);
  return item;
}

async function estoqueDeAcabado(itemId: string, quantidade: string) {
  const prisma = getPrisma();
  const lote = await prisma.lot.create({
    data: {
      code: `LT-D5S-${marca()}`.toUpperCase(),
      origin: "RECEIPT",
      itemId,
      initialReceivedQuantity: quantidade,
      status: "AVAILABLE",
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
}

/** Produto com 1 kg de `materialId` por kg produzido. */
async function produto(acabadoId: string, materialId: string) {
  const criado = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId: await fixtureCustomerId(), name: `Produto D5 ${marca()}`, finishedProductItemId: acabadoId },
    })
  ).json();
  produtoIds.push(criado.id);
  const versao = (
    await app.inject({ method: "POST", url: `/products/${criado.id}/formulation-versions`, payload: {} })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versao.id}`,
    payload: { basisQuantity: "1", components: [{ itemId: materialId, quantity: "1", unitCode: "kg" }] },
  });
  const ativada = await app.inject({ method: "POST", url: `/formulation-versions/${versao.id}/activate` });
  expect(ativada.statusCode, ativada.body).toBe(200);
  return criado as { id: string };
}

async function pedidoConfirmado(productId: string, quantidade: string) {
  const criado = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: await fixtureCustomerId(), lines: [{ productId, orderedQuantity: quantidade }] },
    })
  ).json();
  pedidoIds.push(criado.id);
  const confirmado = (await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })).json();
  return { id: criado.id as string, lineId: confirmado.lines[0].id as string };
}

async function aplicarPlano(orderId: string, lineId: string, reservar: string, produzir: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
    payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: reservar, produceQuantity: produzir }] },
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
}

/** Expede tudo o que está reservado: separa, confere os lotes e confirma. */
async function expedirReservado(orderId: string) {
  const rascunho = await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` });
  expect(rascunho.statusCode, rascunho.body).toBe(201);
  const expedicaoId = rascunho.json().id as string;
  const expedicao = (await app.inject({ method: "GET", url: `/shipments/${expedicaoId}` })).json();
  for (const linha of expedicao.lines as { id: string; lotCode: string; requiresVerification: boolean }[]) {
    if (!linha.requiresVerification) continue;
    await app.inject({
      method: "POST",
      url: `/shipments/${expedicaoId}/lines/${linha.id}/verify`,
      payload: { lotCode: linha.lotCode },
    });
  }
  const confirmada = await app.inject({ method: "POST", url: `/shipments/${expedicaoId}/confirm` });
  expect(confirmada.statusCode, confirmada.body).toBe(200);
}

async function situacao(orderId: string): Promise<string> {
  return (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json().status;
}

describe("D5 — expedição parcial não tira a Sugestão de Compra do Pedido", () => {
  it("Pedido PARTIALLY_SHIPPED com OP de saldo em falta: sugere e gera a OC", async () => {
    const material = await criarItem("RAW_MATERIAL");
    const acabado = await criarItem("FINISHED_PRODUCT");
    await estoqueDeAcabado(acabado.id, "60");
    const { id: productId } = await produto(acabado.id, material.id);

    // 100 pedidos: 60 do estoque, 40 a produzir — e o material dos 40 não existe.
    const pedido = await pedidoConfirmado(productId, "100");
    await aplicarPlano(pedido.id, pedido.lineId, "60", "40");
    await expedirReservado(pedido.id);
    expect(await situacao(pedido.id)).toBe("PARTIALLY_SHIPPED");

    const sugestao = await app.inject({ method: "GET", url: `/customer-orders/${pedido.id}/purchase-suggestion` });
    expect(sugestao.statusCode, `sugestão em PARTIALLY_SHIPPED: ${sugestao.body}`).toBe(200);
    const linha = (sugestao.json().rows as { itemId: string; operationalShortage: string; newSuggestedPurchase: string }[]).find(
      (row) => row.itemId === material.id,
    );
    expect(linha, "linha do material em falta").toBeDefined();
    expect(linha!.operationalShortage).toBe("40");
    expect(linha!.newSuggestedPurchase).toBe("40");

    const m = marca();
    const fornecedor = await getPrisma().supplier.create({
      data: { code: `FOR-D5S-${m}`, legalName: `Fornecedor D5 ${m}`, active: true },
    });
    fornecedorIds.push(fornecedor.id);
    const gerada = await app.inject({
      method: "POST",
      url: `/customer-orders/${pedido.id}/purchase-drafts`,
      payload: { lines: [{ itemId: material.id, supplierId: fornecedor.id, quantity: "40" }] },
    });
    expect(gerada.statusCode, `OC em PARTIALLY_SHIPPED: ${gerada.body}`).toBe(201);
    expect(gerada.json().linkedPurchaseOrders).toHaveLength(1);
    expect(gerada.json().linkedPurchaseOrders[0].status).toBe("DRAFT");
    // Gerar a OC não mexe no Pedido: continua parcialmente expedido.
    expect(await situacao(pedido.id)).toBe("PARTIALLY_SHIPPED");
  });

  it("Pedido finalizado (SHIPPED) continua fora da Sugestão de Compra", async () => {
    const material = await criarItem("RAW_MATERIAL");
    const acabado = await criarItem("FINISHED_PRODUCT");
    await estoqueDeAcabado(acabado.id, "10");
    const { id: productId } = await produto(acabado.id, material.id);

    const pedido = await pedidoConfirmado(productId, "10");
    await aplicarPlano(pedido.id, pedido.lineId, "10", "0");
    await expedirReservado(pedido.id);
    expect(await situacao(pedido.id)).toBe("SHIPPED");

    const sugestao = await app.inject({ method: "GET", url: `/customer-orders/${pedido.id}/purchase-suggestion` });
    expect(sugestao.statusCode).toBe(400);
    expect(sugestao.json().error).toBe("order_not_in_fulfillment");

    const m = marca();
    const fornecedor = await getPrisma().supplier.create({
      data: { code: `FOR-D5S-${m}`, legalName: `Fornecedor D5 ${m}`, active: true },
    });
    fornecedorIds.push(fornecedor.id);
    const gerada = await app.inject({
      method: "POST",
      url: `/customer-orders/${pedido.id}/purchase-drafts`,
      payload: { lines: [{ itemId: material.id, supplierId: fornecedor.id, quantity: "5" }] },
    });
    expect(gerada.statusCode).toBe(400);
    expect(gerada.json().error).toBe("order_not_in_fulfillment");
    expect(await situacao(pedido.id)).toBe("SHIPPED");
  });
});
