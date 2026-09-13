import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * `CustomerMismatchError` é recusa de regra de negócio, não falha do servidor.
 *
 * A classe nasce em `resolveOrderCustomerId` (`production-orders.service.ts`) e
 * é chamada de três lugares: a criação da OP pelo Plano de Atendimento — cuja
 * rota já traduzia o erro desde o FIX-05b —, o PATCH da própria OP e o PLAN.
 * As duas rotas do módulo de Produção não tinham o mapeamento: o mesmo erro de
 * domínio saía como HTTP 500 (PROD-ERR-01).
 *
 * O que este arquivo protege é o contrato HTTP, e só ele: status 400, código
 * `customer_mismatch`, a mensagem do domínio intacta e nada além de
 * `{ error, message }` no corpo. Mesma convenção do irmão do módulo de
 * Projetos (`ProjectProductCustomerMismatchError`) e da própria
 * `apply-fulfillment-plan`.
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
    await prisma.productionOrder.deleteMany({ where: { productId: { in: fixtureProductIds } } });
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

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-CM-${m}`,
      name: `Item Cliente Inconsistente ${m}`,
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

async function receiveRawStock(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-CM-${marker()}`.toUpperCase(),
      itemId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
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

/** Cliente diferente do das fixtures — o "outro dono" da inconsistência. */
async function createOtherCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-CM-${m}`, legalName: `Cliente Inconsistencia ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

/** Produto do cliente informado, com Item PA próprio e formulação V1 ACTIVE. */
async function createProductWithActiveFormulation(
  app: App,
  customerId: string,
  components: { itemId: string; quantity: string; unitCode: string }[],
) {
  const finishedItem = await createItem("FINISHED_PRODUCT");
  const productResp = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId,
      name: `Produto Cliente Inconsistente ${marker()}`,
      finishedProductItemId: finishedItem.id,
    },
  });
  const product = productResp.json();
  fixtureProductIds.push(product.id);

  const created = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  const versionId = created.json().id;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: { basisQuantity: "1", components },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  return { product, finishedItem, formulationVersionId: versionId };
}

async function createConfirmedOrder(
  app: App,
  customerId: string,
  lines: { productId: string; orderedQuantity: string }[],
) {
  const created = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: { customerId, lines },
  });
  fixtureCustomerOrderIds.push(created.json().id);
  const confirmed = await app.inject({
    method: "POST",
    url: `/customer-orders/${created.json().id}/confirm`,
  });
  return confirmed.json();
}

/**
 * OP nascida do Pedido, pelo caminho normal: o Plano de Atendimento manda
 * produzir o pedido inteiro. Nasce DRAFT, com `customerOrderId` do Pedido e o
 * cliente já resolvido.
 */
async function createOrderProductionOrder(
  app: App,
  customerId: string,
  productId: string,
  quantity: string,
) {
  const order = await createConfirmedOrder(app, customerId, [
    { productId, orderedQuantity: quantity },
  ]);
  const aplicado = await app.inject({
    method: "POST",
    url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
    payload: {
      lines: [
        { customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: quantity },
      ],
    },
  });
  expect(aplicado.statusCode).toBe(200);

  const productionOrder = await getPrisma().productionOrder.findFirstOrThrow({
    where: { customerOrderId: order.id },
  });
  return { order, productionOrder };
}

