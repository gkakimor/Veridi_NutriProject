import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureSupplierIds: string[] = [];
const fixtureItemIds: string[] = [];
const createdPurchaseOrderIds: string[] = [];

let supplierId: string;

type App = ReturnType<typeof buildApp>;
type LotStatus = "AWAITING_RELEASE" | "AVAILABLE" | "BLOCKED";

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const prisma = getPrisma();

  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });

  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-FEFO-${marker}`, legalName: `Fornecedor FEFO Teste ${marker}` },
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
  if (fixtureItemIds.length > 0) {
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

/** Item de teste isolado por caso — evita interferencia entre asserts de alocação. */
async function createTestItem(
  overrides: { controlsLot?: boolean; controlsExpiry?: boolean } = {},
) {
  const prisma = getPrisma();
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-FEFO-${marker}`,
      name: `Item FEFO Teste ${marker}`,
      unitCode: "kg",
      controlsLot: overrides.controlsLot ?? true,
      controlsExpiry: overrides.controlsExpiry ?? true,
      requiresQualityRelease: false,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

/**
 * Cria um lote direto (sem ReceiptLine) com On Hand igual a `quantity`.
 * `createdAt` explicito permite controlar o desempate de recebimento sem
 * precisar montar um Receipt/PurchaseOrderLine reais.
 */
async function createLot(
  itemId: string,
  quantity: string,
  opts: { status?: LotStatus; expiryDate?: Date | null; createdAt?: Date } = {},
) {
  const prisma = getPrisma();
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const lot = await prisma.lot.create({
    data: {
      code: `LT-TESTE-${marker}`,
      itemId,
      supplierId,
      initialReceivedQuantity: quantity,
      status: opts.status ?? "AVAILABLE",
      expiryDate: opts.expiryDate ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity,
      occurredAt: opts.createdAt ?? new Date(),
      sourceType: "RECEIPT",
      createdBy: "Teste",
    },
  });
  return lot;
}

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

describe("Allocation suggestion — FEFO", () => {
  it("escolhe a validade mais próxima primeiro", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "30", { expiryDate: new Date(Date.now() + 90 * DAY_MS) });
    await createLot(item.id, "50", { expiryDate: new Date(Date.now() + 30 * DAY_MS) });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=20`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.strategy).toBe("FEFO");
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0].suggestedQuantity).toBe("20");
    expect(body.allocations[0].availableQuantity).toBe("50");

    await app.close();
  });

  it("aloca em múltiplos lotes usando parcialmente o último", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "30", { expiryDate: new Date(Date.now() + 30 * DAY_MS) });
    await createLot(item.id, "50", { expiryDate: new Date(Date.now() + 90 * DAY_MS) });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=70`,
    });

    const body = response.json();
    expect(body.allocations).toHaveLength(2);
    expect(body.allocations[0].suggestedQuantity).toBe("30");
    expect(body.allocations[1].suggestedQuantity).toBe("40");
    expect(body.allocatedQuantity).toBe("70");
    expect(body.availableQuantity).toBe("80");
    expect(body.shortageQuantity).toBe("0");

    await app.close();
  });

  it("quantidade exata (allocated == required, sem shortage)", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "40", { expiryDate: new Date(Date.now() + 30 * DAY_MS) });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=40`,
    });

    const body = response.json();
    expect(body.allocatedQuantity).toBe("40");
    expect(body.shortageQuantity).toBe("0");

    await app.close();
  });

  it("shortage quando disponível não cobre o necessário — retorna 200, não erro", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "70", { expiryDate: new Date(Date.now() + 30 * DAY_MS) });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=100`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.allocatedQuantity).toBe("70");
    expect(body.shortageQuantity).toBe("30");
    expect(body.allocations).toHaveLength(1);

    await app.close();
  });

  it("ignora lote com saldo zero", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const emptyLot = await createLot(item.id, "20", { expiryDate: new Date(Date.now() + 30 * DAY_MS) });
    await getPrisma().inventoryMovement.create({
      data: {
        itemId: item.id,
        lotId: emptyLot.id,
        type: "ADJUSTMENT_OUT",
        quantity: "20",
        occurredAt: new Date(),
        sourceType: "MANUAL_ADJUSTMENT",
        reason: "Zerar saldo para teste",
        createdBy: "Teste",
      },
    });
    await createLot(item.id, "15", { expiryDate: new Date(Date.now() + 60 * DAY_MS) });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=15`,
    });

    const body = response.json();
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0].suggestedQuantity).toBe("15");

    await app.close();
  });

  it("ignora lote AWAITING_RELEASE", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "20", {
      status: "AWAITING_RELEASE",
      expiryDate: new Date(Date.now() + 10 * DAY_MS),
    });
    const availableLot = await createLot(item.id, "30", {
      expiryDate: new Date(Date.now() + 60 * DAY_MS),
    });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=20`,
    });

    const body = response.json();
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0].lotId).toBe(availableLot.id);

    await app.close();
  });

  it("ignora lote BLOCKED", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "20", { status: "BLOCKED", expiryDate: new Date(Date.now() + 10 * DAY_MS) });
    const availableLot = await createLot(item.id, "30", {
      expiryDate: new Date(Date.now() + 60 * DAY_MS),
    });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=20`,
    });

    const body = response.json();
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0].lotId).toBe(availableLot.id);

    await app.close();
  });

  it("ignora lote vencido mesmo com status AVAILABLE persistido", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "20", {
      status: "AVAILABLE",
      expiryDate: new Date(Date.now() - 5 * DAY_MS),
    });
    const validLot = await createLot(item.id, "30", { expiryDate: new Date(Date.now() + 60 * DAY_MS) });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=20`,
    });

    const body = response.json();
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0].lotId).toBe(validLot.id);

    await app.close();
  });

  it("usa On Hand derivado do ledger — ajuste de estoque altera a sugestão", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const lot = await createLot(item.id, "50", { expiryDate: new Date(Date.now() + 30 * DAY_MS) });

    const before = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=40`,
    });
    expect(before.json().allocations[0].availableQuantity).toBe("50");

    await app.inject({
      method: "POST",
      url: "/inventory-adjustments",
      payload: { itemId: item.id, lotId: lot.id, type: "ADJUSTMENT_OUT", quantity: "30", reason: "Ajuste teste" },
    });

    const after = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=40`,
    });
    const body = after.json();
    expect(body.allocations[0].availableQuantity).toBe("20");
    expect(body.allocatedQuantity).toBe("20");
    expect(body.shortageQuantity).toBe("20");

    await app.close();
  });

  it("On Order não entra na alocação", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "70", { expiryDate: new Date(Date.now() + 30 * DAY_MS) });
    await createOrderedPurchaseOrder(app, [{ itemId: item.id, orderedQuantity: "50" }]);

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=100`,
    });

    const body = response.json();
    expect(body.availableQuantity).toBe("70");
    expect(body.allocatedQuantity).toBe("70");
    expect(body.shortageQuantity).toBe("30");

    await app.close();
  });

  it("precisão decimal — sem erro de ponto flutuante", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    await createLot(item.id, "10.333333", { expiryDate: new Date(Date.now() + 30 * DAY_MS) });
    await createLot(item.id, "10.333333", { expiryDate: new Date(Date.now() + 60 * DAY_MS) });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=15.5`,
    });

    const body = response.json();
    expect(body.allocations[0].suggestedQuantity).toBe("10.333333");
    expect(body.allocations[1].suggestedQuantity).toBe("5.166667");
    expect(body.allocatedQuantity).toBe("15.5");
    expect(body.shortageQuantity).toBe("0");

    await app.close();
  });

  it("qualidade: lote AWAITING_RELEASE que vence primeiro fica de fora até ser liberado", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const earlyAwaiting = await createLot(item.id, "20", {
      status: "AWAITING_RELEASE",
      expiryDate: new Date(Date.now() + 5 * DAY_MS),
    });
    const laterAvailable = await createLot(item.id, "20", {
      status: "AVAILABLE",
      expiryDate: new Date(Date.now() + 30 * DAY_MS),
    });

    const before = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=10`,
    });
    expect(before.json().allocations[0].lotId).toBe(laterAvailable.id);

    await app.inject({ method: "POST", url: `/lots/${earlyAwaiting.id}/release` });

    const after = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=10`,
    });
    expect(after.json().allocations[0].lotId).toBe(earlyAwaiting.id);

    await app.close();
  });
});

