import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import type { BillingDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { resumirValorFaturado } from "./billed-value.js";

/**
 * BILLED-VALUE-CANONICAL-01 — "Valor faturado" é o valor dos documentos.
 *
 * Decisão D1 do PO (FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01): o valor de um
 * faturamento é `Billing.totalAmount`, congelado na emissão — bruto das linhas
 * arredondadas, menos o desconto apropriado, mais o ajuste de fechamento. O
 * documento, a lista e o resumo do Pedido já liam esse número; Painel, R-14 e
 * R-15 somavam `quantidade × preço` por conta própria, sem desconto, sem ajuste
 * e sem arredondar a linha.
 *
 * Cada cenário lê os MESMOS documentos no Faturamento (`GET /billings/:id`), no
 * resumo do Pedido, no R-14, na linha e no total do R-15, no CSV do R-15 e no
 * "Valor faturado" do Painel — e todos têm de dizer o mesmo número. Cada
 * cenário emite num dia histórico próprio, porque o Painel não filtra por
 * cliente: no dia só existem os documentos do cenário.
 */

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;
let app: App;

let contador = 0;
const marca = () => `${Date.now().toString(36)}${(contador += 1)}`;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Base sorteada por execução entre 2003 e 2011 — longe das faixas que outras
 * suítes datam (`dashboard.test.ts` em 1990–2000, `reports.test.ts` em 1995, os
 * testes do R-15 em 2026). Meio-dia UTC cai no mesmo dia comercial em São Paulo.
 */
const BASE = Date.UTC(2003, 0, 1) + Math.floor(Math.random() * 3000) * DAY_MS;

function diaDoCenario(offset: number) {
  const inicio = new Date(BASE + offset * DAY_MS);
  return { dia: inicio.toISOString().slice(0, 10), instante: new Date(inicio.getTime() + 12 * 60 * 60 * 1000) };
}

beforeAll(async () => {
  const unidade: { code: string; label: string; dimension: UomDimension; toBaseFactor: string } = {
    code: "un",
    label: "Unidade",
    dimension: "COUNT",
    toBaseFactor: "1",
  };
  await getPrisma().unitOfMeasure.upsert({ where: { code: unidade.code }, update: {}, create: unidade });
  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  const pedidos = { customerOrderId: { in: fixtureCustomerOrderIds } };
  await prisma.billingLine.deleteMany({ where: { billing: pedidos } });
  await prisma.billing.deleteMany({ where: pedidos });
  await prisma.shipmentLine.deleteMany({ where: { shipment: pedidos } });
  await prisma.shipment.deleteMany({ where: pedidos });
  await prisma.productionOrder.deleteMany({ where: pedidos });
  await prisma.customerOrderReservationLine.deleteMany({ where: { reservation: pedidos } });
  await prisma.customerOrderReservation.deleteMany({ where: pedidos });
  await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
  await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  await app.close();
});

async function get(url: string) {
  const resposta = await app.inject({ method: "GET", url });
  expect(resposta.statusCode, `${url} ${resposta.body.slice(0, 300)}`).toBe(200);
  return resposta.json();
}

async function itemAcabadoComEstoque(quantidade: string) {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-VFC-${m}`,
      name: `PA Valor Faturado ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  fixtureItemIds.push(item.id);
  const lot = await prisma.lot.create({
    data: {
      code: `LT-VFC-${m}`.toUpperCase(),
      itemId: item.id,
      origin: "PRODUCTION",
      initialReceivedQuantity: quantidade,
      status: "AVAILABLE",
      createdBy: "Teste",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId: item.id,
      lotId: lot.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity: quantidade,
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "Teste",
    },
  });
  return item;
}

interface LinhaDoPedido {
  quantidade: string;
  /** Preço acordado da linha; `null` = Pedido digitado direto, a linha fatura sem preço. */
  preco: string | null;
}

interface CondicaoComercial {
  subtotal: string;
  total: string;
  descontoPercent: string | null;
}

/**
 * Pedido confirmado e reservado, uma linha por produto, do próprio cliente.
 *
 * O acordo normalmente chega pelo aceite de um orçamento; aqui é gravado direto,
 * que é o estado que o aceite produz (como em `billing-reconciliation.test.ts`).
 */
async function pedido(linhas: LinhaDoPedido[], condicao: CondicaoComercial | null) {
  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-VFC-${m}`, legalName: `Cliente Valor Faturado ${m}` },
  });
  fixtureCustomerIds.push(customer.id);

  const produtos: string[] = [];
  for (const linha of linhas) {
    const item = await itemAcabadoComEstoque(linha.quantidade);
    const produto = (
      await app.inject({
        method: "POST",
        url: "/products",
        payload: { customerId: customer.id, name: `Produto Valor Faturado ${marca()}`, finishedProductItemId: item.id },
      })
    ).json();
    fixtureProductIds.push(produto.id);
    produtos.push(produto.id);
  }

  const criado = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: customer.id,
        lines: linhas.map((linha, i) => ({ productId: produtos[i], orderedQuantity: linha.quantidade })),
      },
    })
  ).json();
  fixtureCustomerOrderIds.push(criado.id);

  const confirmado = (await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })).json();
  const linhaDoProduto = (productId: string): string =>
    confirmado.lines.find((linha: { productId: string }) => linha.productId === productId).id;

  for (const [i, linha] of linhas.entries()) {
    if (linha.preco === null) continue;
    await prisma.customerOrderLine.update({
      where: { id: linhaDoProduto(produtos[i]!) },
      data: { agreedUnitPrice: linha.preco, agreedPriceSource: "PRICING_TIER" },
    });
  }
  if (condicao) {
    await prisma.customerOrder.update({
      where: { id: criado.id },
      data: {
        agreedSubtotalAmount: condicao.subtotal,
        agreedTotalAmount: condicao.total,
        ...(condicao.descontoPercent !== null ? { agreedDiscountPercent: condicao.descontoPercent } : {}),
      },
    });
  }

  await app.inject({
    method: "POST",
    url: `/customer-orders/${criado.id}/apply-fulfillment-plan`,
    payload: {
      lines: linhas.map((linha, i) => ({
        customerOrderLineId: linhaDoProduto(produtos[i]!),
        reserveQuantity: linha.quantidade,
        produceQuantity: "0",
      })),
    },
  });

  return { orderId: criado.id as string };
}

/**
 * Uma Expedição confirmada. Sem `quantidade`, sai tudo o que está reservado; com
 * ela, só a primeira linha, naquela quantidade.
 */
async function expedir(orderId: string, quantidade?: string): Promise<string> {
  const rascunho = (await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })).json();
  if (quantidade !== undefined) {
    await app.inject({
      method: "PATCH",
      url: `/shipments/${rascunho.id}`,
      payload: {
        lines: [{ customerOrderReservationLineId: rascunho.lines[0].customerOrderReservationLineId, quantity: quantidade }],
      },
    });
  }
  const atual = (await app.inject({ method: "GET", url: `/shipments/${rascunho.id}` })).json();
  for (const linha of atual.lines) {
    if (!linha.requiresVerification) continue;
    await app.inject({
      method: "POST",
      url: `/shipments/${rascunho.id}/lines/${linha.id}/verify`,
      payload: { lotCode: linha.lotCode },
    });
  }
  const confirmada = (await app.inject({ method: "POST", url: `/shipments/${rascunho.id}/confirm` })).json();
  expect(confirmada.status, JSON.stringify(confirmada).slice(0, 300)).toBe("CONFIRMED");
  return confirmada.id as string;
}

/** Rascunho → emitido. `precoSemAcordo` preenche as linhas que nasceram sem preço. */
async function faturar(shipmentId: string, precoSemAcordo?: string): Promise<BillingDTO> {
  const rascunho = (await app.inject({ method: "POST", url: "/billings", payload: { shipmentId } })).json();
  if (precoSemAcordo !== undefined) {
    await app.inject({
      method: "PATCH",
      url: `/billings/${rascunho.id}`,
      payload: {
        lines: rascunho.lines.map((line: { id: string }) => ({ billingLineId: line.id, unitPrice: precoSemAcordo })),
      },
    });
  }
  const emitido = (await app.inject({ method: "POST", url: `/billings/${rascunho.id}/issue` })).json();
  expect(emitido.status, JSON.stringify(emitido).slice(0, 300)).toBe("ISSUED");
  return emitido as BillingDTO;
}

/** Leva os documentos para o dia histórico do cenário. */
async function emitirNoDia(billings: BillingDTO[], instante: Date) {
  await getPrisma().billing.updateMany({
    where: { id: { in: billings.map((billing) => billing.id) } },
    data: { issuedAt: instante },
  });
}

interface Esperado {
  billing: BillingDTO;
  /** O número que toda superfície tem de mostrar; `null` = documento sem valor. */
  valor: string | null;
}

interface TotalEsperado {
  documentos: number;
  comValor: number;
  valor: string | null;
}

/**
 * Cada documento em cada superfície, e depois o total do R-15 e o do Painel no
 * dia do cenário.
 */
async function conferirSuperficies(dia: string, esperados: Esperado[], total: TotalEsperado) {
  const r14 = new Map<string, string | null>();
  const resumoDoPedido = new Map<string, string | null>();
  for (const orderId of new Set(esperados.map(({ billing }) => billing.customerOrderId))) {
    const cadeia = await get(`/reports/commercial/order-operation?customerOrderId=${orderId}`);
    for (const b of cadeia.billings as { billingId: string; totalAmount: string | null }[]) {
      r14.set(b.billingId, b.totalAmount);
    }
    const pedidoLido = await get(`/customer-orders/${orderId}`);
    for (const b of pedidoLido.billings as { id: string; totalAmount: string | null }[]) {
      resumoDoPedido.set(b.id, b.totalAmount);
    }
  }

  const periodo = new URLSearchParams({ from: dia, to: dia });
  const r15 = await get(`/reports/billing/period?${periodo}&all=true`);
  const linhasDoR15 = r15.rows as { billingId: string; totalAmount: string | null; hasCompletePricing: boolean }[];

  const csv = await app.inject({ method: "GET", url: `/reports/billing/period/export.csv?${periodo}` });
  expect(csv.statusCode).toBe(200);
  const [cabecalho = "", ...linhasDoCsv] = csv.body
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((linha) => linha.length > 0);
  const colunas = cabecalho.split(";");
  const valorNoCsv = new Map(
    linhasDoCsv.map((linha) => {
      const celulas = linha.split(";");
      return [celulas[colunas.indexOf("Faturamento")], celulas[colunas.indexOf("Valor")]];
    }),
  );

  const painel = (await get(`/dashboard?${periodo}`)).period;

  for (const { billing, valor } of esperados) {
    const documento = await get(`/billings/${billing.id}`);
    expect(documento.totalAmount, `documento ${billing.code}`).toBe(valor);
    expect(resumoDoPedido.get(billing.id), `resumo do Pedido ${billing.code}`).toBe(valor);
    expect(r14.get(billing.id), `R-14 ${billing.code}`).toBe(valor);
    const linha = linhasDoR15.find((row) => row.billingId === billing.id);
    expect(linha?.totalAmount, `R-15 ${billing.code}`).toBe(valor);
    expect(linha?.hasCompletePricing, `R-15 precificação ${billing.code}`).toBe(valor !== null);
    expect(valorNoCsv.get(billing.code), `CSV do R-15 ${billing.code}`).toBe(valor === null ? "" : valor.replace(".", ","));
  }

  expect(r15.summary, "total do R-15").toEqual({
    billingCount: total.documentos,
    billingsWithCompletePricing: total.comValor,
    totalAmount: total.valor,
  });
  expect(
    {
      billingsIssued: painel.billingsIssued,
      billingsWithCompletePricing: painel.billingsWithCompletePricing,
      billedAmount: painel.billedAmount,
    },
    "Valor faturado do Painel",
  ).toEqual({ billingsIssued: total.documentos, billingsWithCompletePricing: total.comValor, billedAmount: total.valor });
}

describe("valor faturado é o valor do documento, em todas as superfícies", () => {
  it("A — sem desconto: 100 × R$ 3,00 vale R$ 300,00", async () => {
    const { dia, instante } = diaDoCenario(0);
    const { orderId } = await pedido([{ quantidade: "100", preco: "3" }], {
      subtotal: "300.00",
      total: "300.00",
      descontoPercent: null,
    });
    const billing = await faturar(await expedir(orderId));
    await emitirNoDia([billing], instante);

    await conferirSuperficies(dia, [{ billing, valor: "300.00" }], { documentos: 1, comValor: 1, valor: "300.00" });
  });

  it("B — com desconto: 10 × R$ 100,00 com 10% vale R$ 900,00, não R$ 1.000,00", async () => {
    const { dia, instante } = diaDoCenario(1);
    const { orderId } = await pedido([{ quantidade: "10", preco: "100" }], {
      subtotal: "1000.00",
      total: "900.00",
      descontoPercent: "10",
    });
    const billing = await faturar(await expedir(orderId));
    await emitirNoDia([billing], instante);

    // O desconto é do cabeçalho: a linha continua a R$ 100,00.
    expect([billing.grossAmount, billing.discountAmount, billing.totalAmount]).toEqual(["1000.00", "100.00", "900.00"]);
    await conferirSuperficies(dia, [{ billing, valor: "900.00" }], { documentos: 1, comValor: 1, valor: "900.00" });
  });

  it("C — ajuste de fechamento: 3 × R$ 33,3333 em três documentos vale 33,33 + 33,33 + 33,34", async () => {
    const { dia, instante } = diaDoCenario(2);
    const { orderId } = await pedido([{ quantidade: "3", preco: "33.3333" }], {
      subtotal: "100.00",
      total: "100.00",
      descontoPercent: null,
    });
    const billings = [
      await faturar(await expedir(orderId, "1")),
      await faturar(await expedir(orderId, "1")),
      await faturar(await expedir(orderId, "1")),
    ];
    await emitirNoDia(billings, instante);

    // Só o documento que completa o Pedido carrega o centavo, no cabeçalho.
    expect(billings.map((b) => b.commercialAdjustmentAmount)).toEqual(["0.00", "0.00", "0.01"]);
    await conferirSuperficies(
      dia,
      [
        { billing: billings[0]!, valor: "33.33" },
        { billing: billings[1]!, valor: "33.33" },
        { billing: billings[2]!, valor: "33.34" },
      ],
      { documentos: 3, comValor: 3, valor: "100.00" },
    );
  });

  it("C — desconto e ajuste juntos: 3 × R$ 33,3333 com 10% fecha em R$ 90,00, não em R$ 100,00", async () => {
    const { dia, instante } = diaDoCenario(3);
    const { orderId } = await pedido([{ quantidade: "3", preco: "33.3333" }], {
      subtotal: "100.00",
      total: "90.00",
      descontoPercent: "10",
    });
    const billings = [
      await faturar(await expedir(orderId, "1")),
      await faturar(await expedir(orderId, "1")),
      await faturar(await expedir(orderId, "1")),
    ];
    await emitirNoDia(billings, instante);

    expect(billings.map((b) => [b.discountAmount, b.commercialAdjustmentAmount])).toEqual([
      ["3.33", "0.00"],
      ["3.34", "0.00"],
      ["3.33", "0.01"],
    ]);
    await conferirSuperficies(
      dia,
      [
        { billing: billings[0]!, valor: "30.00" },
        { billing: billings[1]!, valor: "29.99" },
        { billing: billings[2]!, valor: "30.01" },
      ],
      { documentos: 3, comValor: 3, valor: "90.00" },
    );
  });

  it("D — arredondamento da linha: duas linhas de 1 × R$ 0,1250 valem R$ 0,26, não R$ 0,25", async () => {
    const { dia, instante } = diaDoCenario(4);
    const { orderId } = await pedido(
      [
        { quantidade: "1", preco: null },
        { quantidade: "1", preco: null },
      ],
      null,
    );
    const billing = await faturar(await expedir(orderId), "0.1250");
    await emitirNoDia([billing], instante);

    // Cada linha fecha em R$ 0,13 antes da soma (§55).
    expect(billing.lines.map((line) => line.lineTotal)).toEqual(["0.13", "0.13"]);
    await conferirSuperficies(dia, [{ billing, valor: "0.26" }], { documentos: 1, comValor: 1, valor: "0.26" });
  });

  it("E — vários documentos no período: o total é a soma dos valores dos documentos", async () => {
    const { dia, instante } = diaDoCenario(5);
    const comDesconto = await pedido([{ quantidade: "10", preco: "100" }], {
      subtotal: "1000.00",
      total: "900.00",
      descontoPercent: "10",
    });
    const unico = await faturar(await expedir(comDesconto.orderId));
    const fracionado = await pedido([{ quantidade: "3", preco: "33.3333" }], {
      subtotal: "100.00",
      total: "90.00",
      descontoPercent: "10",
    });
    const partes = [
      await faturar(await expedir(fracionado.orderId, "1")),
      await faturar(await expedir(fracionado.orderId, "1")),
      await faturar(await expedir(fracionado.orderId, "1")),
    ];
    const direto = await pedido(
      [
        { quantidade: "1", preco: null },
        { quantidade: "1", preco: null },
      ],
      null,
    );
    const arredondado = await faturar(await expedir(direto.orderId), "0.1250");
    await emitirNoDia([unico, ...partes, arredondado], instante);

    // 900,00 + 30,00 + 29,99 + 30,01 + 0,26. A soma de `quantidade × preço` daria 1.100,25.
    await conferirSuperficies(
      dia,
      [
        { billing: unico, valor: "900.00" },
        { billing: partes[0]!, valor: "30.00" },
        { billing: partes[1]!, valor: "29.99" },
        { billing: partes[2]!, valor: "30.01" },
        { billing: arredondado, valor: "0.26" },
      ],
      { documentos: 5, comValor: 5, valor: "990.26" },
    );
  });

  it("F — incompleto: documento emitido sem preço tira o total do período, e o outro mantém o seu valor", async () => {
    const { dia, instante } = diaDoCenario(6);
    const completo = await pedido([{ quantidade: "10", preco: "100" }], {
      subtotal: "1000.00",
      total: "900.00",
      descontoPercent: "10",
    });
    const comValor = await faturar(await expedir(completo.orderId));
    const direto = await pedido([{ quantidade: "5", preco: null }], null);
    const semPreco = await faturar(await expedir(direto.orderId));
    await emitirNoDia([comValor, semPreco], instante);

    expect(semPreco.hasCompletePricing).toBe(false);
    // Nunca R$ 900,00 apresentado como total do dia.
    await conferirSuperficies(
      dia,
      [
        { billing: comValor, valor: "900.00" },
        { billing: semPreco, valor: null },
      ],
      { documentos: 2, comValor: 1, valor: null },
    );
  });

  it("F — legado: emitido sem total congelado vale a soma das linhas arredondadas, como o próprio documento mostra", async () => {
    const { dia, instante } = diaDoCenario(7);
    const { orderId } = await pedido(
      [
        { quantidade: "1", preco: null },
        { quantidade: "1", preco: null },
      ],
      null,
    );
    const emitido = await faturar(await expedir(orderId), "0.1250");
    // O estado de um faturamento emitido antes de BILL-DISCOUNT-01b: a migration
    // criou as colunas sem preencher o passado.
    await getPrisma().billing.update({
      where: { id: emitido.id },
      data: { grossAmount: null, discountAmount: null, commercialAdjustmentAmount: null, totalAmount: null, issuedAt: instante },
    });

    await conferirSuperficies(dia, [{ billing: emitido, valor: "0.26" }], { documentos: 1, comValor: 1, valor: "0.26" });
  });

  it("só EMITIDO é faturado: o rascunho do mesmo Pedido fica fora do total, e o R-14 fala o número do resumo do Pedido", async () => {
    const { orderId } = await pedido([{ quantidade: "2", preco: "100" }], {
      subtotal: "200.00",
      total: "180.00",
      descontoPercent: "10",
    });
    const emitido = await faturar(await expedir(orderId, "1"));
    const rascunho = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: await expedir(orderId, "1") } })
    ).json() as BillingDTO;
    expect(rascunho.status).toBe("DRAFT");

    // Sem filtro de status no recorte, o total continua só com o emitido.
    expect(await resumirValorFaturado(getPrisma(), { customerOrderId: orderId })).toEqual({
      billingCount: 1,
      billingsWithCompletePricing: 1,
      totalAmount: "90.00",
    });

    // Rascunho não tem total congelado: R-14 e resumo do Pedido mostram as suas linhas.
    const cadeia = await get(`/reports/commercial/order-operation?customerOrderId=${orderId}`);
    const pedidoLido = await get(`/customer-orders/${orderId}`);
    const noR14 = new Map(
      (cadeia.billings as { billingId: string; totalAmount: string | null }[]).map((b) => [b.billingId, b.totalAmount]),
    );
    const noPedido = new Map(
      (pedidoLido.billings as { id: string; totalAmount: string | null }[]).map((b) => [b.id, b.totalAmount]),
    );
    expect([noR14.get(emitido.id), noPedido.get(emitido.id)]).toEqual(["90.00", "90.00"]);
    expect([noR14.get(rascunho.id), noPedido.get(rascunho.id)]).toEqual(["100.00", "100.00"]);
  });
});
