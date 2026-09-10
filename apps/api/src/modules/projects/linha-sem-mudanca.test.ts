import type { UomDimension } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Pedido sem mudança não é mudança de negócio — QUOTE-LINE-NOOP-BLUR-01.
 *
 * A tela gravava a linha a cada saída de campo, mesmo sem alteração, e
 * `updateQuoteLine` tratava a PRESENÇA da quantidade ou da unidade no pedido
 * como mudança: soltava o preço herdado da condição acordada (§74). Um Tab por
 * cima do campo desfazia a decisão "manter condição" — sumiam o preço, a
 * origem e o vínculo com a linha do acordo.
 *
 * O que estes casos fixam:
 *
 * 1. quantidade, unidade ou preço iguais ao gravado — em qualquer formato
 *    decimal equivalente — não mexem em nada, nem na trava da faixa;
 * 2. mudança REAL de quantidade ou de unidade continua soltando o preço
 *    herdado ou reajustado, exatamente como antes;
 * 3. num pedido misto, só o campo que mudou produz efeito;
 * 4. versão que não é rascunho continua recusando, com ou sem mudança.
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const VALIDADE_FUTURA = "2099-12-31";

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "0.001" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProjectIds.length > 0) {
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrder: { sourceProjectId: { in: fixtureProjectIds } } },
    });
    await prisma.customerOrder.deleteMany({ where: { sourceProjectId: { in: fixtureProjectIds } } });
    // A herança é uma FK entre linhas: soltar o vínculo antes de apagar evita
    // que a ordem de remoção dependa de sorte.
    await prisma.quoteLine.updateMany({
      where: { quoteVersion: { projectId: { in: fixtureProjectIds } } },
      data: { inheritedFromQuoteLineId: null },
    });
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

async function criarProjeto(app: App) {
  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-NOOP-${m}`, legalName: `Cliente Sem Mudança ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);

  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: `Projeto Sem Mudança ${m}`,
        customerId: customer.id,
        entryDate: new Date().toISOString(),
      },
    })
  ).json();
  fixtureProjectIds.push(project.id);

  const preparado = (
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/technical-product`,
      payload: { finishedUnitCode: "un" },
    })
  ).json();
  fixtureProductIds.push(preparado.productId);

  return { projectId: project.id as string };
}

async function abrirOrcamento(app: App, projectId: string) {
  const quote = (
    await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })
  ).json();
  if (quote.lines.length > 0) return quote;

  const produtos = (
    await app.inject({ method: "GET", url: `/projects/${projectId}/products` })
  ).json().products as { id: string; status: string }[];
  const alvo = produtos.find((produto) => produto.status !== "OUT_OF_SCOPE") ?? produtos[0]!;
  return (
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: alvo.id },
    })
  ).json();
}

function definirLinha(
  app: App,
  lineId: string,
  campos: { quotedQuantity?: string; uomCode?: string; unitPrice?: string },
) {
  return app.inject({ method: "PATCH", url: `/quote-lines/${lineId}`, payload: campos });
}

/**
 * Ciclo comercial fechado — enviado, aceito, projeto aprovado e Pedido
 * gerado. Com o Pedido, a proposta aceita continua sendo a condição acordada
 * (COM-CORE), e é dela que a versão seguinte herda.
 */
async function cicloFechado(app: App) {
  const { projectId } = await criarProjeto(app);
  const quote = await abrirOrcamento(app, projectId);
  const lineId = quote.lines[0].id as string;

  await definirLinha(app, lineId, { quotedQuantity: "1000", uomCode: "un", unitPrice: "12.50" });
  await app.inject({
    method: "PATCH",
    url: `/quote-versions/${quote.id}`,
    payload: { validUntil: VALIDADE_FUTURA },
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/send`,
        payload: { confirmIncompleteCost: true },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` })).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: "POST", url: `/projects/${projectId}/approve`, payload: {} }))
      .statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/create-order` }))
      .statusCode,
  ).toBe(201);

  return { projectId, lineId };
}

/** A recompra: a versão nova nasce com o preço acordado, herdado. */
async function recompra(app: App) {
  const primeiro = await cicloFechado(app);
  const nova = await abrirOrcamento(app, primeiro.projectId);
  return { primeiro, lineId: nova.lines[0].id as string };
}

/** A linha como está no banco — tudo o que a decisão de preço carrega. */
async function linhaGravada(lineId: string) {
  const linha = await getPrisma().quoteLine.findUniqueOrThrow({ where: { id: lineId } });
  return {
    quotedQuantity: linha.quotedQuantity?.toString() ?? null,
    uomCode: linha.uomCode,
    unitPrice: linha.unitPrice?.toString() ?? null,
    priceSource: linha.priceSource,
    priceOrigin: linha.priceOrigin,
    inheritedFromQuoteLineId: linha.inheritedFromQuoteLineId,
    adjustmentPercent: linha.adjustmentPercent?.toString() ?? null,
    priceOriginReason: linha.priceOriginReason,
  };
}

/** Quando a linha foi gravada pela última vez — pedido sem mudança nem a toca. */
async function ultimaGravacao(lineId: string) {
  const linha = await getPrisma().quoteLine.findUniqueOrThrow({
    where: { id: lineId },
    select: { updatedAt: true },
  });
  return linha.updatedAt.toISOString();
}