describe("Allocation suggestion — empates", () => {
  it("mesma validade → recebimento mais antigo primeiro", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const sameExpiry = new Date(Date.now() + 30 * DAY_MS);
    const older = await createLot(item.id, "10", {
      expiryDate: sameExpiry,
      createdAt: new Date(Date.now() - 10 * DAY_MS),
    });
    await createLot(item.id, "10", { expiryDate: sameExpiry, createdAt: new Date() });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=5`,
    });

    expect(response.json().allocations[0].lotId).toBe(older.id);

    await app.close();
  });

  it("empate completo (mesma validade e recebimento) → código do lote decide", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem();
    const sameExpiry = new Date(Date.now() + 30 * DAY_MS);
    const sameCreatedAt = new Date(Date.now() - 20 * DAY_MS);
    const first = await createLot(item.id, "10", { expiryDate: sameExpiry, createdAt: sameCreatedAt });
    const second = await createLot(item.id, "10", { expiryDate: sameExpiry, createdAt: sameCreatedAt });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=5`,
    });

    const expectedFirstCode = [first.code, second.code].sort((a, b) => a.localeCompare(b))[0];
    expect(response.json().allocations[0].lotCode).toBe(expectedFirstCode);

    await app.close();
  });
});

describe("Allocation suggestion — FIFO (sem validade)", () => {
  it("item com controlsExpiry=false usa recebimento mais antigo", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem({ controlsExpiry: false });
    const older = await createLot(item.id, "10", { createdAt: new Date(Date.now() - 30 * DAY_MS) });
    await createLot(item.id, "10", { createdAt: new Date() });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=5`,
    });

    expect(response.json().strategy).toBe("FIFO");
    expect(response.json().allocations[0].lotId).toBe(older.id);

    await app.close();
  });
});

describe("Allocation suggestion — item sem controle de lote", () => {
  it("retorna disponibilidade sem allocation fictício", async () => {
    const app = buildApp();
    await app.ready();

    const item = await createTestItem({ controlsLot: false, controlsExpiry: false });
    await getPrisma().inventoryMovement.create({
      data: {
        itemId: item.id,
        type: "RECEIPT_IN",
        quantity: "100",
        occurredAt: new Date(),
        sourceType: "RECEIPT",
        createdBy: "Teste",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/inventory/${item.id}/allocation-suggestion?quantity=40`,
    });

    const body = response.json();
    expect(body.strategy).toBe("NO_LOT");
    expect(body.allocations).toEqual([]);
    expect(body.availableQuantity).toBe("100");
    expect(body.allocatedQuantity).toBe("40");
    expect(body.shortageQuantity).toBe("0");

    await app.close();
  });

  it("item inexistente retorna 404", async () => {
    const app = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/inventory/00000000-0000-0000-0000-000000000000/allocation-suggestion?quantity=10",
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
