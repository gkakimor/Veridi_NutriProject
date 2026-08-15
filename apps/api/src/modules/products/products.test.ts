import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";

const createdProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureItemIds: string[] = [];

let activeCustomerId: string;
let inactiveCustomerId: string;
let finishedItemId: string;
let inactiveFinishedItemId: string;
let rawMaterialItemId: string;
let packagingItemId: string;

beforeAll(async () => {
  const prisma = getPrisma();

  await prisma.unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: 1 },
  });

  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const activeCustomer = await prisma.customer.create({
    data: { code: `CLI-TEST-${marker}-A`, legalName: `Cliente Ativo Teste ${marker}` },
  });
  activeCustomerId = activeCustomer.id;
  fixtureCustomerIds.push(activeCustomer.id);

  const inactiveCustomer = await prisma.customer.create({
    data: {
      code: `CLI-TEST-${marker}-I`,
      legalName: `Cliente Inativo Teste ${marker}`,
      active: false,
    },
  });
  inactiveCustomerId = inactiveCustomer.id;
  fixtureCustomerIds.push(inactiveCustomer.id);

  const finishedItem = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-TEST-${marker}-A`,
      name: `Item Acabado Ativo Teste ${marker}`,
      unitCode: "un",
    },
  });
  finishedItemId = finishedItem.id;
  fixtureItemIds.push(finishedItem.id);

  const inactiveFinishedItem = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-TEST-${marker}-I`,
      name: `Item Acabado Inativo Teste ${marker}`,
      unitCode: "un",
      active: false,
    },
  });
  inactiveFinishedItemId = inactiveFinishedItem.id;
  fixtureItemIds.push(inactiveFinishedItem.id);

  const rawMaterialItem = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-TEST-${marker}`,
      name: `Materia Prima Teste ${marker}`,
      unitCode: "un",
    },
  });
  rawMaterialItemId = rawMaterialItem.id;
  fixtureItemIds.push(rawMaterialItem.id);

  const packagingItem = await prisma.item.create({
    data: {
      type: "PACKAGING",
      code: `ME-TEST-${marker}`,
      name: `Embalagem Teste ${marker}`,
      unitCode: "un",
    },
  });
  packagingItemId = packagingItem.id;
  fixtureItemIds.push(packagingItem.id);
});

afterEach(async () => {
  if (createdProductIds.length === 0) return;
  await getPrisma().product.deleteMany({ where: { id: { in: createdProductIds } } });
  createdProductIds.length = 0;
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

type App = ReturnType<typeof buildApp>;

async function createTestProduct(app: App, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      name: `Produto de teste ${Date.now()}-${Math.random()}`,
      ...overrides,
    },
  });
  if (response.statusCode === 201) {
    createdProductIds.push(response.json().id);
  }
  return response;
}

describe("Products", () => {
  it("cria produto com código PROD-######", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, { name: "Magnésio Quelato 60 cápsulas" });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^PROD-\d{6}$/);
    expect(body.active).toBe(true);

    await app.close();
  });

  it("código interno é imutável (PATCH ignora tentativa de alterar)", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestProduct(app);
    const code = created.json().code;
    const id = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/products/${id}`,
      payload: { code: "PROD-999999", name: "Nome atualizado" },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().code).toBe(code);
    expect(patched.json().name).toBe("Nome atualizado");

    await app.close();
  });

  it("exige nome", async () => {
    const app = buildApp();
    await app.ready();

    const response = await app.inject({ method: "POST", url: "/products", payload: {} });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("cria produto sem cliente", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app);

    expect(response.statusCode).toBe(201);
    expect(response.json().customerId).toBeNull();
    expect(response.json().customer).toBeNull();

    await app.close();
  });

  it("cria produto com cliente ativo", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, { customerId: activeCustomerId });

    expect(response.statusCode).toBe(201);
    expect(response.json().customerId).toBe(activeCustomerId);
    expect(response.json().customer.id).toBe(activeCustomerId);

    await app.close();
  });

  it("rejeita cliente inexistente", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, {
      customerId: "00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("customer_not_found");

    await app.close();
  });

  it("rejeita nova associação a cliente inativo", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, { customerId: inactiveCustomerId });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("inactive_customer");

    await app.close();
  });

  it("associa item FINISHED_PRODUCT ativo", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, {
      finishedProductItemId: finishedItemId,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().finishedProductItemId).toBe(finishedItemId);
    expect(response.json().finishedProductItem.id).toBe(finishedItemId);

    await app.close();
  });

  it("rejeita item RAW_MATERIAL como produto acabado", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, {
      finishedProductItemId: rawMaterialItemId,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_item_type");

    await app.close();
  });

  it("rejeita item PACKAGING como produto acabado", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, {
      finishedProductItemId: packagingItemId,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_item_type");

    await app.close();
  });

  it("rejeita item inexistente", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, {
      finishedProductItemId: "00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("item_not_found");

    await app.close();
  });

  it("rejeita nova associação a item inativo", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestProduct(app, {
      finishedProductItemId: inactiveFinishedItemId,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("inactive_item");

    await app.close();
  });

  it("impede dois produtos usando o mesmo item de produto acabado", async () => {
    const app = buildApp();
    await app.ready();

    const first = await createTestProduct(app, { finishedProductItemId: finishedItemId });
    expect(first.statusCode).toBe(201);

    const second = await createTestProduct(app, { finishedProductItemId: finishedItemId });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("duplicate_finished_item");

    await app.close();
  });

  it("mantém associação histórica se o cliente for inativado depois", async () => {
    const app = buildApp();
    await app.ready();

    const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const customer = await app.inject({
      method: "POST",
      url: "/customers",
      payload: { legalName: `Cliente para inativar depois ${marker}` },
    });
    const customerId = customer.json().id;

    const created = await createTestProduct(app, { customerId });
    expect(created.statusCode).toBe(201);
    const productId = created.json().id;

    await app.inject({ method: "POST", url: `/customers/${customerId}/deactivate` });

    // PATCH reenviando o mesmo customerId (nao mudou) deve manter, sem exigir cliente ativo.
    const patched = await app.inject({
      method: "PATCH",
      url: `/products/${productId}`,
      payload: { customerId, name: "Nome ajustado" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().customerId).toBe(customerId);

    await getPrisma().customer.delete({ where: { id: customerId } });
    await app.close();
  });

  it("mantém associação histórica se o item for inativado depois", async () => {
    const app = buildApp();
    await app.ready();

    const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const item = await getPrisma().item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-HIST-${marker}`,
        name: `Item para inativar depois ${marker}`,
        unitCode: "un",
      },
    });

    const created = await createTestProduct(app, { finishedProductItemId: item.id });
    expect(created.statusCode).toBe(201);
    const productId = created.json().id;

    await app.inject({ method: "POST", url: `/items/${item.id}/deactivate` });

    const patched = await app.inject({
      method: "PATCH",
      url: `/products/${productId}`,
      payload: { finishedProductItemId: item.id, name: "Nome ajustado" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().finishedProductItemId).toBe(item.id);

    await app.close();
    await getPrisma().item.delete({ where: { id: item.id } });
  });

  it("busca por código, nome, referência externa e cliente", async () => {
    const app = buildApp();
    await app.ready();

    const marker = `Buscavel${Date.now()}`;
    const created = await createTestProduct(app, {
      name: marker,
      externalCode: `EXT${Date.now()}`,
      customerId: activeCustomerId,
    });
    const createdBody = created.json();

    const byCode = await app.inject({
      method: "GET",
      url: `/products?search=${createdBody.code}`,
    });
    expect(
      byCode.json().products.some((p: { id: string }) => p.id === createdBody.id),
    ).toBe(true);

    const byName = await app.inject({ method: "GET", url: `/products?search=${marker}` });
    expect(
      byName.json().products.some((p: { id: string }) => p.id === createdBody.id),
    ).toBe(true);

    const byExternal = await app.inject({
      method: "GET",
      url: `/products?search=${createdBody.externalCode}`,
    });
    expect(
      byExternal.json().products.some((p: { id: string }) => p.id === createdBody.id),
    ).toBe(true);

    await app.close();
  });

  it("filtra por status ativo e por cliente", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestProduct(app, { customerId: activeCustomerId });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/products/${id}/deactivate` });

    const onlyInactive = await app.inject({
      method: "GET",
      url: "/products?active=false&pageSize=100",
    });
    expect(
      onlyInactive.json().products.some((p: { id: string }) => p.id === id),
    ).toBe(true);

    const byCustomer = await app.inject({
      method: "GET",
      url: `/products?customerId=${activeCustomerId}&pageSize=100`,
    });
    expect(
      byCustomer.json().products.every(
        (p: { customerId: string }) => p.customerId === activeCustomerId,
      ),
    ).toBe(true);

    await app.close();
  });

  it("inativa sem excluir e permite reativar", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestProduct(app);
    const id = created.json().id;

    const deactivated = await app.inject({
      method: "POST",
      url: `/products/${id}/deactivate`,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().active).toBe(false);

    const reactivated = await app.inject({
      method: "POST",
      url: `/products/${id}/activate`,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().active).toBe(true);

    await app.close();
  });

  it("PATCH com externalCode vazio limpa a referência (persiste null)", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestProduct(app, { externalCode: `EXT${Date.now()}` });
    const id = created.json().id;
    expect(created.json().externalCode).not.toBeNull();

    const cleared = await app.inject({
      method: "PATCH",
      url: `/products/${id}`,
      payload: { externalCode: "" },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().externalCode).toBeNull();

    await app.close();
  });
});
