import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual da capacidade 43 (estrutura de custos industriais) e do
 * housekeeping de impressão dos relatórios.
 *
 * Monta o cenário via API e remove tudo no final — os produtos e formulações
 * importados do corpus não são tocados.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate43.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = { productIds: [], itemIds: [], customerIds: [] };
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

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersion: { productId: { in: created.productIds } } },
    });
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: created.productIds } },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: created.productIds } } },
    });
    await prisma.formulationVersion.deleteMany({
      where: { productId: { in: created.productIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
    console.log("cenário de validação removido — dados do corpus intactos");
  } finally {
    await prisma.$disconnect();
  }
}

const stamp = Date.now().toString().slice(-6);
let browser;

try {
  await api("POST", "/auth/login", credentials);

  const customer = await api("POST", "/customers", {
    legalName: `Alpha Nutrition Custos ${stamp}`,
    street: "Avenida Paulista",
    number: "1000",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310100",
  });
  created.customerIds.push(customer.id);

  const makeItem = async (type, name, unitCode) => {
    const item = await api("POST", "/items", { type, name: `${name} ${stamp}`, unitCode });
    created.itemIds.push(item.id);
    return item;
  };

  const veridiMaterial = await makeItem("RAW_MATERIAL", "Creatina monoidratada", "kg");
  const customerMaterial = await makeItem("RAW_MATERIAL", "Aroma enviado pelo cliente", "kg");
  const packaging = await makeItem("PACKAGING", "Pote 300 g", "un");
  const finishedItem = await makeItem("FINISHED_PRODUCT", "Creatina 300 g", "un");

  const product = await api("POST", "/products", {
    name: `Creatina 300 g ${stamp}`,
    finishedProductItemId: finishedItem.id,
    customerId: customer.id,
    unitsPerShippingBox: 12,
    minimumBatchQuantity: "1000",
  });
  created.productIds.push(product.id);

  const formulation = await api("POST", `/products/${product.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${formulation.id}`, {
    basisQuantity: "1",
    components: [
      { itemId: veridiMaterial.id, quantity: "0.3", unitCode: "kg" },
      {
        itemId: customerMaterial.id,
        quantity: "0.005",
        unitCode: "kg",
        supplyResponsibility: "CUSTOMER",
      },
      { itemId: packaging.id, quantity: "1", unitCode: "un" },
    ],
  });

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
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

  // 1. Housekeeping: relatório imprime por rota dedicada.
  await page.goto(`${WEB}/relatorios/estoque/movimentacoes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Imprimir / Salvar PDF" }).click();
  await page.waitForTimeout(1200);
  console.log("rota de impressão do relatório:", new URL(page.url()).pathname);
  const shellInReportPrint = await page.locator(".app-shell__sidebar, .toolbar").count();
  console.log("elementos de shell na impressão do relatório:", shellInReportPrint);
  await shot("43-report-print-route");

  // 2. Estrutura de custos: criar V1 com formulação ainda em rascunho.
  await visit("43-cost-empty", `/produtos/${product.id}/custos`);
  const draft = await api("POST", `/products/${product.id}/industrial-costs`, {
    // Formulação ainda em rascunho: a estrutura aponta para ela
    // explicitamente (trabalho de engenharia), mas não poderá ser ativada.
    formulationVersionId: formulation.id,
    referenceOutputQuantity: "1000",
  });
  console.log("estrutura criada:", draft.label, "formulação", draft.formulationStatus);

  // Ativar com formulação em rascunho é recusado.
  const refused = await fetch(`${API}/industrial-costs/${draft.id}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ confirmIncomplete: true }),
  });
  console.log("ativação com formulação rascunho:", refused.status);

  await api("POST", `/formulation-versions/${formulation.id}/activate`);

  // Premissas: caixa de expedição (valor conhecido) e overhead sem valor.
  await api("POST", `/industrial-costs/${draft.id}/lines`, {
    category: "SECONDARY_PACKAGING",
    description: "Caixa de expedição",
    calculationBasis: "PER_SHIPPING_BOX",
    rateValue: "3.50",
  });
  await api("POST", `/industrial-costs/${draft.id}/lines`, {
    category: "OVERHEAD",
    description: "Rateio industrial a definir",
    calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
  });

  await visit("43-cost-draft", `/produtos/${product.id}/custos`);

  const beforeActivation = await api("GET", `/industrial-costs/${draft.id}`);
  console.log(
    "completude antes de ativar:",
    beforeActivation.complete,
    "| pendências:",
    beforeActivation.pendencies.length,
  );

  await api("POST", `/industrial-costs/${draft.id}/activate`, { confirmIncomplete: true });
  await visit("43-cost-active", `/produtos/${product.id}/custos`);

  // 3. Nova versão copia receita, base e premissas.
  const v2 = await api("POST", `/products/${product.id}/industrial-costs`, {});
  console.log("nova versão:", v2.label, "premissas copiadas:", v2.lines.length);
  await visit("43-cost-versions", `/produtos/${product.id}/custos`);

  // 4. Impressão da estrutura.
  await page.emulateMedia({ media: "print" });
  await visit("43-cost-print", `/print/estrutura-custos/${draft.id}`);
  await page.emulateMedia({ media: "screen" });

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
