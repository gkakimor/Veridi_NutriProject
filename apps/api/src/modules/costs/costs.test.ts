import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
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
    data: { code: `FOR-CST-${m}`, legalName: `Fornecedor Custo Teste ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createItem(
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  overrides: { unitCode?: string; controlsLot?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "ME" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-CST-${m}`,
      name: `Item Custo Teste ${m}`,
      unitCode: overrides.unitCode ?? "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/**
 * Recebimento real (OC → confirmar → receber), com `receivedAt` e custo
 * controláveis — é o único caminho que alimenta as médias de custo.
 */
async function receiveWithCost(
  app: App,
  params: {
    supplierId: string;
    itemId: string;
    quantity: string;
    unitCost?: string | null;
    purchasePrice?: string;
    receivedAt?: Date;
  },
) {
  const poResponse = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId: params.supplierId,
      orderDate: new Date().toISOString(),
      lines: [
        {
          itemId: params.itemId,
          orderedQuantity: params.quantity,
          ...(params.purchasePrice ? { unitPrice: params.purchasePrice } : {}),
        },
      ],
    },
  });
  const po = poResponse.json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });

  const receiptResponse = await app.inject({
    method: "POST",
    url: `/purchase-orders/${po.id}/receipts`,
    payload: {
      receivedAt: (params.receivedAt ?? new Date()).toISOString(),
      lines: [
        {
          purchaseOrderLineId: po.lines[0].id,
          receivedQuantity: params.quantity,
          supplierLot: `SUP-${marker()}`,
          ...(params.unitCost !== undefined && params.unitCost !== null
            ? { actualUnitCost: params.unitCost }
            : {}),
        },
      ],
    },
  });
  const receipt = receiptResponse.json();
  fixtureReceiptIds.push(receipt.id);
  return receipt;
}

async function getCostReference(app: App, itemId: string, referenceDate?: Date) {
  const query = referenceDate ? `?referenceDate=${referenceDate.toISOString()}` : "";
  return (await app.inject({ method: "GET", url: `/items/${itemId}/cost-reference${query}` })).json();
}

