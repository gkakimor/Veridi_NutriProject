import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
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
    // Pedido gerado da proposta sai primeiro: ele aponta para a versão e para
    // o projeto. Só o que ESTE arquivo criou, pelos ids das próprias fixtures.
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrder: { sourceProjectId: { in: fixtureProjectIds } } },
    });
    await prisma.customerOrder.deleteMany({
      where: { sourceProjectId: { in: fixtureProjectIds } },
    });
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
    /*
     * Pedido manual criado pelos testes também segura o produto por FK. Sai
     * pela IDENTIDADE dos pedidos que citam produtos DESTAS fixtures — nunca
     * por "qualquer pedido que se pareça com o nosso": este banco é
     * compartilhado com o app local.
     */
    const pedidos = await prisma.customerOrder.findMany({
      where: { lines: { some: { productId: { in: productIds } } } },
      select: { id: true },
    });
    const pedidoIds = pedidos.map((pedido) => pedido.id);
    if (pedidoIds.length > 0) {
      await prisma.customerOrderLine.deleteMany({
        where: { customerOrderId: { in: pedidoIds } },
      });
      await prisma.customerOrder.deleteMany({ where: { id: { in: pedidoIds } } });
    }
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
  options: {
    tierQuantity?: string;
    unitPrice?: string;
    withMaterialCost?: boolean;
    /** Segundo produto do mesmo projeto: o técnico só nasce uma vez. */
    productId?: string;
  } = {},
) {
  let productId = options.productId;
  if (!productId) {
    const project = (await prepareTechnicalProduct(app, projectId)).json();
    productId = project.productId as string;
  }
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

  return { productId, calculation, pricing: activated, material, costVersionId: costVersion.id as string };
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

describe("Desconto e plano de pagamento do orçamento", () => {
  it("desconta sobre o subtotal e divide em entrada mais parcelas com juros", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });

    // 500 × R$ 20,00 = R$ 10.000,00 de subtotal.
    const semJuros = (
      await app.inject({
        method: "PATCH",
        url: `/quote-versions/${quote.id}`,
        payload: {
          discountPercent: "10",
          paymentMethod: "INSTALLMENTS",
          downPaymentPercent: "20",
          installmentCount: 3,
          installmentIntervalDays: 30,
        },
      })
    ).json();

    const plano = semJuros.paymentSchedule;
    expect(semJuros.subtotal).toBe("10000.00");
    expect(plano.discountAmount).toBe("1000.00");
    // `total` é o preço à vista: o desconto entra nele, não fica de enfeite.
    expect(semJuros.total).toBe("9000.00");
    expect(plano.downPayment).toBe("1800.00");
    expect(plano.financedAmount).toBe("7200.00");
    expect(plano.installments.map((p: { amount: string }) => p.amount)).toEqual([
      "2400.00",
      "2400.00",
      "2400.00",
    ]);
    expect(plano.installments.map((p: { dueInDays: number }) => p.dueInDays)).toEqual([30, 60, 90]);
    // Sem juros, quem paga parcelado paga o mesmo que à vista.
    expect(plano.totalPayable).toBe("9000.00");
    expect(plano.interestAmount).toBe("0.00");

    // Price sobre R$ 7.200,00 em 3× a 2% a.m.: 7200 × 0,02 / (1 − 1,02⁻³).
    const comJuros = (
      await app.inject({
        method: "PATCH",
        url: `/quote-versions/${quote.id}`,
        payload: { monthlyInterestPercent: "2" },
      })
    ).json().paymentSchedule;

    expect(comJuros.installments.map((p: { amount: string }) => p.amount)).toEqual([
      "2496.63",
      "2496.63",
      "2496.63",
    ]);
    expect(comJuros.totalPayable).toBe("9289.89");
    expect(comJuros.interestAmount).toBe("289.89");

    // Voltar para à vista não deixa o plano anterior escondido no registro,
    // pronto para ressuscitar sozinho.
    const aVista = (
      await app.inject({
        method: "PATCH",
        url: `/quote-versions/${quote.id}`,
        payload: { paymentMethod: "CASH" },
      })
    ).json();
    expect(aVista.installmentCount).toBeNull();
    expect(aVista.monthlyInterestPercent).toBeNull();
    expect(aVista.paymentSchedule.installments).toEqual([]);
    expect(aVista.paymentSchedule.totalPayable).toBe("9000.00");
    expect(aVista.total).toBe("9000.00");

    await app.close();
  });

  it("a soma das parcelas fecha com o valor financiado mesmo quando não divide", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });

    // R$ 10.000,00 em 3× não divide em centavos exatos.
    const plano = (
      await app.inject({
        method: "PATCH",
        url: `/quote-versions/${quote.id}`,
        payload: { paymentMethod: "INSTALLMENTS", installmentCount: 3 },
      })
    ).json().paymentSchedule;

    const soma = plano.installments.reduce(
      (total: number, parcela: { amount: string }) => total + Number(parcela.amount),
      0,
    );
    // Uma proposta que não fecha na conta destrói a confiança no documento.
    expect(soma.toFixed(2)).toBe("10000.00");
    expect(plano.totalPayable).toBe("10000.00");
    expect(plano.interestAmount).toBe("0.00");

    // Desconto acima do teto não passa: 100% não é desconto, é doação.
    const recusado = await app.inject({
      method: "PATCH",
      url: `/quote-versions/${quote.id}`,
      payload: { discountPercent: "100" },
    });
    expect(recusado.statusCode).toBe(400);

    await app.close();
  });
});

