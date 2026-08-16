import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { buildAttentionList } from "./attention.service.js";

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureSupplierIds: string[] = [];

type App = ReturnType<typeof buildApp>;

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
 */
function windowFor(dayOffset: number) {
  const day = new Date(HISTORIC_BASE + dayOffset * DAY_MS);
  const [year, month, date] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
  return {
    from: new Date(Date.UTC(year, month, date, 0, 0, 0, 0)),
    at: new Date(Date.UTC(year, month, date, 12, 0, 0, 0)),
    to: new Date(Date.UTC(year, month, date, 23, 59, 59, 999)),
  };
}

/** Janela histórica garantidamente vazia (nenhum teste escreve nela). */
function emptyWindow(dayOffset: number) {
  const { from, to } = windowFor(dayOffset);
  return { from, to };
}

async function fetchDashboard(app: App, window?: { from: Date; to: Date }) {
  const query = window
    ? `?from=${encodeURIComponent(window.from.toISOString())}&to=${encodeURIComponent(window.to.toISOString())}`
    : "";
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
      payload: { name: `Produto Dashboard ${marker()}`, finishedProductItemId: finishedItemId },
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

async function createOrderInFulfillment(app: App, productId: string, quantity: string) {
  const customer = await createCustomer();
  const orderId = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: customer.id, lines: [{ productId, orderedQuantity: quantity }] },
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
    const app = buildApp();
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
    const app = buildApp();
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
    const app = buildApp();
    await app.ready();
    const prisma = getPrisma();

    const antiga = windowFor(3);
    const janelaDeHoje = {
      from: new Date(new Date().setHours(0, 0, 0, 0)),
      to: new Date(),
    };

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

    expect(historica.currentState.production).toEqual(hoje.currentState.production);
    expect(historica.currentState.commercial).toEqual(hoje.currentState.commercial);
    // A OP é antiga e não foi concluída: some do período, permanece no estado.
    expect(hoje.currentState.production.inProduction).toBeGreaterThanOrEqual(1);
    expect(historica.period.productionOrdersCompleted).toBe(0);
    expect(historica.period.customerOrdersCreated).toBe(0);

    await app.close();
  });

  it("conta itens distintos em compra, nunca a soma das quantidades", async () => {
    const app = buildApp();
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
    const app = buildApp();
    await app.ready();
    const prisma = getPrisma();

    const item = await createItem("FINISHED_PRODUCT");
    const bloqueadoComSaldo = await stockLot(item.id, "10", { status: "BLOCKED" });
    const proximoDoVencimento = await stockLot(item.id, "10", {
      expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
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
    const app = buildApp();
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
    expect(dashboard.movementActivity[0].date).toBe(window.at.toISOString().slice(0, 10));
    expect(dashboard.movementActivity[0].receiptIn).toBe(1);
    expect(dashboard.movementActivity[0].adjustments).toBe(2);

    await app.close();
  });

  it("devolve período vazio quando nada aconteceu na janela", async () => {
    const app = buildApp();
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
