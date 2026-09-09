import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * BILL-DISCOUNT-01b — o desconto do Pedido chega ao Faturamento, e os
 * faturamentos fecham exatamente com a condição acordada.
 *
 * Dois defeitos, uma reconciliação só: o desconto global nunca era
 * apropriado, e partir uma linha em vários documentos já perdia centavos por
 * arredondamento MESMO SEM DESCONTO (F-C). O documento que completa as
 * quantidades do Pedido absorve as duas diferenças, no cabeçalho — nunca no
 * preço das linhas.
 *
 * A matemática vive em `calcularApropriacaoComercialDoFaturamento` e é
 * testada em `packages/shared`. Aqui se prova o SERVIÇO: o que é congelado,
 * quando, contra qual conjunto ativo, e que nada disso toca o preço acordado.
 */

const fixtureCustomerOrderIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

let contador = 0;
const marca = () => `${Date.now().toString(36)}${(contador += 1)}`;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.billingLine.deleteMany({
      where: { billing: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.billing.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
    await prisma.customerOrderDeliveryLine.deleteMany({
      where: { delivery: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.customerOrderDelivery.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.productionOrder.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function itemAcabadoComEstoque(quantidade: string) {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-REC-${m}`,
      name: `PA Reconciliação ${m}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  fixtureItemIds.push(item.id);
  const lot = await prisma.lot.create({
    data: {
      code: `LT-REC-${m}`.toUpperCase(),
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

/**
 * Pedido em atendimento COM condição comercial congelada.
 *
 * O acordo normalmente chega pelo aceite de um orçamento; aqui ele é gravado
 * direto, que é exatamente o estado que o aceite produz. O que se testa é o
 * que o Faturamento faz com o acordo, não como ele nasce.
 */
async function pedidoAcordado(
  app: App,
  acordo: {
    quantidade: string;
    preco: string;
    subtotal: string;
    total: string;
    descontoPercent: string | null;
  },
) {
  const item = await itemAcabadoComEstoque(acordo.quantidade);

  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-REC-${m}`, legalName: `Cliente Reconciliação ${m}` },
  });
  fixtureCustomerIds.push(customer.id);

  // O produto é DESTE cliente: produto pertence a um cliente, e o Pedido de
  // outro é recusado com `customer_mismatch`.
  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: customer.id,
        name: `Produto Reconciliação ${marca()}`,
        finishedProductItemId: item.id,
      },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const criado = (
    await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: customer.id,
        lines: [{ productId: product.id, orderedQuantity: acordo.quantidade }],
      },
    })
  ).json();
  fixtureCustomerOrderIds.push(criado.id);

  const confirmado = (
    await app.inject({ method: "POST", url: `/customer-orders/${criado.id}/confirm` })
  ).json();
  const lineId = confirmado.lines[0].id as string;

  await prisma.customerOrderLine.update({
    where: { id: lineId },
    data: { agreedUnitPrice: acordo.preco, agreedPriceSource: "PRICING_TIER" },
  });
  await prisma.customerOrder.update({
    where: { id: criado.id },
    data: {
      agreedSubtotalAmount: acordo.subtotal,
      agreedTotalAmount: acordo.total,
      ...(acordo.descontoPercent !== null
        ? { agreedDiscountPercent: acordo.descontoPercent }
        : {}),
    },
  });

  await app.inject({
    method: "POST",
    url: `/customer-orders/${criado.id}/apply-fulfillment-plan`,
    payload: {
      lines: [
        { customerOrderLineId: lineId, reserveQuantity: acordo.quantidade, produceQuantity: "0" },
      ],
    },
  });

  return { orderId: criado.id as string, lineId };
}

/** Uma expedição confirmada de `quantidade`. */
async function expedir(app: App, orderId: string, quantidade: string) {
  const rascunho = (
    await app.inject({ method: "POST", url: `/customer-orders/${orderId}/shipments` })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/shipments/${rascunho.id}`,
    payload: {
      lines: [
        {
          customerOrderReservationLineId: rascunho.lines[0].customerOrderReservationLineId,
          quantity: quantidade,
        },
      ],
    },
  });
  const atual = (await app.inject({ method: "GET", url: `/shipments/${rascunho.id}` })).json();
  for (const linha of atual.lines) {
    if (!linha.requiresVerification) continue;
    await app.inject({
      method: "POST",
      url: `/shipments/${rascunho.id}/lines/${linha.id}/verify`,
      payload: { lotCode: linha.lotCode },
    });
  }
  return (await app.inject({ method: "POST", url: `/shipments/${rascunho.id}/confirm` })).json();
}

/** Expede `quantidade` e emite o faturamento correspondente. */
async function expedirEFaturar(app: App, orderId: string, quantidade: string) {
  const expedicao = await expedir(app, orderId, quantidade);
  const rascunho = (
    await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
  ).json();
  return (await app.inject({ method: "POST", url: `/billings/${rascunho.id}/issue` })).json();
}

const resumo = (b: {
  grossAmount: string | null;
  discountAmount: string | null;
  commercialAdjustmentAmount: string | null;
  totalAmount: string | null;
}) => ({
  bruto: b.grossAmount,
  desconto: b.discountAmount,
  ajuste: b.commercialAdjustmentAmount,
  total: b.totalAmount,
});

const somar = (valores: (string | null)[]) =>
  valores.reduce((s, v) => s + Number(v ?? 0), 0).toFixed(2);

describe("faturamento único com desconto global", () => {
  it("2 × R$ 100,00 com 10%: bruto 200,00, desconto 20,00, total 180,00", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "2",
      preco: "100",
      subtotal: "200.00",
      total: "180.00",
      descontoPercent: "10",
    });
    const faturamento = await expedirEFaturar(app, orderId, "2");

    expect(resumo(faturamento)).toEqual({
      bruto: "200.00",
      desconto: "20.00",
      ajuste: "0.00",
      total: "180.00",
    });
    // O acordo do Pedido continua sendo a referência, e a linha não mudou.
    expect(faturamento.discountPercentSnapshot).toBe("10.0000");
    expect(faturamento.lines[0].agreedUnitPrice).toBe("100.0000");
    expect(faturamento.lines[0].unitPrice).toBe("100.0000");
    expect(faturamento.lines[0].priceOverridden).toBe(false);
  });

  it("sem condição comercial congelada nada é apropriado — comportamento anterior intacto", async () => {
    const app = buildTestApp();
    await app.ready();

    const prisma = getPrisma();
    const { orderId } = await pedidoAcordado(app, {
      quantidade: "2",
      preco: "100",
      subtotal: "200.00",
      total: "200.00",
      descontoPercent: null,
    });
    // Pedido digitado direto: sem acordo congelado nenhum.
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: { agreedSubtotalAmount: null, agreedTotalAmount: null },
    });
    const faturamento = await expedirEFaturar(app, orderId, "2");

    expect(resumo(faturamento)).toEqual({
      bruto: "200.00",
      desconto: "0.00",
      ajuste: "0.00",
      total: "200.00",
    });
    // NULL é "não havia desconto" e sobrevive como NULL.
    expect(faturamento.discountPercentSnapshot).toBeNull();
  });

  it("desconto explicitamente zero congela 0, e não vira NULL", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "2",
      preco: "100",
      subtotal: "200.00",
      total: "200.00",
      descontoPercent: "0",
    });
    const faturamento = await expedirEFaturar(app, orderId, "2");

    expect(faturamento.discountPercentSnapshot).toBe("0.0000");
    expect(resumo(faturamento).desconto).toBe("0.00");
    expect(resumo(faturamento).total).toBe("200.00");
  });
});

