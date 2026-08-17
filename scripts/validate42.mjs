import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação visual da capacidade 42 (UX operacional + impressão).
 *
 * Navega uma história coerente na base DEV real e captura as telas
 * representativas, incluindo as folhas operacionais em mídia de impressão.
 * Não cria nem altera dado: é validação de UX.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate42.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

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

let browser;

try {
  await api("POST", "/auth/login", credentials);

  // Documentos reais da base para navegar com contexto.
  const projects = await api("GET", "/projects?pageSize=1&status=APPROVED");
  const project = projects.projects[0] ?? null;
  const orders = await api("GET", "/customer-orders?pageSize=1");
  const order = orders.customerOrders[0] ?? null;
  const productionOrders = await api("GET", "/production-orders?pageSize=1");
  const productionOrder = productionOrders.productionOrders[0] ?? null;
  const shipments = await api("GET", "/shipments?pageSize=1");
  const shipment = shipments.shipments[0] ?? null;

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
  await page.waitForTimeout(1500);

  // 1. Cockpit: ações rápidas + atenção agrupada.
  await shot("42-dashboard");
  const groupHead = page.locator(".dash-attention__group-head").first();
  if (await groupHead.count()) {
    await groupHead.click();
    await shot("42-dashboard-attention");
  }

  // 2. Listas operacionais com volume real.
  await visit("42-projects", "/comercial/projetos");
  if (project) await visit("42-project", `/comercial/projetos/${project.id}`);
  if (order) await visit("42-order", `/comercial/pedidos/${order.id}`);
  if (productionOrder) await visit("42-op", `/producao/ordens/${productionOrder.id}`);
  await visit("42-quality", "/qualidade/documentos");
  await visit("42-supplier-items", "/compras/item-fornecedor");

  // 3. Hub de relatórios com apelidos + busca por "Kardex".
  await visit("42-reports", "/relatorios");
  await page.fill("#reports-search", "kardex");
  await shot("42-reports-search-kardex");
  await visit("42-report-kardex", "/relatorios/estoque/movimentacoes");

  // 4. Filtros persistentes: aplicar, sair e voltar.
  await page.goto(`${WEB}/estoque/lotes`, { waitUntil: "networkidle" });
  await page.selectOption("#lots-status-filter", "AWAITING_RELEASE");
  await page.waitForTimeout(600);
  await page.goto(`${WEB}/estoque`, { waitUntil: "networkidle" });
  await page.goto(`${WEB}/estoque/lotes`, { waitUntil: "networkidle" });
  const persisted = await page.locator("#lots-status-filter").inputValue();
  console.log(`filtro persistido: ${persisted}`);
  await shot("42-lots-filter-persisted");
  const clear = page.getByRole("button", { name: "Limpar filtros" });
  if (await clear.count()) {
    await clear.click();
    await page.waitForTimeout(500);
    console.log(`após limpar: ${await page.locator("#lots-status-filter").inputValue()}`);
  }

  // 5. Folhas operacionais em mídia de impressão.
  await page.emulateMedia({ media: "print" });
  await visit("42-print-fo01-contagem", "/print/contagem-fisica");
  await visit("42-print-fo02-posicao", "/print/posicao-estoque");
  await visit("42-print-fo03-qualidade", "/print/qualidade-pendencias");
  if (productionOrder) {
    await visit("42-print-fo04-picking", `/print/producao-picking/${productionOrder.id}`);
  }
  if (shipment) {
    await visit("42-print-fo05-expedicao", `/print/expedicao-separacao/${shipment.id}`);
  }
  if (productionOrder) {
    await visit("42-print-op", `/producao/ordens/${productionOrder.id}/imprimir`);
  }
  await page.emulateMedia({ media: "screen" });
  await visit("42-print-fo01-preview", "/print/contagem-fisica?cega=1");

  // Sem shell no papel: a folha não pode levar sidebar nem toolbar.
  const shellInSheet = await page.locator(".app-shell__sidebar, .toolbar").count();
  console.log(`elementos de shell na folha: ${shellInSheet}`);

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
}
