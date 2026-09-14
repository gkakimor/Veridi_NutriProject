import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * QUOTES-HUB-01 — `GET /quote-versions`, a lista geral de Orçamentos.
 *
 * Uma linha por VERSÃO, de todos os projetos, só para encontrar e abrir a
 * página da versão. O que estes testes fixam:
 *
 * 1. filtros no servidor — cliente, projeto, status (um ou vários), período da
 *    data do orçamento em dia civil e busca por código, cliente e projeto;
 * 2. paginação no servidor, com `page`/`pageSize` estritos;
 * 3. o total é o do documento (`GET /quote-versions/:id`), conta do servidor;
 * 4. cliente e projeto seguem a regra do documento: rascunho lê o cadastro,
 *    enviada lê o snapshot do envio — e a busca acha pelos dois.
 *
 * Toda consulta é recortada pelo cliente ou pelo projeto das fixtures: o banco
 * de teste é compartilhado, e contagem global mediria o que outro arquivo gravou.
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

interface Linha {
  id: string;
  code: string;
  versionLabel: string;
  status: string;
  projectId: string;
  projectCode: string | null;
  projectName: string | null;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  productCount: number;
  total: string | null;
  quoteDate: string;
  validUntil: string | null;
  expired: boolean;
  sourcedOrder: { id: string; code: string } | null;
}

interface Resposta {
  quoteVersions: Linha[];
  page: number;
  pageSize: number;
  total: number;
}

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
  // Só o que ESTE arquivo criou.
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

async function cliente(nome: string) {
  const customer = await getPrisma().customer.create({
    data: { code: `CLI-HUB-${marca()}`, legalName: nome, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

/** Projeto do cliente com a V1 em rascunho: com produto e preço, ou vazia. */
async function projetoComVersao(
  app: App,
  customerId: string,
  nome: string,
  preco: string | null,
): Promise<{ projectId: string; projectCode: string; quoteId: string; quoteCode: string }> {
  const projeto = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: nome, customerId, entryDate: new Date().toISOString() },
  });
  expect(projeto.statusCode, projeto.body).toBe(201);
  const project = projeto.json();
  fixtureProjectIds.push(project.id);

  let quote: { id: string; code: string };
  if (preco === null) {
    quote = (await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })).json();
  } else {
    const preparado = (
      await app.inject({
        method: "POST",
        url: `/projects/${project.id}/technical-product`,
        payload: { finishedUnitCode: "un" },
      })
    ).json();
    fixtureProductIds.push(preparado.productId);
    const produtos = (
      await app.inject({ method: "GET", url: `/projects/${project.id}/products` })
    ).json().products as { id: string }[];
    quote = (await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })).json();
    const comLinha = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/lines`,
        payload: { projectProductId: produtos[0]!.id },
      })
    ).json();
    const linha = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${comLinha.lines[0].id}`,
      payload: { quotedQuantity: "100", uomCode: "un", unitPrice: preco },
    });
    expect(linha.statusCode, linha.body).toBe(200);
  }
  const validade = await app.inject({
    method: "PATCH",
    url: `/quote-versions/${quote.id}`,
    payload: { validUntil: "2099-12-31" },
  });
  expect(validade.statusCode, validade.body).toBe(200);
  return { projectId: project.id, projectCode: project.code, quoteId: quote.id, quoteCode: quote.code };
}

async function enviar(app: App, quoteId: string) {
  const resposta = await app.inject({
    method: "POST",
    url: `/quote-versions/${quoteId}/send`,
    payload: { confirmIncompleteCost: true },
  });
  expect(resposta.statusCode, resposta.body).toBe(200);
}

/** A data do documento como a tela a grava: meia-noite UTC do dia civil. */
async function dataDoOrcamento(quoteId: string, dia: string) {
  await getPrisma().quoteVersion.update({
    where: { id: quoteId },
    data: { quoteDate: new Date(`${dia}T00:00:00.000Z`) },
  });
}

