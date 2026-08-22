import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Material que o cliente envia não tem aquisição da Veridi.
 *
 * A tela do recebimento oferecia "Definir custo" também para essas linhas —
 * e o serviço aceitava. Um número gravado ali entraria em relatório como se
 * fosse compra nossa, sobre material que nunca compramos. A recusa vive no
 * domínio, não só no botão.
 */

const fixtureReceiptIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureSupplierIds: string[] = [];

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
  if (fixtureReceiptIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({
      where: { lot: { is: { receiptLine: { is: { receiptId: { in: fixtureReceiptIds } } } } } },
    });
    await prisma.lot.deleteMany({
      where: { receiptLine: { is: { receiptId: { in: fixtureReceiptIds } } } },
    });
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarItem() {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-CC-${m}`,
      name: `Material custo cliente ${m}`,
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

async function criarCliente() {
  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-CC-${m}`, legalName: `Cliente custo ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function criarFornecedor() {
  const prisma = getPrisma();
  const m = marca();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-CC-${m}`, legalName: `Fornecedor custo ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

describe("Custo de aquisição — material fornecido pelo cliente", () => {
  it("recusa gravar custo em linha de recebimento do cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await criarItem();
    const cliente = await criarCliente();

    const recebimento = await app.inject({
      method: "POST",
      url: "/receipts/customer-supplied",
      payload: {
        customerId: cliente.id,
        receivedAt: new Date().toISOString(),
        lines: [
          {
            itemId: item.id,
            receivedQuantity: "2",
            supplierLot: `CLI-LOTE-${marca()}`,
          },
        ],
      },
    });
    expect(recebimento.statusCode).toBe(201);
    const corpo = recebimento.json();
    fixtureReceiptIds.push(corpo.id);
    expect(corpo.sourceType).toBe("CUSTOMER_SUPPLIED");

    const tentativa = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${corpo.lines[0].id}/acquisition-cost`,
      payload: { unitCost: "1200" },
    });

    expect(tentativa.statusCode).toBe(400);
    expect(tentativa.json().error).toBe("customer_supplied_material");
    expect(tentativa.json().message).toContain("não recebem custo de aquisição Veridi");

    // E o custo continua ausente — a recusa não deixa rastro parcial.
    const depois = await app.inject({ method: "GET", url: `/receipts/${corpo.id}` });
    expect(depois.json().lines[0].actualUnitCost).toBeNull();

    await app.close();
  });

  it("linha de compra da Veridi continua aceitando custo normalmente", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await criarItem();
    const fornecedor = await criarFornecedor();

    const oc = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: fornecedor.id,
        orderDate: new Date().toISOString().slice(0, 10),
        lines: [{ itemId: item.id, orderedQuantity: "5", unitPrice: "10" }],
      },
    });
    const ocId = oc.json().id;
    fixturePurchaseOrderIds.push(ocId);
    await app.inject({ method: "POST", url: `/purchase-orders/${ocId}/confirm` });

    const recebimento = await app.inject({
      method: "POST",
      url: `/purchase-orders/${ocId}/receipts`,
      payload: {
        receivedAt: new Date().toISOString().slice(0, 10),
        lines: [
          {
            purchaseOrderLineId: oc.json().lines[0].id,
            receivedQuantity: "5",
            supplierLot: `FOR-LOTE-${marca()}`,
          },
        ],
      },
    });
    const corpo = recebimento.json();
    fixtureReceiptIds.push(corpo.id);

    const definido = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${corpo.lines[0].id}/acquisition-cost`,
      payload: { unitCost: "12.5" },
    });

    expect(definido.statusCode).toBe(200);
    expect(definido.json().lines[0].actualUnitCost).toBe("12.5000");

    await app.close();
  });
});
