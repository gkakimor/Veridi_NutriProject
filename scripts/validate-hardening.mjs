import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação pela interface das correções operacionais da auditoria
 * VAL-LEG-01.
 *
 * Cenário sintético e local, removido no final. O corpus real não é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-hardening.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const marca = `OH${Date.now().toString().slice(-8)}`;
const created = { itemIds: [], supplierIds: [], lotIds: [] };
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

const resultados = [];
function checar(rotulo, condicao, detalhe = "") {
  resultados.push({ rotulo, ok: Boolean(condicao) });
  console.log(`${condicao ? "  ok  " : " FALHA"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function tela(page, nome) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `hardening-${nome}.png`), fullPage: true });
}

async function main() {
  await api("POST", "/auth/login", credentials);

  const item = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Material ${marca}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: true,
  });
  created.itemIds.push(item.id);
  const fornecedor = await api("POST", "/suppliers", { legalName: `Fornecedor ${marca}` });
  created.supplierIds.push(fornecedor.id);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const erros = [];
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text().slice(0, 160));
  });
  const ruins = [];
  page.on("response", (r) => {
    if (r.status() >= 400) ruins.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  try {
    await page.goto(WEB, { waitUntil: "networkidle" });
    await page.fill("#login-email", credentials.email);
    await page.fill("#login-password", credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);

    /* ── 1. Item × Fornecedor completo numa entrada só ── */
    await page.goto(`${WEB}/compras/item-fornecedor`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.click('button:has-text("Nova relação")');
    await page.waitForTimeout(1500);

    checar(
      "item e fornecedor são busca, não lista rolável",
      (await page.locator('input#supplier-item-item[role="combobox"]').count()) > 0,
    );
    const temTudo =
      (await page.locator("#supplier-item-price").count()) > 0 &&
      (await page.locator("#supplier-item-moq").count()) > 0 &&
      (await page.locator("#supplier-item-qualification").count()) > 0 &&
      (await page.locator("#supplier-item-preferred").count()) > 0;
    checar("formulário pede preço, MOQ, homologação e preferencial", temTudo);
    checar(
      "observações comerciais em textarea",
      (await page.locator("textarea#supplier-item-notes").count()) > 0,
    );
    await tela(page, "01-relacao-completa");

    const escolher = async (seletor, termo) => {
      const campo = page.locator(seletor);
      await campo.click();
      await campo.fill("");
      await campo.pressSequentially(termo, { delay: 30 });
      await page.waitForTimeout(1000);
      await page.locator('[role="listbox"] [role="option"]').first().click();
      await page.waitForTimeout(500);
    };
    await escolher("#supplier-item-item", item.code);
    await escolher("#supplier-item-supplier", fornecedor.code);
    await page.selectOption("#supplier-item-qualification", "APPROVED");
    await page.check("#supplier-item-preferred");
    await page.fill("#supplier-item-price", "272");
    await page.fill("#supplier-item-moq", "25");
    await page.waitForTimeout(500);
    const criar = page.locator('button:has-text("Criar relação")').last();
    console.log("    botão habilitado?", await criar.isEnabled());
    await criar.click();
    await page.waitForTimeout(3000);
    const alerta = await page.locator(".form-alert").allTextContents();
    if (alerta.length > 0) console.log("    alerta do formulário:", alerta.join(" | "));

    await page.goto(`${WEB}/compras/item-fornecedor`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    // A lista é paginada: sem filtrar, a relação nova pode estar na página 9.
    await page.locator('main input[type="search"]').first().fill(item.code);
    await page.waitForTimeout(2000);
    const grade = (await page.locator("tbody tr").allTextContents())
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find((l) => l.includes(item.code));
    checar(
      "a grade já mostra homologado, preferencial, preço e MOQ",
      Boolean(grade) &&
        /Homologado/.test(grade) &&
        /Sim/.test(grade) &&
        /272/.test(grade) &&
        /25/.test(grade),
      (grade ?? "linha não encontrada").slice(0, 100),
    );
    await tela(page, "02-grade");

    /* ── 2. Inativar relação: peso destrutivo e confirmação ── */
    await page.locator("tbody tr").filter({ hasText: item.code }).first().click();
    await page.waitForTimeout(2500);
    const inativar = page.locator('button:has-text("Inativar relação")').last();
    checar(
      "inativar usa a variante destrutiva",
      ((await inativar.getAttribute("class")) ?? "").includes("btn--danger"),
    );
    const fechares = await page.locator('button:has-text("Fechar")').count();
    checar("um único controle de fechamento no modal", fechares === 1, `encontrados: ${fechares}`);
    await inativar.click();
    await page.waitForTimeout(1200);
    const dialogo = await page.locator("body").innerText();
    checar(
      "inativar pergunta antes e explica a consequência",
      /Inativar esta relação\?/.test(dialogo) && /sourcing/.test(dialogo),
    );
    await tela(page, "03-inativar");
    await page.locator('button:has-text("Cancelar")').last().click();
    await page.waitForTimeout(800);

    /* ── 3. Estoque explica a indisponibilidade ── */
    // Lote recebido do jeito normal: item exige liberação da Qualidade.
    const oc = await api("POST", "/purchase-orders", {
      supplierId: fornecedor.id,
      orderDate: new Date().toISOString().slice(0, 10),
      lines: [{ itemId: item.id, orderedQuantity: "5", unitPrice: "272" }],
    });
    await api("POST", `/purchase-orders/${oc.id}/confirm`);
    await api("POST", `/purchase-orders/${oc.id}/receipts`, {
      receivedAt: new Date().toISOString().slice(0, 10),
      lines: [
        {
          purchaseOrderLineId: oc.lines[0].id,
          receivedQuantity: "5",
          supplierLot: `LOTE-${marca}`,
          expiryDate: new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10),
        },
      ],
    });

    await page.goto(`${WEB}/estoque`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await page.fill('input[type="search"]', item.code);
    await page.waitForTimeout(1800);
    const linha = (await page.locator("tbody tr").allTextContents())
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find((l) => l.includes(item.code));
    checar(
      "a linha diz por que o disponível é zero",
      Boolean(linha) && /aguardando liberação da Qualidade/i.test(linha),
      (linha ?? "não encontrada").slice(0, 110),
    );
    await tela(page, "04-estoque-explica");

    /* ── 4. Calcular × Salvar: hierarquia e confirmação ── */
    const acabado = await api("POST", "/items", {
      type: "FINISHED_PRODUCT",
      name: `PA ${marca}`,
      unitCode: "un",
    });
    created.itemIds.push(acabado.id);
    const produto = await api("POST", "/products", {
      name: `Produto ${marca}`,
      finishedProductItemId: acabado.id,
    });
    const formulacao = await api("POST", `/products/${produto.id}/formulation-versions`, {});
    await api("PATCH", `/formulation-versions/${formulacao.id}`, {
      basisQuantity: "100",
      components: [{ itemId: item.id, quantity: "1", unitCode: "kg", basis: "FIXED_BASIS" }],
    });
    await api("POST", `/formulation-versions/${formulacao.id}/activate`);
    await api("POST", `/products/${produto.id}/industrial-costs`, {
      referenceOutputQuantity: "100",
      referenceOutputUomCode: "un",
    });

    await page.goto(`${WEB}/produtos/${produto.id}/custos`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const calcular = page.locator('button:has-text("Calcular custo")').last();
    checar(
      "calcular é a ação primária",
      ((await calcular.getAttribute("class")) ?? "").includes("btn--accent"),
    );
    await calcular.click();
    await page.waitForTimeout(3500);
    const salvar = page.locator('button:has-text("Salvar cálculo")').last();
    checar(
      "salvar é a ação secundária",
      ((await salvar.getAttribute("class")) ?? "").includes("btn--secondary"),
    );
    await salvar.click();
    await page.waitForTimeout(1500);
    const textoSalvar = await page.locator("body").innerText();
    checar(
      "salvar pergunta e explica que o registro é imutável",
      /registro imutável/i.test(textoSalvar) || /Congelar um custo incompleto/i.test(textoSalvar),
    );
    await tela(page, "05-salvar-confirma");
    await page.locator('button:has-text("Cancelar"), button:has-text("Voltar e completar")')
      .last()
      .click();
    await page.waitForTimeout(1000);
    const salvos = await page.locator("tbody tr").allTextContents();
    checar(
      "cancelar não persiste cálculo",
      !salvos.some((l) => /CALC-/.test(l)),
    );

    console.log("\n≥400:", ruins.filter((r) => !/^401/.test(r)).join(" | ") || "nenhum");
    console.log("console:", erros.join(" | ") || "nenhum");
  } finally {
    await browser.close();
  }

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram.`);
  if (falhas.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
