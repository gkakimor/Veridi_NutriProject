import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * FORMULATION-ADJUSTMENTS-UX-01 — o Modelo guarda a MESMA intenção física do
 * componente da Formulação (§52).
 *
 * O banco do Modelo já tinha modo e marcas desde o PREC-MIG-C, mas a API não
 * os recebia, não os devolvia, não os copiava entre versões e "salvar como
 * Modelo" os perdia: todo Modelo aplicado virava física informada. O que fica
 * provado, com número:
 *
 *   - física informada: a quantidade digitada É a física — pureza e overage
 *     são registro, mesmo que alguém mande marca ligada;
 *   - calculada: só os ajustes marcados entram, pelo motor canônico;
 *   - null continua null e zero continua zero;
 *   - aplicar copia tudo como SNAPSHOT — mudar o Modelo depois não muda a
 *     Formulação criada;
 *   - Modelo sem os campos novos aplica exatamente como antes;
 *   - versão ativa não se edita, e a nova versão leva a configuração;
 *   - a regra de unidade da base (TEMPLATE-APPLY-BASE-UOM-01) não regrediu.
 */

/** Conta independente, em Decimal — nunca Number (§59). */
const D = (value: string | number) => new Prisma.Decimal(value);

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

interface ComponenteDoModelo {
  itemId: string;
  quantity: string;
  unitCode: string;
  quantityMode?: "PHYSICAL_DIRECT" | "THEORETICAL_WITH_ADJUSTMENTS";
  purityPercentApplied?: string | null;
  overagePercent?: string | null;
  applyPurityAdjustment?: boolean;
  applyOverageAdjustment?: boolean;
}

interface ComponenteDaFormulacao {
  quantity: string;
  quantityMode: string;
  purityPercentApplied: string | null;
  overagePercent: string | null;
  applyPurityAdjustment: boolean;
  applyOverageAdjustment: boolean;
  theoreticalPerUnit: string | null;
  physicalPerUnit: string | null;
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
});

afterAll(async () => {
  const prisma = getPrisma();
  // Só o que ESTE arquivo criou: o banco é o mesmo do app local.
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

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode: string) {
  const m = marker();
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-AJM-${m}`,
      name: `Item Ajustes do Modelo ${m}`,
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

/** Produto com item acabado próprio e a V1 em rascunho, vazia. */
async function createProduct(app: App, unidadeDoAcabado = "un") {
  const acabado = await createItem("FINISHED_PRODUCT", unidadeDoAcabado);
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `Produto Ajustes do Modelo ${marker()}`,
        finishedProductItemId: acabado.id,
      },
    })
  ).json();
  fixtureProductIds.push(product.id);
  const v1 = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions`,
    payload: {},
  });
  expect(v1.statusCode, v1.body).toBe(201);
  return product as { id: string };
}

/** Modelo em rascunho com os componentes dados; devolve a resposta da gravação. */
async function criarModelo(
  app: App,
  componentes: ComponenteDoModelo[],
  base: { basisQuantity: string; outputUnitCode: string } = { basisQuantity: "1", outputUnitCode: "un" },
) {
  const template = (
    await app.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: `Modelo Ajustes ${marker()}`, ...base },
    })
  ).json();
  fixtureTemplateIds.push(template.id);
  const draftId = template.draftVersion.id as string;
  const salvo = await app.inject({
    method: "PATCH",
    url: `/formulation-template-versions/${draftId}`,
    payload: { components: componentes },
  });
  return { draftId, salvo };
}

async function ativar(app: App, versionId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/formulation-template-versions/${versionId}/activate`,
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json();
}

async function aplicar(app: App, templateVersionId: string, unidadeDoAcabado = "un") {
  const product = await createProduct(app, unidadeDoAcabado);
  const resposta = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions/from-template`,
    payload: { formulationTemplateVersionId: templateVersionId },
  });
  expect(resposta.statusCode, resposta.body).toBeLessThan(300);
  return { product, formulacao: resposta.json() as { id: string; basisQuantity: string; components: ComponenteDaFormulacao[] } };
}

/** 100 g por unidade de um item em kg: 0,1 kg teórico por unidade acabada. */
const TEORICO = D("0.1");

function fisicoIgual(valor: string | null, esperado: Prisma.Decimal) {
  expect(valor, "físico por unidade ausente").not.toBeNull();
  expect(
    D(valor!).toDecimalPlaces(9).equals(esperado.toDecimalPlaces(9)),
    `físico ${valor} ≠ esperado ${esperado.toString()}`,
  ).toBe(true);
}

