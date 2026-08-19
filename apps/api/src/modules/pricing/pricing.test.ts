import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Capacidade 46 — simulador de preço, margem e faixas de quantidade.
 *
 * O que estes testes protegem: proveniência (preço nasce de um CALC salvo),
 * base econômica congelada e comum a todas as faixas, economia consciente de
 * lote (custo fixo não se dilui abaixo de um lote), vocabulário de
 * contribuição (nunca lucro), custo parcial que não vira margem falsa e
 * imutabilidade da versão ativa.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();

  if (fixtureProductIds.length > 0) {
    await prisma.pricingTier.deleteMany({
      where: { pricingVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.pricingVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.industrialCostCalculation.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }

  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: fixtureResourceIds } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureReceiptIds.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-PRC-${m}`,
      name: `Item Preço ${m}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-PRC-${m}`, legalName: `Fornecedor Preço ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function receiveWithCost(
  app: App,
  params: { supplierId: string; itemId: string; quantity: string; unitCost: string },
) {
  const po = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: params.supplierId,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  fixturePurchaseOrderIds.push(po.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });

  const receipt = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: po.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${marker()}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  fixtureReceiptIds.push(receipt.id);
  return receipt;
}

async function createResource(
  app: App,
  type: "LABOR" | "EQUIPMENT" | "ENERGY",
  rate: string,
  payload: Record<string, unknown> = {},
) {
  const resource = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Recurso ${type} ${marker()}`, type, ...payload },
    })
  ).json();
  fixtureResourceIds.push(resource.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${resource.id}/rates`,
    payload: { rateValue: rate },
  });
  return resource;
}

interface ScenarioOptions {
  /** Custo unitário do material; ausente deixa o custo incompleto. */
  materialUnitCost?: string;
  materialQuantityPerUnit?: string;
  referenceOutputQuantity?: string;
  unitsPerShippingBox?: number;
  minimumBatchQuantity?: string;
  fixedPerBatch?: string;
  perOutputUnit?: string;
  per1000?: string;
  laborHoursPerBatch?: string;
  laborRate?: string;
}

/** Produto + formulação + EC ativa + cálculo salvo (CALC). */
async function createScenario(app: App, options: ScenarioOptions = {}) {
  const supplier = await createSupplier();
  const material = await createItem("RAW_MATERIAL");
  const finishedItem = await createItem("FINISHED_PRODUCT", "un");

  if (options.materialUnitCost) {
    await receiveWithCost(app, {
      supplierId: supplier.id,
      itemId: material.id,
      quantity: "1000",
      unitCost: options.materialUnitCost,
    });
  }

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto Preço ${marker()}`,
        finishedProductItemId: finishedItem.id,
        ...(options.unitsPerShippingBox
          ? { unitsPerShippingBox: options.unitsPerShippingBox }
          : {}),
        ...(options.minimumBatchQuantity
          ? { minimumBatchQuantity: options.minimumBatchQuantity }
          : {}),
      },
    })
  ).json();
  fixtureProductIds.push(product.id);

  const formulation = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${formulation.id}`,
    payload: {
      basisQuantity: "1",
      components: [
        {
          itemId: material.id,
          quantity: options.materialQuantityPerUnit ?? "0.01",
          unitCode: "kg",
        },
      ],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${formulation.id}/activate` });

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/industrial-costs`,
      payload: { referenceOutputQuantity: options.referenceOutputQuantity ?? "1000" },
    })
  ).json();

  // Energia informada diretamente com consumo por unidade: o caminho mais
  // simples de fechar o custo sem interferir nos testes de escala.
  const energy = await createResource(app, "ENERGY", "1");
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/energy-mode`,
    payload: { energyCalculationMode: "DIRECT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/resource-usages`,
    payload: { resourceId: energy.id, usageQuantity: "0.001", usageBasis: "PER_OUTPUT_UNIT" },
  });

  if (options.laborHoursPerBatch) {
    const labor = await createResource(app, "LABOR", options.laborRate ?? "30");
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/resource-usages`,
      payload: {
        resourceId: labor.id,
        usageQuantity: options.laborHoursPerBatch,
        usageBasis: "FIXED_PER_REFERENCE_BATCH",
      },
    });
  }

  for (const [basis, rate] of [
    ["FIXED_PER_BATCH", options.fixedPerBatch],
    ["PER_OUTPUT_UNIT", options.perOutputUnit],
    ["PER_1000_OUTPUT_UNITS", options.per1000],
  ] as const) {
    if (!rate) continue;
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "THIRD_PARTY_SERVICE",
        description: `Serviço ${basis}`,
        calculationBasis: basis,
        rateValue: rate,
      },
    });
  }

  if (options.unitsPerShippingBox) {
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/lines`,
      payload: {
        category: "SECONDARY_PACKAGING",
        description: "Caixa de expedição",
        calculationBasis: "PER_SHIPPING_BOX",
        rateValue: "1",
      },
    });
  }

  await app.inject({
    method: "POST",
    url: `/industrial-costs/${version.id}/activate`,
    payload: { confirmIncomplete: true },
  });

  const calculation = (
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${version.id}/calculations`,
      payload: {},
    })
  ).json();

  return { product, version, calculation, material, supplier };
}

async function createPricing(app: App, productId: string, calculationId: string) {
  return (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/pricing`,
      payload: { industrialCostCalculationId: calculationId },
    })
  ).json();
}

