import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";

/**
 * Capacidade 47 — Projeto → Orçamento → Custo/Preço.
 *
 * O que estes testes protegem: produto técnico existe para engenharia e
 * custeio mas NÃO opera; aprovar promove o MESMO produto; orçamento pode
 * nascer de uma faixa de precificação ativa com quantidade exata; o preço
 * vinculado é imutável no rascunho e congelado no envio; e o documento do
 * cliente nunca carrega custo, margem ou comissão.
 */

const fixtureProjectIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureCustomerIds: string[] = [];
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

  if (fixtureProjectIds.length > 0) {
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: fixtureProjectIds } } });
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: fixtureProjectIds } },
    });
  }

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { id: { in: fixtureProductIds } },
        { originProjectId: { in: fixtureProjectIds } },
      ],
    },
    select: { id: true, finishedProductItemId: true },
  });
  const productIds = products.map((product) => product.id);
  const finishedItemIds = products
    .map((product) => product.finishedProductItemId)
    .filter((id): id is string => id !== null);

  if (productIds.length > 0) {
    await prisma.pricingTier.deleteMany({
      where: { pricingVersion: { productId: { in: productIds } } },
    });
    await prisma.pricingVersion.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.industrialCostCalculation.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersion: { productId: { in: productIds } } },
    });
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersion: { productId: { in: productIds } } },
    });
    await prisma.industrialCostVersion.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: productIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: productIds } } });
    // Linha de orçamento e vínculo com o projeto seguram o produto por FK.
    await prisma.quoteLine.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.projectProduct.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }

  if (fixtureProjectIds.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: fixtureProjectIds } } });
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

  const itemIds = [...fixtureItemIds, ...finishedItemIds];
  if (itemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
});

async function createCustomer() {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: { code: `CLI-INT-${m}`, legalName: `Cliente Integração ${m}`, active: true },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createProject(app: App, status: "WAITING" | "SAMPLE" = "WAITING") {
  const customer = await createCustomer();
  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: `Projeto Integração ${marker()}`,
        customerId: customer.id,
        entryDate: new Date().toISOString(),
      },
    })
  ).json();
  fixtureProjectIds.push(project.id);

  if (status !== "WAITING") {
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/status`,
      payload: { status },
    });
  }
  return project;
}

async function prepareTechnicalProduct(app: App, projectId: string) {
  return app.inject({
    method: "POST",
    url: `/projects/${projectId}/technical-product`,
    payload: { finishedUnitCode: "un" },
  });
}

async function createItem(type: "RAW_MATERIAL", unitCode = "kg") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `MP-INT-${m}`,
      name: `Item Integração ${m}`,
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

async function receiveWithCost(
  app: App,
  params: { itemId: string; quantity: string; unitCost: string },
) {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-INT-${m}`, legalName: `Fornecedor Integração ${m}`, active: true },
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
            supplierLot: `SUP-${m}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  fixtureReceiptIds.push(receipt.id);
}

/** Produto técnico com formulação ativa, EC ativa, CALC e PREC ativa. */
async function buildPricingChain(
  app: App,
  projectId: string,
  options: { tierQuantity?: string; unitPrice?: string; withMaterialCost?: boolean } = {},
) {
  const project = (await prepareTechnicalProduct(app, projectId)).json();
  const productId = project.productId as string;
  fixtureProductIds.push(productId);

  const material = await createItem("RAW_MATERIAL");
  if (options.withMaterialCost !== false) {
    await receiveWithCost(app, { itemId: material.id, quantity: "1000", unitCost: "10" });
  }

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

  const energy = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Energia ${marker()}`, type: "ENERGY" },
    })
  ).json();
  fixtureResourceIds.push(energy.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${energy.id}/rates`,
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
    payload: { resourceId: energy.id, usageQuantity: "0.001", usageBasis: "PER_OUTPUT_UNIT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${costVersion.id}/activate`,
    payload: { confirmIncomplete: true },
  });

  const calculation = (
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${costVersion.id}/calculations`,
      payload: {},
    })
  ).json();

  const pricing = (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/pricing`,
      payload: { industrialCostCalculationId: calculation.id },
    })
  ).json();
  await app.inject({
    method: "POST",
    url: `/pricing-versions/${pricing.id}/tiers`,
    payload: {
      quantity: options.tierQuantity ?? "500",
      priceMode: "MANUAL_PRICE",
      manualUnitPrice: options.unitPrice ?? "20",
      commissionPercent: "5",
    },
  });
  const activated = (
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${pricing.id}/activate`,
      payload: { confirmIncompleteCost: true },
    })
  ).json();

  return { productId, calculation, pricing: activated, material };
}

/**
 * Versão de orçamento já com a linha do produto do projeto.
 *
 * A economia vive na linha: sem ela não há o que precificar.
 */
async function createQuote(app: App, projectId: string) {
  const products = (
    await app.inject({ method: "GET", url: `/projects/${projectId}/products` })
  ).json().products as { id: string }[];
  const quote = (
    await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })
  ).json();

  if (quote.lines.length === 0 && products[0]) {
    const withLine = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/lines`,
        payload: { projectProductId: products[0].id },
      })
    ).json();
    return { ...withLine, lineId: withLine.lines[0].id as string };
  }

  return { ...quote, lineId: (quote.lines[0]?.id ?? null) as string | null };
}

