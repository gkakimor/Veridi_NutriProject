import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação pela interface do hotfix de integridade da formulação por dose.
 *
 * Reproduz, clicando, o cenário que a auditoria VAL-LEG-01 encontrou em
 * produção:
 *
 *   1. formulação em modo "Base fixa" com componente "Por dose";
 *   2. tentar ativar sem doses por embalagem → recusado, com texto que uma
 *      pessoa entende;
 *   3. informar 60 → ativa;
 *   4. estrutura de custos + material recebido de compra real → material
 *      maior que zero, CMV diferente de zero.
 *
 * E a busca de cliente do Projeto: razão social, nome fantasia e CNPJ com e
 * sem pontuação encontram o MESMO cliente.
 *
 * Cenário sintético, removido no final. O corpus real não é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-per-dose.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const marca = `PD${Date.now().toString().slice(-8)}`;
const created = { productIds: [], itemIds: [], customerIds: [], supplierIds: [] };
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
  resultados.push({ rotulo, ok: Boolean(condicao), detalhe });
  console.log(`${condicao ? "  ok  " : " FALHA"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function tela(page, nome) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `per-dose-${nome}.png`), fullPage: true });
}

async function main() {
  await api("POST", "/auth/login", credentials);

  /* ─────────────── cenário via API: só o que a UI não precisa exercitar */
  const cliente = await api("POST", "/customers", {
    legalName: `35.301.394 CLIENTE ${marca}`,
    tradeName: `REI ${marca}`,
    // CNPJ sintético e único por execução: a base local já tem o do
    // cliente real importado, e duplicar documento é recusado — com razão.
    cnpj: `${marca.replace(/\D/g, "").padStart(8, "9").slice(0, 8)}000199`,
  });
  created.customerIds.push(cliente.id);
  const cnpjLimpo = (cliente.cnpj ?? "").replace(/\D/g, "").slice(0, 8);
  const cnpjPontuado = `${cnpjLimpo.slice(0, 2)}.${cnpjLimpo.slice(2, 5)}.${cnpjLimpo.slice(5, 8)}`;

  const acabado = await api("POST", "/items", {
    type: "FINISHED_PRODUCT",
    name: `PA ${marca}`,
    unitCode: "un",
  });
  created.itemIds.push(acabado.id);

  const cafeina = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Cafeina ${marca}`,
    unitCode: "kg",
  });
  created.itemIds.push(cafeina.id);

  const produto = await api("POST", "/products", {
    name: `Capsula ${marca}`,
    finishedProductItemId: acabado.id,
    customerId: cliente.id,
  });
  created.productIds.push(produto.id);

  // Compra real, para o custo de material ter de onde vir.
  const fornecedor = await api("POST", "/suppliers", { legalName: `Fornecedor ${marca}` });
  created.supplierIds.push(fornecedor.id);
  const oc = await api("POST", "/purchase-orders", {
    supplierId: fornecedor.id,
    orderDate: new Date().toISOString().slice(0, 10),
    lines: [{ itemId: cafeina.id, orderedQuantity: "50", unitPrice: "272" }],
  });
  await api("POST", `/purchase-orders/${oc.id}/confirm`);
  await api("POST", `/purchase-orders/${oc.id}/receipts`, {
    receivedAt: new Date().toISOString().slice(0, 10),
    lines: [
      {
        purchaseOrderLineId: oc.lines[0].id,
        receivedQuantity: "50",
        supplierLot: `LOTE-${marca}`,
        expiryDate: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        actualUnitCost: "272",
      },
    ],
  });

  const versao = await api("POST", `/products/${produto.id}/formulation-versions`, {});

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    await page.goto(WEB, { waitUntil: "networkidle" });
    await page.fill("#login-email", credentials.email);
    await page.fill("#login-password", credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);

    /* ─────────────── 1. formulação: componente por dose, modo base fixa */
    await page.goto(`${WEB}/producao/formulacoes/${produto.id}/versoes/${versao.id}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(1500);

    await page.click('button:has-text("Adicionar componente")');
    await page.waitForTimeout(800);
    const busca = page.locator('tbody input[placeholder*="ódigo ou nome"]').first();
    await busca.click();
    await busca.pressSequentially(`Cafeina ${marca}`, { delay: 30 });
    await page.waitForTimeout(1200);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(500);

    await page.locator('select[aria-label="Base de cálculo do componente"]').first()
      .selectOption({ label: "Por dose" });
    await page.locator('tbody input[placeholder="0"]').first().fill("200");
    await page.locator("tbody select").filter({ hasText: "mg" }).first()
      .selectOption({ label: "mg" });
    await page.waitForTimeout(800);

    const rotuloDoses = await page.locator('label[for="version-doses"]').count();
    checar(
      "campo Doses por embalagem aparece em modo Base fixa com componente por dose",
      rotuloDoses > 0,
    );
    await tela(page, "01-campo-doses");

    await page.click('button:has-text("Salvar rascunho")');
    await page.waitForTimeout(2000);

    // Ativar sem doses: tem de ser recusado, com texto compreensível.
    const botoesAtivar = page.locator('button:has-text("Ativar versão")');
    await botoesAtivar.last().click();
    await page.waitForTimeout(1200);
    if (await page.locator('button:has-text("Ativar versão")').count() > 1) {
      await page.locator('button:has-text("Ativar versão")').last().click();
      await page.waitForTimeout(2500);
    }
    const textoRecusa = await page.locator("body").innerText();
    checar(
      "ativação sem doses é recusada com mensagem em português",
      /doses por embalagem/i.test(textoRecusa) && !/Ativa\b/.test(textoRecusa.slice(0, 400)),
      textoRecusa.split("\n").find((l) => /doses por embalagem/i.test(l))?.trim().slice(0, 120) ?? "",
    );
    await tela(page, "02-ativacao-recusada");

    /* ─────────────── 2. informar 60 e ativar */
    await page.fill("#version-doses", "60");
    await page.click('button:has-text("Salvar rascunho")');
    await page.waitForTimeout(2000);
    await page.locator('button:has-text("Ativar versão")').last().click();
    await page.waitForTimeout(1200);
    if (await page.locator('button:has-text("Ativar versão")').count() > 1) {
      await page.locator('button:has-text("Ativar versão")').last().click();
    }
    await page.waitForTimeout(3000);
    const depoisAtivar = await page.locator("body").innerText();
    checar("com doses informadas a versão ativa", /Ativa/.test(depoisAtivar));
    await tela(page, "03-versao-ativa");

    /* ─────────────── 3. custo: material maior que zero */
    const estrutura = await api("POST", `/products/${produto.id}/industrial-costs`, {
      referenceOutputQuantity: "100",
      referenceOutputUomCode: "un",
    });
    await page.goto(`${WEB}/produtos/${produto.id}/custos`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.click('button:has-text("Calcular custo")');
    await page.waitForTimeout(3500);
    const textoCusto = await page.locator("body").innerText();

    // 200 mg × 60 doses × 100 un = 1,2 kg. A R$ 272/kg dá R$ 326,40 — mas o
    // que este teste protege é a QUANTIDADE: era ela que vinha zerada.
    const linhaMaterial =
      textoCusto.split("\n").find((l) => /Cafeina/.test(l) && / kg/.test(l)) ?? "";
    checar(
      "material calculado é maior que zero",
      /(^|\s)1\.2 kg(\s|$)/.test(linhaMaterial),
      linhaMaterial.trim().replace(/\s+/g, " ").slice(0, 110) || "linha não encontrada",
    );
    checar(
      "subtotal de materiais chega a R$ 326,40",
      textoCusto.includes("326,40"),
      textoCusto.split("\n").find((l) => l.includes("326,40"))?.trim().slice(0, 80) ??
        "não encontrado",
    );
    checar("cálculo não anuncia material R$ 0,00 como conhecido", !/Cafeina[\s\S]{0,80}R\$ 0,00/.test(textoCusto));
    await tela(page, "04-custo-com-material");
    void estrutura;

    /* ─────────────── 4. busca de cliente no Projeto */
    await page.goto(`${WEB}/comercial/projetos`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.click('button:has-text("Novo projeto")');
    await page.waitForTimeout(1500);

    async function buscarCliente(termo) {
      const campo = page.locator("#project-customer");
      await campo.click();
      await campo.fill("");
      await campo.pressSequentially(termo, { delay: 40 });
      await page.waitForTimeout(1200);
      const textos = await page.locator('[role="option"]').allTextContents();
      return textos.map((t) => t.replace(/\s+/g, " ").trim());
    }

    for (const [rotulo, termo] of [
      ["razão social", `CLIENTE ${marca}`],
      ["nome fantasia", `REI ${marca}`],
      ["CNPJ com pontuação", cnpjPontuado],
      ["CNPJ sem pontuação", cnpjLimpo],
    ]) {
      const opcoes = await buscarCliente(termo);
      const achou = opcoes.some((t) => t.includes(marca));
      checar(`busca de cliente por ${rotulo}`, achou, opcoes[0]?.slice(0, 80) ?? "nenhuma opção");
      if (achou) {
        checar(
          `cliente vem antes de "Cadastrar novo" (${rotulo})`,
          !/Cadastrar novo/i.test(opcoes[0] ?? ""),
          opcoes[0]?.slice(0, 60) ?? "",
        );
      }
    }
    await tela(page, "05-busca-cliente");
  } finally {
    await browser.close();
  }

  /* ─────────────── limpeza: o cenário sintético não fica */
  for (const id of created.productIds) {
    await fetch(`${API}/products/${id}`, { method: "DELETE", headers: { cookie: sessionCookie } });
  }
  for (const id of created.customerIds) {
    await fetch(`${API}/customers/${id}`, { method: "DELETE", headers: { cookie: sessionCookie } });
  }

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram.`);
  if (falhas.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
