import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";

const createdCustomerIds: string[] = [];

afterEach(async () => {
  if (createdCustomerIds.length === 0) return;
  await getPrisma().customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  createdCustomerIds.length = 0;
});

type App = ReturnType<typeof buildApp>;

async function createTestCustomer(app: App, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/customers",
    payload: {
      legalName: `Cliente de teste ${Date.now()}-${Math.random()}`,
      ...overrides,
    },
  });
  if (response.statusCode === 201) {
    createdCustomerIds.push(response.json().id);
  }
  return response;
}

describe("Customers", () => {
  it("cria cliente com código CLI-######", async () => {
    const app = buildApp();
    await app.ready();

    const response = await createTestCustomer(app, { legalName: "Cliente A" });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^CLI-\d{6}$/);
    expect(body.active).toBe(true);

    await app.close();
  });

  it("código interno é imutável (PATCH ignora tentativa de alterar)", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestCustomer(app);
    const code = created.json().code;
    const id = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/customers/${id}`,
      payload: { code: "CLI-999999", legalName: "Nome atualizado" },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().code).toBe(code);
    expect(patched.json().legalName).toBe("Nome atualizado");

    await app.close();
  });

  it("exige razão social", async () => {
    const app = buildApp();
    await app.ready();

    const response = await app.inject({ method: "POST", url: "/customers", payload: {} });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("normaliza CNPJ para somente dígitos", async () => {
    const app = buildApp();
    await app.ready();

    const digits = `55666777${Date.now().toString().slice(-6)}`;
    const masked = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
    const response = await createTestCustomer(app, {
      legalName: "Cliente com CNPJ",
      cnpj: masked,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().cnpj).toBe(digits);

    await app.close();
  });

  it("não permite CNPJ duplicado", async () => {
    const app = buildApp();
    await app.ready();

    const cnpj = `22333444${Date.now().toString().slice(-6)}`;
    const first = await createTestCustomer(app, { cnpj });
    expect(first.statusCode).toBe(201);

    const second = await createTestCustomer(app, { cnpj });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("duplicate_cnpj");

    await app.close();
  });

  it("aceita UF válida em maiúsculas e rejeita UF inválida", async () => {
    const app = buildApp();
    await app.ready();

    const valid = await createTestCustomer(app, { state: "sp" });
    expect(valid.statusCode).toBe(201);
    expect(valid.json().state).toBe("SP");

    const invalid = await createTestCustomer(app, { state: "ZZ" });
    expect(invalid.statusCode).toBe(400);

    await app.close();
  });

  it("busca por código, razão social e CNPJ", async () => {
    const app = buildApp();
    await app.ready();

    const marker = `BuscavelCliente${Date.now()}`;
    const created = await createTestCustomer(app, { legalName: marker });
    const createdBody = created.json();

    const byCode = await app.inject({
      method: "GET",
      url: `/customers?search=${createdBody.code}`,
    });
    expect(
      byCode.json().customers.some((c: { id: string }) => c.id === createdBody.id),
    ).toBe(true);

    const byName = await app.inject({ method: "GET", url: `/customers?search=${marker}` });
    expect(
      byName.json().customers.some((c: { id: string }) => c.id === createdBody.id),
    ).toBe(true);

    await app.close();
  });

  it("filtra por status ativo", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestCustomer(app, { legalName: "Cliente filtro" });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/customers/${id}/deactivate` });

    const onlyInactive = await app.inject({
      method: "GET",
      url: "/customers?active=false&pageSize=100",
    });
    expect(
      onlyInactive.json().customers.some((c: { id: string }) => c.id === id),
    ).toBe(true);

    await app.close();
  });

  it("inativa sem excluir e permite reativar", async () => {
    const app = buildApp();
    await app.ready();

    const created = await createTestCustomer(app, { legalName: "Cliente inativar" });
    const id = created.json().id;

    const deactivated = await app.inject({
      method: "POST",
      url: `/customers/${id}/deactivate`,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().active).toBe(false);

    const reactivated = await app.inject({
      method: "POST",
      url: `/customers/${id}/activate`,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().active).toBe(true);

    await app.close();
  });
});
