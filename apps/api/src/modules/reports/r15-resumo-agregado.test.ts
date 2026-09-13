import { Prisma } from "@prisma/client";
import { limitesDoDiaComercial } from "@veridi/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { ALL_ROWS } from "../../lib/pagination.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getBillingPeriodReport } from "./billing-reports.service.js";

/*
 * R-15 — o resumo sai agregado do banco (PERFORMANCE-CLEANUP-WAVE-01).
 *
 * O resumo (documentos, com preço completo, valor) carregava todo faturamento do
 * filtro com todas as linhas só para contar e somar, a cada página pedida. Agora
 * vem de duas contagens e de uma soma de quantidade por preço. A regra não muda:
 * o resumo é do FILTRO inteiro, nunca da página; o valor só existe quando todos
 * os documentos têm preço completo; documento sem linha não é completo.
 *
 * A prova de igualdade é contra a conta de antes, refeita aqui sobre as mesmas
 * linhas lidas por inteiro — quantidade com 12 casas, preço com 4.
 */
const registro = vi.hoisted(() => ({
  ligado: false,
  operacoes: [] as { model: string; operation: string; args: Record<string, unknown> }[],
}));

vi.mock("../../db/prisma.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/prisma.js")>();
  const cliente = real.getPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (registro.ligado) registro.operacoes.push({ model, operation, args: (args ?? {}) as Record<string, unknown> });
          return query(args);
        },
      },
    },
  });
  return { ...real, getPrisma: () => cliente };
});

type App = ReturnType<typeof buildTestApp>;
let app: App;

const DIA = "2026-04-14";
const { inicio, fim } = limitesDoDiaComercial(DIA);
const PERIODO = { from: DIA, to: DIA };
const PAGINA = 7;

const criados = { clientes: [] as string[], pedidos: [] as string[], produtos: [] as string[], itens: [] as string[] };
const clientes = { completo: "", incompleto: "", vazio: "" };

