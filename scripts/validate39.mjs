import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação visual desktop da capacidade 39 (amostras / pilotos / testes
 * Tn). Monta o cenário via API e remove tudo no final — as amostras
 * importadas do corpus não são tocadas.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate39.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const created = {
  customerIds: [],
  projectIds: [],
  itemIds: [],
  sampleIds: [],
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

async function cleanup() {
  const prisma = new PrismaClient();
  try {
    const samples = await prisma.projectSample.findMany({
      where: {
        OR: [{ id: { in: created.sampleIds } }, { projectId: { in: created.projectIds } }],
      },
      select: { id: true },
    });
    const sampleIds = samples.map((row) => row.id);

    const attachments = await prisma.attachment.findMany({
      where: {
        OR: [{ id: { in: created.attachmentIds } }, { projectSampleId: { in: sampleIds } }],
      },
    });
    const uploadDir = path.resolve("../.local-data/uploads");
    for (const attachment of attachments) {
      fs.rmSync(path.join(uploadDir, attachment.storageKey), { force: true });
    }
    await prisma.attachment.deleteMany({ where: { id: { in: attachments.map((r) => r.id) } } });

    await prisma.sampleConsumption.deleteMany({ where: { projectSampleId: { in: sampleIds } } });
    await prisma.projectSample.deleteMany({ where: { id: { in: sampleIds } } });

    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: created.projectIds } } });
    await prisma.projectStatusHistory.deleteMany({
      where: { projectId: { in: created.projectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: created.projectIds } } });

    // Lotes e movimentos criados só para o cenário saem junto com os itens.
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: created.itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: created.itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });

    console.log("cenário de validação removido — amostras do corpus intactas");
  } finally {
    await prisma.$disconnect();
  }
}

/** Lote com entrada real no ledger — o saldo vem da mesma matemática do sistema. */
async function receiveStock(prisma, itemId, quantity) {
  const lot = await prisma.lot.create({
    data: {
      code: `LT-AM39-${Date.now().toString().slice(-6)}`,
      itemId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
      ownerType: "VERIDI",
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
      createdBy: "Validação 39",
    },
  });
  return lot;
}

const stamp = Date.now().toString().slice(-6);
let browser;

try {
  await api("POST", "/auth/login", credentials);

  const customer = await api("POST", "/customers", {
    legalName: `Alpha Nutrition Amostra ${stamp}`,
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
    name: `Pré-treino Pink Lemonade ${stamp}`,
    concept: "Pré-treino",
    channel: "Distribuidora",
  });
  created.projectIds.push(project.id);

  const item = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Beta Alanina Amostra ${stamp}`,
    unitCode: "kg",
    controlsLot: true,
  });
  created.itemIds.push(item.id);

  const prisma = new PrismaClient();
  let lot;
  try {
    lot = await receiveStock(prisma, item.id, "25");
  } finally {
    await prisma.$disconnect();
  }

  // T1 completa: consumo real, conclusão e aprovação.
  const t1 = await api("POST", `/projects/${project.id}/samples`, {
    description: "Piloto sabor pink lemonade",
  });
  created.sampleIds.push(t1.id);
  await api("POST", `/project-samples/${t1.id}/consumptions`, {
    itemId: item.id,
    lotCode: lot.code,
    quantity: "1.25",
    notes: "Pesagem manual em bancada",
  });
  await api("POST", `/project-samples/${t1.id}/produce`, {
    outputQuantity: "8",
    outputUomCode: "un",
    productionNotes: "8 potes de 200 g",
  });
  const approved = await api("POST", `/project-samples/${t1.id}/approve`, {
    decisionNotes: "Sabor e solubilidade aprovados pelo cliente",
  });
  console.log("T1 aprovada:", approved.code, approved.testLabel);

  // T2 em preparação, para mostrar o fluxo aberto na tela.
  const t2 = await api("POST", `/projects/${project.id}/samples`, {
    description: "Ajuste de acidez",
  });
  created.sampleIds.push(t2.id);
  await api("POST", `/project-samples/${t2.id}/consumptions`, {
    itemId: item.id,
    lotCode: lot.code,
    quantity: "0.75",
  });

  // Resultado de teste anexado na amostra aprovada.
  const form = new FormData();
  form.append("documentType", "SAMPLE_RESULT");
  form.append(
    "file",
    new Blob([Buffer.from("%PDF-1.4\n%%EOF\n", "utf8")], { type: "application/pdf" }),
    `resultado-${stamp}.pdf`,
  );
  const uploaded = await fetch(`${API}/project-samples/${t1.id}/attachments`, {
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

  await visit("39-samples-list", "/comercial/amostras");
  await visit("39-sample-approved", `/comercial/amostras/${t1.id}`);
  await visit("39-sample-in-progress", `/comercial/amostras/${t2.id}`);
  await visit("39-sample-label", `/comercial/amostras/${t1.id}/etiqueta`);
  await visit("39-project-samples", `/comercial/projetos/${project.id}`);
  await visit("39-lot-traceability", `/estoque/lotes/${lot.id}`);
  await visit("39-movements-report", "/relatorios/estoque/movimentacoes");

  console.log(errors.length === 0 ? "console limpo" : `erros de console: ${errors.length}`);
  for (const error of errors) console.log("  --", error);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
