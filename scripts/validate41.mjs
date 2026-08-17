import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual da capacidade 41 (importador definitivo).
 *
 * A capacidade é CLI: aqui só se confirma que os dados migrados aparecem e
 * navegam no sistema, e — a invariante mais importante — que a importação
 * de cadastro NÃO populou estoque artificialmente.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate41.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

let browser;

try {
  const prisma = new PrismaClient();
  let stockCheck;
  try {
    const [movements, lots, openingMovements, importMovements] = await Promise.all([
      prisma.inventoryMovement.count(),
      prisma.lot.count(),
      prisma.inventoryMovement.count({ where: { type: "OPENING_BALANCE" } }),
      prisma.inventoryMovement.count({ where: { createdBy: "Importação Veridi" } }),
    ]);
    stockCheck = { movements, lots, openingMovements, importMovements };
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `estoque: ${stockCheck.movements} movimento(s), ${stockCheck.lots} lote(s), ` +
      `${stockCheck.openingMovements} de abertura, ${stockCheck.importMovements} criados pela importação`,
  );
  if (stockCheck.importMovements !== 0) {
    throw new Error("A importação de cadastro criou movimento de estoque — invariante quebrada.");
  }

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

  const visit = async (name, route) => {
    await page.goto(`${WEB}${route}`, { waitUntil: "networkidle" });
    await shot(name);
  };

  await visit("41-customers", "/cadastros/clientes");
  await visit("41-items", "/cadastros/itens");
  await visit("41-products", "/cadastros/produtos");
  await visit("41-projects", "/comercial/projetos");
  await visit("41-samples", "/comercial/amostras");
  await visit("41-supplier-items", "/compras/item-fornecedor");
  // Estoque continua vazio: cadastro migrado não cria saldo.
  await visit("41-inventory-empty", "/estoque");

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
}