describe("QUOTES-HUB-01 — GET /quote-versions", () => {
  let app: App;
  const m = marca();
  const nomes = {
    alfa: `Cliente Hub Alfa ${m} Ltda`,
    beta: `Cliente Hub Beta ${m} Ltda`,
    projetoTres: `Projeto Hub Tres ${m}`,
  };
  let alfa: { id: string };
  let beta: { id: string };
  /** Alfa: enviada (10/03/2031) e recusada (12/03). Beta: rascunho com preço (11/03) e rascunho vazio (09/03). */
  let enviada: Awaited<ReturnType<typeof projetoComVersao>>;
  let recusada: Awaited<ReturnType<typeof projetoComVersao>>;
  let rascunho: Awaited<ReturnType<typeof projetoComVersao>>;
  let vazio: Awaited<ReturnType<typeof projetoComVersao>>;

  async function listar(query: string): Promise<Resposta> {
    const resposta = await app.inject({ method: "GET", url: `/quote-versions?${query}` });
    expect(resposta.statusCode, resposta.body).toBe(200);
    return resposta.json() as Resposta;
  }

  const ids = (resposta: Resposta) => resposta.quoteVersions.map((linha) => linha.id);

  beforeAll(async () => {
    app = buildTestApp("ADMIN");
    await app.ready();

    alfa = await cliente(nomes.alfa);
    beta = await cliente(nomes.beta);

    enviada = await projetoComVersao(app, alfa.id, `Projeto Hub Um ${m}`, "12.3456");
    await enviar(app, enviada.quoteId);
    await dataDoOrcamento(enviada.quoteId, "2031-03-10");

    recusada = await projetoComVersao(app, alfa.id, `Projeto Hub Dois ${m}`, "10");
    await enviar(app, recusada.quoteId);
    const recusa = await app.inject({
      method: "POST",
      url: `/quote-versions/${recusada.quoteId}/reject`,
      payload: { reason: "Preço" },
    });
    expect(recusa.statusCode, recusa.body).toBe(200);
    await dataDoOrcamento(recusada.quoteId, "2031-03-12");

    rascunho = await projetoComVersao(app, beta.id, nomes.projetoTres, "12.3456");
    // Desconto: o total da lista tem de ser o do documento, não a soma das linhas.
    const desconto = await app.inject({
      method: "PATCH",
      url: `/quote-versions/${rascunho.quoteId}`,
      payload: { discountPercent: "10" },
    });
    expect(desconto.statusCode, desconto.body).toBe(200);
    await dataDoOrcamento(rascunho.quoteId, "2031-03-11");

    vazio = await projetoComVersao(app, beta.id, `Projeto Hub Quatro ${m}`, null);
    await dataDoOrcamento(vazio.quoteId, "2031-03-09");
  });

  afterAll(async () => {
    await app.close();
  });

  it("cliente: as versões dele, da data mais nova para a mais antiga, com o que a linha mostra", async () => {
    const resposta = await listar(`customerId=${alfa.id}`);
    expect(resposta.total).toBe(2);
    expect(ids(resposta)).toEqual([recusada.quoteId, enviada.quoteId]);

    const linha = resposta.quoteVersions[1]!;
    expect(linha).toMatchObject({
      code: enviada.quoteCode,
      versionLabel: `${enviada.quoteCode} · V1`,
      status: "SENT",
      projectId: enviada.projectId,
      projectCode: enviada.projectCode,
      projectName: `Projeto Hub Um ${m}`,
      customerId: alfa.id,
      customerName: nomes.alfa,
      productCount: 1,
      quoteDate: "2031-03-10T00:00:00.000Z",
      validUntil: "2099-12-31T00:00:00.000Z",
      expired: false,
      sourcedOrder: null,
    });
    expect(resposta.quoteVersions[0]!.status).toBe("REJECTED");
  });

  it("total: o mesmo do documento — enviado, rascunho com desconto e rascunho sem preço", async () => {
    const documento = async (id: string) =>
      (await app.inject({ method: "GET", url: `/quote-versions/${id}` })).json().total as string | null;

    const [linhaEnviada] = (await listar(`projectId=${enviada.projectId}`)).quoteVersions;
    expect(linhaEnviada!.total).toBe("1234.56");
    expect(linhaEnviada!.total).toBe(await documento(enviada.quoteId));

    const [linhaRascunho] = (await listar(`projectId=${rascunho.projectId}`)).quoteVersions;
    expect(linhaRascunho!.total).not.toBe("1234.56");
    expect(linhaRascunho!.total).toBe(await documento(rascunho.quoteId));

    const [linhaVazia] = (await listar(`projectId=${vazio.projectId}`)).quoteVersions;
    expect(linhaVazia).toMatchObject({ total: null, productCount: 0, status: "DRAFT" });
  });

  it("status: um ou vários numa consulta só; desconhecido é 400", async () => {
    expect(ids(await listar(`customerId=${alfa.id}&status=DRAFT,SENT`))).toEqual([enviada.quoteId]);
    expect(ids(await listar(`customerId=${alfa.id}&status=REJECTED`))).toEqual([recusada.quoteId]);
    expect(ids(await listar(`customerId=${beta.id}&status=DRAFT,SENT`))).toEqual([
      rascunho.quoteId,
      vazio.quoteId,
    ]);
    expect((await listar(`customerId=${beta.id}&status=ACCEPTED`)).total).toBe(0);

    const invalido = await app.inject({ method: "GET", url: "/quote-versions?status=EXPIRED" });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().error).toBe("validation_error");
  });

  it("projeto: só as versões dele", async () => {
    expect(ids(await listar(`projectId=${rascunho.projectId}`))).toEqual([rascunho.quoteId]);
  });

  it("busca: código do orçamento, cliente e projeto, sem diferença de maiúscula", async () => {
    expect(ids(await listar(`search=${encodeURIComponent(rascunho.quoteCode)}`))).toEqual([
      rascunho.quoteId,
    ]);
    expect(new Set(ids(await listar(`search=${encodeURIComponent(nomes.alfa.toLowerCase())}`)))).toEqual(
      new Set([enviada.quoteId, recusada.quoteId]),
    );
    expect(ids(await listar(`search=${encodeURIComponent(nomes.projetoTres.toUpperCase())}`))).toEqual([
      rascunho.quoteId,
    ]);
  });

  it("período: data do orçamento em dia civil, pontas inclusivas e abertas; invertido é 400", async () => {
    const recorte = (periodo: string) => listar(`customerId=${alfa.id}&${periodo}`).then(ids);
    expect(await recorte("dateFrom=2031-03-10&dateTo=2031-03-10")).toEqual([enviada.quoteId]);
    expect(await recorte("dateFrom=2031-03-11")).toEqual([recusada.quoteId]);
    expect(await recorte("dateTo=2031-03-11")).toEqual([enviada.quoteId]);
    expect(await recorte("dateFrom=2031-03-10&dateTo=2031-03-12")).toEqual([
      recusada.quoteId,
      enviada.quoteId,
    ]);

    const invertido = await app.inject({
      method: "GET",
      url: `/quote-versions?dateFrom=2031-03-12&dateTo=2031-03-10`,
    });
    expect(invertido.statusCode).toBe(400);
  });

  it("paginação no servidor: página e tamanho respeitados, total do recorte inteiro; entrada frouxa é 400", async () => {
    const segunda = await listar(`customerId=${alfa.id}&page=2&pageSize=1`);
    expect(segunda).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(ids(segunda)).toEqual([enviada.quoteId]);

    for (const url of ["/quote-versions?page=1e1", "/quote-versions?pageSize=0x10", "/quote-versions?pageSize=101"]) {
      const resposta = await app.inject({ method: "GET", url });
      expect(resposta.statusCode, url).toBe(400);
    }
  });

  it("cliente renomeado: enviada mantém o nome do envio, rascunho mostra o novo — e a busca acha pelos dois", async () => {
    const renomeado = `Cliente Renomeado ${m} Ltda`;
    await getPrisma().customer.update({ where: { id: alfa.id }, data: { legalName: renomeado } });
    await getPrisma().customer.update({ where: { id: beta.id }, data: { legalName: `${renomeado} B` } });

    const doAlfa = await listar(`customerId=${alfa.id}`);
    expect(doAlfa.quoteVersions.map((linha) => linha.customerName)).toEqual([nomes.alfa, nomes.alfa]);

    const doBeta = await listar(`customerId=${beta.id}`);
    expect(doBeta.quoteVersions.map((linha) => linha.customerName)).toEqual([
      `${renomeado} B`,
      `${renomeado} B`,
    ]);

    // Nome do envio e nome do cadastro atual acham a mesma proposta enviada.
    expect(ids(await listar(`search=${encodeURIComponent(nomes.alfa)}`))).toContain(enviada.quoteId);
    expect(new Set(ids(await listar(`search=${encodeURIComponent(renomeado)}`)))).toEqual(
      new Set([enviada.quoteId, recusada.quoteId, rascunho.quoteId, vazio.quoteId]),
    );
  });
});
