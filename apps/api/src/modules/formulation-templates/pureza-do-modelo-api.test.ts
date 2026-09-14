import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * FORMULATION-TEMPLATE-PURITY-RANGE-01 — a pureza do Modelo tem a MESMA
 * validade da pureza da Formulação.
 *
 * Regra canônica (PRODUCT_RULES, PREC-MIG-C; `optionalPurityPercent` do
 * cadastro do Item e do componente da Formulação): `0 < x <= 100`, até seis
 * casas, vazio/null = desconhecida. O Modelo validava só as casas: aceitava 0 e
 * acima de 100, e a pureza guardada nele era recusada na Formulação criada a
 * partir dele. Cada entrada abaixo vai aos DOIS servidores e precisa sair com o
 * mesmo status e, quando grava, o mesmo valor.
 */

const D = (value: string | number) => new Prisma.Decimal(value);

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let app: App;
let itemId: string;
let modeloVersaoId: string;
let formulacaoVersaoId: string;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode: string) {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-PMO-${m}`,
      name: `Item Pureza do Modelo ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units = [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  app = buildTestApp("ADMIN");
  await app.ready();
  itemId = (await createItem("RAW_MATERIAL", "kg")).id;

  const acabado = await createItem("FINISHED_PRODUCT", "un");
  const produto = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: await fixtureCustomerId(),
      name: `Produto Pureza do Modelo ${marker()}`,
      finishedProductItemId: acabado.id,
    },
  });
  expect(produto.statusCode, produto.body).toBe(201);
  fixtureProductIds.push(produto.json().id);
  const versao = await app.inject({
    method: "POST",
    url: `/products/${produto.json().id}/formulation-versions`,
    payload: {},
  });
  expect(versao.statusCode, versao.body).toBe(201);
  formulacaoVersaoId = versao.json().id;

  const modelo = await app.inject({
    method: "POST",
    url: "/formulation-templates",
    payload: { name: `Modelo Pureza ${marker()}`, basisQuantity: "1", outputUnitCode: "un" },
  });
  expect(modelo.statusCode, modelo.body).toBeLessThan(300);
  fixtureTemplateIds.push(modelo.json().id);
  modeloVersaoId = modelo.json().draftVersion.id;
});

afterAll(async () => {
  await app?.close();
  const prisma = getPrisma();
  if (fixtureProductIds.length > 0) {
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

function gravar(url: string, pureza: unknown) {
  return app.inject({
    method: "PATCH",
    url,
    payload: { components: [{ itemId, quantity: "100", unitCode: "g", purityPercentApplied: pureza }] },
  });
}

/** [entrada, grava?, valor gravado (null = desconhecida)] */
const CASOS: [unknown, boolean, string | null][] = [
  ["0", false, null],
  [0, false, null],
  ["0.000001", true, "0.000001"],
  ["98", true, "98"],
  ["99.999999", true, "99.999999"],
  ["100", true, "100"],
  [100, true, "100"],
  ["100.000001", false, null],
  ["100.5", false, null],
  ["150", false, null],
  [150, false, null],
  ["99.9999999", false, null], // sete casas: o banco arredondaria em silêncio
  ["-1", false, null],
  ["98,5", false, null],
  ["abc", false, null],
  [null, true, null],
  ["", true, null],
];

describe("Pureza: Modelo de Formulação × Formulação", () => {
  it.each(CASOS)("%j — grava: %s (%j)", async (entrada, grava, gravado) => {
    const noModelo = await gravar(`/formulation-template-versions/${modeloVersaoId}`, entrada);
    const naFormulacao = await gravar(`/formulation-versions/${formulacaoVersaoId}`, entrada);

    const status = grava ? 200 : 400;
    expect(noModelo.statusCode, `Modelo: ${noModelo.body}`).toBe(status);
    expect(naFormulacao.statusCode, `Formulação: ${naFormulacao.body}`).toBe(status);
    if (!grava) return;

    for (const resposta of [noModelo, naFormulacao]) {
      const pureza = resposta.json().components[0].purityPercentApplied as string | null;
      if (gravado === null) expect(pureza).toBeNull();
      else expect(D(pureza!).equals(D(gravado)), `${pureza} ≠ ${gravado}`).toBe(true);
    }
  });

  it("recusa no Modelo não apaga a pureza que já estava gravada", async () => {
    expect((await gravar(`/formulation-template-versions/${modeloVersaoId}`, "98")).statusCode).toBe(200);
    expect((await gravar(`/formulation-template-versions/${modeloVersaoId}`, "150")).statusCode).toBe(400);
    const componentes = await getPrisma().formulationTemplateComponent.findMany({
      where: { formulationTemplateVersionId: modeloVersaoId },
    });
    expect(componentes).toHaveLength(1);
    expect(componentes[0]!.purityPercentApplied!.equals(D("98"))).toBe(true);
  });
});
