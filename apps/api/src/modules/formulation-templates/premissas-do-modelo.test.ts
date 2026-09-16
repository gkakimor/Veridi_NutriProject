import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * FORMULATION-TEMPLATE-WORKBENCH-01 (fatia 1) — o Modelo guarda, valida e
 * versiona as MESMAS premissas técnicas da Formulação.
 *
 * O Modelo já copiava quantidades, pureza, reserva e intenção de ajuste, mas
 * não a premissa que dá sentido a tudo isso: forma, apresentação, cápsulas por
 * dose, dose e conteúdo, perda prevista. Aplicar o Modelo entregava a receita
 * certa com a leitura em branco — "500 mg por dose" sem saber se a dose são
 * duas cápsulas ou cinco gramas não se reproduz em produto nenhum.
 *
 * O que fica provado, com número:
 *
 *   - cápsula e pó DERIVAM doses por embalagem pelo mesmo motor da Formulação;
 *   - divisão que não fecha é recusada COM O CAMPO, nunca arredondada;
 *   - forma nula legada continua nula — nada é presumido;
 *   - perda prevista `null` é NÃO INFORMADA e nunca vira 0%;
 *   - versão nova do Modelo leva as premissas;
 *   - versão ativa não se edita;
 *   - Formulação → Modelo e Modelo → Formulação copiam as premissas, e a
 *     cópia é SNAPSHOT: mexer num lado depois não mexe no outro;
 *   - nada comercial atravessa a promoção para Modelo.
 */

/** Conta independente, em Decimal — nunca Number (§59). */
const D = (value: string | number) => new Prisma.Decimal(value);

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units = [
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
    { code: "mg", label: "Miligrama", dimension: "MASS" as const, toBaseFactor: "0.001" },
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

async function createItem(
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  unitCode: string,
  extras: { defaultPurityPercent?: string } = {},
) {
  const m = marker();
  const prefixo = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "EM" : "PA";
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${prefixo}-PRM-${m}`,
      name: `Item Premissas do Modelo ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
      ...(extras.defaultPurityPercent
        ? { defaultPurityPercent: D(extras.defaultPurityPercent) }
        : {}),
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
        name: `Produto Premissas do Modelo ${marker()}`,
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
  return { product: product as { id: string }, v1: v1.json() as { id: string } };
}

/** Modelo novo em rascunho, sem premissa nenhuma — o Modelo de antes da bancada. */
async function criarModelo(app: App, outputUnitCode = "un") {
  const template = (
    await app.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: `Modelo Premissas ${marker()}`, basisQuantity: "1", outputUnitCode },
    })
  ).json();
  fixtureTemplateIds.push(template.id);
  return { templateId: template.id as string, draftId: template.draftVersion.id as string };
}

function gravar(app: App, versionId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PATCH",
    url: `/formulation-template-versions/${versionId}`,
    payload,
  });
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
  const { product } = await createProduct(app, unidadeDoAcabado);
  const resposta = await app.inject({
    method: "POST",
    url: `/products/${product.id}/formulation-versions/from-template`,
    payload: { formulationTemplateVersionId: templateVersionId },
  });
  expect(resposta.statusCode, resposta.body).toBeLessThan(300);
  return { product, formulacao: resposta.json() };
}