describe("Modelo com a mesma intenção física da Formulação (§52)", () => {
  it("1 · física informada sem ajustes: o Modelo guarda o padrão explícito", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    const { salvo } = await criarModelo(app, [{ itemId: insumo.id, quantity: "100", unitCode: "g" }]);
    expect(salvo.statusCode, salvo.body).toBe(200);
    const [linha] = salvo.json().components;
    expect(linha.quantityMode).toBe("PHYSICAL_DIRECT");
    expect(linha.applyPurityAdjustment).toBe(false);
    expect(linha.applyOverageAdjustment).toBe(false);
    expect(linha.purityPercentApplied).toBeNull();
    expect(linha.overagePercent).toBeNull();
    await app.close();
  });

  it("2 e 3 · física informada com pureza e overage: registro, nunca conta — nem com marca ligada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    const { draftId, salvo } = await criarModelo(app, [
      {
        itemId: insumo.id,
        quantity: "100",
        unitCode: "g",
        quantityMode: "PHYSICAL_DIRECT",
        purityPercentApplied: "98",
        overagePercent: "2",
        // Marca ligada sob física direta é registro que mente: não se grava.
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
    ]);
    expect(salvo.statusCode, salvo.body).toBe(200);
    const [linha] = salvo.json().components;
    expect(linha.quantityMode).toBe("PHYSICAL_DIRECT");
    expect(linha.applyPurityAdjustment).toBe(false);
    expect(linha.applyOverageAdjustment).toBe(false);
    expect(D(linha.purityPercentApplied).equals(98)).toBe(true);
    expect(D(linha.overagePercent).equals(2)).toBe(true);

    await ativar(app, draftId);
    const { formulacao } = await aplicar(app, draftId);
    const [componente] = formulacao.components;
    expect(componente!.quantity).toBe("100");
    expect(componente!.quantityMode).toBe("PHYSICAL_DIRECT");
    expect(D(componente!.purityPercentApplied!).equals(98)).toBe(true);
    // A quantidade digitada JÁ é a física: 100 g continuam 0,1 kg.
    fisicoIgual(componente!.physicalPerUnit, TEORICO);
    fisicoIgual(componente!.theoreticalPerUnit, TEORICO);
    await app.close();
  });

  it.each([
    ["4 · pureza aplicada", { applyPurityAdjustment: true, applyOverageAdjustment: false }, TEORICO.dividedBy(D("0.98"))],
    ["5 · overage aplicado", { applyPurityAdjustment: false, applyOverageAdjustment: true }, TEORICO.times(D("1.02"))],
    ["6 · os dois", { applyPurityAdjustment: true, applyOverageAdjustment: true }, TEORICO.dividedBy(D("0.98")).times(D("1.02"))],
    ["7 · marcas desligadas: nada entra", { applyPurityAdjustment: false, applyOverageAdjustment: false }, TEORICO],
  ])("calculada — %s, e aplicar copia tudo (10)", async (_caso, marcas, esperado) => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    const { draftId, salvo } = await criarModelo(app, [
      {
        itemId: insumo.id,
        quantity: "100",
        unitCode: "g",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        purityPercentApplied: "98",
        overagePercent: "2",
        ...marcas,
      },
    ]);
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect(salvo.json().components[0]).toMatchObject({
      quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
      ...marcas,
    });

    await ativar(app, draftId);
    const { formulacao } = await aplicar(app, draftId);
    const [componente] = formulacao.components;
    expect(componente).toMatchObject({ quantity: "100", quantityMode: "THEORETICAL_WITH_ADJUSTMENTS", ...marcas });
    expect(D(componente!.purityPercentApplied!).equals(98)).toBe(true);
    expect(D(componente!.overagePercent!).equals(2)).toBe(true);
    fisicoIgual(componente!.theoreticalPerUnit, TEORICO);
    fisicoIgual(componente!.physicalPerUnit, esperado);
    await app.close();
  });

  it("8 e 9 · null continua null e zero continua zero — no Modelo e na Formulação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    const { draftId, salvo } = await criarModelo(app, [
      {
        itemId: insumo.id,
        quantity: "100",
        unitCode: "g",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        purityPercentApplied: null,
        overagePercent: "0",
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
    ]);
    expect(salvo.statusCode, salvo.body).toBe(200);
    const [linha] = salvo.json().components;
    expect(linha.purityPercentApplied).toBeNull();
    expect(D(linha.overagePercent).equals(0)).toBe(true);

    await ativar(app, draftId);
    const { formulacao } = await aplicar(app, draftId);
    const [componente] = formulacao.components;
    expect(componente!.purityPercentApplied).toBeNull();
    expect(D(componente!.overagePercent!).equals(0)).toBe(true);
    // Pureza ausente não corrige (nunca 100% nem 0%); overage 0% multiplica por 1.
    fisicoIgual(componente!.physicalPerUnit, TEORICO);
    await app.close();
  });

  it("11 · mudar o Modelo depois não muda a Formulação criada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    const { draftId } = await criarModelo(app, [
      {
        itemId: insumo.id,
        quantity: "100",
        unitCode: "g",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        purityPercentApplied: "98",
        applyPurityAdjustment: true,
      },
    ]);
    await ativar(app, draftId);
    const { formulacao } = await aplicar(app, draftId);

    const v2 = (
      await app.inject({ method: "POST", url: `/formulation-template-versions/${draftId}/new-version` })
    ).json();
    const mudado = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${v2.id}`,
      payload: {
        components: [
          { itemId: insumo.id, quantity: "100", unitCode: "g", quantityMode: "PHYSICAL_DIRECT", purityPercentApplied: "90" },
        ],
      },
    });
    expect(mudado.statusCode, mudado.body).toBe(200);
    await ativar(app, v2.id);

    const depois = (
      await app.inject({ method: "GET", url: `/formulation-versions/${formulacao.id}` })
    ).json();
    const [componente] = depois.components;
    expect(componente.quantityMode).toBe("THEORETICAL_WITH_ADJUSTMENTS");
    expect(componente.applyPurityAdjustment).toBe(true);
    expect(D(componente.purityPercentApplied).equals(98)).toBe(true);
    fisicoIgual(componente.physicalPerUnit, TEORICO.dividedBy(D("0.98")));
    await app.close();
  });

  it("12 · Modelo sem os campos novos aplica exatamente como antes — pureza registrada não passa a valer", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    // O payload de antes desta capability: pureza e overage, sem modo nem marca.
    const { draftId, salvo } = await criarModelo(app, [
      { itemId: insumo.id, quantity: "100", unitCode: "g", purityPercentApplied: "98", overagePercent: "2" },
    ]);
    expect(salvo.statusCode, salvo.body).toBe(200);
    await ativar(app, draftId);

    const { formulacao } = await aplicar(app, draftId);
    const [componente] = formulacao.components;
    expect(componente).toMatchObject({
      quantityMode: "PHYSICAL_DIRECT",
      applyPurityAdjustment: false,
      applyOverageAdjustment: false,
    });
    fisicoIgual(componente!.physicalPerUnit, TEORICO);
    await app.close();
  });

  it("13 · versão ativa não se edita; a nova versão leva modo e marcas", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    const { draftId } = await criarModelo(app, [
      {
        itemId: insumo.id,
        quantity: "100",
        unitCode: "g",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        overagePercent: "2",
        applyOverageAdjustment: true,
      },
    ]);
    await ativar(app, draftId);

    const recusado = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${draftId}`,
      payload: {
        components: [{ itemId: insumo.id, quantity: "100", unitCode: "g", quantityMode: "PHYSICAL_DIRECT" }],
      },
    });
    expect(recusado.statusCode, recusado.body).toBe(409);
    const ativa = (
      await app.inject({ method: "GET", url: `/formulation-template-versions/${draftId}` })
    ).json();
    expect(ativa.components[0].quantityMode).toBe("THEORETICAL_WITH_ADJUSTMENTS");

    const v2 = await app.inject({
      method: "POST",
      url: `/formulation-template-versions/${draftId}/new-version`,
    });
    expect(v2.statusCode, v2.body).toBeLessThan(300);
    expect(v2.json().components[0]).toMatchObject({
      quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
      applyPurityAdjustment: false,
      applyOverageAdjustment: true,
    });
    await app.close();
  });

  it("salvar a Formulação como Modelo leva modo e marcas junto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    const { draftId } = await criarModelo(app, [
      {
        itemId: insumo.id,
        quantity: "100",
        unitCode: "g",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        purityPercentApplied: "98",
        applyPurityAdjustment: true,
      },
    ]);
    await ativar(app, draftId);
    const { formulacao } = await aplicar(app, draftId);

    const salvo = await app.inject({
      method: "POST",
      url: `/formulation-versions/${formulacao.id}/save-as-template`,
      payload: { name: `Modelo da formulação ${marker()}` },
    });
    expect(salvo.statusCode, salvo.body).toBeLessThan(300);
    const novo = salvo.json();
    fixtureTemplateIds.push(novo.id);
    expect(novo.draftVersion.components[0]).toMatchObject({
      quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
      applyPurityAdjustment: true,
      applyOverageAdjustment: false,
    });
    await app.close();
  });

  it("14 · base do Modelo em kg aplicada a produto em g: converte a base e não toca a configuração", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");

    const { draftId } = await criarModelo(
      app,
      [
        {
          itemId: insumo.id,
          quantity: "100",
          unitCode: "g",
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          purityPercentApplied: "98",
          applyPurityAdjustment: true,
        },
      ],
      { basisQuantity: "1", outputUnitCode: "kg" },
    );
    await ativar(app, draftId);

    const { formulacao } = await aplicar(app, draftId, "g");
    // 1 kg de base vira 1000 g — nunca 1 g (TEMPLATE-APPLY-BASE-UOM-01).
    expect(D(formulacao.basisQuantity).equals(1000)).toBe(true);
    const [componente] = formulacao.components;
    expect(componente).toMatchObject({
      quantity: "100",
      quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
      applyPurityAdjustment: true,
    });
    // 100 g sobre 1000 g de base = 0,1 g = 0,0001 kg por grama acabado; ÷ 0,98.
    fisicoIgual(componente!.physicalPerUnit, D("0.0001").dividedBy(D("0.98")));
    await app.close();
  });
});
