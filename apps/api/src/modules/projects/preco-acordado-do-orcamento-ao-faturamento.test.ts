import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * O preço aceito atravessa a cadeia inteira — e o presente não o reescreve.
 *
 * A cadeia `QuoteLine.unitPrice → CustomerOrderLine.agreedUnitPrice →
 * BillingLine.agreedUnitPrice → BillingLine.unitPrice` já estava provada em
 * pedaços: um teste garantia que o Pedido congela a proposta, outro que o
 * Faturamento herda o Pedido, e o segundo partia de uma fixture que gravava
 * `agreedUnitPrice` direto na linha. Ninguém percorria o caminho inteiro a
 * partir do orçamento, então "o preço do cliente chega ao faturamento" era
 * conclusão por composição, não observação.
 *
 * Aqui a cadeia é percorrida de ponta a ponta pela API, e a pergunta que
 * fecha COM-03 é feita na direção perigosa: uma precificação NOVA, ativada
 * DEPOIS de o Pedido e o Faturamento existirem, muda o que já foi acordado?
 * Não muda — e é isto que este arquivo passa a impedir de regredir.
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureResourceIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

/** O preço que o cliente aceitou. Quatro casas, como a coluna guarda. */
const PRECO_ACORDADO = "9.4800";
/** A precificação de DEPOIS — deliberadamente diferente, e maior. */
const PRECO_DA_PRECIFICACAO_NOVA = "31.0000";
const QUANTIDADE = "100";
const VALIDADE_FUTURA = "2099-12-31";

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProjectIds.length > 0) {
    const pedidos = await prisma.customerOrder.findMany({
      where: { sourceProjectId: { in: fixtureProjectIds } },
      select: { id: true },
    });
    const pedidoIds = pedidos.map((p) => p.id);
    if (pedidoIds.length > 0) {
      await prisma.billingLine.deleteMany({
        where: { billing: { customerOrderId: { in: pedidoIds } } },
      });
      await prisma.billing.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
      await prisma.shipmentLine.deleteMany({
        where: { shipment: { customerOrderId: { in: pedidoIds } } },
      });
      await prisma.shipment.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
      await prisma.customerOrderReservationLine.deleteMany({
        where: { reservation: { customerOrderId: { in: pedidoIds } } },
      });
      await prisma.customerOrderReservation.deleteMany({
        where: { customerOrderId: { in: pedidoIds } },
      });
      await prisma.productionOrder.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
      await prisma.customerOrderLine.deleteMany({
        where: { customerOrderId: { in: pedidoIds } },
      });
      await prisma.customerOrder.deleteMany({ where: { id: { in: pedidoIds } } });
    }
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
    await prisma.pricingTier.deleteMany({
      where: { pricingVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.pricingVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    // A estrutura de custos aponta para a versão de formulação: ela sai antes,
    // e leva junto linhas, usos de recurso e cálculos por cascade.
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    const produtos = await prisma.product.findMany({
      where: { id: { in: fixtureProductIds } },
      select: { finishedProductItemId: true },
    });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
    const acabados = produtos
      .map((p) => p.finishedProductItemId)
      .filter((id): id is string => id !== null);
    fixtureItemIds.push(...acabados);
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: fixtureResourceIds } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** Estoque de produto acabado pronto para reservar e expedir. */
async function estoqueDoAcabado(itemId: string, quantidade: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-COM-${marca()}`,
      itemId,
      origin: "PRODUCTION",
      initialReceivedQuantity: quantidade,
      status: "AVAILABLE",
      createdBy: "Teste",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity: quantidade,
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "Teste",
    },
  });
  return lot;
}

/**
 * Do projeto ao Faturamento, tudo pela API — o caminho que a operação faz.
 *
 * Orçamento com preço → enviado → aceito → projeto aprovado → Pedido →
 * reserva → expedição conferida → faturamento.
 */
async function cadeiaComercialCompleta(app: App) {
  const prisma = getPrisma();
  const m = marca();

  const customer = await prisma.customer.create({
    data: { code: `CLI-CAD-${m}`, legalName: `Cliente Cadeia ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);

  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: `Projeto Cadeia ${m}`,
        customerId: customer.id,
        entryDate: new Date().toISOString(),
      },
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
  const productId = preparado.productId as string;
  fixtureProductIds.push(productId);

  const projectProducts = (
    await app.inject({ method: "GET", url: `/projects/${project.id}/products` })
  ).json().products as { id: string }[];

  const quote = (
    await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
  ).json();
  const comLinha = (
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: projectProducts[0]!.id },
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/quote-lines/${comLinha.lines[0].id}`,
    payload: { quotedQuantity: QUANTIDADE, uomCode: "un", unitPrice: PRECO_ACORDADO },
  });
  await app.inject({
    method: "PATCH",
    url: `/quote-versions/${quote.id}`,
    payload: { validUntil: VALIDADE_FUTURA },
  });

  const enviado = await app.inject({
    method: "POST",
    url: `/quote-versions/${quote.id}/send`,
    payload: { confirmIncompleteCost: true },
  });
  expect(enviado.statusCode, enviado.body).toBe(200);
  const aceito = await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });
  expect(aceito.statusCode, aceito.body).toBe(200);

  const aprovado = await app.inject({
    method: "POST",
    url: `/projects/${project.id}/approve`,
    payload: {},
  });
  expect(aprovado.statusCode, aprovado.body).toBe(200);

  const pedidoResp = await app.inject({
    method: "POST",
    url: `/quote-versions/${quote.id}/create-order`,
  });
  expect(pedidoResp.statusCode, pedidoResp.body).toBe(201);
  const criado = pedidoResp.json();

  // O Pedido nasce rascunho, como qualquer outro: confirmar é ato do operador.
  const confirmado = await app.inject({
    method: "POST",
    url: `/customer-orders/${criado.id}/confirm`,
  });
  expect(confirmado.statusCode, confirmado.body).toBe(200);
  const order = confirmado.json();

  const produto = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { finishedProductItemId: true },
  });
  await estoqueDoAcabado(produto.finishedProductItemId!, QUANTIDADE);

  const reservado = await app.inject({
    method: "POST",
    url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
    payload: {
      lines: [
        {
          customerOrderLineId: order.lines[0].id,
          reserveQuantity: QUANTIDADE,
          produceQuantity: "0",
        },
      ],
    },
  });
  expect(reservado.statusCode, reservado.body).toBe(200);

  const rascunhoExpedicao = (
    await app.inject({ method: "POST", url: `/customer-orders/${order.id}/shipments` })
  ).json();
  const expedicaoAtual = (
    await app.inject({ method: "GET", url: `/shipments/${rascunhoExpedicao.id}` })
  ).json();
  for (const linha of expedicaoAtual.lines) {
    if (!linha.requiresVerification) continue;
    await app.inject({
      method: "POST",
      url: `/shipments/${rascunhoExpedicao.id}/lines/${linha.id}/verify`,
      payload: { lotCode: linha.lotCode },
    });
  }
  const expedicao = (
    await app.inject({ method: "POST", url: `/shipments/${rascunhoExpedicao.id}/confirm` })
  ).json();

  const faturamento = (
    await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
  ).json();

  return { project, productId, quote, order, expedicao, faturamento };
}

/**
 * Uma precificação ATIVA para o produto, com preço próprio.
 *
 * É a cadeia industrial inteira — formulação, estrutura de custos, cálculo,
 * faixa — porque é assim que uma precificação nasce de verdade. O preço da
 * faixa é manual e alto de propósito: se ele vazasse para o documento já
 * acordado, a diferença seria impossível de confundir com arredondamento.
 */
async function precificacaoNova(app: App, productId: string) {
  const prisma = getPrisma();
  const m = marca();

  const material = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-CAD-${m}`,
      name: `Material Cadeia ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(material.id);

  const formulacao = (
    await app.inject({ method: "GET", url: `/products/${productId}/formulations` })
  ).json();
  const rascunho = formulacao.versions.find((v: { status: string }) => v.status === "DRAFT");
  if (rascunho) {
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${rascunho.id}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${rascunho.id}/activate` });
  }

  const estrutura = (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/industrial-costs`,
      payload: { referenceOutputQuantity: "1000" },
    })
  ).json();
  const energia = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Energia Cadeia ${m}`, type: "ENERGY" },
    })
  ).json();
  fixtureResourceIds.push(energia.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${energia.id}/rates`,
    payload: { rateValue: "1" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${estrutura.id}/energy-mode`,
    payload: { energyCalculationMode: "DIRECT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${estrutura.id}/resource-usages`,
    payload: { resourceId: energia.id, usageQuantity: "0.001", usageBasis: "PER_OUTPUT_UNIT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${estrutura.id}/activate`,
    payload: { confirmIncomplete: true },
  });
  const calculo = (
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${estrutura.id}/calculations`,
      payload: {},
    })
  ).json();

  const pricing = (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/pricing`,
      payload: { industrialCostCalculationId: calculo.id },
    })
  ).json();
  await app.inject({
    method: "POST",
    url: `/pricing-versions/${pricing.id}/tiers`,
    payload: {
      quantity: QUANTIDADE,
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: PRECO_DA_PRECIFICACAO_NOVA,
      commissionPercent: "5",
    },
  });
  const ativada = await app.inject({
    method: "POST",
    url: `/pricing-versions/${pricing.id}/activate`,
    payload: { confirmIncompleteCost: true },
  });
  expect(ativada.statusCode, ativada.body).toBe(200);
  return ativada.json();
}

