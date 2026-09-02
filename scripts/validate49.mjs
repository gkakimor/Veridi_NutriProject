import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação da capacidade 49 — Produto cria o seu item de produto acabado.
 *
 * O que este roteiro prova é que o usuário não precisa mais saber que existe
 * um Item de estoque por trás do Produto: ele escolhe o cliente, dá um nome,
 * salva, e o PA aparece pronto. E que o caminho antigo — cadastrar o produto
 * acabado à mão em Itens — saiu da criação normal.
 *
 * Cenário sintético, removido no final; o corpus real não é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate49.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const stamp = Date.now().toString(36);

const credentials = (() => {
  for (const rel of ["../.local-data/dev-admin.json", "../../.local-data/dev-admin.json"]) {
    const file = new URL(rel, import.meta.url);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  throw new Error("Credencial de desenvolvimento não encontrada");
})();

const created = { customerIds: [], productIds: [], itemIds: [] };
let cookie = "";

async function api(method, url, body) {
  const r = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text}`);
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return text ? JSON.parse(text) : null;
}

const failures = [];
function check(label, condition, detail = "") {
  if (condition) console.log("ok", label);
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log("FALHOU", label, detail);
  }
}

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    if (created.productIds.length > 0) {
      await prisma.formulationVersion.deleteMany({
        where: { productId: { in: created.productIds } },
      });
      const produtos = await prisma.product.findMany({
        where: { id: { in: created.productIds } },
        select: { finishedProductItemId: true },
      });
      await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
      const itens = produtos
        .map((p) => p.finishedProductItemId)
        .filter((id) => id !== null);
      created.itemIds.push(...itens);
    }
    if (created.itemIds.length > 0) {
      await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    }
    if (created.customerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
}

let browser;

try {
  await api("POST", "/auth/login", credentials);

  // Nome fantasia distinto do da razão social: é por ele que a busca é feita.
  const cliente = await api("POST", "/customers", {
    legalName: `12.345.678 ROBERTA ALVES ${stamp}`,
    tradeName: `Vitalidade ${stamp}`,
  });
  created.customerIds.push(cliente.id);
  console.log("cliente:", cliente.code, "|", cliente.tradeName);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  };

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  // ── Fluxo 1 — Produto novo, PA automático ────────────────────────────
  await page.goto(`${WEB}/cadastros/produtos`, { waitUntil: "networkidle" });
  await page.locator(".page__header .btn--primary").first().click();
  await page.waitForSelector("#product-customer");

  check(
    "criação de Produto não oferece seletor de item de produto acabado",
    (await page.locator("#product-finished-item").count()) === 0,
  );
  check(
    "bloco Produto acabado / estoque está na tela",
    (await page.locator("text=Produto acabado / estoque").count()) > 0,
  );
  check(
    "a tela avisa que o item será criado ao salvar",
    (await page.locator("text=/criado automaticamente ao salvar/i").count()) > 0,
  );

  // Busca pelo nome fantasia — não pela razão social.
  await page.fill("#product-customer", `Vitalidade ${stamp}`);
  await page.waitForTimeout(600);
  await page.click(`text=ROBERTA ALVES ${stamp}`);
  await shot("49-produto-novo");

  const nomeProduto = `Coenzima Q10 ${stamp}`;
  await page.fill("#product-name", nomeProduto);
  await page.selectOption("#product-finished-unit", "un");
  await page.click('button:has-text("Criar produto"), button:has-text("Salvar")');
  await page.waitForTimeout(2000);

  const salvo = await api("GET", `/products?search=${encodeURIComponent(nomeProduto)}&pageSize=5`);
  const produto = salvo?.products?.[0];
  if (produto) created.productIds.push(produto.id);

  check("produto foi criado", Boolean(produto), JSON.stringify(salvo?.total));
  check("produto recebeu código PROD-", /^PROD-\d{6}$/.test(produto?.code ?? ""), produto?.code);
  check("produto ficou com o cliente escolhido", produto?.customerId === cliente.id);
  check(
    "item de produto acabado foi criado junto, com código PA-",
    /^PA-\d{6}$/.test(produto?.finishedProductItem?.code ?? ""),
    produto?.finishedProductItem?.code,
  );

  /*
   * Reabrir pelo caminho do usuário: buscar na lista e clicar na linha. A
   * tela de Produtos não tem deep link por id — usar um inventado provaria
   * só que o endereço não existe.
   */
  await page.goto(`${WEB}/cadastros/produtos`, { waitUntil: "networkidle" });
  await page.fill("#products-search", nomeProduto);
  await page.waitForTimeout(900);
  await page.click(`td:has-text("${produto.code}")`);
  await page.waitForSelector("#product-name");
  const corpo = await page.locator("body").innerText();
  check("produto reaberto mostra o item de produto acabado", corpo.includes(produto.finishedProductItem.code));
  check(
    "produto reaberto oferece o caminho para o estoque",
    (await page.locator('a:has-text("Ver estoque e lotes")').count()) > 0,
  );
  await shot("49-produto-salvo");

  // ── Itens de estoque — PA fora da criação normal ─────────────────────
  await page.goto(`${WEB}/cadastros/itens`, { waitUntil: "networkidle" });
  check(
    "a tela agora se chama Itens de estoque",
    (await page.locator("h1").first().innerText()).includes("Itens de estoque"),
  );
  await page.locator(".page__header .btn--primary").first().click();
  await page.waitForSelector("#item-type");
  const tipos = await page.locator("#item-type option").allTextContents();
  check(
    "Produto acabado não é oferecido na criação de item",
    !tipos.some((t) => t.trim() === "Produto acabado"),
    tipos.join(" | "),
  );
  check(
    "a tela diz onde o produto acabado nasce",
    (await page.locator("text=/criados automaticamente pelo cadastro de Produtos/i").count()) > 0,
  );
  await shot("49-item-novo");

  // O PA criado no fluxo 1 continua consultável na listagem.
  await page.goto(`${WEB}/cadastros/itens`, { waitUntil: "networkidle" });
  await page.fill("#items-search", produto.finishedProductItem.code);
  await page.waitForTimeout(1200);
  check(
    "o item criado pelo produto continua visível na listagem",
    (await page.locator("body").innerText()).includes(produto.finishedProductItem.code),
  );

  // ── Larguras de desktop ──────────────────────────────────────────────
  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1600, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${WEB}/cadastros/produtos`, { waitUntil: "networkidle" });
    await page.fill("#products-search", nomeProduto);
    await page.waitForTimeout(800);
    await page.click(`td:has-text("${produto.code}")`);
    await page.waitForSelector("#product-name");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check(`viewport ${width} sem rolagem horizontal`, !overflow);
    await shot(`49-produto-${width}`);
  }

  check("console do navegador limpo", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  if (browser) await browser.close();
  await cleanup();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} verificação(ões) falharam:`);
  for (const f of failures) console.log(" -", f);
  process.exit(1);
}
console.log("\nvalidate49: todas as verificações passaram.");
