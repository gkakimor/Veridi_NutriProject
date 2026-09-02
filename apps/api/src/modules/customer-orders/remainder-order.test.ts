import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Continuidade de um pedido atendido pela metade.
 *
 * O VAL-LEG-01 terminou em 98 de 100. O Pedido representava a pendência
 * corretamente em toda parte — falta expedir 2, falta reservar 2, status
 * parcial — e mesmo assim era um beco sem saída: o Plano de Atendimento
 * só existe enquanto o Pedido está CONFIRMED, e o bloco de OPs é somente
 * leitura. Para produzir as 2 restantes não havia caminho.
 *
 * O saldo que interessa aqui é o de PRODUÇÃO, não o de expedição: o que
 * já está reservado em estoque, ou já está sendo produzido por uma OP
 * aberta, não é pendência — sugerir OP para ele produziria o dobro.
 */

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureCustomerOrderIds.length > 0) {
    const ops = await prisma.productionOrder.findMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
      select: { id: true },
    });
    const opIds = ops.map((row) => row.id);
    if (opIds.length > 0) {
      await prisma.productionOutput.deleteMany({ where: { productionOrderId: { in: opIds } } });
      await prisma.materialReservationLine.deleteMany({
        where: { reservation: { productionOrderId: { in: opIds } } },
      });
      await prisma.materialReservation.deleteMany({ where: { productionOrderId: { in: opIds } } });
      await prisma.productionOrderRequirement.deleteMany({
        where: { productionOrderId: { in: opIds } },
      });
    }
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