describe("faturamento parcial: três expedições, três faturamentos", () => {
  it("3 × R$ 100,00 com 10% em 1+1+1 acumula exatamente R$ 270,00", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "3",
      preco: "100",
      subtotal: "300.00",
      total: "270.00",
      descontoPercent: "10",
    });

    const emitidos = [
      await expedirEFaturar(app, orderId, "1"),
      await expedirEFaturar(app, orderId, "1"),
      await expedirEFaturar(app, orderId, "1"),
    ];

    expect(emitidos.map(resumo)).toEqual([
      { bruto: "100.00", desconto: "10.00", ajuste: "0.00", total: "90.00" },
      { bruto: "100.00", desconto: "10.00", ajuste: "0.00", total: "90.00" },
      { bruto: "100.00", desconto: "10.00", ajuste: "0.00", total: "90.00" },
    ]);
    expect(somar(emitidos.map((b) => b.totalAmount))).toBe("270.00");
  });

  it("F-C: 3 × R$ 33,3333 SEM desconto — o fechamento soma o centavo que falta", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "3",
      preco: "33.3333",
      subtotal: "100.00",
      total: "100.00",
      descontoPercent: null,
    });

    const emitidos = [
      await expedirEFaturar(app, orderId, "1"),
      await expedirEFaturar(app, orderId, "1"),
      await expedirEFaturar(app, orderId, "1"),
    ];

    // Cada documento imprime 33,33; três somariam 99,99 contra os 100,00.
    expect(emitidos.map((b) => b.grossAmount)).toEqual(["33.33", "33.33", "33.33"]);
    expect(emitidos.map((b) => b.commercialAdjustmentAmount)).toEqual(["0.00", "0.00", "0.01"]);
    expect(emitidos.map((b) => b.totalAmount)).toEqual(["33.33", "33.33", "33.34"]);
    expect(somar(emitidos.map((b) => b.totalAmount))).toBe("100.00");
    // O ajuste é do cabeçalho: nenhum preço de linha foi tocado.
    expect(emitidos.every((b) => b.lines[0].agreedUnitPrice === "33.3333")).toBe(true);
    expect(emitidos.every((b) => b.lines[0].unitPrice === "33.3333")).toBe(true);
  });

  it("desconto E fragmentação juntos fecham em R$ 90,00, com as duas parcelas separadas", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "3",
      preco: "33.3333",
      subtotal: "100.00",
      total: "90.00",
      descontoPercent: "10",
    });

    const emitidos = [
      await expedirEFaturar(app, orderId, "1"),
      await expedirEFaturar(app, orderId, "1"),
      await expedirEFaturar(app, orderId, "1"),
    ];

    expect(emitidos.map((b) => b.discountAmount)).toEqual(["3.33", "3.34", "3.33"]);
    // Só o documento de fechamento carrega o ajuste, e ele não vira desconto.
    expect(emitidos.map((b) => b.commercialAdjustmentAmount)).toEqual(["0.00", "0.00", "0.01"]);
    expect(emitidos.map((b) => b.totalAmount)).toEqual(["30.00", "29.99", "30.01"]);
    expect(somar(emitidos.map((b) => b.totalAmount))).toBe("90.00");
  });
});

