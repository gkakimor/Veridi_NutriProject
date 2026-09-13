import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { marcadorDoDiaCivil } from "../../lib/business-day.js";

/**
 * Relatórios — o período é o DIA da Veridi, em qualquer fuso de quem abre a
 * tela (REPORTS-BUSINESS-DATE-01).
 *
 * A tela mandava `new Date(`${dia}T00:00:00`).toISOString()`: a meia-noite do
 * NAVEGADOR. Num navegador em UTC, "12/09" trazia a noite de 11/09 de São
 * Paulo e perdia a de 12/09; em UTC-07 trazia a madrugada de 13/09. O
 * contrato passou a ser o dia (`from`/`to` em `YYYY-MM-DD`), aberto no
 * servidor pela espécie da coluna (`report-period.ts`).
 *
 * Aqui se prova o servidor: as bordas do dia comercial numa coluna de
 * instante — inclusive a virada UTC das 01:30 —, os marcadores numa coluna de
 * data civil, o intervalo sem off-by-one no fim, o CSV com o mesmo recorte e o
 * nome do arquivo com os dias pedidos, e a recusa do instante no lugar do dia.
 * A tela mandando o MESMO dia em UTC, UTC-07 e São Paulo é de
 * `web pages/reports/relatorios-dia-comercial.test.tsx`.
 */

type App = ReturnType<typeof buildTestApp>;

const DIA = "2026-09-12";

/** Instantes de borda, em UTC, e o dia a que pertencem em São Paulo (UTC-03). */
const BORDAS = {
  ANTES: "2026-09-12T02:59:59.999Z", // 11/09 23:59:59.999
  INICIO: "2026-09-12T03:00:00.000Z", // 12/09 00:00
  VIRADA_UTC: "2026-09-13T01:30:00.000Z", // 12/09 22:30 — em UTC já é dia 13
  ULTIMO: "2026-09-13T02:59:59.999Z", // 12/09 23:59:59.999
  DEPOIS: "2026-09-13T03:00:00.000Z", // 13/09 00:00
} as const;
type Borda = keyof typeof BORDAS;
const DO_DIA_12: Borda[] = ["INICIO", "VIRADA_UTC", "ULTIMO"];

const criados = {
  clientes: [] as string[],
  pedidos: [] as string[],
  fornecedores: [] as string[],
  ordensDeCompra: [] as string[],
  itens: [] as string[],
  lotes: [] as string[],
  produtos: [] as string[],
  ordens: [] as string[],
};

