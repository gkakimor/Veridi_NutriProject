import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual desktop da capacidade 37 (qualidade documental / CoA /
 * anexos).
 *
 * Monta o cenário via API e remove tudo no final — inclusive os arquivos
 * gravados no storage, que são puramente artificiais. Nenhum dado real do
 * corpus é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate37.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = {
  itemIds: [],
  customerIds: [],
  supplierIds: [],
  purchaseOrderIds: [],
  productIds: [],
  userIds: [],
  attachmentIds: [],
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

/** Upload multipart de um PDF sintético. */
async function uploadCoa(lotId, fileName) {
  const form = new FormData();
  form.append("documentType", "COA");
  form.append(
    "file",
    new Blob([Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "utf8")], {
      type: "application/pdf",
    }),
    fileName,
  );

  const response = await fetch(`${API}/lots/${lotId}/attachments`, {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`upload → ${response.status} ${text}`);
  const attachment = JSON.parse(text);
  created.attachmentIds.push(attachment.id);
  return attachment;
}

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    // Remove o arquivo físico junto com o registro: o cenário é artificial.
    const attachments = await prisma.attachment.findMany({
      where: {
        OR: [
          { id: { in: created.attachmentIds } },
          { lot: { itemId: { in: created.itemIds } } },
          { productId: { in: created.productIds } },
          { receipt: { purchaseOrderId: { in: created.purchaseOrderIds } } },
        ],
      },
    });
    const uploadDir = path.resolve("../.local-data/uploads");
    for (const attachment of attachments) {
      fs.rmSync(path.join(uploadDir, attachment.storageKey), { force: true });
    }
    await prisma.attachment.deleteMany({ where: { id: { in: attachments.map((row) => row.id) } } });

    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: created.itemIds } } });
    await prisma.receiptLine.deleteMany({ where: { itemId: { in: created.itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: created.itemIds } } });
    await prisma.receipt.deleteMany({
      where: {
        OR: [
          { customerId: { in: created.customerIds } },
          { purchaseOrderId: { in: created.purchaseOrderIds } },
        ],
      },
    });
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: created.purchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: created.purchaseOrderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: created.userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });

    console.log("cenário de validação removido — nenhum dado ou arquivo residual na base DEV");
  } finally {
    await prisma.$disconnect();
  }
}

const stamp = Date.now().toString().slice(-6);
let browser;

