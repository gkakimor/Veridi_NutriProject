import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

// `@prisma/client` está no workspace da API, não na raiz.
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual desktop da capacidade 35 (material de propriedade do
 * cliente).
 *
 * O cenário é montado via API na base DEV e **removido no final**: um
 * validador não pode deixar resíduo. Só são apagados os registros que este
 * script criou (ids coletados em `created`) — nada do corpus real é tocado.
 *
 * Rodar com o `.env` carregado (o cleanup usa Prisma direto):
 *   pnpm exec dotenv -e .env -- node scripts/validate35.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://localhost:3333";

const created = {
  productionOrderIds: [],
  productIds: [],
  itemIds: [],
  customerIds: [],
  supplierIds: [],
  purchaseOrderIds: [],
  receiptIds: [],
};

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

/** Apaga o grafo criado por este script, do mais dependente para o menos. */
async function cleanup() {
  const prisma = new PrismaClient();
  try {
    const { productionOrderIds, productIds, itemIds, customerIds, supplierIds, purchaseOrderIds } =
      created;

    const reservations = await prisma.materialReservation.findMany({
      where: { productionOrderId: { in: productionOrderIds } },
      select: { id: true },
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
    await prisma.receipt.deleteMany({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          { purchaseOrderId: { in: purchaseOrderIds } },
        ],
      },
    });
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: purchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrderIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });

    console.log("cenário de validação removido — nenhum dado persistente deixado na base DEV");
  } finally {
    await prisma.$disconnect();
  }
}

const stamp = Date.now().toString().slice(-6);
let browser;

try {
  const customer = await api("POST", "/customers", {
    legalName: `Alpha Nutrition Demo ${stamp}`,
    tradeName: "Alpha Nutrition",
  });
  created.customerIds.push(customer.id);

  const capsule = await api("POST", "/items", {
    type: "PACKAGING",
    name: `Cápsula vegetal 00 (demo ${stamp})`,
    unitCode: "un",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(capsule.id);

  const vitamin = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Vitamina C demo ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  created.itemIds.push(vitamin.id);

  // Material do cliente entra sem Ordem de Compra.
  const receipt = await api("POST", "/receipts/customer-supplied", {
    customerId: customer.id,
    receivedAt: new Date().toISOString(),
    documentReference: `REMESSA-${stamp}`,
    lines: [
      {
        itemId: capsule.id,
        receivedQuantity: "8000",
        supplierLot: `FAB-${stamp}`,
        location: "Porta-pallet A1",
      },
    ],
  });
  created.receiptIds.push(receipt.id);

  // Estoque próprio da Veridi para o outro componente — entra por Ordem de
  // Compra normal, o fluxo que já existia.
  const supplier = await api("POST", "/suppliers", { legalName: `Fornecedor Demo ${stamp}` });
  created.supplierIds.push(supplier.id);
  const purchaseOrder = await api("POST", "/purchase-orders", {
    supplierId: supplier.id,
    orderDate: new Date().toISOString(),
    lines: [{ itemId: vitamin.id, orderedQuantity: "20" }],
  });
  created.purchaseOrderIds.push(purchaseOrder.id);
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
  created.itemIds.push(finishedItem.id);

  const product = await api("POST", "/products", {
    name: `Vitamina C 500mg 60 caps (demo ${stamp})`,
    finishedProductItemId: finishedItem.id,
    customerId: customer.id,
  });
  created.productIds.push(product.id);

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
  created.productionOrderIds.push(order.id);
  await api("POST", `/production-orders/${order.id}/plan`);

  const lots = await api("GET", `/lots?itemId=${capsule.id}`);
  const customerLot = lots.lots[0];

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const shot = async (name, route) => {
    await page.goto(`http://localhost:5173${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log("ok", name);
  };

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
} finally {
  if (browser) await browser.close();
  await cleanup();
}
