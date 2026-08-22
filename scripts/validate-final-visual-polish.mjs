import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação pela interface do polimento visual final.
 *
 * Fixture própria: uma relação Item × Fornecedor nova, com observação na
 * relação e na oferta, e um recurso industrial novo. Nada dos três casos
 * históricos é lido ou alterado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-final-visual-polish.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = JSON.parse(
  fs.readFileSync(new URL("../.local-data/dev-admin.json", import.meta.url), "utf8"),
);

const marca = `VP${Date.now().toString().slice(-8)}`;
const NOTA_OFERTA = `Observação da oferta ${marca} — texto de frase inteira que precisa ser lido de volta.`;
const NOTA_RELACAO = `Condição negociada ${marca}: prazo 30 dias, contato comercial por e-mail.`;
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
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status} ${text.slice(0, 300)}`);
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
  await page.screenshot({ path: path.join(OUT, `polish-${nome}.png`), fullPage: true });
}

async function entrar(page) {
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
}

async function montarCenario() {
  const item = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `Material polimento ${marca}`,
    unitCode: "kg",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
  });
  const fornecedor = await api("POST", "/suppliers", { legalName: `Fornecedor ${marca}` });
  const relacao = await api("POST", "/supplier-items", {
    itemId: item.id,
    supplierId: fornecedor.id,
    qualificationStatus: "APPROVED",
    preferred: true,
    commercialNotes: NOTA_RELACAO,
    initialOffer: {
      unitPrice: "42",
      currencyCode: "BRL",
      priceUomCode: "kg",
      minimumOrderQuantity: "1",
      minimumOrderUomCode: "kg",
      effectiveAt: new Date().toISOString(),
      notes: NOTA_OFERTA,
    },
  });
  const recurso = await api("POST", "/industrial-resources", {
    name: `Recurso polimento ${marca}`,
    type: "EQUIPMENT",
    unitCode: "hora",
  });
  return { item, relacao, recurso };
}

/** Conta controles cujo texto é só "Fechar" (com ou sem o ✕). */
async function controlesFechar(page) {
  return page.evaluate(() => {
    const raiz = document.querySelector(".modal-fullscreen, [role=dialog], .modal") ?? document.body;
    return [...raiz.querySelectorAll("button")]
      .filter((b) => /^\s*(✕\s*)?fechar\s*$/i.test(b.innerText.replace(/\s+/g, " ")))
      .map((b) => b.innerText.replace(/\s+/g, " ").trim());
  });
}

async function main() {
  await api("POST", "/auth/login", credentials);
  const cenario = await montarCenario();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const ruins = [];
  page.on("response", (r) => {
    if (r.status() >= 400) ruins.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  try {
    await entrar(page);

    /* ── Item × Fornecedor: abrir a relação ── */
    await page.goto(`${WEB}/compras/item-fornecedor`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const busca = page.locator('main input[type="search"]').first();
    await busca.fill(cenario.item.code);
    await page.waitForTimeout(2000);
    await page.locator("main table tbody tr").first().locator("td").nth(3).click();
    await page.waitForTimeout(2500);

    const texto = await page.locator("body").innerText();
    checar("a observação da oferta é lida na tabela de ofertas", texto.includes(NOTA_OFERTA));
    // A observação da relação vive num textarea: o valor não entra no
    // innerText da página, então se lê o campo.
    const notaRelacao = await page.locator("#detail-commercial-notes").inputValue();
    const campoMultilinha = await page.evaluate(
      () => document.querySelector("#detail-commercial-notes")?.tagName,
    );
    checar(
      "a observação comercial é lida inteira, em campo multilinha",
      notaRelacao === NOTA_RELACAO && campoMultilinha === "TEXTAREA",
      `${campoMultilinha} · ${notaRelacao.slice(0, 60)}`,
    );
    // Nada relevante escondido só em title.
    const notaEmTitle = await page.evaluate(
      (nota) => [...document.querySelectorAll("[title]")].some((e) => (e.getAttribute("title") ?? "").includes(nota)),
      NOTA_OFERTA,
    );
    checar("a observação não fica presa num title", !notaEmTitle);
    await tela(page, "01-observacoes");

    /* ── Um único "Fechar" na composição ── */
    const fechar = await controlesFechar(page);
    checar("a composição tem um único controle textual de fechar", fechar.length === 1, JSON.stringify(fechar));

    /* ── Inativar relação: peso, separação e confirmação ── */
    const inativar = page.getByRole("button", { name: "Inativar relação" }).first();
    const classes = await inativar.getAttribute("class");
    checar("inativar usa a variante destrutiva existente", (classes ?? "").includes("btn--danger"), classes ?? "");
    checar("inativar está separada das ações de rotina", (classes ?? "").includes("btn--set-apart"));
    const preferencial = await page
      .getByRole("button", { name: /preferencial/ })
      .first()
      .getAttribute("class");
    checar(
      "nenhuma ação de rotina pesa mais que inativar",
      !(preferencial ?? "").includes("btn--accent"),
      preferencial ?? "",
    );

    await inativar.click();
    await page.waitForTimeout(1800);
    const dialogo = await page.locator("body").innerText();
    checar("inativar pergunta antes", /Inativar esta relação\?/.test(dialogo));
    checar("a confirmação explica a consequência", /sai do sourcing/.test(dialogo));
    checar("não promete exclusão", !/Excluir|Remover permanentemente|Apagar/.test(dialogo));
    await tela(page, "02-inativar-relacao");

    // Cancelar: nada é inativado nesta validação.
    await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
    await page.waitForTimeout(1800);
    const depois = await api("GET", `/supplier-items/${cenario.relacao.id}`);
    checar("cancelar não inativou a relação", depois.active === true);

    /* ── Recurso industrial: a mesma família, na tela vizinha ── */
    await page.goto(`${WEB}/gestao/recursos-industriais/${cenario.recurso.id}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2500);
    const inativarRecurso = page.getByRole("button", { name: "Inativar recurso" }).first();
    const classeRecurso = await inativarRecurso.getAttribute("class");
    checar(
      "inativar recurso deixou de ser ação de rotina",
      (classeRecurso ?? "").includes("btn--danger"),
      classeRecurso ?? "",
    );
    await inativarRecurso.click();
    await page.waitForTimeout(1800);
    const dlgRecurso = await page.locator("body").innerText();
    checar("inativar recurso pergunta antes", /Inativar este recurso\?/.test(dlgRecurso));
    checar("e diz a consequência real", /pendência bloqueante/.test(dlgRecurso));
    await tela(page, "03-inativar-recurso");
    await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
    await page.waitForTimeout(1500);
    const recursoDepois = await api("GET", `/industrial-resources/${cenario.recurso.id}`);
    checar("cancelar não inativou o recurso", recursoDepois.active === true);

    console.log("\n≥400:", ruins.filter((r) => !/^40[013]/.test(r)).join(" | ") || "nenhum");
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
