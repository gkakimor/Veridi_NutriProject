import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * R-20 — todo filtro ativo entra, e em AND (R20-QUOTE-FILTER-COMPOSITION-01).
 *
 * Status, cliente e período eram três chaves `quoteVersion` no mesmo `where`,
 * e a última apagava as anteriores: cliente + status devolvia todos os status
 * do cliente; qualquer combinação com período devolvia o período inteiro, de
 * todos os clientes e status. A massa abaixo é montada para que CADA
 * sobrescrita apareça — um orçamento só atende cliente A, status Enviado e
 * setembro ao mesmo tempo; os vizinhos erram exatamente um dos três.
 *
 * O período é o da REPORTS-BUSINESS-DATE-01: dia comercial de São Paulo, fim
 * exclusivo. O cliente C carrega as bordas desse dia dentro da combinação.
 * JSON (o que a tela lê), contagem, páginas e CSV (o que o PDF lê) usam o
 * mesmo `where`, e isso também se prova aqui.
 */

type App = ReturnType<typeof buildTestApp>;

const PERIODO = { from: "2026-09-01", to: "2026-09-30" };

/** Cada orçamento da massa: cliente, status e o instante `quoteDate` (UTC). */
const MASSA = {
  A_SENT_DENTRO: { cliente: "A", status: "SENT", quoteDate: "2026-09-15T15:00:00.000Z" },
  A_DRAFT_DENTRO: { cliente: "A", status: "DRAFT", quoteDate: "2026-09-10T15:00:00.000Z" },
  B_SENT_DENTRO: { cliente: "B", status: "SENT", quoteDate: "2026-09-20T15:00:00.000Z" },
  A_SENT_FORA: { cliente: "A", status: "SENT", quoteDate: "2026-08-20T15:00:00.000Z" },
  // Bordas do período em São Paulo (UTC-03), todas cliente C e Enviado.
  C_SENT_ANTES: { cliente: "C", status: "SENT", quoteDate: "2026-09-01T02:59:59.999Z" }, // 31/08 23:59:59.999
  C_SENT_INICIO: { cliente: "C", status: "SENT", quoteDate: "2026-09-01T03:00:00.000Z" }, // 01/09 00:00
  C_SENT_NOITE: { cliente: "C", status: "SENT", quoteDate: "2026-10-01T01:30:00.000Z" }, // 30/09 22:30
  C_SENT_ULTIMO: { cliente: "C", status: "SENT", quoteDate: "2026-10-01T02:59:59.999Z" }, // 30/09 23:59:59.999
  C_SENT_DEPOIS: { cliente: "C", status: "SENT", quoteDate: "2026-10-01T03:00:00.000Z" }, // 01/10 00:00
} as const;
type Rotulo = keyof typeof MASSA;
const TODOS = Object.keys(MASSA) as Rotulo[];