async function criarItemAcabado() {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-SALDO-${m}`,
      name: `PA Saldo ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/** Produto com formulação ativa — sem ela a OP nem seria sugerida. */
async function criarProduto(app: App, finishedItemId: string) {
  const prisma = getPrisma();
  const m = marca();
  const materia = await prisma.item.create({
    data: { type: "RAW_MATERIAL", code: `MP-SALDO-${m}`, name: `MP Saldo ${m}`, unitCode: "un" },
  });
  fixtureItemIds.push(materia.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId: await fixtureCustomerId(), name: `Produto Saldo ${m}`, finishedProductItemId: finishedItemId },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const versao = (
    await app.inject({ method: "POST", url: `/products/${product.id}/formulation-versions`, payload: {} })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versao.id}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: materia.id, quantity: "1", unitCode: "un", basis: "FIXED_BASIS" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versao.id}/activate` });
  return product;
}

/** Pedido de 100 com uma OP aberta de 100 — nada produzido ainda. */
async function pedidoDe100(app: App) {
  const acabado = await criarItemAcabado();
  const product = await criarProduto(app, acabado.id);
  const prisma = getPrisma();
  const m = marca();

  const customer = await prisma.customer.create({
    data: { code: `CLI-SALDO-${m}`, legalName: `Cliente Saldo ${m}` },
  });
  fixtureCustomerIds.push(customer.id);

  const criado = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: customer.id, lines: [{ productId: product.id, orderedQuantity: "100" }] },
    })
  ).json();
  fixtureCustomerOrderIds.push(criado.id);

  const confirmado = (
    await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })
  ).json();
  const lineId = confirmado.lines[0].id as string;

  const aplicado = (
    await app.inject({
      method: "POST",
      url: `/customer-orders/${criado.id}/apply-fulfillment-plan`,
      payload: { lines: [{ customerOrderLineId: lineId, reserveQuantity: "0", produceQuantity: "100" }] },
    })
  ).json();

  return { orderId: criado.id as string, lineId, acabado, aplicado };
}

/** A OP produz 98 e é encerrada — o cenário exato do VAL-LEG-01. */
async function produzir98(opId: string, finishedItemId: string) {
  const prisma = getPrisma();
  const lote = await prisma.lot.create({
    data: {
      code: `LT-PROD-${marca()}`.toUpperCase(),
      itemId: finishedItemId,
      origin: "PRODUCTION",
      initialReceivedQuantity: "98",
      status: "AVAILABLE",
      createdBy: "Teste",
    },
  });
  await prisma.productionOutput.create({
    data: {
      productionOrderId: opId,
      lotId: lote.id,
      quantity: "98",
      producedAt: new Date(),
      producedBy: "Teste",
    },
  });
  await prisma.productionOrder.update({ where: { id: opId }, data: { status: "COMPLETED" } });
}

const remainderUrl = (orderId: string) => `/customer-orders/${orderId}/remainder-production-order`;

describe("Saldo pendente de produção", () => {
  it("uma OP aberta de 100 cobre o pedido inteiro — não há pendência", async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId, lineId, aplicado } = await pedidoDe100(app);

    expect(aplicado.generatedProductionOrders).toHaveLength(1);
    // A OP ainda vai produzir 100 — pedir outra agora duplicaria a produção.
    expect(aplicado.lines[0].pendingProductionQuantity).toBe("0");

    const resposta = await app.inject({
      method: "POST",
      url: remainderUrl(orderId),
      payload: { customerOrderLineId: lineId },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("no_pending_production");

    await app.close();
  });

  it("OP que produziu 98 de 100 e foi concluída deixa 2 pendentes", async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId, acabado, aplicado } = await pedidoDe100(app);

    await produzir98(aplicado.generatedProductionOrders[0].id, acabado.id);

    const pedido = (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json();
    // 100 − 0 expedido − 0 reservado − (100 − 98) ainda aberto = 2.
    expect(pedido.lines[0].pendingProductionQuantity).toBe("2");

    await app.close();
  });
});

describe("Gerar OP para o saldo restante", () => {
  async function cenarioComSaldo(app: App) {
    const { orderId, lineId, acabado, aplicado } = await pedidoDe100(app);
    const primeiraOpId = aplicado.generatedProductionOrders[0].id as string;
    await produzir98(primeiraOpId, acabado.id);
    return { orderId, lineId, primeiraOpId };
  }

  it("sem quantidade informada, usa o saldo pendente inteiro", async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId, lineId } = await cenarioComSaldo(app);

    const resposta = await app.inject({
      method: "POST",
      url: remainderUrl(orderId),
      payload: { customerOrderLineId: lineId },
    });
    expect(resposta.statusCode).toBe(201);

    const ops = resposta.json().generatedProductionOrders as {
      id: string;
      plannedQuantity: string;
      status: string;
    }[];
    expect(ops).toHaveLength(2);
    const nova = ops.find((op) => op.plannedQuantity === "2")!;
    expect(nova).toBeTruthy();
    // Nasce rascunho — nunca planejada ou liberada automaticamente.
    expect(nova.status).toBe("DRAFT");

    await app.close();
  });

  it("o pedido passa a mostrar as duas ordens, sem perder a proveniência", async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId, lineId, primeiraOpId } = await cenarioComSaldo(app);

    await app.inject({
      method: "POST",
      url: remainderUrl(orderId),
      payload: { customerOrderLineId: lineId },
    });

    const ordens = await getPrisma().productionOrder.findMany({
      where: { customerOrderId: orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(ordens).toHaveLength(2);
    // Ambas penduradas na MESMA linha do MESMO pedido.
    expect(ordens.every((op) => op.customerOrderLineId === lineId)).toBe(true);
    expect(ordens[0]!.id).toBe(primeiraOpId);
    expect(ordens[1]!.plannedQuantity.toString()).toBe("2");
    expect(ordens[1]!.productId).toBe(ordens[0]!.productId);

    await app.close();
  });

  it("depois de gerada, o saldo pendente zera — não se gera duas vezes", async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId, lineId } = await cenarioComSaldo(app);

    const primeira = await app.inject({
      method: "POST",
      url: remainderUrl(orderId),
      payload: { customerOrderLineId: lineId },
    });
    expect(primeira.json().lines[0].pendingProductionQuantity).toBe("0");

    const segunda = await app.inject({
      method: "POST",
      url: remainderUrl(orderId),
      payload: { customerOrderLineId: lineId },
    });
    expect(segunda.statusCode).toBe(400);
    expect(segunda.json().error).toBe("no_pending_production");

    await app.close();
  });

  it("quantidade acima do pendente é recusada", async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId, lineId } = await cenarioComSaldo(app);

    const resposta = await app.inject({
      method: "POST",
      url: remainderUrl(orderId),
      payload: { customerOrderLineId: lineId, quantity: "3" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("remainder_exceeds_pending");
    expect(resposta.json().message).toContain("2");

    await app.close();
  });

  it("quantidade menor que o pendente é permitida — produção fracionada", async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId, lineId } = await cenarioComSaldo(app);

    const resposta = await app.inject({
      method: "POST",
      url: remainderUrl(orderId),
      payload: { customerOrderLineId: lineId, quantity: "1" },
    });
    expect(resposta.statusCode).toBe(201);
    // Sobra 1 — e o pedido continua sabendo disso.
    expect(resposta.json().lines[0].pendingProductionQuantity).toBe("1");

    await app.close();
  });

  it("linha de outro pedido é recusada", async () => {
    const app = buildTestApp();
    await app.ready();
    const { orderId } = await cenarioComSaldo(app);

    const resposta = await app.inject({
      method: "POST",
      url: remainderUrl(orderId),
      payload: { customerOrderLineId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("unknown_plan_line");

    await app.close();
  });

  it("pedido ainda CONFIRMED usa o Plano, não este caminho", async () => {
    const app = buildTestApp();
    await app.ready();

    const acabado = await criarItemAcabado();
    const product = await criarProduto(app, acabado.id);
    const prisma = getPrisma();
    const m = marca();
    const customer = await prisma.customer.create({
      data: { code: `CLI-SALDO-${m}`, legalName: `Cliente Saldo ${m}` },
    });
    fixtureCustomerIds.push(customer.id);
    const criado = (
      await app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: { customerId: customer.id, lines: [{ productId: product.id, orderedQuantity: "10" }] },
      })
    ).json();
    fixtureCustomerOrderIds.push(criado.id);
    const confirmado = (
      await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })
    ).json();

    const resposta = await app.inject({
      method: "POST",
      url: remainderUrl(criado.id),
      payload: { customerOrderLineId: confirmado.lines[0].id },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("order_not_confirmed");

    await app.close();
  });
});
