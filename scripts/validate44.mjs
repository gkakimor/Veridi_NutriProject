import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual da capacidade 44 (recursos industriais).
 *
 * O cenário — recursos, tarifas, produto e estrutura de custos — é montado
 * via API e removido no final. Nada do corpus importado é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate44.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = { productIds: [], itemIds: [], customerIds: [], resourceIds: [] };
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

/** Chamada que se espera recusada — devolve status e corpo sem estourar. */
async function attempt(method, url, body) {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: sessionCookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialResourceId: { in: created.resourceIds } },
    });
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersion: { productId: { in: created.productIds } } },
    });
    await prisma.industrialCostVersion.deleteMany({
      where: { productId: { in: created.productIds } },
    });
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: created.resourceIds } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: created.resourceIds } } });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: created.productIds } } },
    });
    await prisma.formulationVersion.deleteMany({
      where: { productId: { in: created.productIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
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

  // ── 1. Recursos industriais ───────────────────────────────
  const makeResource = async (payload) => {
    const resource = await api("POST", "/industrial-resources", {
      ...payload,
      name: `${payload.name} ${stamp}`,
    });
    created.resourceIds.push(resource.id);
    return resource;
  };

  const operator = await makeResource({ name: "Operador de produção", type: "LABOR" });
  const encapsulator = await makeResource({
    name: "Encapsuladora",
    type: "EQUIPMENT",
    powerKw: "4",
  });
  const mixer = await makeResource({ name: "Misturador em V", type: "EQUIPMENT", powerKw: "2" });
  const oldPress = await makeResource({ name: "Prensa antiga", type: "EQUIPMENT" });
  const energy = await makeResource({ name: "Energia elétrica", type: "ENERGY" });
  console.log("recursos criados:", [operator, encapsulator, mixer, oldPress, energy].map((r) => r.code).join(" "));

  // Potência é atributo de equipamento — mão de obra não tem kW.
  const invalidPower = await attempt("POST", "/industrial-resources", {
    name: `Operador com potência ${stamp}`,
    type: "LABOR",
    powerKw: "3",
  });
  console.log("mão de obra com potência:", invalidPower.status, invalidPower.body?.error);

  // Unidade acompanha o tipo: "Operador 3 KG" não existe.
  const invalidUom = await attempt("POST", `/industrial-resources/${operator.id}/rates`, {
    rateValue: "3",
    rateUom: "KWH",
  });
  console.log("tarifa de mão de obra em kWh:", invalidUom.status, invalidUom.body?.error);

  // ── 2. Tarifas históricas ─────────────────────────────────
  const oldDate = new Date(Date.now() - 120 * 86_400_000).toISOString();
  await api("POST", `/industrial-resources/${operator.id}/rates`, {
    rateValue: "28",
    effectiveAt: oldDate,
  });
  const operatorRated = await api("POST", `/industrial-resources/${operator.id}/rates`, {
    rateValue: "32.50",
  });
  console.log(
    "tarifas do operador:",
    operatorRated.rates.length,
    "| vigente:",
    operatorRated.currentRate?.rateValue,
  );
  await api("POST", `/industrial-resources/${encapsulator.id}/rates`, { rateValue: "85" });
  await api("POST", `/industrial-resources/${mixer.id}/rates`, { rateValue: "40" });
  await api("POST", `/industrial-resources/${energy.id}/rates`, { rateValue: "0.85" });

  // ── 3. Produto, formulação e estrutura de custos ──────────
  const customer = await api("POST", "/customers", {
    legalName: `Beta Nutrition Recursos ${stamp}`,
    street: "Rua das Indústrias",
    number: "500",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310100",
  });
  created.customerIds.push(customer.id);

  const makeItem = async (type, name, unitCode) => {
    const item = await api("POST", "/items", { type, name: `${name} ${stamp}`, unitCode });
    created.itemIds.push(item.id);
    return item;
  };
  const material = await makeItem("RAW_MATERIAL", "Vitamina C", "kg");
  const capsule = await makeItem("PACKAGING", "Cápsula gelatinosa", "un");
  const finishedItem = await makeItem("FINISHED_PRODUCT", "Vitamina C 60 caps", "un");

  const product = await api("POST", "/products", {
    name: `Vitamina C 60 caps ${stamp}`,
    finishedProductItemId: finishedItem.id,
    customerId: customer.id,
    unitsPerShippingBox: 24,
    minimumBatchQuantity: "1000",
  });
  created.productIds.push(product.id);

  const formulation = await api("POST", `/products/${product.id}/formulation-versions`, {});
  await api("PATCH", `/formulation-versions/${formulation.id}`, {
    basisQuantity: "1",
    components: [
      { itemId: material.id, quantity: "0.03", unitCode: "kg" },
      { itemId: capsule.id, quantity: "60", unitCode: "un" },
    ],
  });
  await api("POST", `/formulation-versions/${formulation.id}/activate`);

  const draft = await api("POST", `/products/${product.id}/industrial-costs`, {
    referenceOutputQuantity: "1000",
  });
  console.log("estrutura criada:", draft.label, "| energia:", draft.energyCalculationMode);

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
  await page.waitForTimeout(1200);

  // 4. Lista e detalhe do recurso, com histórico de tarifas.
  await visit("44-resources-list", "/gestao/recursos-industriais");
  await visit("44-resource-detail", `/gestao/recursos-industriais/${operator.id}`);
  await visit("44-resource-no-rate", `/gestao/recursos-industriais/${oldPress.id}`);

  // 5. Uso dos recursos na estrutura de custos.
  await api("POST", `/industrial-costs/${draft.id}/resource-usages`, {
    resourceId: operator.id,
    usageQuantity: "2.5",
  });
  await api("POST", `/industrial-costs/${draft.id}/resource-usages`, {
    resourceId: encapsulator.id,
    usageQuantity: "2",
  });
  await api("POST", `/industrial-costs/${draft.id}/resource-usages`, {
    resourceId: mixer.id,
    usageQuantity: "0.5",
  });

  // Uma linha por recurso: o mesmo recurso duas vezes é recusado.
  const duplicated = await attempt("POST", `/industrial-costs/${draft.id}/resource-usages`, {
    resourceId: operator.id,
    usageQuantity: "1",
  });
  console.log("recurso repetido:", duplicated.status, duplicated.body?.error);

  // Energia direta fora do modo direto contaria duas vezes.
  const energyBeforeMode = await attempt("POST", `/industrial-costs/${draft.id}/resource-usages`, {
    resourceId: energy.id,
    usageQuantity: "15",
  });
  console.log("energia direta em modo NONE:", energyBeforeMode.status, energyBeforeMode.body?.error);

  await visit("44-cost-resources-draft", `/produtos/${product.id}/custos`);

  // 6. Energia derivada dos equipamentos: 2 h × 4 kW + 0,5 h × 2 kW = 9 kWh.
  const derived = await api("POST", `/industrial-costs/${draft.id}/energy-mode`, {
    energyCalculationMode: "FROM_EQUIPMENT",
  });
  console.log("energia derivada:", derived.derivedEnergyKwh, "kWh");
  await visit("44-cost-energy-derived", `/produtos/${product.id}/custos`);

  // 7. Equipamento sem potência deixa a energia derivada em aberto.
  const withOldPress = await api("POST", `/industrial-costs/${draft.id}/resource-usages`, {
    resourceId: oldPress.id,
    usageQuantity: "1",
  });
  console.log(
    "com equipamento sem potência — derivada:",
    withOldPress.derivedEnergyKwh,
    "| completa:",
    withOldPress.complete,
  );
  await visit("44-cost-energy-incomplete", `/produtos/${product.id}/custos`);

  // 8. Ativação: incompleta exige confirmação explícita.
  const refused = await attempt("POST", `/industrial-costs/${draft.id}/activate`, {});
  console.log("ativação sem confirmar:", refused.status, refused.body?.error);

  const activated = await api("POST", `/industrial-costs/${draft.id}/activate`, {
    confirmIncomplete: true,
  });
  const laborUsage = activated.resourceUsages.find((usage) => usage.resourceId === operator.id);
  console.log(
    "snapshot da mão de obra:",
    laborUsage.rateValueSnapshot,
    laborUsage.rateUomSnapshot,
    "| potência congelada da encapsuladora:",
    activated.resourceUsages.find((usage) => usage.resourceId === encapsulator.id).powerKwSnapshot,
  );
  await visit("44-cost-active", `/produtos/${product.id}/custos`);

  // 9. Reajuste posterior não reescreve a versão ativa.
  await api("POST", `/industrial-resources/${operator.id}/rates`, { rateValue: "40" });
  const afterRaise = await api("GET", `/industrial-costs/${draft.id}`);
  const laborAfter = afterRaise.resourceUsages.find((usage) => usage.resourceId === operator.id);
  console.log(
    "após reajuste — snapshot:",
    laborAfter.rateValueSnapshot,
    "| referência atual:",
    laborAfter.currentRate?.rateValue,
  );

  // 10. Nova versão copia os usos e volta a enxergar a tarifa vigente.
  const v2 = await api("POST", `/products/${product.id}/industrial-costs`, {});
  console.log(
    "nova versão:",
    v2.label,
    "| usos copiados:",
    v2.resourceUsages.length,
    "| snapshot copiado:",
    v2.resourceUsages[0].rateValueSnapshot,
  );
  await visit("44-cost-new-version", `/produtos/${product.id}/custos`);

  // 11. Recurso inativo bloqueia ativação nova; o histórico ativo continua.
  await api("PATCH", `/industrial-resources/${mixer.id}`, { active: false });
  const blocked = await attempt("POST", `/industrial-costs/${v2.id}/activate`, {
    confirmIncomplete: true,
  });
  console.log("ativação com recurso inativo:", blocked.status, blocked.body?.error);
  const stillActive = await api("GET", `/industrial-costs/${draft.id}`);
  console.log("versão ativa anterior:", stillActive.status, "| snapshots preservados");
  await visit("44-resource-inactive", `/gestao/recursos-industriais/${mixer.id}`);

  // 12. Impressão da estrutura com a seção de recursos.
  await page.emulateMedia({ media: "print" });
  await visit("44-cost-print", `/print/estrutura-custos/${draft.id}`);
  await page.emulateMedia({ media: "screen" });

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
