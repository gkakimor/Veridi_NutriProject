import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const createdPurchaseOrderIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureItemIds: string[] = [];

let activeSupplierId: string;
let inactiveSupplierId: string;
let rawMaterialItemId: string;
let packagingItemId: string;
let finishedProductItemId: string;
let inactiveRawMaterialItemId: string;

beforeAll(async () => {
  const prisma = getPrisma();

  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });
  await prisma.unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: 1 },
  });

  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const activeSupplier = await prisma.supplier.create({
    data: { code: `FOR-TEST-${marker}-A`, legalName: `Fornecedor Ativo Teste ${marker}` },
  });
  activeSupplierId = activeSupplier.id;
  fixtureSupplierIds.push(activeSupplier.id);

  const inactiveSupplier = await prisma.supplier.create({
    data: {
      code: `FOR-TEST-${marker}-I`,
      legalName: `Fornecedor Inativo Teste ${marker}`,
      active: false,
    },
  });
  inactiveSupplierId = inactiveSupplier.id;
  fixtureSupplierIds.push(inactiveSupplier.id);

  const rawMaterialItem = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-PO-TEST-${marker}`,
      name: `Materia Prima Compravel Teste ${marker}`,
      unitCode: "kg",
    },
  });
  rawMaterialItemId = rawMaterialItem.id;
  fixtureItemIds.push(rawMaterialItem.id);

  const packagingItem = await prisma.item.create({
    data: {
      type: "PACKAGING",
      code: `ME-PO-TEST-${marker}`,
      name: `Embalagem Compravel Teste ${marker}`,
      unitCode: "un",
    },
  });
  packagingItemId = packagingItem.id;
  fixtureItemIds.push(packagingItem.id);

  const finishedItem = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-PO-TEST-${marker}`,
      name: `Produto Acabado Teste ${marker}`,
      unitCode: "un",
    },
  });
  finishedProductItemId = finishedItem.id;
  fixtureItemIds.push(finishedItem.id);

  const inactiveRawMaterial = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-PO-INATIVO-${marker}`,
      name: `Materia Prima Inativa Teste ${marker}`,
      unitCode: "kg",
      active: false,
    },
  });
  inactiveRawMaterialItemId = inactiveRawMaterial.id;
  fixtureItemIds.push(inactiveRawMaterial.id);
});

afterEach(async () => {
  if (createdPurchaseOrderIds.length === 0) return;
  await getPrisma().purchaseOrder.deleteMany({
    where: { id: { in: createdPurchaseOrderIds } },
  });
  createdPurchaseOrderIds.length = 0;
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

type App = ReturnType<typeof buildTestApp>;

async function createTestPurchaseOrder(app: App, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId: activeSupplierId,
      orderDate: new Date().toISOString(),
      ...overrides,
    },
  });
  if (response.statusCode === 201) {
    createdPurchaseOrderIds.push(response.json().id);
  }
  return response;
}

describe("Purchase Orders", () => {
  it("cria OC como DRAFT com código OC-######", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^OC-\d{6}$/);
    expect(body.status).toBe("DRAFT");

    await app.close();
  });

  it("código interno é imutável (PATCH ignora tentativa de alterar)", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app);
    const code = created.json().code;
    const id = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${id}`,
      payload: { code: "OC-999999", notes: "atualizado" },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().code).toBe(code);
    expect(patched.json().notes).toBe("atualizado");

    await app.close();
  });

  it("exige fornecedor para criar", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: { orderDate: new Date().toISOString() },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejeita fornecedor inativo em nova OC", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, { supplierId: inactiveSupplierId });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("inactive_supplier");

    await app.close();
  });

  it("aceita linha RAW_MATERIAL", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "25" }],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().lines).toHaveLength(1);
    expect(response.json().lines[0].itemId).toBe(rawMaterialItemId);
    expect(response.json().lines[0].unitCode).toBe("kg");

    await app.close();
  });

  it("aceita linha PACKAGING", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, {
      lines: [{ itemId: packagingItemId, orderedQuantity: "100" }],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().lines[0].itemId).toBe(packagingItemId);

    await app.close();
  });

  it("rejeita linha com item FINISHED_PRODUCT", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, {
      lines: [{ itemId: finishedProductItemId, orderedQuantity: "10" }],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_item_type");

    await app.close();
  });

  it("rejeita linha com item inativo", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, {
      lines: [{ itemId: inactiveRawMaterialItemId, orderedQuantity: "10" }],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("inactive_item");

    await app.close();
  });

  it("exige quantidade maior que zero", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "0" }],
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejeita item duplicado na mesma OC", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, {
      lines: [
        { itemId: rawMaterialItemId, orderedQuantity: "10" },
        { itemId: rawMaterialItemId, orderedQuantity: "20" },
      ],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("duplicate_item");

    await app.close();
  });

  it("DRAFT pode ser editado (fornecedor, itens, notas)", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
    });
    const id = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${id}`,
      payload: {
        notes: "revisado",
        lines: [{ itemId: packagingItemId, orderedQuantity: "50" }],
      },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().notes).toBe("revisado");
    expect(patched.json().lines).toHaveLength(1);
    expect(patched.json().lines[0].itemId).toBe(packagingItemId);

    await app.close();
  });

  it("confirma DRAFT → ORDERED", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
    });
    const id = created.json().id;

    const confirmed = await app.inject({ method: "POST", url: `/purchase-orders/${id}/confirm` });

    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("ORDERED");
    expect(confirmed.json().orderedAt).not.toBeNull();
    expect(confirmed.json().orderedBy).not.toBeNull();

    await app.close();
  });

  it("não confirma OC sem linhas", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app);
    const id = created.json().id;

    const confirmed = await app.inject({ method: "POST", url: `/purchase-orders/${id}/confirm` });

    expect(confirmed.statusCode).toBe(400);
    expect(confirmed.json().error).toBe("empty_order");

    await app.close();
  });

  it("ORDERED bloqueia alteração de fornecedor", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
    });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/purchase-orders/${id}/confirm` });

    const otherSupplier = await getPrisma().supplier.create({
      data: { code: `FOR-TROCA-${Date.now()}`, legalName: "Fornecedor Troca Teste" },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${id}`,
      payload: { supplierId: otherSupplier.id },
    });

    expect(patched.statusCode).toBe(400);
    expect(patched.json().error).toBe("order_locked");

    await getPrisma().supplier.delete({ where: { id: otherSupplier.id } });
    await app.close();
  });

  it("ORDERED bloqueia alteração de linhas", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
    });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/purchase-orders/${id}/confirm` });

    const patched = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${id}`,
      payload: { lines: [{ itemId: packagingItemId, orderedQuantity: "5" }] },
    });

    expect(patched.statusCode).toBe(400);
    expect(patched.json().error).toBe("order_locked");

    await app.close();
  });

  it("ORDERED permite alterar previsão de entrega", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
    });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/purchase-orders/${id}/confirm` });

    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const patched = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${id}`,
      payload: { expectedDeliveryDate: nextWeek },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().expectedDeliveryDate).not.toBeNull();

    await app.close();
  });

  it("ORDERED permite alterar observações", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
    });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/purchase-orders/${id}/confirm` });

    const patched = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${id}`,
      payload: { notes: "ajuste pós-confirmação" },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().notes).toBe("ajuste pós-confirmação");

    await app.close();
  });

  it("cancelamento exige motivo", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app);
    const id = created.json().id;

    const cancelled = await app.inject({
      method: "POST",
      url: `/purchase-orders/${id}/cancel`,
      payload: {},
    });

    expect(cancelled.statusCode).toBe(400);

    await app.close();
  });

  it("cancela DRAFT e ORDERED, preserva motivo/usuário/timestamp", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app);
    const id = created.json().id;

    const cancelled = await app.inject({
      method: "POST",
      url: `/purchase-orders/${id}/cancel`,
      payload: { reason: "Pedido duplicado por engano" },
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    expect(cancelled.json().cancelReason).toBe("Pedido duplicado por engano");
    expect(cancelled.json().cancelledBy).not.toBeNull();
    expect(cancelled.json().cancelledAt).not.toBeNull();

    await app.close();
  });

  it("CANCELLED não pode voltar para DRAFT/ORDERED nem ser editada", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
    });
    const id = created.json().id;
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${id}/cancel`,
      payload: { reason: "Cancelado para teste" },
    });

    const reconfirm = await app.inject({ method: "POST", url: `/purchase-orders/${id}/confirm` });
    expect(reconfirm.statusCode).toBe(400);

    const patched = await app.inject({
      method: "PATCH",
      url: `/purchase-orders/${id}`,
      payload: { notes: "tentativa pós-cancelamento" },
    });
    expect(patched.statusCode).toBe(400);
    expect(patched.json().error).toBe("order_locked");

    await app.close();
  });

  it("preserva snapshot histórico do fornecedor após alteração do cadastro", async () => {
    const app = buildTestApp();
    await app.ready();

    const marker = `${Date.now()}`;
    const supplier = await getPrisma().supplier.create({
      data: { code: `FOR-SNAP-${marker}`, legalName: `Nome Original ${marker}` },
    });

    const created = await createTestPurchaseOrder(app, { supplierId: supplier.id });
    expect(created.json().supplierName).toBe(`Nome Original ${marker}`);

    await getPrisma().supplier.update({
      where: { id: supplier.id },
      data: { legalName: `Nome Alterado ${marker}` },
    });

    const fetched = await app.inject({
      method: "GET",
      url: `/purchase-orders/${created.json().id}`,
    });
    expect(fetched.json().supplierName).toBe(`Nome Original ${marker}`);

    await getPrisma().purchaseOrder.delete({ where: { id: created.json().id } });
    await getPrisma().supplier.delete({ where: { id: supplier.id } });
    await app.close();
  });

  it("calcula total decimal das linhas com preço", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, {
      lines: [
        { itemId: rawMaterialItemId, orderedQuantity: "10.5", unitPrice: "3.20" },
        { itemId: packagingItemId, orderedQuantity: "100", unitPrice: "0.15" },
      ],
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    const rawLine = body.lines.find((l: { itemId: string }) => l.itemId === rawMaterialItemId);
    const packagingLine = body.lines.find(
      (l: { itemId: string }) => l.itemId === packagingItemId,
    );
    expect(rawLine.lineTotal).toBe("33.60");
    expect(packagingLine.lineTotal).toBe("15.00");
    expect(body.orderTotal).toBe("48.60");

    await app.close();
  });

  it("não inventa total quando nenhuma linha tem preço", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestPurchaseOrder(app, {
      lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
    });

    expect(response.json().orderTotal).toBeNull();

    await app.close();
  });
});