describe("Premissas técnicas do Modelo de Formulação", () => {
  it("1 · Modelo em cápsula: guarda a forma e DERIVA doses por embalagem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");
    const { draftId } = await criarModelo(app);

    const salvo = await gravar(app, draftId, {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 2,
      capsulesPerPackage: 120,
      components: [{ itemId: insumo.id, quantity: "250", unitCode: "mg", basis: "PER_DOSE" }],
    });

    expect(salvo.statusCode, salvo.body).toBe(200);
    const versao = salvo.json();
    expect(versao.dosageForm).toBe("CAPSULE");
    expect(versao.presentationType).toBe("POT");
    expect(versao.capsulesPerDose).toBe(2);
    // 120 cápsulas ÷ 2 por dose = 60 doses. Resultado, nunca segundo campo.
    expect(versao.dosesPerPackage).toBe(60);
    expect(versao.capsulesPerPackage).toBe(120);
    // Premissa de pó não fica pendurada numa matriz de cápsula.
    expect(versao.doseAmount).toBeNull();
    expect(versao.packageContentAmount).toBeNull();
    await app.close();
  });

  it("2 · Modelo em pó: dose e conteúdo em massa DERIVAM as doses, convertendo unidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");
    const { draftId } = await criarModelo(app);

    const salvo = await gravar(app, draftId, {
      dosageForm: "POWDER",
      presentationType: "POUCH",
      doseAmount: "5",
      doseUomCode: "g",
      packageContentAmount: "0.3",
      packageContentUomCode: "kg",
      components: [{ itemId: insumo.id, quantity: "800", unitCode: "mg", basis: "PER_DOSE" }],
    });

    expect(salvo.statusCode, salvo.body).toBe(200);
    const versao = salvo.json();
    expect(versao.dosageForm).toBe("POWDER");
    // 0,3 kg = 300 g; 300 ÷ 5 = 60 doses.
    expect(versao.dosesPerPackage).toBe(60);
    expect(D(versao.doseAmount).equals(D("5"))).toBe(true);
    expect(versao.doseUomCode).toBe("g");
    expect(versao.packageContentUomCode).toBe("kg");
    // Premissa de cápsula não fica pendurada numa matriz de pó.
    expect(versao.capsulesPerDose).toBeNull();
    expect(versao.capsulesPerPackage).toBeNull();
    await app.close();
  });

  it("3 · divisão que não fecha é recusada COM O CAMPO — cápsula e pó", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { draftId: capsula } = await criarModelo(app);
    const { draftId: po } = await criarModelo(app);

    const recusaCapsula = await gravar(app, capsula, {
      dosageForm: "CAPSULE",
      capsulesPerDose: 3,
      capsulesPerPackage: 100,
    });
    expect(recusaCapsula.statusCode, recusaCapsula.body).toBe(400);
    expect(recusaCapsula.json().issues[0].path).toBe("capsulesPerPackage");

    const recusaPo = await gravar(app, po, {
      dosageForm: "POWDER",
      doseAmount: "7",
      doseUomCode: "g",
      packageContentAmount: "300",
      packageContentUomCode: "g",
    });
    expect(recusaPo.statusCode, recusaPo.body).toBe(400);
    expect(recusaPo.json().issues[0].path).toBe("packageContentAmount");

    // Recusa não grava metade da apresentação: a matriz continua sem forma.
    const depois = await app.inject({ method: "GET", url: `/formulation-templates` });
    expect(depois.statusCode).toBe(200);
    const versao = await getPrisma().formulationTemplateVersion.findUnique({
      where: { id: capsula },
    });
    expect(versao?.dosageForm).toBeNull();
    expect(versao?.capsulesPerDose).toBeNull();
    await app.close();
  });

  it("4 · dose e conteúdo precisam ser massa, e a unidade precisa existir", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { draftId } = await criarModelo(app);

    const foraDeMassa = await gravar(app, draftId, {
      dosageForm: "POWDER",
      doseAmount: "5",
      doseUomCode: "un",
      packageContentAmount: "300",
      packageContentUomCode: "un",
    });
    expect(foraDeMassa.statusCode, foraDeMassa.body).toBe(400);
    expect(foraDeMassa.json().issues[0].path).toBe("doseUomCode");

    const semUnidade = await gravar(app, draftId, {
      dosageForm: "POWDER",
      doseAmount: "5",
      packageContentAmount: "300",
    });
    expect(semUnidade.statusCode, semUnidade.body).toBe(400);
    expect(semUnidade.json().issues[0].path).toBe("doseUomCode");
    await app.close();
  });

  it("5 · Modelo legado sem forma continua sem forma — nada é presumido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");
    const { draftId } = await criarModelo(app);

    // Gravação que não toca em premissa nenhuma: o Modelo de sempre.
    const salvo = await gravar(app, draftId, {
      basisQuantity: "10",
      components: [{ itemId: insumo.id, quantity: "2", unitCode: "kg" }],
    });
    expect(salvo.statusCode, salvo.body).toBe(200);
    const versao = salvo.json();
    expect(versao.dosageForm).toBeNull();
    expect(versao.presentationType).toBeNull();
    expect(versao.capsulesPerDose).toBeNull();
    expect(versao.capsulesPerPackage).toBeNull();
    expect(versao.doseAmount).toBeNull();
    expect(versao.expectedLossPercent).toBeNull();

    // Ativar e aplicar continuam funcionando com a forma nula.
    const ativa = await ativar(app, draftId);
    expect(ativa.dosageForm).toBeNull();
    const { formulacao } = await aplicar(app, draftId);
    expect(formulacao.dosageForm).toBeNull();
    expect(formulacao.components).toHaveLength(1);
    await app.close();
  });

  it("6 · perda prevista: null é NÃO INFORMADA, 0 é declaração, 100 é recusado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const { draftId } = await criarModelo(app);

    const ausente = await gravar(app, draftId, { basisQuantity: "1" });
    expect(ausente.json().expectedLossPercent).toBeNull();

    const informada = await gravar(app, draftId, { expectedLossPercent: "4.5" });
    expect(informada.statusCode, informada.body).toBe(200);
    expect(D(informada.json().expectedLossPercent).equals(D("4.5"))).toBe(true);

    const zero = await gravar(app, draftId, { expectedLossPercent: "0" });
    expect(zero.statusCode, zero.body).toBe(200);
    expect(D(zero.json().expectedLossPercent).equals(D("0"))).toBe(true);

    const limpa = await gravar(app, draftId, { expectedLossPercent: null });
    expect(limpa.statusCode, limpa.body).toBe(200);
    expect(limpa.json().expectedLossPercent).toBeNull();

    const cem = await gravar(app, draftId, { expectedLossPercent: "100" });
    expect(cem.statusCode, cem.body).toBe(400);
    await app.close();
  });

  it("7 · versão nova do Modelo leva as premissas; a ativa não se edita", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");
    const { draftId } = await criarModelo(app);

    await gravar(app, draftId, {
      dosageForm: "CAPSULE",
      presentationType: "BOTTLE",
      capsulesPerDose: 2,
      capsulesPerPackage: 60,
      expectedLossPercent: "3",
      components: [{ itemId: insumo.id, quantity: "300", unitCode: "mg", basis: "PER_DOSE" }],
    });
    await ativar(app, draftId);

    // Versão ativa é documento fechado.
    const recusa = await gravar(app, draftId, { capsulesPerDose: 1 });
    expect(recusa.statusCode, recusa.body).toBe(409);

    const nova = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${draftId}/new-version`,
      })
    ).json();
    expect(nova.dosageForm).toBe("CAPSULE");
    expect(nova.presentationType).toBe("BOTTLE");
    expect(nova.capsulesPerDose).toBe(2);
    expect(nova.dosesPerPackage).toBe(30);
    expect(nova.capsulesPerPackage).toBe(60);
    expect(D(nova.expectedLossPercent).equals(D("3"))).toBe(true);
    await app.close();
  });

  it("8 · aplicar o Modelo copia as premissas — e a cópia é independente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg", { defaultPurityPercent: "98" });
    const { draftId } = await criarModelo(app);

    await gravar(app, draftId, {
      dosageForm: "POWDER",
      presentationType: "POUCH",
      doseAmount: "5",
      doseUomCode: "g",
      packageContentAmount: "150",
      packageContentUomCode: "g",
      expectedLossPercent: "2.5",
      components: [
        {
          itemId: insumo.id,
          quantity: "800",
          unitCode: "mg",
          basis: "PER_DOSE",
          purityPercentApplied: "90",
          overagePercent: "5",
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          applyPurityAdjustment: true,
          applyOverageAdjustment: true,
        },
      ],
    });
    await ativar(app, draftId);

    const { formulacao } = await aplicar(app, draftId);
    expect(formulacao.dosageForm).toBe("POWDER");
    expect(formulacao.presentationType).toBe("POUCH");
    expect(D(formulacao.doseAmount).equals(D("5"))).toBe(true);
    expect(formulacao.doseUomCode).toBe("g");
    expect(D(formulacao.packageContentAmount).equals(D("150"))).toBe(true);
    expect(formulacao.dosesPerPackage).toBe(30);
    expect(D(formulacao.expectedLossPercent).equals(D("2.5"))).toBe(true);
    /*
     * PUREZA CONGELADA: 90% é o que a matriz declarou, e não os 98% do cadastro
     * do Item. Reler o cadastro na aplicação tornaria o Modelo irreprodutível.
     */
    expect(D(formulacao.components[0].purityPercentApplied).equals(D("90"))).toBe(true);
    expect(D(formulacao.components[0].overagePercent).equals(D("5"))).toBe(true);

    // SNAPSHOT: nova versão do Modelo com outra premissa não alcança a cópia.
    const nova = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${draftId}/new-version`,
      })
    ).json();
    const mudou = await gravar(app, nova.id, {
      doseAmount: "10",
      expectedLossPercent: "9",
    });
    expect(mudou.statusCode, mudou.body).toBe(200);

    const relida = await app.inject({
      method: "GET",
      url: `/formulation-versions/${formulacao.id}`,
    });
    const depois = relida.json();
    expect(D(depois.doseAmount).equals(D("5"))).toBe(true);
    expect(depois.dosesPerPackage).toBe(30);
    expect(D(depois.expectedLossPercent).equals(D("2.5"))).toBe(true);
    await app.close();
  });

  it("9 · salvar a Formulação como Modelo leva as premissas — e nada comercial", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg");
    const pote = await createItem("PACKAGING", "un");
    const { product, v1 } = await createProduct(app);

    const gravada = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: {
        dosageForm: "CAPSULE",
        presentationType: "POT",
        capsulesPerDose: 2,
        capsulesPerPackage: 120,
        expectedLossPercent: "4",
        components: [
          {
            itemId: insumo.id,
            quantity: "250",
            unitCode: "mg",
            basis: "PER_DOSE",
            purityPercentApplied: "97",
            overagePercent: "1.5",
          },
          { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
        ],
      },
    });
    expect(gravada.statusCode, gravada.body).toBe(200);
    expect(gravada.json().dosesPerPackage).toBe(60);

    const promovido = await app.inject({
      method: "POST",
      url: `/formulation-versions/${v1.id}/save-as-template`,
      payload: { name: `Promovido ${marker()}` },
    });
    expect(promovido.statusCode, promovido.body).toBeLessThan(300);
    const template = promovido.json();
    fixtureTemplateIds.push(template.id);
    const rascunho = template.draftVersion;

    expect(rascunho.dosageForm).toBe("CAPSULE");
    expect(rascunho.presentationType).toBe("POT");
    expect(rascunho.capsulesPerDose).toBe(2);
    expect(rascunho.dosesPerPackage).toBe(60);
    expect(rascunho.capsulesPerPackage).toBe(120);
    expect(D(rascunho.expectedLossPercent).equals(D("4"))).toBe(true);
    // Reserva e pureza congeladas viajam junto — são da receita.
    const materiaPrima = rascunho.components.find(
      (component: { itemId: string }) => component.itemId === insumo.id,
    );
    expect(D(materiaPrima.purityPercentApplied).equals(D("97"))).toBe(true);
    expect(D(materiaPrima.overagePercent).equals(D("1.5"))).toBe(true);
    // Composição e embalagem atravessam com a base de cada uma.
    expect(materiaPrima.basis).toBe("PER_DOSE");
    const embalagem = rascunho.components.find(
      (component: { itemId: string }) => component.itemId === pote.id,
    );
    expect(embalagem.basis).toBe("PER_FINISHED_UNIT");

    /*
     * NADA COMERCIAL: a matriz é reutilizável entre clientes, e carregar o
     * Produto ou o Cliente de um deles a tornaria a receita daquele cliente.
     */
    const serializado = JSON.stringify(template);
    expect(serializado).not.toContain(product.id);
    expect(serializado).not.toContain("customerId");
    expect(serializado).not.toContain("agreedPrice");
    await app.close();
  });

  it("10 · o Modelo lê o cadastro do Item junto da linha — leitura, não cálculo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const insumo = await createItem("RAW_MATERIAL", "kg", { defaultPurityPercent: "98.5" });
    const { draftId } = await criarModelo(app);

    const salvo = await gravar(app, draftId, {
      components: [{ itemId: insumo.id, quantity: "2", unitCode: "kg" }],
    });
    expect(salvo.statusCode, salvo.body).toBe(200);
    const [linha] = salvo.json().components;
    expect(linha.stockUnitCode).toBe("kg");
    expect(D(linha.itemDefaultPurityPercent).equals(D("98.5"))).toBe(true);
    // A pureza APLICADA continua sendo a da linha: o cadastro é referência.
    expect(linha.purityPercentApplied).toBeNull();
    await app.close();
  });
});
