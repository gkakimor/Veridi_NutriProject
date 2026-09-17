import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * FORMULATION-COMPONENT-BASIS-AUTOMATION-01 — a base do componente é do SISTEMA.
 *
 * Decisão de PO: base não é cadastro do Item nem escolha de quem formula. Ela
 * sai da seção (tipo real do Item) e do modo da receita, e a coluna `basis`
 * continua gravada como snapshot técnico. O que fica provado pela API:
 *
 *   - composição por dose grava `PER_DOSE`, base fixa grava `FIXED_BASIS`, e a
 *     forma que deriva doses (cápsula) faz a receita por dose;
 *   - embalagem grava `PER_FINISHED_UNIT` em qualquer modo;
 *   - `basis` adulterado no corpo não chega ao banco;
 *   - trocar o modo do rascunho sem reenviar as linhas realinha as gravadas —
 *     e a conta por embalagem acompanha;
 *   - versão ativa não é reescrita: a base gravada continua sendo a leitura
 *     dela, e a cópia nasce coerente sem tocar na origem;
 *   - rascunho legado com base fora da regra é LIDO como está e só muda quando
 *     alguém grava;
 *   - o Modelo segue a mesma regra na gravação, na nova versão, na aplicação e
 *     no "salvar como Modelo".
 */