describe("o que é congelado, e quando", () => {
  it("rascunho mostra prévia e não grava; emitir congela", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "2",
      preco: "100",
      subtotal: "200.00",
      total: "180.00",
      descontoPercent: "10",
    });
    const expedicao = await expedir(app, orderId, "2");
    const rascunho = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    // A prévia já responde o que aconteceria na emissão…
    expect(resumo(rascunho)).toEqual({
      bruto: "200.00",
      desconto: "20.00",
      ajuste: "0.00",
      total: "180.00",
    });
    // …mas nada foi gravado: o rascunho não apropriou coisa nenhuma.
    const gravado = await getPrisma().billing.findUnique({ where: { id: rascunho.id } });
    expect(gravado?.totalAmount).toBeNull();
    expect(gravado?.discountAmount).toBeNull();
    // O percentual, sim, é proveniência e nasce com o documento.
    expect(gravado?.discountPercentSnapshot?.toFixed(4)).toBe("10.0000");

    const emitido = (
      await app.inject({ method: "POST", url: `/billings/${rascunho.id}/issue` })
    ).json();
    const congelado = await getPrisma().billing.findUnique({ where: { id: rascunho.id } });
    expect(congelado?.totalAmount?.toFixed(2)).toBe("180.00");
    expect(emitido.totalAmount).toBe("180.00");
  });

  it("rascunho cancelado não participa: o documento seguinte fecha o Pedido sozinho", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "2",
      preco: "100",
      subtotal: "200.00",
      total: "180.00",
      descontoPercent: "10",
    });
    const expedicao = await expedir(app, orderId, "2");

    const descartado = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();
    await app.inject({
      method: "POST",
      url: `/billings/${descartado.id}/cancel`,
      payload: { reason: "Refazer o documento" },
    });

    const novo = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();
    const emitido = (
      await app.inject({ method: "POST", url: `/billings/${novo.id}/issue` })
    ).json();

    expect(resumo(emitido)).toEqual({
      bruto: "200.00",
      desconto: "20.00",
      ajuste: "0.00",
      total: "180.00",
    });
  });

  it("emitido não é recalculado quando o Pedido ganha outro faturamento depois", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "2",
      preco: "33.3333",
      subtotal: "66.67",
      total: "60.00",
      descontoPercent: "10",
    });

    const primeiro = await expedirEFaturar(app, orderId, "1");
    const congeladoAntes = resumo(primeiro);

    await expedirEFaturar(app, orderId, "1");

    const relido = (
      await app.inject({ method: "GET", url: `/billings/${primeiro.id}` })
    ).json();
    expect(resumo(relido)).toEqual(congeladoAntes);
  });
});

describe("o resumo do Pedido fala o mesmo número do documento", () => {
  it("o Pedido mostra o total do faturamento com desconto, não a soma bruta das linhas", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "2",
      preco: "100",
      subtotal: "200.00",
      total: "180.00",
      descontoPercent: "10",
    });
    const faturamento = await expedirEFaturar(app, orderId, "2");

    const pedido = (await app.inject({ method: "GET", url: `/customer-orders/${orderId}` })).json();
    const resumoDoPedido = pedido.billings.find(
      (b: { id: string }) => b.id === faturamento.id,
    ) as { totalAmount: string };
    expect(resumoDoPedido.totalAmount).toBe("180.00");
  });
});

