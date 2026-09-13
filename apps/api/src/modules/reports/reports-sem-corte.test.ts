import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { limitesDoDiaComercial } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Relatórios sem corte silencioso (REPORTS-PAGINATION-01).
 *
 * A tela de relatórios tinha seletores que carregavam as primeiras 100 OPs,
 * os primeiros 100 Pedidos e os primeiros mil Clientes e Fornecedores, e se
 * apresentavam como o universo inteiro. Os seletores passaram a buscar no
 * servidor. Estes testes provam o outro lado do contrato, com volume acima
 * dos antigos tetos: o read model conta, pagina, resume e exporta o FILTRO
 * inteiro — e o registro de fora da primeira página é alcançável pela busca
 * e pela identidade que os seletores usam.
 *
 * Tudo nasce por `createManyAndReturn`: o assunto é volume e recorte, não o
 * fluxo de negócio que cria cada documento (esse tem teste próprio).
 */

type App = ReturnType<typeof buildTestApp>;

const UNIVERSO = 137;
const PAGINA = 25;
/** Acima do antigo `pageSize: 1000` dos filtros de Cliente e Fornecedor. */
const ACIMA_DE_MIL = 1005;

/**
 * Um dia comercial fixo. `from`/`to` são o DIA que a tela manda; `inicio` e
 * `fim` são o começo e o último milissegundo dele em São Paulo, usados como
 * borda — a regra de fuso não é reaberta aqui (REPORTS-BUSINESS-DATE-01).
 */
const DIA = "2026-03-10";
const { inicio, fim } = limitesDoDiaComercial(DIA);
const PERIODO = { from: DIA, to: DIA };

