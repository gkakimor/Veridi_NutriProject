import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * VALIDAÇÃO ADVERSARIAL — ESTOQUE E SUPRIMENTOS.
 *
 * Rodada de VALIDAÇÃO, não de implementação: defeito encontrado é RELATADO,
 * nunca consertado. Nenhuma linha de código de produto é tocada por este
 * arquivo.
 *
 * ## A regra
 *
 * Cadastro e operação de negócio NASCEM PELA INTERFACE. Fora da tela só
 * existem `POST /auth/login` (uma vez, para o cookie do navegador) e leituras
 * `GET` de conferência — sempre DEPOIS da ação, para conferir saldo, contar
 * movimentos e provar invariante. Nunca para fabricar o resultado esperado.
 *
 * ## Massa: dado real da Veridi
 *
 * A cadeia usa o item 260 das planilhas — Carbonato de cálcio — e os três
 * recebimentos reais dele, que já vêm com validades diferentes:
 *
 *   50 kg · validade 2022-07-31 · lote do fornecedor 857189
 *   25 kg · validade 2023-07-31 · lote do fornecedor 857189
 *   25 kg · validade 2027-07-31 · lote do fornecedor 862883
 *
 * Hoje é 2026-09: os dois primeiros estão VENCIDOS e o terceiro é válido.
 * Isso dá o lote expirado sem inventar validade — e sem burlar a regra do
 * domínio, que exige validade >= data do recebimento (os recebimentos reais
 * são de 2022, e a validade de 2022/2023 é posterior a eles).
 *
 * Dois lotes válidos adicionais (2027-12-31 e 2028-07-31) existem porque o
 * FEFO só é testável com TRÊS lotes elegíveis; a validade deles é a parte
 * sintética, e está declarada como tal no relatório. Quantidade, preço e
 * lote de fornecedor continuam vindo da planilha.
 *
 * Preços reais do mesmo item, um por lote: 4,29 · 5,50 · 6,50 · 10,00 · 15,00
 * por kg. Saldo real do item: 31,095548 kg — seis casas decimais, e é essa a
 * quantidade usada na necessidade do FEFO, porque saldo redondo esconde erro
 * de arredondamento.
 *
 * PRIVACIDADE: nenhum CNPJ, telefone, e-mail ou endereço real entra em log,
 * screenshot ou relatório. Fornecedor e item nascem com nome sintético
 * prefixado `ADV`; o que se reproduz da planilha é quantidade, validade,
 * preço e lote do fornecedor — que é o que prova o teste.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-adversarial-stock.mjs
 *   ... --ate=6      para depois do marco 6
 *   ... --reset      ignora o estado e recomeça
 */

const OUT = "handoff/screens/adversarial";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

const STATE_FILE = path.resolve("handoff/adversarial-stock-state.json");
const RESET = process.argv.includes("--reset");
const ATE = Number(
  (process.argv.find((a) => a.startsWith("--ate=")) ?? "--ate=99").slice("--ate=".length),
);

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

const S =
  !RESET && fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    : { marcos: [], dados: {}, iniciadoEm: new Date().toISOString() };

S.registro = S.registro ?? {};
S.registro.verificacoes = S.registro.verificacoes ?? { ok: [], nok: [] };
S.registro.casos = S.registro.casos ?? [];
S.registro.negativos = S.registro.negativos ?? [];
S.registro.findings = S.registro.findings ?? [];
S.registro.observacoes = S.registro.observacoes ?? [];
S.registro.separadores = S.registro.separadores ?? [];

function acumular(lista, itens, chave) {
  for (const item of itens) {
    const id = chave(item);
    const i = lista.findIndex((x) => chave(x) === id);
    if (i >= 0) lista[i] = item;
    else lista.push(item);
  }
}

function salvarEstado() {
  acumular(S.registro.casos, casos, (c) => c.caso);
  acumular(S.registro.negativos, negativos, (n) => n.caso);
  acumular(S.registro.findings, findings, (f) => f.titulo);
  acumular(S.registro.observacoes, observacoes, (o) => o);
  acumular(S.registro.separadores, separadores, (s) => `${s.campo}::${s.digitado}`);
  fs.writeFileSync(STATE_FILE, JSON.stringify(S, null, 2));
}

// ── Sessão técnica (única escrita fora da UI: o login) ─────────────────────
let cookie = "";

async function apiGet(url) {
  const r = await fetch(`${API}${url}`, { headers: cookie ? { cookie } : {} });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CRED),
  });
  if (!r.ok) throw new Error(`login → ${r.status} ${(await r.text()).slice(0, 240)}`);
  const sc = r.headers.get("set-cookie");
  if (!sc) throw new Error("login não devolveu set-cookie");
  cookie = sc.split(";")[0];
}

// ── Veredito ──────────────────────────────────────────────────────────────
const failures = [];
const passes = [];

function registrarVerificacao(label, passou) {
  const reg = S.registro.verificacoes;
  const lista = passou ? reg.ok : reg.nok;
  const oposta = passou ? reg.nok : reg.ok;
  const i = oposta.indexOf(label);
  if (i >= 0) oposta.splice(i, 1);
  if (!lista.includes(label)) lista.push(label);
}

function check(label, condition, detail = "") {
  registrarVerificacao(label, Boolean(condition));
  if (condition) {
    passes.push(label);
    console.log("ok  ", label);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log("FALHOU", label, detail ? `— ${detail}` : "");
  }
  return Boolean(condition);
}

const observacoes = [];
function anotar(texto) {
  observacoes.push(texto);
  console.log("  ·", texto);
}

const findings = [];
function finding(severidade, titulo, comoReproduzir) {
  findings.push({ severidade, titulo, comoReproduzir });
  console.log(`  ⚑ ${severidade} — ${titulo}`);
}

/** PRE / AÇÃO / ESPERADO / REAL / INVARIANTE — a matriz pedida. */
const casos = [];
function registrarCaso(caso, { pre, acao, esperado, real, invariante, veredito }) {
  const r = { caso, pre, acao, esperado, real, invariante, veredito };
  casos.push(r);
  console.log(`  ▣ ${caso} :: ${veredito}`);
  return r;
}

/** BLOCKED_CORRECTLY ou BUG — nunca "deu erro". */
const negativos = [];
function registrarNegativo(caso, veredito, detalhe) {
  negativos.push({ caso, veredito, detalhe });
  console.log(`  ⛔ ${caso} :: ${veredito} — ${detalhe}`);
}

const separadores = [];

// ══ Massa ═════════════════════════════════════════════════════════════════
const P = "ADV";

/** CNPJ sintético com dígitos verificadores válidos; empresa inexistente. */
const FORNECEDOR = {
  legalName: `${P} Insumos Minerais LTDA`,
  tradeName: `${P} Fornecedor Insumos`,
  cnpj: "99.000.111/0001-65",
};

/**
 * Item 260 da planilha — Carbonato de cálcio. Controla lote, controla
 * validade e exige liberação de Qualidade: é o item que exercita os três
 * caminhos ao mesmo tempo.
 */
const MP = {
  nome: `${P} Carbonato de calcio`,
  tipo: "RAW_MATERIAL",
  unidade: "kg",
  controlaLote: true,
  controlaValidade: true,
  exigeLiberacao: true,
};

/** Existe para um caso só: item inativo reaproveitado em operação nova. */
const MP_INATIVA = {
  nome: `${P} Celulose 101 descontinuada`,
  tipo: "RAW_MATERIAL",
  unidade: "kg",
  controlaLote: true,
  controlaValidade: false,
  exigeLiberacao: false,
};

/**
 * As cinco compras. As três primeiras são linhas reais da planilha, com data
 * de compra, quantidade, validade, lote do fornecedor e preço do próprio
 * item 260. As duas últimas repetem quantidade/preço reais do mesmo item e
 * têm validade futura sintética — sem elas não há três lotes ELEGÍVEIS, e
 * sem três lotes elegíveis o FEFO não é testável.
 */
const COMPRAS = [
  {
    id: "A",
    quantidade: "50",
    preco: "4.29",
    recebidoEm: "2022-06-02",
    validade: "2022-07-31",
    loteFornecedor: "857189",
    nf: "218027",
    real: true,
    parcial: ["20", "30"],
  },
  {
    id: "B",
    quantidade: "25",
    preco: "5.50",
    recebidoEm: "2022-05-17",
    validade: "2023-07-31",
    loteFornecedor: "857189",
    nf: "217150",
    real: true,
  },
  {
    id: "C",
    quantidade: "25",
    preco: "6.50",
    recebidoEm: "2022-09-26",
    validade: "2027-07-31",
    loteFornecedor: "862883",
    nf: "223984",
    real: true,
  },
  {
    id: "D",
    quantidade: "25",
    preco: "10.00",
    recebidoEm: "2026-01-15",
    validade: "2027-12-31",
    loteFornecedor: "ADV-863208",
    nf: "ADV-0001",
    real: false,
  },
  {
    id: "E",
    quantidade: "50",
    preco: "15.00",
    recebidoEm: "2026-03-20",
    validade: "2028-07-31",
    loteFornecedor: "ADV-870001",
    nf: "ADV-0002",
    real: false,
  },
];

/** Saldo real do item 260 na planilha — seis casas, de propósito. */
const SALDO_REAL = "31.095548";

// ── Instrumentação de navegador ───────────────────────────────────────────
const consoleErrors = [];
const pageErrors = [];
const avisosDeRede = [];
const respostasComErro = [];
let janelaDeliberada = null;
const deliberados = { console: [], rede: [], pageerror: [] };
const dialogosNativos = [];

let browser;
let context;
let page;

