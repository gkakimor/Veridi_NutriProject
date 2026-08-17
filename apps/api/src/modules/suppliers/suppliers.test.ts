import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const createdSupplierIds: string[] = [];

afterEach(async () => {
  if (createdSupplierIds.length === 0) return;
  await getPrisma().supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
  createdSupplierIds.length = 0;
});

type App = ReturnType<typeof buildTestApp>;

async function createTestSupplier(app: App, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/suppliers",
    payload: {
      legalName: `Fornecedor de teste ${Date.now()}-${Math.random()}`,
      ...overrides,
    },
  });
  if (response.statusCode === 201) {
    createdSupplierIds.push(response.json().id);
  }
  return response;
}

describe("Suppliers", () => {
  it("cria fornecedor com código FOR-######", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestSupplier(app, { legalName: "Fornecedor A" });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^FOR-\d{6}$/);
    expect(body.active).toBe(true);

    await app.close();
  });

  it("código interno é imutável (PATCH ignora tentativa de alterar)", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestSupplier(app);
    const code = created.json().code;
    const id = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/suppliers/${id}`,
      payload: { code: "FOR-999999", legalName: "Nome atualizado" },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().code).toBe(code);
    expect(patched.json().legalName).toBe("Nome atualizado");

    await app.close();
  });

  it("exige razão social", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "POST", url: "/suppliers", payload: {} });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("normaliza CNPJ para somente dígitos", async () => {
    const app = buildTestApp();
    await app.ready();

    const digits = `33444555${Date.now().toString().slice(-6)}`;
    const masked = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
    const response = await createTestSupplier(app, {
      legalName: "Fornecedor com CNPJ",
      cnpj: masked,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().cnpj).toBe(digits);

    await app.close();
  });

  it("rejeita CNPJ com quantidade de dígitos inválida", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createTestSupplier(app, { cnpj: "123456" });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("não permite CNPJ duplicado", async () => {
    const app = buildTestApp();
    await app.ready();

    const cnpj = `11222333${Date.now().toString().slice(-6)}`;
    const first = await createTestSupplier(app, { cnpj });
    expect(first.statusCode).toBe(201);

    const second = await createTestSupplier(app, { cnpj });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("duplicate_cnpj");

    await app.close();
  });

  it("busca por código, razão social e CNPJ", async () => {
    const app = buildTestApp();
    await app.ready();

    const marker = `BuscavelFornecedor${Date.now()}`;
    const created = await createTestSupplier(app, { legalName: marker });
    const createdBody = created.json();

    const byCode = await app.inject({
      method: "GET",
      url: `/suppliers?search=${createdBody.code}`,
    });
    expect(
      byCode.json().suppliers.some((s: { id: string }) => s.id === createdBody.id),
    ).toBe(true);

    const byName = await app.inject({ method: "GET", url: `/suppliers?search=${marker}` });
    expect(
      byName.json().suppliers.some((s: { id: string }) => s.id === createdBody.id),
    ).toBe(true);

    await app.close();
  });

  it("filtra por status ativo", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestSupplier(app, { legalName: "Fornecedor filtro" });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/suppliers/${id}/deactivate` });

    const onlyInactive = await app.inject({
      method: "GET",
      url: "/suppliers?active=false&pageSize=100",
    });
    expect(
      onlyInactive.json().suppliers.some((s: { id: string }) => s.id === id),
    ).toBe(true);

    await app.close();
  });

  it("inativa sem excluir e permite reativar", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createTestSupplier(app, { legalName: "Fornecedor inativar" });
    const id = created.json().id;

    const deactivated = await app.inject({
      method: "POST",
      url: `/suppliers/${id}/deactivate`,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().active).toBe(false);

    const stillThere = await app.inject({ method: "GET", url: `/suppliers/${id}` });
    expect(stillThere.statusCode).toBe(200);

    const reactivated = await app.inject({
      method: "POST",
      url: `/suppliers/${id}/activate`,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().active).toBe(true);

    await app.close();
  });

  it("reduz a lista ao id citado — o link contextual depende disso", async () => {
    // Mesma regra do cliente: o lote cita o fornecedor pela identidade.
    const app = buildTestApp();
    await app.ready();

    const alvo = await createTestSupplier(app, { legalName: "Fornecedor alvo do link" });
    await createTestSupplier(app, { legalName: "Fornecedor que não deve aparecer" });
    const alvoId = alvo.json().id as string;

    const response = await app.inject({ method: "GET", url: `/suppliers?ids=${alvoId}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.suppliers).toHaveLength(1);
    expect(body.suppliers[0].id).toBe(alvoId);
  });
});
