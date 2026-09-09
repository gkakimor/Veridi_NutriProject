import type { UomDimension } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Preço herdado, custo de hoje — COM-PRICE, §74.
 *
 * O preço de uma recompra pode ser o acordo do ciclo anterior. O CUSTO não
 * pode: entre janeiro e março a matéria-prima mudou de preço, e a proposta
 * nova precisa congelar a economia que ela realmente enfrenta. Congelar o CMV
 * antigo junto com o preço faria o documento novo descrever o custo de um
 * documento velho, e a diferença entre os dois é exatamente o que o CMV-VAR
 * vai querer medir.
 *
 * O comportamento anterior nem chegava lá: `buildLineSnapshots` saía cedo em
 * toda linha sem faixa vinculada e congelava só código e nome do produto.
 * Preço herdado (que é tecnicamente MANUAL) ia ao cliente sem base econômica
 * nenhuma — nem a antiga, nem a atual.
 *
 * A referência corrente é a faixa da precificação ATIVA cuja quantidade
 * física é a mesma da linha (§68). Uma fonte de CMV só, a mesma do resto do
 * sistema — não um segundo motor.
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureResourceIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

const VALIDADE_FUTURA = "2099-12-31";

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProjectIds.length > 0) {
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrder: { sourceProjectId: { in: fixtureProjectIds } } },
    });
    await prisma.customerOrder.deleteMany({ where: { sourceProjectId: { in: fixtureProjectIds } } });
    await prisma.quoteLine.updateMany({
      where: { quoteVersion: { projectId: { in: fixtureProjectIds } } },
      data: { inheritedFromQuoteLineId: null },
    });
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
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function receberComCusto(
  app: App,
  params: { itemId: string; quantity: string; unitCost: string },
) {
  const prisma = getPrisma();
  const m = marca();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-PRC-${m}`, legalName: `Fornecedor Preço ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);

  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: supplier.id,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });
  await app.inject({
    method: "POST",
    url: `/purchase-orders/${po.id}/receipts`,
    payload: {
      receivedAt: new Date().toISOString(),
      lines: [
        {
          purchaseOrderLineId: po.lines[0].id,
          receivedQuantity: params.quantity,
          supplierLot: `SUP-${m}`,
          actualUnitCost: params.unitCost,
        },
      ],
    },
  });
}

/** Projeto com produto técnico, formulação ativa e estrutura de custo ativa. */
async function projetoComCadeiaEconomica(app: App) {
  const prisma = getPrisma();
  const m = marca();
  const customer = await prisma.customer.create({
    data: { code: `CLI-ECO-${m}`, legalName: `Cliente Economia ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);

  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: `Projeto Economia ${m}`,
        customerId: customer.id,
        entryDate: new Date().toISOString(),
      },
    })
  ).json();
  fixtureProjectIds.push(project.id);

  const productId = (
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/technical-product`,
      payload: { finishedUnitCode: "un" },
    })
  ).json().productId as string;
  fixtureProductIds.push(productId);

  const material = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-ECO-${m}`,
      name: `Insumo economia ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(material.id);
  await receberComCusto(app, { itemId: material.id, quantity: "1000", unitCost: "10" });

  const formulation = (
    await app.inject({ method: "GET", url: `/products/${productId}/formulations` })
  ).json();
  const draftId = formulation.versions[0].id as string;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${draftId}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${draftId}/activate` });

  const costVersion = (
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
      payload: { name: `Energia ${m}`, type: "ENERGY" },
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
    url: `/industrial-costs/${costVersion.id}/energy-mode`,
    payload: { energyCalculationMode: "DIRECT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${costVersion.id}/resource-usages`,
    payload: { resourceId: energia.id, usageQuantity: "0.001", usageBasis: "PER_OUTPUT_UNIT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${costVersion.id}/activate`,
    payload: { confirmIncomplete: true },
  });

  return { projectId: project.id as string, productId, material, costVersionId: costVersion.id as string };
}