describe("Produto técnico do projeto", () => {
  it("prepara produto em desenvolvimento sem mexer no status do projeto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const project = await createProject(app, "SAMPLE");
    const prepared = (await prepareTechnicalProduct(app, project.id)).json();
    fixtureProductIds.push(prepared.productId);

    // Preparar produto é trabalho de engenharia, não decisão comercial.
    expect(prepared.status).toBe("SAMPLE");
    expect(prepared.costing.lifecycle).toBe("DEVELOPMENT");
    expect(prepared.costing.formulationVersionNumber).toBe(1);
    expect(prepared.costing.formulationStatus).toBe("DRAFT");

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: prepared.productId },
      include: { finishedProductItem: true },
    });
    expect(product.originProjectId).toBe(project.id);
    expect(product.finishedProductItem?.type).toBe("FINISHED_PRODUCT");

    // Idempotente: nunca dois produtos para o mesmo projeto.
    const again = (await prepareTechnicalProduct(app, project.id)).json();
    expect(again.productId).toBe(prepared.productId);
    expect(await prisma.product.count({ where: { originProjectId: project.id } })).toBe(1);

    await app.close();
  });

  it("recusa preparar produto em projeto cancelado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/cancel`,
      payload: { cancelReason: "PROJECT_CHANGED" },
    });

    const refused = await prepareTechnicalProduct(app, project.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("not_preparable");

    await app.close();
  });

  it("bloqueia produto em desenvolvimento na operação comercial e industrial", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const prepared = (await prepareTechnicalProduct(app, project.id)).json();
    fixtureProductIds.push(prepared.productId);

    const order = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: prepared.customerId,
        orderDate: new Date().toISOString(),
        lines: [{ productId: prepared.productId, orderedQuantity: "100" }],
      },
    });
    expect(order.statusCode).toBe(400);
    expect(order.json().message).toContain("desenvolvimento");

    const production = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: prepared.productId, plannedQuantity: "100" },
    });
    expect(production.statusCode).toBe(400);
    expect(production.json().message).toContain("desenvolvimento");

    await app.close();
  });

  it("permite formulação, custo, cálculo e precificação no produto técnico", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id);

    expect(chain.calculation.code.startsWith("CALC-")).toBe(true);
    expect(chain.pricing.status).toBe("ACTIVE");
    expect(chain.pricing.tiers).toHaveLength(1);

    const detail = (await app.inject({ method: "GET", url: `/projects/${project.id}` })).json();
    expect(detail.costing.pricingLabel).toBe(chain.pricing.label);
    expect(detail.costing.calculationCode).toBe(chain.calculation.code);
    expect(detail.costing.lifecycle).toBe("DEVELOPMENT");

    await app.close();
  });

  it("inativa apenas o produto técnico do próprio projeto ao cancelar", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id);

    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/cancel`,
      payload: { cancelReason: "PROJECT_CHANGED" },
    });

    const product = await prisma.product.findUniqueOrThrow({ where: { id: chain.productId } });
    expect(product.active).toBe(false);
    expect(product.lifecycle).toBe("DEVELOPMENT");

    // Histórico econômico permanece auditável.
    expect(
      await prisma.industrialCostCalculation.count({ where: { productId: chain.productId } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.pricingVersion.count({ where: { productId: chain.productId } }),
    ).toBeGreaterThan(0);

    await app.close();
  });

  it("não inativa produto aprovado ligado a projeto legado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const customer = await createCustomer();
    const finishedItem = await prisma.item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-INT-${marker()}`,
        name: `PA Legado ${marker()}`,
        unitCode: "un",
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: false,
        active: true,
      },
    });
    fixtureItemIds.push(finishedItem.id);
    const legacyProduct = await prisma.product.create({
      data: {
        code: `PROD-INT-${marker()}`,
        name: `Produto Legado ${marker()}`,
        customerId: customer.id,
        finishedProductItemId: finishedItem.id,
        active: true,
      },
    });
    fixtureProductIds.push(legacyProduct.id);

    const project = (
      await app.inject({
        method: "POST",
        url: "/projects",
        payload: {
          name: `Projeto Legado ${marker()}`,
          customerId: customer.id,
          entryDate: new Date().toISOString(),
        },
      })
    ).json();
    fixtureProjectIds.push(project.id);
    await prisma.project.update({
      where: { id: project.id },
      data: { productId: legacyProduct.id },
    });

    await app.inject({
      method: "POST",
      url: `/projects/${project.id}/cancel`,
      payload: { cancelReason: "PROJECT_CHANGED" },
    });

    const reread = await prisma.product.findUniqueOrThrow({ where: { id: legacyProduct.id } });
    expect(reread.active).toBe(true);
    expect(reread.lifecycle).toBe("APPROVED");

    await app.close();
  });
});

