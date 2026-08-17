import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const fixtureSupplierIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureLotIds: string[] = [];

let supplierId: string;
let itemId: string;
let marker: string;

beforeAll(async () => {
  const prisma = getPrisma();

  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });

  marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const supplier = await prisma.supplier.create({
    data: { code: `FOR-LOT-${marker}`, legalName: `Fornecedor Lote Teste ${marker}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);

  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-LOT-${marker}`,
      name: `Item Lote Teste ${marker}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
    },
  });
  itemId = item.id;
  fixtureItemIds.push(item.id);

  const availableLot = await prisma.lot.create({
    data: {
      code: `LT-TESTE-${marker}-A`,
      itemId,
      supplierId,
      supplierLot: `SUP-${marker}-A`,
      businessLotNumber: `COM${marker}A`,
      initialReceivedQuantity: "10",
      status: "AVAILABLE",
    },
  });
  fixtureLotIds.push(availableLot.id);

  const blockedLot = await prisma.lot.create({
    data: {
      code: `LT-TESTE-${marker}-B`,
      itemId,
      supplierId,
      supplierLot: `SUP-${marker}-B`,
      initialReceivedQuantity: "5",
      status: "BLOCKED",
      blockedAt: new Date(),
      blockedBy: "Ambiente local",
      blockReason: "Fixture de teste",
    },
  });
  fixtureLotIds.push(blockedLot.id);
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureLotIds.length > 0) {
    await prisma.lot.deleteMany({ where: { id: { in: fixtureLotIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

describe("Lots", () => {
  it("busca por código interno, lote do fornecedor e código/nome do item", async () => {
    const app = buildTestApp();
    await app.ready();

    const byInternalCode = await app.inject({
      method: "GET",
      url: `/lots?search=LT-TESTE-${marker}-A`,
    });
    expect(
      byInternalCode.json().lots.some((l: { code: string }) => l.code === `LT-TESTE-${marker}-A`),
    ).toBe(true);

    const bySupplierLot = await app.inject({
      method: "GET",
      url: `/lots?search=SUP-${marker}-B`,
    });
    expect(
      bySupplierLot.json().lots.some((l: { code: string }) => l.code === `LT-TESTE-${marker}-B`),
    ).toBe(true);

    const byItemCode = await app.inject({
      method: "GET",
      url: `/lots?search=MP-LOT-${marker}`,
    });
    expect(byItemCode.json().lots.length).toBeGreaterThanOrEqual(2);

    await app.close();
  });

  it("acha o lote pelo número comercial impresso na etiqueta", async () => {
    const app = buildTestApp();
    await app.ready();

    // A operação lê o lote comercial no rótulo; procurar por ele não pode
    // devolver "nenhum lote encontrado".
    const byBusinessLot = await app.inject({ method: "GET", url: `/lots?search=COM${marker}A` });
    expect(byBusinessLot.statusCode).toBe(200);
    expect(
      byBusinessLot.json().lots.some((l: { code: string }) => l.code === `LT-TESTE-${marker}-A`),
    ).toBe(true);

    // O escaneamento/busca direta também resolve, sem trocar a identidade
    // interna do lote.
    const lookup = await app.inject({ method: "GET", url: `/lots/lookup?code=COM${marker}A` });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().code).toBe(`LT-TESTE-${marker}-A`);

    await app.close();
  });

  it("filtra por status, item e fornecedor", async () => {
    const app = buildTestApp();
    await app.ready();

    const onlyBlocked = await app.inject({
      method: "GET",
      url: `/lots?status=BLOCKED&itemId=${itemId}&pageSize=100`,
    });
    expect(
      onlyBlocked
        .json()
        .lots.every((l: { status: string }) => l.status === "BLOCKED"),
    ).toBe(true);
    expect(
      onlyBlocked.json().lots.some((l: { code: string }) => l.code === `LT-TESTE-${marker}-B`),
    ).toBe(true);

    const bySupplier = await app.inject({
      method: "GET",
      url: `/lots?supplierId=${supplierId}&pageSize=100`,
    });
    expect(bySupplier.json().lots.length).toBeGreaterThanOrEqual(2);

    await app.close();
  });

  it("GET /lots/:id retorna detalhe com item/fornecedor", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: `/lots/${fixtureLotIds[0]}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.itemId).toBe(itemId);
    expect(body.supplierId).toBe(supplierId);
    expect(body.status).toBe("AVAILABLE");

    await app.close();
  });

  it("qrPayload é determinístico e distinto por lote", async () => {
    const app = buildTestApp();
    await app.ready();

    const first = await app.inject({ method: "GET", url: `/lots/${fixtureLotIds[0]}` });
    const firstAgain = await app.inject({ method: "GET", url: `/lots/${fixtureLotIds[0]}` });
    const second = await app.inject({ method: "GET", url: `/lots/${fixtureLotIds[1]}` });

    expect(first.json().qrPayload).toBe(`LOT:${first.json().code}`);
    expect(first.json().qrPayload).toBe(firstAgain.json().qrPayload);
    expect(first.json().qrPayload).not.toBe(second.json().qrPayload);

    await app.close();
  });
});

describe("Lot lookup (QR/scan)", () => {
  const prisma = getPrisma();
  let lookupSupplierId: string;
  let lookupItemId: string;
  let lookupLotId: string;
  let lookupCode: string;
  let lookupSupplierLot: string;

  beforeAll(async () => {
    await prisma.unitOfMeasure.upsert({
      where: { code: "kg" },
      update: {},
      create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
    });

    const stamp = Date.now();
    const supplier = await prisma.supplier.create({
      data: { code: `FOR-LOOKUP-${stamp}`, legalName: `Fornecedor Lookup Teste ${stamp}` },
    });
    lookupSupplierId = supplier.id;

    const item = await prisma.item.create({
      data: {
        type: "RAW_MATERIAL",
        code: `MP-LOOKUP-${stamp}`,
        name: `Item Lookup Teste ${stamp}`,
        unitCode: "kg",
        controlsLot: true,
      },
    });
    lookupItemId = item.id;

    lookupCode = `LT-LOOKUPTEST-${stamp}`;
    lookupSupplierLot = `SUPPLOT-${stamp}`;
    const lot = await prisma.lot.create({
      data: {
        code: lookupCode,
        itemId: lookupItemId,
        supplierId: lookupSupplierId,
        supplierLot: lookupSupplierLot,
        initialReceivedQuantity: "1",
        status: "AVAILABLE",
      },
    });
    lookupLotId = lot.id;
  });

  afterAll(async () => {
    await prisma.lot.deleteMany({ where: { id: lookupLotId } });
    await prisma.item.deleteMany({ where: { id: lookupItemId } });
    await prisma.supplier.deleteMany({ where: { id: lookupSupplierId } });
  });

  it("resolve pelo código interno puro", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: `/lots/lookup?code=${lookupCode}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(lookupLotId);

    await app.close();
  });

  it("resolve pelo payload completo do QR (LOT:<codigo>)", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: `/lots/lookup?code=${encodeURIComponent(`LOT:${lookupCode}`)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(lookupLotId);

    await app.close();
  });

  it("não encontra código de lote inválido/inventado", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: `/lots/lookup?code=LT-INVENTADO-000000`,
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("nunca resolve por supplierLot — só pelo código interno", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: `/lots/lookup?code=${lookupSupplierLot}`,
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
