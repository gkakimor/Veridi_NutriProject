import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Consulta do Cliente — resumo e ESCOPO.
 *
 * O que precisa ser provado aqui não é que os dados aparecem: as listas vêm
 * de endpoints operacionais que já têm suas próprias suítes. O que é novo, e
 * o que quebraria em silêncio, é o RECORTE — que a consulta de um cliente
 * nunca mostre nada de outro, nem pelas listas, nem por um id colado na URL.
 *
 * Por isso a fixture tem dois clientes com as MESMAS classes de registro. Um
 * cliente sozinho passaria em qualquer filtro, inclusive num quebrado.
 *
 * Os contadores são por cliente, não agregados do banco — então este arquivo
 * continua na faixa paralela da suíte: vizinho escrevendo ao lado não muda o
 * número de projetos do cliente da fixture.
 */

type App = ReturnType<typeof buildTestApp>;

const fixtureCustomerIds: string[] = [];
const fixtureProjectIds: string[] = [];
const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Um cliente da fixture, com tudo que a Consulta mostra dele. */
interface Scenario {
  customerId: string;
  projectIds: string[];
  orderId: string;
  billingId: string;
  lotId: string;
}

let customerA: Scenario;
let customerB: Scenario;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const app = buildTestApp();
  await app.ready();
  // Dois cenários idênticos em forma: é a simetria que faz o vazamento
  // aparecer, porque nenhum dos dois é "o caso especial".
  customerA = await buildScenario(app, "A", 2);
  customerB = await buildScenario(app, "B", 1);
  await app.close();
}, 120_000);

afterAll(async () => {
  const prisma = getPrisma();

  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.billingLine.deleteMany({
      where: { billing: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.billing.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.shipment.deleteMany({
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
  if (fixtureProjectIds.length > 0) {
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
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
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function createCustomer(label: string) {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: {
      code: `CLI-CONS-${label}-${m}`,
      legalName: `Cliente Consulta ${label} ${m}`,
      tradeName: `Consulta ${label}`,
      active: true,
    },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createFinishedItem() {
  const prisma = getPrisma();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-CONS-${marker()}`,
      name: `Produto Acabado Consulta ${marker()}`,
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

async function createRawItem() {
  const prisma = getPrisma();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-CONS-${marker()}`,
      name: `Matéria-prima Consulta ${marker()}`,
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

/** Lote de propriedade do CLIENTE + entrada no ledger — mesmo caminho do sistema. */
async function receiveCustomerLot(itemId: string, customerId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-CONS-${marker()}`.toUpperCase(),
      itemId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
      ownerType: "CUSTOMER",
      ownerCustomerId: customerId,
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

async function stockFinishedLot(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-PA-${marker()}`.toUpperCase(),
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

/**
 * Um cliente com projetos, um pedido levado até o faturamento e um lote seu
 * em estoque. O pedido percorre o fluxo real (confirmar, planejar, expedir,
 * faturar) porque o Faturamento não existe sem Expedição CONFIRMED — criá-lo
 * por baixo produziria um registro que o sistema nunca geraria.
 */
async function buildScenario(app: App, label: string, projectCount: number): Promise<Scenario> {
  const customer = await createCustomer(label);

  const projectIds: string[] = [];
  for (let index = 0; index < projectCount; index += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        customerId: customer.id,
        name: `Projeto Consulta ${label}-${index + 1} ${marker()}`,
        concept: "Detox",
        channel: "Distribuidora",
      },
    });
    const project = response.json();
    fixtureProjectIds.push(project.id);
    projectIds.push(project.id);
  }

  const rawItem = await createRawItem();
  const lot = await receiveCustomerLot(rawItem.id, customer.id, "40");

  const finishedItem = await createFinishedItem();
  await stockFinishedLot(finishedItem.id, "100");
  const productResponse = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      name: `Produto Consulta ${label} ${marker()}`,
      finishedProductItemId: finishedItem.id,
    },
  });
  const product = productResponse.json();
  fixtureProductIds.push(product.id);

  const created = await app.inject({
    method: "POST",
    url: "/customer-orders",
    payload: { customerId: customer.id, lines: [{ productId: product.id, orderedQuantity: "10" }] },
  });
  const orderId = created.json().id;
  fixtureCustomerOrderIds.push(orderId);

  const confirmed = await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/confirm`,
  });
  const lineId = confirmed.json().lines[0].id;

  await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
    payload: {
      lines: [{ customerOrderLineId: lineId, reserveQuantity: "10", produceQuantity: "0" }],
    },
  });

  const draft = (
    await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })
  ).json();
  const shipment = (await app.inject({ method: "GET", url: `/shipments/${draft.id}` })).json();
  for (const line of shipment.lines) {
    if (!line.requiresVerification) continue;
    await app.inject({
      method: "POST",
      url: `/shipments/${draft.id}/lines/${line.id}/verify`,
      payload: { lotCode: line.lotCode },
    });
  }
  const confirmedShipment = (
    await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` })
  ).json();

  const billing = (
    await app.inject({
      method: "POST",
      url: "/billings",
      payload: { shipmentId: confirmedShipment.id },
    })
  ).json();

  return {
    customerId: customer.id,
    projectIds,
    orderId,
    billingId: billing.id,
    lotId: lot.id,
  };
}

describe("Consulta do Cliente — resumo", () => {
  it("conta o que existe daquele cliente, e só dele", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: `/customers/${customerA.customerId}/consultation/summary`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.customer.id).toBe(customerA.customerId);
    expect(body.counts.projects).toBe(2);
    expect(body.counts.orders).toBe(1);
    expect(body.counts.billings).toBe(1);
    expect(body.counts.materialLots).toBe(1);

    // O cliente B tem a mesma forma com um projeto a menos: se o filtro
    // vazasse, os dois responderiam o mesmo número.
    const other = await app.inject({
      method: "GET",
      url: `/customers/${customerB.customerId}/consultation/summary`,
    });
    expect(other.json().counts.projects).toBe(1);

    await app.close();
  });

  it("pedido expedido por completo não conta como em aberto", async () => {
    const app = buildTestApp();
    await app.ready();

    const body = (
      await app.inject({
        method: "GET",
        url: `/customers/${customerA.customerId}/consultation/summary`,
      })
    ).json();

    // O único pedido da fixture foi expedido inteiro — está fechado.
    expect(body.counts.openOrders).toBe(0);

    await app.close();
  });

  it("cliente inexistente responde 404", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/customers/cliente-que-nao-existe/consultation/summary",
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});

describe("Consulta do Cliente — listas recortadas pelo cliente", () => {
  it("projetos, pedidos, faturamentos e materiais trazem só os do cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const projects = (
      await app.inject({
        method: "GET",
        url: `/projects?customerId=${customerA.customerId}&pageSize=100`,
      })
    ).json();
    expect(projects.projects.map((row: { id: string }) => row.id).sort()).toEqual(
      [...customerA.projectIds].sort(),
    );

    const orders = (
      await app.inject({
        method: "GET",
        url: `/customer-orders?customerId=${customerA.customerId}&pageSize=100`,
      })
    ).json();
    expect(orders.customerOrders.map((row: { id: string }) => row.id)).toEqual([
      customerA.orderId,
    ]);

    const billings = (
      await app.inject({
        method: "GET",
        url: `/billings?customerId=${customerA.customerId}&pageSize=100`,
      })
    ).json();
    expect(billings.billings.map((row: { id: string }) => row.id)).toEqual([customerA.billingId]);

    await app.close();
  });

  it("material de um cliente nunca aparece na consulta do outro", async () => {
    const app = buildTestApp();
    await app.ready();

    const rows = (
      await app.inject({
        method: "GET",
        url: `/inventory/customer-materials?customerId=${customerA.customerId}&pageSize=100`,
      })
    ).json().rows as { lotId: string; customerId: string }[];

    expect(rows.map((row) => row.lotId)).toContain(customerA.lotId);
    expect(rows.map((row) => row.lotId)).not.toContain(customerB.lotId);
    expect(rows.every((row) => row.customerId === customerA.customerId)).toBe(true);

    await app.close();
  });
});

