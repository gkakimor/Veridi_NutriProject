import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// `@prisma/client` está no workspace da API, não na raiz.
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual desktop da capacidade 36 (GMP: usuários, documentos
 * controlados, OP industrial e Folha de Receita).
 *
 * Igual ao validador da 35: monta o cenário via API e **remove tudo no
 * final** — nada de resíduo na base DEV. Credencial do ADMIN local vem de
 * `.local-data/dev-admin.json` (fora do repositório).
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate36.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
// Mesmo host da API (127.0.0.1): o cookie de sessão é first-party só
// quando a página e a API compartilham o host — `localhost` e `127.0.0.1`
// são hosts diferentes para o navegador.
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentialsPath = new URL("../../.local-data/dev-admin.json", import.meta.url);
const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));

const created = {
  productionOrderIds: [],
  productIds: [],
  itemIds: [],
  customerIds: [],
  supplierIds: [],
  purchaseOrderIds: [],
  userIds: [],
  revisionIds: [],
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

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    const { productionOrderIds, productIds, itemIds, customerIds, supplierIds, purchaseOrderIds } =
      created;

    const parts = await prisma.productionOrderPart.findMany({
      where: { productionOrderId: { in: productionOrderIds } },
      select: { id: true },
    });
    await prisma.recipeWeighing.deleteMany({
      where: { productionOrderPartId: { in: parts.map((row) => row.id) } },
    });
    await prisma.productionOrderPart.deleteMany({
      where: { productionOrderId: { in: productionOrderIds } },
    });

    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: productionOrderIds } },
      select: { id: true },
    });
    await prisma.inventoryMovement.deleteMany({
      where: { productionConsumption: { productionOrderId: { in: productionOrderIds } } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: productionOrderIds } },
    });
    await prisma.materialReservationLine.deleteMany({
      where: { reservationId: { in: reservations.map((row) => row.id) } },
    });
    await prisma.materialReservation.deleteMany({
      where: { id: { in: reservations.map((row) => row.id) } },
    });
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: productionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: productionOrderIds } } });

    const versions = await prisma.formulationVersion.findMany({
      where: { productId: { in: productIds } },
      select: { id: true },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersionId: { in: versions.map((row) => row.id) } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });

    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.receiptLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.receipt.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: purchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrderIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });

    await prisma.userSession.deleteMany({ where: { userId: { in: created.userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.controlledDocumentRevision.deleteMany({
      where: { id: { in: created.revisionIds } },
    });

    console.log("cenário de validação removido — nenhum dado persistente deixado na base DEV");
  } finally {
    await prisma.$disconnect();
  }
}

const stamp = Date.now().toString().slice(-6);
let browser;

try {
  await api("POST", "/auth/login", {
    email: credentials.email,
    password: credentials.password,
  });

  const operator = await api("POST", "/users", {
    name: `Operador Demo ${stamp}`,
    email: `operador-${stamp}@veridi.local`,
    password: `demo-${stamp}-veridi`,
    role: "PRODUCTION",
  });
  created.userIds.push(operator.id);

  const revisionPro = await api("POST", "/controlled-documents", {
    type: "PRODUCTION_ORDER",
    revision: `D${stamp}`,
    revisionDate: new Date().toISOString(),
    activate: true,
  });
  created.revisionIds.push(revisionPro.id);
  const revisionCoq = await api("POST", "/controlled-documents", {
    type: "RECIPE_SHEET",
    revision: `D${stamp}`,
    revisionDate: new Date().toISOString(),
    activate: true,
  });
  created.revisionIds.push(revisionCoq.id);

  const customer = await api("POST", "/customers", {
    legalName: `Alpha Nutrition GMP ${stamp}`,
    tradeName: "Alpha Nutrition",
    street: "Avenida Paulista",
    number: "1000",
    district: "Bela Vista",
    zipCode: "01310100",
    city: "São Paulo",
    state: "SP",
    businessLotSuffix: "A3",
  });
  created.customerIds.push(customer.id);

  const vitamin = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Vitamina C GMP ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(vitamin.id);

  const excipient = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Celulose microcristalina GMP ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(excipient.id);

  const capsule = await api("POST", "/items", {
    type: "PACKAGING",
    name: `Cápsula vegetal GMP ${stamp}`,
    unitCode: "un",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(capsule.id);

  const supplier = await api("POST", "/suppliers", { legalName: `Fornecedor GMP ${stamp}` });
  created.supplierIds.push(supplier.id);
  const purchaseOrder = await api("POST", "/purchase-orders", {
    supplierId: supplier.id,
    orderDate: new Date().toISOString(),
    lines: [
      { itemId: vitamin.id, orderedQuantity: "40" },
      { itemId: excipient.id, orderedQuantity: "40" },
      { itemId: capsule.id, orderedQuantity: "20000" },
    ],
  });
  created.purchaseOrderIds.push(purchaseOrder.id);
  await api("POST", `/purchase-orders/${purchaseOrder.id}/confirm`);
  await api("POST", `/purchase-orders/${purchaseOrder.id}/receipts`, {
    receivedAt: new Date().toISOString(),
    lines: purchaseOrder.lines.map((line) => ({
      purchaseOrderLineId: line.id,
      receivedQuantity: line.orderedQuantity,
      supplierLot: `LOTE-${stamp}`,
    })),
  });

  const finishedItem = await api("POST", "/items", {
    type: "FINISHED_PRODUCT",
    name: `Vitamina C 500mg 60 caps GMP ${stamp}`,
    unitCode: "un",
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: false,
  });
  created.itemIds.push(finishedItem.id);

  const product = await api("POST", "/products", {
    name: `Vitamina C 500mg 60 caps GMP ${stamp}`,
    finishedProductItemId: finishedItem.id,
    customerId: customer.id,
    shelfLifeMonths: 24,
    businessLotCode: "0340",
  });
  created.productIds.push(product.id);

  const version = await api("POST", `/products/${product.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${version.id}`, {
    basisQuantity: "1",
    components: [
      { itemId: vitamin.id, quantity: "0.0005", unitCode: "kg" },
      { itemId: excipient.id, quantity: "0.0003", unitCode: "kg" },
      { itemId: capsule.id, quantity: "1", unitCode: "un" },
    ],
  });
  await api("POST", `/formulation-versions/${version.id}/activate`);

  const order = await api("POST", "/production-orders", {
    productId: product.id,
    plannedQuantity: "12000",
    numberOfParts: 3,
    labelInstructions: "Lote em duas linhas, rótulo azul",
  });
  created.productionOrderIds.push(order.id);
  await api("POST", `/production-orders/${order.id}/plan`);
  const released = await api("POST", `/production-orders/${order.id}/release`);
  console.log("OP oficial:", released.officialNumber);

  const recipe = await api("GET", `/production-orders/${order.id}/recipe`);
  const firstRequirement = recipe.parts[0].requirements[0];
  const lotCode = firstRequirement.reservedLots[0].lotCode;

  await api("POST", `/production-orders/${order.id}/parts/1/weighings`, {
    requirementId: firstRequirement.requirementId,
    lotCode,
    actualQuantity: firstRequirement.plannedQuantity,
    notes: "Pesagem conferida na balança 1",
  });

  // Lote de outro material não serve para este requirement — o backend recusa.
  const wrongLot = recipe.parts[0].requirements[1].reservedLots[0].lotCode;
  const rejected = await fetch(
    `${API}/production-orders/${order.id}/parts/1/weighings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({
        requirementId: firstRequirement.requirementId,
        lotCode: wrongLot,
        actualQuantity: "1",
      }),
    },
  );
  console.log("pesagem com lote errado:", rejected.status, (await rejected.text()).slice(0, 120));

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const shot = async (name) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log("ok", name);
  };

  // 1. Login pela própria tela — a sessão do browser nasce aqui.
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await shot("36-login");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  const visit = async (name, route) => {
    await page.goto(`${WEB}${route}`, { waitUntil: "networkidle" });
    await shot(name);
  };

  await visit("36-users", "/administracao/usuarios");
  await visit("36-controlled-documents", "/administracao/documentos");
  await visit("36-production-order", `/producao/ordens/${order.id}`);
  await visit("36-recipe-sheet", `/producao/ordens/${order.id}/receita`);
  await visit("36-print-production-order", `/producao/ordens/${order.id}/imprimir`);
  await visit("36-print-recipe-sheet", `/producao/ordens/${order.id}/receita/imprimir`);
  await visit("36-product-business-lot", "/cadastros/produtos");

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
