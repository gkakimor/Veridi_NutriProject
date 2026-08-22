import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import type { MaterialImpactRowDTO } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * O Plano de Atendimento somava estoque de QUALQUER dono para um material
 * de responsabilidade do cliente: com 1,5 kg do cliente A e 1,0 kg do
 * cliente B, ele prometia 2,5 kg ao pedido do A e dizia "falta 0". A Ordem
 * de Produção, que usa o escopo de propriedade, dizia 1,5 e acusava a
 * falta — e é ela que reserva.
 *
 * Estes testes prendem as duas leituras juntas: o que o Plano projeta tem
 * de ser o que a OP encontra, senão a projeção promete material que a
 * fábrica não pode usar.
 */

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
    const ordens = await prisma.productionOrder.findMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
      select: { id: true },
    });
    const ordemIds = ordens.map((ordem) => ordem.id);
    if (ordemIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({
        where: { reservation: { productionOrderId: { in: ordemIds } } },
      });
      await prisma.materialReservation.deleteMany({
        where: { productionOrderId: { in: ordemIds } },
      });
      await prisma.productionOrderRequirement.deleteMany({
        where: { productionOrderId: { in: ordemIds } },
      });
    }
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
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarCliente(rotulo: string) {
  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-OW-${m}`, legalName: `Cliente ${rotulo} ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function criarItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-OW-${m}`,
      name: `Item owner ${m}`,
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

/** Lote com dono explícito — Veridi ou um Cliente específico. */
async function receberLote(
  itemId: string,
  quantity: string,
  dono: { ownerType: "VERIDI" } | { ownerType: "CUSTOMER"; customerId: string },
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-OW-${marca()}`.toUpperCase(),
      itemId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
      ownerType: dono.ownerType,
      ...(dono.ownerType === "CUSTOMER" ? { ownerCustomerId: dono.customerId } : {}),
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity,
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
  return lot;
}

async function criarProduto(
  app: App,
  customerId: string,
  componentes: {
    itemId: string;
    quantity: string;
    unitCode: string;
    supplyResponsibility: "VERIDI" | "CUSTOMER";
  }[],
) {
  const finishedItem = await criarItem("FINISHED_PRODUCT");
  const criado = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      name: `Produto owner ${marca()}`,
      finishedProductItemId: finishedItem.id,
      customerId,
    },
  });
  const product = criado.json();
  fixtureProductIds.push(product.id);

  const versao = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  const versionId = versao.json().id;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: { basisQuantity: "1", components: componentes },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });
  return { product, finishedItem };
}

async function pedidoConfirmado(app: App, customerId: string, productId: string, quantidade: string) {
  const criado = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: { customerId, lines: [{ productId, orderedQuantity: quantidade }] },
  });
  const id = criado.json().id;
  fixtureCustomerOrderIds.push(id);
  await app.inject({ method: "POST", url: `/customer-orders/${id}/confirm` });
  return id;
}

function linhaDoItem(plan: { materialImpact: MaterialImpactRowDTO[] }, itemId: string): MaterialImpactRowDTO {
  return plan.materialImpact.find((row) => row.itemId === itemId)!;
}

