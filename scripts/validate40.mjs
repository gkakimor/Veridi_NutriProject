import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual desktop da capacidade 40 (item × fornecedor, homologação,
 * MOQ e preços). Monta o cenário via API e remove tudo no final — as
 * relações e ofertas importadas do corpus não são tocadas.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate40.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = {
  itemIds: [],
  supplierIds: [],
  supplierItemIds: [],
  customerIds: [],
  customerOrderIds: [],
  productIds: [],
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
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { customerOrderId: { in: created.customerOrderIds } } },
    });
    await prisma.purchaseOrder.deleteMany({
      where: { customerOrderId: { in: created.customerOrderIds } },
    });
    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrder: { customerOrderId: { in: created.customerOrderIds } } },
      select: { id: true },
    });
    const reservationIds = reservations.map((row) => row.id);
    if (reservationIds.length > 0) {
      await prisma.materialReservationLine.deleteMany({
        where: { reservationId: { in: reservationIds } },
      });
      await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
    }
    await prisma.productionOrder.deleteMany({
      where: { customerOrderId: { in: created.customerOrderIds } },
    });
    await prisma.customerOrderLine.deleteMany({
      where: { customerOrderId: { in: created.customerOrderIds } },
    });
    await prisma.customerOrder.deleteMany({ where: { id: { in: created.customerOrderIds } } });

    await prisma.supplierItemOffer.deleteMany({
      where: { supplierItem: { itemId: { in: created.itemIds } } },
    });
    await prisma.supplierItemQualificationHistory.deleteMany({
      where: { supplierItem: { itemId: { in: created.itemIds } } },
    });
    await prisma.supplierItem.deleteMany({ where: { itemId: { in: created.itemIds } } });

    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: created.productIds } } },
    });
    await prisma.formulationVersion.deleteMany({
      where: { productId: { in: created.productIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });

    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: created.itemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: created.itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { supplierId: { in: created.supplierIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } });
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

  const item = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Vitamina C Sourcing ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
  });
  created.itemIds.push(item.id);

  const usdItem = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Colágeno Importado ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
  });
  created.itemIds.push(usdItem.id);

  const makeSupplier = async (name) => {
    const supplier = await api("POST", "/suppliers", { legalName: `${name} ${stamp}` });
    created.supplierIds.push(supplier.id);
    return supplier;
  };
  const supplierA = await makeSupplier("Purifarma Distribuidora");
  const supplierB = await makeSupplier("Caldic Brasil");
  const supplierC = await makeSupplier("Fornecedor Bloqueado");
  const supplierUsd = await makeSupplier("Global Ingredients Inc");

  const relate = async (itemId, supplierId, supplierItemCode) => {
    const relation = await api("POST", "/supplier-items", {
      itemId,
      supplierId,
      ...(supplierItemCode ? { supplierItemCode } : {}),
    });
    created.supplierItemIds.push(relation.id);
    return relation;
  };

  const relationA = await relate(item.id, supplierA.id, `VC-ASC-${stamp}`);
  const relationB = await relate(item.id, supplierB.id, `CAL-${stamp}`);
  const relationC = await relate(item.id, supplierC.id, null);
  const relationUsd = await relate(usdItem.id, supplierUsd.id, `GI-COL-${stamp}`);

  // Homologação é ato da Qualidade — mesmo o ADMIN passa pela mesma rota.
  const qualify = (id, status, note) =>
    api("POST", `/supplier-items/${id}/qualification`, { status, note });

  await qualify(relationA.id, "APPROVED", "Auditoria documental aprovada");
  await qualify(relationB.id, "APPROVED", "Segunda fonte homologada");
  await qualify(relationC.id, "BLOCKED", "Não conformidade recorrente");
  await qualify(relationUsd.id, "APPROVED", "Fornecedor internacional homologado");

  await api("POST", `/supplier-items/${relationA.id}/preferred`, { preferred: true });

  // Preço de referência + MOQ maior que a falta, para mostrar a recomendação.
  await api("POST", `/supplier-items/${relationA.id}/offers`, {
    unitPrice: "100",
    priceUomCode: "kg",
    minimumOrderQuantity: "25",
    minimumOrderUomCode: "kg",
    notes: "Cotação anual",
  });
  await api("POST", `/supplier-items/${relationA.id}/offers`, {
    unitPrice: "95.5",
    priceUomCode: "kg",
    minimumOrderQuantity: "25",
    minimumOrderUomCode: "kg",
    notes: "Renegociação — a oferta anterior continua no histórico",
  });
  // Preferencial NÃO muda porque o outro ficou mais barato.
  await api("POST", `/supplier-items/${relationB.id}/offers`, {
    unitPrice: "80",
    priceUomCode: "kg",
  });
  await api("POST", `/supplier-items/${relationUsd.id}/offers`, {
    unitPrice: "20",
    currencyCode: "USD",
    priceUomCode: "kg",
  });

  // Pedido com falta: 8 kg do item, para a Sugestão de Compra.
  const finishedItem = await api("POST", "/items", {
    type: "FINISHED_PRODUCT",
    name: `Produto Sourcing ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
  });
  created.itemIds.push(finishedItem.id);

  const product = await api("POST", "/products", {
    name: `Produto Sourcing ${stamp}`,
    finishedProductItemId: finishedItem.id,
  });
  created.productIds.push(product.id);

  const version = await api("POST", `/products/${product.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${version.id}`, {
    basisQuantity: "1",
    components: [
      { itemId: item.id, quantity: "8", unitCode: "kg" },
      { itemId: usdItem.id, quantity: "4", unitCode: "kg" },
    ],
  });
  await api("POST", `/formulation-versions/${version.id}/activate`);

  const customer = await api("POST", "/customers", {
    legalName: `Cliente Sourcing ${stamp}`,
    street: "Avenida Paulista",
    number: "1000",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310100",
  });
  created.customerIds.push(customer.id);

  const draftOrder = await api("POST", "/customer-orders", {
    customerId: customer.id,
    lines: [{ productId: product.id, orderedQuantity: "1" }],
  });
  created.customerOrderIds.push(draftOrder.id);
  const order = await api("POST", `/customer-orders/${draftOrder.id}/confirm`);
  await api("POST", `/customer-orders/${order.id}/apply-fulfillment-plan`, {
    lines: [{ customerOrderLineId: order.lines[0].id, reserveQuantity: "0", produceQuantity: "1" }],
  });

  const suggestion = await api("GET", `/customer-orders/${order.id}/purchase-suggestion`);
  const row = suggestion.rows.find((candidate) => candidate.itemId === item.id);
  console.log(
    "sugestão:",
    row.newSuggestedPurchase,
    "→ recomendado",
    row.supplierCandidates.find((c) => c.supplierItemId === row.recommendedSupplierItemId)
      ?.recommendedPurchaseQuantity,
  );

  const csv = await fetch(`${API}/supplier-items/export.csv?itemId=${item.id}`, {
    headers: { cookie: sessionCookie },
  });
  const csvBody = await csv.text();
  console.log(
    "CSV:",
    csv.status,
    csvBody.includes(item.code) ? "com o item" : "SEM o item",
    csvBody.includes(item.id) ? "COM UUID (erro)" : "sem UUID",
  );

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

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(`${WEB}/compras/item-fornecedor`, { waitUntil: "networkidle" });
  await shot("40-supplier-items-list");

  // Filtro: só homologados.
  await page.selectOption("#supplier-items-qualification", "APPROVED");
  await shot("40-supplier-items-filtered");

  // Busca pelo item do cenário e abertura do detalhe.
  await page.fill("#supplier-items-search", item.code);
  await page.waitForTimeout(800);
  await page.click(`text=${supplierA.legalName}`);
  await shot("40-supplier-item-detail");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.goto(`${WEB}/cadastros/itens`, { waitUntil: "networkidle" });
  await page.fill('input[type="search"]', item.code);
  await page.waitForTimeout(800);
  await page.click("text=Editar");
  await shot("40-item-suppliers");

  await page.keyboard.press("Escape");
  await page.goto(`${WEB}/cadastros/fornecedores`, { waitUntil: "networkidle" });
  await page.fill('input[type="search"]', supplierA.legalName);
  await page.waitForTimeout(800);
  await page.click("text=Editar");
  await shot("40-supplier-items-by-supplier");

  await page.keyboard.press("Escape");
  await page.goto(`${WEB}/comercial/pedidos/${order.id}`, { waitUntil: "networkidle" });
  await shot("40-purchase-suggestion");

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
