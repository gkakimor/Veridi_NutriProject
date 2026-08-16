import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotStatus, UomDimension } from "@prisma/client";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

type App = ReturnType<typeof buildApp>;

let supplierId: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-PICK-${marker}`, legalName: `Fornecedor Picking Teste ${marker}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);
    if (reservationIds.length > 0) {
      // Linhas substituidas apontam para a original via replacesLineId —
      // deleta em duas passadas (novas primeiro) para nao violar o FK.
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds }, replacesLineId: { not: null } },
      });
      await prisma.materialReservationLine.deleteMany({ where: { reservationId: { in: reservationIds } } });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
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

async function createItem(
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  overrides: { unitCode?: string; controlsLot?: boolean; controlsExpiry?: boolean } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const prefix = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "ME" : "PA";
  const item = await prisma.item.create({
    data: {
      type,
      code: `${prefix}-PICK-${m}`,
      name: `Item Picking Teste ${m}`,
      unitCode: overrides.unitCode ?? "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: overrides.controlsExpiry ?? false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createProduct(app: App, finishedProductItemId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto Picking Teste ${marker()}`, finishedProductItemId },
  });
  fixtureProductIds.push(response.json().id);
  return response.json();
}

async function createProductWithActiveFormulation(
  app: App,
  components: { itemId: string; quantity: string; unitCode: string }[],
  overrides: { basisQuantity?: string } = {},
) {
  const finishedItem = await createItem("FINISHED_PRODUCT");
  const product = await createProduct(app, finishedItem.id);

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

  return { product, finishedItem, formulationVersionId: versionId };
}

async function createReleasedOrder(app: App, productId: string, plannedQuantity: string) {
  const created = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity },
  });
  fixtureProductionOrderIds.push(created.json().id);
  await app.inject({ method: "POST", url: `/production-orders/${created.json().id}/plan` });
  const released = await app.inject({
    method: "POST",
    url: `/production-orders/${created.json().id}/release`,
  });
  return released.json();
}

async function receiveStock(
  itemId: string,
  quantity: string,
  overrides: { status?: LotStatus; expiryDate?: Date | null } = {},
) {
  const prisma = getPrisma();
  const m = marker();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-PICK-${m}`.toUpperCase(),
      itemId,
      supplierId,
      initialReceivedQuantity: quantity,
      status: overrides.status ?? "AVAILABLE",
      ...(overrides.expiryDate !== undefined ? { expiryDate: overrides.expiryDate } : {}),
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

async function receiveStockNoLot(app: App, itemId: string, quantity: string) {
  await app.inject({
    method: "POST",
    url: "/inventory-adjustments",
    payload: { itemId, type: "ADJUSTMENT_IN", quantity, reason: "Estoque inicial para teste" },
  });
}

describe("Picking — confirmação de lote", () => {
  it("confirma o lote reservado correto (código puro)", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(rawMaterial.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "30", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const lineId = order.requirements[0].reservationLines[0].id;

    const inventoryBefore = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${lineId}/confirm`,
      payload: { lotCode: lot.code },
    });
    expect(response.statusCode).toBe(200);
    const line = response.json().requirements[0].reservationLines[0];
    expect(line.pickingStatus).toBe("CONFIRMED");
    expect(line.pickedAt).not.toBeNull();
    expect(line.pickedBy).not.toBeNull();

    // Nunca cria InventoryMovement, nunca altera On Hand/Reserved.
    const inventoryAfter = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventoryAfter.json().onHand).toBe(inventoryBefore.json().onHand);
    expect(inventoryAfter.json().reserved).toBe(inventoryBefore.json().reserved);

    const movements = await app.inject({
      method: "GET",
      url: `/inventory-movements?itemId=${rawMaterial.id}`,
    });
    expect(movements.json().movements).toHaveLength(1); // so o RECEIPT_IN inicial

    await app.close();
  });

  it("confirma via payload de QR (LOT:...)", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(rawMaterial.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "30", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const lineId = order.requirements[0].reservationLines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${lineId}/confirm`,
      payload: { lotCode: `LOT:${lot.code}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().requirements[0].reservationLines[0].pickingStatus).toBe("CONFIRMED");

    await app.close();
  });

  it("item sem lote confirma separação sem informar lotCode", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "30", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const lineId = order.requirements[0].reservationLines[0].id;
    expect(order.requirements[0].reservationLines[0].lotId).toBeNull();

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${lineId}/confirm`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().requirements[0].reservationLines[0].pickingStatus).toBe("CONFIRMED");

    await app.close();
  });

  it("não permite picking duplicado", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsLot: false });
    await receiveStockNoLot(app, rawMaterial.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "30", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const lineId = order.requirements[0].reservationLines[0].id;

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${lineId}/confirm`,
      payload: {},
    });
    const second = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${lineId}/confirm`,
      payload: {},
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("line_already_picked");

    await app.close();
  });

  it("lote diferente do reservado é rejeitado (mismatch)", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const expectedLot = await receiveStock(rawMaterial.id, "30");
    const otherLot = await receiveStock(rawMaterial.id, "30");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const line = order.requirements[0].reservationLines[0];
    expect(line.lotId).toBe(expectedLot.id);

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: otherLot.code },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe("lot_mismatch");
    expect(body.expectedLotCode).toBe(expectedLot.code);
    expect(body.scannedLotCode).toBe(otherLot.code);

    await app.close();
  });

  it("lote de outro Item é rejeitado (mismatch)", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const expectedLot = await receiveStock(rawMaterial.id, "30");
    const otherItem = await createItem("RAW_MATERIAL");
    const otherItemLot = await receiveStock(otherItem.id, "30");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const line = order.requirements[0].reservationLines[0];
    expect(line.lotId).toBe(expectedLot.id);

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: otherItemLot.code },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("lot_mismatch");

    await app.close();
  });

  it("lote vencido é rejeitado mesmo confirmando o código correto", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL", { controlsExpiry: true });
    const lot = await receiveStock(rawMaterial.id, "30", {
      expiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const line = order.requirements[0].reservationLines[0];

    // Lote vence DEPOIS do RELEASE, ANTES do Picking.
    await getPrisma().lot.update({
      where: { id: lot.id },
      data: { expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: lot.code },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("lot_not_eligible");

    await app.close();
  });

  it("lote bloqueado é rejeitado", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(rawMaterial.id, "30");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const line = order.requirements[0].reservationLines[0];

    await getPrisma().lot.update({ where: { id: lot.id }, data: { status: "BLOCKED" } });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: lot.code },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("lot_not_eligible");

    await app.close();
  });

  it("lote aguardando liberação é rejeitado", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const lot = await receiveStock(rawMaterial.id, "30");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const line = order.requirements[0].reservationLines[0];

    await getPrisma().lot.update({ where: { id: lot.id }, data: { status: "AWAITING_RELEASE" } });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${line.id}/confirm`,
      payload: { lotCode: lot.code },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("lot_not_eligible");

    await app.close();
  });
});

