import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import type { AttentionType, DashboardDTO } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";
import { diaComercialDeTeste, marcadorDoDiaComercialDeTeste } from "../../test-support/dia-comercial.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";
import { buildAttentionList } from "./attention.service.js";
import { dashboardQuerySchemaEm } from "./dashboard.schemas.js";
import { getDashboard } from "./dashboard.service.js";

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureSupplierIds: string[] = [];

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
    await prisma.billingLine.deleteMany({
      where: { billing: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.billing.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
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
    const linked = await prisma.productionOrder.findMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
      select: { id: true },
    });
    fixtureProductionOrderIds.push(...linked.map((order) => order.id));
  }

  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOutput.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.materialReservationLine.deleteMany({
      where: { reservation: { productionOrderId: { in: fixtureProductionOrderIds } } },
    });
    await prisma.materialReservation.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }

  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  }
  if (fixtureReceiptIds.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
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
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Base histórica sorteada por execução — dois runs nunca dividem a mesma janela. */
const HISTORIC_BASE =
  Date.UTC(1990, 0, 1) + Math.floor(Math.random() * 4000) * DAY_MS;

/**
 * Cada teste usa uma janela histórica exclusiva (um dia inteiro) e empurra
 * as datas OPERACIONAIS dos seus documentos para dentro dela. Assim a
 * contagem do período é exata, sem depender do que existe no banco.
 *
 * A janela é o DIA (`YYYY-MM-DD`), o contrato da rota; `at` é meio-dia UTC,
 * que cai no mesmo dia comercial em São Paulo, com ou sem horário de verão.
 */
function windowFor(dayOffset: number) {
  const day = new Date(HISTORIC_BASE + dayOffset * DAY_MS);
  const dia = day.toISOString().slice(0, 10);
  return {
    from: dia,
    at: new Date(day.getTime() + 12 * 60 * 60 * 1000),
    to: dia,
  };
}

/** Janela histórica garantidamente vazia (nenhum teste escreve nela). */
function emptyWindow(dayOffset: number) {
  const { from, to } = windowFor(dayOffset);
  return { from, to };
}

async function fetchDashboard(app: App, window?: { from: string; to: string }) {
  const query = window ? `?${new URLSearchParams(window)}` : "";
  const response = await app.inject({ method: "GET", url: `/dashboard${query}` });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function createCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-DASH-${m}`, legalName: `Cliente Dashboard ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-DASH-${m}`, legalName: `Fornecedor Dashboard ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-DASH-${m}`,
      name: `Item Dashboard ${m}`,
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

/** Lote com saldo criado direto — atalho quando o foco não é o recebimento. */
async function stockLot(
  itemId: string,
  quantity: string,
  overrides: { status?: "AVAILABLE" | "BLOCKED" | "AWAITING_RELEASE"; expiryDate?: Date } = {},
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-DASH-${marker()}`.toUpperCase(),
      origin: "RECEIPT",
      itemId,
      initialReceivedQuantity: quantity,
      status: overrides.status ?? "AVAILABLE",
      ...(overrides.expiryDate ? { expiryDate: overrides.expiryDate } : {}),
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

async function receiveStock(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost?: string },
) {
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: params.supplierId,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });

  const receipt = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: po.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${marker()}`,
            ...(params.unitCost ? { actualUnitCost: params.unitCost } : {}),
          },
        ],
      },
    })
  ).json();
  fixtureReceiptIds.push(receipt.id);
  return { purchaseOrder: po, receipt };
}

async function createProduct(app: App, finishedItemId: string) {
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { customerId: await fixtureCustomerId(), name: `Produto Dashboard ${marker()}`, finishedProductItemId: finishedItemId },
    })
  ).json();
  fixtureProductIds.push(product.id);
  return product;
}

async function activateFormulation(app: App, productId: string, rawMaterialId: string) {
  const versionId = (
    await app.inject({ method: "POST", url: `/products/${productId}/formulation-versions`, payload: {} })
  ).json().id;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: rawMaterialId, quantity: "1", unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });
}

/** OP DRAFT → PLANNED → RELEASED → consumo → apontamento → COMPLETED. */
async function completeProductionOrder(app: App, productId: string, quantity: string) {
  const orderId = (
    await app.inject({ method: "POST", url: "/production-orders", payload: { productId, plannedQuantity: quantity } })
  ).json().id;
  fixtureProductionOrderIds.push(orderId);

  await aplicarRoteiroDeTeste(orderId);
  await app.inject({ method: "POST", url: `/production-orders/${orderId}/plan` });
  const released = (await app.inject({ method: "POST", url: `/production-orders/${orderId}/release` })).json();
  for (const requirement of released.requirements) {
    for (const line of requirement.reservationLines) {
      await app.inject({
        method: "POST",
        url: `/production-orders/${orderId}/picking/${line.id}/confirm`,
        payload: line.lotCode ? { lotCode: line.lotCode } : {},
      });
      await app.inject({
        method: "POST",
        url: `/production-orders/${orderId}/consumptions`,
        payload: { entries: [{ reservationLineId: line.id, quantity: line.quantity }] },
      });
    }
  }
  await app.inject({
    method: "POST",
    url: `/production-orders/${orderId}/outputs`,
    payload: { quantity, destination: "NEW_LOT", businessLotNumber: `VD-DASH-${marker()}` },
  });
  await app.inject({ method: "POST", url: `/production-orders/${orderId}/complete` });
  return orderId;
}

/**
 * O Pedido nasce do cliente DONO do produto.
 *
 * Produto pertence a um cliente, e um Pedido de outro cliente é recusado com
 * `customer_mismatch`. As métricas do painel não são sobre propriedade — o
 * pano de fundo só precisa ser íntegro.
 */
async function createOrderInFulfillment(app: App, productId: string, quantity: string) {
  const produto = await getPrisma().product.findUniqueOrThrow({ where: { id: productId } });
  const customerId = produto.customerId ?? (await createCustomer()).id;
  const orderId = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId, lines: [{ productId, orderedQuantity: quantity }] },
    })
  ).json().id;
  fixtureCustomerOrderIds.push(orderId);

  const confirmed = (await app.inject({ method: "POST", url: `/customer-orders/${orderId}/confirm` })).json();
  await app.inject({
    method: "POST",
    url: `/customer-orders/${orderId}/apply-fulfillment-plan`,
    payload: {
      lines: [
        { customerOrderLineId: confirmed.lines[0].id, reserveQuantity: quantity, produceQuantity: "0" },
      ],
    },
  });
  return orderId;
}

/**
 * Item loteado só sai depois de conferido fisicamente — a expedição não
 * confirma sem isso.
 */
async function verifyAllLots(app: App, shipmentId: string) {
  const shipment = (await app.inject({ method: "GET", url: `/shipments/${shipmentId}` })).json();
  for (const line of shipment.lines) {
    if (!line.requiresVerification) continue;
    await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/lines/${line.id}/verify`,
      payload: { lotCode: line.lotCode },
    });
  }
}

