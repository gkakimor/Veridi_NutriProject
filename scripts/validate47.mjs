import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual da capacidade 47 — história comercial inteira:
 *
 *   Projeto → produto técnico → formulação → estrutura de custos → CALC →
 *   precificação → faixa → orçamento → envio → aceite → aprovação →
 *   produto operacional.
 *
 * Cenário sintético, removido no final; o corpus real não é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate47.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const DAY_MS = 24 * 60 * 60 * 1000;

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = {
  projectIds: [],
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
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { id: { in: created.productIds } },
          { originProjectId: { in: created.projectIds } },
        ],
      },
      select: { id: true, finishedProductItemId: true },
    });
    const productIds = products.map((product) => product.id);
    const finishedItemIds = products
      .map((product) => product.finishedProductItemId)
      .filter(Boolean);

    if (created.projectIds.length > 0) {
      await prisma.quoteVersion.deleteMany({ where: { projectId: { in: created.projectIds } } });
      await prisma.projectStatusHistory.deleteMany({
        where: { projectId: { in: created.projectIds } },
      });
    }
    if (productIds.length > 0) {
      const inProducts = { in: productIds };
      await prisma.productionOrder.deleteMany({ where: { productId: inProducts } });
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
    if (created.projectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: created.projectIds } } });
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
    const itemIds = [...created.itemIds, ...finishedItemIds];
    if (itemIds.length > 0) {
      await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.lot.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
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

  // ── 1. Projeto ────────────────────────────────────────────
  const customer = await api("POST", "/customers", {
    legalName: `Épsilon Nutrition ${stamp}`,
    street: "Avenida Comercial",
    number: "700",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310100",
  });
  created.customerIds.push(customer.id);

  const project = await api("POST", "/projects", {
    name: `Whey Isolado 900 g ${stamp}`,
    customerId: customer.id,
    entryDate: new Date().toISOString(),
    minimumBatchQuantity: "500",
  });
  created.projectIds.push(project.id);
  console.log("projeto:", project.code, project.status);

  // ── 2. Produto técnico ────────────────────────────────────
  const prepared = await api("POST", `/projects/${project.id}/technical-product`, {
    finishedUnitCode: "un",
  });
  created.productIds.push(prepared.productId);
  console.log(
    "produto técnico:",
    prepared.costing.productCode,
    prepared.costing.lifecycle,
    "| projeto continua",
    prepared.status,
  );

  const blockedOrder = await attempt("POST", "/customer-orders", {
    customerId: customer.id,
    orderDate: new Date().toISOString(),
    lines: [{ productId: prepared.productId, orderedQuantity: "100" }],
  });
  console.log("pedido com produto em desenvolvimento:", blockedOrder.status, blockedOrder.body?.error);

  // ── 3. Formulação, custo, cálculo ─────────────────────────
  const material = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Whey isolado ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(material.id);

  const supplier = await api("POST", "/suppliers", { legalName: `Fornecedor Whey ${stamp}` });
  created.supplierIds.push(supplier.id);
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
        actualUnitCost: "80",
      },
    ],
  });
  created.receiptIds.push(receipt.id);

  const formulations = await api("GET", `/products/${prepared.productId}/formulations`);
  const formulationId = formulations.versions[0].id;
  await api("PATCH", `/formulation-versions/${formulationId}`, {
    basisQuantity: "1",
    components: [{ itemId: material.id, quantity: "0.9", unitCode: "kg" }],
  });
  await api("POST", `/formulation-versions/${formulationId}/activate`);

  const costVersion = await api("POST", `/products/${prepared.productId}/industrial-costs`, {
    referenceOutputQuantity: "1000",
  });
  const energy = await api("POST", "/industrial-resources", {
    name: `Energia ${stamp}`,
    type: "ENERGY",
  });
  created.resourceIds.push(energy.id);
  await api("POST", `/industrial-resources/${energy.id}/rates`, { rateValue: "1" });
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
    rateValue: "800",
  });
  await api("POST", `/industrial-costs/${costVersion.id}/activate`, {});

  const calculation = await api("POST", `/industrial-costs/${costVersion.id}/calculations`, {});
  console.log("cálculo:", calculation.code, calculation.quality, "custo/un", calculation.costPerUnit);

  // ── 4. Precificação com faixas ────────────────────────────
  const pricing = await api("POST", `/products/${prepared.productId}/pricing`, {
    industrialCostCalculationId: calculation.id,
  });
  for (const quantity of ["500", "1000"]) {
    await api("POST", `/pricing-versions/${pricing.id}/tiers`, {
      quantity,
      priceMode: "TARGET_MARGIN",
      targetContributionMarginPercent: "35",
      commissionPercent: "5",
    });
  }
  const activePricing = await api("POST", `/pricing-versions/${pricing.id}/activate`, {});
  for (const tier of activePricing.tiers) {
    console.log(
      `  faixa ${tier.quantity}: custo/un ${tier.industrialCostPerUnit} · preço ${tier.selectedUnitPrice} · margem ${tier.contributionMarginPercent}%`,
    );
  }

  // ── 5. Orçamento a partir da faixa ────────────────────────
  const quote = await api("POST", `/projects/${project.id}/quote-versions`);
  const tier500 = activePricing.tiers.find((tier) => tier.quantity === "500");

  await api("PATCH", `/quote-versions/${quote.id}`, { quotedQuantity: "700", uomCode: "un" });
  const mismatch = await attempt("POST", `/quote-versions/${quote.id}/apply-pricing`, {
    pricingTierId: tier500.id,
  });
  console.log("faixa para quantidade diferente:", mismatch.status, mismatch.body?.error);

  await api("POST", `/quote-versions/${quote.id}/manual-price`);
  await api("PATCH", `/quote-versions/${quote.id}`, { quotedQuantity: "500", uomCode: "un" });
  const applied = await api("POST", `/quote-versions/${quote.id}/apply-pricing`, {
    pricingTierId: tier500.id,
  });
  console.log(
    "orçamento vinculado:",
    applied.priceSource,
    applied.quotedQuantity,
    applied.unitPrice,
    "| total",
    applied.total,
  );

  const locked = await attempt("PATCH", `/quote-versions/${quote.id}`, { unitPrice: "1" });
  console.log("editar preço vinculado:", locked.status, locked.body?.error);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
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

  await visit("47-project-costing", `/comercial/projetos/${project.id}`);
  await visit("47-product-development", "/cadastros/produtos");
  await visit("47-pricing", `/gestao/precificacao/${pricing.id}`);

  // ── 6. Envio, aceite e aprovação ──────────────────────────
  await api("POST", `/quote-versions/${quote.id}/send`, {});
  const sentQuote = await api("GET", `/quote-versions/${quote.id}`);
  console.log(
    "proposta enviada — proveniência congelada:",
    sentQuote.pricing.frozen,
    sentQuote.pricing.pricingCode,
    sentQuote.pricing.calculationCode,
    "| custo/un",
    sentQuote.pricing.industrialCostPerUnit,
  );

  await page.emulateMedia({ media: "print" });
  await visit("47-quote-print", `/comercial/orcamentos/${quote.id}/imprimir`);
  const printText = await page.locator(".print-doc").innerText();
  const leaked = ["Margem", "Markup", "Comissão", "Custo industrial", "CALC-", "PREC-"].filter(
    (term) => printText.includes(term),
  );
  console.log(
    leaked.length === 0
      ? "documento do cliente sem custo/margem/comissão"
      : `VAZAMENTO no documento do cliente: ${leaked.join(", ")}`,
  );
  await page.emulateMedia({ media: "screen" });

  await api("POST", `/quote-versions/${quote.id}/accept`);
  const approved = await api("POST", `/projects/${project.id}/approve`, {});
  console.log(
    "projeto aprovado:",
    approved.status,
    "| produto",
    approved.costing.productCode,
    approved.costing.lifecycle,
    "| mesmo id:",
    approved.productId === prepared.productId,
  );

  await visit("47-project-approved", `/comercial/projetos/${project.id}`);

  // Produto aprovado entra na operação.
  const productionOrder = await api("POST", "/production-orders", {
    productId: approved.productId,
    plannedQuantity: "500",
  });
  console.log("OP criada com produto aprovado:", productionOrder.code);

  await visit("47-report-r20", "/relatorios/comercial/orcamento-precificacao");

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