async function createProductWithFormulation(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
  overrides: { basisQuantity?: string } = {},
) {
  const finishedItem = await createItem("FINISHED_PRODUCT", { unitCode: "un" });
  const productResponse = await app.inject({
    method: "POST",
    url: "/products",
    payload: { customerId: await fixtureCustomerId(), name: `Produto Custo Teste ${marker()}`, finishedProductItemId: finishedItem.id },
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
    payload: { basisQuantity: overrides.basisQuantity ?? "1", components },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

  return { product, finishedItem, versionId };
}

/** OP liberada, com Picking+Consumo confirmados, opcionalmente com Output. */
async function produceOrder(
  app: App,
  productId: string,
  plannedQuantity: string,
  options: { outputQuantity?: string } = {},
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

  if (options.outputQuantity) {
    await app.inject({
      method: "POST",
      url: `/production-orders/${orderId}/outputs`,
      payload: {
        quantity: options.outputQuantity,
        destination: "NEW_LOT",
        businessLotNumber: `VD-CST-${marker()}`,
      },
    });
  }

  return orderId;
}

async function getMaterialCost(app: App, productionOrderId: string) {
  return (
    await app.inject({ method: "GET", url: `/production-orders/${productionOrderId}/material-cost` })
  ).json();
}

describe("Custo de aquisição no recebimento", () => {
  it("recebimento funciona sem custo; custo desconhecido é null, nunca 0", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    const receipt = await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "100" });

    expect(receipt.lines[0].actualUnitCost).toBeNull();
    expect(receipt.lines[0].receivedQuantity).toBe("100");

    const reference = await getCostReference(app, item.id);
    expect(reference.source).toBe("NO_COST");
    expect(reference.unitCost).toBeNull();

    await app.close();
  });

  it("preço da OC NUNCA vira custo real automaticamente", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    const receipt = await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      purchasePrice: "30",
    });

    // O preço da OC aparece só como referência visual.
    expect(receipt.lines[0].purchaseUnitPrice).toBe("30.0000");
    expect(receipt.lines[0].actualUnitCost).toBeNull();

    const reference = await getCostReference(app, item.id);
    expect(reference.source).toBe("NO_COST");
    expect(reference.unitCost).toBeNull();

    await app.close();
  });

  it("custo negativo rejeitado; zero explícito é válido e distinto de null", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    const receipt = await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "100" });
    const lineId = receipt.lines[0].id;

    const negative = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${lineId}/acquisition-cost`,
      payload: { unitCost: "-5" },
    });
    expect(negative.statusCode).toBe(400);

    const zero = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${lineId}/acquisition-cost`,
      payload: { unitCost: "0" },
    });
    expect(zero.statusCode).toBe(200);
    expect(zero.json().lines[0].actualUnitCost).toBe("0.0000");

    // Zero é um custo real informado — não é "desconhecido".
    const reference = await getCostReference(app, item.id);
    expect(reference.source).toBe("ESTIMATED_30D");
    expect(reference.unitCost).toBe("0.0000");

    await app.close();
  });

  it("define custo depois do recebimento sem alterar quantidade, estoque nem movimentos", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    const receipt = await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "100" });

    const inventoryBefore = (await app.inject({ method: "GET", url: `/inventory/${item.id}` })).json();
    const movementsBefore = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${item.id}` })
    ).json().movements.length;

    const updated = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${receipt.lines[0].id}/acquisition-cost`,
      payload: { unitCost: "31.50", note: "Nota do fornecedor chegou depois" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().lines[0].actualUnitCost).toBe("31.5000");
    expect(updated.json().lines[0].costNote).toBe("Nota do fornecedor chegou depois");
    expect(updated.json().lines[0].costUpdatedAt).not.toBeNull();
    // Quantidade física intocada.
    expect(updated.json().lines[0].receivedQuantity).toBe("100");

    const inventoryAfter = (await app.inject({ method: "GET", url: `/inventory/${item.id}` })).json();
    expect(inventoryAfter.onHand).toBe(inventoryBefore.onHand);
    expect(inventoryAfter.reserved).toBe(inventoryBefore.reserved);
    expect(inventoryAfter.available).toBe(inventoryBefore.available);
    expect(inventoryAfter.onOrder).toBe(inventoryBefore.onOrder);

    const movementsAfter = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${item.id}` })
    ).json().movements.length;
    expect(movementsAfter).toBe(movementsBefore);

    await app.close();
  });

  it("custo pode ser corrigido e limpo (volta a desconhecido)", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    const receipt = await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "20",
    });
    expect(receipt.lines[0].actualUnitCost).toBe("20.0000");

    const corrected = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${receipt.lines[0].id}/acquisition-cost`,
      payload: { unitCost: "25", note: "Correção" },
    });
    expect(corrected.json().lines[0].actualUnitCost).toBe("25.0000");

    const cleared = await app.inject({
      method: "PUT",
      url: `/receipt-lines/${receipt.lines[0].id}/acquisition-cost`,
      payload: { unitCost: "" },
    });
    expect(cleared.json().lines[0].actualUnitCost).toBeNull();

    await app.close();
  });
});

