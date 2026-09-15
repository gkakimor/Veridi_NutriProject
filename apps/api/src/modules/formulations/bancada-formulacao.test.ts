import { afterAll, describe, expect, it } from "vitest";
import { Decimal } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * FORMULATION-WORKBENCH-01 — a bancada gravada, lida de volta pela API.
 *
 * O motor por dose e por cápsula já é provado em `@veridi/shared`
 * (`formulation-bancada.test.ts`) contra as duas planilhas reais da Veridi.
 * Aqui a pergunta é outra: o que a API GRAVA e DEVOLVE. Premissa derivada em
 * vez de digitada, premissa recusada quando a divisão não fecha, dado técnico
 * do Item na linha, pureza congelada na versão enquanto o cadastro muda, e a
 * versão nova herdando a apresentação.
 */

type App = ReturnType<typeof buildTestApp>;

const fixtureItemIds: string[] = [];
const fixtureProductIds: string[] = [];

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Diferença absoluta máxima aceita contra o valor da planilha. */
const TOLERANCIA = new Decimal("1e-9");

function bate(valor: string | null, planilha: string, rotulo: string) {
  expect(valor, `${rotulo}: veio nulo`).not.toBeNull();
  const diferenca = new Decimal(valor!).minus(planilha).abs();
  expect(
    diferenca.lessThanOrEqualTo(TOLERANCIA),
    `${rotulo}: API ${valor} × planilha ${planilha}`,
  ).toBe(true);
}

async function criarItem(
  app: App,
  payload: Record<string, unknown>,
): Promise<{ id: string; code: string }> {
  const resposta = await app.inject({
    method: "POST",
    url: "/items",
    payload: { name: `BANCADA ${marca()}`, ...payload },
  });
  expect(resposta.statusCode, `criação do item falhou: ${resposta.body}`).toBeLessThan(400);
  const item = resposta.json();
  fixtureItemIds.push(item.id);
  return item;
}

/** Produto com perfil industrial — é dele que a V1 herda as premissas. */
async function criarProduto(app: App, perfil: Record<string, unknown>) {
  const acabado = await criarItem(app, { type: "FINISHED_PRODUCT", unitCode: "un" });
  const resposta = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: await fixtureCustomerId(),
      name: `BANCADA produto ${marca()}`,
      finishedProductItemId: acabado.id,
      ...perfil,
    },
  });
  expect(resposta.statusCode, `criação do produto falhou: ${resposta.body}`).toBeLessThan(400);
  const produto = resposta.json();
  fixtureProductIds.push(produto.id);
  return produto;
}

async function primeiraVersao(app: App, produtoId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/products/${produtoId}/formulation-versions`,
  });
  expect(resposta.statusCode, `criação da versão falhou: ${resposta.body}`).toBeLessThan(400);
  return resposta.json();
}

async function gravar(app: App, versaoId: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/formulation-versions/${versaoId}`, payload });
}

async function gravarOk(app: App, versaoId: string, payload: Record<string, unknown>) {
  const resposta = await gravar(app, versaoId, payload);
  expect(resposta.statusCode, `PATCH da versão falhou: ${resposta.body}`).toBeLessThan(400);
  return resposta.json();
}

/** Uma linha por dose: alvo ativo, pureza aplicada (a leitura da bancada). */
function porDose(itemId: string, alvoMg: string, pureza: string | null) {
  return {
    itemId,
    quantity: alvoMg,
    unitCode: "mg",
    basis: "PER_DOSE",
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
    applyPurityAdjustment: true,
    ...(pureza === null ? {} : { purityPercentApplied: pureza }),
  };
}

function linhaDo(versao: { components: { itemCode: string }[] }, code: string) {
  const linha = versao.components.find((c) => c.itemCode === code);
  expect(linha, `componente ${code} não voltou no DTO`).toBeTruthy();
  return linha as Record<string, unknown> & { itemCode: string };
}

