import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * R-20 — uma linha do relatório por LINHA de orçamento, cada uma com a própria
 * identidade (R20-UX-CLEANUP-WAVE-01).
 *
 * Numa versão com três produtos, as três linhas trazem o mesmo
 * `quoteVersionId`; a tela o usava como chave da linha e duplicava linha ao
 * trocar o recorte. A identidade de cada uma é a da `QuoteLine`
 * (`quoteLineId`). O resto do relatório não muda: ordem, paginação e as
 * colunas do CSV (que o PDF lê) continuam as mesmas.
 */

type App = ReturnType<typeof buildTestApp>;

const m = `R20L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const criados = { cliente: "", itens: [] as string[], produtos: [] as string[], projeto: "" };
const produtoDe: Record<string, string> = {};
const linhaDe: Record<string, string> = {};
let versaoNova = "";
let versaoAntiga = "";

let app: App;

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  const cliente = await prisma.customer.create({
    data: { code: `CLI-${m}`, legalName: `Cliente Multiproduto ${m}`, active: true },
  });
  criados.cliente = cliente.id;
  for (const letra of ["A", "B", "C", "D"]) {
    const item = await prisma.item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-${m}-${letra}`,
        name: `Acabado ${m} ${letra}`,
        unitCode: "kg",
        controlsLot: false,
        controlsExpiry: false,
        requiresQualityRelease: false,
      },
    });
    const produto = await prisma.product.create({
      data: { code: `PROD-${m}-${letra}`, name: `Produto ${m} ${letra}`, customerId: cliente.id, finishedProductItemId: item.id },
    });
    criados.itens.push(item.id);
    criados.produtos.push(produto.id);
    produtoDe[letra] = produto.id;
  }
  const projeto = await prisma.project.create({
    data: { code: `PROJ-${m}`, customerId: cliente.id, name: `Projeto ${m}`, entryDate: new Date() },
  });
  criados.projeto = projeto.id;

  // V2, a mais recente: três produtos, gravados fora da ordem de exibição.
  const nova = await prisma.quoteVersion.create({
    data: {
      code: `ORC-${m}-2`,
      projectId: projeto.id,
      versionNumber: 2,
      status: "SENT",
      quoteDate: new Date("2026-09-12T15:00:00.000Z"),
      lines: {
        create: [
          { productId: produtoDe["C"]!, sortOrder: 2, quotedQuantity: "30", uomCode: "kg", unitPrice: "3", priceSource: "MANUAL" },
          { productId: produtoDe["A"]!, sortOrder: 0, quotedQuantity: "10", uomCode: "kg", unitPrice: "1", priceSource: "MANUAL" },
          { productId: produtoDe["B"]!, sortOrder: 1, quotedQuantity: "20", uomCode: "kg", unitPrice: "2", priceSource: "MANUAL" },
        ],
      },
    },
    include: { lines: true },
  });
  // V1, anterior: um produto só.
  const antiga = await prisma.quoteVersion.create({
    data: {
      code: `ORC-${m}-1`,
      projectId: projeto.id,
      versionNumber: 1,
      status: "SUPERSEDED",
      quoteDate: new Date("2026-09-01T15:00:00.000Z"),
      lines: {
        create: [{ productId: produtoDe["D"]!, quotedQuantity: "40", uomCode: "kg", unitPrice: "4", priceSource: "MANUAL" }],
      },
    },
    include: { lines: true },
  });
  versaoNova = nova.id;
  versaoAntiga = antiga.id;
  for (const linha of [...nova.lines, ...antiga.lines]) {
    const letra = Object.entries(produtoDe).find(([, id]) => id === linha.productId)![0];
    linhaDe[letra] = linha.id;
  }

  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  // Versões e linhas saem em cascata com o projeto.
  if (criados.projeto) await prisma.project.delete({ where: { id: criados.projeto } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  if (criados.cliente) await prisma.customer.delete({ where: { id: criados.cliente } });
  await app?.close();
});

type Linha = { quoteLineId: string; quoteVersionId: string; productCode: string; quoteLabel: string };

async function consulta(params: Record<string, string>) {
  const response = await app.inject({
    method: "GET",
    url: `/reports/commercial/quote-pricing?${new URLSearchParams({ search: m, ...params })}`,
  });
  expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
  return response.json() as { rows: Linha[]; total: number };
}

const produto = (letra: string) => `PROD-${m}-${letra}`;

describe("R-20 — versão com vários produtos", () => {
  it("cada linha de orçamento é uma linha com identidade própria; a versão se repete", async () => {
    const { rows, total } = await consulta({ all: "true" });

    expect(total).toBe(4);
    // Mais recente primeiro; dentro da versão, a ordem de exibição das linhas.
    expect(rows.map((linha) => linha.productCode)).toEqual([produto("A"), produto("B"), produto("C"), produto("D")]);
    // A causa da chave duplicada: três linhas, uma versão.
    expect(rows.slice(0, 3).map((linha) => linha.quoteVersionId)).toEqual([versaoNova, versaoNova, versaoNova]);
    expect(rows[3]!.quoteVersionId).toBe(versaoAntiga);
    // A identidade de cada linha é a da QuoteLine.
    expect(rows.map((linha) => linha.quoteLineId)).toEqual([linhaDe["A"], linhaDe["B"], linhaDe["C"], linhaDe["D"]]);
    expect(new Set(rows.map((linha) => linha.quoteLineId)).size).toBe(rows.length);
  });

  it("paginação continua por linha de orçamento, com a mesma ordem", async () => {
    const primeira = await consulta({ page: "1", pageSize: "2" });
    const segunda = await consulta({ page: "2", pageSize: "2" });

    expect([primeira.total, segunda.total]).toEqual([4, 4]);
    expect(primeira.rows.map((linha) => linha.productCode)).toEqual([produto("A"), produto("B")]);
    expect(segunda.rows.map((linha) => linha.productCode)).toEqual([produto("C"), produto("D")]);
  });

  it("CSV (o que o PDF lê): as mesmas colunas de antes, uma linha por produto, sem id técnico", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/reports/commercial/quote-pricing/export.csv?search=${m}`,
    });
    expect(response.statusCode).toBe(200);
    const [cabecalho, ...linhas] = response.body
      .replace(/^﻿/, "")
      .split("\r\n")
      .filter((linha) => linha.length > 0);

    expect(cabecalho!.split(";")).toEqual([
      "Orçamento", "Projeto", "Nome do projeto", "Cliente", "Produto", "Status", "Quantidade", "Unidade",
      "Preço unitário", "Total", "Origem do preço", "Precificação", "Faixa", "Cálculo", "Modelo de Precificação",
      "Qualidade do custo do cálculo", "Custo do cálculo/un", "Custo p/ preço/un", "Margem de contribuição (%)",
      "Enviado em", "Aceito em",
    ]);
    expect(linhas).toHaveLength(4);
    for (const id of [...Object.values(linhaDe), versaoNova, versaoAntiga]) {
      expect(response.body).not.toContain(id);
    }
  });
});