try {
  await api("POST", "/auth/login", credentials);

  const purchasingPassword = `compras-${stamp}-veridi`;
  const purchasing = await api("POST", "/users", {
    name: `Comprador Demo ${stamp}`,
    email: `compras-${stamp}@veridi.local`,
    password: purchasingPassword,
    role: "PURCHASING",
  });
  created.userIds.push(purchasing.id);

  const item = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Vitamina C CoA ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
    requiresCoa: true,
  });
  created.itemIds.push(item.id);

  const customer = await api("POST", "/customers", {
    legalName: `Alpha Nutrition CoA ${stamp}`,
    tradeName: "Alpha Nutrition",
  });
  created.customerIds.push(customer.id);

  // Recebimento por Ordem de Compra (fluxo tradicional).
  const supplier = await api("POST", "/suppliers", { legalName: `Fornecedor CoA ${stamp}` });
  created.supplierIds.push(supplier.id);
  const purchaseOrder = await api("POST", "/purchase-orders", {
    supplierId: supplier.id,
    orderDate: new Date().toISOString(),
    lines: [{ itemId: item.id, orderedQuantity: "40" }],
  });
  created.purchaseOrderIds.push(purchaseOrder.id);
  await api("POST", `/purchase-orders/${purchaseOrder.id}/confirm`);
  const receipt = await api("POST", `/purchase-orders/${purchaseOrder.id}/receipts`, {
    receivedAt: new Date().toISOString(),
    invoiceNumber: `NF-${stamp}`,
    lines: [
      {
        purchaseOrderLineId: purchaseOrder.lines[0].id,
        receivedQuantity: "40",
        supplierLot: `FAB-${stamp}`,
      },
    ],
  });
  const lotId = receipt.lines[0].lotId;

  // Recebimento de material do cliente — mesma exigência documental.
  const customerReceipt = await api("POST", "/receipts/customer-supplied", {
    customerId: customer.id,
    receivedAt: new Date().toISOString(),
    lines: [{ itemId: item.id, receivedQuantity: "15", supplierLot: `CLI-${stamp}` }],
  });
  console.log("lote do cliente CoA:", customerReceipt.lines[0].coaStatus);

  // Liberação antes da aprovação é recusada.
  const earlyRelease = await fetch(`${API}/lots/${lotId}/release`, {
    method: "POST",
    headers: { cookie: sessionCookie },
  });
  console.log("release antes do CoA:", earlyRelease.status, (await earlyRelease.text()).slice(0, 90));

  await uploadCoa(lotId, `laudo-${stamp}.pdf`);
  const afterUpload = await api("GET", `/lots/${lotId}`);
  console.log("após upload:", afterUpload.coaStatus);

  // Compras não aprova.
  const purchasingLogin = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: purchasing.email, password: purchasingPassword }),
  });
  const purchasingCookie = purchasingLogin.headers.get("set-cookie").split(";")[0];
  const forbidden = await fetch(`${API}/lots/${lotId}/coa/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: purchasingCookie },
    body: "{}",
  });
  console.log("Compras aprovando:", forbidden.status);

  await api("POST", `/lots/${lotId}/coa/approve`, { note: "Laudo conferido" });
  const released = await api("POST", `/lots/${lotId}/release`);
  console.log("após aprovação e liberação:", released.coaStatus, released.status);

  // Produto com arte anexada.
  const finishedItem = await api("POST", "/items", {
    type: "FINISHED_PRODUCT",
    name: `PA CoA ${stamp}`,
    unitCode: "un",
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: false,
  });
  created.itemIds.push(finishedItem.id);
  const product = await api("POST", "/products", {
    name: `Produto CoA ${stamp}`,
    finishedProductItemId: finishedItem.id,
    customerId: customer.id,
  });
  created.productIds.push(product.id);

  const artForm = new FormData();
  artForm.append("documentType", "LABEL_ART");
  artForm.append(
    "file",
    new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }),
    `arte-${stamp}.png`,
  );
  const artResponse = await fetch(`${API}/products/${product.id}/attachments`, {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: artForm,
  });
  created.attachmentIds.push((await artResponse.json()).id);

  const invoiceForm = new FormData();
  invoiceForm.append("documentType", "INVOICE");
  invoiceForm.append(
    "file",
    new Blob([Buffer.from("%PDF-1.4\n%%EOF\n", "utf8")], { type: "application/pdf" }),
    `nf-${stamp}.pdf`,
  );
  const invoiceResponse = await fetch(`${API}/receipts/${receipt.id}/attachments`, {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: invoiceForm,
  });
  created.attachmentIds.push((await invoiceResponse.json()).id);

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

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await shot("37-login");
  const loginErrors = [...errors];
  console.log(
    loginErrors.length === 0
      ? "console limpo na tela de Login"
      : `erros no Login: ${loginErrors.join(" | ")}`,
  );

  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  const visit = async (name, route) => {
    await page.goto(`${WEB}${route}`, { waitUntil: "networkidle" });
    await shot(name);
  };

  await visit("37-coa-queue", "/qualidade/documentos");
  await visit("37-lot-documents", `/estoque/lotes/${lotId}`);
  await visit("37-receipt-documents", `/compras/recebimentos/${receipt.id}`);
  await visit("37-items-coa", "/cadastros/itens");
  await visit("37-report-receipts", "/relatorios/compras/recebimentos");
  await visit("37-inventory-position", "/relatorios/estoque/posicao");

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
