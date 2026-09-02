import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação da capacidade 48 — CONSULTA DO CLIENTE.
 *
 * O que este roteiro prova não é que as telas carregam: é que o CLIENTE
 * nunca some. Ele percorre projetos, troca de projeto pela trilha, abre
 * pedido, materiais e faturamento, dá refresh e usa o Voltar do navegador —
 * e a cada passo confere que o cabeçalho ainda diz o mesmo cliente.
 *
 * Dois clientes com a mesma forma de dados, porque um cliente sozinho passa
 * em qualquer filtro, inclusive num quebrado: o lote do Cliente B tem que
 * estar ausente da consulta do Cliente A.
 *
 * Cenário sintético, removido no final; o corpus real não é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate48.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const stamp = Date.now().toString(36);

/**
 * Credencial de desenvolvimento, fora do versionamento (`.local-data/`).
 *
 * Os dois caminhos existem em máquinas diferentes: o de dentro do repositório
 * é o atual; o de fora é onde scripts mais antigos guardavam o admin. Tentar
 * os dois evita um 401 que parece defeito da feature e é só o arquivo em
 * outro lugar.
 */
const credentials = (() => {
  for (const relative of ["../.local-data/dev-admin.json", "../../.local-data/dev-admin.json"]) {
    const file = new URL(relative, import.meta.url);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  throw new Error("Credencial de desenvolvimento não encontrada em .local-data/dev-admin.json");
})();

const created = { customerIds: [], projectIds: [], productIds: [], itemIds: [], orderIds: [] };
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

const failures = [];
function check(label, condition, detail = "") {
  if (condition) {
    console.log("ok", label);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log("FALHOU", label, detail);
  }
}

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    if (created.orderIds.length > 0) {
      const inOrders = { in: created.orderIds };
      await prisma.billingLine.deleteMany({ where: { billing: { customerOrderId: inOrders } } });
      await prisma.billing.deleteMany({ where: { customerOrderId: inOrders } });
      await prisma.shipmentLine.deleteMany({ where: { shipment: { customerOrderId: inOrders } } });
      await prisma.shipment.deleteMany({ where: { customerOrderId: inOrders } });
      await prisma.productionOrder.deleteMany({ where: { customerOrderId: inOrders } });
      await prisma.customerOrderReservationLine.deleteMany({
        where: { reservation: { customerOrderId: inOrders } },
      });
      await prisma.customerOrderReservation.deleteMany({ where: { customerOrderId: inOrders } });
      await prisma.customerOrder.deleteMany({ where: { id: inOrders } });
    }
    if (created.projectIds.length > 0) {
      await prisma.quoteVersion.deleteMany({ where: { projectId: { in: created.projectIds } } });
      await prisma.projectStatusHistory.deleteMany({
        where: { projectId: { in: created.projectIds } },
      });
      await prisma.project.deleteMany({ where: { id: { in: created.projectIds } } });
    }
    if (created.productIds.length > 0) {
      await prisma.formulationVersion.deleteMany({
        where: { productId: { in: created.productIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
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

/** Lote de propriedade do CLIENTE + entrada no ledger — mesmo caminho do sistema. */
async function receiveCustomerLot(prisma, itemId, customerId, quantity, code) {
  const lot = await prisma.lot.create({
    data: {
      code,
      itemId,
      initialReceivedQuantity: quantity,
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
      quantity,
      occurredAt: new Date(),
      sourceType: "RECEIPT",
      createdBy: "validate48",
    },
  });
  return lot;
}

async function stockFinishedLot(prisma, itemId, quantity, code) {
  const lot = await prisma.lot.create({
    data: {
      code,
      origin: "RECEIPT",
      itemId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity,
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "validate48",
    },
  });
  return lot;
}

let browser;

try {
  await api("POST", "/auth/login", credentials);
  const prisma = new PrismaClient();

  // ── Fixture ───────────────────────────────────────────────
  const customerA = await api("POST", "/customers", {
    legalName: `Vida Saudável Consulta ${stamp}`,
    tradeName: `Vida Saudável ${stamp}`,
  });
  created.customerIds.push(customerA.id);
  const customerB = await api("POST", "/customers", {
    legalName: `Nutri Rival Consulta ${stamp}`,
    tradeName: `Nutri Rival ${stamp}`,
  });
  created.customerIds.push(customerB.id);

  for (const [customerId, count] of [
    [customerA.id, 2],
    [customerB.id, 1],
  ]) {
    for (let index = 0; index < count; index += 1) {
      const project = await api("POST", "/projects", {
        customerId,
        name: `Projeto Consulta ${stamp}-${index + 1}`,
        concept: "Detox",
        channel: "Distribuidora",
      });
      created.projectIds.push(project.id);
    }
  }

  // Um lote CUSTOMER para cada cliente: o do B é o que NÃO pode aparecer.
  const rawItem = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Insumo Consulta ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(rawItem.id);
  const lotA = await receiveCustomerLot(
    prisma,
    rawItem.id,
    customerA.id,
    "40",
    `LT-A-${stamp}`.toUpperCase(),
  );
  const lotB = await receiveCustomerLot(
    prisma,
    rawItem.id,
    customerB.id,
    "25",
    `LT-B-${stamp}`.toUpperCase(),
  );

  const finishedItem = await api("POST", "/items", {
    type: "FINISHED_PRODUCT",
    name: `Acabado Consulta ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(finishedItem.id);
  await stockFinishedLot(prisma, finishedItem.id, "200", `LT-PA-${stamp}`.toUpperCase());

  const product = await api("POST", "/products", {
    name: `Produto Consulta ${stamp}`,
    finishedProductItemId: finishedItem.id,
  });
  created.productIds.push(product.id);

  // Dois pedidos para o Cliente A; o primeiro vai até o Faturamento.
  const orders = [];
  for (const quantity of ["10", "5"]) {
    const order = await api("POST", "/customer-orders", {
      customerId: customerA.id,
      lines: [{ productId: product.id, orderedQuantity: quantity }],
    });
    created.orderIds.push(order.id);
    orders.push(order);
  }

  const confirmed = await api("POST", `/customer-orders/${orders[0].id}/confirm`);
  await api("POST", `/customer-orders/${orders[0].id}/apply-fulfillment-plan`, {
    lines: [
      { customerOrderLineId: confirmed.lines[0].id, reserveQuantity: "10", produceQuantity: "0" },
    ],
  });
  const draft = await api("POST", `/customer-orders/${orders[0].id}/shipments`);
  const shipment = await api("GET", `/shipments/${draft.id}`);
  for (const line of shipment.lines) {
    if (!line.requiresVerification) continue;
    await api("POST", `/shipments/${draft.id}/lines/${line.id}/verify`, { lotCode: line.lotCode });
  }
  const confirmedShipment = await api("POST", `/shipments/${draft.id}/confirm`);
  const billing = await api("POST", "/billings", { shipmentId: confirmedShipment.id });
  await prisma.$disconnect();

  console.log("fixture:", customerA.code, "e", customerB.code, "| faturamento", billing.code);

  // ── Navegação ─────────────────────────────────────────────
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const shot = async (name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };

  /** O cabeçalho persistente é a promessa da capacidade: ele é conferido a cada passo. */
  const headerSaysA = async () => {
    const heading = await page.locator(".consult-head h1").first().textContent();
    return (heading ?? "").includes(customerA.legalName);
  };

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  // 1. Busca e seleção
  await page.goto(`${WEB}/consultas/clientes`, { waitUntil: "networkidle" });
  await page.fill("#consultation-search", customerA.code);
  await page.waitForTimeout(700);
  await page.click(`text=${customerA.code}`);
  await page.waitForURL(/\/consultas\/clientes\/.+\/resumo/);
  check("busca e seleção abrem o cliente", await headerSaysA());
  await shot("48-resumo");

  // 2. Projetos e troca de projeto pela trilha
  await page.click('.consult-tabs__link:has-text("Projetos")');
  await page.waitForURL(/\/projetos$/);
  /*
   * Esperar por "uma linha qualquer" não serve: ao trocar de aba a tabela
   * ANTERIOR ainda está montada por um instante, e a leitura pegaria os
   * códigos da aba de onde se veio. A espera é pelo prefixo do que se foi
   * buscar.
   */
  await page.waitForSelector('td.is-code:has-text("PROJ-")');
  const projectCodes = await page
    .locator('td.is-code:has-text("PROJ-")')
    .allTextContents();
  check("aba Projetos lista os 2 projetos do cliente", projectCodes.length === 2, `${projectCodes}`);

  await page.click(`text=${projectCodes[0]}`);
  await page.waitForURL(/\/projetos\/.+/);
  await page.waitForSelector(`.doc-title h1:has-text("${projectCodes[0]}")`);
  check("detalhe do Projeto 1 mantém o cliente", await headerSaysA());
  await shot("48-projeto-1");

  // 3. Refresh no detalhe: a URL é o contexto
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".doc-title h1");
  check("refresh no detalhe mantém cliente e projeto", await headerSaysA());
  check(
    "refresh mantém o projeto aberto",
    (await page.locator(".doc-title h1").first().textContent()).includes(projectCodes[0]),
  );

  // 4. Trilha volta para os projetos DAQUELE cliente
  await page.click('.consult-trail a:has-text("Projetos")');
  await page.waitForURL(/\/projetos$/);
  await page.waitForSelector('td.is-code:has-text("PROJ-")');
  check("trilha volta para os projetos do cliente", await headerSaysA());

  await page.click(`text=${projectCodes[1]}`);
  await page.waitForURL(/\/projetos\/.+/);
  await page.waitForSelector(`.doc-title h1:has-text("${projectCodes[1]}")`);
  check("trocar para o Projeto 2 mantém o cliente", await headerSaysA());
  await shot("48-projeto-2");

  // 5. Voltar do navegador
  await page.goBack({ waitUntil: "networkidle" });
  check("Voltar do navegador mantém o contexto", await headerSaysA());
  check("Voltar leva à lista de projetos", /\/projetos$/.test(page.url()), page.url());

  // 6. Pedidos
  await page.click('.consult-tabs__link:has-text("Pedidos")');
  await page.waitForURL(/\/pedidos$/);
  await page.waitForSelector('td.is-code:has-text("PED-")');
  const orderCodes = await page.locator('td.is-code:has-text("PED-")').allTextContents();
  check("aba Pedidos lista os 2 pedidos do cliente", orderCodes.length === 2, `${orderCodes}`);
  await page.click(`text=${orderCodes[0]}`);
  await page.waitForURL(/\/pedidos\/.+/);
  await page.waitForSelector(".doc-title h1");
  check("detalhe do Pedido mantém o cliente", await headerSaysA());
  await shot("48-pedido");

  await page.goBack({ waitUntil: "networkidle" });
  check("voltar do Pedido mantém o cliente", await headerSaysA());

  // 7. Materiais — o lote do Cliente B não pode aparecer
  await page.click('.consult-tabs__link:has-text("Materiais do cliente")');
  await page.waitForURL(/\/materiais$/);
  await page.waitForSelector(`td.is-code:has-text("${lotA.code}")`);
  const materialText = await page.locator(".table-container").first().innerText();
  check("material do próprio cliente aparece", materialText.includes(lotA.code));
  check("lote do outro cliente NÃO aparece", !materialText.includes(lotB.code), lotB.code);
  await shot("48-materiais");

  // 8. Faturamentos e a saída explícita para o módulo
  await page.click('.consult-tabs__link:has-text("Faturamentos")');
  await page.waitForURL(/\/faturamentos$/);
  await page.waitForSelector(`td.is-code:has-text("${billing.code}")`);
  await page.click(`text=${billing.code}`);
  await page.waitForURL(/\/faturamentos\/.+/);
  await page.waitForSelector(".doc-title h1");
  check("detalhe do Faturamento mantém o cliente", await headerSaysA());
  await shot("48-faturamento");

  await page.click('a:has-text("Abrir faturamento completo")');
  await page.waitForURL(/\/comercial\/faturamento\/.+/);
  check(
    "só a ação explícita sai da Consulta para o módulo",
    /\/comercial\/faturamento\//.test(page.url()) && !/\/consultas\//.test(page.url()),
    page.url(),
  );
  /*
   * A URL muda antes do render: sem esperar o shell sair do DOM, a conferência
   * ainda enxergaria o cabeçalho da Consulta na tela do módulo.
   */
  await page.waitForSelector(".consult-head", { state: "detached" });
  check(
    "fora da Consulta o cabeçalho do cliente não existe mais",
    (await page.locator(".consult-head").count()) === 0,
  );

  /*
   * Daqui em diante o roteiro provoca 404 DE PROPÓSITO, então o console
   * limpo é conferido aqui — depois disso, um 404 é o resultado esperado.
   */
  check("console do navegador limpo no fluxo normal", consoleErrors.length === 0, consoleErrors.join(" | "));
  const errorsBeforeExpected404 = consoleErrors.length;

  // 9. Entidade de outro cliente sob este cabeçalho
  const foreignProject = await api("GET", `/projects?customerId=${customerB.id}`);
  await page.goto(
    `${WEB}/consultas/clientes/${customerA.id}/projetos/${foreignProject.projects[0].id}`,
    { waitUntil: "networkidle" },
  );
  check(
    "projeto de outro cliente é recusado no shell",
    (await page.locator("body").innerText()).includes("não encontrado neste cliente"),
  );
  check("a recusa acontece DENTRO da consulta do cliente certo", await headerSaysA());
  await shot("48-outro-cliente");

  // 10. Desktop: as três larguras do handoff
  for (const width of [1280, 1366, 1600]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : width === 1366 ? 768 : 900 });
    await page.goto(`${WEB}/consultas/clientes/${customerA.id}/resumo`, {
      waitUntil: "networkidle",
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check(`viewport ${width} sem rolagem horizontal`, !overflow);
    await shot(`48-resumo-${width}`);
  }

  /*
   * O único ruído aceitável no console é o 404 que o próprio roteiro pediu ao
   * abrir o projeto de outro cliente — e ele aparece duas vezes porque o
   * StrictMode do React monta o efeito duas vezes em desenvolvimento.
   */
  const extraErrors = consoleErrors
    .slice(errorsBeforeExpected404)
    .filter((message) => !message.includes("404"));
  check("nenhum erro de console além do 404 esperado", extraErrors.length === 0, extraErrors.join(" | "));
} finally {
  if (browser) await browser.close();
  await cleanup();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} verificação(ões) falharam:`);
  for (const failure of failures) console.log(" -", failure);
  process.exit(1);
}
console.log("\nvalidate48: todas as verificações passaram.");