async function shipAll(app: App, orderId: string) {
  const draft = (await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })).json();
  await verifyAllLots(app, draft.id);
  return (await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` })).json();
}

async function issueBilling(app: App, shipmentId: string, unitPrice: string | null) {
  const billing = (
    await app.inject({ method: "POST", url: "/billings", payload: { shipmentId } })
  ).json();
  if (unitPrice !== null) {
    await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: { lines: billing.lines.map((line: { id: string }) => ({ billingLineId: line.id, unitPrice })) },
    });
  }
  return (await app.inject({ method: "POST", url: `/billings/${billing.id}/issue` })).json();
}

describe("Dashboard — métricas do período", () => {
  it("conta cada documento pela sua data operacional e ignora o que está fora da janela", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();
    const window = windowFor(0);

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    const dentro = await receiveStock(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "500",
      unitCost: "1",
    });
    // Segundo recebimento fica com a data de hoje: precisa ficar de fora.
    const fora = await receiveStock(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "10",
      unitCost: "1",
    });
    await prisma.receipt.update({ where: { id: dentro.receipt.id }, data: { receivedAt: window.at } });

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await activateFormulation(app, product.id, rawMaterial.id);
    const productionOrderId = await completeProductionOrder(app, product.id, "100");
    await prisma.productionOrder.update({
      where: { id: productionOrderId },
      data: { completedAt: window.at },
    });

    const orderId = await createOrderInFulfillment(app, product.id, "100");
    await prisma.customerOrder.update({ where: { id: orderId }, data: { createdAt: window.at } });

    const shipment = await shipAll(app, orderId);
    await prisma.shipment.update({ where: { id: shipment.id }, data: { confirmedAt: window.at } });

    const billing = await issueBilling(app, shipment.id, "3");
    await prisma.billing.update({ where: { id: billing.id }, data: { issuedAt: window.at } });

    const dashboard = await fetchDashboard(app, window);

    expect(dashboard.period.customerOrdersCreated).toBe(1);
    // Um Receipt com várias linhas continua sendo UM recebimento; o de hoje
    // não entra na janela.
    expect(dashboard.period.receiptsCompleted).toBe(1);
    expect(dashboard.period.productionOrdersCompleted).toBe(1);
    expect(dashboard.period.shipmentsConfirmed).toBe(1);
    expect(dashboard.period.billingsIssued).toBe(1);
    expect(dashboard.period.billingsWithCompletePricing).toBe(1);
    // 100 kg × R$ 3,00 — todos os documentos do período têm preço completo.
    expect(dashboard.period.billedAmount).toBe("300.00");

    const foraDaJanela = await fetchDashboard(app, emptyWindow(1));
    expect(foraDaJanela.period.receiptsCompleted).toBe(0);
    expect(foraDaJanela.period.billingsIssued).toBe(0);
    expect(foraDaJanela.period.billedAmount).toBeNull();
    expect(fora.receipt.id).not.toBe(dentro.receipt.id);

    await app.close();
  });

  it("não apresenta valor faturado quando algum faturamento do período está incompleto", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();
    const window = windowFor(2);

    const finishedItem = await createItem("FINISHED_PRODUCT");
    await stockLot(finishedItem.id, "250");
    const product = await createProduct(app, finishedItem.id);

    // FAT-A: 100 kg × R$ 1,00 = R$ 100,00, precificação completa.
    const orderA = await createOrderInFulfillment(app, product.id, "100");
    const shipmentA = await shipAll(app, orderA);
    const billingA = await issueBilling(app, shipmentA.id, "1");

    // FAT-B: emitido sem preço — o período inteiro fica sem valor.
    const orderB = await createOrderInFulfillment(app, product.id, "100");
    const shipmentB = await shipAll(app, orderB);
    const billingB = await issueBilling(app, shipmentB.id, null);

    // Um DRAFT nunca entra: sem `issuedAt`, não pertence a período algum.
    const orderC = await createOrderInFulfillment(app, product.id, "50");
    const shipmentC = await shipAll(app, orderC);
    const draft = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: shipmentC.id } })
    ).json();
    expect(draft.status).toBe("DRAFT");

    await prisma.billing.updateMany({
      where: { id: { in: [billingA.id, billingB.id] } },
      data: { issuedAt: window.at },
    });

    const dashboard = await fetchDashboard(app, window);
    expect(dashboard.period.billingsIssued).toBe(2);
    expect(dashboard.period.billingsWithCompletePricing).toBe(1);
    // Nunca R$ 100,00 apresentado como total do período.
    expect(dashboard.period.billedAmount).toBeNull();

    await app.close();
  });
});

describe("Dashboard — estado atual", () => {
  it("não responde ao filtro de período: OP antiga em produção continua contando hoje", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const antiga = windowFor(3);
    const janelaDeHoje = { from: diaComercialDeTeste(), to: diaComercialDeTeste() };

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveStock(app, { supplierId: supplier.id, itemId: rawMaterial.id, quantity: "500" });
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await activateFormulation(app, product.id, rawMaterial.id);

    const orderId = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: { productId: product.id, plannedQuantity: "50" },
      })
    ).json().id;
    fixtureProductionOrderIds.push(orderId);
    await aplicarRoteiroDeTeste(orderId);
    await app.inject({ method: "POST", url: `/production-orders/${orderId}/plan` });
    const released = (await app.inject({ method: "POST", url: `/production-orders/${orderId}/release` })).json();
    const line = released.requirements[0].reservationLines[0];
    await app.inject({
      method: "POST",
      url: `/production-orders/${orderId}/picking/${line.id}/confirm`,
      payload: line.lotCode ? { lotCode: line.lotCode } : {},
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${orderId}/consumptions`,
      payload: { entries: [{ reservationLineId: line.id, quantity: line.quantity }] },
    });

    // A OP fica velha: criada e atualizada muito antes da janela consultada.
    await prisma.productionOrder.update({
      where: { id: orderId },
      data: { createdAt: antiga.at, updatedAt: antiga.at },
    });
    const current = await prisma.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(current.status).toBe("IN_PRODUCTION");

    // Duas janelas radicalmente diferentes, consultadas juntas: o bloco de
    // estado atual tem que sair idêntico nas duas.
    const [hoje, historica] = await Promise.all([
      fetchDashboard(app, janelaDeHoje),
      fetchDashboard(app, emptyWindow(4)),
    ]);

    // A OP é antiga e não foi concluída: some do período, permanece no
    // estado — inclusive numa janela histórica completamente vazia.
    expect(hoje.currentState.production.inProduction).toBeGreaterThanOrEqual(1);
    expect(historica.currentState.production.inProduction).toBeGreaterThanOrEqual(1);
    expect(historica.period.productionOrdersCompleted).toBe(0);
    expect(historica.period.customerOrdersCreated).toBe(0);
    expect(historica.period.receiptsCompleted).toBe(0);

    await app.close();
  });

  it("conta OPs sem roteiro em rascunho, planejada ou liberada — e aplicar o roteiro tira da conta", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const before = await fetchDashboard(app);

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    const criar = async () => {
      const id = (
        await app.inject({ method: "POST", url: "/production-orders", payload: { productId: product.id, plannedQuantity: "10" } })
      ).json().id as string;
      fixtureProductionOrderIds.push(id);
      return id;
    };
    const rascunho = await criar();
    const planejadaLegada = await criar();
    await prisma.productionOrder.update({ where: { id: planejadaLegada }, data: { status: "PLANNED" } });
    // Em produção sem roteiro é histórico, não pendência: fora da conta.
    const emProducao = await criar();
    await prisma.productionOrder.update({ where: { id: emProducao }, data: { status: "IN_PRODUCTION" } });

    const depois = await fetchDashboard(app);
    expect(depois.currentState.production.withoutRoute - before.currentState.production.withoutRoute).toBe(2);

    await aplicarRoteiroDeTeste(rascunho);
    const resolvida = await fetchDashboard(app);
    expect(resolvida.currentState.production.withoutRoute - before.currentState.production.withoutRoute).toBe(1);

    await app.close();
  });

  it("conta itens distintos em compra, nunca a soma das quantidades", async () => {
    const app = buildTestApp();
    await app.ready();

    const before = await fetchDashboard(app);

    const supplier = await createSupplier();
    const itemA = await createItem("RAW_MATERIAL");
    const itemB = await createItem("RAW_MATERIAL");
    const po = (
      await app.inject({
        method: "POST",
        url: "/purchase-orders",
        payload: {
          supplierId: supplier.id,
          orderDate: new Date().toISOString(),
          lines: [
            { itemId: itemA.id, orderedQuantity: "1000" },
            { itemId: itemB.id, orderedQuantity: "2500" },
          ],
        },
      })
    ).json();
    fixturePurchaseOrderIds.push(po.id);
    await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });

    const after = await fetchDashboard(app);
    // Dois itens distintos entraram: o indicador sobe pelo menos 2 e
    // continua sendo uma contagem — 1000 + 2500 nunca vira 3500 aqui.
    expect(after.currentState.purchasing.itemsOnOrder).toBeGreaterThanOrEqual(
      before.currentState.purchasing.itemsOnOrder + 2,
    );
    expect(after.currentState.purchasing.itemsOnOrder).toBeLessThan(1000);
    expect(after.currentState.purchasing.openOrders).toBeGreaterThanOrEqual(
      before.currentState.purchasing.openOrders + 1,
    );

    await app.close();
  });
});

