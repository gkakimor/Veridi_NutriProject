import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureSupplierIds: string[] = [];
const fixtureItemIds: string[] = [];
const createdPurchaseOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

let supplierId: string;

type App = ReturnType<typeof buildApp>;

beforeAll(async () => {
  const prisma = getPrisma();

  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });

  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-INV-${marker}`, legalName: `Fornecedor Estoque Teste ${marker}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);
});

afterAll(async () => {
  const prisma = getPrisma();

  if (createdPurchaseOrderIds.length > 0) {
    await prisma.receipt.deleteMany({ where: { purchaseOrderId: { in: createdPurchaseOrderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPurchaseOrderIds } } });
  }
  if (fixtureProductionOrderIds.length > 0) {
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);
    if (reservationIds.length > 0) {
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

/** Item de teste isolado por caso — evita interferencia entre asserts de saldo. */
async function createTestItem(
  overrides: {
    controlsLot?: boolean;
    controlsExpiry?: boolean;
    requiresQualityRelease?: boolean;
  } = {},
) {
  const prisma = getPrisma();
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-INV-${marker}`,
      name: `Item Estoque Teste ${marker}`,
      unitCode: "kg",
      controlsLot: overrides.controlsLot ?? false,
      controlsExpiry: overrides.controlsExpiry ?? false,
      requiresQualityRelease: overrides.requiresQualityRelease ?? false,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createLot(itemId: string, quantity: string, status: "AWAITING_RELEASE" | "AVAILABLE" | "BLOCKED") {
  const prisma = getPrisma();
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const lot = await prisma.lot.create({
    data: {
      code: `LT-TESTE-${marker}`,
      itemId,
      supplierId,
      initialReceivedQuantity: quantity,
      status,
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

/** Cria uma OC DRAFT com as linhas informadas e confirma (→ ORDERED). Mesmo padrao de receiving.test.ts. */
async function createOrderedPurchaseOrder(
  app: App,
  lines: { itemId: string; orderedQuantity: string }[],
) {
  const created = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: { supplierId, orderDate: new Date().toISOString(), lines },
  });
  createdPurchaseOrderIds.push(created.json().id);

  const confirmed = await app.inject({
    method: "POST",
    url: `/purchase-orders/${created.json().id}/confirm`,
  });
  return confirmed.json();
}

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Reserva `quantity` do item via ciclo completo de OP (produto+formulação+PLAN+RELEASE). */
async function reserveStockViaProductionOrder(app: App, itemId: string, quantity: string) {
  const prisma = getPrisma();
  const finishedItem = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-INV-${marker()}`,
      name: `Produto Acabado Reserva Teste ${marker()}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  fixtureItemIds.push(finishedItem.id);

  const product = await app.inject({
    method: "POST",
    url: "/products",
    payload: { name: `Produto Reserva Teste ${marker()}`, finishedProductItemId: finishedItem.id },
  });
  fixtureProductIds.push(product.json().id);

  const version = await app.inject({
    method: "POST",
    url: `/products/${product.json().id}/formulation-versions`,
    payload: {},
  });
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${version.json().id}`,
    payload: { basisQuantity: "1", components: [{ itemId, quantity, unitCode: "kg" }] },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${version.json().id}/activate` });

  const created = await app.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId: product.json().id, plannedQuantity: "1" },
  });
  fixtureProductionOrderIds.push(created.json().id);
  await app.inject({ method: "POST", url: `/production-orders/${created.json().id}/plan` });
  const released = await app.inject({
    method: "POST",
    url: `/production-orders/${created.json().id}/release`,
  });
  return released.json();
}

describe("Inventory — saldo (On Hand/Available)", () => {
  it("RECEIPT_IN aumenta On Hand", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: {
        itemId: item.id,
        type: "RECEIPT_IN",
        quantity: "50",
        occurredAt: new Date(),
        sourceType: "RECEIPT",
        createdBy: "Teste",
      },
    });

    const response = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(response.json().onHand).toBe("50");
    expect(response.json().available).toBe("50");

    await app.close();
  });

  it("ajuste de entrada aumenta On Hand", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const response = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_IN", quantity: "20", reason: "Sobra de contagem" },
    });
    expect(response.statusCode).toBe(201);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("20");

    await app.close();
  });

  it("ajuste de saída reduz On Hand", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: {
        itemId: item.id,
        type: "RECEIPT_IN",
        quantity: "30",
        occurredAt: new Date(),
        sourceType: "RECEIPT",
        createdBy: "Teste",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_OUT", quantity: "10", reason: "Avaria" },
    });
    expect(response.statusCode).toBe(201);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("20");

    await app.close();
  });

  it("loss reduz On Hand", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: {
        itemId: item.id,
        type: "RECEIPT_IN",
        quantity: "15",
        occurredAt: new Date(),
        sourceType: "RECEIPT",
        createdBy: "Teste",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "LOSS", quantity: "5", reason: "Derramamento" },
    });
    expect(response.statusCode).toBe(201);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("10");

    await app.close();
  });

  it("múltiplos movimentos calculam saldo correto", async () => {
    const app = buildApp();
    await app.ready();
    const prisma = getPrisma();

    const item = await createTestItem();
    await prisma.inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "100", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });
    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_IN", quantity: "10", reason: "Ajuste" },
    });
    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_OUT", quantity: "20", reason: "Ajuste" },
    });
    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "LOSS", quantity: "5", reason: "Perda" },
    });

    // 100 + 10 - 20 - 5 = 85
    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("85");

    await app.close();
  });

  it("nunca permite saldo negativo (ADJUSTMENT_OUT e LOSS acima do On Hand)", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "10", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });

    const out = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_OUT", quantity: "11", reason: "Excede" },
    });
    expect(out.statusCode).toBe(400);
    expect(out.json().error).toBe("insufficient_stock");

    const loss = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "LOSS", quantity: "11", reason: "Excede" },
    });
    expect(loss.statusCode).toBe(400);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("10");

    await app.close();
  });

  it("concorrência: duas saídas simultâneas não deixam saldo negativo", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "100", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });

    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/inventory-adjustments",
        payload: { itemId: item.id, type: "ADJUSTMENT_OUT", quantity: "60", reason: "Concorrência" },
      });

    const [first, second] = await Promise.all([attempt(), attempt()]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 400]);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(Number(inventory.json().onHand)).toBeGreaterThanOrEqual(0);
    expect(inventory.json().onHand).toBe("40");

    await app.close();
  });
});

describe("Inventory — Qualidade e Available", () => {
  it("lote AWAITING_RELEASE tem On Hand mas Available 0", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem({ controlsLot: true, requiresQualityRelease: true });
    const lot = await createLot(item.id, "40", "AWAITING_RELEASE");

    const lotFetched = await app.inject({ method: "GET", url: `/lots/${lot.id}` });
    expect(lotFetched.json().onHand).toBe("40");
    expect(lotFetched.json().available).toBe("0");

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("40");
    expect(inventory.json().available).toBe("0");

    await app.close();
  });

  it("liberar lote altera Available sem alterar On Hand", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem({ controlsLot: true, requiresQualityRelease: true });
    const lot = await createLot(item.id, "25", "AWAITING_RELEASE");

    const released = await app.inject({ method: "POST", url: `/lots/${lot.id}/release` });
    expect(released.statusCode).toBe(200);
    expect(released.json().onHand).toBe("25");
    expect(released.json().available).toBe("25");

    await app.close();
  });

  it("lote BLOCKED tem Available 0 e On Hand inalterado", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem({ controlsLot: true, requiresQualityRelease: false });
    const lot = await createLot(item.id, "15", "AVAILABLE");

    const blocked = await app.inject({
      method: "POST",
      url: `/lots/${lot.id}/block`,
      payload: { reason: "Divergência" },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json().onHand).toBe("15");
    expect(blocked.json().available).toBe("0");

    await app.close();
  });
});

describe("Inventory — On Order", () => {
  it("OC ORDERED conta para On Order", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createOrderedPurchaseOrder(app, [{ itemId: item.id, orderedQuantity: "70" }]);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onOrder).toBe("70");

    await app.close();
  });

  it("OC PARTIALLY_RECEIVED conta só a quantidade aberta", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const po = await createOrderedPurchaseOrder(app, [{ itemId: item.id, orderedQuantity: "70" }]);
    const poLineId = po.lines[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "30" }],
      },
    });

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onOrder).toBe("40");

    await app.close();
  });

  it("OC DRAFT não conta para On Order", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const draft = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: item.id, orderedQuantity: "70" }],
      },
    });
    createdPurchaseOrderIds.push(draft.json().id);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onOrder).toBe("0");

    await app.close();
  });

  it("OC CANCELLED não conta para On Order", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const po = await createOrderedPurchaseOrder(app, [{ itemId: item.id, orderedQuantity: "70" }]);
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/cancel`,
      payload: { reason: "Cancelado para teste" },
    });

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onOrder).toBe("0");

    await app.close();
  });

  it("OC RECEIVED (aberto = 0) não conta para On Order", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const po = await createOrderedPurchaseOrder(app, [{ itemId: item.id, orderedQuantity: "70" }]);
    const poLineId = po.lines[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "70" }],
      },
    });

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onOrder).toBe("0");

    await app.close();
  });
});

