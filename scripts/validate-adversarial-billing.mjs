import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * VALIDAÇÃO ADVERSARIAL — EXPEDIÇÃO, FATURAMENTO, PREÇO HISTÓRICO E
 * ARREDONDAMENTO.
 *
 * Terceira onda. A primeira (`validate-adversarial-stock.mjs`) parou no
 * consumo físico; a segunda (`validate-adversarial-production.mjs`) fechou a
 * Ordem de Produção e deixou produto acabado reservado. Esta continua dali,
 * pelo fim do fluxo comercial: Reserva → Expedição → Faturamento.
 *
 * Rodada de VALIDAÇÃO, não de implementação: defeito encontrado é RELATADO,
 * nunca consertado. Nenhuma linha de código de produto é tocada por este
 * arquivo.
 *
 * ## A regra
 *
 * Operação de negócio NASCE PELA INTERFACE. Fora da tela só existem
 * `POST /auth/login` (uma vez, para o cookie do navegador) e leituras `GET`
 * de conferência — sempre DEPOIS da ação, para conferir saldo, contar
 * documentos e provar invariante. Nunca para fabricar o resultado esperado.
 *
 * ## Massa
 *
 * O substrato das ondas anteriores não tem produto acabado LIVRE: as 800 un
 * de `PA-000365` estão inteiramente reservadas a `PED-000485`/`PED-000486`.
 * E preço acordado não nasce no formulário de Pedido — só a cadeia
 * Projeto → Orçamento → Pedido grava `agreedUnitPrice`.
 *
 * Por isso esta onda usa `PROD-000002` (`PA-000002`), que tem 500 un num
 * lote AGUARDANDO LIBERAÇÃO e um cálculo de custo real salvo
 * (`CALC-000002`, custo/un 5,252480), e monta pela tela:
 *
 *   * liberação do lote pela Qualidade (500 un passam a disponíveis);
 *   * uma precificação com as FAIXAS REAIS da planilha — 300/500/1000 un a
 *     R$ 4,00 / R$ 3,80 / R$ 3,60, comissão 5% — mais duas faixas de
 *     quantidade menor ao preço de centavo quebrado `R$ 4,0531`, que é onde
 *     o arredondamento aparece;
 *   * dois projetos, dois orçamentos e dois pedidos com preço acordado
 *     vindo da FAIXA (proveniência, não digitação solta).
 *
 * `R$ 4,0531` é o preço com quatro casas que o domínio aceita
 * (`Decimal(14,4)` em `quote_lines`, `customer_order_lines` e
 * `billing_lines`) — o menor valor plausível que produz centavo quebrado em
 * quantidade inteira. As demais faixas são a planilha real, sem alteração.
 *
 * PRIVACIDADE: nenhum CNPJ, telefone, e-mail, endereço ou razão social real
 * entra em log, screenshot ou relatório.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-adversarial-billing.mjs
 *   ... --ate=6      para depois do marco 6
 *   ... --reset      ignora o estado e recomeça
 */

const OUT = "handoff/screens/adversarial";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

const STATE_FILE = path.resolve("handoff/adversarial-billing-state.json");
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
S.registro.numeros = S.registro.numeros ?? {};

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