describe("Dashboard — precisa de atenção", () => {
  it("deriva os itens das entidades, exige saldo e ordena por severidade", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const item = await createItem("FINISHED_PRODUCT");
    const bloqueadoComSaldo = await stockLot(item.id, "10", { status: "BLOCKED" });
    const proximoDoVencimento = await stockLot(item.id, "10", {
      expiryDate: marcadorDoDiaComercialDeTeste(10),
    });
    // Mesmo problema, sem saldo: não é problema operacional.
    const bloqueadoSemSaldo = await prisma.lot.create({
      data: {
        code: `LT-DASH-${marker()}`.toUpperCase(),
        origin: "RECEIPT",
        itemId: item.id,
        initialReceivedQuantity: "5",
        status: "BLOCKED",
      },
    });

    const attention = await buildAttentionList(prisma);
    const byTarget = new Map(attention.map((entry) => [entry.targetId, entry]));

    const blocked = byTarget.get(bloqueadoComSaldo.id);
    expect(blocked).toBeDefined();
    expect(blocked!.type).toBe("LOT_BLOCKED");
    expect(blocked!.severity).toBe("CRITICAL");
    expect(blocked!.targetKind).toBe("LOT");

    const nearExpiry = byTarget.get(proximoDoVencimento.id);
    expect(nearExpiry).toBeDefined();
    expect(nearExpiry!.type).toBe("LOT_NEAR_EXPIRY");
    expect(nearExpiry!.severity).toBe("INFO");

    expect(byTarget.has(bloqueadoSemSaldo.id)).toBe(false);

    // CRITICAL antes de WARNING antes de INFO, em toda a lista.
    const weight = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    for (let index = 1; index < attention.length; index += 1) {
      expect(weight[attention[index]!.severity]).toBeGreaterThanOrEqual(
        weight[attention[index - 1]!.severity],
      );
    }

    const dashboard = await fetchDashboard(app);
    expect(dashboard.attentionLimit).toBe(20);
    expect(dashboard.attention.length).toBeLessThanOrEqual(20);
    expect(dashboard.attentionTotal).toBeGreaterThanOrEqual(dashboard.attention.length);

    await app.close();
  });
});

