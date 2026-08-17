import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual da capacidade 46 (simulador de preço e margem).
 *
 * Cenário sintético montado via API e removido no final — o corpus real
 * permanece intacto e nenhuma precificação legada é criada.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate46.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const DAY_MS = 24 * 60 * 60 * 1000;

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = {
  productIds: [],
  itemIds: [],
  customerIds: [],
  supplierIds: [],
  resourceIds: [],
  purchaseOrderIds: [],
  receiptIds: [],
};
let sessionCookie = "";

async function api(method, url, body) {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status} ${text}`);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) sessionCookie = setCookie.split(";")[0];
  return text ? JSON.parse(text) : null;
}

/** Chamada que se espera recusada — devolve status sem estourar. */
async function attempt(method, url, body) {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: sessionCookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    if (created.productIds.length > 0) {
      const inProducts = { in: created.productIds };
      await prisma.pricingTier.deleteMany({
        where: { pricingVersion: { productId: inProducts } },
      });
      await prisma.pricingVersion.deleteMany({ where: { productId: inProducts } });
      await prisma.industrialCostCalculation.deleteMany({ where: { productId: inProducts } });
      await prisma.industrialCostResourceUsage.deleteMany({
        where: { industrialCostVersion: { productId: inProducts } },
      });
      await prisma.industrialCostLine.deleteMany({
        where: { industrialCostVersion: { productId: inProducts } },
      });
      await prisma.industrialCostVersion.deleteMany({ where: { productId: inProducts } });
      await prisma.formulationComponent.deleteMany({
        where: { formulationVersion: { productId: inProducts } },
      });
      await prisma.formulationVersion.deleteMany({ where: { productId: inProducts } });
      await prisma.product.deleteMany({ where: { id: inProducts } });
    }
    if (created.resourceIds.length > 0) {
      await prisma.industrialResourceRate.deleteMany({
        where: { industrialResourceId: { in: created.resourceIds } },
      });
      await prisma.industrialResource.deleteMany({ where: { id: { in: created.resourceIds } } });
    }
    if (created.receiptIds.length > 0) {
      await prisma.receiptLine.deleteMany({ where: { receiptId: { in: created.receiptIds } } });
      await prisma.receipt.deleteMany({ where: { id: { in: created.receiptIds } } });
    }
    if (created.purchaseOrderIds.length > 0) {
      await prisma.purchaseOrderLine.deleteMany({
        where: { purchaseOrderId: { in: created.purchaseOrderIds } },
      });
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: created.purchaseOrderIds } } });
    }
    if (created.itemIds.length > 0) {
      await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: created.itemIds } } });
      await prisma.lot.deleteMany({ where: { itemId: { in: created.itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    }
    if (created.supplierIds.length > 0) {
      await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } });
    }
    if (created.customerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
    }
    console.log("cenário de validação removido — corpus intacto");
  } finally {
    await prisma.$disconnect();
  }
}

const stamp = Date.now().toString().slice(-6);
let browser;

try {
  await api("POST", "/auth/login", credentials);

  const makeItem = async (type, name, unitCode) => {
    const item = await api("POST", "/items", {
      type,
      name: `${name} ${stamp}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    });
    created.itemIds.push(item.id);
    return item;
  };

  const supplier = await api("POST", "/suppliers", { legalName: `Fornecedor Preço ${stamp}` });
  created.supplierIds.push(supplier.id);

  const material = await makeItem("RAW_MATERIAL", "Colágeno hidrolisado", "kg");
  const finishedItem = await makeItem("FINISHED_PRODUCT", "Colágeno 300 g", "un");

  const po = await api("POST", "/purchase-orders", {
    supplierId: supplier.id,
    orderDate: new Date().toISOString(),
    lines: [{ itemId: material.id, orderedQuantity: "500" }],
  });
  created.purchaseOrderIds.push(po.id);
  await api("POST", `/purchase-orders/${po.id}/confirm`);
  const receipt = await api("POST", `/purchase-orders/${po.id}/receipts`, {
    receivedAt: new Date().toISOString(),
    lines: [
      {
        purchaseOrderLineId: po.lines[0].id,
        receivedQuantity: "500",
        supplierLot: `SUP-${stamp}`,
        expiryDate: new Date(Date.now() + 365 * DAY_MS).toISOString(),
        actualUnitCost: "60",
      },
    ],
  });
  created.receiptIds.push(receipt.id);

  const customer = await api("POST", "/customers", {
    legalName: `Delta Nutrition Preço ${stamp}`,
    street: "Rua Comercial",
    number: "100",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310100",
  });
  created.customerIds.push(customer.id);

  const product = await api("POST", "/products", {
    name: `Colágeno 300 g ${stamp}`,
    finishedProductItemId: finishedItem.id,
    customerId: customer.id,
    unitsPerShippingBox: 12,
    minimumBatchQuantity: "500",
  });
  created.productIds.push(product.id);

  const formulation = await api("POST", `/products/${product.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${formulation.id}`, {
    basisQuantity: "1",
    components: [{ itemId: material.id, quantity: "0.3", unitCode: "kg" }],
  });
  await api("POST", `/formulation-versions/${formulation.id}/activate`);

  const costVersion = await api("POST", `/products/${product.id}/industrial-costs`, {
    referenceOutputQuantity: "1000",
  });

  const makeResource = async (payload, rate) => {
    const resource = await api("POST", "/industrial-resources", {
      ...payload,
      name: `${payload.name} ${stamp}`,
    });
    created.resourceIds.push(resource.id);
    await api("POST", `/industrial-resources/${resource.id}/rates`, { rateValue: rate });
    return resource;
  };

  const operator = await makeResource({ name: "Operador de envase", type: "LABOR" }, "30");
  const energy = await makeResource({ name: "Energia elétrica", type: "ENERGY" }, "1");

  await api("POST", `/industrial-costs/${costVersion.id}/resource-usages`, {
    resourceId: operator.id,
    usageQuantity: "8",
    usageBasis: "FIXED_PER_REFERENCE_BATCH",
  });
  await api("POST", `/industrial-costs/${costVersion.id}/energy-mode`, {
    energyCalculationMode: "DIRECT",
  });
  await api("POST", `/industrial-costs/${costVersion.id}/resource-usages`, {
    resourceId: energy.id,
    usageQuantity: "0.05",
    usageBasis: "PER_OUTPUT_UNIT",
  });
  await api("POST", `/industrial-costs/${costVersion.id}/lines`, {
    category: "THIRD_PARTY_SERVICE",
    description: "Setup de linha por lote",
    calculationBasis: "FIXED_PER_BATCH",
    rateValue: "500",
  });
  await api("POST", `/industrial-costs/${costVersion.id}/lines`, {
    category: "SECONDARY_PACKAGING",
    description: "Caixa de expedição",
    calculationBasis: "PER_SHIPPING_BOX",
    rateValue: "3.50",
  });
  await api("POST", `/industrial-costs/${costVersion.id}/activate`, {});

  const calculation = await api("POST", `/industrial-costs/${costVersion.id}/calculations`, {});
  console.log(
    "cálculo base:",
    calculation.code,
    "| qualidade",
    calculation.quality,
    "| custo/un",
    calculation.costPerUnit,
  );

  // ── precificação ─────────────────────────────────────────
  const pricing = await api("POST", `/products/${product.id}/pricing`, {
    industrialCostCalculationId: calculation.id,
  });
  console.log("precificação criada:", pricing.label, "| custo base", pricing.calculationCode);

  const wrongProduct = await attempt("POST", `/products/${product.id}/pricing`, {});
  console.log("segunda criação devolve o rascunho existente:", wrongProduct.status);

  for (const quantity of ["300", "500", "1000"]) {
    await api("POST", `/pricing-versions/${pricing.id}/tiers`, {
      quantity,
      priceMode: "TARGET_MARGIN",
      targetContributionMarginPercent: "30",
      commissionPercent: "5",
    });
  }

  const withTiers = await api("GET", `/pricing-versions/${pricing.id}`);
  for (const tier of withTiers.tiers) {
    console.log(
      `  faixa ${tier.quantity}: lotes ${tier.batchCount} · custo/un ${tier.industrialCostPerUnit} · preço ${tier.selectedUnitPrice} · margem ${tier.contributionMarginPercent}%`,
    );
  }

  const impossible = await attempt("POST", `/pricing-versions/${pricing.id}/tiers`, {
    quantity: "2000",
    priceMode: "TARGET_MARGIN",
    targetContributionMarginPercent: "70",
    commissionPercent: "30",
  });
  console.log("margem + comissão = 100%:", impossible.status, impossible.body?.error);

  // Preço manual abaixo do custo: contribuição negativa preservada.
  const negative = await api("POST", `/pricing-versions/${pricing.id}/tiers`, {
    quantity: "2000",
    priceMode: "MANUAL_PRICE",
    manualUnitPrice: "18",
    commissionPercent: "5",
  });
  const negativeTier = negative.tiers.find((tier) => tier.quantity === "2000");
  console.log(
    "faixa 2000 com preço manual:",
    negativeTier.selectedUnitPrice,
    "| contribuição",
    negativeTier.contributionPerUnit,
    "| markup",
    negativeTier.markupPercent,
  );

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log("ok", name);
  };
  const visit = async (name, route) => {
    await page.goto(`${WEB}${route}`, { waitUntil: "networkidle" });
    await shot(name);
  };

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await visit("46-product-cost-calculations", `/produtos/${product.id}/custos`);
  await visit("46-pricing-draft", `/gestao/precificacao/${pricing.id}`);

  // Ativação: backend recalcula e congela.
  const activated = await api("POST", `/pricing-versions/${pricing.id}/activate`, {});
  console.log(
    "ativada:",
    activated.status,
    "| faixas",
    activated.tiers.length,
    "| preço 1000",
    activated.tiers.find((tier) => tier.quantity === "1000").selectedUnitPrice,
  );
  await visit("46-pricing-active", `/gestao/precificacao/${pricing.id}`);

  // Imutabilidade: nova compra não reescreve preço congelado.
  const po2 = await api("POST", "/purchase-orders", {
    supplierId: supplier.id,
    orderDate: new Date().toISOString(),
    lines: [{ itemId: material.id, orderedQuantity: "500" }],
  });
  created.purchaseOrderIds.push(po2.id);
  await api("POST", `/purchase-orders/${po2.id}/confirm`);
  const receipt2 = await api("POST", `/purchase-orders/${po2.id}/receipts`, {
    receivedAt: new Date().toISOString(),
    lines: [
      {
        purchaseOrderLineId: po2.lines[0].id,
        receivedQuantity: "500",
        supplierLot: `SUP2-${stamp}`,
        expiryDate: new Date(Date.now() + 365 * DAY_MS).toISOString(),
        actualUnitCost: "120",
      },
    ],
  });
  created.receiptIds.push(receipt2.id);

  const afterPurchase = await api("GET", `/pricing-versions/${pricing.id}`);
  console.log(
    "após compra mais cara — custo/un congelado:",
    afterPurchase.tiers.find((tier) => tier.quantity === "1000").industrialCostPerUnit,
  );

  const lockedTier = afterPurchase.tiers[0];
  const locked = await attempt("PATCH", `/pricing-tiers/${lockedTier.id}`, {
    manualUnitPrice: "99",
  });
  console.log("editar faixa ativa:", locked.status, locked.body?.error);

  // Nova versão sobre um cálculo novo.
  const newCalculation = await api("POST", `/industrial-costs/${costVersion.id}/calculations`, {});
  const v2 = await api("POST", `/products/${product.id}/pricing`, {
    industrialCostCalculationId: newCalculation.id,
  });
  console.log(
    "nova versão:",
    v2.label,
    "| faixas copiadas",
    v2.tiers.length,
    "| novo custo base",
    v2.calculationCode,
  );
  await visit("46-pricing-new-version", `/gestao/precificacao/${v2.id}`);

  await visit("46-pricing-list", "/gestao/precificacao");
  await visit("46-report-r19", "/relatorios/custos/precificacao-por-produto");

  await page.emulateMedia({ media: "print" });
  await visit("46-pricing-print", `/print/precificacao/${pricing.id}`);
  await page.emulateMedia({ media: "screen" });

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