describe("Simular condições sem gravar", () => {
  it("devolve o plano das condições enviadas e não toca na proposta", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });

    const previa = (
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/payment-preview`,
        payload: {
          discountPercent: "25",
          paymentMethod: "INSTALLMENTS",
          installmentCount: 2,
        },
      })
    ).json().schedule;

    // R$ 10.000,00 − 25% = R$ 7.500,00, em 2×.
    expect(previa.total).toBe("7500.00");
    expect(previa.installments.map((p: { amount: string }) => p.amount)).toEqual([
      "3750.00",
      "3750.00",
    ]);

    // Simular é leitura: a proposta continua sem desconto e à vista.
    const guardado = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(guardado.discountPercent).toBeNull();
    expect(guardado.paymentMethod).toBe("CASH");
    expect(guardado.total).toBe("10000.00");

    await app.close();
  });
});

/**
 * P1 — integridade comercial: proposta aceita → Pedido.
 *
 * O que estes testes protegem é uma pergunta que precisa ter resposta meses
 * depois: "por que este pedido foi fechado por este valor". Cada caso aqui
 * fecha um caminho pelo qual a resposta se perderia.
 */
describe("Proposta aceita → Pedido", () => {
  /** Cadeia completa até a proposta aceita e o projeto aprovado. */
  async function cenarioFechado(
    app: App,
    options: { tierQuantity?: string; unitPrice?: string; aprovar?: boolean } = {},
  ) {
    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, {
      tierQuantity: options.tierQuantity ?? "500",
      unitPrice: options.unitPrice ?? "20",
    });
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });
    await app.inject({
      method: "PATCH",
      url: `/quote-versions/${quote.id}`,
      payload: {
        discountPercent: "10",
        paymentMethod: "INSTALLMENTS",
        downPaymentPercent: "25",
        installmentCount: 3,
        monthlyInterestPercent: "1.5",
      },
    });
    const enviado = await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    expect(enviado.statusCode, enviado.body).toBe(200);
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });
    if (options.aprovar !== false) {
      const aprovado = await app.inject({
        method: "POST",
        url: `/projects/${project.id}/approve`,
        payload: {},
      });
      expect(aprovado.statusCode, aprovado.body).toBe(200);
    }
    return { project, chain, quote };
  }

  const gerar = (app: App, quoteId: string) =>
    app.inject({ method: "POST", url: `/quote-versions/${quoteId}/create-order` });

  it("recusa quando a proposta não foi aceita", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    const quote = await createQuote(app, project.id);
    await app.inject({
      method: "POST",
      url: `/quote-lines/${quote.lineId}/apply-pricing`,
      payload: { pricingTierId: chain.pricing.tiers[0].id },
    });

    const recusado = await gerar(app, quote.id);
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("quote_not_accepted");

    await app.close();
  });

  it("recusa quando o projeto ainda não foi aprovado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { quote } = await cenarioFechado(app, { aprovar: false });
    const recusado = await gerar(app, quote.id);
    // O produto técnico só vira operacional na aprovação: gerar antes
    // contornaria `Product.lifecycle` pela porta dos fundos.
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("project_not_approved");

    await app.close();
  });

  it("gera o pedido com cliente, quantidade, preço e origem do acordo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project, quote } = await cenarioFechado(app);
    const criado = await gerar(app, quote.id);
    expect(criado.statusCode, criado.body).toBe(201);
    const order = criado.json();

    expect(order.code.startsWith("PED-")).toBe(true);
    expect(order.status).toBe("DRAFT");
    expect(order.customerId).toBe(project.customerId);

    // Origem comercial legível sem busca textual.
    expect(order.commercialOrigin).not.toBeNull();
    expect(order.commercialOrigin.quoteVersionId).toBe(quote.id);
    expect(order.commercialOrigin.quoteCode).toBe(quote.code);
    expect(order.commercialOrigin.projectId).toBe(project.id);
    expect(order.commercialOrigin.projectCode).toBe(project.code);

    // 500 × R$ 20,00 = R$ 10.000,00, menos 10%.
    expect(order.commercialOrigin.subtotalAmount).toBe("10000.00");
    expect(order.commercialOrigin.discountPercent).toBe("10.0000");
    expect(order.commercialOrigin.totalAmount).toBe("9000.00");

    expect(order.lines).toHaveLength(1);
    const linha = order.lines[0];
    expect(linha.orderedQuantity).toBe("500");
    expect(linha.sourceQuoteLineId).toBeTruthy();
    expect(linha.agreedPrice.unitPrice).toBe("20.0000");
    expect(linha.agreedPrice.lineTotal).toBe("10000.00");

    await app.close();
  });

  it("preserva o desconto global sem ratear nas linhas", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { quote } = await cenarioFechado(app);
    const order = (await gerar(app, quote.id)).json();

    /*
     * O preço da linha continua sendo o preço da proposta. Distribuir o
     * desconto criaria um preço por linha que ninguém acordou — e o sistema
     * não tem essa regra.
     */
    expect(order.lines[0].agreedPrice.unitPrice).toBe("20.0000");
    expect(order.lines[0].agreedPrice.lineTotal).toBe("10000.00");
    expect(order.commercialOrigin.discountPercent).toBe("10.0000");
    expect(order.commercialOrigin.totalAmount).toBe("9000.00");

    await app.close();
  });

  it("congela o plano de pagamento aceito", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { quote } = await cenarioFechado(app);
    const order = (await gerar(app, quote.id)).json();
    const plano = order.commercialOrigin.paymentSchedule;

    expect(plano.method).toBe("INSTALLMENTS");
    expect(plano.total).toBe("9000.00");
    expect(plano.downPayment).toBe("2250.00");
    expect(plano.installments).toHaveLength(3);
    expect(plano.monthlyInterestPercent).toBe("1.5000");
    // Entrada mais parcelas reconcilia com o total a prazo, ao centavo.
    const soma = plano.installments.reduce(
      (total: number, parcela: { amount: string }) => total + Number(parcela.amount),
      Number(plano.downPayment),
    );
    expect(soma.toFixed(2)).toBe(plano.totalPayable);

    await app.close();
  });

  it("preserva a proveniência da faixa quando o preço veio de precificação", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { chain, quote } = await cenarioFechado(app);
    const order = (await gerar(app, quote.id)).json();
    const preco = order.lines[0].agreedPrice;

    expect(preco.source).toBe("PRICING_TIER");
    expect(preco.pricingVersionId).toBe(chain.pricing.id);
    expect(preco.pricingCode).toBe(chain.pricing.code);
    expect(preco.pricingTierId).toBe(chain.pricing.tiers[0].id);
    expect(Number(preco.tierQuantity)).toBe(500);

    await app.close();
  });

  it("mantém MANUAL como MANUAL, sem procurar precificação retroativa", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    const quote = await createQuote(app, project.id);
    // Preço digitado à mão: exceção comercial legítima.
    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${quote.lineId}`,
      payload: { quotedQuantity: "500", uomCode: "un", unitPrice: "31.50" },
    });
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });
    await app.inject({ method: "POST", url: `/projects/${project.id}/approve`, payload: {} });

    const order = (await gerar(app, quote.id)).json();
    const preco = order.lines[0].agreedPrice;

    expect(preco.source).toBe("MANUAL");
    expect(preco.unitPrice).toBe("31.5000");
    // A precificação existe, mas não participou da negociação: apontar para
    // ela agora seria proveniência inventada.
    expect(preco.pricingVersionId).toBeNull();
    expect(preco.pricingCode).toBeNull();
    expect(preco.pricingTierId).toBeNull();
    expect(chain.pricing.id).toBeTruthy();

    await app.close();
  });

  it("não duplica: o segundo pedido devolve o primeiro", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const { quote } = await cenarioFechado(app);
    const primeiro = await gerar(app, quote.id);
    expect(primeiro.statusCode).toBe(201);

    const segundo = await gerar(app, quote.id);
    // 200, não 201: reabre o existente em vez de estourar conflito.
    expect(segundo.statusCode).toBe(200);
    expect(segundo.json().id).toBe(primeiro.json().id);

    const quantos = await prisma.customerOrder.count({
      where: { sourceQuoteVersionId: quote.id },
    });
    expect(quantos).toBe(1);

    await app.close();
  });

  it("chamadas simultâneas não criam dois pedidos", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const { quote } = await cenarioFechado(app);
    // O invariante vive no banco (índice único), não só no serviço.
    const respostas = await Promise.all([
      gerar(app, quote.id),
      gerar(app, quote.id),
      gerar(app, quote.id),
    ]);
    const criados = respostas.filter((r) => r.statusCode === 201);
    expect(criados.length).toBeLessThanOrEqual(1);

    const quantos = await prisma.customerOrder.count({
      where: { sourceQuoteVersionId: quote.id },
    });
    expect(quantos).toBe(1);

    await app.close();
  });

  it("precificação nova depois do pedido não altera o que foi acordado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { chain, quote } = await cenarioFechado(app);
    const order = (await gerar(app, quote.id)).json();
    const antes = JSON.stringify(order.lines[0].agreedPrice);

    // Uma precificação nova, com outro preço, ativada depois do fechamento.
    const nova = (
      await app.inject({
        method: "POST",
        url: `/products/${chain.productId}/pricing`,
        payload: { industrialCostCalculationId: chain.calculation.id },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${nova.id}/tiers`,
      payload: {
        quantity: "500",
        priceMode: "MANUAL_PRICE",
        manualUnitPrice: "99",
        commissionPercent: "0",
      },
    });
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${nova.id}/activate`,
      payload: { confirmIncompleteCost: true, confirmOutdatedStructure: true },
    });

    const relido = (
      await app.inject({ method: "GET", url: `/customer-orders/${order.id}` })
    ).json();
    expect(JSON.stringify(relido.lines[0].agreedPrice)).toBe(antes);
    expect(relido.lines[0].agreedPrice.unitPrice).toBe("20.0000");
    expect(relido.commercialOrigin.totalAmount).toBe("9000.00");

    await app.close();
  });

  it("cálculo de custo novo depois do pedido não altera a origem comercial", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { chain, quote } = await cenarioFechado(app);
    const order = (await gerar(app, quote.id)).json();
    const antes = JSON.stringify(order.commercialOrigin);

    const novoCalculo = await app.inject({
      method: "POST",
      url: `/industrial-costs/${chain.costVersionId}/calculations`,
      payload: { costReferenceDate: new Date(Date.now() + 3 * 86400000).toISOString() },
    });
    expect(novoCalculo.statusCode).toBe(201);

    const relido = (
      await app.inject({ method: "GET", url: `/customer-orders/${order.id}` })
    ).json();
    expect(JSON.stringify(relido.commercialOrigin)).toBe(antes);

    await app.close();
  });

  it("confirmar o pedido não recalcula preço nem troca a origem", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { quote } = await cenarioFechado(app);
    const order = (await gerar(app, quote.id)).json();
    const precoAntes = JSON.stringify(order.lines[0].agreedPrice);
    const origemAntes = JSON.stringify(order.commercialOrigin);

    const confirmado = await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/confirm`,
    });
    expect(confirmado.statusCode, confirmado.body).toBe(200);
    const depois = confirmado.json();

    expect(depois.status).toBe("CONFIRMED");
    expect(JSON.stringify(depois.lines[0].agreedPrice)).toBe(precoAntes);
    expect(JSON.stringify(depois.commercialOrigin)).toBe(origemAntes);

    await app.close();
  });

  it("pedido derivado não deixa trocar produto nem quantidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { chain, quote } = await cenarioFechado(app);
    const order = (await gerar(app, quote.id)).json();

    const travado = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${order.id}`,
      payload: { lines: [{ productId: chain.productId, orderedQuantity: "999" }] },
    });
    expect(travado.statusCode).toBe(409);
    expect(travado.json().error).toBe("commercial_origin_locked");

    // Campos operacionais seguem livres.
    const operacional = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${order.id}`,
      payload: { notes: "Entregar pela manhã" },
    });
    expect(operacional.statusCode, operacional.body).toBe(200);
    expect(operacional.json().notes).toBe("Entregar pela manhã");

    await app.close();
  });

  it("a proposta aceita passa a apontar para o pedido gerado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project, quote } = await cenarioFechado(app);
    const antes = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(antes.sourcedOrder).toBeNull();

    const order = (await gerar(app, quote.id)).json();

    // Navegação de mão dupla: proposta → pedido...
    const depois = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(depois.sourcedOrder.id).toBe(order.id);
    expect(depois.sourcedOrder.code).toBe(order.code);

    // ...e o detalhe do projeto carrega a mesma informação.
    const projeto = (
      await app.inject({ method: "GET", url: `/projects/${project.id}` })
    ).json();
    const aceita = projeto.quoteVersions.find(
      (q: { status: string }) => q.status === "ACCEPTED",
    );
    expect(aceita.sourcedOrder.code).toBe(order.code);

    // ...e o pedido → proposta.
    expect(order.commercialOrigin.quoteVersionId).toBe(quote.id);

    await app.close();
  });

  it("proposta multiproduto gera uma linha por produto", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const primeiro = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    // O produto técnico nasce uma vez; o segundo entra explicitamente.
    const extra = (
      await app.inject({
        method: "POST",
        url: `/projects/${project.id}/products`,
        payload: { operation: "create", name: `Segundo ${marker()}`, finishedUnitCode: "un" },
      })
    ).json();
    const segundo = await buildPricingChain(app, project.id, {
      tierQuantity: "300",
      unitPrice: "35",
      productId: extra.productId,
    });

    const links = (
      await app.inject({ method: "GET", url: `/projects/${project.id}/products` })
    ).json().products as { id: string; productId: string }[];
    expect(links.length).toBeGreaterThanOrEqual(2);

    const quote = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    for (const link of links) {
      if (quote.lines.some((l: { productId: string }) => l.productId === link.productId)) continue;
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/lines`,
        payload: { projectProductId: link.id },
      });
    }
    const comLinhas = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    for (const linha of comLinhas.lines) {
      const cadeia = linha.productId === primeiro.productId ? primeiro : segundo;
      await app.inject({
        method: "POST",
        url: `/quote-lines/${linha.id}/apply-pricing`,
        payload: { pricingTierId: cadeia.pricing.tiers[0].id },
      });
    }
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });
    await app.inject({ method: "POST", url: `/projects/${project.id}/approve`, payload: {} });

    const order = (await gerar(app, quote.id)).json();
    expect(order.lines).toHaveLength(comLinhas.lines.length);
    for (const linha of order.lines) {
      expect(linha.agreedPrice).not.toBeNull();
      expect(linha.sourceQuoteLineId).toBeTruthy();
    }
    // Cada produto entra uma vez só, com o preço da sua própria faixa.
    const porProduto = new Map(
      order.lines.map((l: { productId: string; agreedPrice: { unitPrice: string } }) => [
        l.productId,
        l.agreedPrice.unitPrice,
      ]),
    );
    expect(porProduto.get(primeiro.productId)).toBe("20.0000");
    expect(porProduto.get(segundo.productId)).toBe("35.0000");

    await app.close();
  });

  /**
   * Proposta de duas linhas com preço de quatro casas, escolhida porque as
   * duas regras de arredondamento dão números DIFERENTES aqui:
   * `Σ round(linha)` = 172,84 e `round(Σ linha)` = 172,83.
   */
  async function propostaComDivergenciaDeCentavos(app: App) {
    const project = await createProject(app);
    for (const nome of ["Divergência A", "Divergência B"]) {
      const criado = await app.inject({
        method: "POST",
        url: `/projects/${project.id}/products`,
        payload: { operation: "create", name: `${nome} ${marker()}`, finishedUnitCode: "un" },
      });
      expect(criado.statusCode, criado.body).toBe(201);
    }

    const links = (
      await app.inject({ method: "GET", url: `/projects/${project.id}/products` })
    ).json().products as { id: string; productId: string }[];
    expect(links).toHaveLength(2);

    const quote = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    for (const link of links) {
      if (quote.lines.some((l: { productId: string }) => l.productId === link.productId)) continue;
      await app.inject({
        method: "POST",
        url: `/quote-versions/${quote.id}/lines`,
        payload: { projectProductId: link.id },
      });
    }

    const comLinhas = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(comLinhas.lines).toHaveLength(2);
    // 7 × R$ 12,3450 = R$ 86,415 → R$ 86,42 na linha que o cliente confere.
    for (const linha of comLinhas.lines) {
      const alterado = await app.inject({
        method: "PATCH",
        url: `/quote-lines/${linha.id}`,
        payload: { quotedQuantity: "7", unitPrice: "12.3450" },
      });
      expect(alterado.statusCode, alterado.body).toBe(200);
    }

    return { project, quote };
  }

  async function aceitarEAprovar(app: App, projectId: string, quoteId: string) {
    const enviado = await app.inject({
      method: "POST",
      url: `/quote-versions/${quoteId}/send`,
      payload: { confirmIncompleteCost: true },
    });
    expect(enviado.statusCode, enviado.body).toBe(200);
    const aceito = await app.inject({ method: "POST", url: `/quote-versions/${quoteId}/accept` });
    expect(aceito.statusCode, aceito.body).toBe(200);
    const aprovado = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/approve`,
      payload: {},
    });
    expect(aprovado.statusCode, aprovado.body).toBe(200);
  }

  it("o Pedido congela o subtotal da proposta, e não uma segunda conta", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project, quote } = await propostaComDivergenciaDeCentavos(app);

    const proposta = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(proposta.lines.map((l: { total: string }) => l.total)).toEqual(["86.42", "86.42"]);
    expect(proposta.subtotal).toBe("172.84");
    expect(proposta.total).toBe("172.84");

    await aceitarEAprovar(app, project.id, quote.id);
    const criado = await gerar(app, quote.id);
    expect(criado.statusCode, criado.body).toBe(201);
    const order = criado.json();

    /*
     * O Pedido fecha pelo MESMO número da proposta aceita, centavo por
     * centavo. Somava-se em precisão cheia e arredondava no fim: R$ 172,83,
     * um centavo que a proposta nunca mostrou.
     */
    expect(order.commercialOrigin.subtotalAmount).toBe("172.84");
    expect(order.commercialOrigin.subtotalAmount).not.toBe("172.83");
    expect(order.commercialOrigin.totalAmount).toBe("172.84");
    expect(order.commercialOrigin.paymentSchedule.subtotal).toBe("172.84");
    expect(order.commercialOrigin.paymentSchedule.total).toBe("172.84");
    expect(order.commercialOrigin.paymentSchedule.totalPayable).toBe("172.84");

    // Preço acordado com as quatro casas e total de linha com as duas.
    expect(order.lines).toHaveLength(2);
    for (const linha of order.lines) {
      expect(linha.orderedQuantity).toBe("7");
      expect(linha.agreedPrice.unitPrice).toBe("12.3450");
      expect(linha.agreedPrice.lineTotal).toBe("86.42");
    }

    // O subtotal do Pedido é exatamente a soma das linhas que ele imprime.
    const somaDasLinhas = order.lines
      .reduce(
        (soma: Prisma.Decimal, linha: { agreedPrice: { lineTotal: string } }) =>
          soma.plus(linha.agreedPrice.lineTotal),
        new Prisma.Decimal(0),
      )
      .toFixed(2);
    expect(somaDasLinhas).toBe(order.commercialOrigin.subtotalAmount);

    // Gerar o Pedido não reescreve a proposta.
    const depois = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    expect(depois.status).toBe("ACCEPTED");
    expect(depois.subtotal).toBe("172.84");
    expect(depois.lines.map((l: { total: string }) => l.total)).toEqual(["86.42", "86.42"]);

    await app.close();
  });

  it("o subtotal do Pedido é o da proposta também no caso comum", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { quote } = await cenarioFechado(app);
    const proposta = (
      await app.inject({ method: "GET", url: `/quote-versions/${quote.id}` })
    ).json();
    const order = (await gerar(app, quote.id)).json();

    // O invariante, não um número escolhido a dedo: Pedido = proposta aceita.
    expect(order.commercialOrigin.subtotalAmount).toBe(proposta.subtotal);
    expect(order.commercialOrigin.totalAmount).toBe(proposta.total);

    await app.close();
  });

  it("Pedido histórico não é recalculado pela regra nova — zero backfill", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const { project, quote } = await propostaComDivergenciaDeCentavos(app);
    await aceitarEAprovar(app, project.id, quote.id);
    const order = (await gerar(app, quote.id)).json();

    /*
     * Um Pedido fechado ANTES desta capability: o valor gravado é o da regra
     * antiga. Ele é o acordo daquele cliente e não muda porque a fórmula
     * mudou depois.
     */
    await prisma.customerOrder.update({
      where: { id: order.id },
      data: {
        agreedSubtotalAmount: new Prisma.Decimal("172.83"),
        agreedTotalAmount: new Prisma.Decimal("172.83"),
      },
    });

    // Gerar de novo devolve o Pedido que existe, sem tocar nos valores.
    const denovo = await gerar(app, quote.id);
    expect(denovo.statusCode).toBe(200);
    expect(denovo.json().id).toBe(order.id);
    expect(denovo.json().commercialOrigin.subtotalAmount).toBe("172.83");

    const lido = (
      await app.inject({ method: "GET", url: `/customer-orders/${order.id}` })
    ).json();
    expect(lido.commercialOrigin.subtotalAmount).toBe("172.83");
    expect(lido.commercialOrigin.totalAmount).toBe("172.83");

    await app.close();
  });

  it("produto fora do escopo da proposta aceita não entra no pedido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const project = await createProject(app);
    const dentro = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    // Desenvolvido no projeto, mas fora da proposta que o cliente aceitou.
    const extra = (
      await app.inject({
        method: "POST",
        url: `/projects/${project.id}/products`,
        payload: { operation: "create", name: `Fora ${marker()}`, finishedUnitCode: "un" },
      })
    ).json();
    const fora = await buildPricingChain(app, project.id, {
      tierQuantity: "300",
      unitPrice: "35",
      productId: extra.productId,
    });

    const links = (
      await app.inject({ method: "GET", url: `/projects/${project.id}/products` })
    ).json().products as { id: string; productId: string }[];
    const linkDentro = links.find((link) => link.productId === dentro.productId)!;

    const quote = (
      await app.inject({ method: "POST", url: `/projects/${project.id}/quote-versions` })
    ).json();
    // Só o produto acordado entra na proposta. O outro fica no projeto.
    let linhaDentro = quote.lines.find(
      (l: { productId: string }) => l.productId === dentro.productId,
    );
    for (const outra of quote.lines) {
      if (outra.productId !== dentro.productId) {
        await app.inject({ method: "DELETE", url: `/quote-lines/${outra.id}` });
      }
    }
    if (!linhaDentro) {
      const comLinha = (
        await app.inject({
          method: "POST",
          url: `/quote-versions/${quote.id}/lines`,
          payload: { projectProductId: linkDentro.id },
        })
      ).json();
      linhaDentro = comLinha.lines.find(
        (l: { productId: string }) => l.productId === dentro.productId,
      );
    }
    expect(linhaDentro, "linha do produto acordado").toBeTruthy();
    await app.inject({
      method: "POST",
      url: `/quote-lines/${linhaDentro.id}/apply-pricing`,
      payload: { pricingTierId: dentro.pricing.tiers[0].id },
    });
    await app.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${quote.id}/accept` });
    await app.inject({ method: "POST", url: `/projects/${project.id}/approve`, payload: {} });

    const marcado = await prisma.projectProduct.findFirst({
      where: { projectId: project.id, productId: fora.productId },
      select: { status: true },
    });
    expect(marcado?.status).toBe("OUT_OF_SCOPE");

    const order = (await gerar(app, quote.id)).json();
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].productId).toBe(dentro.productId);

    await app.close();
  });

  it("pedido criado direto continua válido e sem origem comercial", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { project, chain } = await cenarioFechado(app);

    const manual = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: {
        customerId: project.customerId,
        lines: [{ productId: chain.productId, orderedQuantity: "120" }],
      },
    });
    expect(manual.statusCode, manual.body).toBe(201);
    const order = manual.json();

    // O caminho antigo não exige orçamento retroativo.
    expect(order.commercialOrigin).toBeNull();
    expect(order.lines[0].sourceQuoteLineId).toBeNull();
    expect(order.lines[0].agreedPrice).toBeNull();

    // E continua editável: nada trava um pedido sem acordo por trás.
    const editado = await app.inject({
      method: "PATCH",
      url: `/customer-orders/${order.id}`,
      payload: { lines: [{ productId: chain.productId, orderedQuantity: "150" }] },
    });
    expect(editado.statusCode, editado.body).toBe(200);
    expect(editado.json().lines[0].orderedQuantity).toBe("150");

    await app.close();
  });

  it("papel sem autorização comercial recebe 403 e nada é criado", async () => {
    const admin = buildTestApp("ADMIN");
    await admin.ready();
    const { quote } = await cenarioFechado(admin);
    await admin.close();

    const viewer = buildTestApp("VIEWER");
    await viewer.ready();
    const negado = await viewer.inject({
      method: "POST",
      url: `/quote-versions/${quote.id}/create-order`,
    });
    expect(negado.statusCode).toBe(403);
    await viewer.close();

    const prisma = getPrisma();
    expect(
      await prisma.customerOrder.count({ where: { sourceQuoteVersionId: quote.id } }),
    ).toBe(0);
  });

  it("falha no meio da geração não deixa pedido pela metade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const { chain, quote } = await cenarioFechado(app);
    // Unidade da proposta divergente da unidade do produto acabado: a
    // operação precisa parar por inteiro, sem cabeçalho órfão.
    await prisma.quoteLine.updateMany({
      where: { quoteVersionId: quote.id },
      data: { uomCode: "kg" },
    });

    const recusado = await gerar(app, quote.id);
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("uom_mismatch");
    expect(
      await prisma.customerOrder.count({ where: { sourceQuoteVersionId: quote.id } }),
    ).toBe(0);
    expect(chain.productId).toBeTruthy();

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

/**
 * BACKLOG #16 — ausência de precificação vigente é ESTADO, não recurso ausente.
 *
 * A consulta respondia 404 quando o produto não tinha precificação ativa. A
 * tela lidava certo com a ausência, mas cada consulta de uma tela sã deixava
 * um erro no console do navegador, e uma auditoria de console reprovava a
 * página inteira por causa de um estado normal do negócio.
 */
describe("Opções de precificação da linha do orçamento", () => {
  it("linha sem precificação vigente responde 200 com ausência normal", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    await prepareTechnicalProduct(app, project.id);
    const quote = await createQuote(app, project.id);

    const resposta = await app.inject({
      method: "GET",
      url: `/quote-lines/${quote.lineId}/pricing-options`,
    });
    expect(resposta.statusCode, resposta.body).toBe(200);
    // O envelope existe e a ausência vem dentro dele — nada de corpo vazio.
    expect(resposta.json()).toEqual({ pricing: null });

    await app.close();
  });

  it("linha com precificação ativa responde 200 com as faixas", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const project = await createProject(app);
    const chain = await buildPricingChain(app, project.id, {
      tierQuantity: "500",
      unitPrice: "20",
    });
    const quote = await createQuote(app, project.id);

    const resposta = await app.inject({
      method: "GET",
      url: `/quote-lines/${quote.lineId}/pricing-options`,
    });
    expect(resposta.statusCode, resposta.body).toBe(200);
    const corpo = resposta.json();
    expect(corpo.pricing).not.toBeNull();
    expect(corpo.pricing.id).toBe(chain.pricing.id);
    expect(corpo.pricing.tiers.length).toBeGreaterThan(0);

    await app.close();
  });

  it("linha inexistente continua 404 — ausência de estado não vira ausência de recurso", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const resposta = await app.inject({
      method: "GET",
      url: "/quote-lines/00000000-0000-4000-8000-000000000000/pricing-options",
    });
    expect(resposta.statusCode).toBe(404);

    await app.close();
  });

  it("papel sem autorização comercial recebe 403, não 200 vazio", async () => {
    const app = buildTestApp("ADMIN");
    const production = buildTestApp("PRODUCTION");
    await app.ready();
    await production.ready();

    const project = await createProject(app);
    await prepareTechnicalProduct(app, project.id);
    const quote = await createQuote(app, project.id);

    const negado = await production.inject({
      method: "GET",
      url: `/quote-lines/${quote.lineId}/pricing-options`,
    });
    expect(negado.statusCode).toBe(403);

    await app.close();
    await production.close();
  });
});