describe("Inventory — Inventário físico (stock count)", () => {
  it("diferença positiva gera ADJUSTMENT_IN", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "50", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "55", reason: "Contagem física" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.difference).toBe("5");
    expect(body.movementCreated.type).toBe("ADJUSTMENT_IN");
    expect(body.movementCreated.sourceType).toBe("STOCK_COUNT");

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("55");

    await app.close();
  });

  it("diferença negativa gera ADJUSTMENT_OUT", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "100", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "97", reason: "Contagem física" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.difference).toBe("-3");
    expect(body.movementCreated.type).toBe("ADJUSTMENT_OUT");

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("97");

    await app.close();
  });

  it("sem diferença não altera saldo e não cria InventoryMovement", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "20", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "20" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().difference).toBe("0");
    expect(response.json().movementCreated).toBeNull();

    const count = await getPrisma().inventoryMovement.count({ where: { itemId: item.id } });
    expect(count).toBe(1); // so o RECEIPT_IN inicial

    await app.close();
  });

  it("motivo é obrigatório quando a contagem diverge do saldo do sistema", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "20", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "25" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("missing_count_reason");

    await app.close();
  });
});

describe("Inventory — hardening contra Reserved", () => {
  it("ADJUSTMENT_OUT não pode consumir estoque reservado (só Available)", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "100", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });
    await reserveStockViaProductionOrder(app, item.id, "80");

    const excessive = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_OUT", quantity: "30", reason: "Excede Available" },
    });
    expect(excessive.statusCode).toBe(400);
    expect(excessive.json().error).toBe("insufficient_stock");

    const withinAvailable = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "ADJUSTMENT_OUT", quantity: "10", reason: "Dentro do Available" },
    });
    expect(withinAvailable.statusCode).toBe(201);

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("90");
    expect(inventory.json().reserved).toBe("80");
    expect(inventory.json().available).toBe("10");

    await app.close();
  });

  it("LOSS não pode reduzir On Hand abaixo do Reserved", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "100", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });
    await reserveStockViaProductionOrder(app, item.id, "80");

    const excessive = await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, type: "LOSS", quantity: "30", reason: "Excede Available" },
    });
    expect(excessive.statusCode).toBe(400);
    expect(excessive.json().error).toBe("insufficient_stock");

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("100");

    await app.close();
  });

  it("Stock Count abaixo do Reserved é rejeitado, sem criar movimento", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "100", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });
    await reserveStockViaProductionOrder(app, item.id, "80");

    const response = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "70", reason: "Contagem física" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("count_below_reserved");

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("100");

    await app.close();
  });

  it("Stock Count igual ou acima do Reserved funciona normalmente", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await getPrisma().inventoryMovement.create({
      data: { itemId: item.id, type: "RECEIPT_IN", quantity: "100", occurredAt: new Date(), sourceType: "RECEIPT", createdBy: "Teste" },
    });
    await reserveStockViaProductionOrder(app, item.id, "80");

    const response = await app.inject({
      method: "POST",
      url: "/stock-counts",
      payload: { itemId: item.id, countedQuantity: "80", reason: "Contagem física" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().difference).toBe("-20");

    const inventory = await app.inject({ method: "GET", url: `/inventory/${item.id}` });
    expect(inventory.json().onHand).toBe("80");
    expect(inventory.json().reserved).toBe("80");
    expect(inventory.json().available).toBe("0");

    await app.close();
  });

  it("lote com Reservation ACTIVE não pode ser bloqueado", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem({ controlsLot: true, requiresQualityRelease: false });
    const lot = await createLot(item.id, "50", "AVAILABLE");
    await reserveStockViaProductionOrder(app, item.id, "20");

    const blockAttempt = await app.inject({
      method: "POST",
      url: `/lots/${lot.id}/block`,
      payload: { reason: "Divergência" },
    });
    expect(blockAttempt.statusCode).toBe(400);
    expect(blockAttempt.json().error).toBe("invalid_transition");

    await app.close();
  });
});
