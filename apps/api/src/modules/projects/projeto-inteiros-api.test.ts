import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Os inteiros do Projeto na API — PROJECT-INT-FIELDS-01.
 *
 * O defeito é da tela: "Doses por embalagem" e "Vida útil (meses)" saíam do
 * formulário por `Number(texto)`, `abc` virava `NaN`, o JSON escrevia `null`, e
 * a API recebia um pedido LEGÍTIMO de limpar o campo. Estes casos provam o
 * outro lado da fronteira, na criação e na edição: o que não é inteiro maior
 * que zero é recusado com 400 — nada nasce, e o gravado fica —, e `null`
 * continua sendo o jeito legítimo de dizer "não informado".
 */

const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

afterAll(async () => {
  if (fixtureCustomerIds.length === 0) return;
  const prisma = getPrisma();
  const projetos = await prisma.project.findMany({
    where: { customerId: { in: fixtureCustomerIds } },
    select: { id: true },
  });
  const ids = projetos.map((projeto) => projeto.id);
  if (ids.length > 0) {
    await prisma.projectStatusHistory.deleteMany({ where: { projectId: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function cliente(): Promise<string> {
  const m = marca();
  const customer = await getPrisma().customer.create({
    data: { code: `CLI-PINT-${m}`, legalName: `Cliente Inteiros do Projeto ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer.id;
}

function criar(app: App, customerId: string, extra: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/projects",
    payload: {
      name: `Projeto Inteiros ${marca()}`,
      customerId,
      entryDate: new Date().toISOString(),
      ...extra,
    },
  });
}

/** Um projeto com doses 60 e vida útil 24 gravados. */
async function projetoGravado(app: App): Promise<string> {
  const resposta = await criar(app, await cliente(), { dosesPerPackage: 60, shelfLifeMonths: 24 });
  expect(resposta.statusCode, resposta.body).toBe(201);
  return resposta.json().id as string;
}

async function inteirosGravados(app: App, projectId: string) {
  const projeto = (await app.inject({ method: "GET", url: `/projects/${projectId}` })).json();
  return { dosesPerPackage: projeto.dosesPerPackage, shelfLifeMonths: projeto.shelfLifeMonths };
}

function editar(app: App, projectId: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/projects/${projectId}`, payload });
}

const CAMPOS = ["dosesPerPackage", "shelfLifeMonths"] as const;
/** Não é inteiro maior que zero — em texto ou em número. */
const RECUSADOS: unknown[] = ["abc", "30abc", "60,5", "60.5", "-1", "0", 60.5, 0, -1];
const casos = CAMPOS.flatMap((campo) => RECUSADOS.map((valor) => [campo, valor] as const));

describe("PROJECT-INT-FIELDS-01 — a API recusa o que não é inteiro válido, e não apaga nada", () => {
  it.each(casos)("edição: %s = %j é 400, e o gravado fica", async (campo, valor) => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const projectId = await projetoGravado(app);

    const resposta = await editar(app, projectId, { [campo]: valor });

    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(await inteirosGravados(app, projectId)).toEqual({
      dosesPerPackage: 60,
      shelfLifeMonths: 24,
    });

    await app.close();
  });

  it.each(casos)("criação: %s = %j é 400, e nenhum projeto nasce", async (campo, valor) => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const customerId = await cliente();

    const resposta = await criar(app, customerId, { [campo]: valor });

    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(await getPrisma().project.count({ where: { customerId } })).toBe(0);

    await app.close();
  });

  it("null limpa de propósito: é o jeito legítimo de dizer 'não informado'", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const projectId = await projetoGravado(app);

    const resposta = await editar(app, projectId, { dosesPerPackage: null, shelfLifeMonths: null });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await inteirosGravados(app, projectId)).toEqual({
      dosesPerPackage: null,
      shelfLifeMonths: null,
    });

    await app.close();
  });

  it("criar sem os dois é permitido: o domínio aceita não informado", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const resposta = await criar(app, await cliente(), { dosesPerPackage: null });

    expect(resposta.statusCode, resposta.body).toBe(201);
    expect(await inteirosGravados(app, resposta.json().id)).toEqual({
      dosesPerPackage: null,
      shelfLifeMonths: null,
    });

    await app.close();
  });

  it("inteiro válido grava, em número ou em texto", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const projectId = await projetoGravado(app);

    const resposta = await editar(app, projectId, { dosesPerPackage: 90, shelfLifeMonths: "36" });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await inteirosGravados(app, projectId)).toEqual({
      dosesPerPackage: 90,
      shelfLifeMonths: 36,
    });

    await app.close();
  });
});

describe("API-INT-COERCION-01 (aberto) — o que a API ainda aceita, e a tela não manda", () => {
  /*
   * `optionalPositiveInt` lê com `Number()`, e estas escritas passam como
   * inteiro. O achado está registrado e não se corrige aqui. O teste deixa a
   * interação à vista — a tela recusa todas elas antes do pedido
   * (PROJECT-INT-FIELDS-01) — e precisa mudar junto quando o achado fechar.
   */
  it.each([
    ["1e2", 100],
    ["0x1E", 30],
    ["+1", 1],
    ["1.0", 1],
  ] as const)("%j ainda grava %i", async (texto, gravado) => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const projectId = await projetoGravado(app);

    const resposta = await editar(app, projectId, { dosesPerPackage: texto });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect((await inteirosGravados(app, projectId)).dosesPerPackage).toBe(gravado);

    await app.close();
  });
});