describe("Referência de custo — média ponderada e fallback", () => {
  it("MÉDIA PONDERADA OBRIGATÓRIA: 10kg@10 + 90kg@20 = 19/kg (nunca 15)", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "10", unitCost: "10" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "90", unitCost: "20" });

    const reference = await getCostReference(app, item.id);
    expect(reference.source).toBe("ESTIMATED_30D");
    expect(reference.unitCost).toBe("19.0000");
    expect(Number(reference.unitCost)).not.toBe(15);

    await app.close();
  });

  it("hierarquia 30d → 90d → último custo real → sem custo", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();

    // Só histórico de 60 dias atrás → cai em 90d.
    const item90 = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item90.id,
      quantity: "50",
      unitCost: "12",
      receivedAt: new Date(Date.now() - 60 * DAY_MS),
    });
    const ref90 = await getCostReference(app, item90.id);
    expect(ref90.source).toBe("ESTIMATED_90D");
    expect(ref90.unitCost).toBe("12.0000");

    // Só histórico de 200 dias atrás → último custo real.
    const itemLast = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: itemLast.id,
      quantity: "50",
      unitCost: "8",
      receivedAt: new Date(Date.now() - 200 * DAY_MS),
    });
    const refLast = await getCostReference(app, itemLast.id);
    expect(refLast.source).toBe("LAST_REAL_COST");
    expect(refLast.unitCost).toBe("8.0000");

    // Nenhum histórico → sem custo.
    const itemNone = await createItem("RAW_MATERIAL");
    const refNone = await getCostReference(app, itemNone.id);
    expect(refNone.source).toBe("NO_COST");
    expect(refNone.unitCost).toBeNull();

    await app.close();
  });

  it("recebimento posterior à data de referência é ignorado", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");

    const past = new Date(Date.now() - 10 * DAY_MS);
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "10",
      receivedAt: past,
    });
    // Compra bem mais cara, feita depois da data de referência.
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "100", unitCost: "99" });

    // Referência histórica: só enxerga o que já existia naquele momento.
    const historical = await getCostReference(app, item.id, new Date(Date.now() - 5 * DAY_MS));
    expect(historical.unitCost).toBe("10.0000");

    // Hoje: já considera as duas compras (média ponderada 54.5).
    const today = await getCostReference(app, item.id);
    expect(today.unitCost).toBe("54.5000");

    await app.close();
  });

  it("data de referência é o DIA inteiro: recebimento da tarde do mesmo dia conta", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");

    // Compra lançada à tarde. Uma consulta pela data dela chega como
    // meia-noite — e comparar contra o instante jogava a própria compra
    // para fora, devolvendo "sem custo" com o custo gravado no banco.
    const tarde = new Date();
    tarde.setUTCHours(20, 53, 0, 0);
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "30",
      unitCost: "180",
      receivedAt: tarde,
    });

    const meiaNoite = new Date(tarde);
    meiaNoite.setUTCHours(0, 0, 0, 0);
    const noDia = await getCostReference(app, item.id, meiaNoite);
    expect(noDia.unitCost).toBe("180.0000");
    expect(noDia.source).toBe("ESTIMATED_30D");

    // A véspera continua sem enxergar nada: o dia seguinte não vaza para trás.
    const vespera = new Date(meiaNoite.getTime() - DAY_MS);
    const antes = await getCostReference(app, item.id, vespera);
    expect(antes.unitCost).toBeNull();
    expect(antes.source).toBe("NO_COST");

    await app.close();
  });
});

describe("Custo estimado da formulação", () => {
  it("converte UOM (g→kg e mg→kg), soma componentes e usa basisQuantity", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const vitamina = await createItem("RAW_MATERIAL"); // kg
    const corante = await createItem("RAW_MATERIAL"); // kg
    const pote = await createItem("PACKAGING", { unitCode: "un", controlsLot: false });

    await receiveWithCost(app, { supplierId: supplier.id, itemId: vitamina.id, quantity: "100", unitCost: "31.50" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: corante.id, quantity: "10", unitCost: "200" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: pote.id, quantity: "1000", unitCost: "1.25" });

    const { versionId } = await createProductWithFormulation(
      app,
      [
        { itemId: vitamina.id, quantity: "500", unitCode: "g" }, // 0,5 kg × 31,50 = 15,75
        { itemId: corante.id, quantity: "2000", unitCode: "mg" }, // 0,002 kg × 200 = 0,40
        { itemId: pote.id, quantity: "10", unitCode: "un" }, // 10 × 1,25 = 12,50
      ],
      { basisQuantity: "10" },
    );

    const estimate = (
      await app.inject({ method: "GET", url: `/formulation-versions/${versionId}/cost-estimate` })
    ).json();

    expect(estimate.quality).toBe("ESTIMATED");
    const byItem = new Map(
      estimate.components.map((c: { itemId: string; estimatedComponentCost: string }) => [
        c.itemId,
        c.estimatedComponentCost,
      ]),
    );
    expect(byItem.get(vitamina.id)).toBe("15.75");
    expect(byItem.get(corante.id)).toBe("0.40");
    expect(byItem.get(pote.id)).toBe("12.50");

    // Embalagem entra normalmente no custo material.
    expect(estimate.estimatedMaterialCost).toBe("28.65");
    // Unitário usa basisQuantity (10).
    expect(estimate.estimatedMaterialUnitCost).toBe("2.8650");

    await app.close();
  });

  it("PARTIAL não apresenta subtotal como total; NO_COST quando nenhum componente tem custo", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const comCusto = await createItem("RAW_MATERIAL");
    const semCusto = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: comCusto.id, quantity: "100", unitCost: "10" });

    const partialFormulation = await createProductWithFormulation(app, [
      { itemId: comCusto.id, quantity: "1", unitCode: "kg" },
      { itemId: semCusto.id, quantity: "1", unitCode: "kg" },
    ]);
    const partial = (
      await app.inject({
        method: "GET",
        url: `/formulation-versions/${partialFormulation.versionId}/cost-estimate`,
      })
    ).json();
    expect(partial.quality).toBe("PARTIAL");
    expect(partial.knownCostSubtotal).toBe("10.00");
    expect(partial.estimatedMaterialCost).toBeNull();
    expect(partial.estimatedMaterialUnitCost).toBeNull();
    expect(partial.missingCostItems).toContain(semCusto.code);

    const outroSemCusto = await createItem("RAW_MATERIAL");
    const noCostFormulation = await createProductWithFormulation(app, [
      { itemId: outroSemCusto.id, quantity: "1", unitCode: "kg" },
    ]);
    const noCost = (
      await app.inject({
        method: "GET",
        url: `/formulation-versions/${noCostFormulation.versionId}/cost-estimate`,
      })
    ).json();
    expect(noCost.quality).toBe("NO_COST");
    expect(noCost.estimatedMaterialCost).toBeNull();

    await app.close();
  });
});