/** Números provados ficam no estado — o relatório cita, não recalcula. */
function numero(chave, valor) {
  S.registro.numeros[chave] = valor;
  console.log(`  # ${chave} = ${JSON.stringify(valor)}`);
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

// ══ Massa ═════════════════════════════════════════════════════════════════
const P = "ADV3";

/** Produto e cliente do substrato — reaproveitados, nunca recriados. */
const PRODUTO_CODE = "PROD-000002";
const ITEM_PA_CODE = "PA-000002";

/**
 * Faixas de preço.
 *
 * 300/500/1000 a 4,00/3,80/3,60 com comissão de 5% são a planilha real, sem
 * mudança. As faixas de 100 e 123 un existem porque a validação precisa de
 * uma quantidade pequena (o estoque livre é finito) e de um preço com
 * CENTAVO QUEBRADO: `4,0531` tem as quatro casas que o banco guarda e
 * produz terceira casa em qualquer quantidade inteira que não seja múltiplo
 * de 10.000.
 */
const PRECO_QUEBRADO = "4.0531";
const FAIXAS = [
  { quantidade: 100, preco: PRECO_QUEBRADO, real: false },
  { quantidade: 123, preco: PRECO_QUEBRADO, real: false },
  { quantidade: 300, preco: "4.00", real: true },
  { quantidade: 500, preco: "3.80", real: true },
  { quantidade: 1000, preco: "3.60", real: true },
];
const COMISSAO = "5";

/** Segunda precificação — a "vigente nova" que o faturamento NÃO pode usar. */
const FAIXAS_V2 = [
  { quantidade: 100, preco: "9.9900" },
  { quantidade: 123, preco: "9.9900" },
  { quantidade: 300, preco: "9.50" },
  { quantidade: 500, preco: "9.00" },
  { quantidade: 1000, preco: "8.50" },
];

const PEDIDO_A_QTD = 100;
const EXPEDIR_1 = 40;
const EXPEDIR_2 = 60;
const PEDIDO_B_QTD = 123;

/** Lotes do substrato usados nos caminhos proibidos. */
const LOTE_BLOQUEADO_MP = "LT-20260320-000799";
const LOTE_OUTRO_PRODUTO = "LT-20260903-000803";

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

function instrumentar(alvo) {
  alvo.on("dialog", async (d) => {
    dialogosNativos.push(`${d.type()}: ${d.message().slice(0, 200)} @ ${alvo.url()}`);
    await d.accept();
  });
  alvo.on("console", (m) => {
    if (m.type() !== "error") return;
    const texto = `${m.text().slice(0, 240)} @ ${alvo.url()}`;
    if (/^Failed to load resource/.test(m.text())) {
      avisosDeRede.push(texto);
      return;
    }
    if (janelaDeliberada) deliberados.console.push(`[${janelaDeliberada}] ${texto}`);
    else consoleErrors.push(texto);
  });
  alvo.on("pageerror", (e) => {
    const texto = `pageerror @ ${alvo.url()} :: ${e.message.slice(0, 240)}`;
    if (janelaDeliberada) deliberados.pageerror.push(`[${janelaDeliberada}] ${texto}`);
    else pageErrors.push(texto);
  });
  alvo.on("response", (res) => {
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

async function abrirNavegador() {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
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
  instrumentar(page);
}

/** Segunda aba real, para os casos de estado velho. */
async function novaAba() {
  const outra = await context.newPage();
  instrumentar(outra);
  return outra;
}

/** Executa `fn` com `page` apontando para outra aba — helpers seguem servindo. */
async function comAba(outra, fn) {
  const anterior = page;
  page = outra;
  try {
    return await fn();
  } finally {
    page = anterior;
  }
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

async function selecionar(seletor, valor) {
  await page.locator(seletor).first().selectOption(valor);
  await page.waitForTimeout(200);
}

/**
 * Decimal na tela: tenta VÍRGULA primeiro (é o separador do usuário
 * brasileiro) e cai para ponto se a vírgula não for aceita. Devolve qual
 * separador funcionou — recusa silenciosa da vírgula é achado, não detalhe.
 */
async function preencherDecimal(seletor, valor) {
  const comVirgula = String(valor).replace(".", ",");
  await preencher(seletor, comVirgula);
  const lido = await page.locator(seletor).first().inputValue();
  if (lido.replace(",", ".") === String(valor)) return "virgula";
  await preencher(seletor, String(valor));
  return "ponto";
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
        ".form-alert, .form-error, .field__error, .alert--error, [role='alert'], .toast--error, .doc-alert, .field__hint--error",
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
  const titulo = await texto(".confirm-dialog h2");
  await dialogo.getByRole("button", { name: textoBotao, exact: true }).first().click();
  await page.waitForTimeout(1200);
  return titulo;
}

/**
 * Confirma um diálogo cujo rótulo do botão de confirmação pode variar.
 * Nunca clica em "Voltar"/"Cancelar" — a última ação do rodapé é a
 * confirmação em todos os diálogos do sistema.
 */
async function confirmarDialogoFlexivel(preferidos = []) {
  const dialogo = page.locator(".confirm-dialog");
  if ((await dialogo.count()) === 0) return null;
  await dialogo.first().waitFor({ state: "visible", timeout: 10000 });
  const titulo = await texto(".confirm-dialog h2");
  for (const rotulo of preferidos) {
    const b = dialogo.getByRole("button", { name: rotulo, exact: true });
    if ((await b.count()) > 0) {
      await b.first().click();
      await page.waitForTimeout(1200);
      return titulo;
    }
  }
  const acoes = dialogo.locator(".confirm-dialog__actions button");
  const n = await acoes.count();
  if (n > 0) {
    await acoes.nth(n - 1).click();
    await page.waitForTimeout(1200);
  }
  return titulo;
}

const secao = (titulo) =>
  page.locator("section.form-section").filter({ has: page.locator("h3", { hasText: titulo }) });

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
const perto = (a, b, tol = 1e-9) => Math.abs(num(a) - num(b)) < tol;
const dinheiro = (v) => Number(num(v).toFixed(2));

async function lerLotesDoItem(itemId) {
  const d = await apiGet(`/inventory/${itemId}`);
  return (d?.lots ?? []).map((l) => ({
    id: l.lotId ?? l.id,
    code: l.lotCode ?? l.code,
    status: l.status,
    isExpired: l.isExpired,
    onHand: l.onHand,
    reserved: l.reserved,
    available: l.available,
  }));
}

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
  }));
}

const lerPedido = async (id) => apiGet(`/customer-orders/${id}`);
const lerExpedicao = async (id) => apiGet(`/shipments/${id}`);
const lerFaturamento = async (id) => apiGet(`/billings/${id}`);

const idDaUrl = (url) => url.split("/").pop();

function itensRastreados() {
  return [S.dados.itemPa, S.dados.itemPaAdv].filter(Boolean);
}

/**
 * Foto completa do território tocado: lotes, movimentos, reservas, status de
 * pedido/expedição/faturamento.
 *
 * É a base de toda invariante deste roteiro. "Deu erro" não prova ausência
 * de escrita parcial; foto igual antes e depois, prova.
 */
async function fotografar(rotulo) {
  const itens = {};
  for (const it of itensRastreados()) {
    const lotes = await lerLotesDoItem(it.id);
    const movimentos = await lerMovimentos(it.id);
    itens[it.code] = {
      lotes,
      totalMovimentos: movimentos.length,
      somaOnHand: Number(lotes.reduce((a, l) => a + num(l.onHand), 0).toFixed(6)),
      somaReservado: Number(lotes.reduce((a, l) => a + num(l.reserved), 0).toFixed(6)),
    };
  }

  const pedidos = {};
  for (const chave of Object.keys(S.dados.pedidos ?? {})) {
    const registro = S.dados.pedidos[chave];
    if (!registro?.id) continue;
    try {
      const ped = await lerPedido(registro.id);
      pedidos[registro.code] = {
        status: ped.status,
        linhas: (ped.lines ?? []).map(
          (l) => `${l.productCode}:${l.orderedQuantity}/exp=${l.shippedQuantity}/falta=${l.outstandingQuantity}/fat=${l.billedQuantity}`,
        ),
        reserva: (ped.reservation?.lines ?? []).map((l) => `${l.lotCode}:${l.quantity}/rem=${l.reservedRemaining}`),
        reservaStatus: ped.reservation?.status ?? null,
        expedicoes: (ped.shipments ?? []).map((s) => `${s.code}/${s.status}/${s.totalQuantity}`),
        faturamentos: (ped.billings ?? []).map((b) => `${b.code}/${b.status}/${b.totalQuantity}/${b.totalAmount ?? "-"}`),
        situacaoFat: ped.billingStatus,
      };
    } catch {
      pedidos[registro.code] = { erro: "não pôde ser lido" };
    }
  }

  const expedicoes = {};
  for (const chave of Object.keys(S.dados.expedicoes ?? {})) {
    const registro = S.dados.expedicoes[chave];
    if (!registro?.id) continue;
    try {
      const exp = await lerExpedicao(registro.id);
      expedicoes[registro.code] = {
        status: exp.status,
        total: exp.totalQuantity,
        linhas: (exp.lines ?? []).map((l) => `${l.lotCode}:${l.quantity}/conf=${l.verifiedAt ? "sim" : "nao"}`),
        faturamento: exp.billingStatus ?? null,
      };
    } catch {
      expedicoes[registro.code] = { erro: "não pôde ser lida" };
    }
  }

  const faturamentos = {};
  for (const chave of Object.keys(S.dados.faturamentos ?? {})) {
    const registro = S.dados.faturamentos[chave];
    if (!registro?.id) continue;
    try {
      const fat = await lerFaturamento(registro.id);
      faturamentos[registro.code] = {
        status: fat.status,
        totalQtd: fat.totalQuantity,
        totalValor: fat.totalAmount,
        linhas: (fat.lines ?? []).map(
          (l) => `${l.productCode}:${l.quantity}@${l.unitPrice ?? "-"}(acordado ${l.agreedUnitPrice ?? "-"})=${l.lineTotal ?? "-"}`,
        ),
      };
    } catch {
      faturamentos[registro.code] = { erro: "não pôde ser lido" };
    }
  }

  return { rotulo, quando: new Date().toISOString(), itens, pedidos, expedicoes, faturamentos };
}

function diffFoto(a, b) {
  const partes = [];
  for (const code of Object.keys(a.itens)) {
    const x = a.itens[code];
    const y = b.itens[code];
    if (!y) {
      partes.push(`${code} sumiu da foto`);
      continue;
    }
    if (x.totalMovimentos !== y.totalMovimentos) {
      partes.push(`${code} movimentos ${x.totalMovimentos}→${y.totalMovimentos}`);
    }
    for (const l of x.lotes) {
      const o = y.lotes.find((z) => z.code === l.code);
      if (!o) {
        partes.push(`${code}/${l.code} sumiu`);
        continue;
      }
      if (String(l.onHand) !== String(o.onHand)) partes.push(`${l.code} físico ${l.onHand}→${o.onHand}`);
      if (String(l.reserved) !== String(o.reserved)) {
        partes.push(`${l.code} reservado ${l.reserved}→${o.reserved}`);
      }
      if (l.status !== o.status) partes.push(`${l.code} status ${l.status}→${o.status}`);
    }
    if (y.lotes.length !== x.lotes.length) partes.push(`${code} lotes ${x.lotes.length}→${y.lotes.length}`);
  }
  for (const grupo of ["pedidos", "expedicoes", "faturamentos"]) {
    for (const code of Object.keys(a[grupo])) {
      const x = JSON.stringify(a[grupo][code]);
      const y = JSON.stringify(b[grupo][code]);
      if (x !== y) partes.push(`${grupo} ${code} mudou: ${y}`);
    }
    const novos = Object.keys(b[grupo]).filter((c) => !(c in a[grupo]));
    if (novos.length) partes.push(`${grupo} novos: ${novos.join(",")}`);
  }
  return partes.length ? partes.join(" · ") : "nada mudou";
}

const mesmaFoto = (a, b) => diffFoto(a, b) === "nada mudou";

/**
 * O molde de todo caminho proibido.
 *
 * Fotografa antes, executa a tentativa dentro de uma janela deliberada,
 * fotografa depois e só declara BLOCKED_CORRECTLY quando as duas fotos são
 * idênticas.
 */
async function caminhoProibido(caso, { pre, acao, esperado, invariante }, tentativa) {
  const antes = await fotografar(`antes:${caso}`);
  let resultadoDaTela = "";
  await deliberadamente(caso, async () => {
    resultadoDaTela = (await tentativa()) ?? "";
  });
  await page.waitForTimeout(700);
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
const daquiDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ══════════════════════════════════════════════════════════════════════════
// MARCO 1 · Massa: liberar o produto acabado e montar a precificação real
// ══════════════════════════════════════════════════════════════════════════
async function marco01MassaEPrecificacao() {
  const produtos = await apiGet("/products?pageSize=100");
  const produto = (produtos.products ?? []).find((p) => p.code === PRODUTO_CODE);
  if (!check(`MASSA · o produto ${PRODUTO_CODE} do substrato existe`, Boolean(produto), "")) return;
  S.dados.produto = {
    id: produto.id,
    code: produto.code,
    name: produto.name,
    customerId: produto.customerId,
    customerCode: produto.customer?.code ?? "",
  };
  const detalhe = await apiGet(`/products/${produto.id}`);
  S.dados.itemPa = {
    id: detalhe.finishedProductItem.id,
    code: detalhe.finishedProductItem.code,
  };
  const advItem = (await apiGet("/inventory?pageSize=100&onlyWithStock=true")).items.find(
    (i) => i.itemCode === "PA-000365",
  );
  if (advItem) S.dados.itemPaAdv = { id: advItem.itemId, code: advItem.itemCode };
  salvarEstado();

  // ── Liberação do lote de produto acabado, pela tela ────────────────────
  const antesLote = await lerLotesDoItem(S.dados.itemPa.id);
  const pendente = antesLote.find((l) => l.status === "AWAITING_RELEASE");
  if (pendente) {
    await abrir(`/estoque/lotes/${pendente.id}`, { espera: ".doc-title h1" });
    const situacaoAntes = await texto(".doc-title .badge");
    if (await existeBotao("Liberar")) {
      await clicarBotao("Liberar");
      await confirmarDialogo("Liberar");
      await page.waitForTimeout(1800);
    }
    const depoisLote = await lerLotesDoItem(S.dados.itemPa.id);
    const liberado = depoisLote.find((l) => l.id === pendente.id);
    registrarCaso("MASSA · liberação do lote de produto acabado", {
      pre: `${ITEM_PA_CODE}/${pendente.code} com ${pendente.onHand} un em ${situacaoAntes}, disponível ${pendente.available}`,
      acao: "Estoque › Lotes › Liberar, pela tela de Qualidade do lote",
      esperado: "status AVAILABLE e a quantidade passa a contar como disponível",
      real: `${liberado?.status} · disponível ${liberado?.available}`,
      invariante: "liberação não cria movimento de estoque — só muda elegibilidade",
      veredito: liberado?.status === "AVAILABLE" ? "PASS" : "FAIL",
    });
    check(
      `MASSA · ${pendente.code} foi liberado e ficou disponível`,
      liberado?.status === "AVAILABLE" && num(liberado.available) > 0,
      JSON.stringify(liberado),
    );
  }

  const lotes = await lerLotesDoItem(S.dados.itemPa.id);
  const disponivel = lotes.reduce((a, l) => a + num(l.available), 0);
  check(
    `MASSA · há produto acabado livre suficiente (${PEDIDO_A_QTD} + ${PEDIDO_B_QTD} un)`,
    disponivel >= PEDIDO_A_QTD + PEDIDO_B_QTD,
    `disponível=${disponivel}`,
  );
  S.dados.lotePa = lotes.find((l) => num(l.onHand) > 0) ?? null;
  numero("massa.disponivelInicialPa", disponivel);
  salvarEstado();

  // ── Precificação vindo do cálculo real, pela tela ──────────────────────
  const carteira = await apiGet(`/products/${S.dados.produto.id}/pricing`);
  if (carteira.current && (carteira.current.tiers ?? []).length >= FAIXAS.length) {
    anotar(`PRECIFICAÇÃO · ${carteira.current.label} já ativa com as faixas — cadastro pulado`);
    await conferirPrecificacaoVigente();
    return;
  }

  if (carteira.draft) {
    anotar(`PRECIFICAÇÃO · retomando o rascunho ${carteira.draft.label}`);
    await abrir(`/gestao/precificacao/${carteira.draft.id}`, { espera: ".doc-title h1" });
  } else {
    await abrir(`/produtos/${S.dados.produto.id}/custos`, { espera: ".doc-title h1" });
    if (!(await existeBotao("Criar precificação"))) {
      check("PRECIFICAÇÃO · a tela de custos oferece criar precificação", false, "botão ausente");
      return;
    }
    await clicarBotao("Criar precificação");
    const foi = await esperarUrl((u) => /^\/gestao\/precificacao\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
    if (!check("PRECIFICAÇÃO · nasce do cálculo de custo salvo, pela tela", foi, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
  }
  await page.waitForTimeout(1500);

  const faixasDoRascunho = async () =>
    ((await apiGet(`/products/${S.dados.produto.id}/pricing`)).draft?.tiers ?? []).map((t) => ({
      quantidade: t.quantity,
      preco: t.selectedUnitPrice,
    }));
  for (const faixa of FAIXAS) {
    if ((await faixasDoRascunho()).some((t) => num(t.quantidade) === faixa.quantidade)) {
      anotar(`PRECIFICAÇÃO · faixa de ${faixa.quantidade} un já estava na tabela`);
      continue;
    }
    await preencher("#tier-quantity", String(faixa.quantidade));
    await selecionar("#tier-mode", "MANUAL_PRICE");
    await page.waitForTimeout(250);
    await preencher("#tier-commission", COMISSAO);
    const separador = await preencherDecimal("#tier-price", faixa.preco);
    await clicarBotao("Adicionar faixa");
    await page.waitForTimeout(1600);
    const criada = (await faixasDoRascunho()).find((t) => num(t.quantidade) === faixa.quantidade);
    check(
      `PRECIFICAÇÃO · faixa de ${faixa.quantidade} un a R$ ${faixa.preco} cadastrada (separador: ${separador})`,
      Boolean(criada) && perto(criada.preco, faixa.preco, 0.000001),
      `${JSON.stringify(criada)} · ${JSON.stringify(await mensagensDeErro())}`,
    );
    if (!criada) return;
  }
  await shot("adv-billing-faixas-de-preco");

  if (await existeBotao("Ativar precificação")) {
    await clicarBotao("Ativar precificação");
    await page.waitForTimeout(700);
    if ((await page.locator(".confirm-dialog").count()) > 0) {
      const titulo = await confirmarDialogo("Ativar");
      anotar(`PRECIFICAÇÃO · ativação pediu confirmação: "${titulo}"`);
    }
    await page.waitForTimeout(2200);
  }
  const situacao = await texto(".doc-title .badge");
  check("PRECIFICAÇÃO · ficou Ativa", situacao === "Ativa", `${situacao} · ${JSON.stringify(await mensagensDeErro())}`);
  await conferirPrecificacaoVigente();
}

/** A conferência da vigente vale tanto na criação quanto na retomada. */
async function conferirPrecificacaoVigente() {
  const vigente = await apiGet(`/products/${S.dados.produto.id}/active-pricing`);
  const vigenteFaixas = (vigente?.tiers ?? []).map((t) => `${t.quantity}=${t.selectedUnitPrice}`);
  check(
    "PRECIFICAÇÃO · a vigente do produto tem as cinco faixas, com as três reais da planilha",
    FAIXAS.every((f) => vigenteFaixas.some((t) => num(t.split("=")[0]) === f.quantidade)),
    JSON.stringify(vigenteFaixas),
  );
  numero("precificacao.v1.faixas", vigenteFaixas);
  S.dados.precificacao = { id: vigente?.id, code: vigente?.code, label: vigente?.label, faixas: vigenteFaixas };
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// Projeto → Orçamento → Pedido com PREÇO ACORDADO (helpers)
// ══════════════════════════════════════════════════════════════════════════
/**
 * Preço acordado NÃO nasce no formulário de Pedido: `createCustomerOrderSchema`
 * só aceita produto e quantidade. `agreedUnitPrice` vem de `quote-to-order`.
 * Por isso todo pedido com preço desta onda passa por Projeto → Orçamento.
 */
async function criarProjeto(chave, nome) {
  S.dados.projetos = S.dados.projetos ?? {};
  if (S.dados.projetos[chave]) return S.dados.projetos[chave];

  await abrir("/comercial/projetos");
  await clicarBotao("Novo projeto");
  await page.waitForSelector("#project-name", { timeout: 25000 });
  await escolherEntidade("#project-customer", S.dados.produto.customerCode, S.dados.produto.customerCode);
  await preencher("#project-name", nome);
  await preencher("#project-concept", "Validacao adversarial");
  await preencher("#project-channel", "Distribuidora");
  await selecionar("#project-dosage-form", "CAPSULE");
  await selecionar("#project-presentation", "POT");
  await preencher("#project-doses", "60");
  await selecionar("#project-age-group", "ADULT");
  await preencher("#project-minimum-batch", "100");
  await preencher("#project-shelf-life", "24");
  await clicarBotao("Criar projeto");
  const foi = await esperarUrl((u) => /^\/comercial\/projetos\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check(`PROJETO ${chave} · criado pela tela`, foi, `${caminho()} · ${JSON.stringify(await mensagensDeErro())}`)) {
    return null;
  }
  await page.waitForTimeout(900);
  const registro = { chave, url: caminho(), id: idDaUrl(caminho()), code: (await texto(".doc-title h1")).split(" ")[0] };
  S.dados.projetos[chave] = registro;
  salvarEstado();
  return registro;
}

/** Vincula o produto EXISTENTE (com estoque e cálculo de custo) ao projeto. */
async function vincularProduto(projeto) {
  await abrir(projeto.url, { espera: ".doc-title h1" });
  const jaVinculado = (await apiGet(`/projects/${projeto.id}`)).products ?? [];
  if (jaVinculado.some((p) => p.productCode === S.dados.produto.code)) return true;

  if (await existeBotao("+ Adicionar produto")) await clicarBotao("+ Adicionar produto");
  await clicarBotao("Vincular produto existente");
  await page.waitForTimeout(500);
  await escolherEntidade("#link-product", S.dados.produto.code, S.dados.produto.code);
  await clicarBotao("Vincular produto");
  await page.waitForTimeout(2200);
  const depois = (await apiGet(`/projects/${projeto.id}`)).products ?? [];
  return check(
    `PROJETO ${projeto.chave} · o produto existente ${S.dados.produto.code} foi vinculado`,
    depois.some((p) => p.productCode === S.dados.produto.code),
    JSON.stringify(depois.map((p) => p.productCode)),
  );
}

/**
 * Orçamento com preço vindo da FAIXA — proveniência, não digitação. A
 * quantidade da linha tem de bater com a faixa: a tela avisa que o sistema
 * não interpola preço.
 */
async function criarOrcamento(projeto, quantidade) {
  await abrir(projeto.url, { espera: ".doc-title h1" });
  if (await existeBotao("Criar nova versão")) await clicarBotao("Criar nova versão");
  else if (await existeBotao("Abrir rascunho")) await clicarBotao("Abrir rascunho");
  await page.waitForTimeout(2200);

  const rotulo = await texto(".quote-workspace__head .code");
  check(`ORÇAMENTO ${projeto.chave} · nasce em rascunho com código ORC`, /^ORC-\d+ · V\d+$/.test(rotulo), rotulo);

  if ((await page.locator("#quote-add-product").count()) > 0) {
    const opcoes = await page.evaluate(() =>
      [...document.querySelectorAll("#quote-add-product option")].map((o) => ({
        value: o.value,
        label: (o.textContent ?? "").trim(),
      })),
    );
    const alvo = opcoes.find((o) => o.label.includes(S.dados.produto.code));
    if (alvo) {
      await selecionar("#quote-add-product", alvo.value);
      await clicarBotao("Adicionar");
      await page.waitForTimeout(1800);
    }
  }

  await page.getByLabel(`Quantidade de ${S.dados.produto.code}`).first().fill(String(quantidade));
  await page.locator("#quote-valid-until").click();
  await page.waitForTimeout(1800);

  await clicarBotao("Usar precificação");
  await page.waitForTimeout(1600);
  const faixas = await textos("ul.plain-list li");
  check(
    `ORÇAMENTO ${projeto.chave} · o painel oferece as faixas da precificação ATIVA`,
    faixas.some((f) => f.replace(/\./g, "").includes(String(quantidade))),
    JSON.stringify(faixas),
  );
  const faixaAlvo = page
    .locator("ul.plain-list li")
    .filter({ hasText: new RegExp(`(^|\\D)${quantidade}(\\D|$)`) })
    .first();
  await faixaAlvo.getByRole("button", { name: "Usar esta faixa", exact: true }).click();
  await page.waitForTimeout(2200);

  const linha = (await textos("table.table--quote-lines tbody tr"))[0] ?? "";
  anotar(`ORÇAMENTO ${projeto.chave} · linha após aplicar a faixa: "${linha.slice(0, 160)}"`);

  await preencher("#quote-valid-until", daquiDias(30));
  await preencher("#quote-lead-time", "30");
  await selecionar("#quote-payment-method", "CASH");
  await clicarBotao("Salvar condições");
  await page.waitForTimeout(1600);

  await clicarBotao("Enviar ao cliente");
  const rotuloEnvio =
    (await page.locator('.confirm-dialog button:has-text("Enviar mesmo assim")').count()) > 0
      ? "Enviar mesmo assim"
      : "Enviar ao cliente";
  await confirmarDialogo(rotuloEnvio);
  await page.waitForTimeout(2500);
  check(
    `ORÇAMENTO ${projeto.chave} · enviado ao cliente`,
    (await texto(".quote-workspace__head .badge")) === "Enviado",
    `${await texto(".quote-workspace__head .badge")} · ${JSON.stringify(await mensagensDeErro())}`,
  );

  if (await existeBotao("Registrar aceite")) {
    await clicarBotao("Registrar aceite");
    await page.waitForTimeout(2500);
  }
  return check(
    `ORÇAMENTO ${projeto.chave} · aceito`,
    (await texto(".quote-workspace__head .badge")) === "Aceito",
    `${await texto(".quote-workspace__head .badge")} · ${JSON.stringify(await mensagensDeErro())}`,
  );
}

async function aprovarProjetoEGerarPedido(projeto, chave) {
  S.dados.pedidos = S.dados.pedidos ?? {};
  if (S.dados.pedidos[chave]) return S.dados.pedidos[chave];

  await abrir(projeto.url, { espera: ".doc-title h1" });
  if (await existeBotao("Aprovar projeto")) {
    await clicarBotao("Aprovar projeto");
    await confirmarDialogo("Aprovar");
    await page.waitForTimeout(3000);
  }
  check(
    `PROJETO ${projeto.chave} · aprovado`,
    (await texto(".doc-title .badge")) === "Aprovado",
    await texto(".doc-title .badge"),
  );

  await clicarBotao("Gerar pedido a partir do orçamento aceito");
  const foi = await esperarUrl((u) => /^\/comercial\/pedidos\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check(`PEDIDO ${chave} · nasce do orçamento aceito`, foi, `${caminho()} · ${JSON.stringify(await mensagensDeErro())}`)) {
    return null;
  }
  await page.waitForTimeout(1500);
  const registro = { chave, url: caminho(), id: idDaUrl(caminho()), code: await texto(".doc-title h1") };
  S.dados.pedidos[chave] = registro;
  salvarEstado();

  if (await existeBotao("Confirmar pedido")) {
    await clicarBotao("Confirmar pedido");
    await confirmarDialogo("Confirmar");
    await page.waitForTimeout(2500);
  }
  return registro;
}

/** Aplica o Plano de Atendimento — o pedido só fica expedível depois disso. */
async function aplicarPlano(pedido) {
  await abrir(pedido.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(2500);
  if (await existeBotao("Aplicar Plano de Atendimento")) {
    await clicarBotao("Aplicar Plano de Atendimento");
    await confirmarDialogo("Aplicar Plano");
    await page.waitForTimeout(3200);
  }
  const ped = await lerPedido(pedido.id);
  return ped;
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 2 · Pedido A (100 un) com preço acordado de centavo quebrado
// ══════════════════════════════════════════════════════════════════════════
async function marco02PedidoA() {
  const projeto = await criarProjeto("A", `${P} Expedicao parcial`);
  if (!projeto) return;
  if (!(await vincularProduto(projeto))) return;
  if (!(await criarOrcamento(projeto, PEDIDO_A_QTD))) return;
  const pedido = await aprovarProjetoEGerarPedido(projeto, "A");
  if (!pedido) return;

  const ped = await lerPedido(pedido.id);
  const linha = ped.lines[0];
  const preco = linha.agreedPrice;
  check(
    `PEDIDO A · nasceu com preço acordado vindo da FAIXA (${PECAS(preco)})`,
    preco !== null && preco.source === "PRICING_TIER",
    JSON.stringify(preco),
  );
  check(
    `PEDIDO A · o preço acordado é exatamente R$ ${PRECO_QUEBRADO} (quatro casas preservadas no pedido)`,
    perto(preco?.unitPrice, PRECO_QUEBRADO, 1e-9),
    `${preco?.unitPrice}`,
  );
  numero("pedidoA.precoAcordadoApi", preco?.unitPrice ?? null);
  numero("pedidoA.totalLinhaApi", preco?.lineTotal ?? null);
  numero("pedidoA.faixaOrigem", `${preco?.pricingCode} v${preco?.pricingVersionNumber} faixa ${preco?.tierQuantity}`);

  await abrir(pedido.url, { espera: ".doc-title h1" });
  const cabecalhos = await textos("table thead th");
  const precoNaTela = await page.evaluate(() => {
    const tabela = document.querySelector("section.form-section table");
    if (!tabela) return null;
    const idx = [...tabela.querySelectorAll("thead th")].findIndex((th) =>
      (th.textContent ?? "").trim().startsWith("Preço acordado"),
    );
    if (idx < 0) return null;
    const linha = tabela.querySelector("tbody tr");
    return (linha?.querySelectorAll("td")[idx]?.textContent ?? "").replace(/\s+/g, " ").trim();
  });
  anotar(`PEDIDO A · colunas na tela: ${JSON.stringify(cabecalhos.slice(0, 12))}`);
  numero("pedidoA.precoAcordadoNaTela", precoNaTela);
  check(
    "PEDIDO A · a tela do pedido mostra o preço acordado com a origem da faixa",
    Boolean(precoNaTela) && /R\$/.test(precoNaTela ?? ""),
    String(precoNaTela),
  );
  await shot("adv-billing-pedido-preco-acordado");

  const depois = await aplicarPlano(pedido);
  check("PEDIDO A · ficou Em atendimento após aplicar o plano", depois.status === "IN_FULFILLMENT", depois.status);
  const reserva = depois.reservation?.lines ?? [];
  check(
    `PEDIDO A · o plano reservou as ${PEDIDO_A_QTD} un do estoque livre (nada a produzir)`,
    reserva.reduce((a, l) => a + num(l.quantity), 0) === PEDIDO_A_QTD,
    JSON.stringify(reserva.map((l) => `${l.lotCode}:${l.quantity}`)),
  );
  check(
    "PEDIDO A · nenhuma OP foi criada — havia estoque",
    (depois.generatedProductionOrders ?? []).length === 0,
    JSON.stringify((depois.generatedProductionOrders ?? []).map((o) => o.code)),
  );
  salvarEstado();
}

const PECAS = (p) => (p ? `${p.unitPrice} · ${p.source}` : "sem preço");

// ══════════════════════════════════════════════════════════════════════════
// Expedição — helpers
// ══════════════════════════════════════════════════════════════════════════
async function prepararExpedicao(pedido, chave) {
  S.dados.expedicoes = S.dados.expedicoes ?? {};
  if (S.dados.expedicoes[chave]) {
    await abrir(S.dados.expedicoes[chave].url, { espera: ".doc-title h1" });
    return S.dados.expedicoes[chave];
  }
  await abrir(pedido.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(1200);
  await clicarBotao("Preparar Expedição");
  const foi = await esperarUrl((u) => /^\/comercial\/expedicoes\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check(`EXPEDIÇÃO ${chave} · nasce do Pedido, com a reserva já feita`, foi, `${caminho()} · ${JSON.stringify(await mensagensDeErro())}`)) {
    return null;
  }
  await page.waitForTimeout(1500);
  const registro = { chave, url: caminho(), id: idDaUrl(caminho()), code: await texto(".doc-title h1") };
  S.dados.expedicoes[chave] = registro;
  salvarEstado();
  return registro;
}

/** Lê a linha de separação: lote, reservado disponível e o campo de quantidade. */
async function linhasDeExpedicao() {
  return page.evaluate(() =>
    [...document.querySelectorAll("div.shipment-product table tbody tr")].map((tr) => ({
      texto: (tr.textContent ?? "").replace(/\s+/g, " ").trim(),
      lote: ((tr.textContent ?? "").match(/LT-\d{8}-\d{6}/) ?? [])[0] ?? null,
      valorQuantidade: tr.querySelector('input[aria-label^="Quantidade do lote"]')?.value ?? null,
    })),
  );
}

async function definirQuantidade(lote, quantidade) {
  const campo = page.getByLabel(`Quantidade do lote ${lote}`).first();
  await campo.fill(String(quantidade));
  await page.waitForTimeout(400);
}

async function conferirLotes() {
  const linhas = page.locator("div.shipment-product table tbody tr");
  const n = await linhas.count();
  for (let i = 0; i < n; i += 1) {
    const linha = linhas.nth(i);
    const conteudo = ((await linha.textContent()) ?? "").replace(/\s+/g, " ");
    if (conteudo.includes("Conferido")) continue;
    const lote = (conteudo.match(/LT-\d{8}-\d{6}/) ?? [])[0];
    if (!lote) continue;
    const campo = linha.getByLabel(`Lote conferido da linha ${lote}`);
    if ((await campo.count()) === 0) continue;
    await campo.fill(lote);
    await linha.getByRole("button", { name: "Conferir lote", exact: true }).click();
    await page.waitForTimeout(2000);
  }
}

/** Lê o parágrafo achatado com os saldos do produto na tela da expedição. */
async function metaDoProduto() {
  const t = await texto("p.shipment-product__meta");
  const ler = (rotulo) => {
    const m = t.match(new RegExp(`${rotulo}:\\s*([\\d.,]+)`));
    return m ? m[1] : null;
  };
  return {
    bruto: t,
    pedido: ler("Pedido"),
    jaExpedido: ler("Já expedido"),
    faltaExpedir: ler("Falta expedir"),
    reservadoDisponivel: ler("Reservado disponível"),
    expedindoAgora: ler("Expedindo agora"),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 3 · Expedição parcial de 40 — o saldo tem de ficar 60
// ══════════════════════════════════════════════════════════════════════════
async function marco03ExpedicaoParcial() {
  const pedido = S.dados.pedidos.A;
  const exp = await prepararExpedicao(pedido, "A1");
  if (!exp) return;

  const prefill = await linhasDeExpedicao();
  check(
    `EXPEDIÇÃO A1 · o rascunho nasce pré-preenchido com o reservado (${PEDIDO_A_QTD} un)`,
    prefill.length === 1 && num(prefill[0].valorQuantidade) === PEDIDO_A_QTD,
    JSON.stringify(prefill),
  );
  const lote = prefill[0]?.lote;
  if (!check("EXPEDIÇÃO A1 · a linha aponta para um lote real", Boolean(lote), JSON.stringify(prefill))) return;
  S.dados.loteExpedido = lote;

  const antes = await fotografar("antes da expedição de 40");
  await definirQuantidade(lote, EXPEDIR_1);
  await clicarBotao("Salvar separação");
  await page.waitForTimeout(2200);
  const meioCaminho = await fotografar("rascunho salvo com 40");
  check(
    "EXPEDIÇÃO A1 · salvar a separação NÃO mexe em estoque nem em reserva (rascunho é plano)",
    JSON.stringify(antes.itens) === JSON.stringify(meioCaminho.itens),
    diffFoto(antes, meioCaminho),
  );

  await conferirLotes();
  await shot("adv-shipment-partial-conferencia");
  const metaAntes = await metaDoProduto();
  anotar(`EXPEDIÇÃO A1 · antes de confirmar: ${metaAntes.bruto}`);

  await clicarBotao("Confirmar expedição");
  const titulo = await confirmarDialogo("Confirmar");
  await page.waitForTimeout(3500);
  const situacao = await texto(".doc-title .badge");
  check("EXPEDIÇÃO A1 · confirmada", situacao === "Confirmada", `${situacao} · ${JSON.stringify(await mensagensDeErro())}`);
  anotar(`EXPEDIÇÃO A1 · diálogo de confirmação: "${titulo}"`);
  await shot("adv-shipment-partial");

  const depois = await fotografar("depois da expedição de 40");
  const expedicao = await lerExpedicao(exp.id);
  const ped = await lerPedido(pedido.id);
  const linha = ped.lines[0];

  registrarCaso("EXPEDIÇÃO PARCIAL · 40 de 100", {
    pre: `${pedido.code} com ${PEDIDO_A_QTD} un pedidas, ${PEDIDO_A_QTD} reservadas no lote ${lote}, 0 expedidas`,
    acao: `separar ${EXPEDIR_1} un, conferir o lote e confirmar a expedição`,
    esperado: `expedido ${EXPEDIR_1}, falta expedir ${EXPEDIR_2}, pedido Parcialmente expedido, 1 movimento SHIPMENT_OUT de ${EXPEDIR_1}`,
    real: `expedido ${linha.shippedQuantity}, falta ${linha.outstandingQuantity}, pedido ${ped.status}, total da expedição ${expedicao.totalQuantity}`,
    invariante: "saída física = exatamente o confirmado; reserva restante = pedido − expedido",
    veredito:
      num(linha.shippedQuantity) === EXPEDIR_1 &&
      num(linha.outstandingQuantity) === EXPEDIR_2 &&
      ped.status === "PARTIALLY_SHIPPED"
        ? "PASS"
        : "FAIL",
  });
  check(`EXPEDIÇÃO A1 · expedido = ${EXPEDIR_1}`, num(linha.shippedQuantity) === EXPEDIR_1, linha.shippedQuantity);
  check(`EXPEDIÇÃO A1 · saldo a expedir = ${EXPEDIR_2}`, num(linha.outstandingQuantity) === EXPEDIR_2, linha.outstandingQuantity);
  check("EXPEDIÇÃO A1 · pedido ficou Parcialmente expedido", ped.status === "PARTIALLY_SHIPPED", ped.status);
  const remanescente = (ped.reservation?.lines ?? []).reduce((a, l) => a + num(l.reservedRemaining), 0);
  check(`EXPEDIÇÃO A1 · reserva remanescente = ${EXPEDIR_2}`, remanescente === EXPEDIR_2, String(remanescente));

  const movimentos = await lerMovimentos(S.dados.itemPa.id);
  const saidas = movimentos.filter((m) => m.type === "SHIPMENT_OUT" && m.lotCode === lote);
  check(
    "EXPEDIÇÃO A1 · exatamente um movimento de saída, do tamanho do que foi expedido",
    saidas.length === 1 && num(saidas[0].quantity) === EXPEDIR_1,
    JSON.stringify(saidas),
  );
  numero("expedicaoA1.diff", diffFoto(antes, depois));

  await abrir(pedido.url, { espera: ".doc-title h1" });
  const faltaNaTela = await page.evaluate(() => {
    const tabela = document.querySelector("section.form-section table");
    if (!tabela) return null;
    const idx = [...tabela.querySelectorAll("thead th")].findIndex((th) =>
      (th.textContent ?? "").trim().startsWith("Falta expedir"),
    );
    if (idx < 0) return null;
    return (tabela.querySelector("tbody tr")?.querySelectorAll("td")[idx]?.textContent ?? "").trim();
  });
  check(
    `EXPEDIÇÃO A1 · a TELA do pedido mostra "Falta expedir" = ${EXPEDIR_2}`,
    num(faltaNaTela) === EXPEDIR_2,
    String(faltaNaTela),
  );
  numero("expedicaoA1.faltaExpedirNaTela", faltaNaTela);
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 4 · Caminhos proibidos da Expedição
// ══════════════════════════════════════════════════════════════════════════
async function marco04NegativosExpedicao() {
  const pedido = S.dados.pedidos.A;
  const lote = S.dados.loteExpedido;

  // ── 4.1 · Expedir 61 quando o saldo é 60 ───────────────────────────────
  await abrir(pedido.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(1200);
  const exp2 = await prepararExpedicao(pedido, "A2");
  if (!exp2) return;

  await caminhoProibido(
    `EXPEDIR ACIMA DO SALDO · ${EXPEDIR_2 + 1} un com apenas ${EXPEDIR_2} a expedir`,
    {
      pre: `${pedido.code} com ${EXPEDIR_2} un a expedir e ${EXPEDIR_2} un de reserva remanescente`,
      acao: `digitar ${EXPEDIR_2 + 1} na separação, conferir o lote e tentar confirmar`,
      esperado: "a tela recusa; nenhuma saída, nenhum movimento, expedição segue em rascunho",
      invariante: "expedido nunca ultrapassa o pedido nem o reservado",
    },
    async () => {
      await definirQuantidade(lote, EXPEDIR_2 + 1);
      await page.waitForTimeout(600);
      const avisos = await mensagensDeErro();
      const botao = page.getByRole("button", { name: "Confirmar expedição", exact: true });
      const desabilitado = (await botao.count()) > 0 ? await botao.first().isDisabled() : false;
      const dica = (await botao.count()) > 0 ? await botao.first().getAttribute("title") : null;
      // Se a tela deixar clicar, o servidor tem de recusar — a prova é a foto.
      if (!desabilitado && (await botao.count()) > 0) {
        await botao.first().click();
        await page.waitForTimeout(600);
        if ((await page.locator(".confirm-dialog").count()) > 0) {
          await confirmarDialogo("Confirmar");
          await page.waitForTimeout(2500);
        }
      }
      await clicarBotao("Salvar separação").catch(() => {});
      await page.waitForTimeout(2000);
      return `botão ${desabilitado ? "desabilitado" : "habilitado"} · title="${dica}" · avisos=${JSON.stringify(
        [...avisos, ...(await mensagensDeErro())].slice(0, 4),
      )}`;
    },
  );
  await shot("adv-negative-path-acima-do-saldo");

  // Repõe a quantidade legítima antes de seguir.
  await abrir(exp2.url, { espera: ".doc-title h1" });
  await definirQuantidade(lote, EXPEDIR_2);
  await clicarBotao("Salvar separação");
  await page.waitForTimeout(2000);

  // ── 4.2 · Conferir com lote de OUTRO PRODUTO ───────────────────────────
  await caminhoProibido(
    `LOTE DE OUTRO PRODUTO · conferir ${LOTE_OUTRO_PRODUTO} numa linha de ${ITEM_PA_CODE}`,
    {
      pre: `expedição em rascunho com a linha do lote ${lote} (${ITEM_PA_CODE})`,
      acao: `informar na conferência o lote ${LOTE_OUTRO_PRODUTO}, que é de PA-000365 (outro produto, outro cliente)`,
      esperado: "conferência recusada; a linha continua não conferida e nada sai",
      invariante: "conferência física só aceita o lote reservado àquela linha",
    },
    async () => {
      const linha = page.locator("div.shipment-product table tbody tr").first();
      const campo = linha.getByLabel(`Lote conferido da linha ${lote}`);
      if ((await campo.count()) === 0) return "linha já conferida — campo ausente";
      await campo.fill(LOTE_OUTRO_PRODUTO);
      await linha.getByRole("button", { name: "Conferir lote", exact: true }).click();
      await page.waitForTimeout(2200);
      return JSON.stringify((await mensagensDeErro()).slice(0, 3));
    },
  );

  // ── 4.3 · Conferir com lote BLOQUEADO ──────────────────────────────────
  await caminhoProibido(
    `LOTE BLOQUEADO · conferir ${LOTE_BLOQUEADO_MP} numa linha de expedição`,
    {
      pre: `${LOTE_BLOQUEADO_MP} é um lote BLOQUEADO de MP-000327 com 49 kg`,
      acao: "informar esse lote na conferência da linha de produto acabado",
      esperado: "conferência recusada — nem o produto confere, nem o lote é elegível",
      invariante: "lote bloqueado nunca entra em documento de saída",
    },
    async () => {
      const linha = page.locator("div.shipment-product table tbody tr").first();
      const campo = linha.getByLabel(`Lote conferido da linha ${lote}`);
      if ((await campo.count()) === 0) return "linha já conferida — campo ausente";
      await campo.fill(LOTE_BLOQUEADO_MP);
      await linha.getByRole("button", { name: "Conferir lote", exact: true }).click();
      await page.waitForTimeout(2200);
      return JSON.stringify((await mensagensDeErro()).slice(0, 3));
    },
  );
  await shot("adv-negative-path-lote-errado");

  // ── 4.4 · Cancelar a expedição em RASCUNHO (estágio permitido) ─────────
  const antesCancelar = await fotografar("antes de cancelar o rascunho");
  await abrir(exp2.url, { espera: ".doc-title h1" });
  await clicarBotao("Cancelar expedição");
  await page.waitForTimeout(600);
  await preencher("#shipment-cancel-reason", "Validacao adversarial: cancelamento em estagio permitido");
  await page.locator(".confirm-dialog").getByRole("button", { name: "Cancelar expedição", exact: true }).click();
  await page.waitForTimeout(3000);
  const cancelada = await lerExpedicao(exp2.id);
  const depoisCancelar = await fotografar("depois de cancelar o rascunho");
  const pedidoPos = await lerPedido(pedido.id);
  registrarCaso("CANCELAMENTO DE EXPEDIÇÃO · em rascunho (permitido)", {
    pre: `${exp2.code} em Rascunho com ${EXPEDIR_2} un separadas; pedido ${pedido.code} Parcialmente expedido`,
    acao: "Cancelar expedição, com motivo, pela tela",
    esperado: "expedição Cancelada; estoque, reserva e saldo do pedido intactos",
    real: `${cancelada.status} · pedido ${pedidoPos.status} · falta expedir ${pedidoPos.lines[0].outstandingQuantity}`,
    invariante: "rascunho nunca foi realidade física — cancelar não reverte nada porque nada aconteceu",
    veredito:
      cancelada.status === "CANCELLED" &&
      JSON.stringify(antesCancelar.itens) === JSON.stringify(depoisCancelar.itens) &&
      num(pedidoPos.lines[0].outstandingQuantity) === EXPEDIR_2
        ? "PASS"
        : "FAIL",
  });
  check(
    "CANCELAMENTO · o rascunho foi cancelado sem tocar em estoque, reserva ou saldo",
    cancelada.status === "CANCELLED" &&
      JSON.stringify(antesCancelar.itens) === JSON.stringify(depoisCancelar.itens) &&
      num(pedidoPos.lines[0].outstandingQuantity) === EXPEDIR_2,
    `${cancelada.status} · ${diffFoto(antesCancelar, depoisCancelar)}`,
  );

  // ── 4.5 · Cancelar a expedição JÁ CONFIRMADA (proibido) ────────────────
  const exp1 = S.dados.expedicoes.A1;
  await caminhoProibido(
    `CANCELAR EXPEDIÇÃO CONFIRMADA · ${exp1.code}`,
    {
      pre: `${exp1.code} CONFIRMADA, com ${EXPEDIR_1} un já fora do estoque`,
      acao: "abrir a expedição confirmada e procurar/acionar o cancelamento",
      esperado: "a ação não existe na tela e o servidor recusa — saída física não se desfaz por cancelamento",
      invariante: "expedição confirmada é histórico imutável",
    },
    async () => {
      await abrir(exp1.url, { espera: ".doc-title h1" });
      const tem = await existeBotao("Cancelar expedição");
      if (!tem) return "a tela não oferece cancelar expedição confirmada (ação ausente por status)";
      await clicarBotao("Cancelar expedição");
      await preencher("#shipment-cancel-reason", "tentativa adversarial");
      await page.locator(".confirm-dialog").getByRole("button", { name: "Cancelar expedição", exact: true }).click();
      await page.waitForTimeout(2500);
      return JSON.stringify((await mensagensDeErro()).slice(0, 3));
    },
  );

  // ── 4.6 · Reenviar a MESMA confirmação (aba velha) ─────────────────────
  const exp3 = await prepararExpedicao(pedido, "A3");
  if (!exp3) return;
  await definirQuantidade(lote, EXPEDIR_2);
  await clicarBotao("Salvar separação");
  await page.waitForTimeout(2000);
  await conferirLotes();
  await page.waitForTimeout(800);

  const abaVelha = await novaAba();
  await comAba(abaVelha, async () => {
    await abrir(exp3.url, { espera: ".doc-title h1" });
    await page.waitForTimeout(1500);
  });

  await clicarBotao("Confirmar expedição");
  await confirmarDialogo("Confirmar");
  await page.waitForTimeout(3500);
  const confirmada = await lerExpedicao(exp3.id);
  check(`EXPEDIÇÃO A3 · confirmada (saldo de ${EXPEDIR_2})`, confirmada.status === "CONFIRMED", confirmada.status);

  await comAba(abaVelha, async () => {
    await caminhoProibido(
      "REENVIO DA MESMA CONFIRMAÇÃO · aba velha confirma de novo",
      {
        pre: `${exp3.code} já CONFIRMADA em outra aba; a aba velha ainda mostra o rascunho`,
        acao: "clicar Confirmar expedição na aba desatualizada",
        esperado: "recusa; nenhum segundo SHIPMENT_OUT, nenhuma dupla baixa",
        invariante: "uma expedição gera exatamente um conjunto de movimentos, uma única vez",
      },
      async () => {
        if (!(await existeBotao("Confirmar expedição"))) return "botão ausente na aba velha";
        await clicarBotao("Confirmar expedição");
        if ((await page.locator(".confirm-dialog").count()) > 0) await confirmarDialogo("Confirmar");
        await page.waitForTimeout(3000);
        return JSON.stringify((await mensagensDeErro()).slice(0, 3));
      },
    );
  });
  await abaVelha.close();

  const movimentos = await lerMovimentos(S.dados.itemPa.id);
  const saidas = movimentos.filter((m) => m.type === "SHIPMENT_OUT");
  check(
    "REENVIO · o item tem exatamente duas saídas (40 e 60), nunca três",
    saidas.length === 2 && saidas.reduce((a, m) => a + num(m.quantity), 0) === PEDIDO_A_QTD,
    JSON.stringify(saidas.map((m) => `${m.lotCode}:${m.quantity}`)),
  );

  const ped = await lerPedido(pedido.id);
  check("PEDIDO A · totalmente expedido depois da segunda saída", ped.status === "SHIPPED", ped.status);
  check(
    "PEDIDO A · saldo a expedir zerado",
    num(ped.lines[0].outstandingQuantity) === 0,
    ped.lines[0].outstandingQuantity,
  );
  check(
    "PEDIDO A · a reserva foi liberada ao completar a expedição (nenhum compromisso órfão)",
    (ped.reservation?.status ?? "RELEASED") !== "ACTIVE" ||
      (ped.reservation?.lines ?? []).every((l) => num(l.reservedRemaining) === 0),
    JSON.stringify({ status: ped.reservation?.status, linhas: (ped.reservation?.lines ?? []).map((l) => l.reservedRemaining) }),
  );
  await abrir(pedido.url, { espera: ".doc-title h1" });
  await shot("adv-shipment-partial-completo");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// Faturamento — helpers
// ══════════════════════════════════════════════════════════════════════════
async function prepararFaturamento(expedicao, chave) {
  S.dados.faturamentos = S.dados.faturamentos ?? {};
  if (S.dados.faturamentos[chave]) {
    await abrir(S.dados.faturamentos[chave].url, { espera: ".doc-title h1" });
    return S.dados.faturamentos[chave];
  }
  await abrir(expedicao.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(1000);
  await clicarBotao("Preparar faturamento");
  const foi = await esperarUrl((u) => /^\/comercial\/faturamento\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check(`FATURAMENTO ${chave} · nasce da expedição confirmada`, foi, `${caminho()} · ${JSON.stringify(await mensagensDeErro())}`)) {
    return null;
  }
  await page.waitForTimeout(1500);
  const registro = { chave, url: caminho(), id: idDaUrl(caminho()), code: await texto(".doc-title h1") };
  S.dados.faturamentos[chave] = registro;
  salvarEstado();
  return registro;
}

/** Lê a tabela "Itens faturados" e o rodapé do documento como estão na tela. */
async function lerDocumentoDeFaturamento() {
  return page.evaluate(() => {
    const secao = [...document.querySelectorAll("section.form-section")].find((s) =>
      (s.querySelector("h3")?.textContent ?? "").includes("Itens faturados"),
    );
    if (!secao) return null;
    const tabela = secao.querySelector("table");
    const colunas = [...(tabela?.querySelectorAll("thead th") ?? [])].map((th) =>
      (th.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    const linhas = [...(tabela?.querySelectorAll("tbody tr") ?? [])].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    const rodape = (secao.querySelector(".table-container > .table-foot")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return { colunas, linhas, rodape };
  });
}

const soNumero = (t) => Number(String(t ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));

async function emitirFaturamento(fat) {
  await abrir(fat.url, { espera: ".doc-title h1" });
  if (await existeBotao("Emitir faturamento")) {
    await clicarBotao("Emitir faturamento");
    const titulo = await confirmarDialogo("Emitir");
    await page.waitForTimeout(3000);
    return titulo;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 5 · Faturamento das 40 expedidas — quantidade, preço e total
// ══════════════════════════════════════════════════════════════════════════
async function marco05FaturamentoParcial() {
  const exp1 = S.dados.expedicoes.A1;
  const fat = await prepararFaturamento(exp1, "F1");
  if (!fat) return;

  const doc = await lerDocumentoDeFaturamento();
  anotar(`FATURAMENTO F1 · colunas: ${JSON.stringify(doc?.colunas)}`);
  anotar(`FATURAMENTO F1 · linha na tela: ${JSON.stringify(doc?.linhas?.[0])}`);
  anotar(`FATURAMENTO F1 · rodapé: "${doc?.rodape}"`);

  const api = await lerFaturamento(fat.id);
  const linha = api.lines[0];

  check(
    `FATURAMENTO F1 · quantidade = ${EXPEDIR_1}, exatamente o expedido (nunca o pedido)`,
    num(linha.quantity) === EXPEDIR_1,
    linha.quantity,
  );
  check(
    `FATURAMENTO F1 · preço acordado congelado do pedido (R$ ${PRECO_QUEBRADO})`,
    perto(linha.agreedUnitPrice, Number(PRECO_QUEBRADO).toFixed(2), 1e-9) ||
      perto(linha.agreedUnitPrice, PRECO_QUEBRADO, 1e-9),
    String(linha.agreedUnitPrice),
  );
  const totalEsperado = dinheiro(EXPEDIR_1 * Number(PRECO_QUEBRADO));
  check(
    `FATURAMENTO F1 · total da linha = ${EXPEDIR_1} × ${PRECO_QUEBRADO} = ${totalEsperado.toFixed(2)}`,
    perto(linha.lineTotal, totalEsperado, 0.0001),
    `${linha.lineTotal}`,
  );
  check(
    "FATURAMENTO F1 · total do documento = soma das linhas",
    perto(api.totalAmount, totalEsperado, 0.0001),
    `${api.totalAmount}`,
  );
  numero("faturamentoF1", {
    quantidade: linha.quantity,
    precoAcordadoApi: linha.agreedUnitPrice,
    precoFaturadoApi: linha.unitPrice,
    totalLinhaApi: linha.lineTotal,
    totalDocumentoApi: api.totalAmount,
    linhaNaTela: doc?.linhas?.[0],
    rodapeNaTela: doc?.rodape,
  });

  registrarCaso("FATURAMENTO PARCIAL · as 40 expedidas", {
    pre: `${exp1.code} CONFIRMADA com ${EXPEDIR_1} un; pedido com preço acordado R$ ${PRECO_QUEBRADO}`,
    acao: "Preparar faturamento a partir da expedição e emitir",
    esperado: `quantidade ${EXPEDIR_1}, preço ${PRECO_QUEBRADO}, total ${totalEsperado.toFixed(2)}`,
    real: `quantidade ${linha.quantity}, preço ${linha.unitPrice}, total ${linha.lineTotal}, documento ${api.totalAmount}`,
    invariante: "faturamento espelha a expedição — quantidade nunca editável, preço vem do pedido",
    veredito:
      num(linha.quantity) === EXPEDIR_1 && perto(linha.lineTotal, totalEsperado, 0.0001) ? "PASS" : "FAIL",
  });

  const titulo = await emitirFaturamento(fat);
  anotar(`FATURAMENTO F1 · diálogo de emissão: "${titulo}"`);
  const emitido = await lerFaturamento(fat.id);
  check("FATURAMENTO F1 · emitido", emitido.status === "ISSUED", emitido.status);
  await shot("adv-billing-partial");

  const ped = await lerPedido(S.dados.pedidos.A.id);
  check(
    `FATURAMENTO F1 · o pedido passou a mostrar ${EXPEDIR_1} un faturadas`,
    num(ped.lines[0].billedQuantity) === EXPEDIR_1,
    ped.lines[0].billedQuantity,
  );
  check(
    "FATURAMENTO F1 · o pedido ficou Parcialmente faturado",
    ped.billingStatus === "PARTIALLY_BILLED",
    String(ped.billingStatus),
  );
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 6 · Caminhos proibidos do Faturamento
// ══════════════════════════════════════════════════════════════════════════
async function marco06NegativosFaturamento() {
  const exp1 = S.dados.expedicoes.A1;
  const fat1 = S.dados.faturamentos.F1;

  // ── 6.1 · Faturar duas vezes a MESMA expedição ─────────────────────────
  await caminhoProibido(
    `FATURAR DUAS VEZES · segunda tentativa sobre ${exp1.code}`,
    {
      pre: `${exp1.code} já faturada e emitida em ${fat1.code} (${EXPEDIR_1} un)`,
      acao: "voltar à expedição e acionar Preparar faturamento de novo",
      esperado: "a tela leva ao documento existente ou recusa; nunca nasce um segundo faturamento",
      invariante: "uma expedição confirmada tem no máximo um faturamento ativo",
    },
    async () => {
      await abrir(exp1.url, { espera: ".doc-title h1" });
      const rotulos = await textos("section.form-section button, div.doc-actions button");
      if (await existeBotao("Preparar faturamento")) {
        await clicarBotao("Preparar faturamento");
        await page.waitForTimeout(2500);
        return `a tela ainda oferecia Preparar faturamento; foi para ${caminho()} · ${JSON.stringify(
          (await mensagensDeErro()).slice(0, 2),
        )}`;
      }
      return `a tela não oferece faturar de novo — botões: ${JSON.stringify(rotulos.slice(0, 8))}`;
    },
  );

  // Confere pelo servidor que não existe segundo faturamento ativo.
  const doPedido = await lerPedido(S.dados.pedidos.A.id);
  const ativos = (doPedido.billings ?? []).filter((b) => b.shipmentId === exp1.id && b.status !== "CANCELLED");
  check(
    "FATURAR DUAS VEZES · a expedição tem exatamente um faturamento ativo",
    ativos.length === 1,
    JSON.stringify((doPedido.billings ?? []).map((b) => `${b.code}/${b.status}/${b.shipmentCode}`)),
  );

  // ── 6.2 · Editar documento já congelado (ISSUED) ───────────────────────
  await caminhoProibido(
    `EDITAR DOCUMENTO CONGELADO · ${fat1.code} já emitido`,
    {
      pre: `${fat1.code} com status Emitido`,
      acao: "abrir o faturamento emitido e tentar alterar referência externa, notas e preço",
      esperado: "campos desabilitados e sem botão de salvar; documento emitido é histórico",
      invariante: "documento emitido não muda de conteúdo",
    },
    async () => {
      await abrir(fat1.url, { espera: ".doc-title h1" });
      const ref = page.locator("#billing-external-reference");
      const notas = page.locator("#billing-notes");
      const estado = {
        referenciaDesabilitada: (await ref.count()) > 0 ? await ref.first().isDisabled() : "ausente",
        notasDesabilitadas: (await notas.count()) > 0 ? await notas.first().isDisabled() : "ausente",
        temSalvar: await existeBotao("Salvar rascunho"),
        temEmitir: await existeBotao("Emitir faturamento"),
        temCancelar: await existeBotao("Cancelar faturamento"),
        temAlterarPreco: await existeBotao("Alterar preço de faturamento"),
        camposDePreco: await page.locator('input[aria-label^="Preço faturado de"]').count(),
      };
      return JSON.stringify(estado);
    },
  );

  // ── 6.3 · Faturar antes do gatilho: expedição em RASCUNHO ──────────────
  const pedidoB = S.dados.pedidos.A;
  await caminhoProibido(
    "FATURAR ANTES DO GATILHO · expedição ainda em rascunho",
    {
      pre: "não existe expedição em rascunho faturável; a fila de Aguardando faturamento é derivada de expedições CONFIRMADAS",
      acao: "abrir Comercial › Faturamento e conferir se alguma expedição não confirmada aparece como faturável",
      esperado: "só expedições confirmadas aparecem na fila",
      invariante: "faturamento pressupõe saída física",
    },
    async () => {
      await abrir("/comercial/faturamento", { espera: ".page__title" });
      await page.waitForTimeout(1200);
      const fila = await apiGet("/billings/awaiting");
      const naFila = (fila.rows ?? []).map((r) => `${r.shipmentCode}/${r.shipmentStatus ?? "?"}`);
      const rascunhos = (await apiGet("/shipments?pageSize=100")).shipments.filter((s) => s.status !== "CONFIRMED");
      const vazando = (fila.rows ?? []).filter((r) => rascunhos.some((s) => s.code === r.shipmentCode));
      return `fila=${JSON.stringify(naFila)} · não-confirmadas na fila=${JSON.stringify(vazando.map((v) => v.shipmentCode))}`;
    },
  );

  // ── 6.4 · Faturar pedido CANCELADO ─────────────────────────────────────
  const cancelado = (await apiGet("/customer-orders?pageSize=100")).customerOrders.find(
    (o) => o.status === "CANCELLED",
  );
  if (cancelado) {
    await caminhoProibido(
      `FATURAR PEDIDO CANCELADO · ${cancelado.code}`,
      {
        pre: `${cancelado.code} está CANCELADO`,
        acao: "abrir o pedido cancelado e procurar caminho para expedir/faturar",
        esperado: "nenhuma ação de expedição ou faturamento disponível",
        invariante: "pedido cancelado não gera documento novo",
      },
      async () => {
        await abrir(`/comercial/pedidos/${cancelado.id}`, { espera: ".doc-title h1" });
        await page.waitForTimeout(1000);
        const acoes = await textos("div.doc-actions button, section.form-section button");
        const detalhe = await apiGet(`/customer-orders/${cancelado.id}`);
        return `status=${detalhe.status} · expedições=${JSON.stringify(detalhe.shipments)} · faturamentos=${JSON.stringify(
          detalhe.billings,
        )} · botões=${JSON.stringify(acoes.slice(0, 10))}`;
      },
    );
  } else {
    anotar("FATURAR PEDIDO CANCELADO · nenhum pedido cancelado no substrato — caso não executado");
  }

  // ── 6.5 · Faturar 50 quando só 40 são elegíveis ────────────────────────
  await caminhoProibido(
    `FATURAR MAIS DO QUE O ELEGÍVEL · 50 sobre uma expedição de ${EXPEDIR_1}`,
    {
      pre: `${fat1.code} espelha ${exp1.code}, que tem ${EXPEDIR_1} un`,
      acao: "procurar na tela do faturamento qualquer campo que permita mudar a quantidade para 50",
      esperado: "não existe campo de quantidade — o documento é derivado da expedição",
      invariante: "quantidade faturada = quantidade expedida, sempre",
    },
    async () => {
      await abrir(fat1.url, { espera: ".doc-title h1" });
      const inputs = await page.evaluate(() =>
        [...document.querySelectorAll("section.form-section input, section.form-section textarea")].map((el) => ({
          id: el.id || null,
          rotulo: el.getAttribute("aria-label"),
          desabilitado: el.disabled,
        })),
      );
      const deQuantidade = inputs.filter((i) => /quantidade/i.test(`${i.id ?? ""}${i.rotulo ?? ""}`));
      return `campos editáveis na tela=${JSON.stringify(inputs)} · campos de quantidade=${JSON.stringify(deQuantidade)}`;
    },
  );
  await shot("adv-negative-path-faturamento");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 7 · Pedido B — o pedido que será faturado DEPOIS da troca de preço
// ══════════════════════════════════════════════════════════════════════════
/**
 * O pedido A já foi inteiramente faturado enquanto a precificação vigente
 * ainda valia o mesmo número — serve de controle, não de prova. O pedido B
 * nasce agora, com o preço de hoje congelado, e só será faturado depois que
 * a precificação vigente tiver mudado de VALOR.
 *
 * 123 un é a quantidade escolhida para o arredondamento:
 * 123 × 4,0531 = 498,5313 — terceira e quarta casas não nulas.
 */
async function marco07PedidoB() {
  const vigenteAgora = await apiGet(`/products/${S.dados.produto.id}/active-pricing`);
  numero("pedidoB.precificacaoVigenteNaCriacao", {
    label: vigenteAgora?.label,
    faixas: (vigenteAgora?.tiers ?? []).map((t) => `${t.quantity}=${t.selectedUnitPrice}`),
  });

  anotar(
    "CONTROLE · o pedido A foi expedido e faturado em duas partes com uma troca de VERSÃO de precificação no meio " +
      "(PREC-000219 V1 → PREC-000220 V2), mas os valores das faixas não mudaram nessa troca — serve como controle de " +
      "identidade de versão, não como prova de preço. A prova de valor é o pedido B",
  );

  const projeto = await criarProjeto("B", `${P} Preco historico e arredondamento`);
  if (!projeto) return;
  if (!(await vincularProduto(projeto))) return;
  if (!(await criarOrcamento(projeto, PEDIDO_B_QTD))) return;
  const pedido = await aprovarProjetoEGerarPedido(projeto, "B");
  if (!pedido) return;

  const ped = await lerPedido(pedido.id);
  const preco = ped.lines[0].agreedPrice;
  check(
    `PEDIDO B · nasceu com preço acordado de QUATRO casas vindo da faixa (${preco?.unitPrice})`,
    preco !== null && preco.source === "PRICING_TIER" && perto(preco.unitPrice, PRECO_QUEBRADO, 1e-9),
    JSON.stringify(preco),
  );

  await abrir(pedido.url, { espera: ".doc-title h1" });
  const precoNaTelaDoPedido = await page.evaluate(() => {
    const tabela = document.querySelector("section.form-section table");
    if (!tabela) return null;
    const idx = [...tabela.querySelectorAll("thead th")].findIndex((th) =>
      (th.textContent ?? "").trim().startsWith("Preço acordado"),
    );
    if (idx < 0) return null;
    const celula = tabela.querySelector("tbody tr")?.querySelectorAll("td")[idx];
    return {
      completo: (celula?.textContent ?? "").replace(/\s+/g, " ").trim(),
      valor: (celula?.childNodes[0]?.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  });
  numero("pedidoB.precoNoPedido", {
    api: preco?.unitPrice,
    totalDaLinhaApi: preco?.lineTotal,
    naTela: precoNaTelaDoPedido,
    faixa: `${preco?.pricingCode} v${preco?.pricingVersionNumber} faixa ${preco?.tierQuantity}`,
  });
  await shot("adv-billing-arredondamento-pedido");

  const depoisPlano = await aplicarPlano(pedido);
  check("PEDIDO B · Em atendimento com a reserva feita", depoisPlano.status === "IN_FULFILLMENT", depoisPlano.status);
  check(
    `PEDIDO B · reservou as ${PEDIDO_B_QTD} un`,
    (depoisPlano.reservation?.lines ?? []).reduce((a, l) => a + num(l.quantity), 0) === PEDIDO_B_QTD,
    JSON.stringify((depoisPlano.reservation?.lines ?? []).map((l) => `${l.lotCode}:${l.quantity}`)),
  );
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 8 · Trocar a precificação VIGENTE do produto
// ══════════════════════════════════════════════════════════════════════════
/**
 * A troca é feita pela tela: nova versão a partir do custo salvo, faixas
 * copiadas removidas uma a uma pelo menu da linha e recadastradas com o
 * preço novo, e ativação. Depois disso o produto vale R$ 9,99 na faixa que o
 * pedido B fechou a R$ 4,0531.
 */
async function marco08TrocaDePrecificacao() {
  const produtoId = S.dados.produto.id;
  const antesVigente = await apiGet(`/products/${produtoId}/active-pricing`);
  numero("precoHistorico.vigenteAntes", {
    label: antesVigente?.label,
    faixas: (antesVigente?.tiers ?? []).map((t) => `${t.quantity}=${t.selectedUnitPrice}`),
  });

  const carteira = await apiGet(`/products/${produtoId}/pricing`);
  if (carteira.draft) {
    await abrir(`/gestao/precificacao/${carteira.draft.id}`, { espera: ".doc-title h1" });
  } else {
    await abrir(`/produtos/${produtoId}/custos`, { espera: ".doc-title h1" });
    await clicarBotao("Criar precificação");
    await esperarUrl((u) => /^\/gestao\/precificacao\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  }
  await page.waitForTimeout(1800);

  const faixasDoRascunhoV2 = async () =>
    ((await apiGet(`/products/${produtoId}/pricing`)).draft?.tiers ?? []).map((t) => ({
      quantidade: t.quantity,
      preco: t.selectedUnitPrice,
    }));

  for (const faixa of FAIXAS_V2) {
    const existente = (await faixasDoRascunhoV2()).find((t) => num(t.quantidade) === faixa.quantidade);
    if (existente && !perto(existente.preco, faixa.preco, 0.000001)) {
      const rotuloQtd =
        faixa.quantidade >= 1000 ? faixa.quantidade.toLocaleString("pt-BR") : String(faixa.quantidade);
      const menu = page.getByRole("button", {
        name: new RegExp(`Mais ações da faixa de ${rotuloQtd.replace(".", "\\.")}\\s`),
      });
      if ((await menu.count()) > 0) {
        await menu.first().click();
        await page.waitForTimeout(600);
        // Os itens do menu são `role="menuitem"`, nunca `button`.
        const remover = page.getByRole("menuitem", { name: "Remover faixa", exact: true });
        if ((await remover.count()) > 0) {
          await remover.first().click();
          await page.waitForTimeout(1000);
          await confirmarDialogoFlexivel(["Remover faixa", "Remover", "Confirmar"]);
          await page.waitForTimeout(1600);
        } else {
          anotar(`TROCA · o menu da faixa de ${faixa.quantidade} un abriu sem "Remover faixa"`);
        }
      } else {
        anotar(`TROCA · a faixa de ${faixa.quantidade} un não tem menu de ações`);
      }
    }
    if ((await faixasDoRascunhoV2()).some((t) => num(t.quantidade) === faixa.quantidade)) continue;
    await preencher("#tier-quantity", String(faixa.quantidade));
    await selecionar("#tier-mode", "MANUAL_PRICE");
    await page.waitForTimeout(250);
    await preencher("#tier-commission", COMISSAO);
    await preencherDecimal("#tier-price", faixa.preco);
    await clicarBotao("Adicionar faixa");
    await page.waitForTimeout(1600);
  }

  const rascunhoFinal = await faixasDoRascunhoV2();
  check(
    `TROCA · o rascunho novo tem a faixa de ${PEDIDO_B_QTD} un a R$ ${FAIXAS_V2[1].preco}`,
    rascunhoFinal.some((t) => num(t.quantidade) === PEDIDO_B_QTD && perto(t.preco, FAIXAS_V2[1].preco, 0.000001)),
    JSON.stringify(rascunhoFinal),
  );

  if (await existeBotao("Ativar precificação")) {
    await clicarBotao("Ativar precificação");
    await page.waitForTimeout(700);
    if ((await page.locator(".confirm-dialog").count()) > 0) await confirmarDialogoFlexivel(["Ativar", "Confirmar"]);
    await page.waitForTimeout(2500);
  }
  await shot("adv-billing-precificacao-nova");

  const depoisVigente = await apiGet(`/products/${produtoId}/active-pricing`);
  const faixasNovas = (depoisVigente?.tiers ?? []).map((t) => `${t.quantity}=${t.selectedUnitPrice}`);
  numero("precoHistorico.vigenteDepois", { label: depoisVigente?.label, faixas: faixasNovas });
  check(
    "TROCA · a precificação VIGENTE do produto mudou de versão",
    depoisVigente?.id !== antesVigente?.id,
    `${antesVigente?.label} → ${depoisVigente?.label}`,
  );
  const faixaB = (depoisVigente?.tiers ?? []).find((t) => num(t.quantity) === PEDIDO_B_QTD);
  check(
    `TROCA · a faixa de ${PEDIDO_B_QTD} un vigente agora vale R$ ${FAIXAS_V2[1].preco} (era R$ ${PRECO_QUEBRADO})`,
    perto(faixaB?.selectedUnitPrice, FAIXAS_V2[1].preco, 0.0001),
    `${faixaB?.selectedUnitPrice}`,
  );

  const ped = await lerPedido(S.dados.pedidos.B.id);
  registrarCaso("PREÇO HISTÓRICO · o pedido não é reescrito pela precificação nova", {
    pre: `${ped.code} fechado a R$ ${PRECO_QUEBRADO} na ${antesVigente?.label}`,
    acao: `ativar ${depoisVigente?.label} com a faixa de ${PEDIDO_B_QTD} un a R$ ${FAIXAS_V2[1].preco}`,
    esperado: "o preço acordado do pedido continua o mesmo",
    real: `preço acordado ${ped.lines[0].agreedPrice?.unitPrice} · origem ${ped.lines[0].agreedPrice?.pricingCode} v${ped.lines[0].agreedPrice?.pricingVersionNumber}`,
    invariante: "precificação nova nunca reescreve acordo fechado",
    veredito: perto(ped.lines[0].agreedPrice?.unitPrice, PRECO_QUEBRADO, 1e-9) ? "PASS" : "FAIL",
  });
  check(
    `PREÇO HISTÓRICO · o pedido ${ped.code} continua com o preço acordado R$ ${PRECO_QUEBRADO}`,
    perto(ped.lines[0].agreedPrice?.unitPrice, PRECO_QUEBRADO, 1e-9),
    `${ped.lines[0].agreedPrice?.unitPrice}`,
  );
  S.dados.precificacaoNova = { label: depoisVigente?.label, precoFaixaB: faixaB?.selectedUnitPrice };
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 9 · Faturar depois da troca — preço histórico e arredondamento
// ══════════════════════════════════════════════════════════════════════════
async function marco09PrecoHistoricoEArredondamento() {
  const pedido = S.dados.pedidos.B;
  const exp = await prepararExpedicao(pedido, "B1");
  if (!exp) return;
  const linhas = await linhasDeExpedicao();
  check(
    `EXPEDIÇÃO B1 · rascunho pré-preenchido com as ${PEDIDO_B_QTD} un`,
    num(linhas[0]?.valorQuantidade) === PEDIDO_B_QTD,
    JSON.stringify(linhas),
  );
  await conferirLotes();
  if (await existeBotao("Confirmar expedição")) {
    await clicarBotao("Confirmar expedição");
    await confirmarDialogo("Confirmar");
    await page.waitForTimeout(3500);
  }
  const confirmada = await lerExpedicao(exp.id);
  check(`EXPEDIÇÃO B1 · confirmada com ${PEDIDO_B_QTD} un`, confirmada.status === "CONFIRMED", confirmada.status);

  const fat = await prepararFaturamento(exp, "F3");
  if (!fat) return;
  const doc = await lerDocumentoDeFaturamento();
  const api = await lerFaturamento(fat.id);
  const linha = api.lines[0];

  const colunas = doc?.colunas ?? [];
  const idxPrecoFaturado = colunas.findIndex((c) => c.startsWith("Preço faturado"));
  const idxTotal = colunas.findIndex((c) => c.startsWith("Total"));
  const celulas = doc?.linhas?.[0] ?? [];
  const precoExibido = (celulas[idxPrecoFaturado] ?? "").replace("Alterar preço de faturamento", "").trim();
  const totalExibido = celulas[idxTotal] ?? null;
  const totalDocumento = (doc?.rodape ?? "").split("·").pop()?.trim() ?? null;

  const cheio = Number(PRECO_QUEBRADO) * PEDIDO_B_QTD; // 498.5313
  const totalCorreto = dinheiro(cheio);
  const contaDoOperador = dinheiro(soNumero(precoExibido) * PEDIDO_B_QTD);
  const diferenca = Number((totalCorreto - contaDoOperador).toFixed(2));
  const precoVigenteHoje = S.dados.precificacaoNova?.precoFaixaB ?? null;

  numero("precoHistoricoEArredondamento", {
    pedido: pedido.code,
    faturamento: fat.code,
    precoNoPedidoApi: (await lerPedido(pedido.id)).lines[0].agreedPrice?.unitPrice,
    precoNoPedidoNaTela: S.registro.numeros["pedidoB.precoNoPedido"]?.naTela ?? null,
    precoNoFaturamentoApi: linha.unitPrice,
    precoAcordadoNoFaturamentoApi: linha.agreedUnitPrice,
    precoNaTelaDoFaturamento: precoExibido,
    precoVigenteHoje,
    quantidade: linha.quantity,
    totalDaLinhaApi: linha.lineTotal,
    totalDaLinhaNaTela: totalExibido,
    totalDoDocumentoApi: api.totalAmount,
    totalDoDocumentoNaTela: totalDocumento,
    produtoCheio: cheio,
    contaDoOperadorComOQueEstaNaTela: contaDoOperador,
    diferencaEmReais: diferenca,
  });

  // ── Preço histórico ────────────────────────────────────────────────────
  const usouOAcordado = perto(linha.unitPrice, Number(PRECO_QUEBRADO).toFixed(2), 0.0001);
  const usouONovo = perto(linha.unitPrice, precoVigenteHoje, 0.0001);
  registrarCaso("PREÇO HISTÓRICO · faturar depois de mudar a precificação vigente", {
    pre: `${pedido.code} fechado a R$ ${PRECO_QUEBRADO}; precificação vigente do produto agora vale R$ ${precoVigenteHoje} na mesma faixa de ${PEDIDO_B_QTD} un`,
    acao: `expedir as ${PEDIDO_B_QTD} un e preparar o faturamento DEPOIS da troca`,
    esperado: `preço faturado R$ ${Number(PRECO_QUEBRADO).toFixed(2)} e total R$ ${totalCorreto.toFixed(2)} — o acordo, nunca o preço de hoje`,
    real: `preço faturado ${linha.unitPrice} · acordado no documento ${linha.agreedUnitPrice} · total da linha ${linha.lineTotal} · total do documento ${api.totalAmount}`,
    invariante: "faturamento lê o preço da linha do PEDIDO, não a precificação vigente",
    veredito: usouOAcordado && !usouONovo ? "PASS" : "FAIL",
  });
  check(
    `PREÇO HISTÓRICO · o faturamento usou o preço do PEDIDO (${PRECO_QUEBRADO}), não o vigente (${precoVigenteHoje})`,
    usouOAcordado && !usouONovo,
    `preço faturado=${linha.unitPrice}`,
  );
  check(
    `PREÇO HISTÓRICO · total da linha = ${PEDIDO_B_QTD} × ${PRECO_QUEBRADO} = ${totalCorreto.toFixed(2)}`,
    perto(linha.lineTotal, totalCorreto, 0.0001),
    `${linha.lineTotal}`,
  );
  if (usouONovo) {
    finding(
      "CRITICAL",
      "Faturamento usa a precificação vigente em vez do preço acordado no pedido",
      `Pedido ${pedido.code} fechado a ${PRECO_QUEBRADO}; após ativar nova precificação a ${precoVigenteHoje}, o faturamento ${fat.code} saiu a ${linha.unitPrice}.`,
    );
  }
  await shot("adv-billing-preco-historico");

  // ── Arredondamento, hipótese 1: o preço entre as telas ─────────────────
  const precoNoPedidoTela = S.registro.numeros["pedidoB.precoNoPedido"]?.naTela?.valor ?? null;
  const mesmaExibicao = soNumero(precoNoPedidoTela) === soNumero(precoExibido);
  registrarCaso("ARREDONDAMENTO · o preço de quatro casas entre as telas", {
    pre: `pedido com preço acordado ${PRECO_QUEBRADO} (Decimal(14,4), aceito pela tela do Orçamento)`,
    acao: "comparar o preço exibido na tela do Pedido com o exibido na tela do Faturamento",
    esperado: "as duas telas mostram o mesmo número para o mesmo campo",
    real: `Pedido="${precoNoPedidoTela}" · Faturamento="${precoExibido}" · API do pedido=${PRECO_QUEBRADO} · API do faturamento=${linha.unitPrice}`,
    invariante: "o mesmo campo não pode valer dois números diferentes em duas telas",
    veredito: mesmaExibicao ? "PASS" : "FAIL",
  });
  check(
    "ARREDONDAMENTO · o preço acordado é exibido igual no Pedido e no Faturamento",
    mesmaExibicao,
    `pedido="${precoNoPedidoTela}" faturamento="${precoExibido}"`,
  );
  anotar(
    `CONTRATO · o preço acordado sai da API com QUATRO casas no Pedido (${PRECO_QUEBRADO}) e com DUAS no Faturamento (${linha.agreedUnitPrice}); nas duas telas o pt-BR corta em duas casas, então a divergência não aparece entre telas — aparece entre a tela e o total`,
  );

  // ── Arredondamento, hipótese 2: o documento fecha na conferência manual ─
  const fecha = Math.abs(diferenca) < 0.005;
  registrarCaso("ARREDONDAMENTO · o documento fecha na conferência manual", {
    pre: `faturamento ${fat.code} com ${PEDIDO_B_QTD} un e preço exibido "${precoExibido}"`,
    acao: `multiplicar na mão o que está na tela: ${precoExibido} × ${PEDIDO_B_QTD}`,
    esperado: `resultado igual ao total exibido (${totalExibido})`,
    real: `conta do operador = ${contaDoOperador.toFixed(2)} · total exibido = ${totalExibido} · diferença = R$ ${Math.abs(diferenca).toFixed(2)}`,
    invariante: "quem confere um documento de faturamento com os números da própria tela chega ao total impresso",
    veredito: fecha ? "PASS" : "FAIL",
  });
  check(
    "ARREDONDAMENTO · o total impresso é reproduzível com o preço impresso",
    fecha,
    `${precoExibido} × ${PEDIDO_B_QTD} = ${contaDoOperador.toFixed(2)} vs total ${totalExibido}`,
  );
  if (!fecha) {
    finding(
      "HIGH",
      "Documento de faturamento não fecha com os números que ele mesmo exibe",
      `Preço acordado de quatro casas (${PRECO_QUEBRADO}) entra pela tela do Orçamento e é aceito (quote_lines.unitPrice é Decimal(14,4)). No faturamento ${fat.code} a tela exibe preço "${precoExibido}" e total "${totalExibido}": ${soNumero(precoExibido)} × ${PEDIDO_B_QTD} = ${contaDoOperador.toFixed(2)}, R$ ${Math.abs(diferenca).toFixed(2)} abaixo do total impresso. O total é calculado sobre o valor cheio (billings.service.ts: quantity.times(unitPrice)) e exibido ao lado de um preço truncado em duas casas (formatMoney = toFixed(2) na API, formatBRL/pt-BR na tela). Reproduzir: pedido ${pedido.code} → expedição ${exp.code} → faturamento ${fat.code}.`,
    );
  }

  // ── Arredondamento, hipótese 3: drift de somatório entre linhas ─────────
  const somaDasLinhas = api.lines.reduce((a, l) => a + num(l.lineTotal), 0);
  registrarCaso("ARREDONDAMENTO · drift de somatório entre linhas", {
    pre: `faturamento ${fat.code} com ${api.lines.length} linha(s)`,
    acao: "comparar Σ(totais de linha exibidos) com o total do documento exibido",
    esperado: "iguais",
    real: `linhas=${api.lines.length} · Σ=${somaDasLinhas.toFixed(2)} · documento=${api.totalAmount} · rodapé="${totalDocumento}"`,
    invariante: "Σ round(linha) = round(Σ linha)",
    veredito: api.lines.length < 2 ? "NAO_EXERCITADO" : perto(somaDasLinhas, api.totalAmount, 0.005) ? "PASS" : "FAIL",
  });
  check(
    "ARREDONDAMENTO · o total do documento bate com a soma das linhas exibidas",
    perto(somaDasLinhas, soNumero(totalDocumento), 0.005),
    `Σ=${somaDasLinhas.toFixed(2)} rodapé="${totalDocumento}"`,
  );
  if (api.lines.length < 2) {
    anotar(
      "ARREDONDAMENTO · o drift de somatório entre linhas NÃO foi exercitado: um faturamento tem exatamente uma linha por linha de expedição, cada linha de expedição vem de uma linha de reserva, e um orçamento aceita cada produto uma única vez — com um único lote livre do produto no substrato não há caminho pela interface para montar duas linhas no mesmo documento",
    );
  }

  await emitirFaturamento(fat);
  const emitido = await lerFaturamento(fat.id);
  check("ARREDONDAMENTO · faturamento emitido", emitido.status === "ISSUED", emitido.status);
  await shot("adv-billing-arredondamento");

  const pedFinal = await lerPedido(pedido.id);
  check(
    `PEDIDO B · totalmente expedido e faturado (${PEDIDO_B_QTD} un)`,
    pedFinal.status === "SHIPPED" && num(pedFinal.lines[0].billedQuantity) === PEDIDO_B_QTD,
    `${pedFinal.status} · ${pedFinal.lines[0].billedQuantity}`,
  );
  salvarEstado();
}


// ══════════════════════════════════════════════════════════════════════════
// MARCO 10 · Cadeia ADV — expedir e faturar o lote da OP-000659
// ══════════════════════════════════════════════════════════════════════════
/**
 * A rastreabilidade só chega a Expedição e Faturamento se o lote produzido
 * pela OP tiver saído. `PED-000485` tem 400 un de `LT-20260903-000803`
 * reservadas desde a onda anterior — é essa a saída que fecha a genealogia.
 */
async function marco10CadeiaAdv() {
  const pedidos = (await apiGet("/customer-orders?pageSize=100")).customerOrders;
  const alvo = pedidos.find((o) => o.code === "PED-000485");
  if (!check("CADEIA ADV · PED-000485 existe no substrato", Boolean(alvo), "")) return;
  S.dados.pedidos = S.dados.pedidos ?? {};
  S.dados.pedidos.ADV = { chave: "ADV", id: alvo.id, code: alvo.code, url: `/comercial/pedidos/${alvo.id}` };
  salvarEstado();

  const exp = await prepararExpedicao(S.dados.pedidos.ADV, "ADV1");
  if (!exp) return;
  const linhas = await linhasDeExpedicao();
  anotar(`CADEIA ADV · separação pré-preenchida: ${JSON.stringify(linhas.map((l) => `${l.lote}:${l.valorQuantidade}`))}`);
  await conferirLotes();
  await clicarBotao("Confirmar expedição");
  await confirmarDialogo("Confirmar");
  await page.waitForTimeout(3500);
  const confirmada = await lerExpedicao(exp.id);
  check("CADEIA ADV · expedição confirmada", confirmada.status === "CONFIRMED", confirmada.status);
  numero("cadeiaAdv.expedicao", { code: exp.code, quantidade: confirmada.totalQuantity });

  const fat = await prepararFaturamento(exp, "ADVF");
  if (!fat) return;
  const api = await lerFaturamento(fat.id);
  anotar(
    `CADEIA ADV · faturamento ${fat.code}: ${api.totalQuantity} un, valor ${api.totalAmount ?? "sem preço"} (o pedido ADV nunca teve preço acordado)`,
  );
  check(
    "CADEIA ADV · faturamento sem preço acordado sai com quantidade válida e valor não informado",
    num(api.totalQuantity) > 0 && api.totalAmount === null,
    `${api.totalQuantity} · ${api.totalAmount}`,
  );
  await emitirFaturamento(fat);
  check("CADEIA ADV · faturamento emitido", (await lerFaturamento(fat.id)).status === "ISSUED", "");
  numero("cadeiaAdv.faturamento", { code: fat.code, quantidade: api.totalQuantity, valor: api.totalAmount });
  await shot("adv-billing-cadeia-adv");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 11 · Expedir acima do estoque — e a porta que não existe
// ══════════════════════════════════════════════════════════════════════════
/**
 * "Expedir acima do estoque" pressupõe físico MENOR que o reservado. Pela
 * interface as duas únicas saídas que não são expedição — Ajuste/Perda e
 * Contagem de inventário — recusam justamente isso. Aqui as duas portas são
 * batidas de verdade, com foto antes e depois, e o resultado define se o
 * caso é alcançável ou não.
 */
async function marco11EstoqueAbaixoDoReservado() {
  const item = S.dados.itemPaAdv;
  if (!item) {
    anotar("ESTOQUE ABAIXO DO RESERVADO · item ADV não registrado — caso não executado");
    return;
  }
  const lotes = await lerLotesDoItem(item.id);
  const alvo = lotes.find((l) => num(l.reserved) > 0);
  if (!alvo) {
    anotar("ESTOQUE ABAIXO DO RESERVADO · nenhum lote com reserva ativa — caso não executado");
    return;
  }
  anotar(
    `ESTOQUE ABAIXO DO RESERVADO · alvo ${alvo.code}: físico ${alvo.onHand}, reservado ${alvo.reserved}, disponível ${alvo.available}`,
  );

  // ── 11.1 · Perda maior que o disponível ────────────────────────────────
  await caminhoProibido(
    `PERDA ABAIXO DO RESERVADO · baixar ${alvo.reserved} de ${alvo.code} (disponível ${alvo.available})`,
    {
      pre: `${alvo.code} com físico ${alvo.onHand} e reservado ${alvo.reserved} — disponível ${alvo.available}`,
      acao: "Estoque › item › Ajustar estoque › Perda, com quantidade acima do disponível",
      esperado: "recusa; o físico nunca cai abaixo do que está comprometido com um pedido",
      invariante: "físico ≥ reservado, sempre — é o que impede expedir mais do que existe",
    },
    async () => {
      await abrir(`/estoque/${item.id}`, { espera: ".doc-title, .page__title" });
      await page.waitForTimeout(1200);
      if (!(await existeBotao("Ajustar estoque"))) return "a tela não oferece Ajustar estoque";
      await clicarBotao("Ajustar estoque");
      await page.waitForTimeout(700);
      await selecionar("#adjust-lot", alvo.id);
      await selecionar("#adjust-type", "LOSS");
      await preencher("#adjust-quantity", String(Math.max(1, num(alvo.reserved))));
      await preencher("#adjust-reason", "Validacao adversarial: tentativa de baixar abaixo do reservado");
      await page.waitForTimeout(300);
      const botao = page.locator('button[form="adjust-stock-form"]');
      const desabilitado = (await botao.count()) > 0 ? await botao.first().isDisabled() : "ausente";
      if (desabilitado === false) {
        await botao.first().click();
        await page.waitForTimeout(2500);
      }
      const msgs = await mensagensDeErro();
      await page.keyboard.press("Escape").catch(() => {});
      return `botão ${desabilitado === true ? "desabilitado" : "habilitado"} · ${JSON.stringify(msgs.slice(0, 3))}`;
    },
  );

  // ── 11.2 · Contagem de inventário abaixo do reservado ──────────────────
  await caminhoProibido(
    `CONTAGEM ABAIXO DO RESERVADO · contar 1 un em ${alvo.code} (reservado ${alvo.reserved})`,
    {
      pre: `${alvo.code} com físico ${alvo.onHand} e reservado ${alvo.reserved}`,
      acao: "Estoque › Inventário: contar uma quantidade menor que o reservado e confirmar",
      esperado: "recusa; contagem não pode invalidar compromisso já assumido",
      invariante: "físico ≥ reservado, sempre",
    },
    async () => {
      await abrir("/estoque/inventario", { espera: ".page__title" });
      await page.waitForTimeout(1200);
      await escolherEntidade("#count-item", item.code, item.code);
      await page.waitForTimeout(1200);
      if ((await page.locator("#count-lot").count()) > 0) {
        await selecionar("#count-lot", alvo.id);
        await page.waitForTimeout(600);
      }
      await preencher("#count-quantity", "1");
      if ((await page.locator("#count-reason").count()) > 0) {
        await preencher("#count-reason", "Validacao adversarial: contagem abaixo do reservado");
      }
      await page.waitForTimeout(400);
      if (!(await existeBotao("Confirmar contagem"))) return "a tela não ofereceu Confirmar contagem";
      const botao = page.getByRole("button", { name: "Confirmar contagem", exact: true });
      const desabilitado = await botao.first().isDisabled();
      if (!desabilitado) {
        await botao.first().click();
        await page.waitForTimeout(2500);
        if ((await page.locator(".confirm-dialog").count()) > 0) {
          await confirmarDialogoFlexivel(["Confirmar contagem", "Confirmar"]);
          await page.waitForTimeout(2000);
        }
      }
      return `botão ${desabilitado ? "desabilitado" : "habilitado"} · ${JSON.stringify((await mensagensDeErro()).slice(0, 3))}`;
    },
  );

  const depois = await lerLotesDoItem(item.id);
  const conferido = depois.find((l) => l.code === alvo.code);
  registrarCaso("EXPEDIR ACIMA DO ESTOQUE · a porta não existe pela interface", {
    pre: `${alvo.code} com físico ${alvo.onHand} e reservado ${alvo.reserved}`,
    acao: "tentar, pelas duas únicas saídas não-expedição da interface, derrubar o físico abaixo do reservado",
    esperado: "as duas recusam, e por isso confirmar uma expedição maior que o físico é inalcançável pela tela",
    real: `depois das tentativas: físico ${conferido?.onHand}, reservado ${conferido?.reserved}`,
    invariante: "a expedição valida saldo físico no commit; sem caminho para furar o físico, o erro de saldo é inalcançável",
    veredito: perto(conferido?.onHand, alvo.onHand) && perto(conferido?.reserved, alvo.reserved) ? "BLOCKED_CORRECTLY" : "BUG",
  });
  registrarNegativo(
    "EXPEDIR ACIMA DO ESTOQUE · físico menor que o reservado",
    perto(conferido?.onHand, alvo.onHand) ? "BLOCKED_CORRECTLY" : "BUG",
    "Ajuste/Perda e Contagem recusam cair abaixo do reservado; o cenário não é construível pela interface",
  );
  await shot("adv-negative-path-estoque");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 12 · Varredura de console nas telas tocadas
// ══════════════════════════════════════════════════════════════════════════
async function marco12Varredura() {
  const antesConsole = consoleErrors.length;
  const antesPageError = pageErrors.length;
  const antesRede = respostasComErro.length;

  const rotas = [];
  for (const chave of Object.keys(S.dados.pedidos ?? {})) rotas.push(S.dados.pedidos[chave].url);
  for (const chave of Object.keys(S.dados.expedicoes ?? {})) rotas.push(S.dados.expedicoes[chave].url);
  for (const chave of Object.keys(S.dados.faturamentos ?? {})) rotas.push(S.dados.faturamentos[chave].url);
  for (const chave of Object.keys(S.dados.projetos ?? {})) rotas.push(S.dados.projetos[chave].url);
  rotas.push(
    "/comercial/pedidos",
    "/comercial/expedicoes",
    "/comercial/faturamento",
    "/gestao/precificacao",
    `/estoque/${S.dados.itemPa.id}`,
    "/relatorios/faturamento/periodo",
    "/relatorios/faturamento/pendentes",
    "/relatorios/faturamento/pedido-entregue-faturado",
  );

  for (const rota of rotas) {
    await abrir(rota, { espera: ".page__title, .doc-title, .consult-head" });
    await page.waitForTimeout(900);
  }

  const novosConsole = consoleErrors.slice(antesConsole);
  const novosPageError = pageErrors.slice(antesPageError);
  const novosRede = respostasComErro.slice(antesRede);
  check(
    `CONSOLE · nenhuma das ${rotas.length} telas do escopo emitiu console.error ao renderizar o estado final`,
    novosConsole.length === 0,
    JSON.stringify(novosConsole.slice(0, 5)),
  );
  check(
    "CONSOLE · nenhuma exceção não tratada (pageerror) nas telas do escopo",
    novosPageError.length === 0,
    JSON.stringify(novosPageError.slice(0, 5)),
  );
  check(
    "REDE · nenhuma resposta >=400 ao apenas abrir as telas do escopo",
    novosRede.length === 0,
    JSON.stringify(novosRede.slice(0, 8)),
  );
  S.dados.varredura = {
    telas: rotas.length,
    consoleErrors: novosConsole.length,
    pageErrors: novosPageError.length,
    respostas400: novosRede.length,
  };
  anotar(
    `VARREDURA · ${rotas.length} telas · console ${novosConsole.length} · pageerror ${novosPageError.length} · >=400 ${novosRede.length}`,
  );
  await shot("adv-billing-varredura");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// Execução
// ══════════════════════════════════════════════════════════════════════════
let parada = null;

async function principal() {
  await login();
  await abrirNavegador();

  await marco(1, "massa-e-precificacao", marco01MassaEPrecificacao);
  await marco(2, "pedido-a-com-preco", marco02PedidoA);
  await marco(3, "expedicao-parcial", marco03ExpedicaoParcial);
  await marco(4, "negativos-expedicao", marco04NegativosExpedicao);
  await marco(5, "faturamento-parcial", marco05FaturamentoParcial);
  await marco(6, "negativos-faturamento", marco06NegativosFaturamento);
  await marco(7, "pedido-b", marco07PedidoB);
  await marco(8, "troca-de-precificacao", marco08TrocaDePrecificacao);
  await marco(9, "preco-historico-e-arredondamento", marco09PrecoHistoricoEArredondamento);
  await marco(10, "cadeia-adv", marco10CadeiaAdv);
  await marco(11, "estoque-abaixo-do-reservado", marco11EstoqueAbaixoDoReservado);
  S.marcos = S.marcos.filter((m) => m !== "12-varredura");
  await marco(12, "varredura", marco12Varredura);
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
    console.log("\nCASOS:");
    for (const c of reg.casos) console.log(`  ${String(c.veredito).padEnd(18)} ${c.caso}`);
    console.log("\nNEGATIVOS:");
    for (const n of reg.negativos) console.log(`  ${n.veredito.padEnd(18)} ${n.caso} — ${n.detalhe}`);
    console.log("\nFINDINGS:");
    for (const f of reg.findings) console.log(`  ${f.severidade} — ${f.titulo}`);
    console.log("\nNÚMEROS:");
    console.log(JSON.stringify(reg.numeros, null, 1));
    console.log("\nCONSOLE NÃO DELIBERADO:");
    console.log(`  console.error=${consoleErrors.length} pageerror=${pageErrors.length}`);
    for (const c of consoleErrors.slice(0, 15)) console.log(`   · ${c}`);
    for (const c of pageErrors.slice(0, 15)) console.log(`   · ${c}`);
    console.log("\nRESPOSTAS >=400 NÃO DELIBERADAS:");
    for (const r of respostasComErro.slice(0, 30)) console.log(`   · ${r.method} ${r.pathname} → ${r.status}`);
    console.log(`\nRESPOSTAS >=400 DELIBERADAS: ${deliberados.rede.length}`);
    for (const r of deliberados.rede.slice(0, 40)) {
      console.log(`   · [${r.janela}] ${r.method} ${r.pathname} → ${r.status}`);
    }
    if (dialogosNativos.length) console.log(`\nDIÁLOGOS NATIVOS: ${JSON.stringify(dialogosNativos)}`);
    if (parada) console.log(`\nPARADA: ${parada}`);
    console.log(`\nestado: ${STATE_FILE}`);
    console.log(`screens: ${path.resolve(OUT)}`);
    process.exit(reg.verificacoes.nok.length > 0 || parada?.startsWith("erro") ? 1 : 0);
  });
