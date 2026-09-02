import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Capacidade 33 — Cadastros Industriais v2.
 *
 * Cobre Customer (endereço), Item (taxonomia + pureza) e Product (perfil
 * industrial). Nada aqui pode alterar matemática de estoque/produção: são
 * campos de cadastro.
 */

const fixtureCustomerIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerOrderIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createCustomer(app: App, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente Industrial ${marker()}`, ...payload },
  });
  if (response.statusCode === 201) fixtureCustomerIds.push(response.json().id);
  return response;
}

async function createItem(app: App, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/items",
    payload: {
      type: "RAW_MATERIAL",
      name: `Item Industrial ${marker()}`,
      unitCode: "kg",
      ...payload,
    },
  });
  if (response.statusCode === 201) fixtureItemIds.push(response.json().id);
  return response;
}

async function createProduct(app: App, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: { customerId: await fixtureCustomerId(), name: `Produto Industrial ${marker()}`, ...payload },
  });
  if (response.statusCode === 201) fixtureProductIds.push(response.json().id);
  return response;
}

describe("Cadastros v2 — Cliente com endereço", () => {
  it("cria com endereço completo e normaliza o CEP para dígitos", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createCustomer(app, {
      street: "Rua das Indústrias",
      number: "1500",
      complement: "Galpão 3",
      district: "Distrito Industrial",
      zipCode: "13480-000",
      city: "Limeira",
      state: "sp",
    });
    expect(response.statusCode).toBe(201);
    const customer = response.json();

    expect(customer.street).toBe("Rua das Indústrias");
    expect(customer.number).toBe("1500");
    expect(customer.complement).toBe("Galpão 3");
    expect(customer.district).toBe("Distrito Industrial");
    // Guardado só com dígitos; a máscara é apresentação.
    expect(customer.zipCode).toBe("13480000");
    expect(customer.city).toBe("Limeira");
    expect(customer.state).toBe("SP");

    await app.close();
  });

  it("aceita atualização parcial e limpeza de campo sem tocar no resto", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = (
      await createCustomer(app, { street: "Rua A", number: "10", zipCode: "01001000", city: "São Paulo" })
    ).json();

    const updated = (
      await app.inject({
        method: "PATCH",
        url: `/customers/${created.id}`,
        payload: { number: "20", complement: "" },
      })
    ).json();

    expect(updated.number).toBe("20");
    // Campo enviado vazio limpa; campo ausente não muda.
    expect(updated.complement).toBeNull();
    expect(updated.street).toBe("Rua A");
    expect(updated.zipCode).toBe("01001000");

    await app.close();
  });

  it("endereço é totalmente opcional — cliente antigo continua válido", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createCustomer(app, {});
    expect(response.statusCode).toBe(201);
    const customer = response.json();
    expect(customer.street).toBeNull();
    expect(customer.zipCode).toBeNull();

    const invalidZip = await createCustomer(app, { zipCode: "123" });
    expect(invalidZip.statusCode).toBe(400);

    await app.close();
  });

  it("Pedido confirmado congela o endereço do Cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const customer = (
      await createCustomer(app, {
        street: "Av. Original",
        number: "100",
        district: "Centro",
        zipCode: "01310000",
        city: "São Paulo",
        state: "SP",
      })
    ).json();

    const finishedItem = (
      await createItem(app, { type: "FINISHED_PRODUCT", name: `PA Snapshot ${marker()}` })
    ).json();
    const product = (await createProduct(app, { finishedProductItemId: finishedItem.id })).json();

    const order = (
      await app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: {
          customerId: customer.id,
          lines: [{ productId: product.id, orderedQuantity: "10" }],
        },
      })
    ).json();
    fixtureCustomerOrderIds.push(order.id);

    const confirmed = (
      await app.inject({ method: "POST", url: `/customer-orders/${order.id}/confirm` })
    ).json();
    expect(confirmed.customerAddress.street).toBe("Av. Original");
    expect(confirmed.customerAddress.zipCode).toBe("01310000");

    // O cadastro muda depois — o documento confirmado não pode mudar junto.
    await app.inject({
      method: "PATCH",
      url: `/customers/${customer.id}`,
      payload: { street: "Rua Nova", number: "999", zipCode: "04567000" },
    });

    const reread = (
      await app.inject({ method: "GET", url: `/customer-orders/${order.id}` })
    ).json();
    expect(reread.customerAddress.street).toBe("Av. Original");
    expect(reread.customerAddress.number).toBe("100");
    expect(reread.customerAddress.zipCode).toBe("01310000");

    await app.close();
  });
});

describe("Cadastros v2 — Item industrial", () => {
  it("grava fonte, nutriente declarado, família e pureza como Decimal", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createItem(app, {
      name: `Vitamina B1 ${marker()}`,
      sourceName: "Cloridrato de tiamina",
      declaredNutrient: "Vitamina B1",
      family: "VITAMIN",
      defaultPurityPercent: "98.5",
    });
    expect(response.statusCode).toBe(201);
    const item = response.json();

    expect(item.sourceName).toBe("Cloridrato de tiamina");
    expect(item.declaredNutrient).toBe("Vitamina B1");
    expect(item.family).toBe("VITAMIN");
    // Decimal preservado exatamente — nunca 98.49999.
    expect(item.defaultPurityPercent).toBe("98.5");

    await app.close();
  });

  it("pureza: null é desconhecida; 0 e acima de 100 são rejeitados", async () => {
    const app = buildTestApp();
    await app.ready();

    const unknown = (await createItem(app, {})).json();
    // `null` significa DESCONHECIDA — jamais 100%.
    expect(unknown.defaultPurityPercent).toBeNull();

    expect((await createItem(app, { defaultPurityPercent: "0" })).statusCode).toBe(400);
    expect((await createItem(app, { defaultPurityPercent: "100.1" })).statusCode).toBe(400);
    expect((await createItem(app, { defaultPurityPercent: "100" })).statusCode).toBe(201);

    await app.close();
  });

  it("subtipo de embalagem só é aceito em item de embalagem", async () => {
    const app = buildTestApp();
    await app.ready();

    const packaging = await createItem(app, {
      type: "PACKAGING",
      name: `Pote 250ml ${marker()}`,
      packagingSubtype: "POT",
      family: "PACKAGING",
    });
    expect(packaging.statusCode).toBe(201);
    expect(packaging.json().packagingSubtype).toBe("POT");

    const rawMaterial = await createItem(app, { packagingSubtype: "POT" });
    expect(rawMaterial.statusCode).toBe(400);
    expect(rawMaterial.json().error).toBe("packaging_subtype_not_applicable");

    await app.close();
  });

  it("item sem os campos novos continua válido e é filtrável por família", async () => {
    const app = buildTestApp();
    await app.ready();

    const legacy = await createItem(app, {});
    expect(legacy.statusCode).toBe(201);
    expect(legacy.json().family).toBeNull();
    expect(legacy.json().sourceName).toBeNull();

    const mineral = (
      await createItem(app, { name: `Magnésio ${marker()}`, family: "MINERAL" })
    ).json();
    const filtered = (
      await app.inject({ method: "GET", url: "/items?family=MINERAL&pageSize=100" })
    ).json();
    expect(filtered.items.some((row: { id: string }) => row.id === mineral.id)).toBe(true);
    expect(filtered.items.every((row: { family: string }) => row.family === "MINERAL")).toBe(true);

    await app.close();
  });

  it("alterar a pureza padrão não altera nada além do próprio item", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = (await createItem(app, { defaultPurityPercent: "95" })).json();
    const updated = (
      await app.inject({
        method: "PATCH",
        url: `/items/${item.id}`,
        payload: { defaultPurityPercent: "80.25" },
      })
    ).json();

    expect(updated.defaultPurityPercent).toBe("80.25");
    // Nenhum movimento de estoque nasce de um campo de cadastro.
    const movements = (
      await app.inject({ method: "GET", url: `/inventory-movements?itemId=${item.id}` })
    ).json();
    expect(movements.total).toBe(0);

    await app.close();
  });
});

describe("Cadastros v2 — Perfil industrial do Produto", () => {
  it("grava o perfil completo, com dose em unidade própria", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = (
      await createItem(app, { type: "FINISHED_PRODUCT", name: `PA Perfil ${marker()}` })
    ).json();

    const response = await createProduct(app, {
      finishedProductItemId: finishedItem.id,
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 2,
      doseAmount: "500",
      // A dose é em mg mesmo com o Finished Item controlado em kg.
      doseUomCode: "mg",
      dosesPerPackage: 60,
      unitsPerShippingBox: 24,
      targetAgeGroup: "ADULT",
      shelfLifeMonths: 24,
      minimumBatchQuantity: "150.5",
    });
    expect(response.statusCode).toBe(201);
    const product = response.json();

    expect(product.dosageForm).toBe("CAPSULE");
    expect(product.presentationType).toBe("POT");
    expect(product.capsulesPerDose).toBe(2);
    expect(product.doseAmount).toBe("500");
    expect(product.doseUomCode).toBe("mg");
    expect(product.dosesPerPackage).toBe(60);
    expect(product.unitsPerShippingBox).toBe(24);
    expect(product.targetAgeGroup).toBe("ADULT");
    expect(product.shelfLifeMonths).toBe(24);
    // Decimal exato, sem float.
    expect(product.minimumBatchQuantity).toBe("150.5");

    await app.close();
  });

  it("rejeita quantidades não positivas e unidade de dose inexistente", async () => {
    const app = buildTestApp();
    await app.ready();

    expect((await createProduct(app, { capsulesPerDose: 0 })).statusCode).toBe(400);
    expect((await createProduct(app, { dosesPerPackage: -1 })).statusCode).toBe(400);
    expect((await createProduct(app, { unitsPerShippingBox: 0 })).statusCode).toBe(400);
    expect((await createProduct(app, { shelfLifeMonths: 0 })).statusCode).toBe(400);
    expect((await createProduct(app, { minimumBatchQuantity: "0" })).statusCode).toBe(400);

    const invalidUom = await createProduct(app, { doseAmount: "10", doseUomCode: "xyz" });
    expect(invalidUom.statusCode).toBe(400);
    expect(invalidUom.json().error).toBe("dose_uom_not_found");

    await app.close();
  });

  it("produto existente continua válido e aceita evolução parcial", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = (await createProduct(app, {})).json();
    expect(created.dosageForm).toBeNull();
    expect(created.shelfLifeMonths).toBeNull();
    expect(created.activeFormulationVersionLabel).toBeNull();

    const updated = (
      await app.inject({
        method: "PATCH",
        url: `/products/${created.id}`,
        payload: { dosageForm: "POWDER", shelfLifeMonths: 18 },
      })
    ).json();
    expect(updated.dosageForm).toBe("POWDER");
    expect(updated.shelfLifeMonths).toBe(18);
    expect(updated.name).toBe(created.name);

    const cleared = (
      await app.inject({
        method: "PATCH",
        url: `/products/${created.id}`,
        payload: { dosageForm: "" },
      })
    ).json();
    expect(cleared.dosageForm).toBeNull();
    expect(cleared.shelfLifeMonths).toBe(18);

    await app.close();
  });

  it("listagem mostra a versão ACTIVE da formulação", async () => {
    const app = buildTestApp();
    await app.ready();

    const rawMaterial = (await createItem(app, {})).json();
    const finishedItem = (
      await createItem(app, { type: "FINISHED_PRODUCT", name: `PA Formulado ${marker()}` })
    ).json();
    const product = (await createProduct(app, { finishedProductItemId: finishedItem.id })).json();

    const versionId = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/formulation-versions`,
        payload: {},
      })
    ).json().id;
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${versionId}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

    const detail = (await app.inject({ method: "GET", url: `/products/${product.id}` })).json();
    expect(detail.activeFormulationVersionId).toBe(versionId);
    expect(detail.activeFormulationVersionLabel).toBe("V1");

    await app.close();
  });
});