const criados = {
  clientes: [] as string[],
  pedidos: [] as string[],
  ordens: [] as string[],
  produtos: [] as string[],
  itens: [] as string[],
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
  const pedidos = { customerOrderId: { in: criados.pedidos } };
  await prisma.billingLine.deleteMany({ where: { billing: pedidos } });
  await prisma.billing.deleteMany({ where: pedidos });
  await prisma.shipmentLine.deleteMany({ where: { shipment: pedidos } });
  await prisma.shipment.deleteMany({ where: pedidos });
  await prisma.customerOrderReservationLine.deleteMany({ where: { reservation: pedidos } });
  await prisma.customerOrderReservation.deleteMany({ where: pedidos });
  await prisma.productionOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  await prisma.customerOrderLine.deleteMany({ where: pedidos });
  await prisma.customerOrder.deleteMany({ where: { id: { in: criados.pedidos } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await app.close();
});

function marcador(): string {
  return `SC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

/** `i` de `n` instantes no dia: o primeiro é o início exato, o último o fim exato. */
function instanteNoDia(i: number, n: number): Date {
  return new Date(inicio.getTime() + Math.floor(((fim.getTime() - inicio.getTime()) * i) / (n - 1)));
}

function numero(n: number): string {
  return String(n).padStart(4, "0");
}

async function consulta(url: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await app.inject({ method: "GET", url: `${url}${query ? `?${query}` : ""}` });
  expect(response.statusCode, `${url} ${response.body.slice(0, 200)}`).toBe(200);
  return response.json();
}

/** Linhas de dados do CSV (sem BOM e sem cabeçalho). */
async function linhasDoCsv(url: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  const response = await app.inject({ method: "GET", url: `${url}?${query}` });
  expect(response.statusCode).toBe(200);
  const linhas = response.body.replace(/^﻿/, "").split("\r\n").filter((linha) => linha.length > 0);
  return linhas.slice(1);
}

async function criarCliente(sufixo: string) {
  const cliente = await getPrisma().customer.create({
    data: { code: `CLI-${sufixo}`, legalName: `Cliente Sem Corte ${sufixo}`, active: true },
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
  return { item, produto };
}

describe("R-12 e seletor do R-14 — 137 pedidos", () => {
  it("total, páginas, completo, CSV, filtros e borda do dia refletem os 137", { timeout: 60_000 }, async () => {
    const prisma = getPrisma();
    const m = marcador();
    const clienteA = await criarCliente(`${m}A`);
    const clienteB = await criarCliente(`${m}B`);
    const codigo = (n: number) => `PED-${m}-A${numero(n)}`;

    const noDia = await prisma.customerOrder.createManyAndReturn({
      data: Array.from({ length: UNIVERSO }, (_, i) => ({
        code: codigo(i + 1),
        customerId: clienteA.id,
        customerName: clienteA.legalName,
        orderDate: instanteNoDia(i, UNIVERSO),
        // 40 cancelados espalhados: o recorte por status cai no meio das páginas.
        status: i % 7 < 2 ? ("CANCELLED" as const) : ("CONFIRMED" as const),
      })),
      select: { id: true, code: true },
    });
    const bordas = await prisma.customerOrder.createManyAndReturn({
      data: [
        // Último milissegundo do dia anterior e primeiro do seguinte, em São Paulo.
        { code: `PED-${m}-A-ANTES`, orderDate: new Date(inicio.getTime() - 1) },
        { code: `PED-${m}-A-DEPOIS`, orderDate: new Date(fim.getTime() + 1) },
      ].map((pedido) => ({ ...pedido, customerId: clienteA.id, status: "CONFIRMED" as const })),
      select: { id: true },
    });
    const deB = await prisma.customerOrder.createManyAndReturn({
      data: Array.from({ length: 9 }, (_, i) => ({
        code: `PED-${m}-B${numero(i + 1)}`,
        customerId: clienteB.id,
        orderDate: instanteNoDia(i, 9),
        status: "CONFIRMED" as const,
      })),
      select: { id: true },
    });
    criados.pedidos.push(...[...noDia, ...bordas, ...deB].map((pedido) => pedido.id));

    const filtro = { customerId: clienteA.id, ...PERIODO };
    const rota = "/reports/commercial/orders";

    // Página 1 mostra só `pageSize`; o total é o do universo filtrado.
    const primeira = await consulta(rota, { ...filtro, pageSize: String(PAGINA) });
    expect(primeira.total).toBe(UNIVERSO);
    expect(primeira.rows).toHaveLength(PAGINA);

    // Todas as páginas juntas são o universo, sem repetir nem perder linha.
    const vistos = new Set<string>();
    for (let page = 1; page <= Math.ceil(UNIVERSO / PAGINA); page += 1) {
      const pagina = await consulta(rota, { ...filtro, pageSize: String(PAGINA), page: String(page) });
      expect(pagina.total).toBe(UNIVERSO);
      for (const linha of pagina.rows) vistos.add(linha.customerOrderId);
    }
    expect(vistos.size).toBe(UNIVERSO);
    const ultima = await consulta(rota, { ...filtro, pageSize: String(PAGINA), page: "6" });
    expect(ultima.rows).toHaveLength(UNIVERSO - 5 * PAGINA);

    // Resultado completo (impressão) e CSV: os 137, nunca 100 nem a página.
    const completo = await consulta(rota, { ...filtro, all: "true" });
    expect(completo.rows).toHaveLength(UNIVERSO);
    expect(await linhasDoCsv(`${rota}/export.csv`, filtro)).toHaveLength(UNIVERSO);

    // Filtro reduz o universo — total, páginas e CSV acompanham.
    const cancelados = await consulta(rota, { ...filtro, status: "CANCELLED", pageSize: String(PAGINA) });
    expect(cancelados.total).toBe(40);
    expect(cancelados.rows.every((linha: { status: string }) => linha.status === "CANCELLED")).toBe(true);
    const canceladosP2 = await consulta(rota, {
      ...filtro,
      status: "CANCELLED",
      pageSize: String(PAGINA),
      page: "2",
    });
    expect(canceladosP2.rows).toHaveLength(15);
    expect(await linhasDoCsv(`${rota}/export.csv`, { ...filtro, status: "CANCELLED" })).toHaveLength(40);
    expect((await consulta(rota, { customerId: clienteB.id, ...PERIODO })).total).toBe(9);

    // Borda do dia comercial: início e fim exatos entram; um milissegundo fora, não.
    expect((await consulta(rota, { customerId: clienteA.id, all: "true" })).total).toBe(UNIVERSO + 2);
    const codigos = new Set(completo.rows.map((linha: { code: string }) => linha.code));
    expect(codigos.has(codigo(1))).toBe(true);
    expect(codigos.has(codigo(UNIVERSO))).toBe(true);
    expect(codigos.has(`PED-${m}-A-ANTES`)).toBe(false);
    expect(codigos.has(`PED-${m}-A-DEPOIS`)).toBe(false);

    // Seletor do R-14: os 100 primeiros — o antigo teto — não chegam ao mais
    // antigo; a busca do seletor chega, e o id resolve a cadeia.
    const antigoTeto = await consulta("/customer-orders", { search: `PED-${m}-A`, pageSize: "100" });
    expect(antigoTeto.total).toBe(UNIVERSO + 2);
    expect(antigoTeto.customerOrders.some((pedido: { code: string }) => pedido.code === codigo(1))).toBe(false);
    const busca = await consulta("/customer-orders", { search: codigo(1), pageSize: "20" });
    const achado = busca.customerOrders.find((pedido: { code: string }) => pedido.code === codigo(1));
    expect(achado).toBeDefined();
    expect((await consulta(`/customer-orders/${achado.id}`)).code).toBe(codigo(1));
    expect((await consulta("/reports/commercial/order-operation", { customerOrderId: achado.id })).code).toBe(
      codigo(1),
    );
  });
});

describe("Seletor do R-06 — 137 OPs", () => {
  it("a OP mais antiga fica fora das 100 primeiras e é alcançada pela busca", { timeout: 60_000 }, async () => {
    const m = marcador();
    const cliente = await criarCliente(`${m}OP`);
    const { produto } = await criarProduto(m, cliente.id);
    const codigo = (n: number) => `OP-${m}-${numero(n)}`;
    const ordens = await getPrisma().productionOrder.createManyAndReturn({
      data: Array.from({ length: UNIVERSO }, (_, i) => ({
        code: codigo(i + 1),
        productId: produto.id,
        productCode: produto.code,
        productName: produto.name,
        plannedQuantity: "10",
        outputUnitCode: "kg",
        status: "COMPLETED" as const,
      })),
      select: { id: true, code: true },
    });
    criados.ordens.push(...ordens.map((ordem) => ordem.id));

    const antigoTeto = await consulta("/production-orders", { search: `OP-${m}`, pageSize: "100" });
    expect(antigoTeto.total).toBe(UNIVERSO);
    expect(antigoTeto.productionOrders).toHaveLength(100);
    expect(antigoTeto.productionOrders.some((ordem: { code: string }) => ordem.code === codigo(1))).toBe(false);

    const busca = await consulta("/production-orders", { search: codigo(1), pageSize: "20" });
    const achada = busca.productionOrders.find((ordem: { code: string }) => ordem.code === codigo(1));
    expect(achada).toBeDefined();
    expect((await consulta(`/production-orders/${achada.id}`)).code).toBe(codigo(1));
    const genealogia = await consulta("/reports/production/traceability", { productionOrderId: achada.id });
    expect(genealogia.productionOrderCode).toBe(codigo(1));
  });
});

describe("R-15 — 137 faturamentos emitidos", () => {
  it("o resumo soma os 137 do filtro — não a página, não os 100", { timeout: 60_000 }, async () => {
    const prisma = getPrisma();
    const m = marcador();
    const cliente = await criarCliente(`${m}FAT`);
    const { item, produto } = await criarProduto(m, cliente.id);

    const pedido = await prisma.customerOrder.create({
      data: { code: `PED-${m}-FAT`, customerId: cliente.id, customerName: cliente.legalName, status: "SHIPPED" },
    });
    criados.pedidos.push(pedido.id);
    const linhaDoPedido = await prisma.customerOrderLine.create({
      data: { customerOrderId: pedido.id, productId: produto.id, orderedQuantity: "1000", unitCode: "kg", position: 0 },
    });
    const reserva = await prisma.customerOrderReservation.create({ data: { customerOrderId: pedido.id } });
    const linhaDaReserva = await prisma.customerOrderReservationLine.create({
      data: {
        reservationId: reserva.id,
        customerOrderLineId: linhaDoPedido.id,
        productId: produto.id,
        itemId: item.id,
        quantity: "1000",
      },
    });

    // Um faturamento ativo por expedição: 137 no dia, 1 um milissegundo antes
    // do dia, e 1 rascunho (não emitido) — cada um com a sua expedição.
    const TOTAL_DE_DOCUMENTOS = UNIVERSO + 2;
    const expedicoes = await prisma.shipment.createManyAndReturn({
      data: Array.from({ length: TOTAL_DE_DOCUMENTOS }, (_, i) => ({
        code: `EXP-${m}-${numero(i + 1)}`,
        customerOrderId: pedido.id,
        status: "CONFIRMED" as const,
        confirmedAt: inicio,
      })),
      select: { id: true, code: true },
    });
    const linhasDeExpedicao = await prisma.shipmentLine.createManyAndReturn({
      data: expedicoes.map((expedicao) => ({
        shipmentId: expedicao.id,
        customerOrderLineId: linhaDoPedido.id,
        customerOrderReservationLineId: linhaDaReserva.id,
        productId: produto.id,
        itemId: item.id,
        quantity: "1",
        unitCode: "kg",
        position: 0,
      })),
      select: { id: true, shipmentId: true },
    });
    const linhaPorExpedicao = new Map(linhasDeExpedicao.map((linha) => [linha.shipmentId, linha.id]));

    // 125 com "-A" e 12 com "-B": a busca por "-B" recorta 12 do universo.
    const codigoDoFaturamento = (i: number) => `FAT-${m}-${i < 125 ? "A" : "B"}${numero(i + 1)}`;
    const faturamentos = await prisma.billing.createManyAndReturn({
      data: expedicoes.map((expedicao, i) => {
        const base = {
          customerOrderId: pedido.id,
          shipmentId: expedicao.id,
          customerName: cliente.legalName,
          customerOrderCode: pedido.code,
          shipmentCode: expedicao.code,
        };
        if (i < UNIVERSO) {
          return { ...base, code: codigoDoFaturamento(i), status: "ISSUED" as const, issuedAt: instanteNoDia(i, UNIVERSO) };
        }
        if (i === UNIVERSO) {
          return { ...base, code: `FAT-${m}-ANTES`, status: "ISSUED" as const, issuedAt: new Date(inicio.getTime() - 1) };
        }
        return { ...base, code: `FAT-${m}-RASCUNHO`, status: "DRAFT" as const };
      }),
      select: { id: true, shipmentId: true },
    });
    await prisma.billingLine.createMany({
      data: faturamentos.map((faturamento) => ({
        billingId: faturamento.id,
        shipmentLineId: linhaPorExpedicao.get(faturamento.shipmentId)!,
        customerOrderLineId: linhaDoPedido.id,
        productId: produto.id,
        itemId: item.id,
        productCode: produto.code,
        productName: produto.name,
        itemCode: item.code,
        itemName: item.name,
        quantity: "1",
        unitCode: "kg",
        unitPrice: "10",
        position: 0,
      })),
    });

    const filtro = { customerId: cliente.id, ...PERIODO };
    const rota = "/reports/billing/period";

    const primeira = await consulta(rota, { ...filtro, pageSize: String(PAGINA) });
    expect(primeira.total).toBe(UNIVERSO);
    expect(primeira.rows).toHaveLength(PAGINA);
    // 137 × R$ 10,00. Os 100 primeiros dariam 1000.00; a página, 250.00.
    expect(primeira.summary).toEqual({
      billingCount: UNIVERSO,
      billingsWithCompletePricing: UNIVERSO,
      totalAmount: "1370.00",
    });

    // A navegação não mexe no resumo.
    const ultima = await consulta(rota, { ...filtro, pageSize: String(PAGINA), page: "6" });
    expect(ultima.rows).toHaveLength(UNIVERSO - 5 * PAGINA);
    expect(ultima.summary).toEqual(primeira.summary);

    expect((await consulta(rota, { ...filtro, all: "true" })).rows).toHaveLength(UNIVERSO);
    expect(await linhasDoCsv(`${rota}/export.csv`, filtro)).toHaveLength(UNIVERSO);

    // Filtro reduz o universo e o resumo junto.
    const recorte = await consulta(rota, { ...filtro, search: `FAT-${m}-B`, pageSize: String(PAGINA) });
    expect(recorte.total).toBe(12);
    expect(recorte.summary).toEqual({ billingCount: 12, billingsWithCompletePricing: 12, totalAmount: "120.00" });
    expect(await linhasDoCsv(`${rota}/export.csv`, { ...filtro, search: `FAT-${m}-B` })).toHaveLength(12);

    // Borda: sem período entra o emitido um milissegundo antes; o rascunho nunca.
    const semPeriodo = await consulta(rota, { customerId: cliente.id, pageSize: String(PAGINA) });
    expect(semPeriodo.total).toBe(UNIVERSO + 1);
    expect(semPeriodo.summary.totalAmount).toBe("1380.00");
  });
});

describe("Sem teto lógico de 1000", () => {
  it("R-12 conta, pagina e exporta 1.005 pedidos de um cliente", { timeout: 120_000 }, async () => {
    const prisma = getPrisma();
    const m = marcador();
    const cliente = await criarCliente(`${m}MIL`);
    const pedidos = await prisma.customerOrder.createManyAndReturn({
      data: Array.from({ length: ACIMA_DE_MIL }, (_, i) => ({
        code: `PED-${m}-${numero(i + 1)}`,
        customerId: cliente.id,
        orderDate: instanteNoDia(i, ACIMA_DE_MIL),
        status: "CONFIRMED" as const,
      })),
      select: { id: true },
    });
    criados.pedidos.push(...pedidos.map((pedido) => pedido.id));

    const filtro = { customerId: cliente.id, ...PERIODO };
    const rota = "/reports/commercial/orders";
    const primeira = await consulta(rota, { ...filtro, pageSize: String(PAGINA) });
    expect(primeira.total).toBe(ACIMA_DE_MIL);
    const ultimaPagina = Math.ceil(ACIMA_DE_MIL / PAGINA);
    const ultima = await consulta(rota, { ...filtro, pageSize: String(PAGINA), page: String(ultimaPagina) });
    expect(ultima.rows).toHaveLength(ACIMA_DE_MIL - (ultimaPagina - 1) * PAGINA);
    expect((await consulta(rota, { ...filtro, all: "true" })).rows).toHaveLength(ACIMA_DE_MIL);
    expect(await linhasDoCsv(`${rota}/export.csv`, filtro)).toHaveLength(ACIMA_DE_MIL);
  });

  it("o filtro de Cliente alcança o cadastro 1.005 pela busca e pela identidade", { timeout: 120_000 }, async () => {
    const m = marcador();
    const clientes = await getPrisma().customer.createManyAndReturn({
      data: Array.from({ length: ACIMA_DE_MIL }, (_, i) => ({
        code: `CLI-${m}-${numero(i + 1)}`,
        legalName: `Sem Corte ${m} ${numero(i + 1)}`,
        active: true,
      })),
      select: { id: true, code: true },
    });
    criados.clientes.push(...clientes.map((cliente) => cliente.id));

    const universo = await consulta("/customers", { search: `CLI-${m}`, pageSize: "20" });
    expect(universo.total).toBe(ACIMA_DE_MIL);
    for (const alvo of [clientes[0]!, clientes[ACIMA_DE_MIL - 1]!]) {
      const busca = await consulta("/customers", { search: alvo.code, pageSize: "20" });
      expect(busca.customers.map((cliente: { id: string }) => cliente.id)).toContain(alvo.id);
      const porId = await consulta("/customers", { ids: alvo.id, pageSize: "1" });
      expect(porId.customers.map((cliente: { id: string }) => cliente.id)).toEqual([alvo.id]);
    }
  });
});