describe("PROD-ERR-01 — cliente inconsistente é 400, não 500", () => {
  it("PATCH: trocar para produto de outro cliente responde 400 customer_mismatch", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteDoPedido = await fixtureCustomerId();
    const outroCliente = await createOtherCustomer();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveRawStock(rawMaterial.id, "1000");

    const componentes = [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }];
    const { product: produtoDoPedido } = await createProductWithActiveFormulation(
      app,
      clienteDoPedido,
      componentes,
    );
    const { product: produtoDeOutroCliente } = await createProductWithActiveFormulation(
      app,
      outroCliente.id,
      componentes,
    );

    const { productionOrder } = await createOrderProductionOrder(
      app,
      clienteDoPedido,
      produtoDoPedido.id,
      "100",
    );

    // Trocar de produto troca o dono do material esperado: o serviço resolve o
    // cliente de novo e recusa. Antes do PROD-ERR-01 isso saía como 500.
    const patched = await app.inject({
      method: "PATCH",
      url: `/production-orders/${productionOrder.id}`,
      payload: { productId: produtoDeOutroCliente.id },
    });

    expect(patched.statusCode).toBe(400);
    expect(patched.json().error).toBe("customer_mismatch");
    expect(patched.json().message).toMatch(/Cliente inconsistente/i);
    expect(patched.json().message).toContain(outroCliente.legalName);
    // Contrato da API: só `error` e `message` — nenhum stack, nome de exceção
    // ou detalhe de Prisma vaza para a tela.
    expect(Object.keys(patched.json()).sort()).toEqual(["error", "message"]);
    expect(JSON.stringify(patched.json())).not.toMatch(/CustomerMismatchError|Prisma|at .*\.ts:/);

    // A recusa não escreve: a OP continua no produto do Pedido.
    const depois = await getPrisma().productionOrder.findUniqueOrThrow({
      where: { id: productionOrder.id },
    });
    expect(depois.productId).toBe(produtoDoPedido.id);

    await app.close();
  });

  it("PATCH: produto do mesmo cliente do Pedido continua salvando (200)", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteDoPedido = await fixtureCustomerId();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveRawStock(rawMaterial.id, "1000");

    const componentes = [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }];
    const { product: produtoDoPedido } = await createProductWithActiveFormulation(
      app,
      clienteDoPedido,
      componentes,
    );
    const { product: outroProdutoDoMesmoCliente } = await createProductWithActiveFormulation(
      app,
      clienteDoPedido,
      componentes,
    );

    const { productionOrder } = await createOrderProductionOrder(
      app,
      clienteDoPedido,
      produtoDoPedido.id,
      "100",
    );

    const patched = await app.inject({
      method: "PATCH",
      url: `/production-orders/${productionOrder.id}`,
      payload: { productId: outroProdutoDoMesmoCliente.id },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().productId).toBe(outroProdutoDoMesmoCliente.id);

    const depois = await getPrisma().productionOrder.findUniqueOrThrow({
      where: { id: productionOrder.id },
    });
    expect(depois.customerId).toBe(clienteDoPedido);

    await app.close();
  });

  it("PLAN: OP sem cliente resolvido e produto de outro cliente responde 400 customer_mismatch", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteDoPedido = await fixtureCustomerId();
    const outroCliente = await createOtherCustomer();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveRawStock(rawMaterial.id, "1000");

    const componentes = [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }];
    const { product: produtoDoPedido } = await createProductWithActiveFormulation(
      app,
      clienteDoPedido,
      componentes,
    );
    const { product: produtoDeOutroCliente, formulationVersionId } =
      await createProductWithActiveFormulation(app, outroCliente.id, componentes);

    const { productionOrder } = await createOrderProductionOrder(
      app,
      clienteDoPedido,
      produtoDoPedido.id,
      "100",
    );

    /*
     * `planProductionOrder` só resolve o cliente quando a OP ainda não tem um
     * (`order.customerId ?? resolveOrderCustomerId(...)`). Hoje nenhuma escrita
     * do serviço produz OP com `customerOrderId` e `customerId` nulo — é a
     * forma de uma linha anterior ao preenchimento da coluna. A linha é montada
     * aqui, na base de teste, porque o contrato da rota precisa valer para ela:
     * é exatamente o caso em que o 500 aparece.
     */
    await getPrisma().productionOrder.update({
      where: { id: productionOrder.id },
      data: {
        productId: produtoDeOutroCliente.id,
        formulationVersionId,
        customerId: null,
      },
    });

    await aplicarRoteiroDeTeste(productionOrder.id);
    const planned = await app.inject({
      method: "POST",
      url: `/production-orders/${productionOrder.id}/plan`,
    });

    expect(planned.statusCode).toBe(400);
    expect(planned.json().error).toBe("customer_mismatch");
    expect(planned.json().message).toMatch(/Cliente inconsistente/i);
    expect(planned.json().message).toContain(outroCliente.legalName);
    expect(Object.keys(planned.json()).sort()).toEqual(["error", "message"]);
    expect(JSON.stringify(planned.json())).not.toMatch(/CustomerMismatchError|Prisma|at .*\.ts:/);

    // Transação recusada: a OP não avança de estado.
    const depois = await getPrisma().productionOrder.findUniqueOrThrow({
      where: { id: productionOrder.id },
    });
    expect(depois.status).toBe("DRAFT");

    await app.close();
  });

  it("PLAN: OP coerente com o Pedido continua planejando (200 PLANNED)", async () => {
    const app = buildTestApp();
    await app.ready();

    const clienteDoPedido = await fixtureCustomerId();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveRawStock(rawMaterial.id, "1000");

    const { product: produtoDoPedido } = await createProductWithActiveFormulation(
      app,
      clienteDoPedido,
      [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
    );

    const { productionOrder } = await createOrderProductionOrder(
      app,
      clienteDoPedido,
      produtoDoPedido.id,
      "100",
    );

    await aplicarRoteiroDeTeste(productionOrder.id);
    const planned = await app.inject({
      method: "POST",
      url: `/production-orders/${productionOrder.id}/plan`,
    });

    expect(planned.statusCode).toBe(200);
    expect(planned.json().status).toBe("PLANNED");

    await app.close();
  });

  it("a mensagem do domínio chega inteira, com os dois clientes nomeados", async () => {
    const app = buildTestApp();
    await app.ready();

    const prisma = getPrisma();
    const clienteDoPedido = await fixtureCustomerId();
    const clienteDoPedidoRow = await prisma.customer.findUniqueOrThrow({
      where: { id: clienteDoPedido },
    });
    const outroCliente = await createOtherCustomer();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveRawStock(rawMaterial.id, "1000");

    const componentes = [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }];
    const { product: produtoDoPedido } = await createProductWithActiveFormulation(
      app,
      clienteDoPedido,
      componentes,
    );
    const { product: produtoDeOutroCliente } = await createProductWithActiveFormulation(
      app,
      outroCliente.id,
      componentes,
    );

    const { productionOrder } = await createOrderProductionOrder(
      app,
      clienteDoPedido,
      produtoDoPedido.id,
      "100",
    );

    const patched = await app.inject({
      method: "PATCH",
      url: `/production-orders/${productionOrder.id}`,
      payload: { productId: produtoDeOutroCliente.id },
    });

    // A mensagem é a do domínio, palavra por palavra — a rota traduz o status,
    // nunca o texto.
    expect(patched.json().message).toBe(
      `Cliente inconsistente: o produto pertence a ${outroCliente.legalName} e o pedido a ${clienteDoPedidoRow.legalName}.`,
    );

    await app.close();
  });
});
