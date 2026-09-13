import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CustomerOrderSelectionDocumentsResponse,
  ProductionOrderDTO,
  ProductionOrderSelectionDocumentsResponse,
} from "@veridi/shared";
import { hojeComercial } from "@veridi/shared";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { aplicarRoteiroDeTeste } from "../../test-support/fixture-route.js";
import { customerOrderSelectionSchema } from "../customer-orders/customer-orders.schemas.js";
import { resolveCustomerOrderSelection } from "../customer-orders/customer-orders.service.js";
import { productionOrderSelectionSchema } from "../production-orders/production-orders.schemas.js";
import "../../lib/decimal.js";

/**
 * Documentos da seleção em massa — BULK-DOCUMENTS-01.
 *
 * O descritor atravessa a API e o servidor resolve o conjunto com a MESMA
 * regra da listagem: ids escolhidos, ou o filtro menos as exceções. O que sai
 * — os documentos do PDF e as linhas do CSV — é exatamente a seleção: nenhum
 * registro a mais, nenhum a menos, nada em silêncio.
 */

type App = ReturnType<typeof buildTestApp>;
const admin: App = buildTestApp("ADMIN");
const leitura: App = buildTestApp("VIEWER");
const semSessao = buildApp();

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

const fixtureCustomerIds: string[] = [];
const fixtureOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

const pedidos: Record<"A1" | "A2" | "A3" | "B1", { id: string; code: string }> = {} as never;
let clienteA: string;
let clienteB: string;
let clienteGrande: string;

function csvLines(body: string): string[] {
  return body.replace(/^﻿/, "").split("\r\n").filter((line) => line.length > 0);
}

async function documentosDePedidos(corpo: unknown, app: App = admin) {
  return app.inject({ method: "POST", url: "/customer-orders/bulk/documents", payload: corpo as object });
}

async function csvDePedidos(corpo: unknown) {
  return admin.inject({ method: "POST", url: "/customer-orders/bulk/export.csv", payload: corpo as object });
}

const codigos = (resposta: { json: () => CustomerOrderSelectionDocumentsResponse }) =>
  resposta.json().documents.map((pedido) => pedido.code);

