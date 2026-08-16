import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual desktop da capacidade 38 (projetos e orçamentos
 * versionados). Monta o cenário via API e remove tudo no final — os
 * projetos importados do corpus não são tocados.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate38.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = { customerIds: [], projectIds: [], productIds: [], itemIds: [], attachmentIds: [] };
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
    const projects = await prisma.project.findMany({
      where: { OR: [{ id: { in: created.projectIds } }, { customerId: { in: created.customerIds } }] },
      select: { id: true, productId: true },
    });
    const projectIds = projects.map((row) => row.id);
    const productIds = [
      ...new Set([
        ...created.productIds,
        ...projects.map((row) => row.productId).filter((id) => id !== null),
      ]),
    ];

    const attachments = await prisma.attachment.findMany({
      where: { OR: [{ id: { in: created.attachmentIds } }, { projectId: { in: projectIds } }] },
    });
    const uploadDir = path.resolve("../.local-data/uploads");
    for (const attachment of attachments) {
      fs.rmSync(path.join(uploadDir, attachment.storageKey), { force: true });
    }
    await prisma.attachment.deleteMany({ where: { id: { in: attachments.map((r) => r.id) } } });

    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.projectStatusHistory.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, finishedProductItemId: true },
    });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: productIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.item.deleteMany({
      where: {
        id: {
          in: [
            ...created.itemIds,
            ...products.map((row) => row.finishedProductItemId).filter((id) => id !== null),
          ],
        },
      },
    });
    await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });

    console.log("cenário de validação removido — projetos do corpus intactos");
  } finally {
    await prisma.$disconnect();
  }
}

const stamp = Date.now().toString().slice(-6);
let browser;

try {
  await api("POST", "/auth/login", credentials);

  const customer = await api("POST", "/customers", {
    legalName: `Alpha Nutrition Projeto ${stamp}`,
    tradeName: "Alpha Nutrition",
    street: "Avenida Paulista",
    number: "1000",
    district: "Bela Vista",
    zipCode: "01310100",
    city: "São Paulo",
    state: "SP",
  });
  created.customerIds.push(customer.id);

  const project = await api("POST", "/projects", {
    customerId: customer.id,
    name: `Detox Premium 60 caps ${stamp}`,
    concept: "Detox",
    channel: "Distribuidora",
    dosageForm: "CAPSULE",
    presentationType: "POT",
    dosesPerPackage: 60,
    shelfLifeMonths: 24,
  });
  created.projectIds.push(project.id);

  // V1: rascunho → enviado.
  const v1 = await api("POST", `/projects/${project.id}/quote-versions`);
  await api("PATCH", `/quote-versions/${v1.id}`, {
    quotedQuantity: "3000",
    uomCode: "un",
    unitPrice: "12.3456",
    paymentTerms: "30/60 dias",
    leadTimeDays: 45,
    commercialNotes: "Preço válido para lote fechado",
  });
  const sentV1 = await api("POST", `/quote-versions/${v1.id}/send`);
  console.log("V1 enviada — total:", sentV1.total);

  // V2 supersede a V1 e é a versão aceita.
  const v2 = await api("POST", `/projects/${project.id}/quote-versions`);
  await api("PATCH", `/quote-versions/${v2.id}`, { unitPrice: "11.9000" });
  await api("POST", `/quote-versions/${v2.id}/send`);
  await api("POST", `/quote-versions/${v2.id}/accept`);

  await api("POST", `/projects/${project.id}/status`, { status: "SAMPLE" });

  // Briefing anexado.
  const form = new FormData();
  form.append("documentType", "BRIEFING");
  form.append(
    "file",
    new Blob([Buffer.from("%PDF-1.4\n%%EOF\n", "utf8")], { type: "application/pdf" }),
    `briefing-${stamp}.pdf`,
  );
  const uploaded = await fetch(`${API}/projects/${project.id}/attachments`, {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: form,
  });
  created.attachmentIds.push((await uploaded.json()).id);

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
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  const visit = async (name, route) => {
    await page.goto(`${WEB}${route}`, { waitUntil: "networkidle" });
    await shot(name);
  };

  await visit("38-projects-list", "/comercial/projetos");
  await visit("38-project-detail", `/comercial/projetos/${project.id}`);
  await visit("38-quote-print", `/comercial/orcamentos/${v2.id}/imprimir`);

  // Aprovação converte o projeto em produto.
  const approved = await api("POST", `/projects/${project.id}/approve`);
  created.productIds.push(approved.productId);
  console.log("projeto aprovado — produto:", approved.productCode);

  await visit("38-project-approved", `/comercial/projetos/${project.id}`);
  await visit("38-new-project-modal", "/comercial/projetos");
  await page.click("text=Novo projeto");
  await shot("38-new-project-form");

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