describe("Picking — substituição de lote", () => {
  it("substituição preserva histórico, Reserved do item não muda, On Hand não muda", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const originalLot = await receiveStock(rawMaterial.id, "30");
    const alternateLot = await receiveStock(rawMaterial.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "20", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const originalLine = order.requirements[0].reservationLines[0];
    expect(originalLine.lotId).toBe(originalLot.id);

    const inventoryBefore = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${originalLine.id}/substitute`,
      payload: { lotCode: alternateLot.code },
    });
    expect(response.statusCode).toBe(200);

    const lines = response.json().requirements[0].reservationLines as {
      id: string;
      lotId: string;
      quantity: string;
      releasedAt: string | null;
      releaseReason: string | null;
      replacesLineId: string | null;
      pickingStatus: string;
    }[];
    expect(lines).toHaveLength(2);

    const oldLine = lines.find((l) => l.id === originalLine.id)!;
    expect(oldLine.releasedAt).not.toBeNull();
    expect(oldLine.releaseReason).toContain("Substituição");

    const newLine = lines.find((l) => l.replacesLineId === originalLine.id)!;
    expect(newLine.lotId).toBe(alternateLot.id);
    expect(newLine.quantity).toBe("20");
    expect(newLine.releasedAt).toBeNull();
    // Substituicao ja confirma o Picking da nova linha (o ato de "usar
    // lote diferente" e a confirmacao fisica).
    expect(newLine.pickingStatus).toBe("CONFIRMED");

    // Reserved total do item nao muda (mesma quantidade, so trocou de lote).
    const inventoryAfter = await app.inject({ method: "GET", url: `/inventory/${rawMaterial.id}` });
    expect(inventoryAfter.json().reserved).toBe(inventoryBefore.json().reserved);
    expect(inventoryAfter.json().onHand).toBe(inventoryBefore.json().onHand);

    // Available entre lotes mudou corretamente.
    const originalLotDetail = await app.inject({ method: "GET", url: `/lots/${originalLot.id}` });
    expect(originalLotDetail.json().reserved).toBe("0");
    expect(originalLotDetail.json().available).toBe("30");
    const alternateLotDetail = await app.inject({ method: "GET", url: `/lots/${alternateLot.id}` });
    expect(alternateLotDetail.json().reserved).toBe("20");
    expect(alternateLotDetail.json().available).toBe("30");

    await app.close();
  });

  it("rejeita lote sem Available suficiente", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const originalLot = await receiveStock(rawMaterial.id, "30");
    const smallAlternateLot = await receiveStock(rawMaterial.id, "5");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "20", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const originalLine = order.requirements[0].reservationLines[0];
    expect(originalLine.lotId).toBe(originalLot.id);

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${originalLine.id}/substitute`,
      payload: { lotCode: smallAlternateLot.code },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("insufficient_alternate_lot");

    await app.close();
  });

  it("rejeita lote de outro Item", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const originalLot = await receiveStock(rawMaterial.id, "30");
    const otherItem = await createItem("RAW_MATERIAL");
    const otherItemLot = await receiveStock(otherItem.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "20", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const originalLine = order.requirements[0].reservationLines[0];
    expect(originalLine.lotId).toBe(originalLot.id);

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${originalLine.id}/substitute`,
      payload: { lotCode: otherItemLot.code },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("alternate_lot_item_mismatch");

    await app.close();
  });

  it("rejeita lote alternativo com status inválido (BLOCKED)", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const originalLot = await receiveStock(rawMaterial.id, "30");
    const blockedLot = await receiveStock(rawMaterial.id, "50", { status: "BLOCKED" });
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "20", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const originalLine = order.requirements[0].reservationLines[0];
    expect(originalLine.lotId).toBe(originalLot.id);

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${originalLine.id}/substitute`,
      payload: { lotCode: blockedLot.code },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("lot_not_eligible");

    await app.close();
  });

  it("rejeita substituição após consumo já registrado na linha", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const originalLot = await receiveStock(rawMaterial.id, "30");
    const alternateLot = await receiveStock(rawMaterial.id, "50");
    const { product } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "20", unitCode: "kg" },
    ]);
    const order = await createReleasedOrder(app, product.id, "1");
    const originalLine = order.requirements[0].reservationLines[0];

    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${originalLine.id}/confirm`,
      payload: { lotCode: originalLot.code },
    });
    await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/consumptions`,
      payload: { entries: [{ reservationLineId: originalLine.id, quantity: "5" }] },
    });

    const response = await app.inject({
      method: "POST",
      url: `/production-orders/${order.id}/picking/${originalLine.id}/substitute`,
      payload: { lotCode: alternateLot.code },
    });
    expect(response.statusCode).toBe(400);
    // Ja picked tambem bloqueia — qualquer um dos dois motivos e valido aqui.
    expect(["line_already_picked", "substitution_after_consumption"]).toContain(response.json().error);

    await app.close();
  });

  it("concorrência: duas substituições não reservam o mesmo saldo alternativo duas vezes", async () => {
    const app = buildApp();
    await app.ready();

    const rawMaterial = await createItem("RAW_MATERIAL");
    const originalLotA = await receiveStock(rawMaterial.id, "10");
    const originalLotB = await receiveStock(rawMaterial.id, "10");
    const sharedAlternateLot = await receiveStock(rawMaterial.id, "12");

    const { product: productA } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);
    const { product: productB } = await createProductWithActiveFormulation(app, [
      { itemId: rawMaterial.id, quantity: "10", unitCode: "kg" },
    ]);

    // Forca a mesma OC a nao competir com FEFO — cada OP recebe exatamente
    // um lote de 10kg dedicado (LT-A / LT-B), depois ambas tentam mover
    // sua linha para o MESMO lote alternativo (12kg, insuficiente para 20).
    const orderA = await createReleasedOrder(app, productA.id, "1");
    const orderB = await createReleasedOrder(app, productB.id, "1");

    const lineA = orderA.requirements[0].reservationLines.find(
      (l: { lotId: string }) => l.lotId === originalLotA.id || l.lotId === originalLotB.id,
    );
    const lineB = orderB.requirements[0].reservationLines.find(
      (l: { lotId: string }) => l.lotId === originalLotA.id || l.lotId === originalLotB.id,
    );
    expect(lineA).toBeDefined();
    expect(lineB).toBeDefined();

    const [responseA, responseB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/production-orders/${orderA.id}/picking/${lineA.id}/substitute`,
        payload: { lotCode: sharedAlternateLot.code },
      }),
      app.inject({
        method: "POST",
        url: `/production-orders/${orderB.id}/picking/${lineB.id}/substitute`,
        payload: { lotCode: sharedAlternateLot.code },
      }),
    ]);

    const statuses = [responseA.statusCode, responseB.statusCode].sort();
    expect(statuses).toEqual([200, 400]);

    const alternateLotDetail = await app.inject({ method: "GET", url: `/lots/${sharedAlternateLot.id}` });
    expect(Number(alternateLotDetail.json().reserved)).toBeLessThanOrEqual(10);

    await app.close();
  });
});