describe("Bancada — cápsula (Ácido Fólico PT 120 caps)", () => {
  it("premissas do produto entram na V1, e as doses saem das cápsulas — não de um segundo campo", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 1,
      dosesPerPackage: 120,
    });
    const versao = await primeiraVersao(app, produto.id);

    // A V1 abre preenchida com o cadastro do Produto.
    expect(versao.dosageForm).toBe("CAPSULE");
    expect(versao.presentationType).toBe("POT");
    expect(versao.capsulesPerDose).toBe(1);
    expect(versao.dosesPerPackage).toBe(120);
    expect(versao.capsulesPerPackage).toBe(120);
    expect(versao.productProfile.dosesPerPackage).toBe(120);

    // 2 cápsulas por dose, mesmas 120 na embalagem: 60 doses, derivadas.
    const comDuas = await gravarOk(app, versao.id, {
      dosageForm: "CAPSULE",
      capsulesPerDose: 2,
      capsulesPerPackage: 120,
    });
    expect(comDuas.dosesPerPackage).toBe(60);
    expect(comDuas.capsulesPerPackage).toBe(120);

    await app.close();
  });

  it("linhas reais da planilha voltam com física por dose, por cápsula e por embalagem", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, { dosageForm: "CAPSULE", presentationType: "POT" });
    const versao = await primeiraVersao(app, produto.id);

    const acidoFolico = await criarItem(app, {
      type: "RAW_MATERIAL",
      unitCode: "kg",
      defaultPurityPercent: "70",
      sourceName: "L-metilfolato de cálcio",
      declaredNutrient: "Ácido Fólico",
      family: "VITAMIN",
    });
    const b6 = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });
    const calcio = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });
    const capsula = await criarItem(app, {
      type: "PACKAGING",
      unitCode: "un",
      packagingSubtype: "OTHER",
    });
    const pote = await criarItem(app, { type: "PACKAGING", unitCode: "un", packagingSubtype: "POT" });

    const gravada = await gravarOk(app, versao.id, {
      calculationMode: "PER_DOSE",
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 1,
      capsulesPerPackage: 120,
      components: [
        porDose(acidoFolico.id, "0.4", "70"),
        porDose(b6.id, "1.9", "70"),
        porDose(calcio.id, "500", "100"),
        // Embalagem: por unidade acabada, quantidade física informada.
        { itemId: capsula.id, quantity: "120", unitCode: "un", basis: "PER_FINISHED_UNIT" },
        { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
      ],
    });

    expect(gravada.dosesPerPackage).toBe(120);

    const folico = linhaDo(gravada, acidoFolico.code);
    // Planilha: G11 = F11 ÷ E11 = 0,4 ÷ 0,7; H11 = G11 ÷ 1 cápsula por dose.
    bate(folico["theoreticalPerDose"] as string, "0.4", "alvo por dose");
    bate(folico["physicalPerDose"] as string, "0.57142857142857151", "física por dose");
    bate(folico["physicalPerCapsule"] as string, "0.57142857142857151", "física por cápsula");
    // A mesma conta por EMBALAGEM, na unidade de estoque: 0,571428… mg × 120.
    bate(folico["physicalPerUnit"] as string, "0.00006857142857142857", "física por embalagem (kg)");

    // Dado técnico do cadastro chega junto — sem redigitar nada.
    expect(folico["itemSourceName"]).toBe("L-metilfolato de cálcio");
    expect(folico["itemDeclaredNutrient"]).toBe("Ácido Fólico");
    expect(folico["itemFamily"]).toBe("VITAMIN");
    expect(folico["itemDefaultPurityPercent"]).toBe("70");
    expect(folico["purityPercentApplied"]).toBe("70");

    bate(linhaDo(gravada, b6.code)["physicalPerDose"] as string, "2.7142857142857144", "B6 por dose");
    bate(linhaDo(gravada, calcio.code)["physicalPerDose"] as string, "500", "cálcio por dose");

    // Embalagem: tipo real do Item separa as duas seções da tela.
    const linhaCapsula = linhaDo(gravada, capsula.code);
    expect(linhaCapsula["itemType"]).toBe("PACKAGING");
    expect(linhaCapsula["physicalPerDose"], "embalagem não tem grandeza por dose").toBeNull();
    expect(linhaCapsula["physicalPerUnit"]).toBe("120");
    expect(linhaDo(gravada, pote.code)["itemPackagingSubtype"]).toBe("POT");
    expect(linhaDo(gravada, acidoFolico.code)["itemType"]).toBe("RAW_MATERIAL");

    await app.close();
  });

  it("cápsulas por embalagem que não fecham doses inteiras são recusadas, com o campo junto", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, { dosageForm: "CAPSULE" });
    const versao = await primeiraVersao(app, produto.id);

    const recusa = await gravar(app, versao.id, {
      dosageForm: "CAPSULE",
      capsulesPerDose: 7,
      capsulesPerPackage: 120,
    });
    expect(recusa.statusCode).toBe(400);
    const corpo = recusa.json();
    expect(corpo.error).toBe("validation_error");
    expect(corpo.issues[0].path).toBe("capsulesPerPackage");
    expect(corpo.issues[0].message).toMatch(/múltiplo de cápsulas por dose/i);

    // Nada foi gravado pela metade.
    const lida = (
      await app.inject({ method: "GET", url: `/formulation-versions/${versao.id}` })
    ).json();
    expect(lida.capsulesPerDose).toBeNull();
    expect(lida.dosesPerPackage).toBeNull();

    await app.close();
  });
});