describe("Consulta do Cliente — escopo dos detalhes", () => {
  it("abre o detalhe quando a entidade é daquele cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const project = await app.inject({
      method: "GET",
      url: `/customers/${customerA.customerId}/consultation/projects/${customerA.projectIds[0]}`,
    });
    expect(project.statusCode).toBe(200);
    expect(project.json().customerId).toBe(customerA.customerId);

    const order = await app.inject({
      method: "GET",
      url: `/customers/${customerA.customerId}/consultation/orders/${customerA.orderId}`,
    });
    expect(order.statusCode).toBe(200);
    expect(order.json().customerId).toBe(customerA.customerId);

    const billing = await app.inject({
      method: "GET",
      url: `/customers/${customerA.customerId}/consultation/billings/${customerA.billingId}`,
    });
    expect(billing.statusCode).toBe(200);
    expect(billing.json().customerId).toBe(customerA.customerId);

    await app.close();
  });

  /*
   * O coração da capacidade. Os três ids abaixo EXISTEM — só pertencem ao
   * outro cliente. Um shell que confiasse na URL mostraria o registro do
   * Cliente B sob o cabeçalho do Cliente A.
   */
  it("recusa projeto, pedido e faturamento de outro cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const project = await app.inject({
      method: "GET",
      url: `/customers/${customerA.customerId}/consultation/projects/${customerB.projectIds[0]}`,
    });
    expect(project.statusCode).toBe(404);

    const order = await app.inject({
      method: "GET",
      url: `/customers/${customerA.customerId}/consultation/orders/${customerB.orderId}`,
    });
    expect(order.statusCode).toBe(404);

    const billing = await app.inject({
      method: "GET",
      url: `/customers/${customerA.customerId}/consultation/billings/${customerB.billingId}`,
    });
    expect(billing.statusCode).toBe(404);

    // E os mesmos ids continuam abrindo sob o dono certo — o 404 acima é
    // escopo, não um detalhe quebrado.
    const underOwner = await app.inject({
      method: "GET",
      url: `/customers/${customerB.customerId}/consultation/projects/${customerB.projectIds[0]}`,
    });
    expect(underOwner.statusCode).toBe(200);

    await app.close();
  });

  it("entidade inexistente responde 404, sem confundir com erro", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: `/customers/${customerA.customerId}/consultation/projects/projeto-que-nao-existe`,
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