async function addTier(app: App, pricingId: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: `/pricing-versions/${pricingId}/tiers`, payload });
}

/** Resposta HTTP crua: o teste confere exatamente o que a API devolve. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TierResponse = any;

function tierOf(pricing: { tiers: TierResponse[] }, quantity: string): TierResponse {
  return pricing.tiers.find(
    (tier: TierResponse) => Number(tier.quantity) === Number(quantity),
  ) as TierResponse;
}

describe("Prever o que muda ao refazer sobre o custo atual", () => {
  it("lista só o que difere, o custo de cada faixa nas duas bases, e não toca na versão", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const versao = await prisma.pricingVersion.findFirst({
      include: { tiers: true },
      orderBy: { createdAt: "desc" },
    });
    if (!versao) {
      await app.close();
      return;
    }

    const antes = await prisma.pricingVersion.findUniqueOrThrow({ where: { id: versao.id } });
    const previa = (
      await app.inject({ method: "GET", url: `/pricing-versions/${versao.id}/rebase-preview` })
    ).json();

    // Prever é leitura: nenhuma versão nasce e a atual não se move.
    const depois = await prisma.pricingVersion.findUniqueOrThrow({ where: { id: versao.id } });
    expect(depois.industrialCostCalculationId).toBe(antes.industrialCostCalculationId);
    expect(depois.status).toBe(antes.status);

    if (previa.targetCalculationId) {
      // Só entra na lista o que REALMENTE difere — repetir o que ficou igual
      // esconderia a diferença que importa no meio do ruído.
      for (const change of previa.changes) {
        expect(change.from).not.toBe(change.to);
      }
      expect(previa.tiers).toHaveLength(versao.tiers.length);
    } else {
      // Já está na base mais recente: não há o que prever.
      expect(previa.changes).toEqual([]);
    }

    await app.close();
  });

  it("troca a base do rascunho NA PRÓPRIA versão, sem inventar uma V2 vazia", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, version, calculation } = await createScenario(app, {
      materialUnitCost: "10",
    });
    const pricing = await createPricing(app, product.id, calculation.id);
    await addTier(app, pricing.id, {
      quantity: "1000",
      priceMode: "TARGET_MARGIN",
      targetContributionMarginPercent: "30",
      commissionPercent: "5",
    });

    // Um cálculo mais recente da MESMA estrutura — muda a data de referência.
    const depoisDeAmanha = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const novo = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculations`,
        payload: { costReferenceDate: depoisDeAmanha },
      })
    ).json();
    expect(novo.id).not.toBe(calculation.id);

    const previa = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}/rebase-preview` })
    ).json();
    // Rascunho não é preço acordado: a base troca nele mesmo.
    expect(previa.mode).toBe("IN_PLACE");
    expect(previa.targetCalculationId).toBe(novo.id);

    const resposta = await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/rebase`,
      payload: { industrialCostCalculationId: novo.id },
    });
    expect(resposta.statusCode).toBe(200);
    const depois = resposta.json();

    // A MESMA versão, com a base nova. O bug era devolver o rascunho
    // existente com a base antiga e a tela reaparecer idêntica.
    expect(depois.id).toBe(pricing.id);
    expect(depois.versionNumber).toBe(pricing.versionNumber);
    expect(depois.calculationCode).toBe(novo.code);
    expect(depois.costReferenceDate).toBe(novo.costReferenceDate);
    expect(depois.tiers).toHaveLength(1);

    const prisma = getPrisma();
    const gravado = await prisma.pricingVersion.findUniqueOrThrow({ where: { id: pricing.id } });
    expect(gravado.industrialCostCalculationId).toBe(novo.id);
    const quantas = await prisma.pricingVersion.count({ where: { productId: product.id } });
    expect(quantas).toBe(1);

    // Nada mais a prever depois da troca.
    const depoisDaTroca = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}/rebase-preview` })
    ).json();
    expect(depoisDaTroca.targetCalculationId).toBeNull();

    await app.close();
  });

  it("versão ativa não se reescreve: a troca nasce como rascunho novo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, version, calculation } = await createScenario(app, {
      materialUnitCost: "10",
    });
    const pricing = await createPricing(app, product.id, calculation.id);
    await addTier(app, pricing.id, {
      quantity: "1000",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "50",
      commissionPercent: "5",
    });
    const ativada = await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/activate`,
      payload: { confirmIncompleteCost: true },
    });
    expect(ativada.statusCode).toBe(200);

    const novo = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${version.id}/calculations`,
        payload: { costReferenceDate: new Date(Date.now() + 2 * 86400000).toISOString() },
      })
    ).json();

    const previa = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}/rebase-preview` })
    ).json();
    expect(previa.mode).toBe("NEW_VERSION");

    const criada = (
      await app.inject({
        method: "POST",
        url: `/pricing-versions/${pricing.id}/rebase`,
        payload: { industrialCostCalculationId: novo.id },
      })
    ).json();

    expect(criada.id).not.toBe(pricing.id);
    expect(criada.status).toBe("DRAFT");
    expect(criada.calculationCode).toBe(novo.code);

    // Preço acordado fica intacto.
    const prisma = getPrisma();
    const original = await prisma.pricingVersion.findUniqueOrThrow({ where: { id: pricing.id } });
    expect(original.status).toBe("ACTIVE");
    expect(original.industrialCostCalculationId).toBe(calculation.id);

    await app.close();
  });
});

describe("Precificação — versão e proveniência", () => {
  it("nasce de um cálculo salvo e herda a data de referência de custo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, { materialUnitCost: "10" });
    const pricing = await createPricing(app, product.id, calculation.id);

    expect(pricing.code.startsWith("PREC-")).toBe(true);
    expect(pricing.versionNumber).toBe(1);
    expect(pricing.status).toBe("DRAFT");
    expect(pricing.productId).toBe(product.id);
    expect(pricing.calculationCode).toBe(calculation.code);
    expect(pricing.costReferenceDate).toBe(calculation.costReferenceDate);
    expect(pricing.costQuality).toBe(calculation.quality);

    await app.close();
  });

  it("recusa cálculo de outro produto e exige cálculo salvo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const first = await createScenario(app, { materialUnitCost: "10" });
    const second = await createScenario(app, { materialUnitCost: "10" });

    const mismatch = await app.inject({
      method: "POST",
      url: `/products/${second.product.id}/pricing`,
      payload: { industrialCostCalculationId: first.calculation.id },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error).toBe("invalid_calculation");

    const withoutCalculation = await app.inject({
      method: "POST",
      url: `/products/${second.product.id}/pricing`,
      payload: {},
    });
    expect(withoutCalculation.statusCode).toBe(400);

    await app.close();
  });

  it("mantém um único rascunho por produto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, { materialUnitCost: "10" });
    const first = await createPricing(app, product.id, calculation.id);
    const second = await createPricing(app, product.id, calculation.id);

    expect(second.id).toBe(first.id);
    expect(second.versionNumber).toBe(1);

    await app.close();
  });
});

describe("Precificação — preço, margem e contribuição", () => {
  it("calcula o preço sugerido pela margem desejada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    // 1 kg por unidade a R$ 10/kg = R$ 10 de material por unidade.
    const { product, calculation } = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
    });
    const pricing = await createPricing(app, product.id, calculation.id);
    const response = await addTier(app, pricing.id, {
      quantity: "1000",
      priceMode: "TARGET_MARGIN",
      targetContributionMarginPercent: "30",
      commissionPercent: "5",
    });

    const tier = tierOf(response.json(), "1000");
    // Energia direta: 0,001 kWh/un × R$ 1 = R$ 0,001 por unidade.
    expect(tier.industrialCostPerUnit).toBe("10.001000");
    // P = C / (1 − 0,30 − 0,05) = 10,001 / 0,65.
    expect(tier.suggestedUnitPrice).toBe("15.386154");
    expect(tier.selectedUnitPrice).toBe("15.386154");

    await app.close();
  });

  it("recusa margem somada à comissão em 100%", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, { materialUnitCost: "10" });
    const pricing = await createPricing(app, product.id, calculation.id);

    const response = await addTier(app, pricing.id, {
      quantity: "500",
      priceMode: "TARGET_MARGIN",
      targetContributionMarginPercent: "70",
      commissionPercent: "30",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_percent");

    await app.close();
  });

  it("do preço informado deriva contribuição, margem e markup", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    // Custo unitário exatamente R$ 10: 1 kg × R$ 10 e sem outras premissas.
    const { product, calculation } = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
    });
    const pricing = await createPricing(app, product.id, calculation.id);
    const response = await addTier(app, pricing.id, {
      quantity: "100",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "20",
      commissionPercent: "5",
    });

    const tier = tierOf(response.json(), "100");
    expect(tier.commissionPerUnit).toBe("1.000000");
    // 20 − 1 − 10,001 = 8,999 (a energia direta entra no custo).
    expect(tier.contributionPerUnit).toBe("8.999000");
    expect(tier.contributionMarginPercent).toBe("44.9950");
    expect(tier.markupPercent).toBe("99.9800");
    expect(tier.grossRevenue).toBe("2000.00");
    expect(tier.commissionTotal).toBe("100.00");

    await app.close();
  });

  it("preserva contribuição negativa em vez de zerá-la", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
    });
    const pricing = await createPricing(app, product.id, calculation.id);
    const response = await addTier(app, pricing.id, {
      quantity: "100",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "8",
      commissionPercent: "5",
    });

    const tier = tierOf(response.json(), "100");
    expect(Number(tier.contributionPerUnit)).toBeLessThan(0);
    expect(Number(tier.contributionMarginPercent)).toBeLessThan(0);
    expect(
      tier.warnings.some((warning: { code: string }) => warning.code === "NEGATIVE_CONTRIBUTION"),
    ).toBe(true);

    await app.close();
  });
});

describe("Precificação — custo por quantidade", () => {
  it("não dilui custo fixo abaixo de um lote de referência", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "0.001",
      referenceOutputQuantity: "1000",
      fixedPerBatch: "200",
      laborHoursPerBatch: "2",
      laborRate: "50",
    });
    const pricing = await createPricing(app, product.id, calculation.id);

    for (const quantity of ["300", "1000", "1500"]) {
      await addTier(app, pricing.id, {
        quantity,
        priceMode: "MANUAL_PRICE",
        manualUnitPrice: "10",
      });
    }
    const reread = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}` })
    ).json();

    const t300 = tierOf(reread, "300");
    const t1000 = tierOf(reread, "1000");
    const t1500 = tierOf(reread, "1500");

    // 300 de uma base de 1000 ainda exige um lote: R$ 200 + 2 h × R$ 50.
    expect(t300.batchCount).toBe("1");
    expect(t1000.batchCount).toBe("1");
    expect(t1500.batchCount).toBe("2");

    const fixedIn = (tier: { industrialCostTotal: string }, quantity: number) =>
      Number(tier.industrialCostTotal) - quantity * (0.001 * 10 + 0.001 * 1);
    expect(fixedIn(t300, 300)).toBeCloseTo(300, 6);
    expect(fixedIn(t1000, 1000)).toBeCloseTo(300, 6);
    // Dois lotes: R$ 400 de serviço + 4 h de mão de obra.
    expect(fixedIn(t1500, 1500)).toBeCloseTo(600, 6);
    // Custo unitário cai com a quantidade — é exatamente o que o simulador existe para mostrar.
    expect(Number(t300.industrialCostPerUnit)).toBeGreaterThan(
      Number(t1000.industrialCostPerUnit),
    );

    await app.close();
  });

  it("escala custo por unidade, por mil e caixas inteiras", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "0.001",
      perOutputUnit: "0.10",
      per1000: "100",
      unitsPerShippingBox: 12,
    });
    const pricing = await createPricing(app, product.id, calculation.id);

    await addTier(app, pricing.id, {
      quantity: "300",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "5",
    });
    const response = await addTier(app, pricing.id, {
      quantity: "301",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "5",
    });

    const t300 = tierOf(response.json(), "300");
    const t301 = tierOf(response.json(), "301");

    // 300 un: material 3 + energia 0,30 + 0,10×300 (30) + 100×0,3 (30) + 25 caixas (25).
    expect(t300.industrialCostTotal).toBe("88.30");
    // 301 un exige 26 caixas: uma unidade a mais custa uma caixa a mais.
    expect(Number(t301.industrialCostTotal) - Number(t300.industrialCostTotal)).toBeGreaterThan(1);

    await app.close();
  });

  it("congela a base econômica: compra nova não muda a precificação existente", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const scenario = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
    });
    const pricing = await createPricing(app, scenario.product.id, scenario.calculation.id);
    const before = (
      await addTier(app, pricing.id, {
        quantity: "1000",
        priceMode: "MANUAL_PRICE",
        manualUnitPrice: "20",
      })
    ).json();
    const costBefore = tierOf(before, "1000").industrialCostPerUnit;

    await receiveWithCost(app, {
      supplierId: scenario.supplier.id,
      itemId: scenario.material.id,
      quantity: "1000",
      unitCost: "40",
    });

    const after = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}` })
    ).json();
    expect(tierOf(after, "1000").industrialCostPerUnit).toBe(costBefore);

    // Um cálculo novo enxerga a nova realidade — e é ele que exige nova versão.
    const newCalculation = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${scenario.version.id}/calculations`,
        payload: {},
      })
    ).json();
    expect(Number(newCalculation.costPerUnit)).toBeGreaterThan(Number(costBefore));

    await app.close();
  });
});

describe("Precificação — custo incompleto", () => {
  it("não produz preço pela margem e não inventa margem no preço manual", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    // Sem recebimento: material sem custo conhecido.
    const { product, calculation } = await createScenario(app, { materialQuantityPerUnit: "1" });
    expect(calculation.quality).toBe("PARTIAL");

    const pricing = await createPricing(app, product.id, calculation.id);
    const target = (
      await addTier(app, pricing.id, {
        quantity: "500",
        priceMode: "TARGET_MARGIN",
        targetContributionMarginPercent: "30",
        commissionPercent: "5",
      })
    ).json();
    const targetTier = tierOf(target, "500");
    expect(targetTier.costQuality).toBe("PARTIAL");
    expect(targetTier.suggestedUnitPrice).toBeNull();
    expect(targetTier.selectedUnitPrice).toBeNull();

    const manual = (
      await addTier(app, pricing.id, {
        quantity: "1000",
        priceMode: "MANUAL_PRICE",
        manualUnitPrice: "20",
        commissionPercent: "5",
      })
    ).json();
    const manualTier = tierOf(manual, "1000");
    expect(manualTier.selectedUnitPrice).toBe("20.000000");
    expect(manualTier.commissionPerUnit).toBe("1.000000");
    // Subtotal conhecido não vira custo total: sem custo, sem margem.
    expect(manualTier.contributionPerUnit).toBeNull();
    expect(manualTier.contributionMarginPercent).toBeNull();
    expect(manualTier.markupPercent).toBeNull();

    // Faixa por margem sem preço sugerido bloqueia a ativação.
    const blocked = await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/activate`,
      payload: { confirmIncompleteCost: true },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("incomplete_pricing");

    await app.close();
  });

  it("ativa com custo incompleto só mediante confirmação explícita", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, { materialQuantityPerUnit: "1" });
    const pricing = await createPricing(app, product.id, calculation.id);
    await addTier(app, pricing.id, {
      quantity: "1000",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "20",
    });

    const refused = await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/activate`,
      payload: {},
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("incomplete_cost");

    const confirmed = await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/activate`,
      payload: { confirmIncompleteCost: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("ACTIVE");

    await app.close();
  });
});

describe("Precificação — ativação e histórico", () => {
  it("recalcula no backend, ignora números enviados pela tela e congela snapshots", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const scenario = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
    });
    const pricing = await createPricing(app, scenario.product.id, scenario.calculation.id);
    await addTier(app, pricing.id, {
      quantity: "1000",
      priceMode: "TARGET_MARGIN",
      targetContributionMarginPercent: "30",
      commissionPercent: "5",
      // Números inventados pelo cliente HTTP não têm efeito nenhum.
      suggestedUnitPrice: "1",
      contributionPerUnit: "999",
    });

    const activated = (
      await app.inject({
        method: "POST",
        url: `/pricing-versions/${pricing.id}/activate`,
        payload: {},
      })
    ).json();
    const tier = tierOf(activated, "1000");
    expect(tier.selectedUnitPrice).toBe("15.386154");
    expect(tier.industrialCostPerUnit).toBe("10.001000");

    // Depois de ativa: imutável.
    const patch = await app.inject({
      method: "PATCH",
      url: `/pricing-tiers/${tier.id}`,
      payload: { manualUnitPrice: "50" },
    });
    expect(patch.statusCode).toBe(409);
    const remove = await app.inject({ method: "DELETE", url: `/pricing-tiers/${tier.id}` });
    expect(remove.statusCode).toBe(409);

    // Nova realidade econômica não reescreve preço já negociado.
    await receiveWithCost(app, {
      supplierId: scenario.supplier.id,
      itemId: scenario.material.id,
      quantity: "1000",
      unitCost: "40",
    });
    const reread = (
      await app.inject({ method: "GET", url: `/pricing-versions/${pricing.id}` })
    ).json();
    expect(tierOf(reread, "1000").industrialCostPerUnit).toBe("10.001000");
    expect(tierOf(reread, "1000").selectedUnitPrice).toBe("15.386154");

    await app.close();
  });

  it("nova versão copia o plano comercial e mantém uma única ativa", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const scenario = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
    });
    const v1 = await createPricing(app, scenario.product.id, scenario.calculation.id);
    await addTier(app, v1.id, {
      quantity: "500",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "25",
      commissionPercent: "4",
    });
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${v1.id}/activate`,
      payload: {},
    });

    const newCalculation = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${scenario.version.id}/calculations`,
        payload: {},
      })
    ).json();
    const v2 = await createPricing(app, scenario.product.id, newCalculation.id);

    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe("DRAFT");
    expect(v2.tiers).toHaveLength(1);
    expect(v2.tiers[0].quantity).toBe("500");
    expect(v2.tiers[0].commissionPercent).toBe("4.0000");
    expect(v2.calculationCode).toBe(newCalculation.code);

    await app.inject({
      method: "POST",
      url: `/pricing-versions/${v2.id}/activate`,
      payload: {},
    });
    const overview = (
      await app.inject({ method: "GET", url: `/products/${scenario.product.id}/pricing` })
    ).json();
    expect(overview.current.id).toBe(v2.id);
    expect(
      overview.versions.filter((row: { status: string }) => row.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(
      overview.versions.find((row: { id: string }) => row.id === v1.id).status,
    ).toBe("INACTIVE");

    await app.close();
  });

  it("avisa quantidade abaixo do lote mínimo sem alterá-la", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, {
      materialUnitCost: "10",
      minimumBatchQuantity: "1000",
    });
    const pricing = await createPricing(app, product.id, calculation.id);
    const response = (
      await addTier(app, pricing.id, {
        quantity: "300",
        priceMode: "MANUAL_PRICE",
        manualUnitPrice: "10",
      })
    ).json();

    expect(tierOf(response, "300").quantity).toBe("300");
    expect(
      response.warnings.some((warning: { code: string }) => warning.code === "BELOW_MINIMUM_BATCH"),
    ).toBe(true);

    await app.close();
  });

  it("recusa quantidade inválida e faixa duplicada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { product, calculation } = await createScenario(app, { materialUnitCost: "10" });
    const pricing = await createPricing(app, product.id, calculation.id);

    const invalid = await addTier(app, pricing.id, {
      quantity: "0",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "10",
    });
    expect(invalid.statusCode).toBe(400);

    await addTier(app, pricing.id, {
      quantity: "300",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "10",
    });
    const duplicated = await addTier(app, pricing.id, {
      quantity: "300",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "12",
    });
    expect(duplicated.statusCode).toBe(409);
    expect(duplicated.json().error).toBe("duplicated_tier");

    await app.close();
  });
});

describe("Precificação — permissões e efeitos colaterais", () => {
  it("protege preço de quem não negocia", async () => {
    const admin = buildTestApp("ADMIN");
    await admin.ready();
    const production = buildTestApp("PRODUCTION");
    await production.ready();
    const purchasing = buildTestApp("PURCHASING");
    await purchasing.ready();

    const { product, calculation } = await createScenario(admin, { materialUnitCost: "10" });
    const pricing = await createPricing(admin, product.id, calculation.id);

    const blockedRead = await production.inject({
      method: "GET",
      url: `/pricing-versions/${pricing.id}`,
    });
    expect(blockedRead.statusCode).toBe(403);

    const purchasingRead = await purchasing.inject({
      method: "GET",
      url: `/pricing-versions/${pricing.id}`,
    });
    expect(purchasingRead.statusCode).toBe(200);

    const purchasingWrite = await purchasing.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/tiers`,
      payload: { quantity: "100", priceMode: "MANUAL_PRICE", manualUnitPrice: "10" },
    });
    expect(purchasingWrite.statusCode).toBe(403);

    await admin.close();
    await production.close();
    await purchasing.close();
  });

  it("não altera custo, orçamento nem estoque", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const scenario = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
    });
    const calculationBefore = (
      await app.inject({
        method: "GET",
        url: `/industrial-cost-calculations/${scenario.calculation.id}`,
      })
    ).json();

    const pricing = await createPricing(app, scenario.product.id, scenario.calculation.id);
    await addTier(app, pricing.id, {
      quantity: "1000",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "30",
    });
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/activate`,
      payload: {},
    });

    const calculationAfter = (
      await app.inject({
        method: "GET",
        url: `/industrial-cost-calculations/${scenario.calculation.id}`,
      })
    ).json();
    expect(calculationAfter).toEqual(calculationBefore);

    // Precificar não movimenta estoque nem cria oferta de fornecedor.
    expect(
      await prisma.inventoryMovement.count({
        where: { itemId: scenario.material.id, type: { in: ["ADJUSTMENT_IN", "ADJUSTMENT_OUT"] } },
      }),
    ).toBe(0);
    expect(
      await prisma.supplierItemOffer.count({
        where: { supplierItem: { itemId: scenario.material.id } },
      }),
    ).toBe(0);
    // Orçamento continua manual até a próxima capacidade. O preço mora na
    // linha, não no cabeçalho.
    expect(
      await prisma.quoteLine.count({
        where: { unitPrice: { not: null }, productId: scenario.product.id },
      }),
    ).toBe(0);

    await app.close();
  });
});

describe("R-19 — precificação por produto", () => {
  it("mostra só faixas ativas, uma linha por faixa, sem recalcular", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const scenario = await createScenario(app, {
      materialUnitCost: "10",
      materialQuantityPerUnit: "1",
    });
    const pricing = await createPricing(app, scenario.product.id, scenario.calculation.id);
    await addTier(app, pricing.id, {
      quantity: "500",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "25",
      commissionPercent: "5",
    });
    await addTier(app, pricing.id, {
      quantity: "1000",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: "22",
      commissionPercent: "5",
    });

    const draftRows = (
      await app.inject({
        method: "GET",
        url: `/reports/costs/pricing-by-product?search=${scenario.product.code}`,
      })
    ).json();
    // Rascunho é negociação em andamento: não é preço praticado.
    expect(draftRows.rows).toHaveLength(0);

    await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/activate`,
      payload: {},
    });

    const activeRows = (
      await app.inject({
        method: "GET",
        url: `/reports/costs/pricing-by-product?search=${scenario.product.code}`,
      })
    ).json();
    expect(activeRows.rows).toHaveLength(2);
    expect(activeRows.rows.map((row: { quantity: string }) => row.quantity)).toEqual(["500", "1000"]);
    expect(activeRows.rows[0].unitPrice).toBe("25.000000");
    expect(activeRows.rows[0].costPerUnit).toBe("10.001000");

    // Custo novo depois da ativação não muda o relatório.
    await receiveWithCost(app, {
      supplierId: scenario.supplier.id,
      itemId: scenario.material.id,
      quantity: "1000",
      unitCost: "50",
    });
    const reread = (
      await app.inject({
        method: "GET",
        url: `/reports/costs/pricing-by-product?search=${scenario.product.code}`,
      })
    ).json();
    expect(reread.rows[0].costPerUnit).toBe("10.001000");

    const csv = await app.inject({
      method: "GET",
      url: `/reports/costs/pricing-by-product/export.csv?search=${scenario.product.code}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("Margem de contribuição (%)");
    expect(csv.body).toContain(pricing.code);

    await app.close();
  });
});
