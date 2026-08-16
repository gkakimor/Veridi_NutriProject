import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

type App = ReturnType<typeof buildApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOutput.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({ where: { reservationId: { in: reservationIds } } });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
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
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-FG-${m}`, legalName: `Fornecedor PA Teste ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-FG-${m}`,
      name: `Item PA Teste ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/** Recebimento real com custo — alimenta o custo material da OP. */
async function receiveWithCost(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost?: string },
) {
  const poResponse = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId: params.supplierId,
      orderDate: new Date().toISOString(),
      lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
    },
  });
  const po = poResponse.json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });

  const receiptResponse = await app.inject({
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
  });
  const receipt = receiptResponse.json();
  fixtureReceiptIds.push(receipt.id);
  return receipt;
}

async function createProductWithFormulation(
  app: App,
  rawMaterialId: string,
  quantityPerBasis: string,
  finishedItemOverride?: { requiresQualityRelease?: boolean },
) {
  const prisma = getPrisma();
  const m = marker();
  const finishedItem = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-FG-${m}`,
      name: `Produto Acabado Teste ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: finishedItemOverride?.requiresQualityRelease ?? false,
      active: true,
    },
  });
  fixtureItemIds.push(finishedItem.id);

  const productResponse = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto PA Teste ${m}`, finishedProductItemId: finishedItem.id },
  });
  const product = productResponse.json();
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
    payload: {
      basisQuantity: "1",
      components: [{ itemId: rawMaterialId, quantity: quantityPerBasis, unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  return { product, finishedItem };
}

/** OP completa: plan → release → picking/consumo → output. */
async function produceLot(
  app: App,
  productId: string,
  plannedQuantity: string,
  outputQuantity: string,
  businessLotNumber: string,
) {
  const created = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity },
  });
  const orderId = created.json().id;
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

  const output = await app.inject({
    method: "POST",
    url: `/production-orders/${orderId}/outputs`,
    payload: { quantity: outputQuantity, destination: "NEW_LOT", businessLotNumber },
  });
  const orderDetail = output.json();
  return { orderId, orderCode: orderDetail.code, lotId: orderDetail.outputs[0].lotId };
}

async function listFinishedGoods(app: App, query = "") {
  return (await app.inject({ method: "GET", url: `/finished-goods${query}` })).json();
}

describe("Produto Acabado — visão operacional", () => {
  it("lista apenas lotes origin PRODUCTION, nunca lotes de recebimento", async () => {
    const app = buildApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    const receipt = await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });
    const receiptLotId = receipt.lines[0].lotId;

    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10");
    const produced = await produceLot(app, product.id, "5", "5", "VD-FG-1");

    const result = await listFinishedGoods(app, "?pageSize=100");
    const lotIds = result.rows.map((row: { lotId: string }) => row.lotId);
    expect(lotIds).toContain(produced.lotId);
    // Lote de recebimento nunca aparece nesta tela.
    expect(lotIds).not.toContain(receiptLotId);

    await app.close();
  });

  it("produzido vem do ProductionOutput e nunca é usado como saldo; On Hand/Reserved/Available vêm do ledger", async () => {
    const app = buildApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });

    const { product, finishedItem } = await createProductWithFormulation(app, rawMaterial.id, "10");
    const produced = await produceLot(app, product.id, "10", "10", "VD-FG-2");

    // Consome parte do produto acabado por um ajuste de saída, para que
    // produzido (10) e On Hand (7) fiquem propositalmente diferentes.
    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: {
        itemId: finishedItem.id,
        lotId: produced.lotId,
        type: "ADJUSTMENT_OUT",
        quantity: "3",
        reason: "Amostra de laboratório",
      },
    });

    const result = await listFinishedGoods(app, `?pageSize=100&productionOrderId=${produced.orderId}`);
    const row = result.rows.find((r: { lotId: string }) => r.lotId === produced.lotId);
    expect(row).toBeDefined();
    expect(row.producedQuantity).toBe("10");
    expect(row.onHand).toBe("7");
    expect(row.reserved).toBe("0");
    expect(row.available).toBe("7");
    expect(row.productionOrderCode).toBe(produced.orderCode);
    expect(row.businessLotNumber).toBe("VD-FG-2");
    expect(row.productId).toBe(product.id);
    expect(row.itemId).toBe(finishedItem.id);
    expect(row.producedAt).not.toBeNull();

    await app.close();
  });

  it("qualidade reflete o status efetivo e a liberação altera Available", async () => {
    const app = buildApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });

    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10", {
      requiresQualityRelease: true,
    });
    const produced = await produceLot(app, product.id, "8", "8", "VD-FG-3");

    const before = await listFinishedGoods(app, `?productionOrderId=${produced.orderId}`);
    const beforeRow = before.rows[0];
    expect(beforeRow.status).toBe("AWAITING_RELEASE");
    expect(beforeRow.onHand).toBe("8");
    // Aguardando Qualidade: existe fisicamente mas não está disponível.
    expect(beforeRow.available).toBe("0");

    // Reutiliza a ação de Qualidade já existente do Lote — sem duplicar.
    await app.inject({ method: "POST", url: `/lots/${produced.lotId}/release` });

    const after = await listFinishedGoods(app, `?productionOrderId=${produced.orderId}`);
    expect(after.rows[0].status).toBe("AVAILABLE");
    expect(after.rows[0].available).toBe("8");

    await app.close();
  });

  it("custo material vem da Fundação de Custos com a qualidade correta", async () => {
    const app = buildApp();
    await app.ready();

    const supplier = await createSupplier();

    // Cenário com custo real: matéria-prima recebida com custo informado.
    const comCusto = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: comCusto.id,
      quantity: "1000",
      unitCost: "2",
    });
    const withCost = await createProductWithFormulation(app, comCusto.id, "10");
    // 10 un × 10 kg/un = 100 kg × R$ 2/kg = R$ 200 de material;
    // 10 un produzidas = R$ 20,0000 por unidade.
    const producedReal = await produceLot(app, withCost.product.id, "10", "10", "VD-FG-4");

    const realResult = await listFinishedGoods(app, `?productionOrderId=${producedReal.orderId}`);
    expect(realResult.rows[0].costQuality).toBe("REAL");
    expect(realResult.rows[0].materialUnitCost).toBe("20.0000");
    expect(realResult.rows[0].costSource).toBe("REAL");

    // Cenário sem custo: matéria-prima recebida sem custo informado.
    const semCusto = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: semCusto.id, quantity: "1000" });
    const withoutCost = await createProductWithFormulation(app, semCusto.id, "10");
    const producedNoCost = await produceLot(app, withoutCost.product.id, "10", "10", "VD-FG-5");

    const noCostResult = await listFinishedGoods(app, `?productionOrderId=${producedNoCost.orderId}`);
    expect(noCostResult.rows[0].costQuality).toBe("NO_COST");
    // Custo indisponível nunca é apresentado como valor completo.
    expect(noCostResult.rows[0].materialUnitCost).toBeNull();

    await app.close();
  });

  it("filtra por status de qualidade e por busca de lote Veridi", async () => {
    const app = buildApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: rawMaterial.id,
      quantity: "1000",
      unitCost: "10",
    });

    const { product } = await createProductWithFormulation(app, rawMaterial.id, "10");
    const marca = `VD-BUSCA-${marker()}`;
    const produced = await produceLot(app, product.id, "6", "6", marca);

    const bySearch = await listFinishedGoods(app, `?search=${encodeURIComponent(marca)}`);
    expect(bySearch.rows).toHaveLength(1);
    expect(bySearch.rows[0].lotId).toBe(produced.lotId);

    const byStatus = await listFinishedGoods(app, "?status=AVAILABLE&pageSize=100");
    expect(byStatus.rows.every((row: { status: string }) => row.status === "AVAILABLE")).toBe(true);

    const byBlocked = await listFinishedGoods(app, "?status=BLOCKED&pageSize=100");
    expect(byBlocked.rows.some((row: { lotId: string }) => row.lotId === produced.lotId)).toBe(false);

    await app.close();
  });
});