describe("QUOTE-LINE-NOOP-BLUR-01 — pedido sem mudança não mexe na linha", () => {
  it.each([
    ["quantidade igual", { quotedQuantity: "1000" }],
    ["quantidade igual escrita com casas", { quotedQuantity: "1000.000000" }],
    ["unidade igual", { uomCode: "un" }],
    ["preço igual", { unitPrice: "12.5" }],
    ["os três iguais juntos", { quotedQuantity: "1000.0", uomCode: "un", unitPrice: "12.5000" }],
  ])("%s: o preço herdado, a origem e o vínculo ficam", async (_caso, campos) => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { primeiro, lineId } = await recompra(app);
    const antes = await linhaGravada(lineId);
    const gravadaEm = await ultimaGravacao(lineId);
    expect(antes.priceOrigin).toBe("INHERITED_AGREEMENT");
    expect(antes.inheritedFromQuoteLineId).toBe(primeiro.lineId);

    const resposta = await definirLinha(app, lineId, campos);

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await linhaGravada(lineId)).toEqual(antes);
    // Nem UPDATE houve: a linha não foi tocada.
    expect(await ultimaGravacao(lineId)).toBe(gravadaEm);

    await app.close();
  });

  it("reajustado: quantidade e unidade iguais não soltam o preço reajustado", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { primeiro, lineId } = await recompra(app);
    const reajustado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/adjust-price`,
      payload: { sourceQuoteLineId: primeiro.lineId, adjustmentPercent: "8" },
    });
    expect(reajustado.statusCode, reajustado.body).toBe(200);
    const antes = await linhaGravada(lineId);
    expect(antes.priceOrigin).toBe("ADJUSTED_AGREEMENT");

    const resposta = await definirLinha(app, lineId, { quotedQuantity: "1000", uomCode: "un" });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await linhaGravada(lineId)).toEqual(antes);

    await app.close();
  });

  it("linha presa à faixa: pedido sem mudança não é recusado; mudança real continua recusada", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { lineId } = await recompra(app);
    // A trava só lê `priceSource`: montar uma precificação inteira aqui não
    // acrescentaria nada ao que se testa.
    await getPrisma().quoteLine.update({ where: { id: lineId }, data: { priceSource: "PRICING_TIER" } });
    const antes = await linhaGravada(lineId);

    const semMudanca = await definirLinha(app, lineId, {
      quotedQuantity: "1000",
      uomCode: "un",
      unitPrice: "12.5",
    });
    expect(semMudanca.statusCode, semMudanca.body).toBe(200);
    expect(await linhaGravada(lineId)).toEqual(antes);

    const mudanca = await definirLinha(app, lineId, { quotedQuantity: "1200" });
    expect(mudanca.statusCode).toBe(409);
    expect(mudanca.json().error).toBe("price_locked");
    expect(await linhaGravada(lineId)).toEqual(antes);

    await app.close();
  });

  it("versão que não é rascunho continua recusando, mesmo sem mudança", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const primeiro = await cicloFechado(app);
    const antes = await linhaGravada(primeiro.lineId);

    const resposta = await definirLinha(app, primeiro.lineId, { quotedQuantity: "1000" });

    expect(resposta.statusCode).toBe(409);
    expect(await linhaGravada(primeiro.lineId)).toEqual(antes);

    await app.close();
  });
});

describe("QUOTE-LINE-NOOP-BLUR-01 — mudança real continua mudando", () => {
  it.each([
    ["quantidade mudou", { quotedQuantity: "1200" }, { quotedQuantity: "1200", uomCode: "un" }],
    ["unidade mudou", { uomCode: "kg" }, { quotedQuantity: "1000", uomCode: "kg" }],
    [
      "quantidade mudou e unidade igual",
      { quotedQuantity: "1200", uomCode: "un" },
      { quotedQuantity: "1200", uomCode: "un" },
    ],
    [
      "quantidade igual e unidade mudou",
      { quotedQuantity: "1000.0", uomCode: "kg" },
      { quotedQuantity: "1000", uomCode: "kg" },
    ],
    ["as duas mudaram", { quotedQuantity: "1", uomCode: "kg" }, { quotedQuantity: "1", uomCode: "kg" }],
  ])("%s: o preço herdado é solto, como antes (§74)", async (_caso, campos, esperado) => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { lineId } = await recompra(app);

    const resposta = await definirLinha(app, lineId, campos);

    expect(resposta.statusCode, resposta.body).toBe(200);
    const depois = await linhaGravada(lineId);
    expect(depois.quotedQuantity).toBe(esperado.quotedQuantity);
    expect(depois.uomCode).toBe(esperado.uomCode);
    expect(depois.unitPrice).toBeNull();
    expect(depois.priceOrigin).toBeNull();
    expect(depois.inheritedFromQuoteLineId).toBeNull();

    await app.close();
  });

  it("misto: quantidade igual e preço novo — só o preço muda, como decisão manual", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { lineId } = await recompra(app);
    const antes = await linhaGravada(lineId);

    const resposta = await definirLinha(app, lineId, { quotedQuantity: "1000.000", unitPrice: "13" });

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(await linhaGravada(lineId)).toEqual({
      ...antes,
      unitPrice: "13",
      priceOrigin: "MANUAL",
      inheritedFromQuoteLineId: null,
      adjustmentPercent: null,
      priceOriginReason: null,
    });

    await app.close();
  });

  it("quantidade real e preço na mesma edição: o preço informado ganha da limpeza, como antes", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();

    const { lineId } = await recompra(app);

    const resposta = await definirLinha(app, lineId, { quotedQuantity: "1200", unitPrice: "12.50" });

    expect(resposta.statusCode, resposta.body).toBe(200);
    const depois = await linhaGravada(lineId);
    expect(depois.quotedQuantity).toBe("1200");
    expect(depois.unitPrice).toBe("12.5");
    expect(depois.priceOrigin).toBe("MANUAL");
    expect(depois.inheritedFromQuoteLineId).toBeNull();

    await app.close();
  });
});
