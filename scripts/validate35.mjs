import { chromium } from "@playwright/test";
import path from "node:path";

/**
 * Validação visual desktop da capacidade 35 (material de propriedade do
 * cliente). Monta um cenário próprio na base DEV via API e tira só as telas
 * essenciais para o handoff.
 */

const OUT = process.argv[2] ?? ".";
const API = "http://localhost:3333";

async function api(method, url, body) {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const stamp = Date.now().toString().slice(-6);

const customer = await api("POST", "/customers", {
  legalName: `Alpha Nutrition Demo ${stamp}`,
  tradeName: "Alpha Nutrition",
});

const capsule = await api("POST", "/items", {
  type: "PACKAGING",
  name: `Cápsula vegetal 00 (demo ${stamp})`,
  unitCode: "un",
  controlsLot: true,
  controlsExpiry: false,
  requiresQualityRelease: false,
});

const vitamin = await api("POST", "/items", {
  type: "RAW_MATERIAL",
  name: `Vitamina C demo ${stamp}`,
  unitCode: "kg",
  controlsLot: true,
  controlsExpiry: false,
  requiresQualityRelease: false,
});

// Material do cliente entra sem Ordem de Compra.
const receipt = await api("POST", "/receipts/customer-supplied", {
  customerId: customer.id,
  receivedAt: new Date().toISOString(),
  documentReference: `REMESSA-${stamp}`,
  lines: [
    { itemId: capsule.id, receivedQuantity: "8000", supplierLot: `FAB-${stamp}`, location: "Porta-pallet A1" },
  ],
});

// Estoque próprio da Veridi para o outro componente — entra por Ordem de
// Compra normal, o fluxo que já existia.
const supplier = await api("POST", "/suppliers", { legalName: `Fornecedor Demo ${stamp}` });
const purchaseOrder = await api("POST", "/purchase-orders", {
  supplierId: supplier.id,
  orderDate: new Date().toISOString(),
  lines: [{ itemId: vitamin.id, orderedQuantity: "20" }],
});
await api("POST", `/purchase-orders/${purchaseOrder.id}/confirm`);
await api("POST", `/purchase-orders/${purchaseOrder.id}/receipts`, {
  receivedAt: new Date().toISOString(),
  lines: [
    {
      purchaseOrderLineId: purchaseOrder.lines[0].id,
      receivedQuantity: "20",
      supplierLot: `LOTE-${stamp}`,
      actualUnitCost: "180",
    },
  ],
});

const finishedItem = await api("POST", "/items", {
  type: "FINISHED_PRODUCT",
  name: `Vitamina C 500mg 60 caps (demo ${stamp})`,
  unitCode: "un",
  controlsLot: true,
  controlsExpiry: true,
  requiresQualityRelease: false,
});

const product = await api("POST", "/products", {
  name: `Vitamina C 500mg 60 caps (demo ${stamp})`,
  finishedProductItemId: finishedItem.id,
  customerId: customer.id,
});

const version = await api("POST", `/products/${product.id}/formulation-versions`, {});
await api("PATCH", `/formulation-versions/${version.id}`, {
  basisQuantity: "1",
  components: [
    { itemId: vitamin.id, quantity: "0.001", unitCode: "kg", supplyResponsibility: "VERIDI" },
    { itemId: capsule.id, quantity: "1", unitCode: "un", supplyResponsibility: "CUSTOMER" },
  ],
});
await api("POST", `/formulation-versions/${version.id}/activate`);

const order = await api("POST", "/production-orders", {
  productId: product.id,
  plannedQuantity: "10000",
});
await api("POST", `/production-orders/${order.id}/plan`);

const lots = await api("GET", `/lots?itemId=${capsule.id}`);
const customerLot = lots.lots[0];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

async function shot(name, route, action) {
  await page.goto(`http://localhost:5173${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  if (action) await action();
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log("ok", name);
}

await shot("35-customer-materials", "/estoque/materiais-de-clientes");
await shot("35-lots-owner", "/estoque/lotes");
await shot("35-lot-detail-owner", `/estoque/lotes/${customerLot.id}`);
await shot("35-lot-label-owner", `/estoque/lotes/${customerLot.id}/etiqueta`);
await shot("35-receipt-customer", `/compras/recebimentos/${receipt.id}`);
await shot("35-receive-customer-form", "/compras/recebimentos/material-do-cliente");
await shot("35-formulation-supply", `/producao/formulacoes/${product.id}/versoes/${version.id}`);
await shot("35-production-order", `/producao/ordens/${order.id}`);

console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
for (const error of errors) console.log("  --", error);

console.log(
  JSON.stringify(
    { customerId: customer.id, productId: product.id, productionOrderId: order.id, receiptId: receipt.id },
    null,
    2,
  ),
);
await browser.close();
