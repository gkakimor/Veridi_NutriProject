import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { CustomerTaxProfile } from "@prisma/client";
import {
  CUSTOMER_TAX_PROFILES,
  CUSTOMER_TAX_PROFILE_LABELS,
  DEFAULT_CUSTOMER_TAX_PROFILE,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Perfil tributário do Cliente — CUSTOMER-TAX-PROFILE-01, PRODUCT_RULES §83.
 *
 * O perfil é CLASSIFICAÇÃO INFORMADA, não motor fiscal. O que estes casos
 * protegem é o contrato do campo — o default explícito, o enum inteiro, a
 * recusa de valor desconhecido antes do Prisma, o PATCH que só mexe quando
 * pede — e que ele não trava nada: o Projeto de um cliente "Não informado"
 * nasce igual ao de um cliente classificado.
 */

const fixtureCustomerIds: string[] = [];
const fixtureProjectIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProjectIds.length > 0) {
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function criarCliente(app: App, extra: Record<string, unknown> = {}) {
  const resposta = await app.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente Perfil ${marker()}`, ...extra },
  });
  if (resposta.statusCode === 201) fixtureCustomerIds.push(resposta.json().id);
  return resposta;
}

async function perfilLido(app: App, id: string): Promise<string> {
  const resposta = await app.inject({ method: "GET", url: `/customers/${id}` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json().taxProfile;
}

function alterar(app: App, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/customers/${id}`, payload });
}

const RECUSA = [{ path: "taxProfile", message: "Perfil tributário inválido" }];

describe("Perfil tributário — o contrato", () => {
  it("o enum do banco, a lista do contrato e os rótulos têm os mesmos seis valores", () => {
    expect(Object.values(CustomerTaxProfile)).toEqual([...CUSTOMER_TAX_PROFILES]);
    expect(CUSTOMER_TAX_PROFILE_LABELS).toEqual({
      NOT_INFORMED: "Não informado",
      MEI: "MEI",
      SIMPLES_NACIONAL: "Simples Nacional",
      LUCRO_PRESUMIDO: "Lucro Presumido",
      LUCRO_REAL: "Lucro Real",
      OTHER: "Outro",
    });
    expect(DEFAULT_CUSTOMER_TAX_PROFILE).toBe("NOT_INFORMED");
  });
});

describe("Perfil tributário — criação", () => {
  it("sem informar, o cliente nasce Não informado e continua válido", async () => {
    const app = buildTestApp();
    await app.ready();

    const criado = await criarCliente(app);

    expect(criado.statusCode, criado.body).toBe(201);
    expect(criado.json().taxProfile).toBe("NOT_INFORMED");
    expect(await perfilLido(app, criado.json().id)).toBe("NOT_INFORMED");

    await app.close();
  });

  it.each([...CUSTOMER_TAX_PROFILES])(
    "aceita %s explicitamente, grava e devolve no detalhe e na listagem",
    async (perfil) => {
      const app = buildTestApp();
      await app.ready();

      const criado = await criarCliente(app, { taxProfile: perfil });

      expect(criado.statusCode, criado.body).toBe(201);
      expect(criado.json().taxProfile).toBe(perfil);
      const id = criado.json().id as string;
      expect(await perfilLido(app, id)).toBe(perfil);
      const lista = await app.inject({ method: "GET", url: `/customers?ids=${id}` });
      expect(lista.json().customers[0].taxProfile).toBe(perfil);
      // Gravado de verdade, não só ecoado pela rota.
      const linha = await getPrisma().customer.findUniqueOrThrow({ where: { id } });
      expect(linha.taxProfile).toBe(perfil);

      await app.close();
    },
  );

  it.each<[string, unknown]>([
    ["valor desconhecido", "SIMPLES"],
    ["código em minúsculas", "simples_nacional"],
    ["o rótulo em vez do código", "Simples Nacional"],
    ["texto vazio", ""],
    ["null — não existe limpar", null],
    ["número", 3],
  ])("recusa %s com 400 de validação, sem chegar ao banco", async (_caso, valor) => {
    const app = buildTestApp();
    await app.ready();
    const legalName = `Cliente Perfil Recusado ${marker()}`;

    const resposta = await app.inject({
      method: "POST",
      url: "/customers",
      payload: { legalName, taxProfile: valor },
    });

    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toEqual({ error: "validation_error", issues: RECUSA });
    expect(await getPrisma().customer.count({ where: { legalName } })).toBe(0);

    await app.close();
  });
});

