import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

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
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }

  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.purchaseOrder.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
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

async function report(app: App, path: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await app.inject({ method: "GET", url: `/reports/${path}${query ? `?${query}` : ""}` });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function createCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-REL-${m}`, legalName: `Cliente Relatórios ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-REL-${m}`, legalName: `Fornecedor Relatórios ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createItem(
  type: "RAW_MATERIAL" | "FINISHED_PRODUCT",
  overrides: { controlsLot?: boolean; controlsExpiry?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-REL-${m}`,
      name: `Item Relatórios ${m}`,
      unitCode: "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: overrides.controlsExpiry ?? false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function stockLot(
  itemId: string,
  quantity: string,
  overrides: { expiryDate?: Date; status?: "AVAILABLE" | "BLOCKED" | "AWAITING_RELEASE" } = {},
) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-REL-${marker()}`.toUpperCase(),
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

async function stockItemWithoutLot(itemId: string, quantity: string) {
  const prisma = getPrisma();
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      type: "ADJUSTMENT_IN",
      quantity,
      occurredAt: new Date(),
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "Saldo inicial de teste",
      createdBy: "Teste",
    },
  });
}

async function receive(
  app: App,
  params: {
    supplierId: string;
    itemId: string;
    quantity: string;
    unitPrice?: string;
    unitCost?: string;
    expectedDeliveryDate?: Date;
  },
) {
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: params.supplierId,
        orderDate: new Date().toISOString(),
        ...(params.expectedDeliveryDate
          ? { expectedDeliveryDate: params.expectedDeliveryDate.toISOString() }
          : {}),
        lines: [
          {
            itemId: params.itemId,
            orderedQuantity: params.quantity,
            ...(params.unitPrice ? { unitPrice: params.unitPrice } : {}),
          },
        ],
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

/** OC confirmada, deliberadamente sem recebimento — fica "em compra". */
async function openPurchaseOrder(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; expectedDeliveryDate?: Date },
) {
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: params.supplierId,
        orderDate: new Date().toISOString(),
        ...(params.expectedDeliveryDate
          ? { expectedDeliveryDate: params.expectedDeliveryDate.toISOString() }
          : {}),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });
  return po;
}

async function createProduct(app: App, finishedItemId: string) {
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: `Produto Relatórios ${marker()}`, finishedProductItemId: finishedItemId },
    })
  ).json();
  fixtureProductIds.push(product.id);
  return product;
}

async function activateFormulation(
  app: App,
  productId: string,
  rawMaterialId: string,
  quantityPerBasis = "1",
) {
  const versionId = (
    await app.inject({ method: "POST", url: `/products/${productId}/formulation-versions`, payload: {} })
  ).json().id;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: rawMaterialId, quantity: quantityPerBasis, unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });
}

async function createProductionOrder(app: App, productId: string, quantity: string) {
  const orderId = (
    await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId, plannedQuantity: quantity },
    })
  ).json().id;
  fixtureProductionOrderIds.push(orderId);
  await app.inject({ method: "POST", url: `/production-orders/${orderId}/plan` });
  return orderId;
}

/** Executa a OP até COMPLETED, apontando `outputQuantity`. */
async function runProductionOrder(app: App, orderId: string, outputQuantity: string) {
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
    payload: { quantity: outputQuantity, destination: "NEW_LOT", businessLotNumber: `VD-REL-${marker()}` },
  });
  // Produzir menos que o planejado exige justificativa explicita.
  await app.inject({
    method: "POST",
    url: `/production-orders/${orderId}/complete`,
    payload: { completionReason: "Rendimento real do lote de teste" },
  });
}

async function createOrder(
  app: App,
  lines: { productId: string; orderedQuantity: string; reserveQuantity: string }[],
) {
  const customer = await createCustomer();
  const created = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: customer.id,
        lines: lines.map((line) => ({
          productId: line.productId,
          orderedQuantity: line.orderedQuantity,
        })),
      },
    })
  ).json();
  fixtureCustomerOrderIds.push(created.id);

  const confirmed = (
    await app.inject({ method: "POST", url: `/customer-orders/${created.id}/confirm` })
  ).json();
  const orderLineByProduct = new Map<string, string>(
    confirmed.lines.map((line: { id: string; productId: string }) => [line.productId, line.id]),
  );

  await app.inject({
    method: "POST",
    url: `/customer-orders/${created.id}/apply-fulfillment-plan`,
    payload: {
      lines: lines.map((line) => ({
        customerOrderLineId: orderLineByProduct.get(line.productId),
        reserveQuantity: line.reserveQuantity,
        produceQuantity: (Number(line.orderedQuantity) - Number(line.reserveQuantity)).toString(),
      })),
    },
  });

  return { orderId: created.id as string, customer, orderLineByProduct };
}

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

