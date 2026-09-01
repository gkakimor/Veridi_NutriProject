import { afterEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createAuthenticatedUser,
} from "../../test-support/authenticated-app.js";
import { maskCnpj, uniqueCnpj, withCheckDigits } from "../../test-support/br-documents.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * E-mail, CNPJ (numérico e alfanumérico), telefone com DDD e autoria do
 * cadastro — pela rota, com sessão real.
 */

const createdCustomerIds: string[] = [];

afterEach(async () => {
  if (createdCustomerIds.length === 0) return;
  await getPrisma().customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  createdCustomerIds.length = 0;
});

type App = ReturnType<typeof buildTestApp>;

async function createCustomer(app: App, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/customers",
    payload: {
      legalName: `Cliente ${Date.now()}-${Math.random()}`,
      ...payload,
    },
  });
  if (response.statusCode === 201) createdCustomerIds.push(response.json().id);
  return response;
}

function issueFor(response: { json: () => { issues?: { path: string; message: string }[] } }, path: string) {
  return response.json().issues?.find((issue) => issue.path === path);
}

describe("Cliente — e-mail", () => {
  it("recusa e-mail sem formato válido", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createCustomer(app, { email: "contato@" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation_error");
    expect(issueFor(response, "email")?.message).toBe("E-mail inválido.");

    await app.close();
  });

  it("aceita e-mail válido e segue opcional quando vazio", async () => {
    const app = buildTestApp();
    await app.ready();

    const withEmail = await createCustomer(app, { email: " contato@veridi.com.br " });
    expect(withEmail.statusCode).toBe(201);
    expect(withEmail.json().email).toBe("contato@veridi.com.br");

    const withoutEmail = await createCustomer(app, {});
    expect(withoutEmail.statusCode).toBe(201);
    expect(withoutEmail.json().email).toBeNull();

    await app.close();
  });
});

describe("Cliente — CNPJ", () => {
  it("aceita o CNPJ numérico de sempre, formatado ou não", async () => {
    const app = buildTestApp();
    await app.ready();

    const digits = uniqueCnpj();
    const response = await createCustomer(app, { cnpj: maskCnpj(digits) });

    expect(response.statusCode).toBe(201);
    expect(response.json().cnpj).toBe(digits);

    await app.close();
  });

  it("recusa CNPJ numérico com dígito verificador errado", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createCustomer(app, { cnpj: "11222333000180" });

    expect(response.statusCode).toBe(400);
    expect(issueFor(response, "cnpj")?.message).toBe("CNPJ inválido");

    await app.close();
  });

  it("aceita o CNPJ alfanumérico e preserva as letras", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createCustomer(app, { cnpj: "00.000.000/e08g-12" });

    expect(response.statusCode).toBe(201);
    // Letras preservadas e em maiúsculas — nunca reduzidas a dígitos.
    expect(response.json().cnpj).toBe("00000000E08G12");

    await app.close();
  });

  it("recusa CNPJ alfanumérico com dígito verificador errado", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createCustomer(app, { cnpj: "00000000E08G13" });

    expect(response.statusCode).toBe(400);
    expect(issueFor(response, "cnpj")?.message).toBe("CNPJ inválido");

    await app.close();
  });

  it("recusa comprimento inválido sem falar em dígito verificador", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createCustomer(app, { cnpj: "123456" });

    expect(response.statusCode).toBe(400);
    expect(issueFor(response, "cnpj")?.message).toContain("14");

    await app.close();
  });

  it("busca por CNPJ alfanumérico continua encontrando o cliente", async () => {
    const app = buildTestApp();
    await app.ready();

    const alphanumeric = withCheckDigits("ZQ7788990001");
    const created = await createCustomer(app, {
      legalName: `Cliente alfanumérico ${Date.now()}`,
      cnpj: alphanumeric,
    });
    expect(created.statusCode).toBe(201);

    const found = await app.inject({
      method: "GET",
      url: `/customers?search=${alphanumeric}`,
    });

    expect(found.statusCode).toBe(200);
    expect(found.json().customers.map((c: { id: string }) => c.id)).toContain(
      created.json().id,
    );

    await app.close();
  });
});

describe("Cliente — telefone", () => {
  it("recusa telefone curto, sem DDD", async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await createCustomer(app, { phone: "123232" });

    expect(response.statusCode).toBe(400);
    expect(issueFor(response, "phone")?.message).toBe("Informe um telefone com DDD.");

    await app.close();
  });

  it("aceita fixo e celular com DDD, guardando só dígitos", async () => {
    const app = buildTestApp();
    await app.ready();

    const landline = await createCustomer(app, { phone: "(11) 3333-4444" });
    expect(landline.statusCode).toBe(201);
    expect(landline.json().phone).toBe("1133334444");

    const mobile = await createCustomer(app, { phone: "(11) 99999-8888" });
    expect(mobile.statusCode).toBe(201);
    expect(mobile.json().phone).toBe("11999998888");

    await app.close();
  });
});

describe("Cliente — autoria do cadastro", () => {
  it("registra quem criou e quem alterou por último", async () => {
    const app = buildTestApp();
    await app.ready();

    const creator = await createAuthenticatedUser("ADMIN");
    const created = await createCustomer(app, { legalName: "Cliente com autoria" });

    expect(created.statusCode).toBe(201);
    expect(created.json().createdByName).toBe(creator.user.name);
    expect(created.json().updatedByName).toBe(creator.user.name);

    await app.close();
  });

  it("alteração troca o autor da última alteração e preserva o da criação", async () => {
    const app = buildTestApp();
    await app.ready();

    const creator = await createAuthenticatedUser("ADMIN");
    const created = await createCustomer(app, { legalName: "Cliente editado" });
    const id = created.json().id;

    const editor = await createAuthenticatedUser("COMMERCIAL");
    const patched = await app.inject({
      method: "PATCH",
      url: `/customers/${id}`,
      headers: { cookie: editor.cookie },
      payload: { phone: "(11) 99999-8888" },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().createdByName).toBe(creator.user.name);
    expect(patched.json().updatedByName).toBe(editor.user.name);
    expect(editor.user.name).not.toBe(creator.user.name);

    await app.close();
  });

  it("visualizar não altera a autoria — GET não é alteração", async () => {
    const app = buildTestApp();
    await app.ready();

    const created = await createCustomer(app, { legalName: "Cliente só lido" });
    const id = created.json().id;
    const before = created.json();

    const viewer = await createAuthenticatedUser("VIEWER");
    await app.inject({
      method: "GET",
      url: `/customers/${id}`,
      headers: { cookie: viewer.cookie },
    });

    const after = await app.inject({ method: "GET", url: `/customers/${id}` });
    expect(after.json().updatedByName).toBe(before.updatedByName);
    expect(after.json().updatedAt).toBe(before.updatedAt);

    await app.close();
  });

  it("cliente anterior a esta capacidade fica sem autor, nunca atribuído a alguém", async () => {
    const app = buildTestApp();
    await app.ready();

    // Registro criado direto na base, como os que a migration encontrou.
    const legacy = await getPrisma().customer.create({
      data: {
        code: `CLI-LEG-${Date.now().toString().slice(-6)}`,
        legalName: "Cliente legado sem autoria",
      },
    });
    createdCustomerIds.push(legacy.id);

    const response = await app.inject({ method: "GET", url: `/customers/${legacy.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().createdByName).toBeNull();
    expect(response.json().updatedByName).toBeNull();

    await app.close();
  });
});
