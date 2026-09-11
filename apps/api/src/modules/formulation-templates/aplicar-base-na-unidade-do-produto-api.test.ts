import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Aplicar um Modelo preserva a grandeza física da base — TEMPLATE-APPLY-BASE-UOM-01.
 *
 * A Formulação lê a base na unidade do seu Item acabado. Aplicar copiava o
 * NÚMERO da base e deixava a unidade do Modelo para trás: "1 kg" num Produto
 * medido em `un` nascia "1 un", e num Produto em `g` nascia "1 g" — mil vezes
 * menos produto para a mesma receita. A regra: mesma unidade copia; mesma
 * dimensão converte, pelo fator do catálogo e em Decimal; dimensão diferente
 * recusa, e nada nasce. Componente por base (FIXED_BASIS) fala em proporção
 * da base e não muda; componente que conta por unidade acabada não tem como
 * atravessar a troca de unidade sem mudar de tamanho, e recusa também.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

/** Os fatores do seed (`prisma/seed.ts`): massa em g, volume em L, contagem em un. */
const CATALOGO = [
  { code: "mg", label: "Miligrama", dimension: "MASS" as const, toBaseFactor: "0.001" },
  { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
  { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
  { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  { code: "mL", label: "Mililitro", dimension: "VOLUME" as const, toBaseFactor: "0.001" },
  { code: "L", label: "Litro", dimension: "VOLUME" as const, toBaseFactor: "1" },
];

beforeAll(async () => {
  const prisma = getPrisma();
  for (const unit of CATALOGO) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  // Só o que este arquivo criou. Formulações citam versões de Modelo: saem antes.
  if (fixtureProductIds.length > 0) {
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureTemplateIds.length > 0) {
    await prisma.formulationTemplate.deleteMany({ where: { id: { in: fixtureTemplateIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function item(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode: string) {
  const m = marca();
  const criado = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "FINISHED_PRODUCT" ? "PA" : "MP"}-BASE-${m}`,
      name: `Base ${type} ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(criado.id);
  return criado;
}

/** Produto com Item acabado na unidade pedida, sem formulação nenhuma. */
async function produto(app: App, unitCode: string): Promise<string> {
  const acabado = await item("FINISHED_PRODUCT", unitCode);
  const resposta = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: await fixtureCustomerId(),
      name: `Produto Base ${marca()}`,
      finishedProductItemId: acabado.id,
    },
  });
  expect(resposta.statusCode, resposta.body).toBeLessThan(300);
  const criado = resposta.json();
  fixtureProductIds.push(criado.id);
  return criado.id as string;
}

/** Modelo ativo com a base pedida e 100 g de um insumo por base. */
async function modeloAtivo(
  app: App,
  base: { quantidade: string; unidade: string },
  basis?: "PER_FINISHED_UNIT",
): Promise<string> {
  const insumo = await item("RAW_MATERIAL", "g");
  const template = (
    await app.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: {
        name: `Modelo Base ${marca()}`,
        basisQuantity: base.quantidade,
        outputUnitCode: base.unidade,
      },
    })
  ).json();
  fixtureTemplateIds.push(template.id);
  const versao = template.draftVersion.id as string;
  const salvo = await app.inject({
    method: "PATCH",
    url: `/formulation-template-versions/${versao}`,
    payload: {
      components: [{ itemId: insumo.id, quantity: "100", unitCode: "g", ...(basis ? { basis } : {}) }],
    },
  });
  expect(salvo.statusCode, salvo.body).toBe(200);
  const ativa = await app.inject({
    method: "POST",
    url: `/formulation-template-versions/${versao}/activate`,
  });
  expect(ativa.statusCode, ativa.body).toBe(200);
  return versao;
}

function aplicar(app: App, productId: string, templateVersionId: string) {
  return app.inject({
    method: "POST",
    url: `/products/${productId}/formulation-versions/from-template`,
    payload: { formulationTemplateVersionId: templateVersionId },
  });
}

function formulacoes(productId: string) {
  return getPrisma().formulationVersion.findMany({
    where: { productId },
    include: { components: true },
    orderBy: { versionNumber: "asc" },
  });
}

async function comApp<T>(corpo: (app: App) => Promise<T>): Promise<T> {
  const app = buildTestApp("ADMIN");
  await app.ready();
  try {
    return await corpo(app);
  } finally {
    await app.close();
  }
}

describe("TEMPLATE-APPLY-BASE-UOM-01 — o catálogo que a conversão usa", () => {
  it("os fatores do banco são os do seed: massa em g, volume em L", async () => {
    const noBanco = await getPrisma().unitOfMeasure.findMany({
      where: { code: { in: CATALOGO.map((unit) => unit.code) } },
    });
    for (const unit of CATALOGO) {
      const gravada = noBanco.find((candidata) => candidata.code === unit.code);
      expect(gravada?.dimension, unit.code).toBe(unit.dimension);
      expect(gravada?.toBaseFactor.equals(unit.toBaseFactor), unit.code).toBe(true);
    }
  });
});

describe("TEMPLATE-APPLY-BASE-UOM-01 — a base chega com a mesma grandeza física", () => {
  it.each([
    ["mesma unidade", "1", "kg", "kg", "1"],
    ["kg → g", "1", "kg", "g", "1000"],
    ["g → kg", "1000", "g", "kg", "1"],
    ["L → mL", "1", "L", "mL", "1000"],
    ["mg → g", "500", "mg", "g", "0.5"],
    ["precisão decimal: 0,001 kg → g", "0.001", "kg", "g", "1"],
  ])("%s: %s %s num Produto em %s nasce %s", (_caso, quantidade, unidade, doProduto, esperado) =>
    comApp(async (app) => {
      const modelo = await modeloAtivo(app, { quantidade, unidade });
      const produtoId = await produto(app, doProduto);

      const resposta = await aplicar(app, produtoId, modelo);

      expect(resposta.statusCode, resposta.body).toBeLessThan(300);
      const versoes = await formulacoes(produtoId);
      expect(versoes).toHaveLength(1);
      const [versao] = versoes;
      expect(versao?.outputUnitCode).toBe(doProduto);
      expect(versao?.basisQuantity.toString()).toBe(esperado);
      // Componente por base não muda: 100 g por base, na base convertida.
      expect(
        versao?.components.map((c) => `${c.quantity.toString()} ${c.unitCode} ${c.basis}`),
      ).toEqual(["100 g FIXED_BASIS"]);
    }),
  );

  it("o rascunho vazio do Produto também recebe a base convertida", () =>
    comApp(async (app) => {
      const modelo = await modeloAtivo(app, { quantidade: "1", unidade: "kg" });
      const produtoId = await produto(app, "g");
      const v1 = await app.inject({
        method: "POST",
        url: `/products/${produtoId}/formulation-versions`,
        payload: {},
      });
      expect(v1.statusCode, v1.body).toBe(201);

      const resposta = await aplicar(app, produtoId, modelo);

      expect(resposta.statusCode, resposta.body).toBeLessThan(300);
      const versoes = await formulacoes(produtoId);
      expect(versoes.map((versao) => versao.id)).toEqual([v1.json().id]);
      expect(versoes[0]?.basisQuantity.toString()).toBe("1000");
    }),
  );
});

describe("TEMPLATE-APPLY-BASE-UOM-01 — dimensões diferentes: recusa, e nada nasce", () => {
  it.each([
    ["kg", "un"],
    ["kg", "L"],
    ["L", "un"],
    ["mL", "g"],
  ])("base em %s num Produto em %s: 409 com o motivo", (unidade, doProduto) =>
    comApp(async (app) => {
      const modelo = await modeloAtivo(app, { quantidade: "1", unidade });
      const produtoId = await produto(app, doProduto);

      const resposta = await aplicar(app, produtoId, modelo);

      expect(resposta.statusCode, resposta.body).toBe(409);
      expect(resposta.json().message).toBe(
        `A unidade da base do Modelo (${unidade}) não é compatível com a unidade do Produto (${doProduto}).`,
      );
      expect(await formulacoes(produtoId)).toHaveLength(0);
    }),
  );

  it("no rascunho vazio, a recusa o deixa exatamente como estava", () =>
    comApp(async (app) => {
      const modelo = await modeloAtivo(app, { quantidade: "1", unidade: "kg" });
      const produtoId = await produto(app, "un");
      const v1 = (
        await app.inject({
          method: "POST",
          url: `/products/${produtoId}/formulation-versions`,
          payload: {},
        })
      ).json();
      const antes = await formulacoes(produtoId);

      const resposta = await aplicar(app, produtoId, modelo);

      expect(resposta.statusCode, resposta.body).toBe(409);
      const depois = await formulacoes(produtoId);
      expect(depois.map((versao) => versao.id)).toEqual([v1.id]);
      expect(depois[0]?.components).toHaveLength(0);
      expect(depois[0]?.basisQuantity.toString()).toBe(antes[0]?.basisQuantity.toString());
      expect(depois[0]?.originTemplateVersionId).toBeNull();
    }),
  );
});

describe("TEMPLATE-APPLY-BASE-UOM-01 — o que conta por unidade acabada não atravessa a troca de unidade", () => {
  it("base em kg com componente por unidade acabada, num Produto em g: 409, e nada nasce", () =>
    comApp(async (app) => {
      const modelo = await modeloAtivo(app, { quantidade: "1", unidade: "kg" }, "PER_FINISHED_UNIT");
      const produtoId = await produto(app, "g");

      const resposta = await aplicar(app, produtoId, modelo);

      expect(resposta.statusCode, resposta.body).toBe(409);
      expect(resposta.json().message).toContain("unidade acabada");
      expect(await formulacoes(produtoId)).toHaveLength(0);
    }),
  );

  it("o mesmo Modelo num Produto em kg copia: a unidade é a mesma", () =>
    comApp(async (app) => {
      const modelo = await modeloAtivo(app, { quantidade: "1", unidade: "kg" }, "PER_FINISHED_UNIT");
      const produtoId = await produto(app, "kg");

      const resposta = await aplicar(app, produtoId, modelo);

      expect(resposta.statusCode, resposta.body).toBeLessThan(300);
      const [versao] = await formulacoes(produtoId);
      expect(versao?.basisQuantity.toString()).toBe("1");
      expect(versao?.components.map((c) => c.basis)).toEqual(["PER_FINISHED_UNIT"]);
    }),
  );
});

describe("TEMPLATE-APPLY-BASE-UOM-01 — precisão: o que a base não guarda, não entra", () => {
  it("0,000000000001 g num Produto em kg passaria de 12 casas: 409, e nada nasce", () =>
    comApp(async (app) => {
      const modelo = await modeloAtivo(app, { quantidade: "0.000000000001", unidade: "g" });
      const produtoId = await produto(app, "kg");

      const resposta = await aplicar(app, produtoId, modelo);

      expect(resposta.statusCode, resposta.body).toBe(409);
      expect(await formulacoes(produtoId)).toHaveLength(0);
    }),
  );
});
