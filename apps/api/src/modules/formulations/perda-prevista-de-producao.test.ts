import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { Decimal } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { diaComercialDeTeste } from "../../test-support/dia-comercial.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * PERDA PREVISTA DE PRODUÇÃO — premissa da versão (FORMULATION-WORKBENCH-01).
 *
 * A pergunta desta suíte é onde a premissa chega e, principalmente, onde ela
 * NÃO chega:
 *
 * - chega ao planejamento interno e ao custo estimado por unidade vendável;
 * - NÃO chega à composição da dose nem da cápsula;
 * - NÃO chega à embalagem comercial, que continua atrelada à unidade vendida;
 * - NÃO chega a quantidade comercial nenhuma.
 */

type App = ReturnType<typeof buildTestApp>;

const fixtureItemIds: string[] = [];
const fixtureProductIds: string[] = [];

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

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
    await prisma.itemCostReference.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarItem(app: App, payload: Record<string, unknown>) {
  const resposta = await app.inject({
    method: "POST",
    url: "/items",
    payload: { name: `PERDA ${marca()}`, ...payload },
  });
  expect(resposta.statusCode, `criação do item falhou: ${resposta.body}`).toBeLessThan(400);
  const item = resposta.json();
  fixtureItemIds.push(item.id);
  return item as { id: string; code: string };
}

