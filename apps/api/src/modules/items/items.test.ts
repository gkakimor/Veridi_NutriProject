import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";

const createdItemIds: string[] = [];

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
});

afterEach(async () => {
  if (createdItemIds.length === 0) return;
  await getPrisma().item.deleteMany({ where: { id: { in: createdItemIds } } });
  createdItemIds.length = 0;
});

type App = ReturnType<typeof buildApp>;

async function createTestItem(app: App, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/items",
    payload: {
      type: "RAW_MATERIAL",
      name: `Item de teste ${Date.now()}-${Math.random()}`,
      unitCode: "kg",
      ...overrides,
    },
  });
  if (response.statusCode === 201) {
    createdItemIds.push(response.json().id);
  }
  return response;
}

describe("Items", () => {
  it("cria uma matéria-prima com código MP-######", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestItem(app, {
      type: "RAW_MATERIAL",
      name: "Vitamina C teste",
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^MP-\d{6}$/);
    expect(body.controlsLot).toBe(true);
    expect(body.controlsExpiry).toBe(true);
    expect(body.requiresQualityRelease).toBe(true);
    expect(body.active).toBe(true);

    await app.close();
  });

  it("gera código ME-###### para embalagem, com controlsExpiry=false e requiresQualityRelease=false por padrão", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestItem(app, {
      type: "PACKAGING",
      name: "Pote teste",
      unitCode: "un",
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^ME-\d{6}$/);
    expect(body.controlsExpiry).toBe(false);
    expect(body.requiresQualityRelease).toBe(false);

    await app.close();
  });

  it("permite editar requiresQualityRelease independente do tipo", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestItem(app, {
      type: "PACKAGING",
      name: "Embalagem com liberação Teste",
      unitCode: "un",
    });
    expect(created.json().requiresQualityRelease).toBe(false);

    const patched = await app.inject({
      method: "PATCH",
      url: `/items/${created.json().id}`,
      payload: { requiresQualityRelease: true },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().requiresQualityRelease).toBe(true);

    await app.close();
  });

  it("gera código PA-###### para produto acabado", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestItem(app, {
      type: "FINISHED_PRODUCT",
      name: "Produto teste",
      unitCode: "un",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().code).toMatch(/^PA-\d{6}$/);

    await app.close();
  });

  it("gera códigos únicos e sequenciais para o mesmo tipo", async () => {
    const app = buildApp();
    await app.ready();

    const first = await createTestItem(app, { name: "Sequencial A" });
    const second = await createTestItem(app, { name: "Sequencial B" });

    expect(first.json().code).not.toBe(second.json().code);

    await app.close();
  });

  it("o código interno é único no banco (constraint)", async () => {
    const prisma = getPrisma();
    const duplicateCode = `MP-DUPTEST-${Date.now()}`;

    const first = await prisma.item.create({
      data: {
        type: "RAW_MATERIAL",
        code: duplicateCode,
        name: "Duplicado A",
        unitCode: "kg",
      },
    });
    createdItemIds.push(first.id);

    await expect(
      prisma.item.create({
        data: {
          type: "RAW_MATERIAL",
          code: duplicateCode,
          name: "Duplicado B",
          unitCode: "kg",
        },
      }),
    ).rejects.toThrow();
  });

  it("exige nome, tipo e unidade", async () => {
    const app = buildApp();
    await app.ready();

    const response = await app.inject({ method: "POST", url: "/items", payload: {} });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejeita unidade inexistente", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestItem(app, { unitCode: "unidade-inexistente" });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("inativa sem excluir e permite reativar", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestItem(app, { name: "Item para inativar" });
    const id = created.json().id;

    const deactivated = await app.inject({
      method: "POST",
      url: `/items/${id}/deactivate`,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().active).toBe(false);

    const stillThere = await app.inject({ method: "GET", url: `/items/${id}` });
    expect(stillThere.statusCode).toBe(200);
    expect(stillThere.json().active).toBe(false);

    const reactivated = await app.inject({
      method: "POST",
      url: `/items/${id}/activate`,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().active).toBe(true);

    await app.close();
  });

  it("busca por código, nome e barcode", async () => {
    const app = buildApp();
    await app.ready();

    const marker = `Buscavel${Date.now()}`;
    const created = await createTestItem(app, {
      name: marker,
      externalBarcode: `BC${Date.now()}`,
    });
    const createdBody = created.json();

    const byCode = await app.inject({
      method: "GET",
      url: `/items?search=${createdBody.code}`,
    });
    expect(
      byCode.json().items.some((item: { id: string }) => item.id === createdBody.id),
    ).toBe(true);

    const byName = await app.inject({ method: "GET", url: `/items?search=${marker}` });
    expect(
      byName.json().items.some((item: { id: string }) => item.id === createdBody.id),
    ).toBe(true);

    const byBarcode = await app.inject({
      method: "GET",
      url: `/items?search=${createdBody.externalBarcode}`,
    });
    expect(
      byBarcode.json().items.some((item: { id: string }) => item.id === createdBody.id),
    ).toBe(true);

    await app.close();
  });

  it("filtra por tipo e por status ativo", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestItem(app, {
      type: "PACKAGING",
      name: "Filtro teste",
      unitCode: "un",
    });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/items/${id}/deactivate` });

    const byType = await app.inject({
      method: "GET",
      url: "/items?type=PACKAGING&pageSize=100",
    });
    expect(
      byType.json().items.every((item: { type: string }) => item.type === "PACKAGING"),
    ).toBe(true);

    const onlyInactive = await app.inject({
      method: "GET",
      url: "/items?active=false&pageSize=100",
    });
    expect(
      onlyInactive.json().items.some((item: { id: string }) => item.id === id),
    ).toBe(true);
    expect(
      onlyInactive
        .json()
        .items.every((item: { active: boolean }) => item.active === false),
    ).toBe(true);

    await app.close();
  });

  it("PATCH com externalBarcode vazio limpa o barcode existente (persiste null)", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestItem(app, {
      name: "Item com barcode",
      externalBarcode: `BC${Date.now()}`,
    });
    const id = created.json().id;
    expect(created.json().externalBarcode).not.toBeNull();

    const cleared = await app.inject({
      method: "PATCH",
      url: `/items/${id}`,
      payload: { externalBarcode: "" },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().externalBarcode).toBeNull();

    await app.close();
  });
});