type App = ReturnType<typeof buildTestApp>;
type Linha = { itemId: string; basis: string; physicalPerUnit: string | null };

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];

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
  // Só o que ESTE arquivo criou, pelos ids das próprias fixtures.
  if (fixtureProductIds.length > 0) {
    await prisma.industrialCostVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
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

async function criarItem(type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT", unitCode: string) {
  const m = marca();
  const prefixo = type === "RAW_MATERIAL" ? "MP" : type === "PACKAGING" ? "EM" : "PA";
  const item = await getPrisma().item.create({
    data: {
      type,
      code: `${prefixo}-BASE-${m}`,
      name: `Base derivada ${m}`,
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

/** Produto sem perfil industrial: a V1 nasce em base fixa, sem forma. */
async function criarProdutoComV1(app: App) {
  const acabado = await criarItem("FINISHED_PRODUCT", "un");
  const produto = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: await fixtureCustomerId(),
      name: `Produto base derivada ${marca()}`,
      finishedProductItemId: acabado.id,
    },
  });
  expect(produto.statusCode, produto.body).toBeLessThan(400);
  fixtureProductIds.push(produto.json().id);
  const v1 = await app.inject({
    method: "POST",
    url: `/products/${produto.json().id}/formulation-versions`,
    payload: {},
  });
  expect(v1.statusCode, v1.body).toBe(201);
  return { produtoId: produto.json().id as string, v1: v1.json() as { id: string; calculationMode: string } };
}

async function gravarVersao(app: App, versaoId: string, payload: Record<string, unknown>) {
  const resposta = await app.inject({ method: "PATCH", url: `/formulation-versions/${versaoId}`, payload });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as { components: Linha[]; status: string };
}

async function gravarModelo(app: App, versaoId: string, payload: Record<string, unknown>) {
  const resposta = await app.inject({
    method: "PATCH",
    url: `/formulation-template-versions/${versaoId}`,
    payload,
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as { components: Linha[] };
}

async function criarModelo(app: App) {
  const resposta = await app.inject({
    method: "POST",
    url: "/formulation-templates",
    payload: { name: `Modelo base derivada ${marca()}`, basisQuantity: "1", outputUnitCode: "un" },
  });
  expect(resposta.statusCode, resposta.body).toBeLessThan(400);
  fixtureTemplateIds.push(resposta.json().id);
  return { templateId: resposta.json().id as string, draftId: resposta.json().draftVersion.id as string };
}

function baseDe(linhas: Linha[], itemId: string): string | undefined {
  return linhas.find((linha) => linha.itemId === itemId)?.basis;
}

/** A base GRAVADA, lida direto do banco — a API não é juíza de si mesma. */
async function baseNoBanco(versaoId: string, itemId: string): Promise<string | undefined> {
  const linha = await getPrisma().formulationComponent.findFirst({
    where: { formulationVersionId: versaoId, itemId },
    select: { basis: true },
  });
  return linha?.basis;
}

async function baseNoBancoDoModelo(versaoId: string, itemId: string): Promise<string | undefined> {
  const linha = await getPrisma().formulationTemplateComponent.findFirst({
    where: { formulationTemplateVersionId: versaoId, itemId },
    select: { basis: true },
  });
  return linha?.basis;
}

describe("Formulação — a base é derivada na gravação do rascunho", () => {
  it("receita por dose: matéria-prima grava por dose e embalagem por unidade, mesmo com basis adulterado", async () => {
    const app = buildTestApp();
    await app.ready();
    const { v1 } = await criarProdutoComV1(app);
    const insumo = await criarItem("RAW_MATERIAL", "kg");
    const semBase = await criarItem("RAW_MATERIAL", "kg");
    const pote = await criarItem("PACKAGING", "un");

    const gravada = await gravarVersao(app, v1.id, {
      calculationMode: "PER_DOSE",
      dosesPerPackage: 60,
      components: [
        // Cliente de API mandando a base que a regra NÃO dá.
        { itemId: insumo.id, quantity: "200", unitCode: "mg", basis: "FIXED_BASIS" },
        { itemId: semBase.id, quantity: "50", unitCode: "mg" },
        { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_DOSE" },
      ],
    });

    expect(baseDe(gravada.components, insumo.id)).toBe("PER_DOSE");
    expect(baseDe(gravada.components, semBase.id)).toBe("PER_DOSE");
    expect(baseDe(gravada.components, pote.id)).toBe("PER_FINISHED_UNIT");
    expect(await baseNoBanco(v1.id, insumo.id)).toBe("PER_DOSE");
    expect(await baseNoBanco(v1.id, pote.id)).toBe("PER_FINISHED_UNIT");

    // A conta segue o motor de sempre: 200 mg × 60 doses = 0,012 kg; um pote por embalagem.
    expect(gravada.components.find((l) => l.itemId === insumo.id)?.physicalPerUnit).toBe("0.012");
    expect(gravada.components.find((l) => l.itemId === pote.id)?.physicalPerUnit).toBe("1");
    await app.close();
  });

  it("base fixa: matéria-prima grava sobre a base da fórmula; cápsula faz a receita por dose", async () => {
    const app = buildTestApp();
    await app.ready();
    const { v1 } = await criarProdutoComV1(app);
    expect(v1.calculationMode).toBe("FIXED_BASIS");
    const insumo = await criarItem("RAW_MATERIAL", "kg");
    const pote = await criarItem("PACKAGING", "un");

    const fixa = await gravarVersao(app, v1.id, {
      basisQuantity: "1",
      components: [
        { itemId: insumo.id, quantity: "0.5", unitCode: "kg", basis: "PER_DOSE" },
        { itemId: pote.id, quantity: "1", unitCode: "un", basis: "FIXED_BASIS" },
      ],
    });
    expect(baseDe(fixa.components, insumo.id)).toBe("FIXED_BASIS");
    expect(baseDe(fixa.components, pote.id)).toBe("PER_FINISHED_UNIT");

    // Forma cápsula com o modo ainda "Base fixa": a dose é a unidade da receita.
    const capsula = await gravarVersao(app, v1.id, {
      dosageForm: "CAPSULE",
      capsulesPerDose: 1,
      capsulesPerPackage: 60,
      components: [
        { itemId: insumo.id, quantity: "300", unitCode: "mg" },
        { itemId: pote.id, quantity: "1", unitCode: "un" },
      ],
    });
    expect(baseDe(capsula.components, insumo.id)).toBe("PER_DOSE");
    expect(baseDe(capsula.components, pote.id)).toBe("PER_FINISHED_UNIT");
    await app.close();
  });

  it("trocar o modo sem reenviar as linhas realinha as gravadas — ida e volta, só no rascunho", async () => {
    const app = buildTestApp();
    await app.ready();
    const { v1 } = await criarProdutoComV1(app);
    const insumo = await criarItem("RAW_MATERIAL", "kg");
    const pote = await criarItem("PACKAGING", "un");
    await gravarVersao(app, v1.id, {
      components: [
        { itemId: insumo.id, quantity: "200", unitCode: "mg" },
        { itemId: pote.id, quantity: "1", unitCode: "un" },
      ],
    });
    expect(await baseNoBanco(v1.id, insumo.id)).toBe("FIXED_BASIS");

    const porDose = await gravarVersao(app, v1.id, { calculationMode: "PER_DOSE", dosesPerPackage: 30 });
    expect(baseDe(porDose.components, insumo.id)).toBe("PER_DOSE");
    expect(baseDe(porDose.components, pote.id)).toBe("PER_FINISHED_UNIT");
    // 200 mg por dose × 30 doses = 0,006 kg por embalagem.
    expect(porDose.components.find((l) => l.itemId === insumo.id)?.physicalPerUnit).toBe("0.006");

    const deVolta = await gravarVersao(app, v1.id, { calculationMode: "FIXED_BASIS" });
    expect(baseDe(deVolta.components, insumo.id)).toBe("FIXED_BASIS");
    expect(await baseNoBanco(v1.id, insumo.id)).toBe("FIXED_BASIS");
    // Sobre a base 1: 200 mg = 0,0002 kg por unidade.
    expect(deVolta.components.find((l) => l.itemId === insumo.id)?.physicalPerUnit).toBe("0.0002");
    await app.close();
  });
});

describe("Formulação — histórico e rascunho legado", () => {
  it("versão ativa com base fora da regra continua lida pelo gravado; a cópia nasce coerente e a origem fica intacta", async () => {
    const app = buildTestApp();
    await app.ready();
    const { v1 } = await criarProdutoComV1(app);
    const insumo = await criarItem("RAW_MATERIAL", "kg");
    await gravarVersao(app, v1.id, {
      basisQuantity: "1",
      components: [{ itemId: insumo.id, quantity: "0.002", unitCode: "kg" }],
    });
    const ativada = await app.inject({ method: "POST", url: `/formulation-versions/${v1.id}/activate` });
    expect(ativada.statusCode, ativada.body).toBe(200);

    // Dado legado: a linha ativa foi gravada por unidade acabada, antes da regra.
    await getPrisma().formulationComponent.updateMany({
      where: { formulationVersionId: v1.id },
      data: { basis: "PER_FINISHED_UNIT" },
    });

    const lida = await app.inject({ method: "GET", url: `/formulation-versions/${v1.id}` });
    expect(baseDe(lida.json().components, insumo.id)).toBe("PER_FINISHED_UNIT");

    // Ativa não se edita — e a recusa não mexe na base gravada.
    const edicao = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${v1.id}`,
      payload: { calculationMode: "PER_DOSE", dosesPerPackage: 10 },
    });
    expect(edicao.statusCode).toBeGreaterThanOrEqual(400);
    expect(await baseNoBanco(v1.id, insumo.id)).toBe("PER_FINISHED_UNIT");

    const copia = await app.inject({ method: "POST", url: `/formulation-versions/${v1.id}/new-version` });
    expect(copia.statusCode, copia.body).toBeLessThan(400);
    const v2 = copia.json() as { id: string; status: string; components: Linha[] };
    expect(v2.status).toBe("DRAFT");
    expect(baseDe(v2.components, insumo.id)).toBe("FIXED_BASIS");
    expect(await baseNoBanco(v1.id, insumo.id)).toBe("PER_FINISHED_UNIT");
    await app.close();
  });

  it("rascunho legado com base fora da regra é lido como está e só muda quando alguém grava", async () => {
    const app = buildTestApp();
    await app.ready();
    const { produtoId, v1 } = await criarProdutoComV1(app);
    const insumo = await criarItem("RAW_MATERIAL", "kg");
    await gravarVersao(app, v1.id, {
      components: [{ itemId: insumo.id, quantity: "0.002", unitCode: "kg" }],
    });
    await getPrisma().formulationComponent.updateMany({
      where: { formulationVersionId: v1.id },
      data: { basis: "PER_FINISHED_UNIT" },
    });

    // Ler não converte nada.
    const lida = await app.inject({ method: "GET", url: `/formulation-versions/${v1.id}` });
    expect(baseDe(lida.json().components, insumo.id)).toBe("PER_FINISHED_UNIT");
    await app.inject({ method: "GET", url: `/products/${produtoId}/formulations` });
    expect(await baseNoBanco(v1.id, insumo.id)).toBe("PER_FINISHED_UNIT");

    // Gravar é o gesto que realinha.
    const gravada = await gravarVersao(app, v1.id, { notes: "conferida" });
    expect(baseDe(gravada.components, insumo.id)).toBe("FIXED_BASIS");
    expect(await baseNoBanco(v1.id, insumo.id)).toBe("FIXED_BASIS");
    await app.close();
  });
});

describe("Modelo de Formulação — a mesma regra", () => {
  it("gravar, trocar o modo, nova versão, aplicar e salvar como Modelo nunca levam base fora da regra", async () => {
    const app = buildTestApp();
    await app.ready();
    const insumo = await criarItem("RAW_MATERIAL", "kg");
    const pote = await criarItem("PACKAGING", "un");
    const { draftId } = await criarModelo(app);

    // Gravação do rascunho do Modelo com basis adulterado.
    const gravado = await gravarModelo(app, draftId, {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 2,
      capsulesPerPackage: 60,
      components: [
        { itemId: insumo.id, quantity: "250", unitCode: "mg", basis: "FIXED_BASIS" },
        { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_DOSE" },
      ],
    });
    expect(baseDe(gravado.components, insumo.id)).toBe("PER_DOSE");
    expect(baseDe(gravado.components, pote.id)).toBe("PER_FINISHED_UNIT");

    // Forma que não deriva doses, modo base fixa, sem reenviar as linhas: realinha.
    const semForma = await gravarModelo(app, draftId, { dosageForm: null, calculationMode: "FIXED_BASIS" });
    expect(baseDe(semForma.components, insumo.id)).toBe("FIXED_BASIS");
    expect(await baseNoBancoDoModelo(draftId, insumo.id)).toBe("FIXED_BASIS");

    // De volta à cápsula, e o Modelo ativa.
    await gravarModelo(app, draftId, {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 2,
      capsulesPerPackage: 60,
    });
    expect(await baseNoBancoDoModelo(draftId, insumo.id)).toBe("PER_DOSE");
    const ativado = await app.inject({
      method: "POST",
      url: `/formulation-template-versions/${draftId}/activate`,
    });
    expect(ativado.statusCode, ativado.body).toBe(200);

    // Modelo ativo legado: a matéria-prima foi gravada por unidade acabada antes da regra.
    await getPrisma().formulationTemplateComponent.updateMany({
      where: { formulationTemplateVersionId: draftId, itemId: insumo.id },
      data: { basis: "PER_FINISHED_UNIT" },
    });

    // Aplicar deriva: a Formulação nasce por dose, e o Modelo ativo fica como estava.
    const { produtoId } = await criarProdutoComV1(app);
    const aplicada = await app.inject({
      method: "POST",
      url: `/products/${produtoId}/formulation-versions/from-template`,
      payload: { formulationTemplateVersionId: draftId },
    });
    expect(aplicada.statusCode, aplicada.body).toBeLessThan(400);
    const formulacao = aplicada.json() as { id: string; components: Linha[] };
    expect(baseDe(formulacao.components, insumo.id)).toBe("PER_DOSE");
    expect(baseDe(formulacao.components, pote.id)).toBe("PER_FINISHED_UNIT");
    expect(await baseNoBancoDoModelo(draftId, insumo.id)).toBe("PER_FINISHED_UNIT");

    // Nova versão do Modelo a partir da ativa legada: nasce coerente.
    const nova = await app.inject({
      method: "POST",
      url: `/formulation-template-versions/${draftId}/new-version`,
    });
    expect(nova.statusCode, nova.body).toBe(201);
    expect(baseDe(nova.json().components, insumo.id)).toBe("PER_DOSE");
    expect(await baseNoBancoDoModelo(draftId, insumo.id)).toBe("PER_FINISHED_UNIT");

    // Salvar a Formulação como Modelo: a base do Modelo novo também é derivada.
    await getPrisma().formulationComponent.updateMany({
      where: { formulationVersionId: formulacao.id, itemId: insumo.id },
      data: { basis: "FIXED_BASIS" },
    });
    const salvo = await app.inject({
      method: "POST",
      url: `/formulation-versions/${formulacao.id}/save-as-template`,
      payload: { name: `Salvo base derivada ${marca()}` },
    });
    expect(salvo.statusCode, salvo.body).toBe(201);
    fixtureTemplateIds.push(salvo.json().id);
    expect(baseDe(salvo.json().draftVersion.components, insumo.id)).toBe("PER_DOSE");
    expect(baseDe(salvo.json().draftVersion.components, pote.id)).toBe("PER_FINISHED_UNIT");
    await app.close();
  });
});