describe("Cadastros v2 — exportações", () => {
  it("CSV traz os novos campos com rótulos amigáveis, sem enum cru", async () => {
    const app = buildTestApp();
    await app.ready();

    const customer = (
      await createCustomer(app, { zipCode: "13480000", street: "Rua CSV", district: "Centro" })
    ).json();
    const item = (
      await createItem(app, {
        name: `Item CSV ${marker()}`,
        family: "MINERAL",
        sourceName: "Bisglicinato de magnésio",
        declaredNutrient: "Magnésio",
        defaultPurityPercent: "98.5",
      })
    ).json();
    const product = (
      await createProduct(app, { dosageForm: "CAPSULE", presentationType: "POT", shelfLifeMonths: 24 })
    ).json();

    const customersCsv = (
      await app.inject({ method: "GET", url: `/customers/export.csv?search=${customer.code}` })
    ).body;
    expect(customersCsv).toContain("CEP");
    // CEP sai formatado, mesmo guardado só com dígitos.
    expect(customersCsv).toContain("13480-000");
    expect(customersCsv).toContain("Rua CSV");

    const itemsCsv = (
      await app.inject({ method: "GET", url: `/items/export.csv?search=${item.code}` })
    ).body;
    expect(itemsCsv).toContain("Família");
    expect(itemsCsv).toContain("Mineral");
    expect(itemsCsv).not.toContain("MINERAL");
    expect(itemsCsv).toContain("Bisglicinato de magnésio");
    expect(itemsCsv).toContain("98,5");

    const productsCsv = (
      await app.inject({ method: "GET", url: `/products/export.csv?search=${product.code}` })
    ).body;
    expect(productsCsv).toContain("Forma farmacêutica");
    expect(productsCsv).toContain("Cápsula");
    expect(productsCsv).toContain("Pote");
    expect(productsCsv).toContain("24");

    await app.close();
  });
});
