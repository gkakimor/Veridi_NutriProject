import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual da capacidade 45 (cálculo do custo industrial) e do
 * branding oficial.
 *
 * Todo o cenário — recebimentos com custo real, oferta de fornecedor,
 * recursos, estrutura, cálculo e OP — é montado via API e removido no final.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate45.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const DAY_MS = 24 * 60 * 60 * 1000;

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = {
  productIds: [],
  itemIds: [],
  customerIds: [],
  supplierIds: [],
  resourceIds: [],
  productionOrderIds: [],
  purchaseOrderIds: [],
  receiptIds: [],
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
    if (created.productionOrderIds.length > 0) {
      const where = { productionOrderId: { in: created.productionOrderIds } };
      await prisma.productionOrderCostSnapshot.deleteMany({ where });
      await prisma.productionOutput.deleteMany({ where });
      await prisma.productionConsumption.deleteMany({ where });
      const reservations = await prisma.materialReservation.findMany({
        where,
        select: { id: true },
      });
      if (reservations.length > 0) {
        const reservationIds = reservations.map((row) => row.id);
        await prisma.materialReservationLine.deleteMany({
          where: { reservationId: { in: reservationIds } },
        });
        await prisma.materialReservation.deleteMany({ where: { id: { in: reservationIds } } });
      }
      await prisma.productionOrderPart.deleteMany({ where });
      await prisma.productionOrderRequirement.deleteMany({ where });
      await prisma.lot.deleteMany({
        where: { productionOrderId: { in: created.productionOrderIds } },
      });
      await prisma.productionOrder.deleteMany({ where: { id: { in: created.productionOrderIds } } });
    }

    if (created.productIds.length > 0) {
      const versionWhere = { industrialCostVersion: { productId: { in: created.productIds } } };
      await prisma.industrialCostCalculation.deleteMany({
        where: { productId: { in: created.productIds } },
      });
      await prisma.industrialCostResourceUsage.deleteMany({ where: versionWhere });
      await prisma.industrialCostLine.deleteMany({ where: versionWhere });
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
    }

    if (created.resourceIds.length > 0) {
      await prisma.industrialResourceRate.deleteMany({
        where: { industrialResourceId: { in: created.resourceIds } },
      });
      await prisma.industrialResource.deleteMany({ where: { id: { in: created.resourceIds } } });
    }

    if (created.receiptIds.length > 0) {
      await prisma.receiptLine.deleteMany({ where: { receiptId: { in: created.receiptIds } } });
      await prisma.receipt.deleteMany({ where: { id: { in: created.receiptIds } } });
    }
    if (created.purchaseOrderIds.length > 0) {
      await prisma.purchaseOrderLine.deleteMany({
        where: { purchaseOrderId: { in: created.purchaseOrderIds } },
      });
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: created.purchaseOrderIds } } });
    }
    if (created.itemIds.length > 0) {
      await prisma.supplierItemOffer.deleteMany({
        where: { supplierItem: { itemId: { in: created.itemIds } } },
      });
      await prisma.supplierItem.deleteMany({ where: { itemId: { in: created.itemIds } } });
      await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: created.itemIds } } });
      await prisma.lot.deleteMany({ where: { itemId: { in: created.itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    }
    if (created.supplierIds.length > 0) {
      await prisma.supplier.deleteMany({ where: { id: { in: created.supplierIds } } });
    }
    if (created.customerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
    }
    console.log("cenário de validação removido — dados do corpus intactos");
  } finally {
    await prisma.$disconnect();
  }
}

const stamp = Date.now().toString().slice(-6);
let browser;

try {
  await api("POST", "/auth/login", credentials);

  const makeItem = async (type, name, unitCode) => {
    const item = await api("POST", "/items", {
      type,
      name: `${name} ${stamp}`,
      unitCode,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    });
    created.itemIds.push(item.id);
    return item;
  };
  const makeSupplier = async (name) => {
    const supplier = await api("POST", "/suppliers", { legalName: `${name} ${stamp}` });
    created.supplierIds.push(supplier.id);
    return supplier;
  };
  const receive = async ({ supplierId, itemId, quantity, unitCost, receivedAt }) => {
    const po = await api("POST", "/purchase-orders", {
      supplierId,
      orderDate: new Date().toISOString(),
      lines: [{ itemId, orderedQuantity: quantity }],
    });
    created.purchaseOrderIds.push(po.id);
    await api("POST", `/purchase-orders/${po.id}/confirm`);
    const receipt = await api("POST", `/purchase-orders/${po.id}/receipts`, {
      receivedAt: (receivedAt ?? new Date()).toISOString(),
      lines: [
        {
          purchaseOrderLineId: po.lines[0].id,
          receivedQuantity: quantity,
          supplierLot: `SUP-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
          expiryDate: new Date(Date.now() + 365 * DAY_MS).toISOString(),
          ...(unitCost ? { actualUnitCost: unitCost } : {}),
        },
      ],
    });
    created.receiptIds.push(receipt.id);
    return receipt;
  };

  // ── 1. Materiais: um com compras reais, um só com oferta ──
  const supplier = await makeSupplier("Fornecedor Custo");
  const withReal = await makeItem("RAW_MATERIAL", "Magnésio quelato", "kg");
  const withOffer = await makeItem("RAW_MATERIAL", "Excipiente importado", "kg");
  const capsule = await makeItem("PACKAGING", "Cápsula vegetal", "un");
  const finishedItem = await makeItem("FINISHED_PRODUCT", "Magnésio 120 caps", "un");

  await receive({ supplierId: supplier.id, itemId: withReal.id, quantity: "10", unitCost: "100" });
  await receive({ supplierId: supplier.id, itemId: withReal.id, quantity: "20", unitCost: "130" });
  await receive({ supplierId: supplier.id, itemId: capsule.id, quantity: "100000", unitCost: "0.02" });

  const offerSupplier = await makeSupplier("Fornecedor Referência");
  const supplierItem = await api("POST", "/supplier-items", {
    itemId: withOffer.id,
    supplierId: offerSupplier.id,
  });
  await api("POST", `/supplier-items/${supplierItem.id}/qualification`, {
    status: "APPROVED",
    reason: "Homologado para validação da capacidade 45",
  });
  await api("PATCH", `/supplier-items/${supplierItem.id}`, { preferred: true });
  await api("POST", `/supplier-items/${supplierItem.id}/offers`, {
    unitPrice: "40",
    currencyCode: "BRL",
    priceUomCode: "kg",
    effectiveAt: new Date(Date.now() - DAY_MS).toISOString(),
  });

  // ── 2. Produto, formulação, estrutura, recursos ───────────
  const customer = await api("POST", "/customers", {
    legalName: `Gama Nutrition Custos ${stamp}`,
    street: "Rua da Indústria",
    number: "900",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310100",
  });
  created.customerIds.push(customer.id);

  const customerMaterial = await makeItem("RAW_MATERIAL", "Ativo enviado pelo cliente", "kg");

  const product = await api("POST", "/products", {
    name: `Magnésio 120 caps ${stamp}`,
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
      { itemId: withReal.id, quantity: "0.02", unitCode: "kg" },
      { itemId: withOffer.id, quantity: "0.001", unitCode: "kg" },
      { itemId: capsule.id, quantity: "120", unitCode: "un" },
      {
        itemId: customerMaterial.id,
        quantity: "0.0005",
        unitCode: "kg",
        supplyResponsibility: "CUSTOMER",
      },
    ],
  });
  await api("POST", `/formulation-versions/${formulation.id}/activate`);

  const version = await api("POST", `/products/${product.id}/industrial-costs`, {
    referenceOutputQuantity: "1000",
  });

  const makeResource = async (payload, rate) => {
    const resource = await api("POST", "/industrial-resources", {
      ...payload,
      name: `${payload.name} ${stamp}`,
    });
    created.resourceIds.push(resource.id);
    if (rate) {
      await api("POST", `/industrial-resources/${resource.id}/rates`, { rateValue: rate });
    }
    return resource;
  };

  const operator = await makeResource({ name: "Operador de produção", type: "LABOR" }, "30");
  const encapsulator = await makeResource(
    { name: "Encapsuladora", type: "EQUIPMENT", powerKw: "4" },
    "85",
  );
  const energy = await makeResource({ name: "Energia elétrica", type: "ENERGY" }, "1.00");

  await api("POST", `/industrial-costs/${version.id}/resource-usages`, {
    resourceId: operator.id,
    usageQuantity: "2.5",
  });
  await api("POST", `/industrial-costs/${version.id}/resource-usages`, {
    resourceId: encapsulator.id,
    usageQuantity: "1.8",
  });
  await api("POST", `/industrial-costs/${version.id}/energy-mode`, {
    energyCalculationMode: "FROM_EQUIPMENT",
    energyResourceId: energy.id,
  });
  await api("POST", `/industrial-costs/${version.id}/lines`, {
    category: "SECONDARY_PACKAGING",
    description: "Caixa de expedição",
    calculationBasis: "PER_SHIPPING_BOX",
    rateValue: "3.50",
  });
  await api("POST", `/industrial-costs/${version.id}/lines`, {
    category: "OVERHEAD",
    description: "Rateio industrial",
    calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
    rateValue: "10",
  });

  // ── 3. Cálculo padrão ─────────────────────────────────────
  const calculation = await api("GET", `/industrial-costs/${version.id}/calculate`);
  console.log(
    "cálculo:",
    calculation.quality,
    "| direto",
    calculation.directIndustrialCost,
    "| overhead",
    calculation.overheadSubtotalKnown,
    "| total",
    calculation.totalIndustrialCost,
    "| unidade",
    calculation.costPerUnit,
  );
  for (const material of calculation.materials) {
    console.log(`  material ${material.itemCode}: ${material.costSource} ${material.unitCost ?? "—"}`);
  }
  console.log("  energia derivada:", calculation.derivedEnergyKwh, "kWh →", calculation.energySubtotal);

  await api("POST", `/industrial-costs/${version.id}/activate`, {});
  const saved = await api("POST", `/industrial-costs/${version.id}/calculations`, {});
  console.log("cálculo salvo:", saved.code, "| qualidade", saved.quality);

  // ── 4. Ordem de produção com EC compatível ────────────────
  // Produto próprio para a produção: material do cliente exige lote de
  // propriedade do cliente, que é outro fluxo — aqui o foco é o custo.
  const opFinishedItem = await makeItem("FINISHED_PRODUCT", "Magnésio simples", "un");
  const opProduct = await api("POST", "/products", {
    name: `Magnésio simples ${stamp}`,
    finishedProductItemId: opFinishedItem.id,
    customerId: customer.id,
    unitsPerShippingBox: 12,
    minimumBatchQuantity: "1000",
  });
  created.productIds.push(opProduct.id);

  const opFormulation = await api("POST", `/products/${opProduct.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${opFormulation.id}`, {
    basisQuantity: "1",
    components: [
      { itemId: withReal.id, quantity: "0.02", unitCode: "kg" },
      { itemId: capsule.id, quantity: "120", unitCode: "un" },
    ],
  });
  await api("POST", `/formulation-versions/${opFormulation.id}/activate`);

  const opVersion = await api("POST", `/products/${opProduct.id}/industrial-costs`, {
    referenceOutputQuantity: "1000",
  });
  await api("POST", `/industrial-costs/${opVersion.id}/resource-usages`, {
    resourceId: operator.id,
    usageQuantity: "10",
  });
  await api("POST", `/industrial-costs/${opVersion.id}/energy-mode`, {
    energyCalculationMode: "DIRECT",
  });
  await api("POST", `/industrial-costs/${opVersion.id}/resource-usages`, {
    resourceId: energy.id,
    usageQuantity: "100",
  });
  await api("POST", `/industrial-costs/${opVersion.id}/lines`, {
    category: "SECONDARY_PACKAGING",
    description: "Caixa de expedição",
    calculationBasis: "PER_SHIPPING_BOX",
    rateValue: "3.50",
  });
  await api("POST", `/industrial-costs/${opVersion.id}/activate`, {});

  // Estoque suficiente para a produção de 500 unidades.
  await receive({ supplierId: supplier.id, itemId: withReal.id, quantity: "50", unitCost: "120" });

  const order = await api("POST", "/production-orders", {
    productId: opProduct.id,
    plannedQuantity: "500",
  });
  created.productionOrderIds.push(order.id);
  await api("POST", `/production-orders/${order.id}/plan`);
  const released = await api("POST", `/production-orders/${order.id}/release`);

  for (const requirement of released.requirements ?? []) {
    for (const line of requirement.reservationLines ?? []) {
      await api("POST", `/production-orders/${order.id}/picking/${line.id}/confirm`, {
        ...(line.lotCode ? { lotCode: line.lotCode } : {}),
      });
      await api("POST", `/production-orders/${order.id}/consumptions`, {
        entries: [{ reservationLineId: line.id, quantity: line.quantity }],
      });
    }
  }
  await api("POST", `/production-orders/${order.id}/outputs`, {
    quantity: "500",
    destination: "NEW_LOT",
    businessLotNumber: `VD-${stamp}`,
  });

  const provisional = await api("GET", `/production-orders/${order.id}/cost`);
  console.log(
    "EC congelada no release:",
    provisional.industrialCostVersionId === opVersion.id,
    provisional.industrialCostVersionLabel,
  );
  console.log(
    "custo da OP (provisório):",
    provisional.status,
    "| materiais",
    provisional.actualMaterialCostKnown,
    "| padrão aplicado",
    provisional.standardAppliedCostKnown,
    "| fator",
    provisional.allocationFactor,
  );

  await api("POST", `/production-orders/${order.id}/complete`, {});
  const final = await api("GET", `/production-orders/${order.id}/cost`);
  console.log(
    "custo da OP (final):",
    final.status,
    "| total",
    final.totalIndustrialCost,
    "| unidade",
    final.costPerProducedUnit,
    "| snapshot",
    Boolean(final.snapshotId),
  );

  // ── 5. Telas ──────────────────────────────────────────────
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(WEB) && !url.startsWith(API) && !url.startsWith("data:")) {
      externalRequests.push(url);
    }
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

  // Branding: logo no shell e favicon.
  await visit("45-branding-shell", "/");
  const brandSrc = await page.getAttribute(".masthead__mark", "src");
  const faviconHref = await page.getAttribute('link[rel="icon"]', "href");
  console.log("logo do shell:", brandSrc, "| favicon:", faviconHref);

  await visit("45-cost-calculation", `/produtos/${product.id}/custos`);
  await page.getByRole("button", { name: "Calcular custo" }).click();
  await page.waitForTimeout(1200);
  await shot("45-cost-calculation-result");

  await visit("45-calculation-snapshot", `/calculos-custo/${saved.id}`);

  await page.emulateMedia({ media: "print" });
  await visit("45-calculation-print", `/print/calculo-custo/${saved.id}`);
  const printLogo = await page.getAttribute(".print-doc__logo", "src");
  console.log("logo na impressão:", printLogo);
  await visit("45-production-cost-print", `/print/custo-producao/${order.id}`);
  await page.emulateMedia({ media: "screen" });

  await visit("45-production-order-cost", `/producao/ordens/${order.id}`);
  await visit("45-report-r18", "/relatorios/custos/industrial-por-produto");

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
  console.log(
    externalRequests.length === 0
      ? "nenhuma request externa (branding é asset local)"
      : `requests externas: ${externalRequests.join(", ")}`,
  );
} finally {
  if (browser) await browser.close();
  await cleanup();
}