function marcador(): string {
  return `RS${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

/** Números fixos com 12 casas na quantidade e 4 no preço — a mesma massa a cada execução. */
function gerador(semente: number) {
  let estado = semente;
  const proximo = () => (estado = (estado * 1103515245 + 12345) % 2147483648) / 2147483648;
  return {
    quantidade: () => `${Math.floor(proximo() * 900)}.${String(Math.floor(proximo() * 1e12)).padStart(12, "0")}`,
    preco: () => `${Math.floor(proximo() * 9000)}.${String(Math.floor(proximo() * 1e4)).padStart(4, "0")}`,
  };
}

/**
 * Faturamentos emitidos de um cliente, cada um com a própria expedição.
 * `linhasPorDocumento(i)` diz quantas linhas; `semPreco(i, j)`, qual linha não tem preço.
 */
async function faturamentos(
  sufixo: string,
  documentos: number,
  linhasPorDocumento: (i: number) => number,
  semPreco: (i: number, j: number) => boolean = () => false,
) {
  const prisma = getPrisma();
  const m = marcador();
  const cliente = await prisma.customer.create({ data: { code: `CLI-${m}${sufixo}`, legalName: `Cliente R15 ${m}`, active: true } });
  criados.clientes.push(cliente.id);
  const item = await prisma.item.create({
    data: { type: "FINISHED_PRODUCT", code: `PA-${m}`, name: `Acabado ${m}`, unitCode: "kg", controlsLot: false, controlsExpiry: false, requiresQualityRelease: false },
  });
  criados.itens.push(item.id);
  const produto = await prisma.product.create({
    data: { code: `PROD-${m}`, name: `Produto ${m}`, customerId: cliente.id, finishedProductItemId: item.id },
  });
  criados.produtos.push(produto.id);
  const pedido = await prisma.customerOrder.create({
    data: { code: `PED-${m}`, customerId: cliente.id, customerName: cliente.legalName, status: "SHIPPED" },
  });
  criados.pedidos.push(pedido.id);
  const linhaDoPedido = await prisma.customerOrderLine.create({
    data: { customerOrderId: pedido.id, productId: produto.id, orderedQuantity: "100000", unitCode: "kg", position: 0 },
  });
  const reserva = await prisma.customerOrderReservation.create({ data: { customerOrderId: pedido.id } });
  const linhaDaReserva = await prisma.customerOrderReservationLine.create({
    data: { reservationId: reserva.id, customerOrderLineId: linhaDoPedido.id, productId: produto.id, itemId: item.id, quantity: "100000" },
  });
  // Um rascunho a mais, fora de qualquer contagem: R-15 é só emitido.
  const expedicoes = await prisma.shipment.createManyAndReturn({
    data: Array.from({ length: documentos + 1 }, (_, i) => ({
      code: `EXP-${m}-${i}`,
      customerOrderId: pedido.id,
      status: "CONFIRMED" as const,
      confirmedAt: inicio,
    })),
    select: { id: true },
  });
  const numeros = gerador(documentos * 7919 + sufixo.charCodeAt(0));
  for (const [i, expedicao] of expedicoes.entries()) {
    const rascunho = i === documentos;
    const linhas = rascunho ? 1 : linhasPorDocumento(i);
    const linhasDeExpedicao = await prisma.shipmentLine.createManyAndReturn({
      data: Array.from({ length: Math.max(linhas, 1) }, (_, j) => ({
        shipmentId: expedicao.id,
        customerOrderLineId: linhaDoPedido.id,
        customerOrderReservationLineId: linhaDaReserva.id,
        productId: produto.id,
        itemId: item.id,
        quantity: "1",
        unitCode: "kg",
        position: j,
      })),
      select: { id: true },
    });
    const faturamento = await prisma.billing.create({
      data: {
        code: `FAT-${m}-${String(i).padStart(3, "0")}`,
        customerOrderId: pedido.id,
        shipmentId: expedicao.id,
        customerName: cliente.legalName,
        customerOrderCode: pedido.code,
        ...(rascunho
          ? { status: "DRAFT" as const }
          : { status: "ISSUED" as const, issuedAt: new Date(inicio.getTime() + Math.floor(((fim.getTime() - inicio.getTime()) * i) / documentos)) }),
      },
    });
    if (linhas === 0) continue;
    await prisma.billingLine.createMany({
      data: linhasDeExpedicao.map((linha, j) => ({
        billingId: faturamento.id,
        shipmentLineId: linha.id,
        customerOrderLineId: linhaDoPedido.id,
        productId: produto.id,
        itemId: item.id,
        productCode: produto.code,
        productName: produto.name,
        itemCode: item.code,
        itemName: item.name,
        quantity: numeros.quantidade(),
        unitCode: "kg",
        unitPrice: semPreco(i, j) ? null : numeros.preco(),
        position: j,
      })),
    });
  }
  return cliente.id;
}

/** A conta de antes, sobre todos os documentos do filtro lidos com todas as linhas. */
async function resumoDeAntes(where: Prisma.BillingWhereInput) {
  const documentos = await getPrisma().billing.findMany({ where, select: { lines: { select: { quantity: true, unitPrice: true } } } });
  let completos = 0;
  let soma = new Prisma.Decimal(0);
  for (const { lines } of documentos) {
    if (lines.length === 0 || lines.some((linha) => linha.unitPrice === null)) continue;
    completos += 1;
    for (const linha of lines) soma = soma.plus(linha.quantity.times(linha.unitPrice!));
  }
  return {
    billingCount: documentos.length,
    billingsWithCompletePricing: completos,
    totalAmount: documentos.length > 0 && completos === documentos.length ? soma.toFixed(2) : null,
  };
}

const doCliente = (customerId: string): Prisma.BillingWhereInput => ({
  status: "ISSUED",
  customerOrder: { is: { customerId } },
  issuedAt: { gte: inicio, lte: fim },
});

async function consulta(params: Record<string, string>) {
  const response = await app.inject({ method: "GET", url: `/reports/billing/period?${new URLSearchParams(params)}` });
  expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
  return response.json();
}

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  app = buildTestApp();
  await app.ready();
  // 45 documentos de 1 a 3 linhas, todos com preço.
  clientes.completo = await faturamentos("A", 45, (i) => 1 + (i % 3));
  // 9 documentos: o #2 com uma linha sem preço, o #5 sem linha nenhuma.
  clientes.incompleto = await faturamentos("B", 9, (i) => (i === 5 ? 0 : 2), (i, j) => i === 2 && j === 1);
  // Só o rascunho: nenhum emitido.
  clientes.vazio = await faturamentos("C", 0, () => 1);
}, 120_000);

afterAll(async () => {
  const prisma = getPrisma();
  const pedidos = { customerOrderId: { in: criados.pedidos } };
  await prisma.billingLine.deleteMany({ where: { billing: pedidos } });
  await prisma.billing.deleteMany({ where: pedidos });
  await prisma.shipmentLine.deleteMany({ where: { shipment: pedidos } });
  await prisma.shipment.deleteMany({ where: pedidos });
  await prisma.customerOrderReservationLine.deleteMany({ where: { reservation: pedidos } });
  await prisma.customerOrderReservation.deleteMany({ where: pedidos });
  await prisma.customerOrderLine.deleteMany({ where: pedidos });
  await prisma.customerOrder.deleteMany({ where: { id: { in: criados.pedidos } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await app.close();
});

describe("R-15 — resumo agregado, igual à conta de antes", () => {
  it("0 documentos: resumo zerado, sem valor, e a tabela vazia", async () => {
    const pagina = await consulta({ customerId: clientes.vazio, ...PERIODO, pageSize: String(PAGINA) });
    expect(pagina.total).toBe(0);
    expect(pagina.rows).toEqual([]);
    expect(pagina.summary).toEqual({ billingCount: 0, billingsWithCompletePricing: 0, totalAmount: null });
    expect(pagina.summary).toEqual(await resumoDeAntes(doCliente(clientes.vazio)));
  });

  it("incompleto: linha sem preço e documento sem linha não contam como completos, e o valor não sai", async () => {
    const pagina = await consulta({ customerId: clientes.incompleto, ...PERIODO, pageSize: String(PAGINA) });
    expect(pagina.summary).toEqual({ billingCount: 9, billingsWithCompletePricing: 7, totalAmount: null });
    expect(pagina.summary).toEqual(await resumoDeAntes(doCliente(clientes.incompleto)));
    // A linha sem preço aparece na própria linha da tabela.
    const incompletas = (await consulta({ customerId: clientes.incompleto, ...PERIODO, all: "true" })).rows.filter(
      (linha: { hasCompletePricing: boolean }) => !linha.hasCompletePricing,
    );
    expect(incompletas).toHaveLength(2);
  });

  it("completo em várias páginas: todas as páginas trazem o resumo do filtro inteiro, não o da página", async () => {
    const antes = await resumoDeAntes(doCliente(clientes.completo));
    expect(antes.billingCount).toBe(45);
    expect(antes.totalAmount).not.toBeNull();

    const paginas = Math.ceil(45 / PAGINA);
    const codigos = new Set<string>();
    for (let page = 1; page <= paginas; page += 1) {
      const pagina = await consulta({ customerId: clientes.completo, ...PERIODO, pageSize: String(PAGINA), page: String(page) });
      expect(pagina.summary, `página ${page}`).toEqual(antes);
      expect(pagina.total).toBe(45);
      for (const linha of pagina.rows) codigos.add(linha.code);

      // O valor do resumo não é o da página.
      const daPagina = pagina.rows.reduce(
        (soma: Prisma.Decimal, linha: { totalAmount: string }) => soma.plus(linha.totalAmount),
        new Prisma.Decimal(0),
      );
      expect(new Prisma.Decimal(pagina.summary.totalAmount).greaterThan(daPagina), `página ${page}`).toBe(true);
    }
    expect(codigos.size).toBe(45);
  });

  it("filtro reduz o resumo junto, e resultado completo e CSV continuam com todas as linhas", async () => {
    const todas = (await consulta({ customerId: clientes.completo, ...PERIODO, all: "true" })).rows as { code: string }[];
    const prefixo = `${todas[0]!.code.slice(0, -3)}00`; // FAT-<m>-00: os documentos 0 a 9
    const recorte = await consulta({ customerId: clientes.completo, ...PERIODO, search: prefixo, pageSize: String(PAGINA) });
    expect(recorte.total).toBe(10);
    expect(recorte.summary).toEqual(
      await resumoDeAntes({ ...doCliente(clientes.completo), code: { contains: prefixo, mode: "insensitive" } }),
    );

    const completo = await getBillingPeriodReport(
      { customerId: clientes.completo, ...PERIODO, page: 1, pageSize: PAGINA, all: true },
      ALL_ROWS,
    );
    expect(completo.rows).toHaveLength(45);
    expect(completo.summary).toEqual(await resumoDeAntes(doCliente(clientes.completo)));
    const csv = await app.inject({
      method: "GET",
      url: `/reports/billing/period/export.csv?${new URLSearchParams({ customerId: clientes.completo, ...PERIODO })}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body.replace(/^﻿/, "").split("\r\n").filter(Boolean)).toHaveLength(46);
  });

  it("o resumo não lê documento nem linha: só a página, duas contagens e a soma por preço", async () => {
    registro.operacoes = [];
    registro.ligado = true;
    try {
      await getBillingPeriodReport({ customerId: clientes.completo, ...PERIODO, page: 2, pageSize: PAGINA, all: false });
    } finally {
      registro.ligado = false;
    }
    const chamadas = registro.operacoes.map((op) => `${op.model}.${op.operation}`).sort();
    expect(chamadas).toEqual(["Billing.count", "Billing.count", "Billing.findMany", "BillingLine.groupBy"]);
    // O único findMany é o da página.
    const pagina = registro.operacoes.find((op) => op.operation === "findMany")!;
    expect(pagina.args["take"]).toBe(PAGINA);
  });
});