describe("Dashboard — movimentações", () => {
  it("resume eventos por tipo, agrupa ajustes e lista os movimentos recentes com origem", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();
    const window = windowFor(5);

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    const { receipt } = await receiveStock(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "100",
      unitCost: "1",
    });
    const lotId = receipt.lines[0].lotId;

    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: {
        itemId: rawMaterial.id,
        lotId,
        type: "ADJUSTMENT_OUT",
        quantity: "5",
        reason: "Amostra de laboratório",
      },
    });
    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: {
        itemId: rawMaterial.id,
        lotId,
        type: "ADJUSTMENT_IN",
        quantity: "2",
        reason: "Devolução de amostra",
      },
    });

    await prisma.inventoryMovement.updateMany({
      where: { itemId: rawMaterial.id },
      data: { occurredAt: window.at },
    });

    const dashboard = await fetchDashboard(app, window);
    expect(dashboard.movementSummary.receiptIn).toBe(1);
    // ADJUSTMENT_IN + ADJUSTMENT_OUT aparecem juntos no card.
    expect(dashboard.movementSummary.adjustments).toBe(2);
    expect(dashboard.recentMovements).toHaveLength(3);

    const receiptMovement = dashboard.recentMovements.find(
      (movement: { type: string }) => movement.type === "RECEIPT_IN",
    );
    expect(receiptMovement.sourceKind).toBe("RECEIPT");
    expect(receiptMovement.sourceCode).toBe(receipt.code);
    expect(receiptMovement.sourceId).toBe(receipt.id);
    // Quantidade sempre com a própria unidade — nunca somada entre linhas.
    expect(receiptMovement.unitCode).toBe("kg");
    expect(receiptMovement.quantity).toBe("100");

    const adjustment = dashboard.recentMovements.find(
      (movement: { type: string }) => movement.type === "ADJUSTMENT_IN",
    );
    expect(adjustment.sourceKind).toBe("ADJUSTMENT");
    expect(adjustment.sourceCode).toBeNull();

    expect(dashboard.movementActivity).toHaveLength(1);
    expect(dashboard.movementActivity[0].date).toBe(window.from);
    expect(dashboard.movementActivity[0].receiptIn).toBe(1);
    expect(dashboard.movementActivity[0].adjustments).toBe(2);

    await app.close();
  });

  it("devolve período vazio quando nada aconteceu na janela", async () => {
    const app = buildTestApp();
    await app.ready();

    const dashboard = await fetchDashboard(app, emptyWindow(6));

    expect(dashboard.period.customerOrdersCreated).toBe(0);
    expect(dashboard.period.receiptsCompleted).toBe(0);
    expect(dashboard.period.billedAmount).toBeNull();
    expect(dashboard.recentMovements).toHaveLength(0);
    expect(dashboard.movementActivity).toHaveLength(0);

    await app.close();
  });
});