/** Expede as quantidades informadas por produto e confirma. */
async function ship(app: App, orderId: string, quantityByProduct: Record<string, string>) {
  const draft = (
    await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })
  ).json();

  await app.inject({
    method: "PATCH",
    url: `/shipments/${draft.id}`,
    payload: {
      lines: draft.lines.map((line: { customerOrderReservationLineId: string; productId: string }) => ({
        customerOrderReservationLineId: line.customerOrderReservationLineId,
        quantity: quantityByProduct[line.productId] ?? "0",
      })),
    },
  });

  await verifyAllLots(app, draft.id);
  const confirmed = await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` });
  expect(confirmed.statusCode).toBe(200);
  return confirmed.json();
}

async function issueBilling(app: App, shipmentId: string, options: { unitPrice?: string; quantity?: string } = {}) {
  const billing = (
    await app.inject({ method: "POST", url: "/billings", payload: { shipmentId } })
  ).json();

  if (options.unitPrice) {
    await app.inject({
      method: "PATCH",
      url: `/billings/${billing.id}`,
      payload: {
        lines: billing.lines.map((line: { id: string }) => ({
          billingLineId: line.id,
          unitPrice: options.unitPrice,
        })),
      },
    });
  }
  return (await app.inject({ method: "POST", url: `/billings/${billing.id}/issue` })).json();
}

describe("Relatórios — Estoque", () => {
  it("R-01: saldo vem do ledger, com lote e sem lote, e Qualidade zera o disponível", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const lotItem = await createItem("FINISHED_PRODUCT");
    const lot = await stockLot(lotItem.id, "1000");
    const product = await createProduct(app, lotItem.id);
    await createOrder(app, [
      { productId: product.id, orderedQuantity: "400", reserveQuantity: "400" },
    ]);

    const withLot = await report(app, "inventory/position", { itemId: lotItem.id });
    expect(withLot.rows).toHaveLength(1);
    expect(withLot.rows[0].lotId).toBe(lot.id);
    expect(withLot.rows[0].onHand).toBe("1000");
    expect(withLot.rows[0].reserved).toBe("400");
    expect(withLot.rows[0].available).toBe("600");
    // Recebido inicial nunca é usado como saldo.
    expect(withLot.rows[0].status).toBe("AVAILABLE");

    // Lote bloqueado continua existindo fisicamente, mas indisponível.
    await prisma.lot.update({ where: { id: lot.id }, data: { status: "BLOCKED" } });
    const blocked = await report(app, "inventory/position", { itemId: lotItem.id });
    expect(blocked.rows[0].onHand).toBe("1000");
    expect(blocked.rows[0].available).toBe("0");

    // Item sem controle de lote: uma linha no nível do Item.
    const looseItem = await createItem("RAW_MATERIAL", { controlsLot: false });
    await stockItemWithoutLot(looseItem.id, "250");
    const withoutLot = await report(app, "inventory/position", { itemId: looseItem.id });
    expect(withoutLot.rows).toHaveLength(1);
    expect(withoutLot.rows[0].lotId).toBeNull();
    expect(withoutLot.rows[0].onHand).toBe("250");
    expect(withoutLot.rows[0].available).toBe("250");

    // Item sem saldo some do padrão e volta quando pedido.
    const emptyItem = await createItem("RAW_MATERIAL", { controlsLot: false });
    expect((await report(app, "inventory/position", { itemId: emptyItem.id })).rows).toHaveLength(0);
    const includingEmpty = await report(app, "inventory/position", {
      itemId: emptyItem.id,
      onlyWithBalance: "false",
    });
    expect(includingEmpty.rows).toHaveLength(1);
    expect(includingEmpty.rows[0].onHand).toBe("0");

    await app.close();
  });

  it("R-02: separa vencidos, 7/30 dias e período personalizado, exigindo saldo", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await createItem("FINISHED_PRODUCT", { controlsExpiry: true });
    const expired = await stockLot(item.id, "10", {
      expiryDate: new Date(Date.now() - 3 * DAY_MS),
    });
    const inFiveDays = await stockLot(item.id, "20", {
      expiryDate: new Date(Date.now() + 5 * DAY_MS),
    });
    const inFortyDays = await stockLot(item.id, "30", {
      expiryDate: new Date(Date.now() + 40 * DAY_MS),
    });
    // Mesmo vencendo logo, lote zerado não é problema operacional.
    const zeroed = await stockLot(item.id, "15", { expiryDate: new Date(Date.now() + 3 * DAY_MS) });
    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: {
        itemId: item.id,
        lotId: zeroed.id,
        type: "ADJUSTMENT_OUT",
        quantity: "15",
        reason: "Descarte total",
      },
    });

    const vencidos = await report(app, "inventory/expiry", { itemId: item.id, window: "EXPIRED" });
    expect(vencidos.rows.map((row: { lotId: string }) => row.lotId)).toEqual([expired.id]);
    expect(vencidos.rows[0].isExpired).toBe(true);
    expect(vencidos.rows[0].daysToExpiry).toBeLessThan(0);

    const sete = await report(app, "inventory/expiry", { itemId: item.id, window: "D7" });
    expect(sete.rows.map((row: { lotId: string }) => row.lotId)).toEqual([inFiveDays.id]);
    expect(sete.rows[0].daysToExpiry).toBeGreaterThan(0);
    expect(sete.rows[0].daysToExpiry).toBeLessThanOrEqual(7);
    // Lote zerado não aparece mesmo vencendo dentro da janela.
    expect(sete.rows.some((row: { lotId: string }) => row.lotId === zeroed.id)).toBe(false);

    const trinta = await report(app, "inventory/expiry", { itemId: item.id, window: "D30" });
    expect(trinta.rows.map((row: { lotId: string }) => row.lotId)).toEqual([inFiveDays.id]);

    const personalizado = await report(app, "inventory/expiry", {
      itemId: item.id,
      window: "CUSTOM",
      from: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      to: new Date(Date.now() + 60 * DAY_MS).toISOString(),
    });
    expect(personalizado.rows.map((row: { lotId: string }) => row.lotId)).toEqual([inFortyDays.id]);

    await app.close();
  });

  it("R-03: lista os tipos de movimento com origem, período e usuário", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    const { receipt } = await receive(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "500",
      unitCost: "2",
    });

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await activateFormulation(app, product.id, rawMaterial.id);
    const productionOrderId = await createProductionOrder(app, product.id, "100");
    await runProductionOrder(app, productionOrderId, "100");

    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: {
        itemId: rawMaterial.id,
        lotId: receipt.lines[0].lotId,
        type: "ADJUSTMENT_OUT",
        quantity: "5",
        reason: "Amostra de laboratório",
      },
    });

    const rawMovements = await report(app, "inventory/movements", { itemId: rawMaterial.id });
    const byType = new Map<string, (typeof rawMovements.rows)[number]>(
      rawMovements.rows.map((row: { type: string }) => [row.type, row]),
    );

    expect(byType.get("RECEIPT_IN").documentKind).toBe("RECEIPT");
    expect(byType.get("RECEIPT_IN").documentCode).toBe(receipt.code);
    expect(byType.get("RECEIPT_IN").quantity).toBe("500");
    expect(byType.get("RECEIPT_IN").createdBy).not.toBeNull();

    expect(byType.get("PRODUCTION_CONSUMPTION").documentKind).toBe("PRODUCTION_ORDER");
    expect(byType.get("ADJUSTMENT_OUT").reason).toBe("Amostra de laboratório");
    expect(byType.get("ADJUSTMENT_OUT").documentKind).toBeNull();

    const finishedMovements = await report(app, "inventory/movements", { itemId: finishedItem.id });
    expect(finishedMovements.rows[0].type).toBe("FINISHED_GOOD_PRODUCTION");
    expect(finishedMovements.rows[0].documentKind).toBe("PRODUCTION_ORDER");

    // Filtro por tipo e por período são server-side.
    const onlyReceipts = await report(app, "inventory/movements", {
      itemId: rawMaterial.id,
      type: "RECEIPT_IN",
    });
    expect(onlyReceipts.total).toBe(1);

    const outOfWindow = await report(app, "inventory/movements", {
      itemId: rawMaterial.id,
      from: new Date(Date.now() - 40 * DAY_MS).toISOString(),
      to: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    });
    expect(outOfWindow.total).toBe(0);

    await app.close();
  });
});

describe("Relatórios — Produção", () => {
  it("R-04: falta considera a reserva da própria OP e não é reduzida por On Order", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receive(app, { supplierId: supplier.id, itemId: rawMaterial.id, quantity: "100" });

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await activateFormulation(app, product.id, rawMaterial.id);

    // Precisa de 300 e só existem 100 em estoque.
    const orderId = await createProductionOrder(app, product.id, "300");
    const shortage = await report(app, "production/requirements", { productionOrderId: orderId });
    expect(shortage.rows).toHaveLength(1);
    expect(shortage.rows[0].requiredQuantity).toBe("300");
    expect(shortage.rows[0].available).toBe("100");
    expect(shortage.rows[0].shortage).toBe("200");
    expect(shortage.rows[0].productionOrderStatus).toBe("PLANNED");

    // On Order é informativo: nunca reduz a falta.
    await openPurchaseOrder(app, { supplierId: supplier.id, itemId: rawMaterial.id, quantity: "200" });
    const withOnOrder = await report(app, "production/requirements", { productionOrderId: orderId });
    expect(withOnOrder.rows[0].onOrder).toBe("200");
    expect(withOnOrder.rows[0].shortage).toBe("200");

    // Uma OP liberada não vira falta por causa da própria reserva.
    const feasibleOrderId = await createProductionOrder(app, product.id, "100");
    await app.inject({ method: "POST", url: `/production-orders/${feasibleOrderId}/release` });
    const released = await report(app, "production/requirements", {
      productionOrderId: feasibleOrderId,
    });
    expect(released.rows[0].shortage).toBe("0");
    expect(released.rows[0].reserved).toBe("100");

    const onlyShortage = await report(app, "production/requirements", {
      productionOrderId: feasibleOrderId,
      onlyShortage: "true",
    });
    expect(onlyShortage.rows).toHaveLength(0);

    await app.close();
  });

  it("R-05: planejado, produzido, variação e rendimento a partir dos apontamentos", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receive(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "500",
      unitCost: "2",
    });

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await activateFormulation(app, product.id, rawMaterial.id);
    const orderId = await createProductionOrder(app, product.id, "100");
    // Produz menos do que o planejado: rendimento de 90%.
    await runProductionOrder(app, orderId, "90");

    const result = await report(app, "production/planned-actual", {
      productionOrderId: orderId,
      includeCost: "true",
    });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.plannedQuantity).toBe("100");
    expect(row.producedQuantity).toBe("90");
    expect(row.variance).toBe("-10");
    expect(row.yieldPercent).toBe("90.00");
    expect(row.status).toBe("COMPLETED");
    expect(row.completedAt).not.toBeNull();
    // Custo com qualidade explícita — 100 kg × R$ 2 / 90 un.
    expect(row.costQuality).toBe("REAL");
    expect(row.materialUnitCost).not.toBeNull();

    await app.close();
  });

  it("R-06: genealogia usa só consumo e apontamento reais", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    const { receipt } = await receive(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "500",
      unitCost: "3",
    });
    // Segundo lote apenas existe: nunca foi consumido, não pode aparecer.
    const unusedLot = await stockLot(rawMaterial.id, "500");

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await activateFormulation(app, product.id, rawMaterial.id);
    const orderId = await createProductionOrder(app, product.id, "50");
    await runProductionOrder(app, orderId, "50");

    const trace = await report(app, "production/traceability", { productionOrderId: orderId });
    expect(trace.productionOrderId).toBe(orderId);
    expect(trace.producedQuantity).toBe("50");

    expect(trace.consumed).toHaveLength(1);
    expect(trace.consumed[0].lotId).toBe(receipt.lines[0].lotId);
    expect(trace.consumed[0].supplierName).toBe((await getPrisma().supplier.findUniqueOrThrow({ where: { id: supplier.id } })).legalName);
    expect(trace.consumed[0].quantity).toBe("50");
    expect(trace.consumed.some((row: { lotId: string }) => row.lotId === unusedLot.id)).toBe(false);

    expect(trace.produced).toHaveLength(1);
    expect(trace.produced[0].quantity).toBe("50");
    expect(trace.produced[0].businessLotNumber).not.toBeNull();

    await app.close();
  });

  it("R-07: consumo por período traz custo real e 'sem custo' explícito", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();

    const pricedMaterial = await createItem("RAW_MATERIAL");
    await receive(app, {
      supplierId: supplier.id,
      itemId: pricedMaterial.id,
      quantity: "200",
      unitCost: "4",
    });
    const pricedFinished = await createItem("FINISHED_PRODUCT");
    const pricedProduct = await createProduct(app, pricedFinished.id);
    await activateFormulation(app, pricedProduct.id, pricedMaterial.id);
    const pricedOrderId = await createProductionOrder(app, pricedProduct.id, "50");
    await runProductionOrder(app, pricedOrderId, "50");

    const real = await report(app, "production/consumption", { productionOrderId: pricedOrderId });
    expect(real.rows).toHaveLength(1);
    expect(real.rows[0].quantity).toBe("50");
    expect(real.rows[0].costSource).toBe("REAL");
    expect(real.rows[0].unitCost).toBe("4");
    expect(real.rows[0].totalCost).toBe("200.00");
    expect(real.rows[0].lotCode).not.toBeNull();

    const freeMaterial = await createItem("RAW_MATERIAL");
    await receive(app, { supplierId: supplier.id, itemId: freeMaterial.id, quantity: "200" });
    const freeFinished = await createItem("FINISHED_PRODUCT");
    const freeProduct = await createProduct(app, freeFinished.id);
    await activateFormulation(app, freeProduct.id, freeMaterial.id);
    const freeOrderId = await createProductionOrder(app, freeProduct.id, "50");
    await runProductionOrder(app, freeOrderId, "50");

    const noCost = await report(app, "production/consumption", { productionOrderId: freeOrderId });
    expect(noCost.rows[0].costSource).toBe("NO_COST");
    // Custo desconhecido nunca vira zero.
    expect(noCost.rows[0].unitCost).toBeNull();
    expect(noCost.rows[0].totalCost).toBeNull();

    const outOfWindow = await report(app, "production/consumption", {
      productionOrderId: pricedOrderId,
      from: new Date(Date.now() - 40 * DAY_MS).toISOString(),
      to: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    });
    expect(outOfWindow.total).toBe(0);

    await app.close();
  });
});

describe("Relatórios — Compras", () => {
  it("R-08: status, origem e valor previsto só com preço completo", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const itemA = await createItem("RAW_MATERIAL");
    const itemB = await createItem("RAW_MATERIAL");

    const priced = (
      await app.inject({
        method: "POST",
        url: "/purchase-orders",
        payload: {
          supplierId: supplier.id,
          orderDate: new Date().toISOString(),
          lines: [
            { itemId: itemA.id, orderedQuantity: "100", unitPrice: "2" },
            { itemId: itemB.id, orderedQuantity: "50", unitPrice: "4" },
          ],
        },
      })
    ).json();
    fixturePurchaseOrderIds.push(priced.id);
    await app.inject({ method: "POST", url: `/purchase-orders/${priced.id}/confirm` });

    const partial = (
      await app.inject({
        method: "POST",
        url: "/purchase-orders",
        payload: {
          supplierId: supplier.id,
          orderDate: new Date().toISOString(),
          lines: [
            { itemId: itemA.id, orderedQuantity: "100", unitPrice: "2" },
            { itemId: itemB.id, orderedQuantity: "50" },
          ],
        },
      })
    ).json();
    fixturePurchaseOrderIds.push(partial.id);

    const result = await report(app, "purchasing/orders", { supplierId: supplier.id });
    const byCode = new Map<string, { expectedAmount: string | null; status: string; origin: string; linesWithPrice: number }>(
      result.rows.map((row: { code: string }) => [row.code, row]),
    );

    // 100 × 2 + 50 × 4 = 400,00.
    expect(byCode.get(priced.code)!.expectedAmount).toBe("400.00");
    expect(byCode.get(priced.code)!.status).toBe("ORDERED");
    expect(byCode.get(priced.code)!.origin).toBe("MANUAL");

    // Preço incompleto nunca vira total parcial.
    expect(byCode.get(partial.code)!.expectedAmount).toBeNull();
    expect(byCode.get(partial.code)!.linesWithPrice).toBe(1);
    expect(byCode.get(partial.code)!.status).toBe("DRAFT");

    const onlyOrdered = await report(app, "purchasing/orders", {
      supplierId: supplier.id,
      status: "ORDERED",
    });
    expect(onlyOrdered.total).toBe(1);

    await app.close();
  });

  it("R-09: linha a linha, com lote, preço da OC e custo efetivo separados", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    const { receipt } = await receive(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "300",
      unitPrice: "5",
      unitCost: "4.5",
    });

    const result = await report(app, "purchasing/receipts", { supplierId: supplier.id });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.receiptCode).toBe(receipt.code);
    expect(row.receivedQuantity).toBe("300");
    expect(row.lotId).toBe(receipt.lines[0].lotId);
    expect(row.supplierLot).not.toBeNull();
    // Preço da OC e custo efetivo nunca se confundem.
    expect(row.orderedUnitPrice).toBe("5");
    expect(row.actualUnitCost).toBe("4.5");
    expect(row.costQuality).toBe("REAL");

    const withoutCost = await createItem("RAW_MATERIAL");
    await receive(app, { supplierId: supplier.id, itemId: withoutCost.id, quantity: "10" });
    const noCostResult = await report(app, "purchasing/receipts", { itemId: withoutCost.id });
    expect(noCostResult.rows[0].actualUnitCost).toBeNull();
    expect(noCostResult.rows[0].costQuality).toBe("NO_COST");

    await app.close();
  });

  it("R-10 e R-11: em compra só com saldo aberto, atrasadas por previsão vencida", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");

    // DRAFT nunca conta como compra em curso.
    const draft = (
      await app.inject({
        method: "POST",
        url: "/purchase-orders",
        payload: {
          supplierId: supplier.id,
          orderDate: new Date().toISOString(),
          lines: [{ itemId: item.id, orderedQuantity: "999" }],
        },
      })
    ).json();
    fixturePurchaseOrderIds.push(draft.id);

    const late = await openPurchaseOrder(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      expectedDeliveryDate: new Date(Date.now() - 5 * DAY_MS),
    });
    const future = await openPurchaseOrder(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "40",
      expectedDeliveryDate: new Date(Date.now() + 5 * DAY_MS),
    });
    // Totalmente recebida: sai de "em compra".
    await receive(app, { supplierId: supplier.id, itemId: item.id, quantity: "10" });

    const onOrder = await report(app, "purchasing/on-order", { supplierId: supplier.id });
    const codes = onOrder.rows.map((row: { purchaseOrderCode: string }) => row.purchaseOrderCode);
    expect(codes).toContain(late.code);
    expect(codes).toContain(future.code);
    expect(codes).not.toContain(draft.code);
    expect(onOrder.rows).toHaveLength(2);
    const lateRow = onOrder.rows.find((row: { purchaseOrderCode: string }) => row.purchaseOrderCode === late.code);
    expect(lateRow.openQuantity).toBe("100");
    expect(lateRow.receivedQuantity).toBe("0");

    const lateReport = await report(app, "purchasing/late", { supplierId: supplier.id });
    expect(lateReport.rows).toHaveLength(1);
    expect(lateReport.rows[0].purchaseOrderCode).toBe(late.code);
    expect(lateReport.rows[0].daysLate).toBeGreaterThanOrEqual(4);

    await app.close();
  });
});

describe("Relatórios — Comercial e Faturamento", () => {
  it("R-12 a R-17: pedido com dois produtos, expedição e faturamento parciais", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receive(app, { supplierId: supplier.id, itemId: rawMaterial.id, quantity: "1000" });

    const itemA = await createItem("FINISHED_PRODUCT");
    const itemB = await createItem("FINISHED_PRODUCT");
    await stockLot(itemA.id, "500");
    await stockLot(itemB.id, "300");
    const productA = await createProduct(app, itemA.id);
    const productB = await createProduct(app, itemB.id);
    await activateFormulation(app, productA.id, rawMaterial.id);

    // A: 500 pedido / 500 reservado. B: 300 pedido / 300 reservado.
    const { orderId } = await createOrder(app, [
      { productId: productA.id, orderedQuantity: "500", reserveQuantity: "500" },
      { productId: productB.id, orderedQuantity: "300", reserveQuantity: "300" },
    ]);

    // Expedição 1: A completo, B parcial (200 de 300).
    const shipment = await ship(app, orderId, { [productA.id]: "500", [productB.id]: "200" });
    // Faturamento cobre a expedição inteira: A 500 + B 200.
    await issueBilling(app, shipment.id, { unitPrice: "10" });

    /* R-12 */
    const orders = await report(app, "commercial/orders", {});
    const orderRow = orders.rows.find(
      (row: { customerOrderId: string }) => row.customerOrderId === orderId,
    );
    expect(orders.total).toBeGreaterThan(0);
    expect(orderRow.status).toBe("PARTIALLY_SHIPPED");
    expect(orderRow.lineCount).toBe(2);
    expect(orderRow.shipmentCount).toBe(1);
    expect(orderRow.billingCount).toBe(1);
    expect(orderRow.billingStatus).toBe("PARTIALLY_BILLED");

    /* R-13 */
    const fulfillment = await report(app, "commercial/fulfillment", { customerOrderId: orderId });
    const byProduct = new Map<string, Record<string, string>>(
      fulfillment.rows.map((row: { productId: string }) => [row.productId, row]),
    );
    const rowA = byProduct.get(productA.id)!;
    const rowB = byProduct.get(productB.id)!;

    expect(rowA.orderedQuantity).toBe("500");
    expect(rowA.shippedQuantity).toBe("500");
    expect(rowA.billedQuantity).toBe("500");
    expect(rowA.outstandingQuantity).toBe("0");

    expect(rowB.orderedQuantity).toBe("300");
    expect(rowB.shippedQuantity).toBe("200");
    expect(rowB.billedQuantity).toBe("200");
    expect(rowB.outstandingQuantity).toBe("100");
    // Produtos nunca se misturam.
    expect(rowB.productId).not.toBe(rowA.productId);

    /* R-14 */
    const chain = await report(app, "commercial/order-operation", { customerOrderId: orderId });
    expect(chain.code).toBeDefined();
    expect(chain.lines).toHaveLength(2);
    expect(chain.reservations.length).toBeGreaterThanOrEqual(2);
    expect(chain.shipments).toHaveLength(1);
    expect(chain.shipments[0].lines).toHaveLength(2);
    expect(chain.billings).toHaveLength(1);
    expect(chain.billings[0].totalAmount).toBe("7000.00");
    const reservationA = chain.reservations.find(
      (row: { productId: string }) => row.productId === productA.id,
    );
    expect(reservationA.shippedQuantity).toBe("500");

    /* R-15 */
    const billingPeriod = await report(app, "billing/period", { customerOrderId: orderId });
    expect(billingPeriod.rows).toHaveLength(1);
    expect(billingPeriod.rows[0].hasCompletePricing).toBe(true);
    // (500 + 200) × 10.
    expect(billingPeriod.rows[0].totalAmount).toBe("7000.00");
    expect(billingPeriod.summary.billingCount).toBe(1);
    expect(billingPeriod.summary.totalAmount).toBe("7000.00");

    /* R-16 */
    const awaitingBefore = await report(app, "billing/awaiting", {});
    expect(
      awaitingBefore.rows.some((row: { shipmentId: string }) => row.shipmentId === shipment.id),
    ).toBe(false);

    // Expedição 2: os 100 restantes de B, faturamento apenas em preparação.
    const shipment2 = await ship(app, orderId, { [productB.id]: "100" });
    const draftBilling = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: shipment2.id } })
    ).json();

    const awaiting = await report(app, "billing/awaiting", {});
    const awaitingRow = awaiting.rows.find(
      (row: { shipmentId: string }) => row.shipmentId === shipment2.id,
    );
    expect(awaitingRow).toBeDefined();
    // Faturamento DRAFT aparece como "em preparação", nunca como faturado.
    expect(awaitingRow.situation).toBe("DRAFT");
    expect(awaitingRow.billingCode).toBe(draftBilling.code);
    expect(awaitingRow.daysWaiting).toBeGreaterThanOrEqual(0);

    /* R-17 */
    const delivered = await report(app, "billing/order-delivered-billed", {
      customerOrderId: orderId,
    });
    const deliveredByProduct = new Map<string, Record<string, string>>(
      delivered.rows.map((row: { productId: string }) => [row.productId, row]),
    );
    const deliveredB = deliveredByProduct.get(productB.id)!;
    expect(deliveredB.orderedQuantity).toBe("300");
    expect(deliveredB.shippedQuantity).toBe("300");
    // DRAFT não conta como faturado.
    expect(deliveredB.billedQuantity).toBe("200");
    expect(deliveredB.unbilledShippedQuantity).toBe("100");
    expect(deliveredB.outstandingDeliveryQuantity).toBe("0");

    const deliveredA = deliveredByProduct.get(productA.id)!;
    expect(deliveredA.shippedQuantity).toBe("500");
    expect(deliveredA.billedQuantity).toBe("500");
    expect(deliveredA.unbilledShippedQuantity).toBe("0");

    await app.close();
  });

  it("R-13: produzido vem das OPs do pedido, não do reservado nem do expedido", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receive(app, { supplierId: supplier.id, itemId: rawMaterial.id, quantity: "1000" });

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = await createProduct(app, finishedItem.id);
    await activateFormulation(app, product.id, rawMaterial.id);

    // Nada em estoque: o pedido inteiro depende de produção.
    const { orderId } = await createOrder(app, [
      { productId: product.id, orderedQuantity: "200", reserveQuantity: "0" },
    ]);

    const before = await report(app, "commercial/fulfillment", { customerOrderId: orderId });
    expect(before.rows[0].producedQuantity).toBe("0");
    expect(before.rows[0].productionOrderCount).toBe(1);
    expect(before.rows[0].shippedQuantity).toBe("0");

    const generated = await getPrisma().productionOrder.findFirstOrThrow({
      where: { customerOrderId: orderId },
    });
    fixtureProductionOrderIds.push(generated.id);
    await app.inject({ method: "POST", url: `/production-orders/${generated.id}/plan` });
    await runProductionOrder(app, generated.id, "200");

    const after = await report(app, "commercial/fulfillment", { customerOrderId: orderId });
    // Produzido não implica reservado nem expedido.
    expect(after.rows[0].producedQuantity).toBe("200");
    expect(after.rows[0].shippedQuantity).toBe("0");
    expect(after.rows[0].billedQuantity).toBe("0");
    expect(after.rows[0].outstandingQuantity).toBe("200");

    await app.close();
  });

  it("R-15: total do período some quando algum faturamento está sem preço", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    await stockLot(finishedItem.id, "300");
    const product = await createProduct(app, finishedItem.id);

    const complete = await createOrder(app, [
      { productId: product.id, orderedQuantity: "100", reserveQuantity: "100" },
    ]);
    const shipmentA = await ship(app, complete.orderId, { [product.id]: "100" });
    const billingA = await issueBilling(app, shipmentA.id, { unitPrice: "1" });

    const incomplete = await createOrder(app, [
      { productId: product.id, orderedQuantity: "100", reserveQuantity: "100" },
    ]);
    const shipmentB = await ship(app, incomplete.orderId, { [product.id]: "100" });
    const billingB = await issueBilling(app, shipmentB.id);

    const customerA = await report(app, "billing/period", { customerOrderId: complete.orderId });
    expect(customerA.rows[0].totalAmount).toBe("100.00");
    expect(customerA.summary.totalAmount).toBe("100.00");

    const customerB = await report(app, "billing/period", { customerOrderId: incomplete.orderId });
    expect(customerB.rows[0].hasCompletePricing).toBe(false);
    expect(customerB.rows[0].totalAmount).toBeNull();
    expect(customerB.summary.totalAmount).toBeNull();

    // Uma janela cobrindo os dois documentos: total agregado indisponível.
    const window = { from: new Date(Date.UTC(1995, 0, 10)), to: new Date(Date.UTC(1995, 0, 11)) };
    await prisma.billing.updateMany({
      where: { id: { in: [billingA.id, billingB.id] } },
      data: { issuedAt: new Date(Date.UTC(1995, 0, 10, 12)) },
    });
    const mixed = await report(app, "billing/period", {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    });
    expect(mixed.summary.billingCount).toBe(2);
    expect(mixed.summary.billingsWithCompletePricing).toBe(1);
    // Nunca R$ 100,00 apresentado como total do período.
    expect(mixed.summary.totalAmount).toBeNull();

    // Só ISSUED entra: um DRAFT nunca tem `issuedAt`.
    expect(mixed.rows.every((row: { issuedAt: string }) => row.issuedAt !== null)).toBe(true);

    await app.close();
  });
});