describe("Custo de materiais da Ordem de Produção", () => {
  it("CRÍTICO: usa o custo do lote REALMENTE consumido, nunca média do item nem FEFO esperado", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");

    // LT-A barato (chega primeiro, seria o escolhido por FIFO) e LT-B caro.
    const receiptA = await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "10",
      receivedAt: new Date(Date.now() - 5 * DAY_MS),
    });
    const receiptB = await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "30",
    });
    const lotA = receiptA.lines[0].lotId;
    const lotB = receiptB.lines[0].lotId;

    // Bloqueia LT-A para forçar o consumo real de LT-B.
    await getPrisma().lot.update({ where: { id: lotA }, data: { status: "BLOCKED" } });

    const { product } = await createProductWithFormulation(app, [
      { itemId: item.id, quantity: "10", unitCode: "kg" },
    ]);
    const orderId = await produceOrder(app, product.id, "1", { outputQuantity: "1" });

    const cost = await getMaterialCost(app, orderId);
    expect(cost.consumptions).toHaveLength(1);
    expect(cost.consumptions[0].lotId).toBe(lotB);
    expect(cost.consumptions[0].costSource).toBe("REAL");
    expect(cost.consumptions[0].unitCost).toBe("30.0000");
    // 10 kg × R$ 30 = R$ 300 — nunca a média do item (R$ 20) nem LT-A.
    expect(cost.consumptions[0].materialCost).toBe("300.00");
    expect(cost.totalMaterialCost).toBe("300.00");
    expect(cost.quality).toBe("REAL");

    await app.close();
  });

  it("CUSTO MATERIAL/UNIDADE usa produção real (990), nunca a planejada (1000)", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    // 8910 kg @ R$ 1,00 → R$ 8.910 de material consumido.
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "20000",
      unitCost: "1",
    });

    const { product } = await createProductWithFormulation(
      app,
      [{ itemId: item.id, quantity: "8910", unitCode: "kg" }],
      { basisQuantity: "1000" },
    );
    const orderId = await produceOrder(app, product.id, "1000", { outputQuantity: "990" });

    const cost = await getMaterialCost(app, orderId);
    expect(cost.totalMaterialCost).toBe("8910.00");
    expect(cost.producedQuantity).toBe("990");
    // 8910 / 990 = 9,00 — divisor é a produção real, refletindo a perda.
    expect(cost.materialUnitCost).toBe("9.0000");

    await app.close();
  });

  it("lote sem custo cai no fallback histórico → ESTIMATED", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    // Histórico com custo, mas o lote que será consumido não tem custo.
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: "20",
      receivedAt: new Date(Date.now() - 3 * DAY_MS),
    });
    const semCusto = await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: null,
    });
    // Bloqueia o lote com custo para forçar o consumo do lote sem custo.
    const lotComCusto = (
      await getPrisma().receiptLine.findFirst({
        where: { itemId: item.id, actualUnitCost: { not: null } },
        select: { lotId: true },
      })
    )?.lotId;
    await getPrisma().lot.update({ where: { id: lotComCusto! }, data: { status: "BLOCKED" } });

    const { product } = await createProductWithFormulation(app, [
      { itemId: item.id, quantity: "10", unitCode: "kg" },
    ]);
    const orderId = await produceOrder(app, product.id, "1", { outputQuantity: "1" });

    const cost = await getMaterialCost(app, orderId);
    expect(cost.consumptions[0].lotId).toBe(semCusto.lines[0].lotId);
    expect(cost.consumptions[0].costSource).toBe("ESTIMATED_30D");
    expect(cost.consumptions[0].unitCost).toBe("20.0000");
    expect(cost.quality).toBe("ESTIMATED");
    expect(cost.totalMaterialCost).toBe("200.00");

    await app.close();
  });

  it("PARTIAL: subtotal conhecido nunca vira total; sem custo nenhum → NO_COST", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const comCusto = await createItem("RAW_MATERIAL");
    const semCusto = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: comCusto.id, quantity: "100", unitCost: "10" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: semCusto.id, quantity: "100" });

    const { product } = await createProductWithFormulation(app, [
      { itemId: comCusto.id, quantity: "10", unitCode: "kg" },
      { itemId: semCusto.id, quantity: "5", unitCode: "kg" },
    ]);
    const orderId = await produceOrder(app, product.id, "1", { outputQuantity: "1" });

    const cost = await getMaterialCost(app, orderId);
    expect(cost.quality).toBe("PARTIAL");
    expect(cost.knownMaterialCostSubtotal).toBe("100.00");
    expect(cost.totalMaterialCost).toBeNull();
    expect(cost.materialUnitCost).toBeNull();
    expect(cost.missingCostItems).toContain(semCusto.code);

    await app.close();
  });

  it("BACKFILL: informar o custo depois melhora automaticamente o custo da OP", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    const receipt = await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: item.id,
      quantity: "100",
      unitCost: null,
    });

    const { product } = await createProductWithFormulation(app, [
      { itemId: item.id, quantity: "10", unitCode: "kg" },
    ]);
    const orderId = await produceOrder(app, product.id, "1", { outputQuantity: "1" });

    const before = await getMaterialCost(app, orderId);
    expect(before.quality).toBe("NO_COST");
    expect(before.totalMaterialCost).toBeNull();

    // Nota do fornecedor chega depois.
    await app.inject({
      method: "PUT",
      url: `/receipt-lines/${receipt.lines[0].id}/acquisition-cost`,
      payload: { unitCost: "12.5" },
    });

    const after = await getMaterialCost(app, orderId);
    expect(after.quality).toBe("REAL");
    expect(after.consumptions[0].costSource).toBe("REAL");
    expect(after.totalMaterialCost).toBe("125.00");

    await app.close();
  });

  it("consumo sem output calcula material mas não divide por zero", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "100", unitCost: "10" });

    const { product } = await createProductWithFormulation(app, [
      { itemId: item.id, quantity: "10", unitCode: "kg" },
    ]);
    const orderId = await produceOrder(app, product.id, "1");

    const cost = await getMaterialCost(app, orderId);
    expect(cost.totalMaterialCost).toBe("100.00");
    expect(cost.producedQuantity).toBe("0");
    expect(cost.materialUnitCost).toBeNull();

    await app.close();
  });

  it("precisão Decimal preservada (sem float JS)", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const item = await createItem("RAW_MATERIAL");
    // 0,1 + 0,2 em float daria 0.30000000000000004.
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "1", unitCost: "0.1" });
    await receiveWithCost(app, { supplierId: supplier.id, itemId: item.id, quantity: "2", unitCost: "0.2" });

    const reference = await getCostReference(app, item.id);
    // (1×0,1 + 2×0,2) / 3 = 0,5/3 = 0,166666...
    const expected = new Prisma.Decimal("0.5").dividedBy(3).toFixed(4);
    expect(reference.unitCost).toBe(expected);

    await app.close();
  });
});
