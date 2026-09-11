import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Duplicar como nova versão — QUOTE-DUPLICATE-01, `PRODUCT_RULES.md` §85.
 *
 * O que estes testes fixam:
 *
 * 1. **A fonte é a versão escolhida**, não a mais recente — e ela não muda.
 *    Nenhuma outra muda também: duplicar não substitui a enviada.
 * 2. **O preço é escolha explícita, sem padrão.** Manter copia `unitPrice`
 *    exatamente, sem vínculo com precificação; revisar deixa a linha sem
 *    preço. Sem estratégia não há duplicação.
 * 3. **A versão nova nasce rascunho**, com o próximo número, as condições
 *    comerciais da origem e nada do histórico dela.
 * 4. **Ou nasce inteira, ou nada nasce.**
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

/** Longe o bastante para nenhuma execução futura reprovar por calendário. */
const VALIDADE_FUTURA = "2099-12-31";
const VALIDADE_VENCIDA = "2020-01-31";

beforeAll(async () => {
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await getPrisma().unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  // Só o que ESTE arquivo criou — o banco é compartilhado com o app local.
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

async function criarProjeto(app: App) {
  const m = marca();
  const customer = await getPrisma().customer.create({
    data: { code: `CLI-DUP-${m}`, legalName: `Cliente Duplicar ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: `Projeto Duplicar ${m}`, customerId: customer.id, entryDate: new Date().toISOString() },
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
  return { project };
}

/** A V1 pelo caminho de sempre: rascunho, um produto, quantidade e preço. */
async function criarOrcamento(app: App, projectId: string, preco: string, quantidade = "100") {
  const produtos = (await app.inject({ method: "GET", url: `/projects/${projectId}/products` })).json()
    .products as { id: string }[];
  const quote = (await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })).json();
  const comLinha = (
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: produtos[0]!.id },
    })
  ).json();
  await precoDaLinha(app, comLinha.lines[0].id, preco, quantidade);
  return lerOrcamento(app, quote.id);
}

async function precoDaLinha(app: App, lineId: string, preco: string, quantidade?: string) {
  const resposta = await app.inject({
    method: "PATCH",
    url: `/quote-lines/${lineId}`,
    payload: { ...(quantidade ? { quotedQuantity: quantidade, uomCode: "un" } : {}), unitPrice: preco },
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
}

/** As condições comerciais que a duplicação precisa levar. */
async function condicoes(app: App, quoteId: string, validUntil = VALIDADE_FUTURA) {
  const resposta = await app.inject({
    method: "PATCH",
    url: `/quote-versions/${quoteId}`,
    payload: {
      validUntil,
      paymentTerms: "Boleto 28 dias",
      leadTimeDays: 45,
      commercialNotes: "Frete FOB — retirada na fábrica",
      discountPercent: "5",
      paymentMethod: "INSTALLMENTS",
      downPaymentPercent: "20",
      installmentCount: 3,
      installmentIntervalDays: 30,
      monthlyInterestPercent: "1.5",
    },
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
}

async function enviar(app: App, quoteId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/quote-versions/${quoteId}/send`,
    payload: { confirmIncompleteCost: true },
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
}

async function lerOrcamento(app: App, quoteId: string) {
  return (await app.inject({ method: "GET", url: `/quote-versions/${quoteId}` })).json();
}

function duplicar(app: App, quoteId: string, priceStrategy?: unknown) {
  return app.inject({
    method: "POST",
    url: `/quote-versions/${quoteId}/duplicate`,
    payload: priceStrategy === undefined ? {} : { priceStrategy },
  });
}

async function versoes(projectId: string) {
  return getPrisma().quoteVersion.findMany({
    where: { projectId },
    orderBy: { versionNumber: "asc" },
    select: { versionNumber: true, status: true },
  });
}

/** Uma V1 enviada, com condições — o ponto de partida da maioria dos casos. */
async function v1Enviada(app: App, preco = "12.3456") {
  const { project } = await criarProjeto(app);
  const v1 = await criarOrcamento(app, project.id, preco);
  await condicoes(app, v1.id);
  await enviar(app, v1.id);
  return { project, v1: await lerOrcamento(app, v1.id) };
}

const CONDICOES = [
  "validUntil",
  "currencyCode",
  "paymentTerms",
  "leadTimeDays",
  "commercialNotes",
  "discountPercent",
  "paymentMethod",
  "downPaymentPercent",
  "installmentCount",
  "installmentIntervalDays",
  "monthlyInterestPercent",
] as const;

describe("QUOTE-DUPLICATE-01 — duplicar como nova versão", () => {
  let app: App;

  beforeAll(async () => {
    app = buildTestApp("ADMIN");
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("duplica a versão atual mantendo os preços: rascunho, preço exato, condições, nada do histórico", async () => {
    const { v1 } = await v1Enviada(app);

    const resposta = await duplicar(app, v1.id, "KEEP_PRICES");
    expect(resposta.statusCode, resposta.body).toBe(201);
    const v2 = resposta.json();

    expect(v2.status).toBe("DRAFT");
    expect(v2.versionNumber).toBe(2);
    const [linha] = v2.lines;
    expect(linha.unitPrice).toBe("12.3456");
    expect(linha.quotedQuantity).toBe(v1.lines[0].quotedQuantity);
    expect(linha.uomCode).toBe("un");
    expect(linha.productId).toBe(v1.lines[0].productId);
    // Preço histórico preservado, sem vínculo falso com a precificação atual —
    // e proposta enviada é referência, não acordo.
    expect(linha.priceSource).toBe("MANUAL");
    expect(linha.priceOrigin).toBe("MANUAL");
    expect(linha.inheritedFromQuoteLineId).toBeNull();
    expect(linha.priceOriginReason).toMatch(/V1 \(Enviado\).*referência, não acordo/);
    const gravada = await getPrisma().quoteLine.findUniqueOrThrow({ where: { id: linha.id } });
    expect(gravada.pricingVersionId).toBeNull();
    expect(gravada.pricingTierId).toBeNull();
    expect(gravada.productCodeSnapshot).toBeNull();
    expect(gravada.industrialCostPerUnitSnapshot).toBeNull();

    for (const campo of CONDICOES) expect(v2[campo], campo).toEqual(v1[campo]);

    // Nada do que é história da origem.
    expect(v2.sentAt).toBeNull();
    expect(v2.sentByName).toBeNull();
    expect(v2.acceptedAt).toBeNull();
    expect(v2.rejectedAt).toBeNull();
    expect(v2.customerName).toBeNull();
    expect(v2.projectCode).toBeNull();
    expect(v2.sourcedOrder).toBeNull();

    // A origem continua exatamente como estava.
    expect(await lerOrcamento(app, v1.id)).toEqual(v1);
  });

  it("duplica uma versão HISTÓRICA: com V1..V3, partir da V1 cria a V4 com os preços da V1", async () => {
    const { project, v1 } = await v1Enviada(app, "10.1111");

    const v2 = (await duplicar(app, v1.id, "KEEP_PRICES")).json();
    await precoDaLinha(app, v2.lines[0].id, "20.2222");
    await enviar(app, v2.id);
    const v3 = (await duplicar(app, v2.id, "KEEP_PRICES")).json();
    await precoDaLinha(app, v3.lines[0].id, "30.3333");
    await enviar(app, v3.id);

    const resposta = await duplicar(app, v1.id, "KEEP_PRICES");
    expect(resposta.statusCode, resposta.body).toBe(201);
    const v4 = resposta.json();
    expect(v4.versionNumber).toBe(4);
    expect(v4.lines[0].unitPrice).toBe("10.1111");
    expect(v4.lines[0].priceOriginReason).toMatch(/V1/);

    // Duplicar não substitui ninguém: as três enviadas continuam enviadas.
    expect(await versoes(project.id)).toEqual([
      { versionNumber: 1, status: "SENT" },
      { versionNumber: 2, status: "SENT" },
      { versionNumber: 3, status: "SENT" },
      { versionNumber: 4, status: "DRAFT" },
    ]);
  });

  it("revisar os preços: mesmas linhas e quantidades, nenhum preço unitário", async () => {
    const { v1 } = await v1Enviada(app);

    const resposta = await duplicar(app, v1.id, "REVIEW_PRICES");
    expect(resposta.statusCode, resposta.body).toBe(201);
    const v2 = resposta.json();
    expect(v2.status).toBe("DRAFT");
    const [linha] = v2.lines;
    expect(linha.unitPrice).toBeNull();
    expect(linha.priceOrigin).toBeNull();
    expect(linha.inheritedFromQuoteLineId).toBeNull();
    expect(linha.priceOriginReason).toBeNull();
    expect(linha.quotedQuantity).toBe(v1.lines[0].quotedQuantity);
    expect(linha.uomCode).toBe("un");
    // Sem preço não há total — nunca R$ 0,00 no lugar de "falta decidir".
    expect(v2.total).toBeNull();
    for (const campo of CONDICOES) expect(v2[campo], campo).toEqual(v1[campo]);
    expect(await lerOrcamento(app, v1.id)).toEqual(v1);
  });

  it("origem ACEITA: manter vira a condição acordada, apontando para a linha real", async () => {
    const { v1 } = await v1Enviada(app);
    const aceita = await app.inject({ method: "POST", url: `/quote-versions/${v1.id}/accept` });
    expect(aceita.statusCode, aceita.body).toBe(200);

    const v2 = (await duplicar(app, v1.id, "KEEP_PRICES")).json();
    const [linha] = v2.lines;
    expect(linha.unitPrice).toBe("12.3456");
    expect(linha.priceOrigin).toBe("INHERITED_AGREEMENT");
    expect(linha.inheritedFromQuoteLineId).toBe(v1.lines[0].id);
    expect(linha.priceOriginReason).toMatch(/condição aceita/);
    expect(v2.status).toBe("DRAFT");
    expect(v2.acceptedAt).toBeNull();
    expect((await lerOrcamento(app, v1.id)).status).toBe("ACCEPTED");
  });

  it("validade vencida não vem junto: a versão nova nasce sem ela", async () => {
    const { project } = await criarProjeto(app);
    const v1 = await criarOrcamento(app, project.id, "15");
    await condicoes(app, v1.id, VALIDADE_VENCIDA);
    await enviar(app, v1.id);

    const v2 = (await duplicar(app, v1.id, "REVIEW_PRICES")).json();
    expect(v2.validUntil).toBeNull();
    expect(v2.paymentTerms).toBe("Boleto 28 dias");
  });

  it("estratégia ausente, nula ou desconhecida é 400 — e nada nasce", async () => {
    const { project, v1 } = await v1Enviada(app);

    for (const estrategia of [undefined, null, "COPY", "keep_prices"]) {
      const resposta = await duplicar(app, v1.id, estrategia);
      expect(resposta.statusCode, `${String(estrategia)}: ${resposta.body}`).toBe(400);
      expect(resposta.json().error).toBe("validation_error");
    }
    expect(await versoes(project.id)).toEqual([{ versionNumber: 1, status: "SENT" }]);
  });

  it("com rascunho aberto a duplicação é recusada em voz alta — e nada nasce", async () => {
    const { project, v1 } = await v1Enviada(app);
    const v2 = (await duplicar(app, v1.id, "REVIEW_PRICES")).json();

    for (const fonte of [v1.id, v2.id]) {
      const recusada = await duplicar(app, fonte, "KEEP_PRICES");
      expect(recusada.statusCode).toBe(409);
      expect(recusada.json().error).toBe("quote_draft_exists");
      expect(recusada.json().message).toMatch(/V2 em rascunho/);
    }
    expect(await versoes(project.id)).toEqual([
      { versionNumber: 1, status: "SENT" },
      { versionNumber: 2, status: "DRAFT" },
    ]);
  });

  it("falha no meio não deixa versão parcial: ou nasce inteira, ou nada", async () => {
    const { project, v1 } = await v1Enviada(app);
    const prisma = getPrisma();

    // As linhas falham DEPOIS de o cabeçalho da versão ter sido inserido.
    const comFalhaNasLinhas = (tx: object): object =>
      new Proxy(tx, {
        get(alvo, chave) {
          const valor = Reflect.get(alvo, chave) as unknown;
          if (chave === "quoteLine") {
            return new Proxy(valor as object, {
              get(delegado, metodo) {
                if (metodo === "createMany") {
                  return () => Promise.reject(new Error("falha simulada no meio da duplicação"));
                }
                const funcao = Reflect.get(delegado, metodo) as unknown;
                return typeof funcao === "function" ? funcao.bind(delegado) : funcao;
              },
            });
          }
          return typeof valor === "function" ? valor.bind(alvo) : valor;
        },
      });
    const original = prisma.$transaction.bind(prisma) as (
      fn: (tx: object) => Promise<unknown>,
      options?: unknown,
    ) => Promise<unknown>;
    /*
     * Troca e devolve à mão: o `$transaction` do Prisma mora atrás de um proxy
     * que informa um descritor SEM o valor real — redefinir com ele, como o
     * `mockRestore` do `vi.spyOn` faz, deixa o cliente sem `$transaction` para o
     * resto do processo. Apagar a sobreposição devolve a original.
     */
    const cliente = prisma as unknown as Record<string, unknown>;
    Object.defineProperty(cliente, "$transaction", {
      configurable: true,
      writable: true,
      value: (fn: (tx: object) => Promise<unknown>, options?: unknown) =>
        original((tx) => fn(comFalhaNasLinhas(tx)), options),
    });

    try {
      const falhou = await duplicar(app, v1.id, "KEEP_PRICES");
      expect(falhou.statusCode).toBe(500);
    } finally {
      delete cliente.$transaction;
    }
    expect(await versoes(project.id)).toEqual([{ versionNumber: 1, status: "SENT" }]);

    // O número não foi consumido: a próxima tentativa é a V2, inteira.
    const v2 = (await duplicar(app, v1.id, "KEEP_PRICES")).json();
    expect(v2.versionNumber).toBe(2);
    expect(v2.lines).toHaveLength(1);
  });
});
