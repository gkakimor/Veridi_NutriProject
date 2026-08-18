import { createRequire } from "node:module";
import fs from "node:fs";
const req = createRequire("c:/Users/rdpuser/Documents/VeridiProject/Veridi/package.json");
const { chromium } = req("@playwright/test");
const c = JSON.parse(fs.readFileSync("c:/Users/rdpuser/Documents/VeridiProject/Veridi/.local-data/dev-admin.json", "utf8"));
const WEB = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:3333";
let falhou = 0;
const ok = (n, v, d = "") => { if (!v) falhou++; console.log(`${v ? "OK " : "FALHOU"} ${n}${d ? " - " + d : ""}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const erros = [], http = [];
page.on("console", (m) => m.type() === "error" && erros.push(m.text().slice(0, 90)));
page.on("response", (r) => r.status() >= 400 && http.push(`${r.status()} ${(r.url().split("3333")[1] ?? "").slice(0, 50)}`));

await page.goto(WEB, { waitUntil: "networkidle" });
await page.fill("#login-email", c.email);
await page.fill("#login-password", c.password);
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);

const login = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) });
const cookie = login.headers.get("set-cookie").split(";")[0];
const get = async (u) => (await (await fetch(API + u, { headers: { cookie } })).json());

const pedido = (await get("/customer-orders?pageSize=1")).customerOrders[0];
const op = (await get("/production-orders?pageSize=1")).productionOrders[0];
const amostra = (await get("/project-samples?pageSize=1")).samples[0];

// C. Pedido -> OP
await page.goto(`${WEB}/comercial/pedidos/${pedido.id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const corpoPedido = await page.locator("body").innerText();
ok("pedido tem bloco de ordens de producao", (await page.locator("th", { hasText: /^Planejado$/i }).count()) > 0);
const linkOP = page.getByRole("link", { name: new RegExp(op.code) }).first();
ok("pedido lista a OP com link", (await linkOP.count()) > 0);
ok("pedido mostra produzido", (await page.locator("th", { hasText: /^Produzido$/i }).count()) > 0);
if (await linkOP.count()) {
  await linkOP.click();
  await page.waitForTimeout(1500);
  ok("link da OP abre a ordem", page.url().includes(`/producao/ordens/${op.id}`), page.url().replace(WEB, ""));
}

// OP -> Pedido/Cliente
const corpoOP = await page.locator("body").innerText();
ok("OP mostra pedido do cliente", /Pedido do cliente/.test(corpoOP));
const voltaPedido = page.getByRole("link", { name: new RegExp(pedido.code) }).first();
ok("OP liga de volta ao pedido", (await voltaPedido.count()) > 0);
ok("OP mostra cliente com link", (await page.locator('.definition-list a.entity-link[href*="/cadastros/clientes"]').count()) > 0);

// E. OP concluida nao pede compra
if (op.status === "COMPLETED") {
  ok("OP concluida sem CTA de compra", !/Ir para compras/i.test(corpoOP));
  ok("falta apresentada como historico", !/FALTA/.test(corpoOP) || /ordem j[áa] foi encerrada/i.test(corpoOP));
}

// Lista de OPs: cliente e pedido
await page.goto(`${WEB}/producao/ordens`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
ok("lista de OPs mostra o pedido", (await page.getByRole("link", { name: new RegExp(pedido.code) }).count()) > 0);
ok("lista de OPs mostra o cliente", (await page.locator('td a.entity-link[href*="/cadastros/clientes"]').count()) > 0);

// B. Amostra -> Produto
await page.goto(`${WEB}/comercial/amostras`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
ok("lista de amostras tem coluna Produto", (await page.locator("th", { hasText: "Produto" }).count()) > 0);
const linkProduto = page.locator('td a.entity-link[href*="productId="]').first();
ok("amostra liga ao produto", (await linkProduto.count()) > 0);
await page.goto(`${WEB}/comercial/amostras/${amostra.id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
ok("detalhe da amostra mostra produto testado", /Produto testado/.test(await page.locator("body").innerText()));

// G. Lotes em 1366: status e acao visiveis
await page.goto(`${WEB}/estoque/lotes`, { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
const larguraViewport = 1366;
const medidas = await page.evaluate(() => {
  const linha = document.querySelector("table tbody tr");
  if (!linha) return null;
  const celulas = [...linha.children];
  const acao = celulas[celulas.length - 1].getBoundingClientRect();
  const cabecalhos = [...document.querySelectorAll("table thead th")].map((h) => h.textContent.trim());
  const status = celulas[cabecalhos.indexOf("Status")]?.getBoundingClientRect();
  const container = document.querySelector(".table-container");
  return {
    acaoDireita: acao.right, acaoEsquerda: acao.left,
    statusDireita: status ? status.right : null,
    rolavel: container.scrollWidth > container.clientWidth + 1,
  };
});
if (medidas) {
  ok("acao do lote visivel em 1366", medidas.acaoEsquerda < larguraViewport && medidas.acaoDireita <= larguraViewport + 2, JSON.stringify(medidas));
  ok("status do lote visivel em 1366", medidas.statusDireita !== null && medidas.statusDireita <= larguraViewport);
}

// H. Projetos: destino explicito
await page.goto(`${WEB}/comercial/projetos`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const primeiroLink = page.locator("tbody tr td:first-child a.entity-link").first();
ok("projeto e o link da propria linha", (await primeiroLink.count()) > 0);
if (await primeiroLink.count()) {
  await primeiroLink.click();
  await page.waitForTimeout(1500);
  ok("clicar no projeto abre o projeto", /\/comercial\/projetos\/[0-9a-f-]{10,}/.test(page.url()), page.url().replace(WEB, ""));
}

// F. Combobox por teclado
await page.goto(`${WEB}/comercial/projetos`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /Novo projeto/ }).click();
await page.waitForTimeout(800);
const combo = page.locator("#project-customer");
await combo.click();
await page.waitForTimeout(500);
let achouCriar = false;
await combo.fill("Cliente Inexistente Zebra");
await page.waitForTimeout(600);
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("ArrowDown");
  const ativo = await combo.getAttribute("aria-activedescendant");
  if (ativo && ativo.endsWith("-create")) { achouCriar = true; break; }
}
ok("cadastro alcancado pelo teclado", achouCriar);
if (achouCriar) {
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  ok("Enter abre o cadastro de cliente", (await page.locator("#customer-legal-name").count()) > 0);
}

console.log("\nerros de console:", erros.length ? [...new Set(erros)].slice(0, 4) : "nenhum");
console.log("respostas >=400:", http.length ? [...new Set(http)].slice(0, 4) : "nenhuma");
console.log(falhou === 0 ? "\nRESULTADO: PASS" : `\nRESULTADO: ${falhou} falha(s)`);
await browser.close();