describe("Dashboard — um instante por requisição (DASHBOARD-CONSISTENT-NOW-01)", () => {
  /*
   * O estado atual e a lista de atenção liam cada um o próprio relógio: na
   * virada do dia comercial o contador podia sair de 23:59:59.999 e a lista de
   * 00:00:00.001. Aqui o instante é injetado em `getDashboard`, e as duas metades
   * do MESMO retrato têm de virar juntas — lote, OC e falta de material.
   *
   * O dia é sorteado de 2031 em diante, longe do relógio real: um pedaço do
   * retrato que ainda lesse o relógio por conta própria cairia em 2026, onde o
   * lote e a OC do teste nem venceram nem estão perto, e a conta dele não
   * viraria. Os contadores são agregado do banco inteiro — por isso esta faixa
   * serial, com cada instante medido antes e depois das fixtures.
   */
  const diaISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const BASE_FUTURA = Date.UTC(2031, 0, 2) + Math.floor(Math.random() * 1400) * DAY_MS;
  const [VESPERA, DIA, SEGUINTE] = [diaISO(BASE_FUTURA - DAY_MS), diaISO(BASE_FUTURA), diaISO(BASE_FUTURA + DAY_MS)];

  type Contas = { vencidos: number; perto: number; atrasadas: number; falta: number };

  /**
   * Cada instante, o dia dele em São Paulo e o que as fixtures somam nele — à
   * mão, nunca recalculado com o helper que o código usa. O lote vence na
   * véspera: vale a véspera inteira (perto do vencimento) e vence à meia-noite.
   */
  const RETRATOS: { quando: string; saoPaulo: string; hoje: string; periodo: [string, string]; soma: Contas }[] = [
    {
      quando: `${VESPERA}T15:00:00.000Z`,
      saoPaulo: "véspera 12:00",
      hoje: VESPERA,
      periodo: [`${VESPERA}T03:00:00.000Z`, `${DIA}T02:59:59.999Z`],
      soma: { vencidos: 0, perto: 1, atrasadas: 0, falta: 0 },
    },
    {
      quando: `${DIA}T02:59:59.999Z`,
      saoPaulo: "véspera 23:59:59.999",
      hoje: VESPERA,
      periodo: [`${VESPERA}T03:00:00.000Z`, `${DIA}T02:59:59.999Z`],
      soma: { vencidos: 0, perto: 1, atrasadas: 0, falta: 0 },
    },
    {
      quando: `${DIA}T03:00:00.000Z`,
      saoPaulo: "dia 00:00",
      hoje: DIA,
      periodo: [`${DIA}T03:00:00.000Z`, `${SEGUINTE}T02:59:59.999Z`],
      soma: { vencidos: 1, perto: 0, atrasadas: 1, falta: 1 },
    },
    {
      quando: `${DIA}T15:00:00.000Z`,
      saoPaulo: "dia 12:00",
      hoje: DIA,
      periodo: [`${DIA}T03:00:00.000Z`, `${SEGUINTE}T02:59:59.999Z`],
      soma: { vencidos: 1, perto: 0, atrasadas: 1, falta: 1 },
    },
  ];

  /** O Painel num instante — o mesmo caminho da rota, com o `now` na mão do teste. */
  async function retratoEm(quando: string): Promise<DashboardDTO> {
    const agora = new Date(quando);
    return getDashboard(dashboardQuerySchemaEm(agora).parse({}), agora);
  }

  /** As quatro contas no contador do estado atual e na lista de atenção de UM retrato. */
  function contasDo(painel: DashboardDTO) {
    const naLista = (tipo: AttentionType) => painel.attentionGroups.find((grupo) => grupo.type === tipo)?.count ?? 0;
    return {
      contador: {
        vencidos: painel.currentState.inventory.lotsExpired,
        perto: painel.currentState.inventory.lotsNearExpiry,
        atrasadas: painel.currentState.purchasing.lateOrders,
        falta: painel.currentState.production.withShortage,
      },
      atencao: {
        vencidos: naLista("LOT_EXPIRED"),
        perto: naLista("LOT_NEAR_EXPIRY"),
        atrasadas: naLista("PURCHASE_ORDER_LATE"),
        falta: naLista("PRODUCTION_ORDER_SHORTAGE"),
      },
      total: painel.attentionTotal,
    };
  }

  const menos = (a: Contas, b: Contas): Contas => ({
    vencidos: a.vencidos - b.vencidos,
    perto: a.perto - b.perto,
    atrasadas: a.atrasadas - b.atrasadas,
    falta: a.falta - b.falta,
  });

  it("na virada do dia comercial, contador e lista de atenção viram juntos — e fora da borda seguem o dia", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    // A borda é a de São Paulo, conferida pelo Intl — não pelo helper do código.
    const diaEmSaoPaulo = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
    for (const retrato of RETRATOS) {
      expect(diaEmSaoPaulo.format(new Date(retrato.quando)), retrato.saoPaulo).toBe(retrato.hoje);
    }

    const antes: ReturnType<typeof contasDo>[] = [];
    for (const retrato of RETRATOS) antes.push(contasDo(await retratoEm(retrato.quando)));

    // Um lote que vence na véspera e é a única fonte do material de uma OP em
    // rascunho, e uma OC aberta prevista para a véspera.
    const vespera = new Date(`${VESPERA}T00:00:00.000Z`);
    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await stockLot(rawMaterial.id, "1000", { expiryDate: vespera });
    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await activateFormulation(app, product.id, rawMaterial.id);

    const op = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: product.id, plannedQuantity: "10" },
    });
    expect(op.statusCode, op.body.slice(0, 300)).toBe(201);
    fixtureProductionOrderIds.push(op.json().id);

    const oc = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: supplier.id,
        orderDate: new Date().toISOString(),
        expectedDeliveryDate: vespera.toISOString(),
        lines: [{ itemId: rawMaterial.id, orderedQuantity: "100" }],
      },
    });
    expect(oc.statusCode, oc.body.slice(0, 300)).toBe(201);
    fixturePurchaseOrderIds.push(oc.json().id);
    const confirmada = await app.inject({ method: "POST", url: `/purchase-orders/${oc.json().id}/confirm` });
    expect(confirmada.statusCode, confirmada.body.slice(0, 300)).toBe(200);

    // As fixtures são o que dizem ser — senão "não falta" poderia ser OP sem requisito.
    const requisitos = await prisma.productionOrderRequirement.findMany({
      where: { productionOrderId: op.json().id },
      select: { itemId: true, requiredQuantity: true, productionOrder: { select: { status: true } } },
    });
    expect(
      requisitos.map((requisito) => [requisito.productionOrder.status, requisito.itemId, requisito.requiredQuantity.toString()]),
    ).toEqual([["DRAFT", rawMaterial.id, "10"]]);

    for (const [indice, retrato] of RETRATOS.entries()) {
      const rotulo = `${retrato.saoPaulo} em São Paulo (${retrato.quando})`;
      const painel = await retratoEm(retrato.quando);
      const depois = contasDo(painel);
      const semFixtures = antes[indice]!;

      expect(menos(depois.contador, semFixtures.contador), `contador · ${rotulo}`).toEqual(retrato.soma);
      expect(menos(depois.atencao, semFixtures.atencao), `atenção · ${rotulo}`).toEqual(retrato.soma);
      // Nada além dessas contas entrou na lista por causa das fixtures.
      const { vencidos, perto, atrasadas, falta } = retrato.soma;
      expect(depois.total - semFixtures.total, `total da atenção · ${rotulo}`).toBe(vencidos + perto + atrasadas + falta);
      // O "hoje" do período sem filtro é o mesmo dia do estado atual.
      expect([painel.period.from, painel.period.to], `período · ${rotulo}`).toEqual(retrato.periodo);
    }

    await app.close();
  });

  it("guarda estrutural: a rota lê o relógio uma vez e o retrato não lê de novo", () => {
    const pasta = fileURLToPath(new URL("./", import.meta.url));
    // Sem comentários: a explicação do bug pode citar o padrão; o código, não.
    const codigo = (arquivo: string) =>
      readFileSync(join(pasta, arquivo), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const RELOGIO = /new Date\(\)|Date\.now\(\)|hojeComercial\(\)|marcadorDeHojeComercial\(\)/g;

    const rota = codigo("dashboard.routes.ts");
    expect(rota.match(RELOGIO)).toEqual(["new Date()"]);
    expect(rota).toMatch(/dashboardQuerySchemaEm\(now\)/);
    expect(rota).toMatch(/getDashboard\(parsed\.data, now\)/);

    for (const arquivo of ["dashboard.schemas.ts", "dashboard.service.ts", "dashboard.queries.ts"]) {
      expect(codigo(arquivo).match(RELOGIO), arquivo).toBeNull();
    }
    // A atenção guarda o padrão só para quem a chama sozinha; o Painel passa `now`.
    const atencao = codigo("attention.service.ts");
    expect(atencao.match(RELOGIO)).toEqual(["new Date()"]);
    expect(atencao).toMatch(/now: Date = new Date\(\)/);
  });
});