async function criarProduto(app: App, perfil: Record<string, unknown> = {}) {
  const acabado = await criarItem(app, { type: "FINISHED_PRODUCT", unitCode: "un" });
  const resposta = await app.inject({
    method: "POST",
    url: "/products",
    payload: {
      customerId: await fixtureCustomerId(),
      name: `PERDA produto ${marca()}`,
      finishedProductItemId: acabado.id,
      ...perfil,
    },
  });
  expect(resposta.statusCode, `criação do produto falhou: ${resposta.body}`).toBeLessThan(400);
  const produto = resposta.json();
  fixtureProductIds.push(produto.id);
  return produto as { id: string };
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

async function referenciaManual(app: App, itemId: string, unitCost: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/items/${itemId}/cost-references`,
    payload: { unitCost, effectiveFrom: diaComercialDeTeste() },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
}

async function estimativa(app: App, versaoId: string) {
  const resposta = await app.inject({
    method: "GET",
    url: `/formulation-versions/${versaoId}/cost-estimate`,
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json();
}

function linhaDo(dto: { components: { itemCode: string }[] }, code: string) {
  const linha = dto.components.find((c) => c.itemCode === code);
  expect(linha, `componente ${code} não voltou`).toBeTruthy();
  return linha as Record<string, unknown> & { itemCode: string };
}

describe("Perda prevista — snapshot da versão", () => {
  it("grava, devolve e apaga sem virar zero", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app, { dosageForm: "CAPSULE", presentationType: "POT" });
    const versao = await primeiraVersao(app, produto.id);

    // Versão nova nasce SEM premissa: ausência é "não informada", nunca 0%.
    expect(versao.expectedLossPercent).toBeNull();

    const comPerda = await gravarOk(app, versao.id, { expectedLossPercent: "1" });
    expect(new Decimal(comPerda.expectedLossPercent).equals(1)).toBe(true);

    const semPerda = await gravarOk(app, versao.id, { expectedLossPercent: null });
    expect(semPerda.expectedLossPercent).toBeNull();

    await app.close();
  });

  it("recusa percentual fora da faixa [0, 100) sem gravar metade", async () => {
    const app = buildTestApp();
    await app.ready();

    const produto = await criarProduto(app);
    const versao = await primeiraVersao(app, produto.id);
    await gravarOk(app, versao.id, { expectedLossPercent: "1" });

    // 100% de perda não tem quantidade bruta: nada sai da produção.
    const cem = await gravar(app, versao.id, { expectedLossPercent: "100", notes: "não grava" });
    expect(cem.statusCode).toBe(400);

    const depois = await app.inject({ method: "GET", url: `/formulation-versions/${versao.id}` });
    const dto = depois.json();
    expect(new Decimal(dto.expectedLossPercent).equals(1)).toBe(true);
    expect(dto.notes ?? "").not.toBe("não grava");

    await app.close();
  });

  it("a versão nova copia a premissa da que serviu de molde", async () => {
    const app = buildTestApp();
    await app.ready();

    const materia = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });
    const produto = await criarProduto(app, { dosageForm: "CAPSULE", presentationType: "POT" });
    const versao = await primeiraVersao(app, produto.id);
    await gravarOk(app, versao.id, {
      dosageForm: "CAPSULE",
      capsulesPerDose: 1,
      capsulesPerPackage: 120,
      expectedLossPercent: "1.5",
      components: [
        {
          itemId: materia.id,
          quantity: "0.4",
          unitCode: "mg",
          basis: "PER_DOSE",
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          applyPurityAdjustment: true,
          purityPercentApplied: "70",
        },
      ],
    });
    const ativada = await app.inject({
      method: "POST",
      url: `/formulation-versions/${versao.id}/activate`,
    });
    expect(ativada.statusCode, ativada.body).toBeLessThan(400);

    const nova = await app.inject({
      method: "POST",
      url: `/formulation-versions/${versao.id}/new-version`,
    });
    expect(nova.statusCode, nova.body).toBeLessThan(400);
    expect(new Decimal(nova.json().expectedLossPercent).equals("1.5")).toBe(true);

    await app.close();
  });
});

describe("Ordem das linhas da receita", () => {
  it("a ordem gravada volta na leitura, e não a ordem de inserção do banco", async () => {
    const app = buildTestApp();
    await app.ready();

    const a = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });
    const b = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });
    const c = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });
    const produto = await criarProduto(app);
    const versao = await primeiraVersao(app, produto.id);

    const linha = (itemId: string) => ({ itemId, quantity: "1", unitCode: "kg" });

    const original = await gravarOk(app, versao.id, {
      basisQuantity: "1",
      components: [linha(a.id), linha(b.id), linha(c.id)],
    });
    expect(original.components.map((x: { itemCode: string }) => x.itemCode)).toEqual([
      a.code,
      b.code,
      c.code,
    ]);

    // Reordenado na tela: C, A, B. A gravação escreve `position` pelo índice.
    const reordenado = await gravarOk(app, versao.id, {
      components: [linha(c.id), linha(a.id), linha(b.id)],
    });
    expect(reordenado.components.map((x: { itemCode: string }) => x.itemCode)).toEqual([
      c.code,
      a.code,
      b.code,
    ]);

    /*
     * A ordem sobrevive a uma LEITURA NOVA, e não só à resposta do PATCH.
     *
     * Nota honesta sobre o alcance deste caso: ele NÃO distingue a leitura com
     * `orderBy: position` da leitura sem. Tentei construir a diferença — pondo
     * a ordem física e a de `position` em desacordo com UPDATEs diretos — e o
     * Postgres devolveu na ordem de `position` nas duas versões. O `orderBy` do
     * serviço é garantia explícita, do mesmo tipo que Pedido, Faturamento e
     * Ordem de Produção já têm, não correção de um defeito observado. O que
     * este caso guarda de verdade é a ESCRITA: `position` pelo índice do array
     * e o DTO devolvendo nessa ordem — é isso que quebra se alguém passar a
     * ordenar o payload ou parar de gravar a posição.
     */
    const relido = await app.inject({ method: "GET", url: `/formulation-versions/${versao.id}` });
    expect(relido.json().components.map((x: { itemCode: string }) => x.itemCode)).toEqual([
      c.code,
      a.code,
      b.code,
    ]);

    await app.close();
  });
});

describe("Perda prevista — o que ela NÃO muda", () => {
  it("a física por dose e por cápsula do Ácido Fólico continua 0,571428… mg", async () => {
    const app = buildTestApp();
    await app.ready();

    const acidoFolico = await criarItem(app, {
      type: "RAW_MATERIAL",
      unitCode: "kg",
      defaultPurityPercent: "70",
    });
    const produto = await criarProduto(app, { dosageForm: "CAPSULE", presentationType: "POT" });
    const versao = await primeiraVersao(app, produto.id);

    const linha = {
      itemId: acidoFolico.id,
      quantity: "0.4",
      unitCode: "mg",
      basis: "PER_DOSE" as const,
      quantityMode: "THEORETICAL_WITH_ADJUSTMENTS" as const,
      applyPurityAdjustment: true,
      purityPercentApplied: "70",
      // Reserva de matéria-prima de 10%, registrada e não aplicada — é a
      // linha real da planilha do Ácido Fólico.
      overagePercent: "10",
      applyOverageAdjustment: false,
    };

    const sem = await gravarOk(app, versao.id, {
      dosageForm: "CAPSULE",
      capsulesPerDose: 1,
      capsulesPerPackage: 120,
      components: [linha],
    });
    const com = await gravarOk(app, versao.id, {
      expectedLossPercent: "1",
      components: [linha],
    });

    const antes = linhaDo(sem, acidoFolico.code);
    const depois = linhaDo(com, acidoFolico.code);
    for (const campo of ["physicalPerDose", "physicalPerCapsule", "theoreticalPerDose"] as const) {
      expect(depois[campo], `${campo} mudou com a perda prevista`).toBe(antes[campo]);
    }
    expect(new Decimal(String(depois.physicalPerDose)).toFixed(12)).toBe("0.571428571429");

    await app.close();
  });
});

describe("Perda prevista — custo estimado interno", () => {
  it("escala a matéria-prima, não a embalagem comercial, e o divisor é a quantidade vendável", async () => {
    const app = buildTestApp();
    await app.ready();

    const materia = await criarItem(app, { type: "RAW_MATERIAL", unitCode: "kg" });
    const pote = await criarItem(app, { type: "PACKAGING", unitCode: "un" });
    await referenciaManual(app, materia.id, "100");
    await referenciaManual(app, pote.id, "2");

    const produto = await criarProduto(app);
    const versao = await primeiraVersao(app, produto.id);
    const componentes = [
      // 1 kg de matéria-prima para a base de 1 un: base fixa, que acompanha o
      // que é PRODUZIDO.
      { itemId: materia.id, quantity: "1", unitCode: "kg", basis: "FIXED_BASIS" },
      // 1 pote por unidade acabada: acompanha o que é VENDIDO.
      { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
    ];

    await gravarOk(app, versao.id, { basisQuantity: "1", components: componentes });
    const sem = await estimativa(app, versao.id);
    expect(sem.expectedLossPercent).toBeNull();
    expect(sem.grossPlannedQuantity).toBeNull();
    expect(linhaDo(sem, materia.code).expectedLossApplied).toBe(false);

    await gravarOk(app, versao.id, { expectedLossPercent: "1", components: componentes });
    const com = await estimativa(app, versao.id);

    // A premissa e o que ela derivou vêm ditas no DTO.
    expect(new Decimal(com.expectedLossPercent).equals(1)).toBe(true);
    expect(new Decimal(com.expectedYieldPercent).equals(99)).toBe(true);
    expect(new Decimal(com.grossPlannedQuantity).toFixed(6)).toBe("1.010101");

    // Matéria-prima: 1 kg ÷ 0,99 = 1,010101… kg, e a linha DIZ que carrega a perda.
    const linhaMateria = linhaDo(com, materia.code);
    expect(linhaMateria.expectedLossApplied).toBe(true);
    expect(new Decimal(String(linhaMateria.requiredQuantity)).toFixed(6)).toBe("1.010101");

    // Embalagem: continua 1 pote por unidade vendável. A perda não vende pote.
    const linhaPote = linhaDo(com, pote.code);
    expect(linhaPote.expectedLossApplied).toBe(false);
    expect(new Decimal(String(linhaPote.requiredQuantity)).equals(1)).toBe(true);
    expect(linhaPote.estimatedComponentCost).toBe(linhaDo(sem, pote.code).estimatedComponentCost);

    // Custo por unidade VENDÁVEL: o divisor continua a base líquida, então o
    // material perdido vira custo da unidade boa. 100 × 1,010101… + 2 = 103,01.
    expect(new Decimal(com.estimatedMaterialCost).toFixed(2)).toBe("103.01");
    expect(new Decimal(sem.estimatedMaterialCost).toFixed(2)).toBe("102.00");
    expect(
      new Decimal(com.estimatedMaterialUnitCost).greaterThan(sem.estimatedMaterialUnitCost),
    ).toBe(true);
    expect(new Decimal(com.basisQuantity).equals(1)).toBe(true);

    await app.close();
  });
});

/**
 * REGRA CRÍTICA — a perda prevista NUNCA altera quantidade comercial.
 *
 * Esta guarda não mede comportamento: ela mede ALCANCE. Um teste de Orçamento
 * prova um caminho de cada vez, e a regra é sobre todos — Orçamento, Pedido,
 * entrega, faturamento, precificação. O que a torna verdadeira é a premissa não
 * ser LEGÍVEL fora do punhado de arquivos que planejam produção e estimam
 * custo. Se um módulo comercial passar a ler `expectedLossPercent`, a regra
 * deixou de valer por construção, e é aqui que isso aparece.
 *
 * Comentário não conta: vários fontes citam o nome para explicar o limite.
 */
const RAIZ_DA_API = join(import.meta.dirname, "..", "..");

/**
 * Onde a premissa PODE ser lida: a formulação que a edita, a estimativa de
 * custo que a usa e o motor de necessidade que a aplica quando pedido.
 */
const MODULOS_AUTORIZADOS = [
  "modules/formulations/formulations.service.ts",
  "modules/formulations/formulations.schemas.ts",
  "modules/costs/costs.service.ts",
  "modules/production-orders/requirement-calc.ts",
];

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");
}

function fontesDeProducao(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) return fontesDeProducao(caminho);
    return entrada.name.endsWith(".ts") && !entrada.name.includes(".test.") ? [caminho] : [];
  });
}

describe("Perda prevista — fora do comercial por construção", () => {
  it("nenhum módulo além dos autorizados lê expectedLossPercent", () => {
    const leitores = fontesDeProducao(RAIZ_DA_API)
      .filter((arquivo) => semComentarios(readFileSync(arquivo, "utf8")).includes("expectedLossPercent"))
      .map((arquivo) => relative(RAIZ_DA_API, arquivo).split("\\").join("/"))
      .sort();

    expect(leitores).toEqual([...MODULOS_AUTORIZADOS].sort());
  });

  it("a lista autorizada não tem nenhum módulo comercial", () => {
    const comerciais = [
      "customer-orders",
      "projects",
      "billings",
      "pricing",
      "shipments",
      "customer-consultation",
      "finished-goods",
    ];
    for (const modulo of comerciais) {
      expect(
        MODULOS_AUTORIZADOS.some((arquivo) => arquivo.includes(`modules/${modulo}/`)),
        `${modulo} não pode ler a perda prevista: quantidade comercial é a contratada`,
      ).toBe(false);
    }
  });
});