describe("Plano de Atendimento — escopo de propriedade", () => {
  it("o caso da auditoria: cliente A com 1,5 kg e cliente B com 1,0 kg — o pedido de A só enxerga 1,5", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente("A");
    const clienteB = await criarCliente("B");
    const material = await criarItem("RAW_MATERIAL");

    await receberLote(material.id, "1.5", { ownerType: "CUSTOMER", customerId: clienteA.id });
    await receberLote(material.id, "1", { ownerType: "CUSTOMER", customerId: clienteB.id });

    const { product } = await criarProduto(app, clienteA.id, [
      { itemId: material.id, quantity: "1.8367346938775510204", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const orderId = await pedidoConfirmado(app, clienteA.id, product.id, "1");

    const plano = await app.inject({ method: "GET", url: `/customer-orders/${orderId}/fulfillment-plan` });
    const linha = linhaDoItem(plano.json(), material.id);

    expect(linha.supplyResponsibility).toBe("CUSTOMER");
    expect(linha.ownerCustomerId).toBe(clienteA.id);
    expect(linha.onHand).toBe("1.5");
    expect(linha.available).toBe("1.5");
    // O domínio guarda o componente com 6 casas: 1,836735 - 1,5.
    expect(linha.requiredQuantity).toBe("1.836735");
    expect(linha.shortage).toBe("0.336735");

    await app.close();
  });

  it("Plano e OP dão os mesmos números — a projeção nunca promete o que a produção recusa", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteA = await criarCliente("A");
    const clienteB = await criarCliente("B");
    const material = await criarItem("RAW_MATERIAL");

    await receberLote(material.id, "1.5", { ownerType: "CUSTOMER", customerId: clienteA.id });
    await receberLote(material.id, "1", { ownerType: "CUSTOMER", customerId: clienteB.id });

    const { product } = await criarProduto(app, clienteA.id, [
      { itemId: material.id, quantity: "1.8367346938775510204", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const orderId = await pedidoConfirmado(app, clienteA.id, product.id, "1");

    const plano = await app.inject({ method: "GET", url: `/customer-orders/${orderId}/fulfillment-plan` });
    const doPlano = linhaDoItem(plano.json(), material.id);

    const aplicado = await app.inject({
      method: "POST",
      url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
      payload: {
        lines: [
          {
            customerOrderLineId: plano.json().lines[0].customerOrderLineId,
            reserveQuantity: "0",
            produceQuantity: "1",
          },
        ],
      },
    });
    const opId = aplicado.json().generatedProductionOrders[0].id;
    const op = await app.inject({ method: "GET", url: `/production-orders/${opId}` });
    const requisito = op.json().requirements.find((row: { itemId: string }) => row.itemId === material.id);

    expect(requisito.supplyResponsibility).toBe("CUSTOMER");
    expect(requisito.onHand).toBe(doPlano.onHand);
    expect(requisito.available).toBe(doPlano.available);
    expect(requisito.shortage).toBe(doPlano.shortage);

    await app.close();
  });

  it("estoque VERIDI do mesmo item não cobre necessidade do cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente("A");
    const material = await criarItem("RAW_MATERIAL");

    await receberLote(material.id, "10", { ownerType: "VERIDI" });
    await receberLote(material.id, "0.4", { ownerType: "CUSTOMER", customerId: cliente.id });

    const { product } = await criarProduto(app, cliente.id, [
      { itemId: material.id, quantity: "1", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const orderId = await pedidoConfirmado(app, cliente.id, product.id, "1");

    const plano = await app.inject({ method: "GET", url: `/customer-orders/${orderId}/fulfillment-plan` });
    const linha = linhaDoItem(plano.json(), material.id);

    expect(linha.onHand).toBe("0.4");
    expect(linha.available).toBe("0.4");
    expect(linha.shortage).toBe("0.6");

    await app.close();
  });

  it("material VERIDI continua usando o estoque da Veridi normalmente", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente("A");
    const material = await criarItem("RAW_MATERIAL");

    await receberLote(material.id, "10", { ownerType: "VERIDI" });
    await receberLote(material.id, "99", { ownerType: "CUSTOMER", customerId: cliente.id });

    const { product } = await criarProduto(app, cliente.id, [
      { itemId: material.id, quantity: "4", unitCode: "kg", supplyResponsibility: "VERIDI" },
    ]);
    const orderId = await pedidoConfirmado(app, cliente.id, product.id, "1");

    const plano = await app.inject({ method: "GET", url: `/customer-orders/${orderId}/fulfillment-plan` });
    const linha = linhaDoItem(plano.json(), material.id);

    expect(linha.supplyResponsibility).toBe("VERIDI");
    // O lote do cliente não infla o estoque Veridi — a separação vale nos dois sentidos.
    expect(linha.onHand).toBe("10");
    expect(linha.available).toBe("10");
    expect(linha.shortage).toBe("0");

    await app.close();
  });

  it("lote do cliente aguardando Qualidade não conta como disponível", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const cliente = await criarCliente("A");
    const material = await criarItem("RAW_MATERIAL");

    const retido = await receberLote(material.id, "5", { ownerType: "CUSTOMER", customerId: cliente.id });
    await prisma.lot.update({ where: { id: retido.id }, data: { status: "AWAITING_RELEASE" } });
    await receberLote(material.id, "1", { ownerType: "CUSTOMER", customerId: cliente.id });

    const { product } = await criarProduto(app, cliente.id, [
      { itemId: material.id, quantity: "3", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const orderId = await pedidoConfirmado(app, cliente.id, product.id, "1");

    const plano = await app.inject({ method: "GET", url: `/customer-orders/${orderId}/fulfillment-plan` });
    const linha = linhaDoItem(plano.json(), material.id);

    // Físico vê os 6 kg; disponível vê só o liberado.
    expect(linha.onHand).toBe("6");
    expect(linha.available).toBe("1");
    expect(linha.shortage).toBe("2");

    await app.close();
  });

  it("material do cliente nunca ganha 'em compra' de uma OC da Veridi", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente("A");
    const material = await criarItem("RAW_MATERIAL");
    await receberLote(material.id, "1", { ownerType: "CUSTOMER", customerId: cliente.id });

    const { product } = await criarProduto(app, cliente.id, [
      { itemId: material.id, quantity: "3", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
    ]);
    const orderId = await pedidoConfirmado(app, cliente.id, product.id, "1");

    const plano = await app.inject({ method: "GET", url: `/customer-orders/${orderId}/fulfillment-plan` });
    const linha = linhaDoItem(plano.json(), material.id);
    expect(linha.onOrder).toBe("0");

    await app.close();
  });

  it("sourcing do Plano separa material Veridi de material do cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente("A");
    const doCliente = await criarItem("RAW_MATERIAL");
    const daVeridi = await criarItem("RAW_MATERIAL");
    await receberLote(doCliente.id, "1", { ownerType: "CUSTOMER", customerId: cliente.id });
    await receberLote(daVeridi.id, "1", { ownerType: "VERIDI" });

    const { product } = await criarProduto(app, cliente.id, [
      { itemId: doCliente.id, quantity: "3", unitCode: "kg", supplyResponsibility: "CUSTOMER" },
      { itemId: daVeridi.id, quantity: "5", unitCode: "kg", supplyResponsibility: "VERIDI" },
    ]);
    const orderId = await pedidoConfirmado(app, cliente.id, product.id, "1");

    const sourcing = await app.inject({
      method: "GET",
      url: `/customer-orders/${orderId}/plan-purchase-sourcing`,
    });
    const corpo = sourcing.json();

    // Compra só existe para o que a Veridi fornece.
    expect(corpo.rows.map((row: { itemId: string }) => row.itemId)).toEqual([daVeridi.id]);
    expect(corpo.rows[0].shortage).toBe("4");
    // A falta do cliente aparece, mas em outra lista — e sem fornecedores.
    expect(corpo.customerSuppliedShortages).toHaveLength(1);
    expect(corpo.customerSuppliedShortages[0].itemId).toBe(doCliente.id);
    expect(corpo.customerSuppliedShortages[0].shortage).toBe("2");

    await app.close();
  });
});