describe("COM-03 — o preço acordado atravessa a cadeia e não é reescrito", () => {
  it("O · o preço da proposta chega ao Pedido e ao Faturamento sem ninguém redigitar", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { quote, order, faturamento } = await cadeiaComercialCompleta(app);

    // Proposta: o que o cliente aceitou.
    const proposta = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(proposta.lines[0].unitPrice).toBe(PRECO_ACORDADO);

    // Pedido: o acordo congelado, com a origem comercial apontando à proposta.
    expect(order.lines[0].agreedPrice.unitPrice).toBe(PRECO_ACORDADO);
    expect(order.commercialOrigin.quoteVersionId).toBe(quote.id);

    // Faturamento: o mesmo número, sem campo vazio para redigitar.
    const linha = faturamento.lines[0];
    expect(linha.agreedUnitPrice).toBe(PRECO_ACORDADO);
    expect(linha.unitPrice).toBe(PRECO_ACORDADO);
    expect(linha.priceOverridden).toBe(false);
    expect(linha.quantity).toBe(QUANTIDADE);
    expect(faturamento.totalAmount).toBe("948.00");

    await app.close();
  });

  it("P · precificação nova ativada DEPOIS do Pedido não muda o que foi acordado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { productId, order } = await cadeiaComercialCompleta(app);

    await precificacaoNova(app, productId);

    const relido = (
      await app.inject({ method: "GET", url: `/customer-orders/${order.id}` })
    ).json();
    expect(relido.lines[0].agreedPrice.unitPrice).toBe(PRECO_ACORDADO);
    expect(relido.lines[0].agreedPrice.unitPrice).not.toBe(PRECO_DA_PRECIFICACAO_NOVA);

    await app.close();
  });

  it("Q · precificação nova ativada DEPOIS do Faturamento não muda a fatura", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { productId, faturamento } = await cadeiaComercialCompleta(app);
    expect(faturamento.lines[0].unitPrice).toBe(PRECO_ACORDADO);

    await precificacaoNova(app, productId);

    const relido = (
      await app.inject({ method: "GET", url: `/billings/${faturamento.id}` })
    ).json();
    expect(relido.lines[0].agreedUnitPrice).toBe(PRECO_ACORDADO);
    expect(relido.lines[0].unitPrice).toBe(PRECO_ACORDADO);
    expect(relido.lines[0].priceOverridden).toBe(false);
    expect(relido.totalAmount).toBe("948.00");
    // O preço da precificação nova não aparece em lugar nenhum do documento.
    expect(JSON.stringify(relido)).not.toContain(PRECO_DA_PRECIFICACAO_NOVA);

    await app.close();
  });

  it("R · alterar o preço faturado é ato explícito, e o acordado permanece", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { faturamento } = await cadeiaComercialCompleta(app);

    const alterado = await app.inject({
      method: "POST",
      url: `/billings/${faturamento.id}/lines/${faturamento.lines[0].id}/price-override`,
      payload: { unitPrice: "10.0000", reason: "Acordo comercial pontual" },
    });
    expect(alterado.statusCode, alterado.body).toBe(200);

    const linha = alterado.json().lines[0];
    // Os dois números convivem: o que foi acordado e o que foi faturado.
    expect(linha.agreedUnitPrice).toBe(PRECO_ACORDADO);
    expect(linha.unitPrice).toBe("10.0000");
    expect(linha.priceOverridden).toBe(true);

    await app.close();
  });
});
