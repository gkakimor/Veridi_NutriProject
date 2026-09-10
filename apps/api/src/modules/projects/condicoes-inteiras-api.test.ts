import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Os inteiros das condições comerciais na API — QUOTE-INT-FIELDS-01.
 *
 * O defeito era da tela: `Number("abc")` virava `NaN`, o JSON escrevia `null`, e
 * a API recebia um pedido LEGÍTIMO de limpar o prazo. Estes casos provam o
 * outro lado da fronteira: texto que não é inteiro, ou inteiro fora dos
 * limites, é recusado com 400 e não toca o valor gravado — e `null` continua
 * sendo o jeito legítimo de dizer "não informado".
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProjectIds.length > 0) {
    await prisma.quoteLine.deleteMany({
      where: { quoteVersion: { projectId: { in: fixtureProjectIds } } },
    });
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectProduct.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    const produtos = await prisma.product.findMany({
      where: { id: { in: fixtureProductIds } },
      select: { finishedProductItemId: true },
    });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
    const itens = produtos
      .map((produto) => produto.finishedProductItemId)
      .filter((id): id is string => id !== null);
    if (itens.length > 0) await prisma.item.deleteMany({ where: { id: { in: itens } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** Um rascunho parcelado com os três inteiros gravados: 30 dias, 3 parcelas, 30 dias. */
async function rascunhoParcelado(app: App) {
  const m = marca();
  const customer = await getPrisma().customer.create({
    data: { code: `CLI-INT-${m}`, legalName: `Cliente Inteiros ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: `Projeto Inteiros ${m}`, customerId: customer.id, entryDate: new Date().toISOString() },
    })
  ).json();
  fixtureProjectIds.push(project.id);
  const quote = (
    await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
  ).json();

  const gravado = await app.inject({
    method: "PATCH",
    url: `/quote-versions/${quote.id}`,
    payload: {
      leadTimeDays: 30,
      paymentMethod: "INSTALLMENTS",
      installmentCount: 3,
      installmentIntervalDays: 30,
    },
  });
  expect(gravado.statusCode, gravado.body).toBe(200);
  return quote.id as string;
}

async function inteirosGravados(app: App, quoteId: string) {
  const quote = (await app.inject({ method: "GET", url: `/quote-versions/${quoteId}` })).json();
  return {
    leadTimeDays: quote.leadTimeDays,
    installmentCount: quote.installmentCount,
    installmentIntervalDays: quote.installmentIntervalDays,
  };
}

const CAMPOS = ["leadTimeDays", "installmentCount", "installmentIntervalDays"] as const;
/** Não é inteiro maior que zero — em texto ou em número. */
const RECUSADOS: unknown[] = ["abc", "30abc", "30,5", "30.5", "-1", "0", 30.5, 0, -1];

describe("QUOTE-INT-FIELDS-01 — a API recusa o que não é inteiro válido, e não apaga nada", () => {
  it.each(CAMPOS.flatMap((campo) => RECUSADOS.map((valor) => [campo, valor] as const)))(
    "%s = %j: 400, e o gravado fica",
    async (campo, valor) => {
      const app = buildTestApp("COMMERCIAL");
      await app.ready();
      const quoteId = await rascunhoParcelado(app);
      const antes = await inteirosGravados(app, quoteId);

      const resposta = await app.inject({
        method: "PATCH",
        url: `/quote-versions/${quoteId}`,
        payload: { [campo]: valor },
      });

      expect(resposta.statusCode, resposta.body).toBe(400);
      expect(await inteirosGravados(app, quoteId)).toEqual(antes);

      await app.close();
    },
  );

  it.each([
    ["installmentCount", 121],
    ["installmentIntervalDays", 366],
  ] as const)("%s acima do máximo (%i): 400, e o gravado fica", async (campo, valor) => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const quoteId = await rascunhoParcelado(app);
    const antes = await inteirosGravados(app, quoteId);

    const resposta = await app.inject({
      method: "PATCH",
      url: `/quote-versions/${quoteId}`,
      payload: { [campo]: valor },
    });

    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(await inteirosGravados(app, quoteId)).toEqual(antes);

    await app.close();
  });

  it("null continua sendo o jeito legítimo de dizer 'não informado'", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const quoteId = await rascunhoParcelado(app);

    const resposta = await app.inject({
      method: "PATCH",
      url: `/quote-versions/${quoteId}`,
      payload: { leadTimeDays: null },
    });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect((await inteirosGravados(app, quoteId)).leadTimeDays).toBeNull();

    await app.close();
  });

  it("inteiro válido grava, em número ou em texto", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const quoteId = await rascunhoParcelado(app);

    expect(
      (await app.inject({ method: "PATCH", url: `/quote-versions/${quoteId}`, payload: { leadTimeDays: 45 } }))
        .statusCode,
    ).toBe(200);
    expect((await inteirosGravados(app, quoteId)).leadTimeDays).toBe(45);

    expect(
      (await app.inject({ method: "PATCH", url: `/quote-versions/${quoteId}`, payload: { installmentCount: "4" } }))
        .statusCode,
    ).toBe(200);
    expect((await inteirosGravados(app, quoteId)).installmentCount).toBe(4);

    await app.close();
  });
});