async function abrirNavegador() {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const corte = cookie.indexOf("=");
  await context.addCookies([
    {
      name: cookie.slice(0, corte),
      value: cookie.slice(corte + 1),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  page = await context.newPage();

  page.on("dialog", async (d) => {
    dialogosNativos.push(`${d.type()}: ${d.message().slice(0, 200)} @ ${page.url()}`);
    await d.accept();
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const texto = `${m.text().slice(0, 240)} @ ${page.url()}`;
    if (/^Failed to load resource/.test(m.text())) {
      avisosDeRede.push(texto);
      return;
    }
    if (janelaDeliberada) deliberados.console.push(`[${janelaDeliberada}] ${texto}`);
    else consoleErrors.push(texto);
  });
  page.on("pageerror", (e) => {
    const texto = `pageerror @ ${page.url()} :: ${e.message.slice(0, 240)}`;
    if (janelaDeliberada) deliberados.pageerror.push(`[${janelaDeliberada}] ${texto}`);
    else pageErrors.push(texto);
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    const registro = {
      pathname: new URL(res.url()).pathname,
      method: res.request().method(),
      status: res.status(),
      janela: janelaDeliberada,
    };
    if (janelaDeliberada) deliberados.rede.push(registro);
    else respostasComErro.push(registro);
  });
}

/**
 * Executa `fn` marcando toda falha de console/rede como DELIBERADA.
 *
 * Num teste adversarial a maioria dos 400 é o comportamento correto; sem
 * esta separação o relatório de console viraria ruído e esconderia o erro
 * que não era para acontecer.
 */
async function deliberadamente(rotulo, fn) {
  janelaDeliberada = rotulo;
  try {
    return await fn();
  } finally {
    janelaDeliberada = null;
  }
}

/** Respostas >=400 capturadas dentro de uma janela deliberada, por rótulo. */
function errosDeliberados(rotulo) {
  return deliberados.rede.filter((r) => r.janela === rotulo);
}

const screenshots = [];
const shot = async (nome) => {
  await page.waitForTimeout(250);
  const destino = path.join(OUT, `${nome}.png`);
  await page.screenshot({ path: destino, fullPage: false });
  screenshots.push(path.resolve(destino));
  return destino;
};

// ── Navegação ─────────────────────────────────────────────────────────────
async function abrir(rota, { espera = ".page__title, .consult-head, .doc-title", ms = 30000 } = {}) {
  await page.goto(`${WEB}${rota}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector(espera, { timeout: ms });
  } catch {
    /* quem chamou julga */
  }
  await page.waitForTimeout(250);
}

const caminho = () => new URL(page.url()).pathname;

async function esperarUrl(testar, timeout = 20000) {
  const limite = Date.now() + timeout;
  while (Date.now() < limite) {
    if (testar(new URL(page.url()))) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function clicarBotao(texto, { timeout = 15000, indice = 0 } = {}) {
  const alvo = page.getByRole("button", { name: texto, exact: true }).nth(indice);
  await alvo.waitFor({ state: "visible", timeout });
  await alvo.click();
  await page.waitForTimeout(400);
}

async function existeBotao(texto) {
  return (await page.getByRole("button", { name: texto, exact: true }).count()) > 0;
}

async function preencher(seletor, valor) {
  const el = typeof seletor === "string" ? page.locator(seletor).first() : seletor;
  await el.waitFor({ state: "visible", timeout: 15000 });
  await el.fill(String(valor));
  await page.waitForTimeout(80);
}

async function texto(seletor) {
  const el = typeof seletor === "string" ? page.locator(seletor).first() : seletor;
  if ((await el.count()) === 0) return "";
  return ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

async function textos(seletor) {
  const loc = typeof seletor === "string" ? page.locator(seletor) : seletor;
  return (await loc.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
}

async function mensagensDeErro() {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".form-alert, .field__error, .alert--error, [role='alert'], .toast--error, .doc-alert, .field__hint--error",
      ),
    ]
      .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
}

/**
 * Escolhe uma entidade num `SearchableEntitySelect`.
 *
 * A lista sai por PORTAL em `document.body` e a PRIMEIRA opção é sempre
 * "+ Novo <entidade>" — sem `:not(.entity-select__create)` o clique acerta o
 * cadastro e leva o formulário embora.
 */
async function escolherEntidade(seletorInput, termo, contem = termo) {
  const input = typeof seletorInput === "string" ? page.locator(seletorInput).first() : seletorInput;
  await input.waitFor({ state: "visible", timeout: 20000 });
  await input.click();
  await input.fill(termo);
  const opcao = page
    .locator("li.entity-select__option[role='option']:not(.entity-select__create)")
    .filter({ hasText: contem })
    .first();
  await opcao.waitFor({ state: "visible", timeout: 20000 });
  await opcao.click();
  await page.waitForTimeout(350);
  return input.inputValue();
}

/** Confirma um `ConfirmDialog`, com escopo no diálogo (nunca na página). */
async function confirmarDialogo(textoBotao) {
  const dialogo = page.locator(".confirm-dialog");
  await dialogo.waitFor({ state: "visible", timeout: 20000 });
  await dialogo.getByRole("button", { name: textoBotao, exact: true }).click();
  await page.waitForTimeout(900);
}

const marco = async (n, nome, fn) => {
  const chave = `${n}-${nome}`;
  if (S.marcos.includes(chave)) {
    console.log(`\n═══ MARCO ${n} · ${nome} — já concluído, pulando`);
    return;
  }
  if (n > ATE) {
    console.log(`\n═══ MARCO ${n} · ${nome} — além de --ate=${ATE}, parando`);
    throw new Error("__PARADA_SOLICITADA__");
  }
  console.log(`\n═══ MARCO ${n} · ${nome} ═══`);
  const antes = failures.length;
  await fn();
  salvarEstado();
  if (failures.length === antes) {
    S.marcos.push(chave);
    salvarEstado();
  } else {
    throw new Error(`__MARCO_FALHOU__ ${chave}`);
  }
};

// ── Leitura de conferência (sempre DEPOIS da ação) ────────────────────────
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

async function lerLotesDoItem(itemId) {
  const d = await apiGet(`/inventory/${itemId}`);
  return (d?.lots ?? []).map((l) => ({
    id: l.lotId ?? l.id,
    code: l.lotCode ?? l.code,
    status: l.status,
    isExpired: l.isExpired,
    expiryDate: (l.expiryDate ?? "").slice(0, 10),
    onHand: l.onHand,
    reserved: l.reserved,
    available: l.available,
  }));
}

/** Todas as páginas — a consulta limita `pageSize` a 100. */
async function lerMovimentos(itemId) {
  const tudo = [];
  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const d = await apiGet(`/inventory-movements?itemId=${itemId}&pageSize=100&page=${pagina}`);
    const lote = d?.movements ?? [];
    tudo.push(...lote);
    if (tudo.length >= (d?.total ?? tudo.length) || lote.length === 0) break;
  }
  return tudo.map((m) => ({
    id: m.id,
    lotCode: m.lotCode ?? null,
    type: m.type,
    quantity: m.quantity,
    occurredAt: (m.occurredAt ?? "").slice(0, 10),
    reason: m.reason ?? null,
  }));
}

/** O uuid da OC vem da URL do documento — nunca do rótulo A/B/C do roteiro. */
const idDaOc = (oc) => oc.url.split("/").pop();

async function lerRecebimentosDaOc(oc) {
  const d = await apiGet(`/receipts?purchaseOrderId=${idDaOc(oc)}&pageSize=50`);
  return d?.receipts ?? [];
}

/** Lotes gerados por uma OC — a contraprova de documento duplicado. */
async function lerLotesDaOc(oc) {
  const poId = idDaOc(oc);
  const d = await apiGet(`/lots?itemId=${S.dados.item.id}&pageSize=100`);
  return (d?.lots ?? []).filter((l) => l.purchaseOrderId === poId);
}

const totalDeOcs = async () => (await apiGet("/purchase-orders?pageSize=1")).total;

/** Foto completa do item — base de toda invariante deste roteiro. */
async function fotografar(rotulo) {
  const itemId = S.dados.item.id;
  const lotes = await lerLotesDoItem(itemId);
  const movimentos = await lerMovimentos(itemId);
  const foto = {
    rotulo,
    quando: new Date().toISOString(),
    lotes,
    totalMovimentos: movimentos.length,
    somaOnHand: lotes.reduce((a, l) => a + num(l.onHand), 0),
  };
  return foto;
}

function mesmaFoto(a, b) {
  if (!a || !b) return false;
  if (a.totalMovimentos !== b.totalMovimentos) return false;
  if (a.lotes.length !== b.lotes.length) return false;
  for (const l of a.lotes) {
    const o = b.lotes.find((x) => x.code === l.code);
    if (!o) return false;
    if (String(l.onHand) !== String(o.onHand)) return false;
    if (String(l.reserved) !== String(o.reserved)) return false;
    if (l.status !== o.status) return false;
  }
  return true;
}

function diffFoto(a, b) {
  const partes = [];
  if (a.totalMovimentos !== b.totalMovimentos) {
    partes.push(`movimentos ${a.totalMovimentos}→${b.totalMovimentos}`);
  }
  if (a.lotes.length !== b.lotes.length) partes.push(`lotes ${a.lotes.length}→${b.lotes.length}`);
  for (const l of a.lotes) {
    const o = b.lotes.find((x) => x.code === l.code);
    if (!o) {
      partes.push(`${l.code} sumiu`);
      continue;
    }
    if (String(l.onHand) !== String(o.onHand)) {
      partes.push(`${l.code} físico ${l.onHand}→${o.onHand}`);
    }
    if (String(l.reserved) !== String(o.reserved)) {
      partes.push(`${l.code} reservado ${l.reserved}→${o.reserved}`);
    }
    if (l.status !== o.status) partes.push(`${l.code} status ${l.status}→${o.status}`);
  }
  return partes.length ? partes.join(" · ") : "nada mudou";
}

/**
 * O molde de todo caminho proibido.
 *
 * Fotografa antes, executa a tentativa dentro de uma janela deliberada,
 * fotografa depois e só declara BLOCKED_CORRECTLY quando as duas fotos são
 * idênticas — "deu erro" sem essa comparação não prova ausência de escrita
 * parcial.
 */
async function caminhoProibido(caso, { pre, acao, esperado, invariante }, tentativa) {
  const antes = await fotografar(`antes:${caso}`);
  let resultadoDaTela = "";
  await deliberadamente(caso, async () => {
    resultadoDaTela = (await tentativa()) ?? "";
  });
  await page.waitForTimeout(600);
  const depois = await fotografar(`depois:${caso}`);
  const intacto = mesmaFoto(antes, depois);
  const mudou = diffFoto(antes, depois);
  const respostas = errosDeliberados(caso)
    .map((r) => `${r.method} ${r.pathname} → ${r.status}`)
    .join(" · ");

  const veredito = intacto ? "BLOCKED_CORRECTLY" : "BUG";
  registrarCaso(caso, {
    pre,
    acao,
    esperado,
    real: `${resultadoDaTela || "(sem mensagem na tela)"}${respostas ? ` [rede: ${respostas}]` : ""}`,
    invariante: intacto ? `${invariante} — confirmado, nada mudou` : `VIOLADA: ${mudou}`,
    veredito,
  });
  registrarNegativo(caso, veredito, intacto ? invariante : mudou);
  check(`NEGATIVO · ${caso} — bloqueado sem escrita parcial`, intacto, mudou);
  return { intacto, resultadoDaTela, respostas, antes, depois };
}

const hoje = () => new Date().toISOString().slice(0, 10);

// ══════════════════════════════════════════════════════════════════════════
// MARCO 1 · Cadastro pela tela
// ══════════════════════════════════════════════════════════════════════════
async function marco01Cadastro() {
  // ── Fornecedor ─────────────────────────────────────────────────────────
  const existentes =
    (await apiGet(`/suppliers?search=${encodeURIComponent(P)}&pageSize=20`)).suppliers ?? [];
  if (existentes.length > 0) {
    S.dados.fornecedor = { id: existentes[0].id, code: existentes[0].code };
    anotar(`FORNECEDOR · ${existentes[0].code} já existia — criação pulada`);
  } else {
    await abrir("/cadastros/fornecedores/novo");
    await preencher("#supplier-legal-name", FORNECEDOR.legalName);
    await preencher("#supplier-trade-name", FORNECEDOR.tradeName);
    await preencher("#supplier-cnpj", FORNECEDOR.cnpj);
    await clicarBotao("Criar fornecedor");
    const voltou = await esperarUrl((u) => u.pathname === "/cadastros/fornecedores", 25000);
    if (!check("CADASTRO · fornecedor criado pela tela", voltou, JSON.stringify(await mensagensDeErro()))) {
      return;
    }
    const lidos =
      (await apiGet(`/suppliers?search=${encodeURIComponent(P)}&pageSize=20`)).suppliers ?? [];
    S.dados.fornecedor = { id: lidos[0]?.id, code: lidos[0]?.code };
    check(
      "CADASTRO · o fornecedor recebeu código FOR da sequência do domínio (não inventado)",
      /^FOR-\d+$/.test(lidos[0]?.code ?? ""),
      lidos[0]?.code,
    );
  }

  // ── Itens ──────────────────────────────────────────────────────────────
  const criarItem = async (spec) => {
    const jaTem = (
      (await apiGet(`/items?search=${encodeURIComponent(spec.nome)}&pageSize=10`)).items ?? []
    ).find((i) => i.name === spec.nome);
    if (jaTem) {
      anotar(`ITEM · "${spec.nome}" já existia (${jaTem.code}) — criação pulada`);
      return jaTem;
    }
    await abrir("/cadastros/itens/novo");
    await page.selectOption("#item-type", spec.tipo);
    await page.selectOption("#item-unit", spec.unidade);
    await preencher("#item-name", spec.nome);
    const ligar = async (sel, ligado) => {
      const el = page.locator(sel);
      if ((await el.count()) === 0) return;
      const estado = await el.isChecked();
      if (estado !== ligado) await el.setChecked(ligado);
    };
    await ligar("#item-controls-lot", spec.controlaLote);
    await ligar("#item-controls-expiry", spec.controlaValidade);
    await ligar("#item-requires-quality-release", spec.exigeLiberacao);
    await clicarBotao("Criar item");
    const voltou = await esperarUrl((u) => u.pathname === "/cadastros/itens", 25000);
    check(`CADASTRO · item "${spec.nome}" criado pela tela`, voltou, JSON.stringify(await mensagensDeErro()));
    const lidos = (await apiGet(`/items?search=${encodeURIComponent(spec.nome)}&pageSize=10`)).items ?? [];
    return lidos.find((i) => i.name === spec.nome) ?? null;
  };

  const mp = await criarItem(MP);
  if (!check("CADASTRO · a matéria-prima existe", Boolean(mp), "")) return;
  S.dados.item = { id: mp.id, code: mp.code, unitCode: mp.unitCode };
  check(
    "CADASTRO · a matéria-prima controla lote, controla validade e exige liberação",
    mp.controlsLot === true && mp.controlsExpiry === true && mp.requiresQualityRelease === true,
    `lote=${mp.controlsLot} validade=${mp.controlsExpiry} liberacao=${mp.requiresQualityRelease}`,
  );

  const inativa = await criarItem(MP_INATIVA);
  if (!check("CADASTRO · o item que será inativado existe", Boolean(inativa), "")) return;
  S.dados.itemInativo = { id: inativa.id, code: inativa.code, unitCode: inativa.unitCode };

  // Inativação pela tela — lista › kebab › Inativar › confirmar.
  if (inativa.active) {
    await abrir("/cadastros/itens");
    await preencher("#items-search", MP_INATIVA.nome);
    await page.waitForTimeout(1500);
    await page.locator(`button[aria-label="Mais ações de ${inativa.code}"]`).first().click();
    await page.waitForTimeout(300);
    await page.getByRole("menuitem", { name: "Inativar", exact: true }).click();
    await confirmarDialogo("Inativar");
    await page.waitForTimeout(1200);
    const conferido = (
      (await apiGet(`/items?search=${encodeURIComponent(MP_INATIVA.nome)}&pageSize=10`)).items ?? []
    ).find((i) => i.id === inativa.id);
    check(
      "CADASTRO · o item foi INATIVADO pela tela (pré-condição do caso 9)",
      conferido?.active === false,
      `active=${conferido?.active}`,
    );
  }

  anotar(
    `MASSA · item ${S.dados.item.code} (${MP.nome}) · fornecedor ${S.dados.fornecedor.code} · ` +
      `item inativo ${S.dados.itemInativo.code}`,
  );
  await shot("adv-stock-01-cadastro");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 2 · Cinco ordens de compra, uma por lote
// ══════════════════════════════════════════════════════════════════════════
/**
 * Uma OC por lote, e não uma OC com cinco linhas, por dois motivos: o domínio
 * recusa o mesmo item duas vezes na mesma ordem (`duplicate_item`), e cada
 * lote precisa do SEU preço — que é o que torna o custo por lote distinto.
 */
async function criarOc(compra) {
  await abrir("/compras/ordens/nova", { espera: "#po-supplier" });
  await escolherEntidade("#po-supplier", FORNECEDOR.tradeName, FORNECEDOR.tradeName);
  await preencher("#po-order-date", compra.recebidoEm);
  await clicarBotao("+ Adicionar item");
  await page.waitForTimeout(400);
  const combo = page.locator('input[id^="po-line-item-"]').first();
  await escolherEntidade(combo, MP.nome, MP.nome);
  const linha = page.locator("table.table tbody tr").first();
  const decimais = linha.locator('input[inputmode="decimal"]');
  await decimais.nth(0).fill(compra.quantidade);
  await decimais.nth(1).fill(compra.preco);
  await page.waitForTimeout(200);

  await clicarBotao("Salvar rascunho");
  const salvou = await esperarUrl((u) => /^\/compras\/ordens\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check(`OC ${compra.id} · rascunho salvo com URL própria`, salvou, JSON.stringify(await mensagensDeErro()))) {
    return null;
  }
  await page.waitForTimeout(600);
  const codigo = await texto(".doc-title h1");
  await clicarBotao("Confirmar OC");
  await confirmarDialogo("Confirmar");
  await page.waitForTimeout(1200);
  const situacao = await texto(".doc-title .badge");
  check(`OC ${compra.id} · Rascunho → Confirmado`, situacao === "Confirmado", situacao);
  return { code: codigo, url: caminho(), id: caminho().split("/").pop() };
}

async function marco02Ocs() {
  S.dados.ocs = S.dados.ocs ?? {};
  for (const compra of COMPRAS) {
    if (S.dados.ocs[compra.id]) {
      anotar(`OC ${compra.id} · ${S.dados.ocs[compra.id].code} já existia — pulada`);
      continue;
    }
    const oc = await criarOc(compra);
    if (!oc) return;
    S.dados.ocs[compra.id] = { ...oc, ...compra };
    salvarEstado();
  }
  anotar(
    `COMPRAS · ${COMPRAS.map((c) => `${S.dados.ocs[c.id].code}=${c.quantidade}kg@R$${c.preco}`).join(" · ")}`,
  );
  await shot("adv-stock-02-ordens-de-compra");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 3 · Recebimento parcial + recebimento acima do saldo
// ══════════════════════════════════════════════════════════════════════════
/** Preenche a única linha aberta do recebimento e devolve o id da linha da OC. */
async function preencherLinhaRecebimento(compra, quantidade, { nfSufixo = "" } = {}) {
  await page.waitForSelector('input[id^="receive-now-"]', { timeout: 30000 });
  await preencher("#receipt-date", compra.recebidoEm);
  await preencher("#receipt-invoice", `NF ${compra.nf}${nfSufixo}`);
  const campo = page.locator('input[id^="receive-now-"]').first();
  const id = await campo.getAttribute("id");
  const poLineId = id.replace("receive-now-", "");
  await campo.fill(String(quantidade));
  const loteFornecedor = page.locator(`#supplier-lot-${poLineId}`);
  if ((await loteFornecedor.count()) > 0) await loteFornecedor.fill(compra.loteFornecedor);
  const validade = page.locator(`#expiry-${poLineId}`);
  if ((await validade.count()) > 0) await validade.fill(compra.validade);
  const custo = page.locator(`#cost-${poLineId}`);
  if ((await custo.count()) > 0) await custo.fill(compra.preco);
  await page.waitForTimeout(200);
  return poLineId;
}

async function irParaRecebimento(oc) {
  await abrir(oc.url, { espera: ".doc-title h1" });
  await clicarBotao("Receber materiais");
  return esperarUrl((u) => u.pathname === "/compras/recebimentos/novo", 25000);
}

async function marco03RecebimentoParcial() {
  const oc = S.dados.ocs.A;
  const compra = COMPRAS.find((c) => c.id === "A");
  const [primeira, segunda] = compra.parcial;

  // ── Caminho correto: parcial ───────────────────────────────────────────
  if (!S.dados.recA1) {
    await irParaRecebimento(oc);
    await preencherLinhaRecebimento(compra, primeira, { nfSufixo: "-1" });
    await clicarBotao("Confirmar recebimento");
    await confirmarDialogo("Confirmar");
    const foi = await esperarUrl((u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
    if (!check("RECEBIMENTO PARCIAL · a primeira parcela foi confirmada", foi, JSON.stringify(await mensagensDeErro()))) {
      return;
    }
    S.dados.recA1 = { code: await texto(".doc-title h1"), url: caminho() };
    salvarEstado();
  }

  await abrir(oc.url, { espera: ".doc-title h1" });
  const situacaoParcial = await texto(".doc-title .badge");
  registrarCaso("CORRETO-1 · recebimento parcial", {
    pre: `OC ${oc.code} Confirmada com ${compra.quantidade} kg pedidos, nada recebido`,
    acao: `receber ${primeira} kg`,
    esperado: "OC passa a Recebido parcialmente, saldo em aberto vira 30 kg",
    real: `situação da OC = "${situacaoParcial}"`,
    invariante: "um lote novo com 20 kg; saldo em aberto da linha = 30 kg",
    veredito: situacaoParcial === "Recebido parcialmente" ? "PASS" : "FAIL",
  });
  check(
    "CORRETO · a OC parcialmente recebida mostra “Recebido parcialmente”",
    situacaoParcial === "Recebido parcialmente",
    situacaoParcial,
  );
  await shot("adv-stock-03-recebimento-parcial");

  // ── Proibido 1: receber acima do saldo em aberto ───────────────────────
  if (!S.dados.provaAcimaDoSaldo) {
    await irParaRecebimento(oc);
    await caminhoProibido(
      "PROIBIDO-1 · receber acima do saldo da OC",
      {
        pre: `OC ${oc.code}: ${compra.quantidade} kg pedidos, ${primeira} kg recebidos, ${segunda} kg em aberto`,
        acao: "informar 40 kg (10 acima do saldo) e confirmar",
        esperado: "recusa explícita; nenhum recebimento, nenhum lote, nenhum movimento",
        invariante: `saldo dos lotes de ${S.dados.item.code} inalterado e contagem de movimentos inalterada`,
      },
      async () => {
        await preencherLinhaRecebimento(compra, "40", { nfSufixo: "-X" });
        await clicarBotao("Confirmar recebimento");
        await confirmarDialogo("Confirmar");
        await page.waitForTimeout(2200);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    await shot("adv-negative-path-over-receipt");
    S.dados.provaAcimaDoSaldo = true;
    salvarEstado();
  }

  // ── Caminho correto: completar ─────────────────────────────────────────
  if (!S.dados.recA2) {
    await irParaRecebimento(oc);
    await preencherLinhaRecebimento(compra, segunda, { nfSufixo: "-2" });
    await clicarBotao("Confirmar recebimento");
    await confirmarDialogo("Confirmar");
    const foi = await esperarUrl((u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
    if (!check("RECEBIMENTO · a segunda parcela completou a OC", foi, JSON.stringify(await mensagensDeErro()))) {
      return;
    }
    S.dados.recA2 = { code: await texto(".doc-title h1"), url: caminho() };
    salvarEstado();
  }

  await abrir(oc.url, { espera: ".doc-title h1" });
  const situacaoFinal = await texto(".doc-title .badge");
  registrarCaso("CORRETO-2 · completar o recebimento", {
    pre: `OC ${oc.code} Recebida parcialmente (${primeira} de ${compra.quantidade} kg)`,
    acao: `receber os ${segunda} kg restantes`,
    esperado: "OC passa a Recebido; nenhum saldo em aberto",
    real: `situação da OC = "${situacaoFinal}"`,
    invariante: `dois lotes somando ${compra.quantidade} kg, cada um com sua nota`,
    veredito: situacaoFinal === "Recebido" ? "PASS" : "FAIL",
  });
  check("CORRETO · a OC completada mostra “Recebido”", situacaoFinal === "Recebido", situacaoFinal);
  check(
    "CORRETO · não sobrou botão “Receber materiais” numa OC totalmente recebida",
    !(await existeBotao("Receber materiais")),
    "",
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 4 · Duplo clique, F5 antes e F5 depois
// ══════════════════════════════════════════════════════════════════════════
async function marco04CliqueERecarga() {
  // ── Proibido 2: duplo clique / clique repetido durante o carregamento ──
  const ocB = S.dados.ocs.B;
  const compraB = COMPRAS.find((c) => c.id === "B");
  if (!S.dados.provaDuploClique) {
    const antes = await fotografar("antes:duplo-clique");
    await irParaRecebimento(ocB);
    await preencherLinhaRecebimento(compraB, compraB.quantidade);
    let recebimentosDepois = [];
    await deliberadamente("PROIBIDO-2 · duplo clique no recebimento", async () => {
      await clicarBotao("Confirmar recebimento");
      const dialogo = page.locator(".confirm-dialog");
      await dialogo.waitFor({ state: "visible", timeout: 20000 });
      const botao = dialogo.getByRole("button", { name: "Confirmar", exact: true });
      // Dois cliques imediatos, sem esperar a resposta — é o gesto do operador
      // impaciente, e é o que produz documento duplicado quando não há guarda.
      await botao.click({ noWaitAfter: true });
      await botao.click({ noWaitAfter: true, force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(3500);
    });
    await esperarUrl((u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname), 20000);
    recebimentosDepois = await lerRecebimentosDaOc(ocB);
    const depois = await fotografar("depois:duplo-clique");
    anotar(
      `DUPLO CLIQUE · logo após o gesto: ${recebimentosDepois.length} recebimento(s) na OC, ` +
        `lotes ${antes.lotes.length}→${depois.lotes.length}, movimentos ${antes.totalMovimentos}→${depois.totalMovimentos}`,
    );
    S.dados.recB = { code: await texto(".doc-title h1"), url: caminho() };
    S.dados.provaDuploClique = true;
    salvarEstado();
    await shot("adv-negative-path-double-click");
  }

  /*
   * O veredito é recomputado do documento, não do instante do clique.
   *
   * Contar "quantos lotes novos apareceram" durante a ação depende de a
   * medição de antes ter sido feita na mesma execução; contar quantos
   * recebimentos e quantos lotes a OC tem AGORA não depende de nada, e é o
   * que prova duplicação — que é o defeito procurado.
   */
  await conferirSemDuplicata(
    "PROIBIDO-2 · duplo clique no recebimento",
    ocB,
    compraB,
    "clicar “Confirmar” duas vezes seguidas, sem esperar a resposta",
    "exatamente UM recebimento, UM lote e UM movimento de entrada",
    1,
  );

  // ── Proibido 3a: F5 depois de preencher e ANTES de confirmar ───────────
  const ocC = S.dados.ocs.C;
  const compraC = COMPRAS.find((c) => c.id === "C");
  if (!S.dados.provaF5Antes) {
    await irParaRecebimento(ocC);
    await caminhoProibido(
      "PROIBIDO-3a · F5 depois de preencher, antes de confirmar",
      {
        pre: `OC ${ocC.code} Confirmada, ${compraC.quantidade} kg em aberto, formulário preenchido`,
        acao: "recarregar a página (F5) sem confirmar",
        esperado: "nada gravado; o formulário volta em branco",
        invariante: "nenhum recebimento na OC, nenhum lote, nenhum movimento",
      },
      async () => {
        await preencherLinhaRecebimento(compraC, compraC.quantidade);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2500);
        const recs = await lerRecebimentosDaOc(ocC);
        const campo = page.locator('input[id^="receive-now-"]').first();
        const restou = (await campo.count()) > 0 ? await campo.inputValue() : "(sem campo)";
        return `recebimentos na OC após F5 = ${recs.length}; campo de quantidade após F5 = "${restou}"`;
      },
    );
    S.dados.provaF5Antes = true;
    salvarEstado();
    await shot("adv-negative-path-f5-before");
  }

  // ── Proibido 3b: F5 IMEDIATAMENTE depois de confirmar ──────────────────
  if (!S.dados.provaF5Depois) {
    const antes = await fotografar("antes:f5-depois");
    await irParaRecebimento(ocC);
    await preencherLinhaRecebimento(compraC, compraC.quantidade);
    await deliberadamente("PROIBIDO-3b · F5 logo após confirmar", async () => {
      await clicarBotao("Confirmar recebimento");
      const dialogo = page.locator(".confirm-dialog");
      await dialogo.waitFor({ state: "visible", timeout: 20000 });
      await dialogo.getByRole("button", { name: "Confirmar", exact: true }).click({ noWaitAfter: true });
      // Recarga no meio do voo: a pergunta é se a gravação fica inteira ou pela metade.
      await page.waitForTimeout(400);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(3000);
    });
    const depois = await fotografar("depois:f5-depois");
    const recs = await lerRecebimentosDaOc(ocC);
    anotar(
      `F5 APÓS CONFIRMAR · logo após o gesto: ${recs.length} recebimento(s) na OC, ` +
        `lotes ${antes.lotes.length}→${depois.lotes.length}, movimentos ${antes.totalMovimentos}→${depois.totalMovimentos}`,
    );
    S.dados.provaF5Depois = true;
    salvarEstado();
    await shot("adv-negative-path-f5-after");
  }

  await conferirSemDuplicata(
    "PROIBIDO-3b · F5 imediatamente após confirmar",
    ocC,
    compraC,
    "clicar “Confirmar” e recarregar a página 400 ms depois",
    "a gravação é atômica: um recebimento inteiro OU nenhum — nunca metade",
    1,
    { zeroTambemVale: true },
  );

  // Se o F5 abortou, completa o recebimento de C pelo caminho normal — os
  // lotes de FEFO precisam existir para os marcos seguintes.
  const recsC = await lerRecebimentosDaOc(ocC);
  if (recsC.length === 0) {
    await irParaRecebimento(ocC);
    await preencherLinhaRecebimento(compraC, compraC.quantidade);
    await clicarBotao("Confirmar recebimento");
    await confirmarDialogo("Confirmar");
    await esperarUrl((u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
    anotar(`RECEBIMENTO · OC ${ocC.code} recebida pelo caminho normal após o teste de F5`);
  }
}

/**
 * Reconta, a partir do próprio documento, quantos recebimentos, lotes e
 * movimentos de entrada a OC gerou — e falha quando há mais de um por
 * gesto único. Independe de fotografia prévia, então vale em reexecução.
 */
async function conferirSemDuplicata(caso, oc, compra, acao, esperado, esperados, { zeroTambemVale = false } = {}) {
  const recs = await lerRecebimentosDaOc(oc);
  const lotes = await lerLotesDaOc(oc);
  const movimentos = await lerMovimentos(S.dados.item.id);
  const codigosDeLote = new Set(lotes.map((l) => l.code));
  const entradas = movimentos.filter((m) => m.type === "RECEIPT_IN" && codigosDeLote.has(m.lotCode));
  const recebido = lotes.reduce((a, l) => a + num(l.initialReceivedQuantity ?? 0), 0);

  const certo =
    (recs.length === esperados && lotes.length === esperados && entradas.length === esperados) ||
    (zeroTambemVale && recs.length === 0 && lotes.length === 0 && entradas.length === 0);
  const real =
    `${recs.length} recebimento(s) [${recs.map((r) => r.code).join(", ") || "—"}] · ` +
    `${lotes.length} lote(s) [${lotes.map((l) => l.code).join(", ") || "—"}] · ` +
    `${entradas.length} movimento(s) de entrada · total recebido ${recebido} de ${compra.quantidade} kg pedidos`;

  registrarCaso(caso, {
    pre: `OC ${oc.code} Confirmada, ${compra.quantidade} kg em aberto`,
    acao,
    esperado,
    real,
    invariante: "recebimento, lote e movimento de entrada sempre no mesmo número; nada além do pedido",
    veredito: certo ? "BLOCKED_CORRECTLY" : "BUG",
  });
  registrarNegativo(caso, certo ? "BLOCKED_CORRECTLY" : "BUG", real);
  check(`NEGATIVO · ${caso} — nenhum documento duplicado`, certo, real);
  if (!certo && recs.length > esperados) {
    finding(
      "CRITICAL",
      `${caso}: a OC ${oc.code} terminou com ${recs.length} recebimentos para um único gesto`,
      `Compras › OC ${oc.code} › Receber materiais · ${acao}. Resultado: ${real}.`,
    );
  }
  return { recs, lotes, entradas, certo };
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 5 · Zero, negativo e os recebimentos que faltam
// ══════════════════════════════════════════════════════════════════════════
async function marco05ZeroNegativoEResto() {
  const ocD = S.dados.ocs.D;
  const compraD = COMPRAS.find((c) => c.id === "D");

  // ── Proibido 6: quantidade ZERO onde a tela deixa digitar ──────────────
  if (!S.dados.provaZeroRecebimento) {
    await irParaRecebimento(ocD);
    await caminhoProibido(
      "PROIBIDO-6a · quantidade ZERO no recebimento",
      {
        pre: `OC ${ocD.code} Confirmada, ${compraD.quantidade} kg em aberto`,
        acao: 'digitar "0" em "Receber agora" e confirmar',
        esperado: "recusa; zero não é recebimento",
        invariante: "nenhum recebimento, nenhum lote de zero quilo, nenhum movimento",
      },
      async () => {
        await preencherLinhaRecebimento(compraD, "0");
        const botao = page.getByRole("button", { name: "Confirmar recebimento", exact: true });
        const desabilitado = await botao.isDisabled();
        if (desabilitado) return "botão “Confirmar recebimento” fica DESABILITADO com 0 (bloqueio na tela)";
        await botao.click();
        await confirmarDialogo("Confirmar");
        await page.waitForTimeout(2000);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    S.dados.provaZeroRecebimento = true;
    salvarEstado();
  }

  // ── Proibido 7: quantidade NEGATIVA ────────────────────────────────────
  if (!S.dados.provaNegativoRecebimento) {
    await irParaRecebimento(ocD);
    await caminhoProibido(
      "PROIBIDO-7a · quantidade NEGATIVA no recebimento",
      {
        pre: `OC ${ocD.code} Confirmada, ${compraD.quantidade} kg em aberto`,
        acao: 'digitar "-5" em "Receber agora" e confirmar',
        esperado: "recusa; recebimento negativo não existe",
        invariante: "nenhum recebimento, nenhum lote, nenhum movimento de saída disfarçado de entrada",
      },
      async () => {
        await preencherLinhaRecebimento(compraD, "-5");
        const botao = page.getByRole("button", { name: "Confirmar recebimento", exact: true });
        if (await botao.isDisabled()) return "botão “Confirmar recebimento” fica DESABILITADO com -5";
        await botao.click();
        await confirmarDialogo("Confirmar");
        await page.waitForTimeout(2000);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    S.dados.provaNegativoRecebimento = true;
    salvarEstado();
    await shot("adv-negative-path-zero-e-negativo");
  }

  // ── Recebimentos D e E, pelo caminho correto ───────────────────────────
  for (const id of ["D", "E"]) {
    const oc = S.dados.ocs[id];
    const compra = COMPRAS.find((c) => c.id === id);
    const jaRecebido = await lerRecebimentosDaOc(oc);
    if (jaRecebido.length > 0) {
      anotar(`RECEBIMENTO ${id} · já existia (${jaRecebido[0].code}) — pulado`);
      continue;
    }
    await irParaRecebimento(oc);
    await preencherLinhaRecebimento(compra, compra.quantidade);
    await clicarBotao("Confirmar recebimento");
    await confirmarDialogo("Confirmar");
    const foi = await esperarUrl((u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
    if (!check(`RECEBIMENTO ${id} · confirmado`, foi, JSON.stringify(await mensagensDeErro()))) return;
  }

  // ── Retrato dos lotes nascidos ─────────────────────────────────────────
  const lotes = await lerLotesDoItem(S.dados.item.id);
  S.dados.lotesIniciais = lotes;
  salvarEstado();
  anotar(
    `LOTES · ${lotes
      .map((l) => `${l.code} ${l.onHand}kg val=${l.expiryDate} ${l.status}${l.isExpired ? "/VENCIDO" : ""}`)
      .join(" · ")}`,
  );
  check(
    "MASSA · nasceram 6 lotes pela tela (A parcelado em 2, mais B, C, D, E)",
    lotes.length === 6,
    `${lotes.length} lotes`,
  );
  const vencidos = lotes.filter((l) => l.isExpired);
  check(
    "MASSA · três lotes chegaram VENCIDOS pelo fluxo oficial (validade real de 2022/2023)",
    vencidos.length === 3,
    JSON.stringify(vencidos.map((l) => `${l.code}/${l.expiryDate}`)),
  );
  await abrir("/estoque/lotes");
  await preencher("#lots-search", S.dados.item.code);
  await page.waitForTimeout(1500);
  await shot("adv-stock-05-lotes-nascidos");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 6 · Liberação de qualidade e bloqueio
// ══════════════════════════════════════════════════════════════════════════
async function abrirLote(lotId) {
  await abrir(`/estoque/lotes/${lotId}`, { espera: ".doc-title h1" });
}

async function marco06Qualidade() {
  const lotes = await lerLotesDoItem(S.dados.item.id);
  const aguardando = lotes.filter((l) => l.status === "AWAITING_RELEASE");
  check(
    "QUALIDADE · todo lote do item que exige liberação nasceu “Aguardando liberação”",
    aguardando.length === lotes.length,
    JSON.stringify(lotes.map((l) => `${l.code}/${l.status}`)),
  );

  // ── Caminho correto: liberar ───────────────────────────────────────────
  for (const lote of aguardando) {
    await abrirLote(lote.id);
    if (!(await existeBotao("Liberar"))) {
      check(`QUALIDADE · o lote ${lote.code} oferece “Liberar”`, false, await texto(".doc-title .badge"));
      continue;
    }
    await clicarBotao("Liberar");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(1200);
  }
  const depois = await lerLotesDoItem(S.dados.item.id);
  const liberados = depois.filter((l) => l.status === "AVAILABLE");
  registrarCaso("CORRETO-3 · liberação de qualidade", {
    pre: `${aguardando.length} lotes em "Aguardando liberação"`,
    acao: "abrir cada lote e usar Qualidade › Liberar",
    esperado: "todos passam a Disponível; nenhum saldo físico muda",
    real: `${liberados.length} lotes Disponível`,
    invariante: "liberação não movimenta estoque — só troca o status",
    veredito: liberados.length === aguardando.length ? "PASS" : "FAIL",
  });
  check(
    "CORRETO · a liberação levou todos os lotes a Disponível",
    liberados.length === depois.length,
    JSON.stringify(depois.map((l) => `${l.code}/${l.status}`)),
  );

  // O que a liberação NÃO faz: ressuscitar lote vencido.
  const vencidosLiberados = depois.filter((l) => l.isExpired && l.status === "AVAILABLE");
  const disponivelDeVencido = vencidosLiberados.map((l) => `${l.code}=${l.available}`);
  check(
    "INVARIANTE · lote VENCIDO liberado continua com disponível ZERO (o físico permanece)",
    vencidosLiberados.every((l) => num(l.available) === 0 && num(l.onHand) > 0),
    JSON.stringify(disponivelDeVencido),
  );
  registrarCaso("PROIBIDO-5 · lote expirado usado em operação nova", {
    pre: `lotes com validade 2022-07-31 e 2023-07-31 (dado real da planilha), hoje ${hoje()}`,
    acao: "liberar os lotes vencidos pela Qualidade e conferir a disponibilidade",
    esperado: "status pode virar Disponível, mas a quantidade DISPONÍVEL do lote vencido é zero",
    real: `disponível dos lotes vencidos: ${JSON.stringify(disponivelDeVencido)}`,
    invariante: "físico preservado, disponível zerado — vencido não some do estoque, só para de ser usável",
    veredito: vencidosLiberados.every((l) => num(l.available) === 0) ? "BLOCKED_CORRECTLY" : "BUG",
  });
  registrarNegativo(
    "PROIBIDO-5 · lote expirado elegível para uso",
    vencidosLiberados.every((l) => num(l.available) === 0) ? "BLOCKED_CORRECTLY" : "BUG",
    `disponível dos vencidos = ${JSON.stringify(disponivelDeVencido)}`,
  );

  await abrir("/estoque/lotes");
  await preencher("#lots-search", S.dados.item.code);
  await page.waitForTimeout(1500);
  await shot("adv-stock-blocked-06-lotes-liberados");
  S.dados.lotesLiberados = depois;
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 7 · Correção autorizada e a vírgula decimal
// ══════════════════════════════════════════════════════════════════════════
/** Abre o diálogo "Ajustar estoque" na tela do item e devolve o locator. */
async function abrirAjuste() {
  await abrir(`/estoque/${S.dados.item.id}`, { espera: ".page__title, .doc-title" });
  await clicarBotao("Ajustar estoque");
  await page.waitForSelector("#adjust-stock-form", { timeout: 20000 });
}

async function ajustar({ loteCode, tipo, quantidade, motivo }) {
  await abrirAjuste();
  const opcoes = await page.locator("#adjust-lot option").allTextContents();
  const alvo = opcoes.find((o) => o.includes(loteCode));
  await page.selectOption("#adjust-lot", { label: alvo });
  await page.selectOption("#adjust-type", tipo);
  await preencher("#adjust-quantity", quantidade);
  await preencher("#adjust-reason", motivo);
  await page.getByRole("button", { name: "Confirmar ajuste", exact: true }).click();
  await page.waitForTimeout(1800);
}

async function marco07CorrecaoEDecimal() {
  const lotes = await lerLotesDoItem(S.dados.item.id);
  const porValidade = [...lotes].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const loteE = porValidade[porValidade.length - 1]; // o de validade mais longa
  S.dados.loteE = loteE.code;

  // ── DECIMAL · "0,125" e "0.125" no MESMO campo ─────────────────────────
  if (!S.dados.provaDecimal) {
    const antes = await lerLotesDoItem(S.dados.item.id);
    const saldoAntes = num(antes.find((l) => l.code === loteE.code).onHand);

    await ajustar({
      loteCode: loteE.code,
      tipo: "ADJUSTMENT_OUT",
      quantidade: "0,125",
      motivo: "ADV decimal com virgula - conferencia de separador",
    });
    const m1 = await lerMovimentos(S.dados.item.id);
    const comVirgula = m1.filter((m) => m.type === "ADJUSTMENT_OUT" && m.lotCode === loteE.code);

    await ajustar({
      loteCode: loteE.code,
      tipo: "ADJUSTMENT_OUT",
      quantidade: "0.125",
      motivo: "ADV decimal com ponto - conferencia de separador",
    });
    const m2 = await lerMovimentos(S.dados.item.id);
    const todos = m2.filter((m) => m.type === "ADJUSTMENT_OUT" && m.lotCode === loteE.code);
    const comPonto = todos.filter((m) => !comVirgula.some((x) => x.id === m.id));

    const qVirgula = comVirgula[0]?.quantity;
    const qPonto = comPonto[0]?.quantity;
    const equivalentes = num(qVirgula) === 0.125 && num(qPonto) === 0.125;
    separadores.push({ campo: "#adjust-quantity", digitado: "0,125", gravado: String(qVirgula) });
    separadores.push({ campo: "#adjust-quantity", digitado: "0.125", gravado: String(qPonto) });

    const depois = await lerLotesDoItem(S.dados.item.id);
    const saldoDepois = num(depois.find((l) => l.code === loteE.code).onHand);
    registrarCaso("DECIMAL · 0,125 e 0.125 no mesmo campo", {
      pre: `lote ${loteE.code} com ${saldoAntes} kg`,
      acao: 'dois ajustes de saída no campo "Quantidade": "0,125" e depois "0.125"',
      esperado: "os dois gravam 0,125 — vírgula e ponto são o mesmo número",
      real: `gravado com vírgula = ${qVirgula} · gravado com ponto = ${qPonto}`,
      invariante: `saldo do lote cai exatamente 0,25: ${saldoAntes} → ${saldoDepois}`,
      veredito: equivalentes && Math.abs(saldoAntes - saldoDepois - 0.25) < 1e-9 ? "PASS" : "FAIL",
    });
    check(
      'DECIMAL · "0,125" e "0.125" no mesmo campo gravam o mesmo valor',
      equivalentes,
      `virgula=${qVirgula} ponto=${qPonto}`,
    );
    check(
      "DECIMAL · o saldo do lote caiu exatamente 0,25 (dois ajustes de 0,125)",
      Math.abs(saldoAntes - saldoDepois - 0.25) < 1e-9,
      `${saldoAntes} → ${saldoDepois}`,
    );
    if (!equivalentes) {
      finding(
        "HIGH",
        "Campo decimal de ajuste de estoque grava valores diferentes para vírgula e ponto",
        `Estoque › ${S.dados.item.code} › Ajustar estoque · digitar "0,125" e depois "0.125" no ` +
          `campo Quantidade. Gravado: ${qVirgula} e ${qPonto}.`,
      );
    }
    S.dados.provaDecimal = { qVirgula, qPonto, saldoAntes, saldoDepois };
    salvarEstado();
    await shot("adv-stock-07-decimal");
  }

  // ── CORRETO · correção autorizada com antes/ajuste/depois/motivo ───────
  if (!S.dados.provaCorrecao) {
    const antes = await lerLotesDoItem(S.dados.item.id);
    const saldoAntes = num(antes.find((l) => l.code === loteE.code).onHand);
    const motivo = "ADV correcao autorizada - quebra de saco no armazem, contagem conferida";
    await ajustar({
      loteCode: loteE.code,
      tipo: "LOSS",
      quantidade: "0.5",
      motivo,
    });
    const depois = await lerLotesDoItem(S.dados.item.id);
    const saldoDepois = num(depois.find((l) => l.code === loteE.code).onHand);
    const movimentos = await lerMovimentos(S.dados.item.id);
    const perda = movimentos.find((m) => m.type === "LOSS" && m.lotCode === loteE.code);
    const bate = Math.abs(saldoAntes - 0.5 - saldoDepois) < 1e-9;
    registrarCaso("CORRETO-4 · correção de estoque autorizada", {
      pre: `lote ${loteE.code} com ${saldoAntes} kg`,
      acao: `Ajustar estoque › Perda › 0,5 kg › motivo "${motivo}"`,
      esperado: "saldo cai 0,5 kg e nasce UM movimento de perda com o motivo gravado",
      real: `antes ${saldoAntes} · ajuste -0,5 · depois ${saldoDepois} · motivo gravado: "${perda?.reason ?? "(vazio)"}"`,
      invariante: "correção é movimento novo, nunca reescrita de movimento antigo",
      veredito: bate && Boolean(perda?.reason) ? "PASS" : "FAIL",
    });
    check("CORRETO · a correção autorizada baixou exatamente 0,5 kg", bate, `${saldoAntes} → ${saldoDepois}`);
    check(
      "CORRETO · a correção gravou o motivo, e o histórico anterior continua intacto",
      Boolean(perda?.reason) && perda.reason.includes("ADV correcao autorizada"),
      perda?.reason ?? "(sem motivo)",
    );
    S.dados.provaCorrecao = { saldoAntes, saldoDepois, motivo };
    salvarEstado();
  }

  // ── CORRETO · inventário físico com antes/depois/diferença/motivo ──────
  if (!S.dados.provaContagem) {
    const antes = await lerLotesDoItem(S.dados.item.id);
    const saldoAntes = num(antes.find((l) => l.code === loteE.code).onHand);
    const contagem = (saldoAntes - 0.25).toFixed(6);
    await abrir("/estoque/inventario", { espera: ".page__title" });
    await escolherEntidade("#count-item", S.dados.item.code, S.dados.item.code);
    await page.waitForTimeout(900);
    const opcoes = await page.locator("#count-lot option").allTextContents();
    const alvo = opcoes.find((o) => o.includes(loteE.code));
    await page.selectOption("#count-lot", { label: alvo });
    await page.waitForTimeout(1200);
    const saldoSistema = await texto(".field-readonly-value");
    await preencher("#count-quantity", contagem);
    await page.waitForTimeout(400);
    await preencher("#count-reason", "ADV inventario fisico - recontagem apos quebra");
    await clicarBotao("Confirmar contagem");
    await page.waitForTimeout(2200);
    const resultado = await textos("dl.definition-list dd");
    const depois = await lerLotesDoItem(S.dados.item.id);
    const saldoDepois = num(depois.find((l) => l.code === loteE.code).onHand);
    const bate = Math.abs(num(contagem) - saldoDepois) < 1e-9;
    registrarCaso("CORRETO-5 · inventário físico com diferença", {
      pre: `lote ${loteE.code}: saldo de sistema ${saldoAntes} kg (tela mostrou "${saldoSistema}")`,
      acao: `contagem física ${contagem} kg com motivo obrigatório`,
      esperado: "gera UM ajuste de saída de 0,25 kg e o saldo passa a valer a contagem",
      real: `resultado na tela: ${JSON.stringify(resultado)} · saldo após = ${saldoDepois}`,
      invariante: "o saldo não é sobrescrito: nasce um movimento de ajuste que o explica",
      veredito: bate ? "PASS" : "FAIL",
    });
    check("CORRETO · o inventário físico ajustou o saldo para a contagem", bate, `esperado=${contagem} real=${saldoDepois}`);
    S.dados.provaContagem = { saldoAntes, contagem, saldoDepois };
    salvarEstado();
    await shot("adv-stock-07-inventario-fisico");
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 8 · FEFO pela tela
// ══════════════════════════════════════════════════════════════════════════
/**
 * Sugestão FEFO da tela do item — leitura, nunca reserva.
 *
 * O escopo é a seção "Ordem de Consumo / Sugestão FEFO", e não a página: a
 * tela também lista o saldo POR LOTE logo acima, com os vencidos incluídos.
 * Ler `table tbody tr` solto misturaria as duas tabelas e faria a sugestão
 * parecer conter lotes que ela nunca ofereceu.
 */
const secaoFefo = () =>
  page
    .locator("section.form-section")
    .filter({ has: page.locator("h3", { hasText: "Sugestão FEFO" }) });

async function sugerirFefo(quantidade) {
  await abrir(`/estoque/${S.dados.item.id}`, { espera: ".page__title, .doc-title" });
  await preencher("#fefo-quantity", quantidade);
  await clicarBotao("Calcular sugestão");
  await page.waitForTimeout(1800);
  const secao = secaoFefo();
  const resumo = await secao.locator("dl.definition-list dd").allTextContents();
  const linhas = await secao.locator("table tbody tr").allTextContents();
  return {
    linhas: linhas.map((t) => t.replace(/\s+/g, " ").trim()),
    resumo: resumo.map((t) => t.replace(/\s+/g, " ").trim()),
    texto: linhas.map((t) => t.replace(/\s+/g, " ").trim()).join(" | "),
  };
}

async function marco08Fefo() {
  const lotes = await lerLotesDoItem(S.dados.item.id);
  const elegiveis = lotes
    .filter((l) => l.status === "AVAILABLE" && !l.isExpired && num(l.available) > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  check(
    "FEFO · há três lotes elegíveis com validades diferentes — a condição do teste",
    elegiveis.length >= 3,
    JSON.stringify(elegiveis.map((l) => `${l.code}/${l.expiryDate}/${l.available}`)),
  );
  if (elegiveis.length < 3) return;
  const [primeiro, segundo, terceiro] = elegiveis;
  S.dados.fefoLotes = elegiveis.map((l) => ({ code: l.code, exp: l.expiryDate, av: l.available }));

  // ── FEFO 1 · necessidade MENOR que o primeiro lote ─────────────────────
  const necessidadeMenor = "10";
  const s1 = await sugerirFefo(necessidadeMenor);
  const soPrimeiro =
    s1.linhas.length === 1 &&
    s1.linhas[0].includes(primeiro.code) &&
    s1.linhas[0].includes(`${necessidadeMenor} kg`);
  registrarCaso("FEFO-1 · necessidade menor que o primeiro lote", {
    pre: `elegíveis: ${elegiveis.map((l) => `${l.code} ${l.available}kg val ${l.expiryDate}`).join(" · ")}`,
    acao: `pedir sugestão para ${necessidadeMenor} kg`,
    esperado: `um único lote — ${primeiro.code}, o de validade mais curta (${primeiro.expiryDate}) — com ${necessidadeMenor} kg`,
    real: `${s1.texto || "(tabela vazia)"} · resumo: ${JSON.stringify(s1.resumo)}`,
    invariante: "sugestão é leitura: nenhum saldo muda, nenhuma reserva nasce",
    veredito: soPrimeiro ? "PASS" : "FAIL",
  });
  check(
    `FEFO · necessidade de ${necessidadeMenor} kg escolhe só ${primeiro.code} (validade ${primeiro.expiryDate})`,
    soPrimeiro,
    s1.texto,
  );
  await shot("adv-stock-fefo-menor-que-o-primeiro");

  // ── FEFO 2 · necessidade MAIOR que o primeiro lote ─────────────────────
  const s2 = await sugerirFefo(SALDO_REAL);
  const restoEsperado = num(SALDO_REAL) - num(primeiro.available);
  const brasileiro = (n) => String(Number(n.toFixed(6))).replace(".", ",");
  const linhaPrimeiro = s2.linhas.find((l) => l.includes(primeiro.code));
  const linhaSegundo = s2.linhas.find((l) => l.includes(segundo.code));
  const puloParaTerceiro = s2.linhas.some((l) => l.includes(terceiro.code));
  const primeiroInteiro = Boolean(linhaPrimeiro) && linhaPrimeiro.includes(`${primeiro.available} kg`);
  const restoNoSegundo = Boolean(linhaSegundo) && linhaSegundo.includes(`${brasileiro(restoEsperado)} kg`);
  const ok2 = primeiroInteiro && restoNoSegundo && !puloParaTerceiro && s2.linhas.length === 2;
  registrarCaso("FEFO-2 · necessidade maior que o primeiro lote", {
    pre: `elegíveis: ${elegiveis.map((l) => `${l.code} ${l.available}kg val ${l.expiryDate}`).join(" · ")}`,
    acao: `pedir sugestão para ${SALDO_REAL} kg (saldo real do item 260 na planilha, seis casas)`,
    esperado: `${primeiro.code} inteiro (${primeiro.available} kg) + ${brasileiro(restoEsperado)} kg de ${segundo.code}; ` +
      `${terceiro.code} NÃO deve aparecer`,
    real: `${s2.texto || "(tabela vazia)"} · resumo: ${JSON.stringify(s2.resumo)}`,
    invariante: "nenhum lote vencido ou bloqueado entra na conta; a soma sugerida fecha na necessidade",
    veredito: ok2 ? "PASS" : "FAIL",
  });
  check(
    `FEFO · ${SALDO_REAL} kg consome ${primeiro.code} inteiro (${primeiro.available}) e ${brasileiro(restoEsperado)} de ${segundo.code}`,
    primeiroInteiro && restoNoSegundo,
    s2.texto,
  );
  check(
    `FEFO · a alocação NÃO pula para ${terceiro.code} (validade mais longa, ${terceiro.expiryDate})`,
    !puloParaTerceiro && s2.linhas.length === 2,
    s2.texto,
  );
  const nenhumVencido = lotes
    .filter((l) => l.isExpired)
    .every((l) => !s1.texto.includes(l.code) && !s2.texto.includes(l.code));
  check(
    "FEFO · nenhum lote VENCIDO apareceu em qualquer das duas sugestões",
    nenhumVencido,
    `${s1.texto} || ${s2.texto}`,
  );
  S.dados.fefoSugestoes = { menor: s1.texto, maior: s2.texto, resumoMaior: s2.resumo };
  salvarEstado();
  await shot("adv-stock-fefo-maior-que-o-primeiro");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 9 · Bloqueio de lote e o que ele impede
// ══════════════════════════════════════════════════════════════════════════
async function marco09LoteBloqueado() {
  const lotes = await lerLotesDoItem(S.dados.item.id);
  const elegiveis = lotes
    .filter((l) => l.status === "AVAILABLE" && !l.isExpired && num(l.available) > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const alvo = elegiveis[elegiveis.length - 1]; // o de validade mais longa — não atrapalha o FEFO já provado
  S.dados.loteBloqueado = alvo.code;

  // ── Caminho correto: bloquear com motivo ───────────────────────────────
  await abrirLote(alvo.id);
  await clicarBotao("Bloquear");
  await preencher("#block-lot-reason", "ADV bloqueio para teste adversarial - suspeita de contaminacao");
  await page.getByRole("button", { name: "Bloquear lote", exact: true }).click();
  await page.waitForTimeout(1600);
  const situacao = await texto(".doc-title .badge");
  const depois = await lerLotesDoItem(S.dados.item.id);
  const bloqueado = depois.find((l) => l.code === alvo.code);
  registrarCaso("CORRETO-6 · bloqueio de lote com motivo", {
    pre: `lote ${alvo.code} Disponível com ${alvo.available} kg disponíveis`,
    acao: "Qualidade › Bloquear › motivo obrigatório",
    esperado: "status Bloqueado; físico intacto; disponível vai a zero",
    real: `badge "${situacao}" · físico ${bloqueado?.onHand} · disponível ${bloqueado?.available}`,
    invariante: "bloqueio não movimenta estoque — o físico continua lá, só deixa de ser usável",
    veredito:
      bloqueado?.status === "BLOCKED" &&
      num(bloqueado.onHand) === num(alvo.onHand) &&
      num(bloqueado.available) === 0
        ? "PASS"
        : "FAIL",
  });
  check(
    "CORRETO · o lote bloqueado mantém o físico e zera o disponível",
    bloqueado?.status === "BLOCKED" && num(bloqueado.onHand) === num(alvo.onHand) && num(bloqueado.available) === 0,
    `status=${bloqueado?.status} físico=${bloqueado?.onHand} disponível=${bloqueado?.available}`,
  );
  await shot("adv-stock-blocked-09-lote-bloqueado");

  // ── Proibido 4a: o lote bloqueado não pode ser sugerido/separado ───────
  const totalElegivel = depois
    .filter((l) => l.status === "AVAILABLE" && !l.isExpired)
    .reduce((a, l) => a + num(l.available), 0);
  const pedido = (totalElegivel + num(bloqueado.onHand) - 1).toFixed(6);
  const s = await sugerirFefo(pedido);
  const sugestao = `${s.texto} · resumo: ${JSON.stringify(s.resumo)}`;
  const usouBloqueado = s.texto.includes(alvo.code);
  registrarCaso("PROIBIDO-4a · separar a partir de lote BLOQUEADO", {
    pre: `lote ${alvo.code} Bloqueado com ${bloqueado.onHand} kg físicos; elegível total ${totalElegivel} kg`,
    acao: `pedir sugestão FEFO para ${pedido} kg — quantidade que só fecha se o bloqueado for usado`,
    esperado: "o bloqueado não entra; a sugestão fica incompleta e a falta é declarada",
    real: sugestao || "(tabela vazia)",
    invariante: "lote bloqueado nunca é alocado, mesmo quando é a única forma de fechar a necessidade",
    veredito: usouBloqueado ? "BUG" : "BLOCKED_CORRECTLY",
  });
  registrarNegativo(
    "PROIBIDO-4a · separar a partir de lote BLOQUEADO",
    usouBloqueado ? "BUG" : "BLOCKED_CORRECTLY",
    usouBloqueado ? `o lote bloqueado ${alvo.code} foi sugerido` : `${alvo.code} ausente da sugestão`,
  );
  check("NEGATIVO · lote bloqueado não é sugerido para separação", !usouBloqueado, sugestao);
  if (usouBloqueado) {
    finding(
      "HIGH",
      "Sugestão FEFO alocou lote BLOQUEADO",
      `Estoque › ${S.dados.item.code} · bloquear o lote ${alvo.code} e pedir sugestão para ${pedido} kg.`,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 10 · Correção que deixaria saldo negativo, e item inativo
// ══════════════════════════════════════════════════════════════════════════
async function marco10NegativosDeEstoque() {
  const lotes = await lerLotesDoItem(S.dados.item.id);
  const elegiveis = lotes
    .filter((l) => l.status === "AVAILABLE" && !l.isExpired && num(l.available) > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const alvo = elegiveis[0];

  // ── Proibido 8: correção que deixaria saldo negativo ───────────────────
  if (!S.dados.provaSaldoNegativo) {
    const excesso = (num(alvo.available) + 5).toFixed(6);
    await caminhoProibido(
      "PROIBIDO-8 · correção que deixaria saldo negativo",
      {
        pre: `lote ${alvo.code} com ${alvo.available} kg disponíveis`,
        acao: `Ajustar estoque › Ajuste de saída › ${excesso} kg (5 kg acima do disponível)`,
        esperado: "recusa; nunca existe saldo negativo",
        invariante: `saldo do lote continua ${alvo.available} kg e nenhum movimento nasce`,
      },
      async () => {
        await abrirAjuste();
        const opcoes = await page.locator("#adjust-lot option").allTextContents();
        await page.selectOption("#adjust-lot", { label: opcoes.find((o) => o.includes(alvo.code)) });
        await page.selectOption("#adjust-type", "ADJUSTMENT_OUT");
        await preencher("#adjust-quantity", excesso);
        await preencher("#adjust-reason", "ADV tentativa de deixar saldo negativo");
        await page.getByRole("button", { name: "Confirmar ajuste", exact: true }).click();
        await page.waitForTimeout(2200);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    await shot("adv-negative-path-saldo-negativo");
    S.dados.provaSaldoNegativo = true;
    salvarEstado();
  }

  // ── Proibido 6b/7b: zero e negativo no ajuste ──────────────────────────
  if (!S.dados.provaZeroNegativoAjuste) {
    for (const [caso, valor, descricao] of [
      ["PROIBIDO-6b · quantidade ZERO no ajuste de estoque", "0", 'digitar "0" em Quantidade'],
      ["PROIBIDO-7b · quantidade NEGATIVA no ajuste de estoque", "-5", 'digitar "-5" em Quantidade'],
    ]) {
      await caminhoProibido(
        caso,
        {
          pre: `lote ${alvo.code} com ${alvo.available} kg disponíveis`,
          acao: `Ajustar estoque › Ajuste de saída › ${descricao}`,
          esperado: "recusa; ajuste de zero ou negativo não é operação",
          invariante: "nenhum movimento nasce e o saldo do lote não muda",
        },
        async () => {
          await abrirAjuste();
          const opcoes = await page.locator("#adjust-lot option").allTextContents();
          await page.selectOption("#adjust-lot", { label: opcoes.find((o) => o.includes(alvo.code)) });
          await page.selectOption("#adjust-type", "ADJUSTMENT_OUT");
          await preencher("#adjust-quantity", valor);
          await preencher("#adjust-reason", `ADV tentativa com quantidade ${valor}`);
          const botao = page.getByRole("button", { name: "Confirmar ajuste", exact: true });
          if (await botao.isDisabled()) return "botão “Confirmar ajuste” fica DESABILITADO";
          await botao.click();
          await page.waitForTimeout(2000);
          return JSON.stringify(await mensagensDeErro());
        },
      );
    }
    S.dados.provaZeroNegativoAjuste = true;
    salvarEstado();
  }

  // ── Proibido 9: item INATIVO reaproveitado em operação nova ────────────
  if (!S.dados.provaItemInativo) {
    const inativo = S.dados.itemInativo;
    const antesOcs = await totalDeOcs();
    let resultado = "";
    await deliberadamente("PROIBIDO-9 · item inativo em OC nova", async () => {
      await abrir("/compras/ordens/nova", { espera: "#po-supplier" });
      await escolherEntidade("#po-supplier", FORNECEDOR.tradeName, FORNECEDOR.tradeName);
      await clicarBotao("+ Adicionar item");
      await page.waitForTimeout(400);
      const combo = page.locator('input[id^="po-line-item-"]').first();
      await combo.click();
      await combo.fill(inativo.code);
      await page.waitForTimeout(1500);
      const opcoes = await textos("li.entity-select__option[role='option']:not(.entity-select__create)");
      const apareceu = opcoes.some((o) => o.includes(inativo.code));
      resultado = apareceu
        ? `o item inativo ${inativo.code} APARECE na busca da OC: ${JSON.stringify(opcoes)}`
        : `o item inativo ${inativo.code} não aparece na busca da OC (opções: ${JSON.stringify(opcoes)})`;
      if (apareceu) {
        await page
          .locator("li.entity-select__option[role='option']:not(.entity-select__create)")
          .filter({ hasText: inativo.code })
          .first()
          .click();
        await page.waitForTimeout(400);
        const linha = page.locator("table.table tbody tr").first();
        await linha.locator('input[inputmode="decimal"]').nth(0).fill("10");
        await clicarBotao("Salvar rascunho");
        await page.waitForTimeout(2500);
        const erros = await mensagensDeErro();
        const salvou = /^\/compras\/ordens\/[0-9a-f-]{36}$/.test(caminho());
        resultado += ` · salvar rascunho: ${salvou ? "ACEITOU e criou a OC" : "recusou"} ${JSON.stringify(erros)}`;
      }
    });
    const depoisOcs = await totalDeOcs();
    const nasceuOc = depoisOcs > antesOcs;
    registrarCaso("PROIBIDO-9 · item INATIVO em operação nova", {
      pre: `item ${inativo.code} inativado pela tela; nenhuma OC nova`,
      acao: "tentar montar uma OC nova com o item inativo",
      esperado: "o item não é oferecido; se for escolhido, o salvamento recusa",
      real: resultado,
      invariante: `nenhuma OC nova com item inativo (total de OCs ${antesOcs} → ${depoisOcs})`,
      veredito: nasceuOc ? "BUG" : "BLOCKED_CORRECTLY",
    });
    registrarNegativo(
      "PROIBIDO-9 · item INATIVO em operação nova",
      nasceuOc ? "BUG" : "BLOCKED_CORRECTLY",
      `OCs ${antesOcs} → ${depoisOcs}`,
    );
    check("NEGATIVO · item inativo não entra em ordem de compra nova", !nasceuOc, resultado);
    if (nasceuOc) {
      finding(
        "HIGH",
        "Item inativo aceito em ordem de compra nova",
        `Cadastros › Itens · inativar ${inativo.code}; Compras › + Nova OC · escolher o item inativo ` +
          "e salvar o rascunho. A OC é criada.",
      );
    }
    S.dados.provaItemInativo = true;
    salvarEstado();
    await shot("adv-negative-path-item-inativo");
  }

  // ── Proibido 6c/7c: zero e negativo na própria ordem de compra ─────────
  if (!S.dados.provaZeroNegativoOc) {
    for (const [caso, valor] of [
      ["PROIBIDO-6c · quantidade ZERO na ordem de compra", "0"],
      ["PROIBIDO-7c · quantidade NEGATIVA na ordem de compra", "-5"],
    ]) {
      const antesOcs = await totalDeOcs();
      let resultado = "";
      await deliberadamente(caso, async () => {
        await abrir("/compras/ordens/nova", { espera: "#po-supplier" });
        await escolherEntidade("#po-supplier", FORNECEDOR.tradeName, FORNECEDOR.tradeName);
        await clicarBotao("+ Adicionar item");
        await page.waitForTimeout(400);
        await escolherEntidade(page.locator('input[id^="po-line-item-"]').first(), MP.nome, MP.nome);
        const linha = page.locator("table.table tbody tr").first();
        await linha.locator('input[inputmode="decimal"]').nth(0).fill(valor);
        await clicarBotao("Salvar rascunho");
        await page.waitForTimeout(2500);
        resultado = `${JSON.stringify(await mensagensDeErro())} · url=${caminho()}`;
      });
      const depoisOcs = await totalDeOcs();
      const nasceu = depoisOcs > antesOcs;
      registrarCaso(caso, {
        pre: "nenhuma OC nova",
        acao: `montar OC com quantidade "${valor}" e salvar o rascunho`,
        esperado: "recusa; quantidade inválida não vira pedido",
        real: resultado,
        invariante: `total de ordens de compra inalterado (${antesOcs} → ${depoisOcs})`,
        veredito: nasceu ? "BUG" : "BLOCKED_CORRECTLY",
      });
      registrarNegativo(caso, nasceu ? "BUG" : "BLOCKED_CORRECTLY", `OCs ${antesOcs} → ${depoisOcs}`);
      check(`NEGATIVO · ${caso}`, !nasceu, resultado);
    }
    S.dados.provaZeroNegativoOc = true;
    salvarEstado();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 11 · Reconstrução do ledger, lote a lote
// ══════════════════════════════════════════════════════════════════════════
const SINAL = {
  RECEIPT_IN: 1,
  ADJUSTMENT_IN: 1,
  OPENING_BALANCE: 1,
  FINISHED_GOOD_PRODUCTION: 1,
  ADJUSTMENT_OUT: -1,
  LOSS: -1,
  PRODUCTION_CONSUMPTION: -1,
  SAMPLE_CONSUMPTION: -1,
  SHIPMENT_OUT: -1,
};

async function marco11Ledger() {
  const lotes = await lerLotesDoItem(S.dados.item.id);
  const movimentos = await lerMovimentos(S.dados.item.id);
  const linhas = [];
  let tudoFecha = true;

  for (const lote of lotes) {
    const meus = movimentos.filter((m) => m.lotCode === lote.code);
    let entradas = 0;
    let saidas = 0;
    for (const m of meus) {
      const s = SINAL[m.type];
      if (s === undefined) {
        tudoFecha = false;
        linhas.push({ lote: lote.code, erro: `tipo de movimento desconhecido: ${m.type}` });
        continue;
      }
      if (s > 0) entradas += num(m.quantity);
      else saidas += num(m.quantity);
    }
    const calculado = entradas - saidas;
    const real = num(lote.onHand);
    const diferenca = Math.abs(calculado - real);
    const fecha = diferenca < 1e-9;
    if (!fecha) tudoFecha = false;
    linhas.push({
      lote: lote.code,
      validade: lote.expiryDate,
      status: lote.status,
      vencido: lote.isExpired,
      movimentos: meus.length,
      entradas: Number(entradas.toFixed(6)),
      saidas: Number(saidas.toFixed(6)),
      calculado: Number(calculado.toFixed(6)),
      saldoDoSistema: real,
      diferenca: Number(diferenca.toFixed(9)),
      fecha,
    });
    check(
      `LEDGER · ${lote.code}: entradas ${entradas} − saídas ${saidas} = ${calculado} bate com o saldo ${real}`,
      fecha,
      `diferença ${diferenca}`,
    );
  }

  S.dados.ledger = linhas;
  salvarEstado();
  console.log("\n── LEDGER ──");
  for (const l of linhas) console.log(JSON.stringify(l));

  if (!tudoFecha) {
    finding(
      "CRITICAL",
      "Reconstrução do ledger não fecha: saldo do lote diverge da soma dos movimentos",
      `Estoque › ${S.dados.item.code} › Ver movimentações · somar entradas e subtrair saídas por lote ` +
        `e comparar com o físico do lote. Divergências: ${JSON.stringify(linhas.filter((l) => !l.fecha))}`,
    );
  }
  check("LEDGER · todo lote fecha entradas − saídas = saldo, com tolerância zero", tudoFecha, "");

  await abrir(`/estoque/movimentacoes?itemId=${S.dados.item.id}`, { espera: ".page__title" });
  await page.waitForTimeout(1500);
  await shot("adv-stock-11-ledger");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 12 · Filtro de tipo na tela de movimentações
// ══════════════════════════════════════════════════════════════════════════
/**
 * A tela oferece nove tipos no filtro; a API aceita quatro. Se a suspeita se
 * confirmar, o operador escolhe uma opção legítima da lista e recebe erro de
 * validação — defeito de tela, não de dado.
 */
async function marco12FiltroDeTipo() {
  await abrir("/estoque/movimentacoes", { espera: ".page__title" });
  const opcoes = await page.evaluate(() =>
    [...document.querySelectorAll("#movements-type-filter option")].map((o) => ({
      valor: o.value,
      texto: (o.textContent ?? "").trim(),
    })),
  );
  const problemas = [];
  for (const opcao of opcoes) {
    if (!opcao.valor) continue;
    await deliberadamente(`filtro-tipo:${opcao.valor}`, async () => {
      await page.selectOption("#movements-type-filter", opcao.valor);
      await page.waitForTimeout(1400);
    });
    const erros = errosDeliberados(`filtro-tipo:${opcao.valor}`);
    const naTela = await mensagensDeErro();
    if (erros.length > 0 || naTela.length > 0) {
      problemas.push({ opcao: opcao.texto, valor: opcao.valor, http: erros.map((e) => e.status), naTela });
    }
  }
  registrarCaso("TELA · filtro de tipo em Movimentações", {
    pre: `o filtro oferece ${opcoes.filter((o) => o.valor).length} tipos de movimento`,
    acao: "selecionar cada tipo, um por vez",
    esperado: "toda opção oferecida na lista é aceita pela consulta",
    real: problemas.length === 0 ? "todas aceitas" : JSON.stringify(problemas),
    invariante: "filtro é leitura — nada é escrito em qualquer caso",
    veredito: problemas.length === 0 ? "PASS" : "FAIL",
  });
  check(
    "TELA · todo tipo oferecido no filtro de Movimentações é aceito pela consulta",
    problemas.length === 0,
    JSON.stringify(problemas),
  );
  if (problemas.length > 0) {
    finding(
      "MEDIUM",
      "Filtro de tipo em Estoque › Movimentações oferece opções que a consulta recusa",
      `Estoque › Movimentações · escolher no filtro "Tipo" qualquer uma de: ` +
        `${problemas.map((p) => `"${p.opcao}"`).join(", ")}. A consulta responde erro de validação e a ` +
        "lista não carrega. A tela renderiza os nove tipos do domínio; a consulta aceita quatro.",
    );
    await shot("adv-stock-12-filtro-de-tipo");
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 13 · Reserva, separação e consumo reais
// ══════════════════════════════════════════════════════════════════════════
/**
 * A sugestão FEFO é leitura; a reserva é escrita.
 *
 * Sem passar por uma Ordem de Produção, "consumir a partir de lote
 * bloqueado" e "consumir A inteiro e parte de B" ficariam provados só na
 * tela de consulta — que é justamente a que não movimenta estoque. Este
 * marco leva a cadeia até a baixa física.
 */
async function marco13ReservaEConsumo() {
  // ── Produto e formulação, pela tela ────────────────────────────────────
  if (!S.dados.produto) {
    const clientes = (await apiGet("/customers?pageSize=5")).customers ?? [];
    if (!check("OP · há cliente cadastrado para vincular o produto", clientes.length > 0, "")) return;
    const cliente = clientes[0];
    await abrir("/cadastros/produtos/novo", { espera: "#product-name" });
    await escolherEntidade("#product-customer", cliente.code, cliente.code);
    await preencher("#product-name", `${P} Produto Carbonato`);
    if ((await page.locator("#product-finished-unit").count()) > 0) {
      await page.selectOption("#product-finished-unit", "un");
    }
    await clicarBotao("Criar produto");
    await page.waitForTimeout(2500);
    const achado = ((await apiGet(`/products?search=${encodeURIComponent(`${P} Produto`)}&pageSize=10`)).products ?? [])
      .find((p) => p.name === `${P} Produto Carbonato`);
    if (!check("OP · o produto nasceu pela tela", Boolean(achado), JSON.stringify(await mensagensDeErro()))) return;
    S.dados.produto = { id: achado.id, code: achado.code, name: achado.name };
    salvarEstado();
  }

  if (!S.dados.formulacao) {
    await abrir(`/producao/formulacoes/${S.dados.produto.id}`, { espera: ".doc-title, .page__title" });
    await clicarBotao("Criar formulação em branco");
    const foi = await esperarUrl((u) => /\/versoes\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
    if (!check("OP · a formulação em branco abriu com URL própria", foi, caminho())) return;
    await page.waitForSelector("#version-basis", { timeout: 25000 });
    await preencher("#version-basis", "1000");
    await clicarBotao("+ Adicionar componente");
    await page.waitForTimeout(500);
    await escolherEntidade(page.locator('input[id^="componente-"]').first(), S.dados.item.code, S.dados.item.code);
    await page.waitForTimeout(600);
    // A necessidade é o saldo real do item 260 — seis casas, de propósito.
    await preencher(`input[aria-label="Quantidade de ${S.dados.item.code}"]`, SALDO_REAL);
    await page.waitForTimeout(300);
    await clicarBotao("Salvar rascunho");
    await page.waitForTimeout(2500);
    await clicarBotao("Ativar versão");
    await confirmarDialogo("Ativar");
    await page.waitForTimeout(2500);
    const ativa = ((await apiGet(`/products/${S.dados.produto.id}/formulations`)).versions ?? []).find(
      (v) => v.status === "ACTIVE",
    );
    if (!check("OP · a formulação foi ativada com o componente na quantidade real", Boolean(ativa), JSON.stringify(await mensagensDeErro()))) {
      return;
    }
    S.dados.formulacao = { versionId: ativa.id, label: ativa.versionLabel };
    salvarEstado();
  }

  // ── Ordem de Produção → reserva ────────────────────────────────────────
  const antesDaReserva = await lerLotesDoItem(S.dados.item.id);
  /*
   * A lista de elegíveis é congelada ANTES da liberação e guardada no estado.
   * Depois da reserva, os mesmos lotes passam a ter disponível zero — e um
   * roteiro que recalculasse a lista numa reexecução ficaria sem referência
   * justamente contra o resultado que precisa julgar.
   */
  if (!S.dados.elegiveisAntesDaReserva) {
    S.dados.elegiveisAntesDaReserva = antesDaReserva
      .filter((l) => l.status === "AVAILABLE" && !l.isExpired && num(l.available) > 0)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
      .map((l) => ({ code: l.code, expiryDate: l.expiryDate, available: l.available }));
    salvarEstado();
  }
  const elegiveis = S.dados.elegiveisAntesDaReserva;
  if (!check("OP · há pelo menos dois lotes elegíveis para a reserva", elegiveis.length >= 2, JSON.stringify(elegiveis))) {
    return;
  }
  const [primeiro, segundo] = elegiveis;
  const bloqueado = antesDaReserva.find((l) => l.status === "BLOCKED");
  const vencidos = antesDaReserva.filter((l) => l.isExpired);

  if (!S.dados.op) {
    await abrir("/producao/ordens/nova", { espera: "#op-product" });
    await escolherEntidade("#op-product", S.dados.produto.code, S.dados.produto.code);
    await page.waitForTimeout(1200);
    await page.selectOption("#op-formulation", { index: 1 });
    await preencher("#op-quantity", "1000");
    await clicarBotao("Salvar rascunho");
    const foi = await esperarUrl((u) => /^\/producao\/ordens\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
    if (!check("OP · o rascunho da ordem de produção foi salvo", foi, JSON.stringify(await mensagensDeErro()))) return;
    S.dados.op = { code: await texto(".doc-title h1"), url: caminho() };
    salvarEstado();
    await clicarBotao("Planejar OP");
    await page.waitForTimeout(2200);
  }

  await abrir(S.dados.op.url, { espera: ".doc-title h1" });
  if (await existeBotao("Liberar OP")) {
    await clicarBotao("Liberar OP");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(2500);
  }
  // "Em produção" também vale: o primeiro consumo real avança a OP, e numa
  // reexecução a ordem já terá passado desse ponto.
  const situacaoOp = await texto(".doc-title .badge");
  check(
    "OP · a ordem passou da liberação (reserva de material efetivada)",
    /Liberad|Em produção|Concluíd/i.test(situacaoOp),
    situacaoOp,
  );

  const reservados = await page.evaluate(() => {
    const secao = [...document.querySelectorAll("section.form-section")].find((s) =>
      (s.querySelector("h3")?.textContent ?? "").includes("Materiais Reservados"),
    );
    if (!secao) return [];
    return [...secao.querySelectorAll("table tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
  });
  const textoReserva = reservados.map((r) => r.join(" · ")).join(" | ");
  const usouPrimeiro = textoReserva.includes(primeiro.code);
  const usouSegundo = textoReserva.includes(segundo.code);
  const usouBloqueado = bloqueado ? textoReserva.includes(bloqueado.code) : false;
  const usouVencido = vencidos.some((l) => textoReserva.includes(l.code));
  const okReserva = usouPrimeiro && usouSegundo && !usouBloqueado && !usouVencido;

  registrarCaso("FEFO-3 · reserva REAL da Ordem de Produção", {
    pre:
      `necessidade ${SALDO_REAL} kg · elegíveis ${elegiveis.map((l) => `${l.code}=${l.available}`).join(", ")} · ` +
      `bloqueado ${bloqueado?.code ?? "—"} · vencidos ${vencidos.map((l) => l.code).join(", ") || "—"}`,
    acao: `liberar a OP ${S.dados.op.code}, que reserva material de verdade`,
    esperado: `${primeiro.code} inteiro + o resto de ${segundo.code}; nada de lote bloqueado ou vencido`,
    real: textoReserva || "(sem linhas reservadas)",
    invariante: "reserva não baixa estoque: o físico dos lotes continua igual, só o reservado sobe",
    veredito: okReserva ? "PASS" : "FAIL",
  });
  check("FEFO · a reserva real segue a mesma ordem da sugestão (vence primeiro)", usouPrimeiro && usouSegundo, textoReserva);
  check("FEFO · a reserva real ignorou o lote BLOQUEADO e os VENCIDOS", !usouBloqueado && !usouVencido, textoReserva);

  const depoisDaReserva = await lerLotesDoItem(S.dados.item.id);
  const fisicoIgual = antesDaReserva.every(
    (l) => String(l.onHand) === String(depoisDaReserva.find((x) => x.code === l.code)?.onHand),
  );
  check("INVARIANTE · reservar não moveu estoque físico (reserva ≠ consumo)", fisicoIgual, "");
  await shot("adv-stock-fefo-reserva-real");

  // ── Proibido 4b: bloquear lote que já está reservado ───────────────────
  if (!S.dados.provaBloquearReservado) {
    const loteReservado = depoisDaReserva.find((l) => num(l.reserved) > 0);
    if (loteReservado) {
      await caminhoProibido(
        "PROIBIDO-4b · bloquear lote que já está RESERVADO",
        {
          pre: `lote ${loteReservado.code} com ${loteReservado.reserved} kg reservados pela OP ${S.dados.op.code}`,
          acao: "Qualidade › Bloquear › motivo obrigatório",
          esperado: "recusa; bloquear material já comprometido esconderia a reserva",
          invariante: "o lote continua Disponível e a reserva continua de pé",
        },
        async () => {
          await abrirLote(loteReservado.id);
          if (!(await existeBotao("Bloquear"))) return "a tela nem oferece “Bloquear” para lote reservado";
          await clicarBotao("Bloquear");
          await preencher("#block-lot-reason", "ADV tentativa de bloquear lote reservado");
          await page.getByRole("button", { name: "Bloquear lote", exact: true }).click();
          await page.waitForTimeout(2000);
          return JSON.stringify(await mensagensDeErro());
        },
      );
    }
    S.dados.provaBloquearReservado = true;
    salvarEstado();
  }

  // ── Separação (picking) ────────────────────────────────────────────────
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });
  for (let volta = 0; volta < 6; volta += 1) {
    const botao = page.getByRole("button", { name: "Escanear / Informar lote", exact: true }).first();
    if ((await botao.count()) === 0) break;
    await botao.click();
    await page.waitForTimeout(600);
    const campo = page.locator("#lot-scanner-manual");
    if ((await campo.count()) === 0) break;
    // O lote esperado está na própria linha, coluna "Lote esperado".
    const esperado = await page.evaluate(() => {
      const linha = [...document.querySelectorAll("tr")].find((tr) =>
        tr.querySelector("#lot-scanner-manual"),
      );
      const anterior = linha?.previousElementSibling;
      const celulas = [...(anterior?.querySelectorAll("td") ?? [])].map((td) =>
        (td.textContent ?? "").replace(/\s+/g, " ").trim(),
      );
      return celulas[1] ?? "";
    });
    await campo.fill(esperado);
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await page.waitForTimeout(2200);
  }
  const pendentes = (await textos("span.badge")).filter((t) => t === "Pendente").length;
  check("OP · a separação foi conferida em todas as linhas reservadas", pendentes === 0, `${pendentes} pendente(s)`);
  await shot("adv-stock-13-picking");

  // ── Proibido: consumir ACIMA do reservado ──────────────────────────────
  if (!S.dados.provaConsumoAcima) {
    const linhaReservada = depoisDaReserva.find((l) => num(l.reserved) > 0);
    await caminhoProibido(
      "PROIBIDO-10 · consumir acima do reservado",
      {
        pre: `linha do lote ${linhaReservada?.code} com ${linhaReservada?.reserved} kg reservados`,
        acao: "digitar uma quantidade maior que o reservado em “Consumir agora” e confirmar",
        esperado: "recusa; consumo não pode ultrapassar a reserva sem consumo extra explícito",
        invariante: "nenhum movimento de consumo nasce e o físico do lote não muda",
      },
      async () => {
        await abrir(S.dados.op.url, { espera: ".doc-title h1" });
        const campo = page.locator('section.form-section:has(h3:has-text("Consumo Real")) input[inputmode="decimal"]').first();
        if ((await campo.count()) === 0) return "(sem campo de consumo na tela)";
        await campo.fill(String(num(linhaReservada.reserved) + 1));
        await page.waitForTimeout(400);
        const botao = page.getByRole("button", { name: "Confirmar consumo", exact: true }).first();
        if (await botao.isDisabled()) return "botão “Confirmar consumo” fica DESABILITADO acima do reservado";
        await botao.click();
        await page.waitForTimeout(2200);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    S.dados.provaConsumoAcima = true;
    salvarEstado();
    await shot("adv-negative-path-consumo-acima");
  }

  // ── Proibido 4c: consumo extra a partir do lote BLOQUEADO ──────────────
  if (!S.dados.provaConsumoBloqueado && bloqueado) {
    await caminhoProibido(
      "PROIBIDO-4c · consumir a partir de lote BLOQUEADO",
      {
        pre: `lote ${bloqueado.code} Bloqueado com ${bloqueado.onHand} kg físicos`,
        acao: `“Adicionar consumo extra” apontando explicitamente para o lote bloqueado ${bloqueado.code}`,
        esperado: "recusa; material bloqueado não entra em produção nem por caminho excepcional",
        invariante: "nenhuma reserva extra, nenhum consumo, físico do lote bloqueado intacto",
      },
      async () => {
        await abrir(S.dados.op.url, { espera: ".doc-title h1" });
        const botao = page.getByRole("button", { name: "Adicionar consumo extra", exact: true }).first();
        if ((await botao.count()) === 0) return "(a tela não ofereceu “Adicionar consumo extra”)";
        await botao.click();
        await page.waitForSelector("#extra-quantity", { timeout: 20000 });
        await preencher("#extra-quantity", "1");
        const outro = page.locator("#extra-other-lot");
        if ((await outro.count()) > 0) await outro.check();
        await page.waitForTimeout(300);
        const campoLote = page.locator("#extra-lot-code");
        if ((await campoLote.count()) > 0) await campoLote.fill(bloqueado.code);
        await preencher("#extra-reason", "ADV tentativa de consumir lote bloqueado");
        // O diálogo e o rodapé da tabela usam o MESMO rótulo; o submit é o do
        // formulário do diálogo, e é ele que precisa ser clicado.
        const enviar = page.locator(
          'button[type="submit"][form="extra-consumption-form"]',
        );
        if (await enviar.isDisabled()) {
          return "o botão “Adicionar consumo extra” do diálogo fica DESABILITADO com o lote bloqueado";
        }
        await enviar.click();
        await page.waitForTimeout(2600);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    S.dados.provaConsumoBloqueado = true;
    salvarEstado();
    await shot("adv-stock-blocked-consumo-extra");
  }

  // ── Consumo correto: A inteiro e parte de B ────────────────────────────
  if (!S.dados.provaConsumo) {
    /*
     * Cada linha de "Consumo Real" tem o SEU botão "Confirmar consumo".
     * Preencher as duas e clicar uma vez só confirmaria apenas a primeira —
     * e o roteiro reprovaria a segunda por um erro dele, não do produto.
     */
    const secaoConsumo = () =>
      page.locator("section.form-section").filter({ has: page.locator("h3", { hasText: "Consumo Real" }) });
    for (let volta = 0; volta < 8; volta += 1) {
      await abrir(S.dados.op.url, { espera: ".doc-title h1" });
      const linhas = secaoConsumo().locator("table tbody tr");
      const total = await linhas.count();
      let confirmou = false;
      for (let i = 0; i < total; i += 1) {
        const linha = linhas.nth(i);
        const campo = linha.locator('input[inputmode="decimal"]');
        if ((await campo.count()) === 0 || (await campo.first().isDisabled())) continue;
        const celulas = await linha.locator("td").allTextContents();
        // Coluna "Restante" — consumir exatamente o que resta da reserva.
        const restante = (celulas[4] ?? "").replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}\b)/g, "");
        if (!restante || num(restante.replace(",", ".")) <= 0) continue;
        await campo.first().fill(restante);
        await page.waitForTimeout(300);
        const botao = linha.getByRole("button", { name: "Confirmar consumo", exact: true });
        if ((await botao.count()) === 0 || (await botao.first().isDisabled())) continue;
        await botao.first().click();
        await page.waitForTimeout(2800);
        confirmou = true;
        break;
      }
      if (!confirmou) break;
    }

    const depoisDoConsumo = await lerLotesDoItem(S.dados.item.id);
    const movimentos = await lerMovimentos(S.dados.item.id);
    const consumos = movimentos.filter((m) => m.type === "PRODUCTION_CONSUMPTION");
    const consumoPorLote = {};
    for (const m of consumos) consumoPorLote[m.lotCode] = (consumoPorLote[m.lotCode] ?? 0) + num(m.quantity);
    const consumiuPrimeiroInteiro = Math.abs((consumoPorLote[primeiro.code] ?? 0) - num(primeiro.available)) < 1e-9;
    const resto = num(SALDO_REAL) - num(primeiro.available);
    const consumiuRestoNoSegundo = Math.abs((consumoPorLote[segundo.code] ?? 0) - resto) < 1e-9;
    const naoTocouOutros = Object.keys(consumoPorLote).every((c) => c === primeiro.code || c === segundo.code);

    registrarCaso("FEFO-4 · consumo físico real", {
      pre: `reserva de ${SALDO_REAL} kg em ${primeiro.code} e ${segundo.code}`,
      acao: "confirmar o consumo real de cada linha",
      esperado: `${primeiro.code} consome ${primeiro.available} kg (inteiro) e ${segundo.code} consome ${resto} kg`,
      real: JSON.stringify(consumoPorLote),
      invariante: "só os dois lotes de menor validade são tocados; nenhum vencido, nenhum bloqueado",
      veredito: consumiuPrimeiroInteiro && consumiuRestoNoSegundo && naoTocouOutros ? "PASS" : "FAIL",
    });
    check(
      `FEFO · o consumo REAL baixou ${primeiro.code} inteiro e ${resto} kg de ${segundo.code}`,
      consumiuPrimeiroInteiro && consumiuRestoNoSegundo,
      JSON.stringify(consumoPorLote),
    );
    check(
      "FEFO · o consumo real não tocou nenhum lote vencido nem o bloqueado",
      naoTocouOutros,
      JSON.stringify(consumoPorLote),
    );
    S.dados.consumoPorLote = consumoPorLote;
    salvarEstado();
    await shot("adv-stock-fefo-consumo-real");
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Execução
// ══════════════════════════════════════════════════════════════════════════
let parada = null;

async function principal() {
  await login();
  await abrirNavegador();

  await marco(1, "cadastro", marco01Cadastro);
  await marco(2, "ordens-de-compra", marco02Ocs);
  await marco(3, "recebimento-parcial", marco03RecebimentoParcial);
  await marco(4, "clique-e-recarga", marco04CliqueERecarga);
  await marco(5, "zero-negativo-e-resto", marco05ZeroNegativoEResto);
  await marco(6, "qualidade", marco06Qualidade);
  await marco(7, "correcao-e-decimal", marco07CorrecaoEDecimal);
  await marco(8, "fefo", marco08Fefo);
  await marco(9, "lote-bloqueado", marco09LoteBloqueado);
  await marco(10, "negativos-de-estoque", marco10NegativosDeEstoque);
  await marco(11, "ledger", marco11Ledger);
  await marco(12, "reserva-e-consumo", marco13ReservaEConsumo);
  // O ledger fecha a seção: depois do consumo real, tudo tem de bater de novo.
  S.marcos = S.marcos.filter((m) => m !== "13-ledger-final");
  await marco(13, "ledger-final", marco11Ledger);
  /*
   * Por último de propósito: é um defeito de TELA já confirmado (MEDIUM), e
   * um marco que reprova interrompe a cadeia. Deixá-lo no fim garante que a
   * onda inteira roda antes de a reprovação parar o roteiro.
   */
  await marco(14, "filtro-de-tipo", marco12FiltroDeTipo);
}

principal()
  .catch((e) => {
    const msg = String(e?.message ?? e);
    if (msg === "__PARADA_SOLICITADA__") parada = `parada solicitada em --ate=${ATE}`;
    else if (msg.startsWith("__MARCO_FALHOU__")) parada = `marco reprovado: ${msg.replace("__MARCO_FALHOU__ ", "")}`;
    else {
      parada = `erro inesperado: ${msg}`;
      console.error(e);
    }
  })
  .finally(async () => {
    salvarEstado();
    if (browser) await browser.close();

    const reg = S.registro;
    console.log("\n════════════════════ RESUMO ════════════════════");
    console.log(`marcos concluídos: ${S.marcos.join(", ") || "(nenhum)"}`);
    console.log(`verificações ok=${reg.verificacoes.ok.length} nok=${reg.verificacoes.nok.length}`);
    if (reg.verificacoes.nok.length) {
      console.log("\nREPROVADAS:");
      for (const f of reg.verificacoes.nok) console.log(`  ✗ ${f}`);
    }
    console.log("\nNEGATIVOS:");
    for (const n of reg.negativos) console.log(`  ${n.veredito.padEnd(18)} ${n.caso} — ${n.detalhe}`);
    console.log("\nFINDINGS:");
    for (const f of reg.findings) console.log(`  ${f.severidade} — ${f.titulo}`);
    console.log("\nCONSOLE NÃO DELIBERADO:");
    console.log(`  console.error=${consoleErrors.length} pageerror=${pageErrors.length}`);
    for (const c of consoleErrors.slice(0, 12)) console.log(`   · ${c}`);
    for (const c of pageErrors.slice(0, 12)) console.log(`   · ${c}`);
    console.log("\nRESPOSTAS >=400 NÃO DELIBERADAS:");
    for (const r of respostasComErro.slice(0, 25)) console.log(`   · ${r.method} ${r.pathname} → ${r.status}`);
    console.log(`\nRESPOSTAS >=400 DELIBERADAS: ${deliberados.rede.length}`);
    if (dialogosNativos.length) console.log(`\nDIÁLOGOS NATIVOS: ${JSON.stringify(dialogosNativos)}`);
    if (parada) console.log(`\nPARADA: ${parada}`);
    console.log(`\nestado: ${STATE_FILE}`);
    console.log(`screens: ${path.resolve(OUT)}`);
    process.exit(reg.verificacoes.nok.length > 0 || parada?.startsWith("erro") ? 1 : 0);
  });
