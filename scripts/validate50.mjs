import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação da capacidade 50 — Consulta do Cliente com Produtos e Estoque,
 * breadcrumb canônico e ajuda contextual.
 *
 * Três coisas são provadas aqui e em nenhum teste unitário:
 *  1. o Cliente continua sendo a raiz ao percorrer Produtos e Estoque;
 *  2. lote de outro Cliente não aparece no estoque deste;
 *  3. fora da Consulta, a trilha vira a hierarquia canônica da tela.
 *
 * Cenário sintético, removido no final; o corpus real não é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate50.mjs handoff/screens
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

const created = { customerIds: [], productIds: [], itemIds: [], projectIds: [] };
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
    // Projeto referencia o cliente: sai antes, ou o DELETE do cliente
    // esbarra em `projects_customerId_fkey`.
    if (created.projectIds.length > 0) {
      await prisma.projectStatusHistory.deleteMany({
        where: { projectId: { in: created.projectIds } },
      });
      await prisma.project.deleteMany({ where: { id: { in: created.projectIds } } });
    }
    if (created.productIds.length > 0) {
      await prisma.formulationVersion.deleteMany({
        where: { productId: { in: created.productIds } },
      });
      const produtos = await prisma.product.findMany({
        where: { id: { in: created.productIds } },
        select: { finishedProductItemId: true },
      });
      await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
      created.itemIds.push(
        ...produtos.map((p) => p.finishedProductItemId).filter((id) => id !== null),
      );
    }
    if (created.itemIds.length > 0) {
      await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: created.itemIds } } });
      await prisma.lot.deleteMany({ where: { itemId: { in: created.itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    }
    if (created.customerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Lote de propriedade do CLIENTE + entrada no ledger. */
async function loteDoCliente(prisma, itemId, customerId, quantidade, code) {
  const lot = await prisma.lot.create({
    data: {
      code,
      itemId,
      initialReceivedQuantity: quantidade,
      status: "AVAILABLE",
      ownerType: "CUSTOMER",
      ownerCustomerId: customerId,
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "RECEIPT_IN",
      quantity: quantidade,
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "validate50",
    },
  });
  return lot;
}

let browser;

try {
  await api("POST", "/auth/login", credentials);
  const prisma = new PrismaClient();

  // ── Fixture ───────────────────────────────────────────────────────────
  const clienteA = await api("POST", "/customers", {
    legalName: `Aurora Nutrição ${stamp}`,
    tradeName: `Aurora ${stamp}`,
  });
  const clienteB = await api("POST", "/customers", {
    legalName: `Boreal Suplementos ${stamp}`,
    tradeName: `Boreal ${stamp}`,
  });
  created.customerIds.push(clienteA.id, clienteB.id);

  const produtos = [];
  for (const nome of ["Coenzima Q10", "Biotina"]) {
    const p = await api("POST", "/products", {
      customerId: clienteA.id,
      name: `${nome} ${stamp}`,
      finishedUnitCode: "un",
    });
    created.productIds.push(p.id);
    produtos.push(p);
  }
  // Produto do Cliente B — o que NÃO pode aparecer sob o Cliente A.
  const produtoB = await api("POST", "/products", {
    customerId: clienteB.id,
    name: `Creatina ${stamp}`,
    finishedUnitCode: "un",
  });
  created.productIds.push(produtoB.id);

  // Estoque de acabado do primeiro produto de A.
  const paDeA = produtos[0].finishedProductItem;
  await prisma.$transaction(async (tx) => {
    const lote = await tx.lot.create({
      data: {
        code: `LT-PA-${stamp}`.toUpperCase(),
        origin: "RECEIPT",
        itemId: paDeA.id,
        initialReceivedQuantity: "250",
        status: "AVAILABLE",
      },
    });
    await tx.inventoryMovement.create({
      data: {
        itemId: paDeA.id,
        lotId: lote.id,
        type: "FINISHED_GOOD_PRODUCTION",
        quantity: "250",
        occurredAt: new Date(),
        sourceType: "FINISHED_GOOD_PRODUCTION",
        createdBy: "validate50",
      },
    });
  });

  // Material do cliente: um lote para cada, para o isolamento ter o que provar.
  const insumo = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Insumo Consulta ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(insumo.id);
  const loteA = await loteDoCliente(prisma, insumo.id, clienteA.id, "40", `LT-A-${stamp}`.toUpperCase());
  const loteB = await loteDoCliente(prisma, insumo.id, clienteB.id, "25", `LT-B-${stamp}`.toUpperCase());
  await prisma.$disconnect();

  console.log("fixture:", clienteA.code, "e", clienteB.code);

  // ── Navegação ─────────────────────────────────────────────────────────
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
  const cabecalhoDizA = async () =>
    ((await page.locator(".consult-head h1").first().textContent()) ?? "").includes(
      clienteA.legalName,
    );

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  // ── Consulta: Produtos ───────────────────────────────────────────────
  await page.goto(`${WEB}/consultas/clientes/${clienteA.id}/produtos`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('td.is-code:has-text("PROD-")');
  const codigos = await page.locator('td.is-code:has-text("PROD-")').allTextContents();
  check("aba Produtos lista os 2 produtos do cliente", codigos.length === 2, `${codigos}`);
  check(
    "produto do outro cliente não aparece",
    !codigos.includes(produtoB.code),
    produtoB.code,
  );
  await shot("50-produtos");

  await page.click(`text=${codigos[0]}`);
  await page.waitForSelector(".doc-title h1");
  check("detalhe do Produto 1 mantém o cliente", await cabecalhoDizA());

  // Trilha contextual volta para os produtos DAQUELE cliente.
  await page.click('.consult-trail a:has-text("Produtos")');
  await page.waitForSelector('td.is-code:has-text("PROD-")');
  await page.click(`text=${codigos[1]}`);
  await page.waitForSelector(".doc-title h1");
  check("trocar para o Produto 2 mantém o cliente", await cabecalhoDizA());
  await shot("50-produto-detalhe");

  // ── Consulta: Estoque ────────────────────────────────────────────────
  await page.click('.consult-tabs__link:has-text("Estoque")');
  await page.waitForURL(/\/estoque/);
  await page.waitForTimeout(900);
  const acabados = await page.locator("body").innerText();
  check("estoque de acabado mostra o PA do cliente", acabados.includes(paDeA.code), paDeA.code);
  check("estoque de acabado mostra o saldo", acabados.includes("250"));
  check("subnav de estoque tem as duas visões", acabados.includes("Materiais do cliente"));
  await shot("50-estoque-acabados");

  await page.click('.consult-tabs__link:has-text("Materiais do cliente")');
  await page.waitForURL(/\/estoque\/materiais/);
  await page.waitForTimeout(900);
  const materiais = await page.locator("body").innerText();
  check("material do próprio cliente aparece", materiais.includes(loteA.code));
  check("lote do outro cliente NÃO aparece", !materiais.includes(loteB.code), loteB.code);
  check("materiais continuam sob o cliente", await cabecalhoDizA());
  await shot("50-estoque-materiais");

  // ── Fora da Consulta: breadcrumb canônico ────────────────────────────
  const projeto = await api("POST", "/projects", {
    customerId: clienteA.id,
    name: `Projeto Trilha ${stamp}`,
  });
  created.projectIds.push(projeto.id);
  await page.goto(`${WEB}/comercial/projetos/${projeto.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const trilhaProjeto = await page.locator(".page-crumbs").first().innerText();
  check(
    "tela de Projeto usa a trilha canônica Projetos > PROJ-…",
    trilhaProjeto.includes("Projetos") && trilhaProjeto.includes(projeto.code),
    trilhaProjeto,
  );
  check(
    "o nível anterior da trilha é link de verdade",
    (await page.locator('.page-crumbs a:has-text("Projetos")').count()) > 0,
  );
  await shot("50-breadcrumb-projeto");

  // ── Ajuda contextual ─────────────────────────────────────────────────
  const abrirAjuda = async (rotulo) => {
    const botao = page.locator('.context-help button, button:has-text("Como funciona")').first();
    if ((await botao.count()) === 0) return false;
    await botao.click();
    await page.waitForTimeout(400);
    const texto = await page.locator("body").innerText();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return texto.length > 0;
  };

  /*
   * A ajuda do Pedido vive dentro do Plano de Atendimento, que só aparece
   * em pedido confirmado. Num rascunho a seção inteira não existe — e a
   * ausência do painel ali não é defeito.
   */
  // `showPlan` exige status CONFIRMED — em IN_FULFILLMENT o plano já foi
  // aplicado e a seção dá lugar à Sugestão de Compra.
  const comPlano = await api("GET", "/customer-orders?status=CONFIRMED&pageSize=1");
  const confirmado = comPlano?.customerOrders?.[0];
  if (confirmado) {
    await page.goto(`${WEB}/comercial/pedidos/${confirmado.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    check("Plano de Atendimento tem ajuda contextual", await abrirAjuda("plano"));
    await shot("50-ajuda-pedido");
  } else {
    console.log("-- sem pedido confirmado na base: ajuda do Plano não verificada");
  }

  const opExistente = await api("GET", "/production-orders?pageSize=1");
  if (opExistente?.productionOrders?.[0]) {
    await page.goto(`${WEB}/producao/ordens/${opExistente.productionOrders[0].id}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(900);
    check("Ordem de Produção tem ajuda contextual", await abrirAjuda("op"));
  }

  const faturamento = await api("GET", "/billings?pageSize=1");
  if (faturamento?.billings?.[0]) {
    await page.goto(`${WEB}/comercial/faturamento/${faturamento.billings[0].id}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(900);
    check("Faturamento tem ajuda contextual", await abrirAjuda("faturamento"));
    await shot("50-ajuda-faturamento");
  }

  // ── Larguras de desktop ──────────────────────────────────────────────
  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1600, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${WEB}/consultas/clientes/${clienteA.id}/estoque/acabados`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check(`viewport ${width} sem rolagem horizontal`, !overflow);
    await shot(`50-estoque-${width}`);
  }

  check("console do navegador limpo", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  if (browser) await browser.close();
  await cleanup();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} verificação(ões) falharam:`);
  for (const f of failures) console.log(" -", f);
  process.exit(1);
}
console.log("\nvalidate50: todas as verificações passaram.");