beforeAll(async () => {
  await admin.ready();
  await leitura.ready();
  await semSessao.ready();
  const prisma = getPrisma();

  const criarCliente = async (sufixo: string) => {
    const cliente = await prisma.customer.create({
      data: { code: `CLI-BLK-${marca}-${sufixo}`, legalName: `Cliente Lote ${marca} ${sufixo}`, active: true },
    });
    fixtureCustomerIds.push(cliente.id);
    return cliente;
  };
  const a = await criarCliente("A");
  const b = await criarCliente("B");
  const grande = await criarCliente("G");
  clienteA = a.id;
  clienteB = b.id;
  clienteGrande = grande.id;

  const criarPedido = async (
    chave: keyof typeof pedidos,
    cliente: { id: string; legalName: string },
    status: "DRAFT" | "CONFIRMED",
  ) => {
    const pedido = await prisma.customerOrder.create({
      data: {
        code: `PED-BLK-${marca}-${chave}`,
        customerId: cliente.id,
        customerName: cliente.legalName,
        status,
      },
    });
    pedidos[chave] = { id: pedido.id, code: pedido.code };
  };
  await criarPedido("A1", a, "DRAFT");
  await criarPedido("A2", a, "CONFIRMED");
  await criarPedido("A3", a, "CONFIRMED");
  await criarPedido("B1", b, "DRAFT");

  // 501 pedidos de um cliente só: o universo que passa do teto do PDF.
  await prisma.customerOrder.createMany({
    data: Array.from({ length: 501 }, (_, indice) => ({
      code: `PED-BLK-${marca}-G${String(indice).padStart(3, "0")}`,
      customerId: grande.id,
      customerName: grande.legalName,
    })),
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureOrderIds.length > 0) {
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureOrderIds } } });
  }
  await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  await prisma.customerOrder.deleteMany({ where: { customerId: { in: fixtureCustomerIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  await admin.close();
  await leitura.close();
  await semSessao.close();
});

describe("Descritor da seleção na fronteira da API", () => {
  it("aceita ids e normaliza repetidos", () => {
    const lido = customerOrderSelectionSchema.parse({ mode: "ids", ids: ["a", "b", "a", " b "] });
    expect(lido).toEqual({ mode: "ids", ids: ["a", "b"] });
  });

  it("aceita todos os filtrados com os filtros como a tela os guarda, e exceções vazias por padrão", () => {
    const lido = productionOrderSelectionSchema.parse({
      mode: "filtered",
      filters: { status: ["DRAFT", "PLANNED"], semRoteiro: true, productId: "p1", search: "cápsula" },
    });
    expect(lido).toEqual({
      mode: "filtered",
      filters: { status: ["DRAFT", "PLANNED"], semRoteiro: true, productId: "p1", search: "cápsula" },
      excludedIds: [],
    });
    expect(productionOrderSelectionSchema.parse({ mode: "filtered", filters: { semRoteiro: false } })).toMatchObject({
      filters: { semRoteiro: false },
    });
  });

  it("filtro vazio é permitido: é a listagem sem recorte", () => {
    expect(customerOrderSelectionSchema.safeParse({ mode: "filtered", filters: {}, excludedIds: ["x"] }).success).toBe(true);
  });

  it("recusa modo desconhecido, ids vazio, filtro que a listagem não conhece, status inválido e paginação", () => {
    const recusados: unknown[] = [
      { mode: "tudo" },
      { mode: "ids", ids: [] },
      { mode: "ids" },
      { mode: "filtered", filters: { cor: "azul" }, excludedIds: [] },
      { mode: "filtered", filters: { status: ["ENTREGUE"] }, excludedIds: [] },
      { mode: "filtered", filters: { page: 2 }, excludedIds: [] },
      { mode: "filtered", excludedIds: [] },
      { mode: "ids", ids: ["a"], filters: {} },
    ];
    for (const corpo of recusados) {
      expect(customerOrderSelectionSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
  });
});

describe("Pedidos — documentos da seleção", () => {
  it("3 ids viram 3 documentos, na ordem da listagem, cada um com o dado do documento individual", async () => {
    const resposta = await documentosDePedidos({ mode: "ids", ids: [pedidos.A1.id, pedidos.B1.id, pedidos.A3.id] });
    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json() as CustomerOrderSelectionDocumentsResponse;
    expect(corpo.total).toBe(3);
    expect(codigos(resposta)).toEqual([pedidos.B1.code, pedidos.A3.code, pedidos.A1.code]);

    const individual = (await admin.inject({ method: "GET", url: `/customer-orders/${pedidos.A3.id}` })).json();
    expect(corpo.documents[1]).toEqual(individual);
  });

  it("todos os filtrados obedecem cliente, status e busca da listagem", async () => {
    const doCliente = await documentosDePedidos({ mode: "filtered", filters: { customerId: clienteA }, excludedIds: [] });
    expect(codigos(doCliente)).toEqual([pedidos.A3.code, pedidos.A2.code, pedidos.A1.code]);

    const confirmados = await documentosDePedidos({
      mode: "filtered",
      filters: { customerId: clienteA, status: ["CONFIRMED"] },
      excludedIds: [],
    });
    expect(codigos(confirmados)).toEqual([pedidos.A3.code, pedidos.A2.code]);

    const busca = await documentosDePedidos({
      mode: "filtered",
      filters: { search: `Cliente Lote ${marca} B` },
      excludedIds: [],
    });
    expect(codigos(busca)).toEqual([pedidos.B1.code]);

    const doOutroCliente = await documentosDePedidos({ mode: "filtered", filters: { customerId: clienteB }, excludedIds: [] });
    expect(codigos(doOutroCliente)).toEqual([pedidos.B1.code]);

    // A mesma resposta da listagem para o mesmo recorte.
    const lista = (
      await admin.inject({ method: "GET", url: `/customer-orders?customerId=${clienteA}&status=CONFIRMED&pageSize=100` })
    ).json();
    expect(lista.customerOrders.map((pedido: { code: string }) => pedido.code)).toEqual(codigos(confirmados));
  });

  it("exceções desmarcadas saem do conjunto", async () => {
    const resposta = await documentosDePedidos({
      mode: "filtered",
      filters: { customerId: clienteA },
      excludedIds: [pedidos.A2.id],
    });
    expect(resposta.json().total).toBe(2);
    expect(codigos(resposta)).toEqual([pedidos.A3.code, pedidos.A1.code]);
  });

  it("id escolhido que não existe não some: a geração inteira é recusada, com a amostra", async () => {
    const fantasma = randomUUID();
    const resposta = await documentosDePedidos({ mode: "ids", ids: [pedidos.A1.id, fantasma] });
    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ error: "selection_not_found", total: 1, sample: [fantasma] });
    expect(resposta.json().message).toContain("não existe mais");

    const csv = await csvDePedidos({ mode: "ids", ids: [pedidos.A1.id, fantasma] });
    expect(csv.statusCode).toBe(404);
  });

  it("filtro que não alcança mais nada é recusado", async () => {
    const resposta = await documentosDePedidos({
      mode: "filtered",
      filters: { customerId: clienteA, status: ["SHIPPED"] },
      excludedIds: [],
    });
    expect(resposta.statusCode).toBe(404);
    expect(resposta.json().error).toBe("selection_empty");
  });

  it("PDF acima de 500 é recusado inteiro — nem os primeiros 500 —, e o CSV do mesmo universo sai completo", async () => {
    const pdf = await documentosDePedidos({ mode: "filtered", filters: { customerId: clienteGrande }, excludedIds: [] });
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json()).toMatchObject({
      error: "selection_too_large",
      message: "A seleção contém mais de 500 documentos. Refine os filtros e tente novamente.",
      total: 501,
      limit: 500,
    });

    // Com uma exceção o universo cabe: 500.
    const umaExcecao = await getPrisma().customerOrder.findFirstOrThrow({ where: { customerId: clienteGrande } });
    const cabe = await documentosDePedidos({
      mode: "filtered",
      filters: { customerId: clienteGrande },
      excludedIds: [umaExcecao.id],
    });
    expect(cabe.statusCode).toBe(200);
    expect(cabe.json().total).toBe(500);

    const csv = await csvDePedidos({ mode: "filtered", filters: { customerId: clienteGrande }, excludedIds: [] });
    expect(csv.statusCode).toBe(200);
    expect(csvLines(csv.body)).toHaveLength(502);

    // Ids: o teto vale antes de olhar o banco.
    const muitos = await documentosDePedidos({ mode: "ids", ids: Array.from({ length: 501 }, () => randomUUID()) });
    expect(muitos.statusCode).toBe(400);
    expect(muitos.json().error).toBe("selection_too_large");
  });

  it("o serviço só limita quando recebe limite: é o CSV que não passa", async () => {
    const selecao = { mode: "filtered" as const, filters: { customerId: clienteA }, excludedIds: [] };
    await expect(resolveCustomerOrderSelection(selecao, 2)).rejects.toMatchObject({ name: "SelectionTooLargeError" });
    expect(await resolveCustomerOrderSelection(selecao)).toHaveLength(3);
  });

  it("CSV é a seleção: cabeçalho da exportação, as linhas escolhidas, sem as exceções, UTF-8 com BOM e nome do dia", async () => {
    const resposta = await csvDePedidos({
      mode: "filtered",
      filters: { customerId: clienteA },
      excludedIds: [pedidos.A1.id],
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["content-type"]).toContain("text/csv");
    expect(resposta.headers["content-disposition"]).toBe(
      `attachment; filename="pedidos-selecionados-${hojeComercial()}.csv"`,
    );
    expect(resposta.body.startsWith("﻿")).toBe(true);

    const linhas = csvLines(resposta.body);
    const cabecalhoDaListagem = csvLines(
      (await admin.inject({ method: "GET", url: `/customer-orders/export.csv?customerId=${clienteA}` })).body,
    )[0];
    expect(linhas[0]).toBe(cabecalhoDaListagem);
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toContain(pedidos.A3.code);
    expect(linhas[2]).toContain(pedidos.A2.code);
    expect(resposta.body).not.toContain(pedidos.A1.code);

    const porIds = csvLines((await csvDePedidos({ mode: "ids", ids: [pedidos.B1.id] })).body);
    expect(porIds).toHaveLength(2);
    expect(porIds[1]).toContain(pedidos.B1.code);
  });

  it("gerar documento e CSV não muda o pedido", async () => {
    const antes = await getPrisma().customerOrder.findUniqueOrThrow({ where: { id: pedidos.A2.id } });
    await documentosDePedidos({ mode: "ids", ids: [pedidos.A2.id] });
    await csvDePedidos({ mode: "ids", ids: [pedidos.A2.id] });
    const depois = await getPrisma().customerOrder.findUniqueOrThrow({ where: { id: pedidos.A2.id } });
    expect(depois).toEqual(antes);
  });

  it("quem lê o pedido gera o documento; sem sessão, não", async () => {
    expect((await documentosDePedidos({ mode: "ids", ids: [pedidos.A1.id] }, leitura)).statusCode).toBe(200);
    const anonimo = await semSessao.inject({
      method: "POST",
      url: "/customer-orders/bulk/documents",
      payload: { mode: "ids", ids: [pedidos.A1.id] },
    });
    expect(anonimo.statusCode).toBe(401);
    const anonimoCsv = await semSessao.inject({
      method: "POST",
      url: "/customer-orders/bulk/export.csv",
      payload: { mode: "ids", ids: [pedidos.A1.id] },
    });
    expect(anonimoCsv.statusCode).toBe(401);
  });

  it("descritor inválido é 400 com as recusas", async () => {
    const resposta = await documentosDePedidos({ mode: "filtered", filters: { cor: "azul" }, excludedIds: [] });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error).toBe("validation_error");
  });
});

describe("Ordens de Produção — documentos da seleção", () => {
  let produtoUm: string;
  let produtoDois: string;
  const ops: Record<"semRoteiro" | "comRoteiro" | "cancelada" | "outroProduto", ProductionOrderDTO> = {} as never;

  beforeAll(async () => {
    const prisma = getPrisma();
    for (const unit of [
      { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
      { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
    ]) {
      await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
    }
    const materia = await prisma.item.create({
      data: { type: "RAW_MATERIAL", code: `MP-BLK-${marca}`, name: `Matéria ${marca}`, unitCode: "kg" },
    });
    fixtureItemIds.push(materia.id);

    const criarProduto = async (sufixo: string) => {
      const acabado = await prisma.item.create({
        data: { type: "FINISHED_PRODUCT", code: `PA-BLK-${marca}-${sufixo}`, name: `Acabado ${marca} ${sufixo}`, unitCode: "un" },
      });
      fixtureItemIds.push(acabado.id);
      const produto = await prisma.product.create({
        data: { code: `PROD-BLK-${marca}-${sufixo}`, name: `Produto Lote ${marca} ${sufixo}`, finishedProductItemId: acabado.id },
      });
      fixtureProductIds.push(produto.id);
      const formulacao = (
        await admin.inject({ method: "POST", url: `/products/${produto.id}/formulation-versions`, payload: {} })
      ).json();
      await admin.inject({
        method: "PATCH",
        url: `/formulation-versions/${formulacao.id}`,
        payload: { basisQuantity: "1000", components: [{ itemId: materia.id, quantity: "10", unitCode: "kg" }] },
      });
      expect((await admin.inject({ method: "POST", url: `/formulation-versions/${formulacao.id}/activate` })).statusCode).toBe(200);
      return produto.id;
    };
    produtoUm = await criarProduto("UM");
    produtoDois = await criarProduto("DOIS");

    const criarOp = async (productId: string) => {
      const criada = await admin.inject({ method: "POST", url: "/production-orders", payload: { productId, plannedQuantity: "500" } });
      expect(criada.statusCode).toBe(201);
      const ordem = criada.json() as ProductionOrderDTO;
      fixtureOrderIds.push(ordem.id);
      return ordem;
    };
    ops.semRoteiro = await criarOp(produtoUm);
    ops.comRoteiro = await criarOp(produtoUm);
    await aplicarRoteiroDeTeste(ops.comRoteiro.id);
    ops.cancelada = await criarOp(produtoUm);
    expect(
      (await admin.inject({ method: "POST", url: `/production-orders/${ops.cancelada.id}/cancel`, payload: { reason: "Teste de seleção" } }))
        .statusCode,
    ).toBe(200);
    ops.outroProduto = await criarOp(produtoDois);
  });

  const documentos = async (corpo: unknown) =>
    admin.inject({ method: "POST", url: "/production-orders/bulk/documents", payload: corpo as object });
  const codigosDasOps = (resposta: { json: () => ProductionOrderSelectionDocumentsResponse }) =>
    resposta.json().documents.map((documento) => documento.order.code);

  it("ids viram os documentos oficiais: a ordem e o custo complementar, na ordem da listagem", async () => {
    const resposta = await documentos({ mode: "ids", ids: [ops.semRoteiro.id, ops.outroProduto.id, ops.cancelada.id] });
    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json() as ProductionOrderSelectionDocumentsResponse;
    expect(corpo.total).toBe(3);
    expect(codigosDasOps(resposta)).toEqual([ops.outroProduto.code, ops.cancelada.code, ops.semRoteiro.code]);

    const individual = (await admin.inject({ method: "GET", url: `/production-orders/${ops.outroProduto.id}` })).json();
    const custo = (await admin.inject({ method: "GET", url: `/production-orders/${ops.outroProduto.id}/material-cost` })).json();
    expect(corpo.documents[0]).toEqual({ order: individual, cost: custo });
  });

  it("todos os filtrados obedecem produto, status, busca e roteiro — a mesma regra da listagem", async () => {
    const doProduto = await documentos({ mode: "filtered", filters: { productId: produtoUm }, excludedIds: [] });
    expect(codigosDasOps(doProduto)).toEqual([ops.cancelada.code, ops.comRoteiro.code, ops.semRoteiro.code]);

    const rascunhos = await documentos({
      mode: "filtered",
      filters: { productId: produtoUm, status: ["DRAFT"] },
      excludedIds: [],
    });
    expect(codigosDasOps(rascunhos)).toEqual([ops.comRoteiro.code, ops.semRoteiro.code]);

    const busca = await documentos({ mode: "filtered", filters: { search: `Produto Lote ${marca} DOIS` }, excludedIds: [] });
    expect(codigosDasOps(busca)).toEqual([ops.outroProduto.code]);

    // Sem roteiro é pendência DERIVADA: a cancelada sem cópia não entra.
    const semRoteiro = await documentos({ mode: "filtered", filters: { productId: produtoUm, semRoteiro: true }, excludedIds: [] });
    expect(codigosDasOps(semRoteiro)).toEqual([ops.semRoteiro.code]);
    const listaSemRoteiro = (
      await admin.inject({ method: "GET", url: `/production-orders?productId=${produtoUm}&semRoteiro=1&pageSize=100` })
    ).json();
    expect(listaSemRoteiro.productionOrders.map((ordem: { code: string }) => ordem.code)).toEqual(codigosDasOps(semRoteiro));

    const comRoteiro = await documentos({ mode: "filtered", filters: { productId: produtoUm, semRoteiro: false }, excludedIds: [] });
    expect(codigosDasOps(comRoteiro)).toEqual([ops.comRoteiro.code]);
  });

  it("exceções desmarcadas saem do conjunto", async () => {
    const resposta = await documentos({
      mode: "filtered",
      filters: { productId: produtoUm },
      excludedIds: [ops.comRoteiro.id, randomUUID()],
    });
    expect(codigosDasOps(resposta)).toEqual([ops.cancelada.code, ops.semRoteiro.code]);
  });

  it("CSV da seleção: colunas da exportação de OPs, só as escolhidas, nome do dia", async () => {
    const resposta = await admin.inject({
      method: "POST",
      url: "/production-orders/bulk/export.csv",
      payload: { mode: "filtered", filters: { productId: produtoUm, semRoteiro: false }, excludedIds: [] },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["content-disposition"]).toBe(
      `attachment; filename="ordens-producao-selecionadas-${hojeComercial()}.csv"`,
    );
    const linhas = csvLines(resposta.body);
    const cabecalho = csvLines(
      (await admin.inject({ method: "GET", url: `/production-orders/export.csv?productId=${produtoUm}` })).body,
    )[0];
    expect(linhas[0]).toBe(cabecalho);
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toContain(ops.comRoteiro.code);
    expect(resposta.body).not.toContain(ops.semRoteiro.code);

    const porIds = await admin.inject({
      method: "POST",
      url: "/production-orders/bulk/export.csv",
      payload: { mode: "ids", ids: [ops.cancelada.id, ops.outroProduto.id] },
    });
    expect(csvLines(porIds.body).slice(1).map((linha) => linha.split(";")[0])).toEqual([
      ops.outroProduto.code,
      ops.cancelada.code,
    ]);
  });

  it("id de OP que não existe recusa, e gerar não muda a OP", async () => {
    const antes = await getPrisma().productionOrder.findUniqueOrThrow({ where: { id: ops.semRoteiro.id } });
    const resposta = await documentos({ mode: "ids", ids: [ops.semRoteiro.id, randomUUID()] });
    expect(resposta.statusCode).toBe(404);
    expect(resposta.json().error).toBe("selection_not_found");
    await documentos({ mode: "ids", ids: [ops.semRoteiro.id] });
    const depois = await getPrisma().productionOrder.findUniqueOrThrow({ where: { id: ops.semRoteiro.id } });
    expect(depois).toEqual(antes);
  });
});