const m = `R20${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const codigoDe = (rotulo: Rotulo) => `ORC-${m}-${rotulo}`;
const clientes: Record<string, string> = {};
const criados = { clientes: [] as string[], itens: [] as string[], produtos: [] as string[], projetos: [] as string[] };

let app: App;

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });

  const projetoDo: Record<string, { id: string; productId: string; versoes: number }> = {};
  for (const letra of ["A", "B", "C"]) {
    const cliente = await prisma.customer.create({
      data: { code: `CLI-${m}-${letra}`, legalName: `Cliente R-20 ${m} ${letra}`, active: true },
    });
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
    const projeto = await prisma.project.create({
      data: { code: `PROJ-${m}-${letra}`, customerId: cliente.id, name: `Projeto ${m} ${letra}`, entryDate: new Date() },
    });
    clientes[letra] = cliente.id;
    criados.clientes.push(cliente.id);
    criados.itens.push(item.id);
    criados.produtos.push(produto.id);
    criados.projetos.push(projeto.id);
    projetoDo[letra] = { id: projeto.id, productId: produto.id, versoes: 0 };
  }

  for (const rotulo of TODOS) {
    const { cliente, status, quoteDate } = MASSA[rotulo];
    const projeto = projetoDo[cliente]!;
    projeto.versoes += 1;
    await prisma.quoteVersion.create({
      data: {
        code: codigoDe(rotulo),
        projectId: projeto.id,
        versionNumber: projeto.versoes,
        status,
        quoteDate: new Date(quoteDate),
        lines: {
          create: [{ productId: projeto.productId, quotedQuantity: "10", uomCode: "kg", unitPrice: "5", priceSource: "MANUAL" }],
        },
      },
    });
  }

  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  // Versões e linhas saem em cascata com o projeto.
  await prisma.project.deleteMany({ where: { id: { in: criados.projetos } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await app?.close();
});

type Linha = { quoteLabel: string };

/** Só os orçamentos desta massa — o banco pode ter outros. */
function daMassa(codigos: string[]): Rotulo[] {
  const prefixo = `ORC-${m}-`;
  return codigos
    .filter((codigo) => codigo.startsWith(prefixo))
    .map((codigo) => codigo.slice(prefixo.length) as Rotulo)
    .sort();
}

async function consulta(params: Record<string, string>) {
  const response = await app.inject({
    method: "GET",
    url: `/reports/commercial/quote-pricing?${new URLSearchParams(params)}`,
  });
  expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
  const corpo = response.json() as { rows: Linha[]; total: number; page: number; pageSize: number };
  return { ...corpo, codigos: corpo.rows.map((linha) => linha.quoteLabel.split(" · ")[0]!) };
}

async function csv(params: Record<string, string>) {
  const response = await app.inject({
    method: "GET",
    url: `/reports/commercial/quote-pricing/export.csv?${new URLSearchParams(params)}`,
  });
  expect(response.statusCode).toBe(200);
  const linhas = response.body.replace(/^﻿/, "").split("\r\n").filter((linha) => linha.length > 0).slice(1);
  const codigos = linhas.map((linha) => linha.match(/ORC-[A-Z0-9]+-[A-Z_]+/)?.[0] ?? linha);
  return { linhas, codigos };
}

const esperado = (...rotulos: Rotulo[]) => [...rotulos].sort();

describe("R-20 — filtros individuais", () => {
  it("1. sem filtro: toda a massa aparece", async () => {
    const resultado = await consulta({ all: "true" });
    expect(daMassa(resultado.codigos)).toEqual(esperado(...TODOS));
    expect(resultado.total).toBe(resultado.rows.length);
  });

  it("2. somente cliente: os três orçamentos de A, de qualquer status e data", async () => {
    const resultado = await consulta({ customerId: clientes["A"]!, all: "true" });
    expect(daMassa(resultado.codigos)).toEqual(esperado("A_SENT_DENTRO", "A_DRAFT_DENTRO", "A_SENT_FORA"));
    expect(resultado.total).toBe(3);
  });

  it("3. somente status: todo Enviado, de qualquer cliente e data", async () => {
    const resultado = await consulta({ status: "SENT", all: "true" });
    expect(daMassa(resultado.codigos)).toEqual(esperado(...TODOS.filter((rotulo) => rotulo !== "A_DRAFT_DENTRO")));
    expect(resultado.total).toBe(resultado.rows.length);
  });

  it("4. somente período: o mês comercial de setembro, fim exclusivo", async () => {
    const resultado = await consulta({ ...PERIODO, all: "true" });
    expect(daMassa(resultado.codigos)).toEqual(
      esperado("A_SENT_DENTRO", "A_DRAFT_DENTRO", "B_SENT_DENTRO", "C_SENT_INICIO", "C_SENT_NOITE", "C_SENT_ULTIMO"),
    );
    expect(resultado.total).toBe(resultado.rows.length);
  });
});

describe("R-20 — combinações nunca sobrescrevem", () => {
  it.each([
    {
      caso: "cliente + status",
      filtro: () => ({ customerId: clientes["A"]!, status: "SENT" }),
      linhas: esperado("A_SENT_DENTRO", "A_SENT_FORA"),
      exato: true,
    },
    {
      caso: "cliente + período",
      filtro: () => ({ customerId: clientes["A"]!, ...PERIODO }),
      linhas: esperado("A_SENT_DENTRO", "A_DRAFT_DENTRO"),
      exato: true,
    },
    {
      caso: "status + período",
      filtro: () => ({ status: "SENT", ...PERIODO }),
      linhas: esperado("A_SENT_DENTRO", "B_SENT_DENTRO", "C_SENT_INICIO", "C_SENT_NOITE", "C_SENT_ULTIMO"),
      exato: false,
    },
    {
      caso: "cliente + status + período",
      filtro: () => ({ customerId: clientes["A"]!, status: "SENT", ...PERIODO }),
      linhas: esperado("A_SENT_DENTRO"),
      exato: true,
    },
    {
      caso: "cliente + OUTRO status + período",
      filtro: () => ({ customerId: clientes["A"]!, status: "DRAFT", ...PERIODO }),
      linhas: esperado("A_DRAFT_DENTRO"),
      exato: true,
    },
    {
      caso: "OUTRO cliente + status + período",
      filtro: () => ({ customerId: clientes["B"]!, status: "SENT", ...PERIODO }),
      linhas: esperado("B_SENT_DENTRO"),
      exato: true,
    },
    {
      caso: "três filtros nas bordas do dia comercial (00:00 e 23:59:59.999 de São Paulo entram)",
      filtro: () => ({ customerId: clientes["C"]!, status: "SENT", ...PERIODO }),
      linhas: esperado("C_SENT_INICIO", "C_SENT_NOITE", "C_SENT_ULTIMO"),
      exato: true,
    },
    {
      caso: "três filtros com o mesmo dia nas duas pontas",
      filtro: () => ({ customerId: clientes["A"]!, status: "SENT", from: "2026-09-15", to: "2026-09-15" }),
      linhas: esperado("A_SENT_DENTRO"),
      exato: true,
    },
    {
      caso: "três filtros + origem do preço + busca",
      filtro: () => ({ customerId: clientes["A"]!, status: "SENT", ...PERIODO, priceSource: "MANUAL", search: m }),
      linhas: esperado("A_SENT_DENTRO"),
      exato: true,
    },
    {
      caso: "três filtros + origem do preço que ninguém da massa tem",
      filtro: () => ({ customerId: clientes["A"]!, status: "SENT", ...PERIODO, priceSource: "PRICING_TIER" }),
      linhas: esperado(),
      exato: true,
    },
  ])("$caso — JSON, total e CSV com o mesmo recorte", async ({ filtro, linhas, exato }) => {
    const params = filtro();
    const resultado = await consulta({ ...params, all: "true" });
    expect(daMassa(resultado.codigos)).toEqual(linhas);
    expect(resultado.total).toBe(resultado.rows.length);
    // Com cliente no filtro, nada de fora da massa pode aparecer.
    if (exato) expect(resultado.total).toBe(linhas.length);

    const arquivo = await csv(params);
    expect(daMassa(arquivo.codigos)).toEqual(linhas);
    expect(arquivo.linhas).toHaveLength(resultado.rows.length);
  });
});

describe("R-20 — total e paginação usam o where composto", () => {
  it("cliente + status: duas linhas em duas páginas; os três filtros: uma", async () => {
    const base = { customerId: clientes["A"]!, status: "SENT", pageSize: "1" };
    const primeira = await consulta({ ...base, page: "1" });
    const segunda = await consulta({ ...base, page: "2" });
    const terceira = await consulta({ ...base, page: "3" });
    expect([primeira.total, segunda.total, terceira.total]).toEqual([2, 2, 2]);
    expect(primeira.rows).toHaveLength(1);
    expect(segunda.rows).toHaveLength(1);
    expect(terceira.rows).toHaveLength(0);
    // Mais recente primeiro (`quoteDate` desc), como antes.
    expect(daMassa([...primeira.codigos, ...segunda.codigos])).toEqual(esperado("A_SENT_DENTRO", "A_SENT_FORA"));
    expect(primeira.codigos).toEqual([codigoDe("A_SENT_DENTRO")]);

    const tresFiltros = await consulta({ ...base, ...PERIODO, page: "1" });
    expect(tresFiltros.total).toBe(1);
    expect(tresFiltros.codigos).toEqual([codigoDe("A_SENT_DENTRO")]);
  });
});