describe("Orçamento com precificação", () => {
  it("usa a faixa exata e trava quantidade, unidade e preço", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    const quote = await createQuote(app, project.id);
    const tier = chain.pricing.tiers[0];

    const applied = (
      await app.inject({
        method: "POST",
        url: `/quote-lines/${quote.lineId}/apply-pricing`,
        payload: { pricingTierId: tier.id },
      })
    ).json();

    expect(applied.lines[0].priceSource).toBe("PRICING_TIER");
    expect(applied.lines[0].quotedQuantity).toBe("500");
    expect(applied.lines[0].uomCode).toBe("un");
    expect(applied.lines[0].unitPrice).toBe("20.0000");
    expect(applied.total).toBe("10000.00");

    // Preço vem da faixa: editar à mão exige desvincular antes.
    const locked = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${quote.lineId}`,
      payload: { unitPrice: "35" },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error).toBe("price_locked");

    const lockedQuantity = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${quote.lineId}`,
      payload: { quotedQuantity: "700" },
    });
    expect(lockedQuantity.statusCode).toBe(409);

    // Condições comerciais continuam editáveis.
    const conditions = await app.inject({
      method: "PATCH",
      url: `/quote-versions/${quote.id}`,
      payload: { paymentTerms: "30/60", leadTimeDays: 25 },
    });
    expect(conditions.statusCode).toBe(200);
    expect(conditions.json().paymentTerms).toBe("30/60");

    await app.close();
  });

  it("não escolhe faixa aproximada para outra quantidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, { tierQuantity: "500" });
    const quote = await createQuote(app, project.id);

    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${quote.lineId}`,
      payload: { quotedQuantity: "700", uomCode: "un" },
    });

    const refused = await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("quantity_mismatch");

    await app.close();
  });

  it("recusa faixa de outro produto e precificação em rascunho", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const projectA = await createProject(app);
    const chainA = await buildPricingChain(app, projectA.id);
    const projectB = await createProject(app);
    await buildPricingChain(app, projectB.id);

    const quoteB = await createQuote(app, projectB.id);
    const mismatch = await app.inject({
      method: "POST",
      url: `/quote-lines/${quoteB.lineId}/apply-pricing`,
      payload: { pricingTierId: chainA.pricing.tiers[0].id },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error).toBe("invalid_pricing");

    // Nova versão de precificação nasce DRAFT: não embasa proposta.
    const newCalculation = (
      await app.inject({
        method: "POST",
        url: `/industrial-costs/${chainA.pricing.tiers[0].id ? chainA.calculation.industrialCostVersionId : ""}/calculations`,
        payload: {},
      })
    ).json();
    const draftPricing = (
      await app.inject({
        method: "POST",
        url: `/products/${chainA.productId}/pricing`,
        payload: { industrialCostCalculationId: newCalculation.id },
      })
    ).json();

    const quoteA = await createQuote(app, projectA.id);
    const draftRefused = await app.inject({
      method: "POST",
      url: `/quote-lines/${quoteA.lineId}/apply-pricing`,
      payload: { pricingTierId: draftPricing.tiers[0].id },
    });
    expect(draftRefused.statusCode).toBe(409);
    expect(draftRefused.json().error).toBe("pricing_not_active");

    await app.close();
  });

  it("desvincula preservando o valor e removendo a proveniência", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id);
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });

    const manual = (
      await app.inject({ method: "POST", url: `/quote-lines/${quote.lineId}/manual-price` })
    ).json();

    expect(manual.lines[0].priceSource).toBe("MANUAL");
    expect(manual.lines[0].unitPrice).toBe("20.0000");

    const reread = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    // Sem vínculo, nada de PREC/CALC aparecendo como origem do preço.
    expect(reread.lines[0].pricing).toBeNull();

    const edited = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${quote.lineId}`,
      payload: { unitPrice: "25" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().lines[0].unitPrice).toBe("25.0000");

    await app.close();
  });

  it("congela a proveniência no envio e não a reescreve depois", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id);
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });

    const sent = await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/send`,
      payload: {},
    });
    expect(sent.statusCode).toBe(200);

    const detail = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(detail.lines[0].pricing.frozen).toBe(true);
    expect(detail.lines[0].pricing.pricingCode).toBe(chain.pricing.code);
    expect(detail.lines[0].pricing.calculationCode).toBe(chain.calculation.code);
    expect(detail.lines[0].pricing.costStructureLabel).toBe(
      chain.pricing.industrialCostVersionLabel,
    );
    expect(detail.lines[0].pricing.formulationVersionNumber).toBe(1);
    expect(detail.lines[0].pricing.selectedUnitPrice).toBe("20.000000");
    const frozenCost = detail.lines[0].pricing.industrialCostPerUnit;

    // Compra nova depois do envio não reescreve a proposta apresentada.
    await receiveWithCost(app, {
      itemId: chain.material.id,
      quantity: "1000",
      unitCost: "90",
    });
    const afterPurchase = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(afterPurchase.lines[0].pricing.industrialCostPerUnit).toBe(frozenCost);

    await app.close();
  });

  it("exige confirmação para enviar proposta com custo incompleto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    // Sem recebimento: o material fica sem custo conhecido.
    const chain = await buildPricingChain(app, project.id, { withMaterialCost: false });
    expect(chain.pricing.tiers[0].costQuality).toBe("PARTIAL");

    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });

    /**
     * A tela só consegue PEDIR a confirmação se enxergar a proveniência da
     * linha antes de enviar. O DTO devolvia `pricing: null` mesmo com
     * `priceSource = PRICING_TIER` (o parâmetro que montava a proveniência
     * nunca era passado por nenhum caller), então a UI nunca detectava custo
     * incompleto e o usuário só encontrava o 409 — sem saída.
     */
    const draftDetail = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(draftDetail.lines[0].priceSource).toBe("PRICING_TIER");
    expect(draftDetail.lines[0].pricing).not.toBeNull();
    expect(draftDetail.lines[0].pricing.pricingCode).toBe(chain.pricing.code);
    expect(draftDetail.lines[0].pricing.pricingVersionNumber).toBe(chain.pricing.versionNumber);
    expect(draftDetail.lines[0].pricing.tierQuantity).toBeTruthy();
    expect(draftDetail.lines[0].pricing.costQuality).toBe("PARTIAL");

    // A mesma proveniência precisa chegar pelo detalhe do PROJETO, que é a
    // tela onde o botão "Enviar ao cliente" realmente vive.
    const projectDetail = (
      await app.inject({ method: "GET", url: `/projects/${project.id}` })
    ).json();
    const projectQuote = projectDetail.quoteVersions.find(
      (version: { id: string }) => version.id === quote.id,
    );
    expect(projectQuote.lines[0].pricing).not.toBeNull();
    expect(projectQuote.lines[0].pricing.costQuality).toBe("PARTIAL");

    const refused = await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/send`,
      payload: {},
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("incomplete_cost");

    const confirmed = await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    expect(confirmed.statusCode).toBe(200);

    const detail = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(detail.lines[0].pricing.costQuality).toBe("PARTIAL");
    expect(detail.lines[0].pricing.contributionMarginPercent).toBeNull();

    await app.close();
  });

  it("mantém a proveniência longe de quem não negocia", async () => {
    const admin = buildTestApp("ADMIN");
    await admin.ready();
    const production = buildTestApp("PRODUCTION");
    await production.ready();

    const project = await createProject(admin);
    const chain = await buildPricingChain(admin, project.id);
    const quote = await createQuote(admin, project.id);
    await admin.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });

    const commercialView = (
      await admin.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(commercialView.lines[0].pricing).not.toBeNull();

    const productionView = (
      await production.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    // Produção vê a proposta comercial, nunca custo, margem ou comissão.
    expect(productionView.lines[0].unitPrice).toBe("20.0000");
    expect(productionView.lines[0].pricing).toBeNull();

    await admin.close();
    await production.close();
  });

  it("nova versão não herda o vínculo de precificação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id);
    const v1 = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${v1.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${v1.id}/send`, payload: {} });

    const v2 = await createQuote(app, project.id);
    expect(v2.versionNumber).toBe(2);
    // Valores comerciais servem de partida; a base econômica é reconfirmada.
    expect(v2.lines[0].unitPrice).toBe("20.0000");
    expect(v2.lines[0].priceSource).toBe("MANUAL");
    expect(v2.lines[0].pricing).toBeNull();

    await app.close();
  });
});

describe("Aprovação do projeto", () => {
  it("promove o MESMO produto técnico e libera a operação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id);
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/send`, payload: {} });
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });

    const before = await prisma.product.findUniqueOrThrow({ where: { id: chain.productId } });
    const approved = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/approve`, payload: {} })
    ).json();

    expect(approved.status).toBe("APPROVED");
    expect(approved.productId).toBe(chain.productId);
    expect(approved.costing.lifecycle).toBe("APPROVED");

    const after = await prisma.product.findUniqueOrThrow({ where: { id: chain.productId } });
    // Mesmo produto: mesmo código, mesma formulação, mesma estrutura.
    expect(after.code).toBe(before.code);
    expect(after.finishedProductItemId).toBe(before.finishedProductItemId);
    expect(
      await prisma.pricingVersion.count({
        where: { productId: chain.productId, status: "ACTIVE" },
      }),
    ).toBe(1);

    // Agora sim: produto aprovado entra em produção.
    const production = await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: chain.productId, plannedQuantity: "100" },
    });
    expect(production.statusCode).toBe(201);
    await prisma.productionOrder.deleteMany({ where: { id: production.json().id } });

    await app.close();
  });

  it("aprova projeto cujo produto já pertence a outro projeto aprovado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    // Primeiro projeto aprovado: fica com o ponteiro legado `Project.productId`.
    const primeiro = await createProject(app);
    const chain = await buildPricingChain(app, primeiro.id);
    const q1 = await createQuote(app, primeiro.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${q1.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${q1.id}/send`, payload: {} });
    await app.inject({ method: "POST", url: `/quote-versions/${q1.id}/accept` });
    const aprovado1 = (
      await app.inject({ method: "POST", url: `/projects/${primeiro.id}/approve`, payload: {} })
    ).json();
    expect(aprovado1.productId).toBe(chain.productId);

    /*
     * Segunda negociação com o MESMO produto. `Project.productId` é único no
     * banco: reivindicá-lo de novo estourava a constraint e o erro do Prisma
     * chegava cru na tela, com caminho de arquivo e nome de índice.
     */
    // Mesmo cliente: vincular produto de outro cliente é recusado, e com
    // razão — o caso aqui é a MESMA carteira negociando de novo.
    const segundo = (
      await app.inject({
        method: "POST",
        url: "/projects",
        payload: {
          name: `Projeto Integração ${marker()}`,
          customerId: aprovado1.customerId,
          entryDate: new Date().toISOString(),
        },
      })
    ).json();
    fixtureProjectIds.push(segundo.id);

    const link = await app.inject({
      method: "POST",
      url: `/projects/${segundo.id}/products`,
      payload: { operation: "link", productId: chain.productId },
    });
    expect(link.statusCode).toBe(201);

    const q2 = (
      await app.inject({ method: "POST", url: `/projects/${segundo.id}/quote-versions`, payload: {} })
    ).json();
    const linha = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${q2.id}/lines`,
        payload: { projectProductId: link.json().id },
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${linha.lines[0].id}`,
      payload: { quotedQuantity: "100", unitPrice: "10", uomCode: "un" },
    });
    await app.inject({
      method: "POST",
      url: `/quote-versions/${q2.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${q2.id}/accept` });

    const resposta = await app.inject({
      method: "POST",
      url: `/projects/${segundo.id}/approve`,
      payload: {},
    });
    expect(resposta.statusCode).toBe(200);

    const aprovado2 = resposta.json();
    expect(aprovado2.status).toBe("APPROVED");
    // Ponteiro legado continua vazio: quem responde é `ProjectProduct`.
    expect(aprovado2.productId).toBeNull();
    expect(aprovado2.products).toHaveLength(1);
    expect(aprovado2.products[0].productId).toBe(chain.productId);
    expect(aprovado2.products[0].status).toBe("APPROVED");

    // E nenhum produto foi fabricado como efeito colateral da aprovação.
    expect(
      await prisma.projectProduct.count({ where: { projectId: segundo.id } }),
    ).toBe(1);

    await app.close();
  });

  it("recusa proposta sem produto e aprova pelo produto adicionado ao projeto", async () => {
    // Antes do multiproduto, a aprovação podia criar o produto sozinha. Agora
    // a proposta exige linha, e linha exige produto do projeto: o produto
    // passa a ser decisão explícita de quem negocia, não efeito colateral da
    // aprovação.
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const project = await createProject(app);
    const empty = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();

    const withoutLines = await app.inject({
      method: "POST",
      url: `/quote-versions/${empty.id}/send`,
      payload: {},
    });
    expect(withoutLines.statusCode).toBe(400);
    expect(withoutLines.json().error).toBe("incomplete_quote");

    const link = (
      await app.inject({
        method: "POST",
        url: `/projects/${project.id}/products`,
        payload: { operation: "create", name: "Produto do projeto" },
      })
    ).json();
    fixtureProductIds.push(link.productId);

    const quoteWithLine = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${empty.id}/lines`,
        payload: { projectProductId: link.id },
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${quoteWithLine.lines[0].id}`,
      payload: { quotedQuantity: "1000", uomCode: "un", unitPrice: "12" },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${empty.id}/send`, payload: {} });
    await app.inject({ method: "POST", url: `/quote-versions/${empty.id}/accept` });

    const approved = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/approve`, payload: {} })
    ).json();
    expect(approved.status).toBe("APPROVED");
    expect(approved.productId).toBe(link.productId);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: link.productId },
      include: { formulationVersions: true },
    });
    // Orçamento manual continua aprovando projeto — sem precificação.
    expect(product.lifecycle).toBe("APPROVED");
    expect(product.formulationVersions).toHaveLength(1);
    expect(product.formulationVersions[0]!.status).toBe("DRAFT");

    await app.close();
  });

  it("mostra a proveniência, marca preço manual e fica restrito a quem negocia", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const production = buildTestApp("PRODUCTION");
    await production.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id);
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/send`, payload: {} });

    const manualProject = await createProject(app);
    // Proposta precisa de produto: o preço mora na linha.
    const manualLink = (
      await app.inject({
        method: "POST",
        url: `/projects/${manualProject.id}/products`,
        payload: { operation: "create", name: "Produto manual" },
      })
    ).json();
    fixtureProductIds.push(manualLink.productId);
    const manualQuote = await createQuote(app, manualProject.id);
    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${manualQuote.lineId}`,
      payload: { quotedQuantity: "300", uomCode: "un", unitPrice: "9" },
    });

    const report = (
      await app.inject({
        method: "GET",
        url: `/reports/commercial/quote-pricing?search=${project.code}`,
      })
    ).json();
    const row = report.rows[0];
    expect(row.priceSource).toBe("PRICING_TIER");
    expect(row.pricingLabel).toContain(chain.pricing.code);
    expect(row.calculationCode).toBe(chain.calculation.code);
    expect(row.contributionMarginPercent).not.toBeNull();

    const manualReport = (
      await app.inject({
        method: "GET",
        url: `/reports/commercial/quote-pricing?search=${manualProject.code}`,
      })
    ).json();
    const manualRow = manualReport.rows[0];
    // Preço de exceção não ganha proveniência inventada.
    expect(manualRow.priceSource).toBe("MANUAL");
    expect(manualRow.pricingLabel).toBeNull();
    expect(manualRow.calculationCode).toBeNull();

    // Custo e margem por proposta são informação restrita.
    const blocked = await production.inject({
      method: "GET",
      url: "/reports/commercial/quote-pricing",
    });
    expect(blocked.statusCode).toBe(403);

    const csv = await app.inject({
      method: "GET",
      url: `/reports/commercial/quote-pricing/export.csv?search=${project.code}`,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("Origem do preço");
    expect(csv.body).toContain(chain.calculation.code);

    await app.close();
    await production.close();
  });
});
