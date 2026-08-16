import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";

/**
 * Capacidade 40 — Item × Fornecedor / homologação / MOQ / preços.
 *
 * Fixtures sintéticas: nada depende do corpus real nem das relações
 * importadas pelo seed.
 */

const fixtureSupplierItemIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureSupplierItemIds.length > 0) {
    await prisma.supplierItemOffer.deleteMany({
      where: { supplierItemId: { in: fixtureSupplierItemIds } },
    });
    await prisma.supplierItemQualificationHistory.deleteMany({
      where: { supplierItemId: { in: fixtureSupplierItemIds } },
    });
    await prisma.supplierItem.deleteMany({ where: { id: { in: fixtureSupplierItemIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

async function createItem(unitCode = "kg", type: "RAW_MATERIAL" | "FINISHED_PRODUCT" = "RAW_MATERIAL") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-SI-${m}`,
      name: `Item Fornecedor Teste ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-SI-${m}`, legalName: `Fornecedor Teste ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createRelation(app: App, itemId: string, supplierId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/supplier-items",
    payload: { itemId, supplierId },
  });
  if (response.statusCode === 201) fixtureSupplierItemIds.push(response.json().id);
  return response;
}

/** Homologa usando um app da Qualidade — Compras nunca homologa sozinha. */
async function approve(supplierItemId: string, note = "Auditoria ok") {
  const quality = buildTestApp("QUALITY");
  await quality.ready();
  const response = await quality.inject({
    method: "POST",
    url: `/supplier-items/${supplierItemId}/qualification`,
    payload: { status: "APPROVED", note },
  });
  await quality.close();
  return response;
}

describe("Item × Fornecedor — relação", () => {
  it("cria a relação pendente e recusa duplicar o mesmo par", async () => {
    const app = buildTestApp("PURCHASING");
    await app.ready();
    const { user } = await createAuthenticatedUser("PURCHASING");

    const item = await createItem();
    const supplier = await createSupplier();

    const response = await createRelation(app, item.id, supplier.id);
    expect(response.statusCode).toBe(201);

    const relation = response.json();
    // Cadastrar fornecedor não é homologá-lo.
    expect(relation.qualificationStatus).toBe("PENDING");
    expect(relation.preferred).toBe(false);
    expect(relation.active).toBe(true);
    expect(relation.createdByName).toBe(user.name);
    expect(relation.qualificationHistory).toHaveLength(1);
    expect(relation.qualificationHistory[0].fromStatus).toBeNull();
    expect(relation.qualificationHistory[0].toStatus).toBe("PENDING");

    const duplicated = await createRelation(app, item.id, supplier.id);
    expect(duplicated.statusCode).toBe(409);

    await app.close();
  });

  it("recusa produto acabado — ele é produzido, não comprado", async () => {
    const app = buildTestApp("PURCHASING");
    await app.ready();

    const finished = await createItem("un", "FINISHED_PRODUCT");
    const supplier = await createSupplier();

    const response = await createRelation(app, finished.id, supplier.id);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_item_type");

    await app.close();
  });
});

describe("Item × Fornecedor — homologação", () => {
  it("só a Qualidade homologa, e o histórico guarda quem decidiu", async () => {
    const purchasing = buildTestApp("PURCHASING");
    await purchasing.ready();

    const item = await createItem();
    const supplier = await createSupplier();
    const relation = (await createRelation(purchasing, item.id, supplier.id)).json();

    // Compras cadastra e negocia, mas não homologa o próprio fornecedor.
    const byPurchasing = await purchasing.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/qualification`,
      payload: { status: "APPROVED" },
    });
    expect(byPurchasing.statusCode).toBe(403);

    const { user: qualityUser } = await createAuthenticatedUser("QUALITY");
    const approved = await approve(relation.id);
    expect(approved.statusCode).toBe(200);
    expect(approved.json().qualificationStatus).toBe("APPROVED");

    const history = approved.json().qualificationHistory;
    expect(history).toHaveLength(2);
    expect(history[1].fromStatus).toBe("PENDING");
    expect(history[1].toStatus).toBe("APPROVED");
    expect(history[1].changedByName).toBe(qualityUser.name);

    await purchasing.close();
  });

  it("bloquear derruba o preferencial na mesma transação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const supplier = await createSupplier();
    const relation = (await createRelation(app, item.id, supplier.id)).json();

    await approve(relation.id);
    const preferred = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/preferred`,
      payload: { preferred: true },
    });
    expect(preferred.json().preferred).toBe(true);

    const blocked = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/qualification`,
      payload: { status: "BLOCKED", note: "Não conformidade recorrente" },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json().qualificationStatus).toBe("BLOCKED");
    // Fornecedor bloqueado nunca continua como preferencial.
    expect(blocked.json().preferred).toBe(false);

    await app.close();
  });
});

describe("Item × Fornecedor — preferencial", () => {
  it("mantém no máximo um preferencial por item e exige homologação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const supplierA = await createSupplier();
    const supplierB = await createSupplier();
    const relationA = (await createRelation(app, item.id, supplierA.id)).json();
    const relationB = (await createRelation(app, item.id, supplierB.id)).json();

    // Pendente não pode ser preferencial.
    const pendingPreferred = await app.inject({
      method: "POST",
      url: `/supplier-items/${relationA.id}/preferred`,
      payload: { preferred: true },
    });
    expect(pendingPreferred.statusCode).toBe(409);

    await approve(relationA.id);
    await approve(relationB.id);

    await app.inject({
      method: "POST",
      url: `/supplier-items/${relationA.id}/preferred`,
      payload: { preferred: true },
    });
    const bPreferred = await app.inject({
      method: "POST",
      url: `/supplier-items/${relationB.id}/preferred`,
      payload: { preferred: true },
    });
    expect(bPreferred.json().preferred).toBe(true);

    const aAfter = await app.inject({ method: "GET", url: `/supplier-items/${relationA.id}` });
    expect(aAfter.json().preferred).toBe(false);

    // Inativar a relação também derruba o preferencial.
    const deactivated = await app.inject({
      method: "PATCH",
      url: `/supplier-items/${relationB.id}`,
      payload: { active: false },
    });
    expect(deactivated.json().active).toBe(false);
    expect(deactivated.json().preferred).toBe(false);

    await app.close();
  });
});

describe("Item × Fornecedor — ofertas", () => {
  it("registra preço, MOQ e mantém a oferta anterior no histórico", async () => {
    const app = buildTestApp("PURCHASING");
    await app.ready();

    const item = await createItem();
    const supplier = await createSupplier();
    const relation = (await createRelation(app, item.id, supplier.id)).json();

    const first = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: {
        unitPrice: "100",
        priceUomCode: "kg",
        minimumOrderQuantity: "25",
        minimumOrderUomCode: "kg",
      },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().currentOffer.unitPrice).toBe("100");
    expect(first.json().currentOffer.currencyCode).toBe("BRL");
    expect(first.json().currentOffer.minimumOrderQuantity).toBe("25");

    const second = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: { unitPrice: "95", priceUomCode: "kg" },
    });
    expect(second.json().currentOffer.unitPrice).toBe("95");
    // A oferta anterior continua existindo — histórico não é reescrito.
    expect(second.json().offers).toHaveLength(2);
    expect(second.json().offers.some((offer: { unitPrice: string }) => offer.unitPrice === "100")).toBe(
      true,
    );

    // Oferta é imutável: não existe rota de edição.
    const prisma = getPrisma();
    const offers = await prisma.supplierItemOffer.findMany({
      where: { supplierItemId: relation.id },
    });
    expect(offers).toHaveLength(2);

    await app.close();
  });

  it("normaliza a moeda, recusa código inválido e nunca converte câmbio", async () => {
    const app = buildTestApp("PURCHASING");
    await app.ready();

    const item = await createItem();
    const supplier = await createSupplier();
    const relation = (await createRelation(app, item.id, supplier.id)).json();

    const usd = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: { unitPrice: "20", currencyCode: "usd", priceUomCode: "kg" },
    });
    expect(usd.statusCode).toBe(201);
    expect(usd.json().currentOffer.currencyCode).toBe("USD");
    // Nenhuma conversão: o valor permanece exatamente o informado.
    expect(usd.json().currentOffer.unitPrice).toBe("20");

    const invalid = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: { unitPrice: "20", currencyCode: "R$", priceUomCode: "kg" },
    });
    expect(invalid.statusCode).toBe(400);

    await app.close();
  });

  it("preserva Decimal e recusa unidade incompatível com o item", async () => {
    const app = buildTestApp("PURCHASING");
    await app.ready();

    const item = await createItem();
    const supplier = await createSupplier();
    const relation = (await createRelation(app, item.id, supplier.id)).json();

    const precise = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: {
        unitPrice: "19.1234",
        priceUomCode: "kg",
        minimumOrderQuantity: "0.25",
        minimumOrderUomCode: "kg",
      },
    });
    expect(precise.statusCode).toBe(201);
    expect(precise.json().currentOffer.unitPrice).toBe("19.1234");
    expect(precise.json().currentOffer.minimumOrderQuantity).toBe("0.25");

    // Item em kg não aceita preço por unidade — dimensões diferentes.
    const incompatible = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: { unitPrice: "5", priceUomCode: "un" },
    });
    expect(incompatible.statusCode).toBe(400);
    expect(incompatible.json().error).toBe("incompatible_uom");

    await app.close();
  });

  it("respeita a vigência: futura e expirada não são a oferta atual", async () => {
    const app = buildTestApp("PURCHASING");
    await app.ready();

    const item = await createItem();
    const supplier = await createSupplier();
    const relation = (await createRelation(app, item.id, supplier.id)).json();

    const invalidValidity = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: {
        unitPrice: "50",
        priceUomCode: "kg",
        effectiveAt: "2026-08-01T12:00:00.000Z",
        validUntil: "2026-07-31T12:00:00.000Z",
      },
    });
    expect(invalidValidity.statusCode).toBe(400);
    expect(invalidValidity.json().error).toBe("invalid_validity");

    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const futureOffer = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: { unitPrice: "77", priceUomCode: "kg", effectiveAt: future },
    });
    expect(futureOffer.json().currentOffer).toBeNull();

    const expired = await app.inject({
      method: "POST",
      url: `/supplier-items/${relation.id}/offers`,
      payload: {
        unitPrice: "60",
        priceUomCode: "kg",
        effectiveAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
        validUntil: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      },
    });
    expect(expired.json().currentOffer).toBeNull();

    // Referência sem vigência (padrão do legado) nunca vira preço atual.
    const prisma = getPrisma();
    await prisma.supplierItemOffer.create({
      data: {
        supplierItemId: relation.id,
        unitPrice: "42",
        currencyCode: "BRL",
        priceUomCode: "kg",
        effectiveAt: null,
        source: "LEGACY_IMPORT",
        sourceKey: `test-${marker()}`,
      },
    });
    const reread = await app.inject({ method: "GET", url: `/supplier-items/${relation.id}` });
    expect(reread.json().currentOffer).toBeNull();
    expect(reread.json().latestLegacyOffer.unitPrice).toBe("42");

    await app.close();
  });
});

describe("Item × Fornecedor — listagem e exportação", () => {
  it("filtra por homologação e exporta sem identificadores internos", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const item = await createItem();
    const supplier = await createSupplier();
    const relation = (await createRelation(app, item.id, supplier.id)).json();
    await approve(relation.id);

    const approvedOnly = await app.inject({
      method: "GET",
      url: `/supplier-items?itemId=${item.id}&qualificationStatus=APPROVED`,
    });
    expect(approvedOnly.json().supplierItems).toHaveLength(1);

    const pendingOnly = await app.inject({
      method: "GET",
      url: `/supplier-items?itemId=${item.id}&qualificationStatus=PENDING`,
    });
    expect(pendingOnly.json().supplierItems).toHaveLength(0);

    const byItem = await app.inject({ method: "GET", url: `/items/${item.id}/supplier-items` });
    expect(byItem.json().supplierItems[0].supplierName).toBe(supplier.legalName);

    const bySupplier = await app.inject({
      method: "GET",
      url: `/suppliers/${supplier.id}/supplier-items`,
    });
    expect(bySupplier.json().supplierItems[0].itemCode).toBe(item.code);

    const csv = await app.inject({
      method: "GET",
      url: `/supplier-items/export.csv?itemId=${item.id}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(item.code);
    expect(csv.body).not.toContain(item.id);
    expect(csv.body).not.toContain(relation.id);

    await app.close();
  });
});