describe("override de preço continua sendo exceção comercial, não erro a corrigir", () => {
  it("faturar acima do acordado move o total final, e o ajuste não engole a decisão", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId } = await pedidoAcordado(app, {
      quantidade: "2",
      preco: "100",
      subtotal: "200.00",
      total: "180.00",
      descontoPercent: "10",
    });
    const expedicao = await expedir(app, orderId, "2");
    const rascunho = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();

    await app.inject({
      method: "POST",
      url: `/billings/${rascunho.id}/lines/${rascunho.lines[0].id}/price-override`,
      payload: { unitPrice: "105", reason: "Reajuste acordado por telefone" },
    });
    const emitido = (
      await app.inject({ method: "POST", url: `/billings/${rascunho.id}/issue` })
    ).json();

    // Bruto 210,00; desconto acordado 20,00; total 190,00 — R$ 10,00 acima do
    // acordado, que é exatamente o tamanho da exceção. O acordado sobrevive
    // ao lado, com motivo e autor: é ele a evidência.
    expect(resumo(emitido)).toEqual({
      bruto: "210.00",
      desconto: "20.00",
      ajuste: "0.00",
      total: "190.00",
    });
    expect(emitido.lines[0].agreedUnitPrice).toBe("100.0000");
    expect(emitido.lines[0].unitPrice).toBe("105.0000");
    expect(emitido.lines[0].priceOverridden).toBe(true);
  });
});


/**
 * COM-04 — o cronograma de entregas entra sem tocar na matemática comercial.
 *
 * A regressão que importa: entregas programadas são uma PROMESSA, e a
 * reconciliação continua sendo entre Expedições confirmadas e o acordo do
 * Pedido. Um Pedido com desconto, duas entregas programadas, duas Expedições e
 * dois Faturamentos precisa fechar exatamente em `agreedTotalAmount` — o mesmo
 * invariante de BILL-DISCOUNT-01b, agora com o cronograma no meio.
 */
describe("entregas programadas não criam matemática comercial paralela", () => {
  it("1.000 × R$ 10,00 com 10%, em duas entregas, fecha em R$ 9.000,00", async () => {
    const app = buildTestApp();
    await app.ready();

    const { orderId, lineId } = await pedidoAcordado(app, {
      quantidade: "1000",
      preco: "10",
      subtotal: "10000.00",
      total: "9000.00",
      descontoPercent: "10",
    });

    const primeira = await app.inject({
      method: "POST",
      url: `/customer-orders/${orderId}/deliveries`,
      payload: {
        scheduledDate: "2026-10-15",
        lines: [{ customerOrderLineId: lineId, quantity: "400" }],
      },
    });
    expect(primeira.statusCode).toBe(201);

    const segunda = await app.inject({
      method: "POST",
      url: `/customer-orders/${orderId}/deliveries`,
      payload: {
        scheduledDate: "2026-11-15",
        lines: [{ customerOrderLineId: lineId, quantity: "600" }],
      },
    });
    expect(segunda.statusCode).toBe(201);

    // Programar não fatura: nenhum documento nasceu das promessas.
    const antes = await app.inject({ method: "GET", url: `/billings?customerOrderId=${orderId}` });
    expect(antes.json().billings ?? []).toHaveLength(0);

    const um = await expedirEFaturar(app, orderId, "400");
    const dois = await expedirEFaturar(app, orderId, "600");

    // O documento que FECHA as quantidades absorve o saldo — a regra de
    // BILL-DISCOUNT-01b, intocada.
    expect(somar([um.totalAmount, dois.totalAmount])).toBe("9000.00");
    expect(somar([um.grossAmount, dois.grossAmount])).toBe("10000.00");
    expect(somar([um.discountAmount, dois.discountAmount])).toBe("1000.00");

    // E o preço acordado da linha nunca virou preço líquido.
    expect(um.lines[0].agreedUnitPrice).toBe("10.0000");
    expect(dois.lines[0].agreedUnitPrice).toBe("10.0000");

    // As duas promessas ficaram atendidas, cada uma pela sua Expedição.
    const cronograma = (
      await app.inject({ method: "GET", url: `/customer-orders/${orderId}/deliveries` })
    ).json();
    expect(cronograma.deliveries.map((d: { status: string }) => d.status)).toEqual([
      "FULFILLED",
      "FULFILLED",
    ]);
    expect(cronograma.schedulable[0].schedulableQuantity).toBe("0");
    for (const delivery of cronograma.deliveries) {
      expect(delivery.shipments).toHaveLength(1);
    }
  });
});