let app: App;

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.productionOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.lot.deleteMany({ where: { id: { in: criados.lotes } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ordensDeCompra } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await prisma.customerOrder.deleteMany({ where: { id: { in: criados.pedidos } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await app.close();
});

function marcador(): string {
  return `DC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function consulta(url: string, params: Record<string, string>) {
  const response = await app.inject({ method: "GET", url: `${url}?${new URLSearchParams(params)}` });
  expect(response.statusCode, `${url} ${response.body.slice(0, 200)}`).toBe(200);
  return response.json();
}

async function csv(url: string, params: Record<string, string>) {
  const response = await app.inject({ method: "GET", url: `${url}?${new URLSearchParams(params)}` });
  expect(response.statusCode).toBe(200);
  const linhas = response.body.replace(/^﻿/, "").split("\r\n").filter((linha) => linha.length > 0);
  return { linhas: linhas.slice(1), arquivo: String(response.headers["content-disposition"]) };
}

async function criarCliente(m: string) {
  const cliente = await getPrisma().customer.create({
    data: { code: `CLI-${m}`, legalName: `Cliente Dia Comercial ${m}`, active: true },
  });
  criados.clientes.push(cliente.id);
  return cliente;
}

async function criarProduto(m: string, customerId: string) {
  const prisma = getPrisma();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-${m}`,
      name: `Acabado ${m}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  criados.itens.push(item.id);
  const produto = await prisma.product.create({
    data: { code: `PROD-${m}`, name: `Produto ${m}`, customerId, finishedProductItemId: item.id },
  });
  criados.produtos.push(produto.id);
  return produto;
}

describe("coluna de INSTANTE — o dia comercial de São Paulo", () => {
  it("R-12: 12/09 cobre 00:00 a 23:59:59.999 em São Paulo; 01:30 UTC do dia 13 é noite do dia 12", async () => {
    const m = marcador();
    const cliente = await criarCliente(m);
    const codigo = (borda: Borda) => `PED-${m}-${borda}`;
    const pedidos = await getPrisma().customerOrder.createManyAndReturn({
      data: (Object.keys(BORDAS) as Borda[]).map((borda) => ({
        code: codigo(borda),
        customerId: cliente.id,
        customerName: cliente.legalName,
        orderDate: new Date(BORDAS[borda]),
        status: "CONFIRMED" as const,
      })),
      select: { id: true },
    });
    criados.pedidos.push(...pedidos.map((pedido) => pedido.id));

    const rota = "/reports/commercial/orders";
    const codigos = async (periodo: Record<string, string>) =>
      ((await consulta(rota, { customerId: cliente.id, all: "true", ...periodo })).rows as { code: string }[])
        .map((linha) => linha.code)
        .sort();
    const esperado = (...bordas: Borda[]) => bordas.map(codigo).sort();

    // O mesmo dia nas duas pontas é o dia INTEIRO — e só ele.
    expect(await codigos({ from: DIA, to: DIA })).toEqual(esperado(...DO_DIA_12));
    // Início e fim do intervalo: cada ponta anda um dia, sem off-by-one.
    expect(await codigos({ from: "2026-09-11", to: DIA })).toEqual(esperado("ANTES", ...DO_DIA_12));
    expect(await codigos({ from: DIA, to: "2026-09-13" })).toEqual(esperado(...DO_DIA_12, "DEPOIS"));
    // Ponta aberta continua legítima.
    expect(await codigos({ from: DIA })).toEqual(esperado(...DO_DIA_12, "DEPOIS"));
    expect(await codigos({ to: DIA })).toEqual(esperado("ANTES", ...DO_DIA_12));

    // CSV (e o PDF, que lê o CSV): o mesmo recorte, e o nome diz o dia pedido.
    const arquivo = await csv(`${rota}/export.csv`, { customerId: cliente.id, from: DIA, to: DIA });
    expect(arquivo.linhas).toHaveLength(3);
    for (const borda of DO_DIA_12) {
      expect(arquivo.linhas.some((linha) => linha.includes(codigo(borda)))).toBe(true);
    }
    expect(arquivo.arquivo).toContain("veridi_r12_pedidos_2026-09-12_2026-09-12.csv");
  });

  it("R-05: Planejado x Realizado por `completedAt` segue a mesma borda", async () => {
    const m = marcador();
    const cliente = await criarCliente(m);
    const produto = await criarProduto(m, cliente.id);
    const codigo = (borda: Borda) => `OP-${m}-${borda}`;
    const ordens = await getPrisma().productionOrder.createManyAndReturn({
      data: (Object.keys(BORDAS) as Borda[]).map((borda) => ({
        code: codigo(borda),
        productId: produto.id,
        productCode: produto.code,
        productName: produto.name,
        plannedQuantity: "10",
        outputUnitCode: "kg",
        status: "COMPLETED" as const,
        completedAt: new Date(BORDAS[borda]),
      })),
      select: { id: true },
    });
    criados.ordens.push(...ordens.map((ordem) => ordem.id));

    const rota = "/reports/production/planned-actual";
    const filtro = { productId: produto.id, from: DIA, to: DIA };
    const linhas = (await consulta(rota, { ...filtro, all: "true" })).rows as { productionOrderCode: string }[];
    expect(linhas.map((linha) => linha.productionOrderCode).sort()).toEqual(DO_DIA_12.map(codigo).sort());

    const arquivo = await csv(`${rota}/export.csv`, filtro);
    expect(arquivo.linhas).toHaveLength(3);
    expect(arquivo.arquivo).toContain("veridi_r05_planejado_realizado_2026-09-12_2026-09-12.csv");
  });
});

describe("coluna de DATA CIVIL — o marcador do dia escolhido", () => {
  it("R-08: a OC com data de 12/09 está no dia 12, nunca no 11 nem no 13", async () => {
    const m = marcador();
    const prisma = getPrisma();
    const fornecedor = await prisma.supplier.create({
      data: { code: `FOR-${m}`, legalName: `Fornecedor Dia Comercial ${m}` },
    });
    criados.fornecedores.push(fornecedor.id);
    const dias = ["2026-09-11", DIA, "2026-09-13"];
    const ordens = await prisma.purchaseOrder.createManyAndReturn({
      data: dias.map((dia) => ({
        code: `OC-${m}-${dia}`,
        supplierId: fornecedor.id,
        supplierCode: fornecedor.code,
        supplierName: fornecedor.legalName,
        orderDate: marcadorDoDiaCivil(dia),
        status: "ORDERED" as const,
      })),
      select: { id: true },
    });
    criados.ordensDeCompra.push(...ordens.map((ordem) => ordem.id));

    const rota = "/reports/purchasing/orders";
    const codigos = async (periodo: Record<string, string>) =>
      ((await consulta(rota, { supplierId: fornecedor.id, all: "true", ...periodo })).rows as { code: string }[])
        .map((linha) => linha.code)
        .sort();

    expect(await codigos({ from: DIA, to: DIA })).toEqual([`OC-${m}-${DIA}`]);
    expect(await codigos({ from: "2026-09-11", to: DIA })).toEqual([`OC-${m}-2026-09-11`, `OC-${m}-${DIA}`]);
    expect(await codigos({ from: DIA, to: "2026-09-13" })).toEqual([`OC-${m}-${DIA}`, `OC-${m}-2026-09-13`]);

    const arquivo = await csv(`${rota}/export.csv`, { supplierId: fornecedor.id, from: DIA, to: DIA });
    expect(arquivo.linhas).toHaveLength(1);
    expect(arquivo.linhas[0]).toContain(`OC-${m}-${DIA}`);
    expect(arquivo.arquivo).toContain("veridi_r08_ordens_de_compra_2026-09-12_2026-09-12.csv");
  });

  it("R-02 personalizado: a validade 12/09 está no dia 12 — antes, em São Paulo, saía a de 13/09", async () => {
    const m = marcador();
    const prisma = getPrisma();
    const item = await prisma.item.create({
      data: {
        type: "RAW_MATERIAL",
        code: `MP-${m}`,
        name: `Matéria-prima ${m}`,
        unitCode: "kg",
        controlsLot: true,
        controlsExpiry: true,
        requiresQualityRelease: false,
      },
    });
    criados.itens.push(item.id);
    const dias = ["2026-09-11", DIA, "2026-09-13"];
    const lotes = await prisma.lot.createManyAndReturn({
      data: dias.map((dia) => ({
        code: `LT-${m}-${dia}`,
        itemId: item.id,
        expiryDate: marcadorDoDiaCivil(dia),
        initialReceivedQuantity: "0",
      })),
      select: { id: true },
    });
    criados.lotes.push(...lotes.map((lote) => lote.id));

    const filtro = { itemId: item.id, window: "CUSTOM", onlyWithBalance: "false" };
    const rota = "/reports/inventory/expiry";
    const lotesDoPeriodo = async (periodo: Record<string, string>) =>
      ((await consulta(rota, { ...filtro, all: "true", ...periodo })).rows as { lotCode: string }[]).map(
        (linha) => linha.lotCode,
      );

    expect(await lotesDoPeriodo({ from: DIA, to: DIA })).toEqual([`LT-${m}-${DIA}`]);
    expect(await lotesDoPeriodo({ from: DIA, to: "2026-09-13" })).toEqual([`LT-${m}-${DIA}`, `LT-${m}-2026-09-13`]);

    const arquivo = await csv(`${rota}/export.csv`, { ...filtro, from: DIA, to: DIA });
    expect(arquivo.linhas).toHaveLength(1);
    expect(arquivo.linhas[0]).toContain(`LT-${m}-${DIA}`);
  });
});

describe("contrato — o período é dia, nunca instante", () => {
  const ROTAS = [
    "/reports/inventory/expiry?window=CUSTOM&",
    "/reports/inventory/movements?",
    "/reports/production/planned-actual?",
    "/reports/production/consumption?",
    "/reports/purchasing/orders?",
    "/reports/purchasing/receipts?",
    "/reports/commercial/orders?",
    "/reports/commercial/fulfillment?",
    "/reports/commercial/quote-pricing?",
    "/reports/billing/period?",
    "/reports/billing/order-delivered-billed?",
  ];
  const TODAS = ROTAS.flatMap((rota) => [rota, rota.replace("?", "/export.csv?")]);

  it.each(TODAS)("%s recusa a meia-noite do navegador e o dia em outro formato", async (rota) => {
    // Exatamente o que a tela mandava de um navegador em São Paulo.
    for (const valor of ["2026-09-12T03:00:00.000Z", "12/09/2026", "2026-02-30"]) {
      const response = await app.inject({ method: "GET", url: `${rota}from=${encodeURIComponent(valor)}` });
      expect(response.statusCode, `${rota} from=${valor}`).toBe(400);
    }
    const aceito = await app.inject({ method: "GET", url: `${rota}from=${DIA}&to=${DIA}&pageSize=1` });
    expect(aceito.statusCode, aceito.body.slice(0, 200)).toBe(200);
  });

  it("guarda estrutural: nenhum serviço de relatório usa `from`/`to` cru num `where`", () => {
    const pasta = fileURLToPath(new URL("./", import.meta.url));
    const servicos = readdirSync(pasta).filter((arquivo) => arquivo.endsWith(".service.ts"));
    expect(servicos.length).toBeGreaterThanOrEqual(6);
    for (const arquivo of servicos) {
      const fonte = readFileSync(join(pasta, arquivo), "utf8");
      // O dia só vira instante em `report-period.ts`, com fim exclusivo.
      expect(fonte, arquivo).not.toMatch(/\b(gte|gt|lte|lt):\s*query\.(from|to)\b/);
    }
    const schemas = readFileSync(join(pasta, "reports.schemas.ts"), "utf8");
    const periodo = schemas.slice(schemas.indexOf("export const periodFields"));
    expect(periodo.slice(0, periodo.indexOf("};"))).toMatch(/from:\s*diaCivilDeFiltroSchema/);
    expect(periodo.slice(0, periodo.indexOf("};"))).toMatch(/to:\s*diaCivilDeFiltroSchema/);
  });
});