describe("Bancada — pó (Beef Protein Abacaxi 900 g)", () => {
  it("dose e conteúdo fecham as doses da embalagem, e o pó não tem valor por cápsula", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, { dosageForm: "POWDER", presentationType: "POT" });
    const versao = await primeiraVersao(app, produto.id);
    const beef = await criarItem(app, {
      type: "RAW_MATERIAL",
      unitCode: "kg",
      defaultPurityPercent: "95",
      sourceName: "Proteína bovina",
    });
    const xantana = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });

    const gravada = await gravarOk(app, versao.id, {
      calculationMode: "PER_DOSE",
      dosageForm: "POWDER",
      presentationType: "POT",
      doseAmount: "30000",
      doseUomCode: "mg",
      packageContentAmount: "900",
      packageContentUomCode: "g",
      components: [porDose(beef.id, "26000", "95"), porDose(xantana.id, "30", "100")],
    });

    expect(gravada.dosesPerPackage).toBe(30);
    expect(gravada.capsulesPerDose).toBeNull();
    expect(gravada.capsulesPerPackage).toBeNull();
    expect(gravada.doseAmount).toBe("30000");
    expect(gravada.packageContentAmount).toBe("900");

    const linha = linhaDo(gravada, beef.code);
    bate(linha["physicalPerDose"] as string, "27368.42105263158", "beef por dose");
    expect(linha["physicalPerCapsule"], "pó não tem mg por cápsula").toBeNull();
    // Por embalagem, na unidade de estoque: 27.368,42… mg × 30 doses = 0,821052… kg.
    bate(linha["physicalPerUnit"] as string, "0.8210526315789474", "beef por embalagem (kg)");
    bate(linhaDo(gravada, xantana.code)["physicalPerDose"] as string, "30", "xantana por dose");

    await app.close();
  });

  it("conteúdo que não dá doses inteiras é recusado, não arredondado", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, { dosageForm: "POWDER" });
    const versao = await primeiraVersao(app, produto.id);

    const recusa = await gravar(app, versao.id, {
      dosageForm: "POWDER",
      doseAmount: "35",
      doseUomCode: "g",
      packageContentAmount: "900",
      packageContentUomCode: "g",
    });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().issues[0].path).toBe("packageContentAmount");
    expect(recusa.json().issues[0].message).toMatch(/número inteiro de doses/i);

    await app.close();
  });
});

describe("Bancada — história da versão", () => {
  it("mudar a pureza do Item depois não mexe na versão; o cadastro de hoje aparece ao lado", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, { dosageForm: "CAPSULE" });
    const versao = await primeiraVersao(app, produto.id);
    const item = await criarItem(app, {
      type: "RAW_MATERIAL",
      unitCode: "kg",
      defaultPurityPercent: "70",
    });

    await gravarOk(app, versao.id, {
      calculationMode: "PER_DOSE",
      dosageForm: "CAPSULE",
      capsulesPerDose: 1,
      capsulesPerPackage: 120,
      components: [porDose(item.id, "0.4", "70")],
    });

    const alterado = await app.inject({
      method: "PATCH",
      url: `/items/${item.id}`,
      payload: { defaultPurityPercent: "99" },
    });
    expect(alterado.statusCode, `alteração do item falhou: ${alterado.body}`).toBeLessThan(400);

    const relida = (
      await app.inject({ method: "GET", url: `/formulation-versions/${versao.id}` })
    ).json();
    const linha = linhaDo(relida, item.code);
    expect(linha["purityPercentApplied"], "a pureza da versão é snapshot").toBe("70");
    expect(linha["itemDefaultPurityPercent"], "o cadastro de hoje é outra coisa").toBe("99");
    bate(linha["physicalPerDose"] as string, "0.57142857142857151", "física por dose não mudou");

    await app.close();
  });

  it("versão nova herda a apresentação da que a originou", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, { dosageForm: "CAPSULE" });
    const versao = await primeiraVersao(app, produto.id);
    const item = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });

    await gravarOk(app, versao.id, {
      calculationMode: "PER_DOSE",
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 2,
      capsulesPerPackage: 120,
      components: [porDose(item.id, "250", "100")],
    });
    const ativada = await app.inject({
      method: "POST",
      url: `/formulation-versions/${versao.id}/activate`,
    });
    expect(ativada.statusCode, `ativação falhou: ${ativada.body}`).toBeLessThan(400);

    const nova = (
      await app.inject({ method: "POST", url: `/formulation-versions/${versao.id}/new-version` })
    ).json();
    expect(nova.dosageForm).toBe("CAPSULE");
    expect(nova.presentationType).toBe("POT");
    expect(nova.capsulesPerDose).toBe(2);
    expect(nova.dosesPerPackage).toBe(60);
    expect(nova.capsulesPerPackage).toBe(120);
    bate(linhaDo(nova, item.code)["physicalPerCapsule"] as string, "125", "por cápsula na cópia");

    await app.close();
  });

  it("versão ativa não aceita troca de apresentação — muda quem é rascunho", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, { dosageForm: "CAPSULE" });
    const versao = await primeiraVersao(app, produto.id);
    const item = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });
    await gravarOk(app, versao.id, {
      calculationMode: "PER_DOSE",
      dosageForm: "CAPSULE",
      capsulesPerDose: 1,
      capsulesPerPackage: 60,
      components: [porDose(item.id, "100", "100")],
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${versao.id}/activate` });

    const recusa = await gravar(app, versao.id, { dosageForm: "POWDER" });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().error).toBe("version_not_draft");

    await app.close();
  });
});