/** Uma precificação ATIVA nova, com o custo corrente e a faixa pedida. */
async function precificarAgora(
  app: App,
  cadeia: { productId: string; costVersionId: string },
  { quantidade = "1000", preco = "12.50" }: { quantidade?: string; preco?: string } = {},
) {
  const calculation = (
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${cadeia.costVersionId}/calculations`,
      payload: {},
    })
  ).json();

  const pricing = (
    await app.inject({
      method: "POST",
      url: `/products/${cadeia.productId}/pricing`,
      payload: { industrialCostCalculationId: calculation.id },
    })
  ).json();
  await app.inject({
    method: "POST",
    url: `/pricing-versions/${pricing.id}/tiers`,
    payload: {
      quantity: quantidade,
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: preco,
      commissionPercent: "5",
    },
  });
  const ativa = (
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/activate`,
      payload: { confirmIncompleteCost: true },
    })
  ).json();
  return ativa as { id: string; tiers: { id: string; quantity: string }[] };
}

async function abrirOrcamento(app: App, projectId: string) {
  const quote = (
    await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })
  ).json();
  if (quote.lines.length > 0) return quote;

  const produtos = (
    await app.inject({ method: "GET", url: `/projects/${projectId}/products` })
  ).json().products as { id: string; status: string }[];
  const alvo = produtos.find((produto) => produto.status !== "OUT_OF_SCOPE") ?? produtos[0]!;
  return (
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/lines`,
      payload: { projectProductId: alvo.id },
    })
  ).json();
}

async function enviarEAceitar(app: App, quoteId: string) {
  await app.inject({
    method: "PATCH",
    url: `/quote-versions/${quoteId}`,
    payload: { validUntil: VALIDADE_FUTURA },
  });
  const enviado = await app.inject({
    method: "POST",
    url: `/quote-versions/${quoteId}/send`,
    payload: { confirmIncompleteCost: true },
  });
  expect(enviado.statusCode, enviado.body).toBe(200);
  const aceito = await app.inject({ method: "POST", url: `/quote-versions/${quoteId}/accept` });
  expect(aceito.statusCode, aceito.body).toBe(200);
}

async function lerLinha(app: App, quoteId: string) {
  const quote = (await app.inject({ method: "GET", url: `/quote-versions/${quoteId}` })).json();
  return quote.lines[0] as {
    id: string;
    unitPrice: string | null;
    priceSource: string;
    priceOrigin: string | null;
    inheritedFromQuoteLineId: string | null;
    pricing: { industrialCostPerUnit: string | null; pricingCode: string | null; frozen: boolean } | null;
  };
}

describe("K · usar a precificação atual reusa o motor que já existe", () => {
  it("a faixa ativa forma o preço e a origem passa a ser a precificação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const cadeia = await projetoComCadeiaEconomica(app);
    const precificacao = await precificarAgora(app, cadeia, { quantidade: "1000", preco: "20.00" });

    const quote = await abrirOrcamento(app, cadeia.projectId);
    const lineId = quote.lines[0].id as string;

    const aplicado = await app.inject({
      method: "POST",
      url: `/quote-lines/${lineId}/apply-pricing`,
      payload: { pricingTierId: precificacao.tiers[0]!.id },
    });
    expect(aplicado.statusCode, aplicado.body).toBe(200);

    const linha = await lerLinha(app, quote.id);
    expect(linha.unitPrice).toBe("20.0000");
    // Duas perguntas, duas respostas: `priceSource` diz que tecnicamente veio
    // de faixa; `priceOrigin` diz qual decisão comercial formou o preço.
    expect(linha.priceSource).toBe("PRICING_TIER");
    expect(linha.priceOrigin).toBe("CURRENT_PRICING");
    expect(linha.inheritedFromQuoteLineId).toBeNull();
    expect(linha.pricing?.industrialCostPerUnit).not.toBeNull();

    await app.close();
  });
});

/**
 * §38 — o cenário que prepara o CMV-VAR.
 *
 * Preço vem do acordo anterior; custo vem de hoje. Se os dois viessem do mesmo
 * lugar, a variação entre ciclos ficaria invisível justamente no documento em
 * que ela importa.
 */
describe("Preço herdado congela o CMV CORRENTE, não o CMV do acordo", () => {
  it("V2 mantém R$ 12,50 e congela o custo de hoje", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    // V1: precificação com o custo do material a R$ 10/kg.
    const cadeia = await projetoComCadeiaEconomica(app);
    const precoV1 = await precificarAgora(app, cadeia, { quantidade: "1000", preco: "12.50" });

    const v1 = await abrirOrcamento(app, cadeia.projectId);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${v1.lines[0].id}/apply-pricing`,
      payload: { pricingTierId: precoV1.tiers[0]!.id },
    });
    await enviarEAceitar(app, v1.id);
    expect(
      (
        await app.inject({ method: "POST", url: `/projects/${cadeia.projectId}/approve`, payload: {} })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "POST", url: `/quote-versions/${v1.id}/create-order` })).statusCode,
    ).toBe(201);

    const linhaV1 = await lerLinha(app, v1.id);
    const cmvDoAcordo = linhaV1.pricing?.industrialCostPerUnit ?? null;
    expect(cmvDoAcordo).not.toBeNull();
    expect(linhaV1.unitPrice).toBe("12.5000");

    // O insumo encarece, e uma precificação NOVA é ativada com o custo de hoje.
    await receberComCusto(app, { itemId: cadeia.material.id, quantity: "1000", unitCost: "40" });
    await precificarAgora(app, cadeia, { quantidade: "1000", preco: "30.00" });

    // V2 herda a CONDIÇÃO — o preço acordado, não o preço novo da faixa.
    const v2 = await abrirOrcamento(app, cadeia.projectId);
    const linhaAntesDoEnvio = await lerLinha(app, v2.id);
    expect(linhaAntesDoEnvio.unitPrice).toBe("12.5000");
    expect(linhaAntesDoEnvio.priceOrigin).toBe("INHERITED_AGREEMENT");
    expect(linhaAntesDoEnvio.inheritedFromQuoteLineId).toBe(v1.lines[0].id);

    await enviarEAceitar(app, v2.id);

    const linhaV2 = await lerLinha(app, v2.id);
    // O preço é o do acordo.
    expect(linhaV2.unitPrice).toBe("12.5000");
    expect(linhaV2.priceOrigin).toBe("INHERITED_AGREEMENT");
    // A economia é a de hoje: o snapshot existe, e é DIFERENTE do CMV que
    // acompanhou o acordo. Antes desta capability ele seria `null`.
    expect(linhaV2.pricing?.industrialCostPerUnit).not.toBeNull();
    expect(linhaV2.pricing?.industrialCostPerUnit).not.toBe(cmvDoAcordo);
    expect(linhaV2.pricing?.frozen).toBe(true);

    await app.close();
  });

  it("sem precificação ativa para a quantidade, o envio continua acontecendo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const cadeia = await projetoComCadeiaEconomica(app);
    // Faixa de 1000; a proposta vai a 777 — nenhuma faixa representa isso.
    await precificarAgora(app, cadeia, { quantidade: "1000", preco: "12.50" });

    const quote = await abrirOrcamento(app, cadeia.projectId);
    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${quote.lines[0].id}`,
      payload: { quotedQuantity: "777", uomCode: "un", unitPrice: "19.90" },
    });

    await enviarEAceitar(app, quote.id);

    const linha = await lerLinha(app, quote.id);
    expect(linha.unitPrice).toBe("19.9000");
    expect(linha.priceOrigin).toBe("MANUAL");
    // Sem faixa equivalente não há custo corrente a congelar — e a ausência
    // não pode virar um bloqueio de envio que hoje não existe.
    expect(linha.pricing).toBeNull();

    await app.close();
  });
});