describe("Perfil tributário — alteração", () => {
  it("troca de perfil e volta a Não informado escolhendo o valor, sem null", async () => {
    const app = buildTestApp();
    await app.ready();
    const id = (await criarCliente(app)).json().id as string;

    for (const perfil of ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "NOT_INFORMED"]) {
      const resposta = await alterar(app, id, { taxProfile: perfil });
      expect(resposta.statusCode, resposta.body).toBe(200);
      expect(resposta.json().taxProfile).toBe(perfil);
      expect(await perfilLido(app, id)).toBe(perfil);
    }

    await app.close();
  });

  it("PATCH sem o campo não mexe no perfil gravado — nem ativar e inativar", async () => {
    const app = buildTestApp();
    await app.ready();
    const id = (await criarCliente(app, { taxProfile: "LUCRO_REAL" })).json().id as string;

    const renomeado = await alterar(app, id, { legalName: `Cliente Renomeado ${marker()}` });
    expect(renomeado.statusCode, renomeado.body).toBe(200);
    expect(renomeado.json().taxProfile).toBe("LUCRO_REAL");

    expect((await alterar(app, id, {})).json().taxProfile).toBe("LUCRO_REAL");
    await app.inject({ method: "POST", url: `/customers/${id}/deactivate` });
    await app.inject({ method: "POST", url: `/customers/${id}/activate` });
    expect(await perfilLido(app, id)).toBe("LUCRO_REAL");

    await app.close();
  });

  it("PATCH com valor inválido é recusado e o gravado fica", async () => {
    const app = buildTestApp();
    await app.ready();
    const id = (await criarCliente(app, { taxProfile: "MEI" })).json().id as string;

    for (const valor of ["LUCRO_FICTICIO", null]) {
      const resposta = await alterar(app, id, { taxProfile: valor });
      expect(resposta.statusCode, resposta.body).toBe(400);
      expect(resposta.json()).toEqual({ error: "validation_error", issues: RECUSA });
    }
    expect(await perfilLido(app, id)).toBe("MEI");

    await app.close();
  });
});

describe("Perfil tributário — clientes que já existiam", () => {
  it("a coluna é NOT NULL com default NOT_INFORMED — o que as linhas antigas receberam", async () => {
    const [coluna] = await getPrisma().$queryRaw<
      { is_nullable: string; column_default: string | null; udt_name: string }[]
    >`
      SELECT is_nullable, column_default, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'customers'
        AND column_name = 'taxProfile'`;

    expect(coluna?.is_nullable).toBe("NO");
    expect(coluna?.udt_name).toBe("CustomerTaxProfile");
    expect(coluna?.column_default ?? "").toMatch(/^'NOT_INFORMED'::/);
  });

  it("linha escrita sem conhecer a coluna é lida como Não informado", async () => {
    // SQL cru, como qualquer escritor anterior à capacidade: a coluna não
    // aparece no INSERT, e o banco completa.
    const id = randomUUID();
    await getPrisma().$executeRaw`
      INSERT INTO customers (id, code, "legalName", "updatedAt")
      VALUES (${id}, ${`CLI-LEGADO-${marker()}`}, ${"Cliente anterior ao perfil"}, NOW())`;
    fixtureCustomerIds.push(id);

    const app = buildTestApp();
    await app.ready();
    expect(await perfilLido(app, id)).toBe("NOT_INFORMED");
    await app.close();
  });

  it("o importador cria sem o campo, e o cliente importado nasce Não informado", async () => {
    // Mesmo formato de `scripts/veridi-import/pipeline.ts`: o `data` não
    // conhece o perfil, e a planilha não precisa ganhar coluna.
    const cliente = await getPrisma().customer.create({
      data: {
        code: `CLI-IMPORTADO-${marker()}`,
        legalName: "Cliente importado da planilha",
        externalCode: `EXT-${marker()}`,
        active: true,
      },
    });
    fixtureCustomerIds.push(cliente.id);

    expect(cliente.taxProfile).toBe("NOT_INFORMED");
  });
});

describe("Perfil tributário — não trava nada", () => {
  it.each(["NOT_INFORMED", "SIMPLES_NACIONAL"] as const)(
    "cliente %s entra num Projeto como qualquer outro",
    async (perfil) => {
      const app = buildTestApp();
      await app.ready();
      const criado = await criarCliente(app, perfil === "NOT_INFORMED" ? {} : { taxProfile: perfil });
      const cliente = criado.json();
      expect(cliente.taxProfile).toBe(perfil);

      const projeto = await app.inject({
        method: "POST",
        url: "/projects",
        payload: { customerId: cliente.id, name: `Projeto Perfil ${marker()}` },
      });

      expect(projeto.statusCode, projeto.body).toBe(201);
      fixtureProjectIds.push(projeto.json().id);
      expect(projeto.json().customerId).toBe(cliente.id);

      await app.close();
    },
  );

  it("a busca textual não passa a casar o perfil", async () => {
    const app = buildTestApp();
    await app.ready();
    const id = (await criarCliente(app, { taxProfile: "LUCRO_REAL" })).json().id as string;

    const busca = await app.inject({
      method: "GET",
      url: "/customers?search=LUCRO_REAL&pageSize=1000",
    });

    expect(busca.statusCode).toBe(200);
    expect(busca.json().customers.some((c: { id: string }) => c.id === id)).toBe(false);

    await app.close();
  });
});
