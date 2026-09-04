import { chromium } from "@playwright/test";
import fs from "node:fs";
import { obterRun, publicar, consultar, cnpjDoRun } from "./adversarial-run.mjs";
import path from "node:path";

/**
 * VALIDAÇÃO ADVERSARIAL — PEDIDO, RESERVA E ORDEM DE PRODUÇÃO.
 *
 * Segunda onda. A primeira (`validate-adversarial-stock.mjs`) parou no
 * consumo físico; esta continua dali, pelo caminho oficial do domínio:
 * Pedido → Plano de Atendimento → Ordem de Produção → apontamento →
 * conclusão.
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
 * ## Massa
 *
 * Reaproveita o que a onda 1 deixou: item `MP-000327` (ADV Carbonato de
 * cálcio), fornecedor `ADV`, seis lotes — três vencidos, um zerado, um
 * disponível com 18,904452 kg e um BLOQUEADO com 49 kg.
 *
 * Acrescenta, tudo pela tela:
 *
 *   * dois lotes novos de MP-000327 — 3 kg vencendo 2026-11-30 e 40 kg
 *     vencendo 2029-06-30 — porque FEFO só é testável com o lote de menor
 *     validade SENDO PEQUENO: a necessidade tem que atravessar dois lotes;
 *   * um segundo material (`ADV Excipiente tecnico`), porque metade dos
 *     caminhos proibidos da conclusão exige DOIS requisitos — um consumido e
 *     outro não — e uma formulação de um componente só não consegue estar
 *     meio reconciliada;
 *   * um produto novo com formulação ativa de dois componentes.
 *
 * Quantidade, preço e lote de fornecedor continuam vindo da planilha real
 * (item 260). As validades dos dois lotes novos são sintéticas e estão
 * declaradas como tal.
 *
 * PRIVACIDADE: nenhum CNPJ, telefone, e-mail, endereço ou razão social real
 * entra em log, screenshot ou relatório.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-adversarial-production.mjs
 *   ... --ate=6      para depois do marco 6
 *   ... --reset      ignora o estado e recomeça
 */

const OUT = "handoff/screens/adversarial";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

const STATE_FILE = path.resolve("handoff/adversarial-production-state.json");
const RESET = process.argv.includes("--reset");

/*
 * Identidade desta execucao — herdada da suite de estoque quando ela ja
 * rodou, criada aqui quando esta suite roda sozinha. `--reset` comeca um
 * run novo; sem ele, retoma o corrente.
 */
/*
 * SEMPRE herda. Quem abre execucao nova e a suite de estoque, cabeca da
 * cadeia: se cada suite criasse a sua, `--reset` em todas geraria quatro
 * execucoes isoladas e a de producao nao acharia a massa da de estoque.
 * `--reset` aqui limpa o estado de marcos DESTA suite, nao a identidade.
 */
const RUN = obterRun({ novo: false, dono: "production" });
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
/*
 * Prefixo carimbado no nome de negocio desta execucao. Nome fixo fazia a
 * busca reencontrar a massa da execucao anterior — Produto ja com
 * Formulacao ativa, Precificacao ja em outro preco — e a suite acusava
 * defeito de laboratorio como se fosse do produto.
 */
const P = `ADV${RUN.runId}`;

/** Item da onda 1 — reaproveitado, nunca recriado. */
const MP_NOME = `${P} Carbonato de calcio`;
const FORNECEDOR_NOME = `${P} Fornecedor Insumos`;
/*
 * Lote bloqueado — resolvido por caracteristica em `resolverLoteBloqueado`.
 * Era um codigo cravado de execucao anterior; o teste precisa de UM lote
 * bloqueado com saldo, nao daquele.
 */
let LOTE_BLOQUEADO = null;

async function resolverLoteBloqueado() {
  const bloqueados = (await apiGet("/lots?status=BLOCKED&pageSize=50")).lots ?? [];
  LOTE_BLOQUEADO = bloqueados.find((l) => Number(l.onHand) > 0)?.code ?? bloqueados[0]?.code ?? null;
  return LOTE_BLOQUEADO;
}

/** Segundo material: existe para partir a reconciliação em duas histórias. */
const MP2 = {
  nome: `${P} Excipiente tecnico`,
  tipo: "RAW_MATERIAL",
  unidade: "kg",
  controlaLote: true,
  controlaValidade: true,
  exigeLiberacao: true,
};

/**
 * Compras novas.
 *
 * `F` é deliberadamente PEQUENA: 3 kg. É o lote de menor validade entre os
 * elegíveis, e a necessidade da OP (4 kg) tem que atravessá-lo e cair no
 * seguinte — sem isso o FEFO nunca é exercitado de verdade, só afirmado.
 *
 * Preço e lote de fornecedor vêm da planilha real do item 260; as validades
 * de 2026-11-30 e 2029-06-30 são sintéticas.
 */
const COMPRAS = [
  {
    id: "F",
    item: "MP",
    quantidade: "3",
    preco: "6.50",
    recebidoEm: "2026-02-10",
    validade: "2026-11-30",
    loteFornecedor: "ADV-862883",
    nf: "ADV-0003",
  },
  {
    id: "G",
    item: "MP",
    quantidade: "40",
    preco: "5.50",
    recebidoEm: "2026-04-08",
    validade: "2029-06-30",
    loteFornecedor: "ADV-871402",
    nf: "ADV-0004",
  },
  {
    id: "H",
    item: "MP2",
    quantidade: "20",
    preco: "4.29",
    recebidoEm: "2026-04-08",
    validade: "2029-12-31",
    loteFornecedor: "ADV-880110",
    nf: "ADV-0005",
  },
];

/** Formulação: base 1000 un; 4 kg do carbonato e 1 kg do excipiente. */
const BASE_FORMULACAO = "1000";
const QTD_MP = "4";
const QTD_MP2 = "1";

/** Quantidades dos pedidos — desenhadas para os três casos de cobertura. */
const PED1_QTD = 1000; // estoque zero  → produz tudo
const PED2_QTD = 400; // estoque suficiente → reserva tudo
const PED3_QTD = 600; // estoque parcial → reserva o que resta, produz o resto
const PRODUZIDO_OP1 = "800"; // produção parcial: obriga motivo de variação

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
  await dialogo.getByRole("button", { name: textoBotao, exact: true }).click();
  await page.waitForTimeout(900);
}

/**
 * Confirma um `ModalDialog`.
 *
 * O `ModalDialog` reusa a MESMA casca `.confirm-dialog` do `ConfirmDialog`,
 * com `role="alertdialog"` — procurar por `[role='dialog']` não acha nada. E
 * o escopo importa: "Concluir OP" e "Cancelar pedido" existem duas vezes na
 * página (rodapé e diálogo), e um clique fora do escopo reabre o diálogo em
 * vez de confirmar.
 */
async function confirmarModal(textoBotao, { timeout = 20000 } = {}) {
  const dialogo = page.locator(".confirm-dialog");
  await dialogo.waitFor({ state: "visible", timeout });
  const alvo = dialogo.getByRole("button", { name: textoBotao, exact: true }).first();
  await alvo.waitFor({ state: "visible", timeout });
  await alvo.click();
  await page.waitForTimeout(1400);
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
const perto = (a, b, tol = 1e-9) => Math.abs(num(a) - num(b)) < tol;

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

const lerOp = async (id) => apiGet(`/production-orders/${id}`);
const lerPedido = async (id) => apiGet(`/customer-orders/${id}`);

const idDaUrl = (url) => url.split("/").pop();

/** Itens rastreados pela foto — preenchidos no marco 1. */
function itensRastreados() {
  return [S.dados.mp, S.dados.mp2, S.dados.itemPa].filter(Boolean);
}

/**
 * Foto completa do território tocado: lotes, movimentos, reservas, status.
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

  const ops = {};
  for (const chave of Object.keys(S.dados.ops ?? {})) {
    const registro = S.dados.ops[chave];
    if (!registro?.id) continue;
    try {
      const op = await lerOp(registro.id);
      ops[registro.code] = {
        status: op.status,
        produzido: op.producedQuantity,
        outputs: op.outputs.length,
        consumos: op.consumptions.length,
        reservaStatus: op.reservation?.status ?? null,
        linhas: (op.reservation?.lines ?? []).map((l) => ({
          lote: l.lotCode,
          qtd: l.quantity,
          consumido: l.consumedQuantity,
          picking: l.pickingStatus,
          liberadaEm: l.releasedAt ? "sim" : "nao",
          extra: l.extraReason ? "sim" : "nao",
        })),
        requisitos: op.requirements.map((r) => ({
          item: r.itemCode,
          necessario: r.requiredQuantity,
          consumido: r.consumedQuantity,
          situacao: r.reconciliationStatus,
          motivo: r.varianceReason,
        })),
      };
    } catch {
      ops[registro.code] = { erro: "não pôde ser lida" };
    }
  }

  const pedidos = {};
  for (const chave of Object.keys(S.dados.pedidos ?? {})) {
    const registro = S.dados.pedidos[chave];
    if (!registro?.id) continue;
    try {
      const ped = await lerPedido(registro.id);
      pedidos[registro.code] = {
        status: ped.status,
        reservas: (ped.reservations ?? []).map((r) => `${r.status}`),
        ops: (ped.generatedProductionOrders ?? []).map((o) => `${o.code}/${o.status}`),
      };
    } catch {
      pedidos[registro.code] = { erro: "não pôde ser lido" };
    }
  }

  return { rotulo, quando: new Date().toISOString(), itens, ops, pedidos };
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
  for (const code of Object.keys(a.ops)) {
    const x = JSON.stringify(a.ops[code]);
    const y = JSON.stringify(b.ops[code]);
    if (x !== y) partes.push(`OP ${code} mudou: ${y}`);
  }
  for (const code of Object.keys(a.pedidos)) {
    const x = JSON.stringify(a.pedidos[code]);
    const y = JSON.stringify(b.pedidos[code]);
    if (x !== y) partes.push(`Pedido ${code} mudou: ${y}`);
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

// ══════════════════════════════════════════════════════════════════════════
// MARCO 1 · Massa de material: dois lotes novos + segundo material
// ══════════════════════════════════════════════════════════════════════════
async function abrirLote(lotId) {
  await abrir(`/estoque/lotes/${lotId}`, { espera: ".doc-title h1" });
}

async function liberarLotesPendentes(itemId) {
  const lotes = await lerLotesDoItem(itemId);
  const aguardando = lotes.filter((l) => l.status === "AWAITING_RELEASE");
  for (const lote of aguardando) {
    await abrirLote(lote.id);
    if (!(await existeBotao("Liberar"))) continue;
    await clicarBotao("Liberar");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(1200);
  }
  return aguardando.length;
}

async function criarOc(compra, itemNome) {
  await abrir("/compras/ordens/nova", { espera: "#po-supplier" });
  await escolherEntidade("#po-supplier", FORNECEDOR_NOME, FORNECEDOR_NOME);
  await preencher("#po-order-date", compra.recebidoEm);
  await clicarBotao("+ Adicionar item");
  await page.waitForTimeout(400);
  const combo = page.locator('input[id^="po-line-item-"]').first();
  await escolherEntidade(combo, itemNome, itemNome);
  const linha = page.locator("table.table tbody tr").first();
  const decimais = linha.locator('input[inputmode="decimal"]');
  await decimais.nth(0).fill(compra.quantidade);
  await decimais.nth(1).fill(compra.preco);
  await page.waitForTimeout(200);

  await clicarBotao("Salvar rascunho");
  const salvou = await esperarUrl((u) => /^\/compras\/ordens\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check(`OC ${compra.id} · rascunho salvo`, salvou, JSON.stringify(await mensagensDeErro()))) return null;
  await page.waitForTimeout(600);
  const codigo = await texto(".doc-title h1");
  await clicarBotao("Confirmar OC");
  await confirmarDialogo("Confirmar");
  await page.waitForTimeout(1200);
  return { code: codigo, url: caminho(), id: idDaUrl(caminho()) };
}

async function receberIntegral(oc, compra) {
  await abrir(oc.url, { espera: ".doc-title h1" });
  await clicarBotao("Receber materiais");
  await esperarUrl((u) => u.pathname === "/compras/recebimentos/novo", 25000);
  await page.waitForSelector('input[id^="receive-now-"]', { timeout: 30000 });
  await preencher("#receipt-date", compra.recebidoEm);
  await preencher("#receipt-invoice", `NF ${compra.nf}`);
  const campo = page.locator('input[id^="receive-now-"]').first();
  const poLineId = (await campo.getAttribute("id")).replace("receive-now-", "");
  await campo.fill(compra.quantidade);
  const loteFornecedor = page.locator(`#supplier-lot-${poLineId}`);
  if ((await loteFornecedor.count()) > 0) await loteFornecedor.fill(compra.loteFornecedor);
  const validade = page.locator(`#expiry-${poLineId}`);
  if ((await validade.count()) > 0) await validade.fill(compra.validade);
  const custo = page.locator(`#cost-${poLineId}`);
  if ((await custo.count()) > 0) await custo.fill(compra.preco);
  await page.waitForTimeout(200);
  await clicarBotao("Confirmar recebimento");
  await confirmarDialogo("Confirmar");
  return esperarUrl((u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
}

async function marco01Massa() {
  // ── Item e fornecedor da onda 1 ────────────────────────────────────────
  const mp = ((await apiGet(`/items?search=${encodeURIComponent(MP_NOME)}&pageSize=10`)).items ?? []).find(
    (i) => i.name === MP_NOME,
  );
  if (!check("MASSA · o item da onda 1 existe (MP-000327)", Boolean(mp), MP_NOME)) return;
  S.dados.mp = { id: mp.id, code: mp.code, unitCode: mp.unitCode };

  // ── Segundo material ───────────────────────────────────────────────────
  let mp2 = ((await apiGet(`/items?search=${encodeURIComponent(MP2.nome)}&pageSize=10`)).items ?? []).find(
    (i) => i.name === MP2.nome,
  );
  if (!mp2) {
    await abrir("/cadastros/itens/novo");
    await page.selectOption("#item-type", MP2.tipo);
    await page.selectOption("#item-unit", MP2.unidade);
    await preencher("#item-name", MP2.nome);
    const ligar = async (sel, ligado) => {
      const el = page.locator(sel);
      if ((await el.count()) === 0) return;
      if ((await el.isChecked()) !== ligado) await el.setChecked(ligado);
    };
    await ligar("#item-controls-lot", MP2.controlaLote);
    await ligar("#item-controls-expiry", MP2.controlaValidade);
    await ligar("#item-requires-quality-release", MP2.exigeLiberacao);
    await clicarBotao("Criar item");
    await esperarUrl((u) => u.pathname === "/cadastros/itens", 25000);
    mp2 = ((await apiGet(`/items?search=${encodeURIComponent(MP2.nome)}&pageSize=10`)).items ?? []).find(
      (i) => i.name === MP2.nome,
    );
  }
  if (!check("MASSA · o segundo material nasceu pela tela", Boolean(mp2), JSON.stringify(await mensagensDeErro()))) {
    return;
  }
  S.dados.mp2 = { id: mp2.id, code: mp2.code, unitCode: mp2.unitCode };
  salvarEstado();

  // ── Compras ────────────────────────────────────────────────────────────
  S.dados.ocs = S.dados.ocs ?? {};
  for (const compra of COMPRAS) {
    if (S.dados.ocs[compra.id]) {
      anotar(`OC ${compra.id} · ${S.dados.ocs[compra.id].code} já existia — pulada`);
      continue;
    }
    const nome = compra.item === "MP" ? MP_NOME : MP2.nome;
    const oc = await criarOc(compra, nome);
    if (!oc) return;
    const recebeu = await receberIntegral(oc, compra);
    if (!check(`RECEBIMENTO ${compra.id} · ${compra.quantidade} kg confirmados`, recebeu, JSON.stringify(await mensagensDeErro()))) {
      return;
    }
    S.dados.ocs[compra.id] = { ...oc, ...compra };
    salvarEstado();
  }

  // ── Liberação de qualidade dos lotes novos ─────────────────────────────
  await liberarLotesPendentes(S.dados.mp.id);
  await liberarLotesPendentes(S.dados.mp2.id);

  const lotesMp = await lerLotesDoItem(S.dados.mp.id);
  const elegiveis = lotesMp
    .filter((l) => l.status === "AVAILABLE" && !l.isExpired && num(l.available) > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  check(
    "MASSA · há pelo menos três lotes elegíveis do carbonato (FEFO precisa de mais de um)",
    elegiveis.length >= 3,
    JSON.stringify(elegiveis.map((l) => `${l.code}/${l.expiryDate}/${l.available}`)),
  );
  // O lote bloqueado desta execucao — pela caracteristica, nao pelo codigo.
  await resolverLoteBloqueado();
  const bloqueado = lotesMp.find((l) => l.code === LOTE_BLOQUEADO) ?? lotesMp.find((l) => l.status === "BLOCKED");
  check(
    `MASSA · há lote BLOQUEADO com físico > 0 (${bloqueado?.code ?? "nenhum"})`,
    bloqueado?.status === "BLOCKED" && num(bloqueado.onHand) > 0,
    JSON.stringify(lotesMp.map((l) => `${l.code}/${l.status}/${l.onHand}`)),
  );

  const lotesMp2 = await lerLotesDoItem(S.dados.mp2.id);
  check(
    "MASSA · o segundo material tem lote disponível",
    lotesMp2.some((l) => l.status === "AVAILABLE" && num(l.available) > 0),
    JSON.stringify(lotesMp2.map((l) => `${l.code}/${l.status}/${l.available}`)),
  );

  S.dados.elegiveisIniciais = elegiveis.map((l) => ({
    code: l.code,
    expiryDate: l.expiryDate,
    available: l.available,
  }));
  salvarEstado();
  anotar(
    `MASSA · elegíveis por validade: ${elegiveis.map((l) => `${l.code}(${l.expiryDate})=${l.available}`).join(" → ")}`,
  );
  await shot("adv-op-01-massa-material");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 2 · Produto e formulação de dois componentes, pela tela
// ══════════════════════════════════════════════════════════════════════════
const PRODUTO_NOME = `${P} Pedido Producao`;

async function marco02ProdutoEFormulacao() {
  if (!S.dados.produto) {
    /*
     * Cliente DESTA execucao. Pegar "o primeiro cadastrado" falha em base
     * recem-criada e, pior, numa base cheia amarra o produto a um cliente de
     * outra execucao — o teste deixa de dizer o que testou.
     */
    const nomeCliente = `${P} Cliente Producao LTDA`;
    let cliente = ((await apiGet(`/customers?search=${encodeURIComponent(P)}&pageSize=10`)).customers ?? [])
      .find((c) => c.legalName === nomeCliente);
    if (!cliente) {
      await abrir("/cadastros/clientes/novo", { espera: "#customer-legal-name" });
      await preencher("#customer-legal-name", nomeCliente);
      await preencher("#customer-cnpj", cnpjDoRun(RUN.runId, 11));
      await clicarBotao("Criar cliente");
      await page.waitForTimeout(2500);
      cliente = ((await apiGet(`/customers?search=${encodeURIComponent(P)}&pageSize=10`)).customers ?? [])
        .find((c) => c.legalName === nomeCliente);
    }
    if (!check("PRODUTO · cliente desta execução disponível", Boolean(cliente),
      JSON.stringify(await mensagensDeErro()))) return;
    await abrir("/cadastros/produtos/novo", { espera: "#product-name" });
    await escolherEntidade("#product-customer", cliente.code, cliente.code);
    await preencher("#product-name", PRODUTO_NOME);
    if ((await page.locator("#product-finished-unit").count()) > 0) {
      await page.selectOption("#product-finished-unit", "un");
    }
    // Lote mínimo real da planilha; vida útil dá validade sugerida ao lote.
    if ((await page.locator("#product-minimum-batch").count()) > 0) {
      await preencher("#product-minimum-batch", "1000");
    }
    if ((await page.locator("#product-shelf-life").count()) > 0) {
      await preencher("#product-shelf-life", "24");
    }
    await clicarBotao("Criar produto");
    await page.waitForTimeout(2500);
    const achado = ((await apiGet(`/products?search=${encodeURIComponent(PRODUTO_NOME)}&pageSize=10`)).products ?? [])
      .find((p) => p.name === PRODUTO_NOME);
    if (!check("PRODUTO · nasceu pela tela", Boolean(achado), JSON.stringify(await mensagensDeErro()))) return;
    S.dados.produto = { id: achado.id, code: achado.code, name: achado.name, customerId: cliente.id, customerCode: cliente.code };
    salvarEstado();
  }

  const produto = await apiGet(`/products/${S.dados.produto.id}`);
  S.dados.itemPa = {
    id: produto.finishedProductItemId,
    code: produto.finishedProductItem.code,
    unitCode: "un",
  };
  check(
    "PRODUTO · o item de produto acabado controla lote (pré-condição do apontamento)",
    produto.finishedProductItem.controlsLot === true,
    JSON.stringify(produto.finishedProductItem),
  );
  salvarEstado();

  if (!S.dados.formulacao) {
    await abrir(`/producao/formulacoes/${S.dados.produto.id}`, { espera: ".doc-title, .page__title" });
    await clicarBotao("Criar formulação em branco");
    const foi = await esperarUrl((u) => /\/versoes\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
    if (!check("FORMULAÇÃO · abriu com URL própria", foi, caminho())) return;
    await page.waitForSelector("#version-basis", { timeout: 25000 });
    await preencher("#version-basis", BASE_FORMULACAO);

    for (const [item, qtd] of [
      [S.dados.mp, QTD_MP],
      [S.dados.mp2, QTD_MP2],
    ]) {
      await clicarBotao("+ Adicionar componente");
      await page.waitForTimeout(500);
      const vazio = page.locator('input[id^="componente-"]').last();
      await escolherEntidade(vazio, item.code, item.code);
      await page.waitForTimeout(600);
      await preencher(`input[aria-label="Quantidade de ${item.code}"]`, qtd);
      await page.waitForTimeout(300);
    }

    await clicarBotao("Salvar rascunho");
    await page.waitForTimeout(2500);
    await clicarBotao("Ativar versão");
    await confirmarDialogo("Ativar");
    await page.waitForTimeout(2500);
    const ativa = ((await apiGet(`/products/${S.dados.produto.id}/formulations`)).versions ?? []).find(
      (v) => v.status === "ACTIVE",
    );
    if (!check("FORMULAÇÃO · versão ativada com os dois componentes", Boolean(ativa), JSON.stringify(await mensagensDeErro()))) {
      return;
    }
    S.dados.formulacao = { versionId: ativa.id, label: ativa.versionLabel };
    salvarEstado();
  }
  anotar(
    `FORMULAÇÃO · base ${BASE_FORMULACAO} un · ${S.dados.mp.code}=${QTD_MP} kg · ${S.dados.mp2.code}=${QTD_MP2} kg`,
  );
  await shot("adv-op-02-formulacao");
}

// ══════════════════════════════════════════════════════════════════════════
// Pedido — helpers
// ══════════════════════════════════════════════════════════════════════════
async function criarPedido(chave, quantidade) {
  S.dados.pedidos = S.dados.pedidos ?? {};
  if (S.dados.pedidos[chave]) return S.dados.pedidos[chave];

  await abrir("/comercial/pedidos/novo", { espera: "#co-customer" });
  await escolherEntidade("#co-customer", S.dados.produto.customerCode, S.dados.produto.customerCode);
  await clicarBotao("+ Adicionar produto");
  await page.waitForTimeout(500);
  const combo = page.locator('input[id^="pedido-produto-"]').first();
  await escolherEntidade(combo, S.dados.produto.code, S.dados.produto.code);
  await page.waitForTimeout(600);
  await preencher(`input[aria-label="Quantidade de ${S.dados.produto.code}"]`, String(quantidade));
  await page.waitForTimeout(200);
  await clicarBotao("Salvar rascunho");
  const salvou = await esperarUrl((u) => /^\/comercial\/pedidos\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check(`PEDIDO ${chave} · rascunho salvo`, salvou, JSON.stringify(await mensagensDeErro()))) return null;
  await page.waitForTimeout(800);
  const registro = { chave, code: await texto(".doc-title h1"), url: caminho(), id: idDaUrl(caminho()), quantidade };
  S.dados.pedidos[chave] = registro;
  salvarEstado();
  return registro;
}

async function confirmarPedido(registro) {
  await abrir(registro.url, { espera: ".doc-title h1" });
  if (await existeBotao("Confirmar pedido")) {
    await clicarBotao("Confirmar pedido");
    await confirmarDialogo("Confirmar");
    await page.waitForTimeout(1800);
  }
  const ped = await lerPedido(registro.id);
  return ped.status;
}

/** Lê a tabela do Plano de Atendimento como está na tela. */
async function lerPlanoDaTela() {
  return page.evaluate(() => {
    const secao = [...document.querySelectorAll("section.form-section")].find((s) =>
      (s.querySelector("h3")?.textContent ?? "").includes("Plano de Atendimento"),
    );
    if (!secao) return null;
    const tabela = secao.querySelector("table");
    if (!tabela) return null;
    return [...tabela.querySelectorAll("tbody tr")].map((tr) => {
      const celulas = [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim());
      const inputs = [...tr.querySelectorAll("input")].map((i) => i.value);
      return { celulas, reservar: inputs[0] ?? null, produzir: inputs[1] ?? null };
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 3 · Pedido 1 — estoque ZERO, produção integral
// ══════════════════════════════════════════════════════════════════════════
async function marco03PedidoEstoqueZero() {
  const pa = await lerLotesDoItem(S.dados.itemPa.id);
  const disponivelPa = pa.reduce((a, l) => a + num(l.available), 0);
  check(
    "PEDIDO-1 · pré-condição: nenhum produto acabado em estoque",
    disponivelPa === 0,
    JSON.stringify(pa.map((l) => `${l.code}=${l.available}`)),
  );

  const ped = await criarPedido("P1", PED1_QTD);
  if (!ped) return;
  const situacao = await confirmarPedido(ped);
  if (!check("PEDIDO-1 · confirmado", situacao === "CONFIRMED", situacao)) return;

  await abrir(ped.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(2500);
  const plano = await lerPlanoDaTela();
  const linha = plano?.[0];
  const okPlano = linha && num(linha.reservar) === 0 && num(linha.produzir) === PED1_QTD;
  registrarCaso("PEDIDO-1 · cobertura com estoque ZERO", {
    pre: `produto ${S.dados.produto.code} sem nenhum lote de produto acabado; pedido de ${PED1_QTD} un`,
    acao: "confirmar o pedido e abrir o Plano de Atendimento",
    esperado: `Reservar = 0 e Produzir = ${PED1_QTD} — estoque primeiro, e não há estoque`,
    real: JSON.stringify(linha),
    invariante: "plano é projeção: nada reservado, nenhuma OP criada antes de aplicar",
    veredito: okPlano ? "PASS" : "FAIL",
  });
  check("PEDIDO-1 · o plano propôs produzir tudo", Boolean(okPlano), JSON.stringify(linha));
  await shot("adv-pedido-plano-estoque-zero");

  const antesDeAplicar = await fotografar("antes de aplicar o plano 1");
  check(
    "PEDIDO-1 · antes de aplicar, o plano não escreveu nada (projeção pura)",
    (await lerPedido(ped.id)).status === "CONFIRMED",
    JSON.stringify(antesDeAplicar.pedidos),
  );

  if (!S.dados.p1Aplicado) {
    await clicarBotao("Aplicar Plano de Atendimento");
    await confirmarDialogo("Aplicar Plano");
    await page.waitForTimeout(3000);
    S.dados.p1Aplicado = true;
    salvarEstado();
  }

  const depois = await lerPedido(ped.id);
  const opsGeradas = depois.generatedProductionOrders ?? [];
  check("PEDIDO-1 · virou Em atendimento", depois.status === "IN_FULFILLMENT", depois.status);
  check("PEDIDO-1 · gerou exatamente uma OP", opsGeradas.length === 1, JSON.stringify(opsGeradas.map((o) => o.code)));
  const reservasAtivas = (depois.reservations ?? []).filter((r) => r.status === "ACTIVE");
  check(
    "PEDIDO-1 · não reservou produto acabado (não havia o que reservar)",
    reservasAtivas.length === 0 || (reservasAtivas[0].lines ?? []).length === 0,
    JSON.stringify(reservasAtivas.map((r) => r.status)),
  );

  if (opsGeradas.length !== 1) return;
  S.dados.ops = S.dados.ops ?? {};
  S.dados.ops.OP1 = {
    id: opsGeradas[0].id,
    code: opsGeradas[0].code,
    url: `/producao/ordens/${opsGeradas[0].id}`,
  };
  salvarEstado();

  const op = await lerOp(S.dados.ops.OP1.id);
  check("PEDIDO-1 · a OP nasceu em Rascunho (nunca pula PLAN/RELEASE)", op.status === "DRAFT", op.status);
  check(
    "PEDIDO-1 · a OP nasceu vinculada ao pedido",
    op.customerOrderId === ped.id,
    `${op.customerOrderCode} vs ${ped.code}`,
  );
  check(
    `PEDIDO-1 · a OP planeja ${PED1_QTD} un`,
    perto(op.plannedQuantity, PED1_QTD),
    op.plannedQuantity,
  );
  anotar(`PEDIDO-1 · ${ped.code} → ${op.code} (${op.plannedQuantity} un, ${op.status})`);
  await shot("adv-pedido-aplicado-producao-integral");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 4 · Liberação da OP — a regra do reservado
// ══════════════════════════════════════════════════════════════════════════
async function marco04LiberacaoDaOp() {
  const registro = S.dados.ops.OP1;
  const antes = {};
  for (const it of [S.dados.mp, S.dados.mp2]) antes[it.code] = await lerLotesDoItem(it.id);

  // Congela a lista de elegíveis ANTES da reserva: depois dela os mesmos
  // lotes ficam com disponível zero, e uma reexecução perderia a referência.
  if (!S.dados.elegiveisAntesDaReserva) {
    S.dados.elegiveisAntesDaReserva = antes[S.dados.mp.code]
      .filter((l) => l.status === "AVAILABLE" && !l.isExpired && num(l.available) > 0)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
      .map((l) => ({ code: l.code, expiryDate: l.expiryDate, available: l.available }));
    salvarEstado();
  }
  const elegiveis = S.dados.elegiveisAntesDaReserva;

  await abrir(registro.url, { espera: ".doc-title h1" });
  if (await existeBotao("Planejar OP")) {
    await clicarBotao("Planejar OP");
    await page.waitForTimeout(2500);
  }
  let op = await lerOp(registro.id);
  check("OP · Rascunho → Planejada pela tela", ["PLANNED", "RELEASED", "IN_PRODUCTION", "COMPLETED"].includes(op.status), op.status);

  const reqMp = op.requirements.find((r) => r.itemCode === S.dados.mp.code);
  const reqMp2 = op.requirements.find((r) => r.itemCode === S.dados.mp2.code);
  check(
    `OP · a necessidade de ${S.dados.mp.code} é ${QTD_MP} kg (base ${BASE_FORMULACAO} · OP ${PED1_QTD})`,
    perto(reqMp?.requiredQuantity, QTD_MP),
    reqMp?.requiredQuantity,
  );
  check(
    `OP · a necessidade de ${S.dados.mp2.code} é ${QTD_MP2} kg`,
    perto(reqMp2?.requiredQuantity, QTD_MP2),
    reqMp2?.requiredQuantity,
  );
  S.dados.necessidades = { mp: reqMp?.requiredQuantity, mp2: reqMp2?.requiredQuantity };
  salvarEstado();

  await abrir(registro.url, { espera: ".doc-title h1" });
  if (await existeBotao("Liberar OP")) {
    await clicarBotao("Liberar OP");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(3000);
  }
  op = await lerOp(registro.id);
  if (!check("OP · Planejada → Liberada pela tela", ["RELEASED", "IN_PRODUCTION", "COMPLETED"].includes(op.status), op.status)) {
    anotar(`OP · mensagens na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }

  const depois = {};
  for (const it of [S.dados.mp, S.dados.mp2]) depois[it.code] = await lerLotesDoItem(it.id);

  // ── A regra: físico permanece, reservado sobe, disponível cai ──────────
  const relatorio = [];
  let fisicoIntacto = true;
  let reservadoSubiu = false;
  let disponivelCaiu = false;
  for (const code of Object.keys(antes)) {
    for (const l of antes[code]) {
      const o = depois[code].find((x) => x.code === l.code);
      if (!o) continue;
      if (String(l.onHand) !== String(o.onHand)) fisicoIntacto = false;
      if (num(o.reserved) > num(l.reserved)) reservadoSubiu = true;
      if (num(o.available) < num(l.available)) disponivelCaiu = true;
      if (String(l.reserved) !== String(o.reserved) || String(l.available) !== String(o.available)) {
        relatorio.push(
          `${l.code}: físico ${l.onHand}→${o.onHand} · reservado ${l.reserved}→${o.reserved} · disponível ${l.available}→${o.available}`,
        );
      }
    }
  }

  registrarCaso("OP-1 · liberação reserva material sem mover o físico", {
    pre: `OP ${registro.code} Planejada, necessidade ${QTD_MP} kg + ${QTD_MP2} kg`,
    acao: "Liberar OP na tela da ordem",
    esperado: "físico permanece, reservado sobe, disponível cai — reserva não é consumo",
    real: relatorio.join(" | ") || "(nenhum lote mudou)",
    invariante: "nenhum InventoryMovement nasce da liberação",
    veredito: fisicoIntacto && reservadoSubiu && disponivelCaiu ? "PASS" : "FAIL",
  });
  check("OP · liberar NÃO moveu estoque físico", fisicoIntacto, relatorio.join(" | "));
  check("OP · liberar SUBIU o reservado", reservadoSubiu, relatorio.join(" | "));
  check("OP · liberar BAIXOU o disponível", disponivelCaiu, relatorio.join(" | "));

  const movimentosDepois = await lerMovimentos(S.dados.mp.id);
  S.dados.movimentosAposLiberacao = movimentosDepois.length;
  salvarEstado();

  // ── FEFO na reserva ────────────────────────────────────────────────────
  const linhasMp = (op.reservation?.lines ?? []).filter((l) => l.itemCode === S.dados.mp.code);
  const ordemReservada = linhasMp.map((l) => l.lotCode);
  const esperadaFefo = [];
  let restante = num(QTD_MP);
  for (const e of elegiveis) {
    if (restante <= 1e-9) break;
    esperadaFefo.push(e.code);
    restante -= Math.min(restante, num(e.available));
  }
  const usouBloqueado = ordemReservada.includes(LOTE_BLOQUEADO);
  const vencidos = antes[S.dados.mp.code].filter((l) => l.isExpired).map((l) => l.code);
  const usouVencido = ordemReservada.some((c) => vencidos.includes(c));
  const fefoOk = JSON.stringify(ordemReservada) === JSON.stringify(esperadaFefo) && !usouBloqueado && !usouVencido;

  registrarCaso("OP-1 · FEFO na reserva de materiais", {
    pre: `elegíveis por validade: ${elegiveis.map((l) => `${l.code}(${l.expiryDate})=${l.available}`).join(" → ")}`,
    acao: `reservar ${QTD_MP} kg ao liberar a OP`,
    esperado: `atravessa ${esperadaFefo.join(" → ")}; nunca o bloqueado ${LOTE_BLOQUEADO} nem os vencidos`,
    real: JSON.stringify(linhasMp.map((l) => `${l.lotCode}=${l.quantity}`)),
    invariante: "vence primeiro, sai primeiro; lote inelegível não entra na reserva",
    veredito: fefoOk ? "PASS" : "FAIL",
  });
  check("FEFO · a reserva atravessou os lotes na ordem de validade", fefoOk, JSON.stringify(ordemReservada));
  check("FEFO · a reserva ignorou o lote BLOQUEADO e os VENCIDOS", !usouBloqueado && !usouVencido, JSON.stringify(ordemReservada));
  check(
    "FEFO · a reserva cobre exatamente a necessidade",
    perto(linhasMp.reduce((a, l) => a + num(l.quantity), 0), QTD_MP),
    JSON.stringify(linhasMp.map((l) => l.quantity)),
  );

  S.dados.fefoEsperado = esperadaFefo;
  salvarEstado();
  await shot("adv-op-liberada-reserva");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 5 · Separação: FEFO conferido, lote bloqueado recusado, escolha manual
// ══════════════════════════════════════════════════════════════════════════
/** Linhas ativas de reserva (não substituídas), como a tela usa. */
function linhasAtivas(op) {
  return (op.reservation?.lines ?? []).filter((l) => l.releasedAt === null);
}

async function abrirScannerDaLinha(lotCode) {
  await abrir(S.dados.ops.OP1.url, { espera: ".doc-title h1" });
  const linha = page.locator("section.form-section", { has: page.locator("h3", { hasText: "Picking" }) })
    .locator("table tbody tr")
    .filter({ hasText: lotCode })
    .first();
  const botao = linha.getByRole("button", { name: "Escanear / Informar lote", exact: true });
  if ((await botao.count()) === 0) return false;
  await botao.click();
  await page.waitForTimeout(700);
  return (await page.locator("#lot-scanner-manual").count()) > 0;
}

async function informarLote(codigo) {
  await preencher("#lot-scanner-manual", codigo);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.waitForTimeout(1800);
}

async function marco05Separacao() {
  const registro = S.dados.ops.OP1;
  let op = await lerOp(registro.id);
  const linhasMp = linhasAtivas(op).filter((l) => l.itemCode === S.dados.mp.code);
  const [linhaPrimeira, linhaSegunda] = linhasMp;
  if (!check("PICKING · a reserva do carbonato tem duas linhas (FEFO atravessou lotes)", linhasMp.length === 2, JSON.stringify(linhasMp.map((l) => l.lotCode)))) {
    return;
  }

  // ── Proibido 7: lote BLOQUEADO no picking ──────────────────────────────
  if (!S.dados.provaLoteBloqueado) {
    const lotes = await lerLotesDoItem(S.dados.mp.id);
    const bloqueado = lotes.find((l) => l.code === LOTE_BLOQUEADO);
    await caminhoProibido(
      "PROIBIDO-7 · selecionar lote BLOQUEADO na separação",
      {
        pre: `linha de picking esperando ${linhaSegunda.lotCode}; lote ${LOTE_BLOQUEADO} bloqueado com ${bloqueado?.onHand} kg físicos`,
        acao: `informar ${LOTE_BLOQUEADO} no scanner e confirmar “Usar lote diferente”`,
        esperado: "recusa; material bloqueado não entra em produção nem por substituição",
        invariante: "a linha continua apontando para o lote original e o bloqueado não é tocado",
      },
      async () => {
        const abriu = await abrirScannerDaLinha(linhaSegunda.lotCode);
        if (!abriu) return "(a tela não ofereceu o scanner nesta linha)";
        await informarLote(LOTE_BLOQUEADO);
        const dialogo = page.locator("#mismatch-title");
        if ((await dialogo.count()) === 0) {
          return `sem diálogo de divergência — mensagens: ${JSON.stringify(await mensagensDeErro())}`;
        }
        await confirmarModal("Usar lote diferente");
        await page.waitForTimeout(2200);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    await shot("adv-op-picking-lote-bloqueado");
    S.dados.provaLoteBloqueado = true;
    salvarEstado();
  }

  // ── Regra a observar: escolha manual FORA da ordem FEFO ────────────────
  if (!S.dados.provaForaDeFefo) {
    const lotes = await lerLotesDoItem(S.dados.mp.id);
    const foraDeFefo = lotes
      .filter(
        (l) =>
          l.status === "AVAILABLE" &&
          !l.isExpired &&
          num(l.available) >= num(linhaSegunda.quantity) &&
          l.code !== linhaSegunda.lotCode &&
          l.code !== linhaPrimeira.lotCode,
      )
      .sort((a, b) => b.expiryDate.localeCompare(a.expiryDate))[0];

    if (!foraDeFefo) {
      anotar("FEFO MANUAL · não havia lote elegível fora da ordem FEFO para testar a escolha manual");
    } else {
      const antes = await fotografar("antes da escolha manual");
      let mensagem = "(scanner não abriu)";
      // Informar um lote diferente do reservado devolve 409 de propósito — é
      // o que abre o diálogo de divergência. Sem a janela deliberada, esse
      // 409 entraria no relatório como falha que não era para acontecer.
      await deliberadamente("REGRA · escolha manual fora de FEFO", async () => {
        const abriu = await abrirScannerDaLinha(linhaSegunda.lotCode);
        if (!abriu) return;
        await informarLote(foraDeFefo.code);
        if ((await page.locator("#mismatch-title").count()) > 0) {
          await confirmarModal("Usar lote diferente");
          await page.waitForTimeout(2400);
        }
        mensagem = JSON.stringify(await mensagensDeErro());
      });
      const depoisOp = await lerOp(registro.id);
      const novas = (depoisOp.reservation?.lines ?? []).filter((l) => l.replacesLineId !== null);
      const substituida = (depoisOp.reservation?.lines ?? []).find((l) => l.id === linhaSegunda.id);
      const permitido = novas.some((l) => l.lotCode === foraDeFefo.code);
      const auditavel =
        permitido &&
        Boolean(substituida?.releasedAt) &&
        Boolean(substituida?.releaseReason) &&
        novas.some((l) => l.lotCode === foraDeFefo.code && Boolean(l.pickedBy));

      registrarCaso("REGRA · escolha manual de lote FORA da ordem FEFO", {
        pre: `linha reservada em ${linhaSegunda.lotCode} (validade ${elegivelValidade(antes, linhaSegunda.lotCode)}); operador informa ${foraDeFefo.code} (validade ${foraDeFefo.expiryDate}, mais distante)`,
        acao: "informar o lote diferente no scanner e confirmar “Usar lote diferente”",
        esperado: "o domínio decide: ou recusa, ou permite deixando rastro de quem trocou, quando e por quê",
        real: permitido
          ? `PERMITIDO — linha original marcada liberada (${substituida?.releaseReason}) e linha nova em ${foraDeFefo.code} com replacesLineId e pickedBy`
          : `RECUSADO — ${mensagem}`,
        invariante: "físico não muda; a linha original nunca é apagada",
        veredito: !permitido || auditavel ? "PASS" : "FAIL",
      });
      check(
        "FEFO MANUAL · se o domínio permite trocar o lote, a troca fica auditável",
        !permitido || auditavel,
        JSON.stringify({ permitido, releaseReason: substituida?.releaseReason, replaces: novas.map((l) => l.lotCode) }),
      );
      if (permitido) {
        anotar(
          `FEFO MANUAL · troca permitida e registrada: ${linhaSegunda.lotCode} → ${foraDeFefo.code}, motivo "${substituida?.releaseReason}"`,
        );
      }
      S.dados.loteManual = foraDeFefo.code;
      await shot("adv-op-picking-fora-de-fefo");
    }
    S.dados.provaForaDeFefo = true;
    salvarEstado();
  }

  // ── Conferência das linhas que faltam ──────────────────────────────────
  for (let volta = 0; volta < 8; volta += 1) {
    op = await lerOp(registro.id);
    const pendente = linhasAtivas(op).find((l) => l.pickingStatus !== "CONFIRMED");
    if (!pendente) break;
    if (!pendente.lotCode) {
      await abrir(registro.url, { espera: ".doc-title h1" });
      const linha = page
        .locator("section.form-section", { has: page.locator("h3", { hasText: "Picking" }) })
        .locator("table tbody tr")
        .filter({ hasText: pendente.itemCode })
        .first();
      await linha.getByRole("button", { name: "Confirmar separação", exact: true }).click();
      await page.waitForTimeout(2000);
      continue;
    }
    const abriu = await abrirScannerDaLinha(pendente.lotCode);
    if (!abriu) break;
    await informarLote(pendente.lotCode);
  }

  op = await lerOp(registro.id);
  const restaPendente = linhasAtivas(op).filter((l) => l.pickingStatus !== "CONFIRMED");
  check(
    "PICKING · todas as linhas ativas foram conferidas fisicamente",
    restaPendente.length === 0,
    JSON.stringify(restaPendente.map((l) => `${l.itemCode}/${l.lotCode}`)),
  );

  const lotesDepois = await lerLotesDoItem(S.dados.mp.id);
  const movimentos = await lerMovimentos(S.dados.mp.id);
  check(
    "PICKING · conferir separação NÃO movimentou estoque",
    movimentos.length === S.dados.movimentosAposLiberacao,
    `${S.dados.movimentosAposLiberacao} → ${movimentos.length}`,
  );
  anotar(`PICKING · linhas ativas: ${linhasAtivas(op).map((l) => `${l.itemCode}@${l.lotCode ?? "—"}=${l.quantity}`).join(" | ")}`);
  void lotesDepois;
  await shot("adv-op-picking-conferido");
}

function elegivelValidade(foto, code) {
  for (const item of Object.values(foto.itens)) {
    const l = item.lotes.find((x) => x.code === code);
    if (l) return l.expiryDate;
  }
  return "?";
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 6 · Consumo real: duplo clique, F5, extra sem motivo, acima do necessário
// ══════════════════════════════════════════════════════════════════════════
function secaoConsumo() {
  return page.locator("section.form-section").filter({ has: page.locator("h3", { hasText: "Consumo Real" }) });
}

/**
 * A linha de "Consumo Real" de um lote.
 *
 * Uma ampliação de reserva cria uma SEGUNDA linha no mesmo lote, e as duas
 * casam com o código. `.line-audit` só existe na ampliada — é o que separa
 * as duas sem depender da ordem das linhas na tabela.
 */
function linhaDeConsumo(lotCode, { extra = false } = {}) {
  const linhas = secaoConsumo().locator("table tbody tr").filter({ hasText: lotCode });
  return extra
    ? linhas.filter({ has: page.locator(".line-audit") }).first()
    : linhas.filter({ hasNot: page.locator(".line-audit") }).first();
}

async function marco06ConsumoReal() {
  const registro = S.dados.ops.OP1;
  let op = await lerOp(registro.id);
  const linhas = linhasAtivas(op).filter((l) => l.itemCode === S.dados.mp.code);
  const primeira = linhas[0];

  // ── Proibido 8: duplo clique em confirmar consumo ──────────────────────
  if (!S.dados.provaDuploClique) {
    const antesLotes = await lerLotesDoItem(S.dados.mp.id);
    const antesMov = (await lerMovimentos(S.dados.mp.id)).length;
    await abrir(registro.url, { espera: ".doc-title h1" });
    const linha = linhaDeConsumo(primeira.lotCode);
    await linha.locator('input[inputmode="decimal"]').first().fill(primeira.quantity);
    await page.waitForTimeout(300);
    const botao = linha.getByRole("button", { name: "Confirmar consumo", exact: true });
    await deliberadamente("PROIBIDO-8", async () => {
      await botao.click({ force: true });
      await botao.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(3200);
    });

    op = await lerOp(registro.id);
    const consumosDoLote = op.consumptions.filter((c) => c.lotCode === primeira.lotCode);
    const depoisLotes = await lerLotesDoItem(S.dados.mp.id);
    const depoisMov = (await lerMovimentos(S.dados.mp.id)).length;
    const loteAntes = antesLotes.find((l) => l.code === primeira.lotCode);
    const loteDepois = depoisLotes.find((l) => l.code === primeira.lotCode);
    const baixouUmaVez = perto(num(loteAntes.onHand) - num(loteDepois.onHand), primeira.quantity);
    const umMovimento = depoisMov === antesMov + 1;

    registrarCaso("PROIBIDO-8 · duplo clique em “Confirmar consumo”", {
      pre: `linha ${primeira.lotCode} com ${primeira.quantity} kg reservados, físico ${loteAntes.onHand}`,
      acao: "clicar duas vezes seguidas em Confirmar consumo, sem esperar a resposta",
      esperado: "um único consumo; o segundo clique não pode duplicar a baixa",
      real: `${consumosDoLote.length} consumo(s) no lote · movimentos ${antesMov}→${depoisMov} · físico ${loteAntes.onHand}→${loteDepois.onHand}`,
      invariante: "a quantidade sai do estoque exatamente uma vez",
      veredito: consumosDoLote.length === 1 && umMovimento && baixouUmaVez ? "BLOCKED_CORRECTLY" : "BUG",
    });
    registrarNegativo(
      "PROIBIDO-8 · duplo clique em confirmar consumo",
      consumosDoLote.length === 1 && umMovimento && baixouUmaVez ? "BLOCKED_CORRECTLY" : "BUG",
      `consumos=${consumosDoLote.length} movimentos=${antesMov}→${depoisMov} físico=${loteAntes.onHand}→${loteDepois.onHand}`,
    );
    check(
      "NEGATIVO · o duplo clique não duplicou o consumo",
      consumosDoLote.length === 1 && umMovimento && baixouUmaVez,
      `consumos=${consumosDoLote.length} mov=${antesMov}→${depoisMov}`,
    );
    S.dados.provaDuploClique = { consumos: consumosDoLote.length, movimentos: [antesMov, depoisMov] };
    salvarEstado();
    await shot("adv-op-consumo-duplo-clique");
  }

  // ── Proibido 9: F5 depois do consumo ───────────────────────────────────
  if (!S.dados.provaF5) {
    const antesLotes = await lerLotesDoItem(S.dados.mp.id);
    const antesMov = (await lerMovimentos(S.dados.mp.id)).length;
    const antesOp = await lerOp(registro.id);
    await abrir(registro.url, { espera: ".doc-title h1" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const depoisLotes = await lerLotesDoItem(S.dados.mp.id);
    const depoisMov = (await lerMovimentos(S.dados.mp.id)).length;
    const depoisOp = await lerOp(registro.id);
    const igual =
      antesMov === depoisMov &&
      antesOp.consumptions.length === depoisOp.consumptions.length &&
      antesLotes.every((l) => String(l.onHand) === String(depoisLotes.find((x) => x.code === l.code)?.onHand));

    registrarCaso("PROIBIDO-9 · F5 logo depois do consumo", {
      pre: `consumo de ${primeira.quantity} kg em ${primeira.lotCode} acabou de ser confirmado`,
      acao: "recarregar a página da OP (F5)",
      esperado: "a quantidade permanece exatamente uma vez; nada é reenviado",
      real: `consumos ${antesOp.consumptions.length}→${depoisOp.consumptions.length} · movimentos ${antesMov}→${depoisMov}`,
      invariante: "recarregar é leitura; nenhuma escrita nasce de um F5",
      veredito: igual ? "BLOCKED_CORRECTLY" : "BUG",
    });
    registrarNegativo("PROIBIDO-9 · F5 depois do consumo", igual ? "BLOCKED_CORRECTLY" : "BUG", `movimentos ${antesMov}→${depoisMov}`);
    check("NEGATIVO · o F5 não repetiu o consumo", igual, `mov ${antesMov}→${depoisMov}`);
    S.dados.provaF5 = true;
    salvarEstado();
    await shot("adv-op-consumo-f5");
  }

  // ── Proibido 6: consumo extra SEM motivo ───────────────────────────────
  if (!S.dados.provaExtraSemMotivo) {
    op = await lerOp(registro.id);
    const alvo = linhasAtivas(op).find((l) => l.itemCode === S.dados.mp.code && l.pickingStatus === "CONFIRMED");
    await caminhoProibido(
      "PROIBIDO-6 · consumo extra SEM motivo",
      {
        pre: `linha ${alvo.lotCode} conferida; ampliar reserva exige justificativa`,
        acao: "abrir “Adicionar consumo extra”, informar quantidade e deixar o motivo em branco",
        esperado: "recusa; ampliar reserva sem motivo não é pedido incompleto, é pedido diferente",
        invariante: "nenhuma linha de reserva nova, nenhum consumo, físico intacto",
      },
      async () => {
        await abrir(registro.url, { espera: ".doc-title h1" });
        const linha = linhaDeConsumo(alvo.lotCode);
        const botao = linha.getByRole("button", { name: "Adicionar consumo extra", exact: true });
        if ((await botao.count()) === 0) return "(a tela não ofereceu “Adicionar consumo extra”)";
        await botao.click();
        await page.waitForSelector("#extra-quantity", { timeout: 20000 });
        await preencher("#extra-quantity", "0.2");
        await page.locator("#extra-reason").fill("");
        await page.waitForTimeout(300);
        const enviar = page.locator('button[type="submit"][form="extra-consumption-form"]');
        if (await enviar.isDisabled()) {
          await page.keyboard.press("Escape");
          return "o botão de confirmar do diálogo fica DESABILITADO com o motivo em branco";
        }
        await enviar.click();
        await page.waitForTimeout(2400);
        const msg = JSON.stringify(await mensagensDeErro());
        await page.keyboard.press("Escape");
        return msg;
      },
    );
    S.dados.provaExtraSemMotivo = true;
    salvarEstado();
    await shot("adv-op-consumo-extra-sem-motivo");
  }

  // ── Consumo das linhas restantes do carbonato (fecha a necessidade) ────
  for (let volta = 0; volta < 5; volta += 1) {
    op = await lerOp(registro.id);
    const req = op.requirements.find((r) => r.itemCode === S.dados.mp.code);
    if (num(req.consumedQuantity) >= num(req.requiredQuantity) - 1e-9) break;
    const pendente = linhasAtivas(op).find(
      (l) => l.itemCode === S.dados.mp.code && !l.extraReason && num(l.remainingQuantity) > 0,
    );
    if (!pendente) break;
    await abrir(registro.url, { espera: ".doc-title h1" });
    const linha = linhaDeConsumo(pendente.lotCode);
    await linha.locator('input[inputmode="decimal"]').first().fill(pendente.remainingQuantity);
    await page.waitForTimeout(300);
    await linha.getByRole("button", { name: "Confirmar consumo", exact: true }).click();
    await page.waitForTimeout(3000);
  }
  op = await lerOp(registro.id);
  const reqMp = op.requirements.find((r) => r.itemCode === S.dados.mp.code);
  check(
    `CONSUMO · ${S.dados.mp.code} chegou à necessidade completa (${QTD_MP} kg)`,
    num(reqMp.consumedQuantity) >= num(QTD_MP) - 1e-9,
    reqMp.consumedQuantity,
  );
  check(
    `CONSUMO · ${S.dados.mp.code} ficou Reconciliado`,
    reqMp.reconciliationStatus === "RECONCILED",
    reqMp.reconciliationStatus,
  );

  // ── Regra: consumo ACIMA do necessário baixa o REAL ────────────────────
  if (!S.dados.provaAcimaDoNecessario) {
    const extra = "0.5";
    const antesLotes = await lerLotesDoItem(S.dados.mp.id);
    const antesConsumido = num(reqMp.consumedQuantity);
    op = await lerOp(registro.id);
    const alvo = linhasAtivas(op).find((l) => l.itemCode === S.dados.mp.code && l.pickingStatus === "CONFIRMED");

    // Numa reexecução a ampliação já pode existir: criar outra dobraria a
    // quantidade e o caso passaria a medir um erro do roteiro.
    if (!(op.reservation?.lines ?? []).some((l) => l.extraReason && l.releasedAt === null)) {
      await abrir(registro.url, { espera: ".doc-title h1" });
      const linha = linhaDeConsumo(alvo.lotCode);
      await linha.getByRole("button", { name: "Adicionar consumo extra", exact: true }).click();
      await page.waitForSelector("#extra-quantity", { timeout: 20000 });
      await preencher("#extra-quantity", extra);
      await preencher("#extra-reason", "ADV perda de pesagem no funil de carga");
      await page.waitForTimeout(300);
      await page.locator('button[type="submit"][form="extra-consumption-form"]').click();
      await page.waitForTimeout(2800);
    }

    op = await lerOp(registro.id);
    const linhaExtra = (op.reservation?.lines ?? []).find((l) => l.extraReason && l.releasedAt === null);
    let consumiuExtra = linhaExtra ? num(linhaExtra.consumedQuantity) > 0 : false;
    if (linhaExtra && num(linhaExtra.remainingQuantity) > 0) {
      await abrir(registro.url, { espera: ".doc-title h1" });
      /*
       * `hasText: "Consumo extra"` casaria com TODAS as linhas: o botão
       * "Adicionar consumo extra" existe em cada uma e o casamento é por
       * substring, sem diferenciar maiúscula. A linha ampliada é a única com
       * o bloco de auditoria `.line-audit`.
       */
      const alvoExtra = secaoConsumo()
        .locator("table tbody tr")
        .filter({ has: page.locator(".line-audit") })
        .first();
      await alvoExtra.locator('input[inputmode="decimal"]').first().fill(extra);
      await page.waitForTimeout(300);
      await alvoExtra.getByRole("button", { name: "Confirmar consumo", exact: true }).click();
      await page.waitForTimeout(3000);
      consumiuExtra = true;
    }

    op = await lerOp(registro.id);
    const depoisLotes = await lerLotesDoItem(S.dados.mp.id);
    const reqDepois = op.requirements.find((r) => r.itemCode === S.dados.mp.code);
    const baixaTotal = antesLotes.reduce((a, l) => a + num(l.onHand), 0) - depoisLotes.reduce((a, l) => a + num(l.onHand), 0);
    const consumidoAgora = num(reqDepois.consumedQuantity);
    const baixouOReal = perto(baixaTotal, consumidoAgora - antesConsumido, 1e-6);
    const acimaDoNecessario = consumidoAgora > num(reqDepois.requiredQuantity);

    registrarCaso("REGRA · consumo ACIMA do necessário baixa o REAL, não o planejado", {
      pre: `${S.dados.mp.code}: necessário ${reqDepois.requiredQuantity} kg, já consumido ${antesConsumido} kg`,
      acao: `ampliar a reserva em ${extra} kg com motivo e confirmar o consumo dessa linha`,
      esperado: "o estoque baixa a quantidade REAL consumida, não a planejada",
      real: `consumido ${consumidoAgora} kg · baixa física no período ${baixaTotal.toFixed(6)} kg · situação ${reqDepois.reconciliationStatus}`,
      invariante: "necessidade e consumo são números distintos; o estoque segue o consumo",
      veredito: consumiuExtra && baixouOReal && acimaDoNecessario ? "PASS" : "FAIL",
    });
    check(
      "REGRA · a baixa física acompanhou o consumo REAL (acima do necessário)",
      consumiuExtra && baixouOReal && acimaDoNecessario,
      `baixa=${baixaTotal.toFixed(6)} consumido=${consumidoAgora} necessário=${reqDepois.requiredQuantity}`,
    );
    check(
      "REGRA · a ampliação da reserva ficou auditável (motivo, autor e data)",
      Boolean(linhaExtra?.extraReason && linhaExtra?.extraRequestedBy),
      JSON.stringify({ motivo: linhaExtra?.extraReason, autor: linhaExtra?.extraRequestedBy }),
    );
    S.dados.provaAcimaDoNecessario = { consumido: consumidoAgora, baixa: baixaTotal };
    salvarEstado();
    await shot("adv-op-consumo-acima-do-necessario");
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 7 · Os caminhos proibidos da conclusão
// ══════════════════════════════════════════════════════════════════════════
async function tentarConcluir() {
  await abrir(S.dados.ops.OP1.url, { espera: ".doc-title h1" });
  const botao = page.getByRole("button", { name: "Concluir OP", exact: true }).first();
  if ((await botao.count()) === 0) return "(a tela não oferece “Concluir OP” neste estado)";
  if (await botao.isDisabled()) {
    const avisos = await mensagensDeErro();
    return `o botão “Concluir OP” fica DESABILITADO — a tela explica: ${JSON.stringify(avisos)}`;
  }
  await botao.click();
  await page.waitForTimeout(900);
  await confirmarModal("Concluir OP");
  await page.waitForTimeout(2000);
  return JSON.stringify(await mensagensDeErro());
}

async function marco07ProibidosDaConclusao() {
  const registro = S.dados.ops.OP1;
  let op = await lerOp(registro.id);
  const reqMp2 = op.requirements.find((r) => r.itemCode === S.dados.mp2.code);

  check(
    "PRÉ · a OP está Em produção (primeiro consumo real já avançou o estado)",
    op.status === "IN_PRODUCTION",
    op.status,
  );
  check(
    `PRÉ · ${S.dados.mp2.code} continua com consumo ZERO (é o material do caso 2)`,
    num(reqMp2.consumedQuantity) === 0,
    reqMp2.consumedQuantity,
  );

  // ── Proibido 1: concluir SEM apontamento de produção ───────────────────
  if (!S.dados.provaSemApontamento) {
    await caminhoProibido(
      "PROIBIDO-1 · concluir OP SEM apontamento de produção",
      {
        pre: `OP ${registro.code} Em produção, ${op.outputs.length} apontamento(s) de produção`,
        acao: "acionar Concluir OP sem ter registrado nenhuma produção",
        esperado: "recusa; ordem sem produção registrada não produziu nada para concluir",
        invariante: "status continua Em produção, nenhum lote de produto acabado nasce",
      },
      tentarConcluir,
    );
    S.dados.provaSemApontamento = true;
    salvarEstado();
    await shot("adv-op-unreconciled");
  }

  // ── Apontamento parcial, para isolar os casos de material ──────────────
  if (!S.dados.apontamento1) {
    await abrir(registro.url, { espera: ".doc-title h1" });
    await preencher("#output-quantity", PRODUZIDO_OP1);
    await preencher("#output-business-lot", `ADV-PA-${hoje().replace(/-/g, "")}`);
    if ((await page.locator("#output-expiry").count()) > 0) {
      await preencher("#output-expiry", "2028-09-30");
    }
    await preencher("#output-location", "ADV-PA-01");
    await clicarBotao("Registrar produção");
    await page.waitForTimeout(3200);
    op = await lerOp(registro.id);
    if (!check(`APONTAMENTO · ${PRODUZIDO_OP1} un registradas`, perto(op.producedQuantity, PRODUZIDO_OP1), `${op.producedQuantity} — ${JSON.stringify(await mensagensDeErro())}`)) {
      return;
    }
    S.dados.apontamento1 = { produzido: op.producedQuantity, lote: op.outputs[0]?.lotCode };
    salvarEstado();
    await shot("adv-production-output");
  }

  // ── Proibido 2: concluir com material SEM consumo nenhum ───────────────
  if (!S.dados.provaSemConsumo) {
    op = await lerOp(registro.id);
    const r2 = op.requirements.find((r) => r.itemCode === S.dados.mp2.code);
    await caminhoProibido(
      "PROIBIDO-2 · concluir OP com material sem NENHUM consumo",
      {
        pre: `${S.dados.mp2.code}: necessário ${r2.requiredQuantity}, consumido ${r2.consumedQuantity} (situação ${r2.reconciliationStatus}); produção já apontada`,
        acao: "acionar Concluir OP com um requisito intocado",
        esperado: "recusa; o lote nasceria declarando uma composição que o registro não sustenta",
        invariante: "status continua Em produção; nenhuma reserva é liberada",
      },
      tentarConcluir,
    );
    S.dados.provaSemConsumo = true;
    salvarEstado();
  }

  // ── Consumo PARCIAL do segundo material ────────────────────────────────
  if (!S.dados.consumoParcialMp2) {
    op = await lerOp(registro.id);
    const linhaMp2 = linhasAtivas(op).find((l) => l.itemCode === S.dados.mp2.code);
    const parcial = (num(linhaMp2.remainingQuantity) * 0.6).toFixed(6);
    await abrir(registro.url, { espera: ".doc-title h1" });
    const linha = secaoConsumo().locator("table tbody tr").filter({ hasText: S.dados.mp2.code }).first();
    await linha.locator('input[inputmode="decimal"]').first().fill(parcial);
    await page.waitForTimeout(300);
    await linha.getByRole("button", { name: "Confirmar consumo", exact: true }).click();
    await page.waitForTimeout(3000);
    op = await lerOp(registro.id);
    const r2 = op.requirements.find((r) => r.itemCode === S.dados.mp2.code);
    check(
      `CONSUMO · ${S.dados.mp2.code} ficou em consumo parcial (${r2.consumedQuantity} de ${r2.requiredQuantity})`,
      r2.reconciliationStatus === "PENDING_PARTIAL",
      r2.reconciliationStatus,
    );
    S.dados.consumoParcialMp2 = { consumido: r2.consumedQuantity, necessario: r2.requiredQuantity };
    salvarEstado();
  }

  // ── Proibido 3: concluir com consumo parcial NÃO justificado ───────────
  if (!S.dados.provaParcialSemJustificativa) {
    op = await lerOp(registro.id);
    const r2 = op.requirements.find((r) => r.itemCode === S.dados.mp2.code);
    await caminhoProibido(
      "PROIBIDO-3 · concluir OP com consumo parcial NÃO justificado",
      {
        pre: `${S.dados.mp2.code}: necessário ${r2.requiredQuantity}, consumido ${r2.consumedQuantity}, diferença ${r2.unreconciledQuantity}, sem justificativa`,
        acao: "acionar Concluir OP com a diferença em aberto",
        esperado: "recusa; diferença de material se registra, nunca se esconde",
        invariante: "status continua Em produção; a diferença continua em aberto",
      },
      tentarConcluir,
    );
    S.dados.provaParcialSemJustificativa = true;
    salvarEstado();
  }

  // ── Proibido 4: justificar onde NÃO há diferença (duas abas) ───────────
  if (!S.dados.provaJustificarSemDiferenca) {
    op = await lerOp(registro.id);
    const reconciliado = op.requirements.find((r) => r.reconciliationStatus === "RECONCILED");
    if (!reconciliado) {
      anotar("PROIBIDO-4 · nenhum requisito reconciliado disponível para o teste");
    } else {
      await caminhoProibido(
        "PROIBIDO-4 · justificar diferença onde NÃO há diferença",
        {
          pre: `${reconciliado.itemCode} está Reconciliado (necessário ${reconciliado.requiredQuantity}, consumido ${reconciliado.consumedQuantity})`,
          acao: "pedir justificativa de diferença para um material sem diferença nenhuma",
          esperado: "recusa; explicação para diferença inexistente é registro falso",
          invariante: "o requisito continua Reconciliado e sem varianceReason",
        },
        async () => {
          await abrir(registro.url, { espera: ".doc-title h1" });
          const linhaTabela = page
            .locator("section.form-section", { has: page.locator("h3", { hasText: "Necessidade de Materiais" }) })
            .locator("table tbody tr")
            .filter({ hasText: reconciliado.itemCode })
            .first();
          const botao = linhaTabela.getByRole("button", { name: "Justificar diferença", exact: true });
          if ((await botao.count()) === 0) {
            return "a tela NÃO oferece “Justificar diferença” em material reconciliado (só aparece com pendência)";
          }
          await botao.click();
          await page.waitForSelector("#variance-reason", { timeout: 15000 });
          await preencher("#variance-reason", "ADV justificativa sem diferença");
          await clicarBotao("Registrar justificativa");
          await page.waitForTimeout(2600);
          return JSON.stringify(await mensagensDeErro());
        },
      );
    }
    S.dados.provaJustificarSemDiferenca = true;
    salvarEstado();
  }

  // ── Proibido 11: DUAS ABAS — servidor revalida estado velho ────────────
  if (!S.dados.provaDuasAbas) {
    op = await lerOp(registro.id);
    const r2 = op.requirements.find((r) => r.itemCode === S.dados.mp2.code);
    const outra = await novaAba();
    let resultado = "";
    const antes = await fotografar("antes das duas abas");

    // Aba B abre o diálogo de justificativa com a diferença AINDA em aberto.
    await comAba(outra, async () => {
      await abrir(registro.url, { espera: ".doc-title h1" });
      const linhaTabela = page
        .locator("section.form-section", { has: page.locator("h3", { hasText: "Necessidade de Materiais" }) })
        .locator("table tbody tr")
        .filter({ hasText: S.dados.mp2.code })
        .first();
      const botao = linhaTabela.getByRole("button", { name: "Justificar diferença", exact: true });
      if ((await botao.count()) > 0) {
        await botao.click();
        await page.waitForSelector("#variance-reason", { timeout: 15000 });
        await preencher("#variance-reason", "ADV justificativa enviada de aba com estado velho");
      }
    });

    // Aba A fecha a diferença consumindo o restante.
    await abrir(registro.url, { espera: ".doc-title h1" });
    op = await lerOp(registro.id);
    const linhaMp2 = linhasAtivas(op).find((l) => l.itemCode === S.dados.mp2.code && num(l.remainingQuantity) > 0);
    if (linhaMp2) {
      const linha = secaoConsumo().locator("table tbody tr").filter({ hasText: S.dados.mp2.code }).first();
      await linha.locator('input[inputmode="decimal"]').first().fill(linhaMp2.remainingQuantity);
      await page.waitForTimeout(300);
      await linha.getByRole("button", { name: "Confirmar consumo", exact: true }).click();
      await page.waitForTimeout(3000);
    }
    op = await lerOp(registro.id);
    const r2Depois = op.requirements.find((r) => r.itemCode === S.dados.mp2.code);
    const fechou = r2Depois.reconciliationStatus === "RECONCILED";

    const fotoAntesDoEnvio = await fotografar("antes do envio da aba velha");
    await deliberadamente("PROIBIDO-11", async () => {
      await comAba(outra, async () => {
        if ((await page.locator("#variance-reason").count()) === 0) {
          resultado = "(a aba velha não tinha o diálogo aberto)";
          return;
        }
        await clicarBotao("Registrar justificativa");
        await page.waitForTimeout(2800);
        resultado = JSON.stringify(await mensagensDeErro());
      });
    });
    const fotoDepois = await fotografar("depois do envio da aba velha");
    const mudou = diffFoto(fotoAntesDoEnvio, fotoDepois);
    const opFinal = await lerOp(registro.id);
    const rFinal = opFinal.requirements.find((r) => r.itemCode === S.dados.mp2.code);
    const semJustificativaFalsa = !rFinal.varianceReason;

    registrarCaso("PROIBIDO-11 · duas abas: agir com estado velho", {
      pre: `aba B abriu o diálogo de justificativa de ${S.dados.mp2.code} com diferença em aberto; aba A fechou a diferença consumindo o restante (reconciliado=${fechou})`,
      acao: "enviar a justificativa pela aba B, cuja tela ainda mostra a pendência",
      esperado: "o servidor revalida e recusa — nenhuma operação crítica confia só na tela velha",
      real: `${resultado} · ${mudou}`,
      invariante: "o requisito reconciliado não recebe justificativa de diferença inexistente",
      veredito: semJustificativaFalsa && mudou === "nada mudou" ? "BLOCKED_CORRECTLY" : "BUG",
    });
    registrarNegativo(
      "PROIBIDO-11 · duas abas com estado velho",
      semJustificativaFalsa && mudou === "nada mudou" ? "BLOCKED_CORRECTLY" : "BUG",
      `varianceReason=${rFinal.varianceReason ?? "null"} · ${mudou}`,
    );
    check(
      "NEGATIVO · o servidor revalidou o estado e recusou a ação vinda da aba velha",
      semJustificativaFalsa && mudou === "nada mudou",
      `${resultado} · ${mudou}`,
    );
    void antes;
    await comAba(outra, () => shot("adv-op-duas-abas"));
    await outra.close();
    S.dados.provaDuasAbas = true;
    salvarEstado();
  }

  // ── Proibido 10: produção ZERO ─────────────────────────────────────────
  if (!S.dados.provaProducaoZero) {
    await caminhoProibido(
      "PROIBIDO-10 · apontar produção ZERO",
      {
        pre: `OP ${registro.code} Em produção, planejado ${PED1_QTD} un`,
        acao: "informar quantidade produzida 0 e registrar produção",
        esperado: "recusa; apontamento de zero não é produção, é ruído no histórico",
        invariante: "nenhum ProductionOutput nasce e nenhum lote de produto acabado é criado",
      },
      async () => {
        await abrir(registro.url, { espera: ".doc-title h1" });
        await preencher("#output-quantity", "0");
        await preencher("#output-business-lot", "ADV-PA-ZERO");
        if ((await page.locator("#output-expiry").count()) > 0) await preencher("#output-expiry", "2028-09-30");
        const botao = page.getByRole("button", { name: "Registrar produção", exact: true }).first();
        if (await botao.isDisabled()) return "o botão “Registrar produção” fica DESABILITADO com quantidade zero";
        await botao.click();
        await page.waitForTimeout(2600);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    S.dados.provaProducaoZero = true;
    salvarEstado();
  }

  // ── Regra a observar: produção ACIMA do planejado ──────────────────────
  if (!S.dados.provaAcimaDoPlanejado) {
    op = await lerOp(registro.id);
    const excesso = String(num(op.remainingQuantity) + 50);
    const resultado = await caminhoProibido(
      "REGRA · apontar produção ACIMA do planejado",
      {
        pre: `planejado ${op.plannedQuantity} un, produzido ${op.producedQuantity} un, restante ${op.remainingQuantity} un`,
        acao: `informar ${excesso} un (50 acima do restante) e registrar produção`,
        esperado: "o domínio decide — registrar o que ele faz, não presumir política",
        invariante: "se recusa, nada muda; se aceita, o produzido não pode contradizer o planejado em silêncio",
      },
      async () => {
        await abrir(registro.url, { espera: ".doc-title h1" });
        await preencher("#output-quantity", excesso);
        await preencher("#output-business-lot", "ADV-PA-EXCESSO");
        if ((await page.locator("#output-expiry").count()) > 0) await preencher("#output-expiry", "2028-09-30");
        const botao = page.getByRole("button", { name: "Registrar produção", exact: true }).first();
        const avisos = await mensagensDeErro();
        if (await botao.isDisabled()) {
          return `o botão fica DESABILITADO e o campo explica o limite: ${JSON.stringify(avisos)}`;
        }
        await botao.click();
        await page.waitForTimeout(2600);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    anotar(
      `REGRA · produção acima do planejado: o domínio ${resultado.intacto ? "RECUSA" : "ACEITA"} — ${resultado.resultadoDaTela}`,
    );
    S.dados.provaAcimaDoPlanejado = true;
    salvarEstado();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 8 · Conclusão válida e o que ela deixa para trás
// ══════════════════════════════════════════════════════════════════════════
async function marco08Conclusao() {
  const registro = S.dados.ops.OP1;
  let op = await lerOp(registro.id);

  const antes = {
    lotesMp: await lerLotesDoItem(S.dados.mp.id),
    lotesMp2: await lerLotesDoItem(S.dados.mp2.id),
    movMp: (await lerMovimentos(S.dados.mp.id)).length,
    movMp2: (await lerMovimentos(S.dados.mp2.id)).length,
  };

  /**
   * Aba B fica com o diálogo de conclusão ARMADO antes de a aba A concluir.
   *
   * É a segunda metade do caso das duas abas, e a que importa mais: concluir
   * é a operação que cria lote, libera reserva e congela custo. Se o servidor
   * confiasse na tela, um segundo envio a partir de uma tela válida-porém-
   * velha concluiria a ordem duas vezes.
   */
  let abaVelha = null;
  if (op.status === "IN_PRODUCTION") {
    const pendentes = op.requirements.filter((r) => ["PENDING_NONE", "PENDING_PARTIAL"].includes(r.reconciliationStatus));
    check(
      "CONCLUSÃO · todos os materiais estão reconciliados antes de concluir",
      pendentes.length === 0,
      JSON.stringify(pendentes.map((r) => `${r.itemCode}/${r.reconciliationStatus}`)),
    );

    if (!S.dados.provaConcluirDuasAbas) {
      abaVelha = await novaAba();
      await comAba(abaVelha, async () => {
        await abrir(registro.url, { espera: ".doc-title h1" });
        const botao = page.getByRole("button", { name: "Concluir OP", exact: true }).first();
        if ((await botao.count()) > 0 && !(await botao.isDisabled())) {
          await botao.click();
          await page.waitForTimeout(900);
          if ((await page.locator("#op-completion-reason").count()) > 0) {
            await preencher("#op-completion-reason", "ADV segundo envio, vindo de tela velha");
          }
        }
      });
    }

    await abrir(registro.url, { espera: ".doc-title h1" });
    const botao = page.getByRole("button", { name: "Concluir OP", exact: true }).first();
    check("CONCLUSÃO · a tela habilita “Concluir OP” com tudo reconciliado", !(await botao.isDisabled()), "");
    await botao.click();
    await page.waitForTimeout(900);
    if ((await page.locator("#op-completion-reason").count()) > 0) {
      await preencher("#op-completion-reason", "ADV producao parcial: parada de equipamento no fim do turno");
    }
    await confirmarModal("Concluir OP");
    await page.waitForTimeout(2600);
  }

  // ── Proibido 11b: concluir DE NOVO pela aba velha ──────────────────────
  if (abaVelha) {
    const fotoAntes = await fotografar("antes do segundo envio de conclusão");
    let resultado = "";
    await deliberadamente("PROIBIDO-11b", async () => {
      await comAba(abaVelha, async () => {
        if ((await page.locator(".confirm-dialog").count()) === 0) {
          resultado = "(a aba velha não tinha o diálogo de conclusão armado)";
          return;
        }
        await confirmarModal("Concluir OP");
        await page.waitForTimeout(2600);
        resultado = JSON.stringify(await mensagensDeErro());
      });
    });
    const fotoDepois = await fotografar("depois do segundo envio de conclusão");
    const mudou = diffFoto(fotoAntes, fotoDepois);
    const opFinal = await lerOp(registro.id);

    registrarCaso("PROIBIDO-11b · duas abas: concluir a MESMA OP duas vezes", {
      pre: `aba B com o diálogo “Concluir OP” armado enquanto a OP ainda estava Em produção; aba A concluiu a ordem`,
      acao: "confirmar a conclusão pela aba B, cuja tela ainda acredita que a OP está Em produção",
      esperado: "o servidor revalida o status e recusa — concluir duas vezes duplicaria lote, liberação de reserva e snapshot de custo",
      real: `${resultado} · ${mudou}`,
      invariante: `um único lote de produto acabado, um único completedAt (${opFinal.completedAt}), reserva liberada uma vez`,
      veredito: mudou === "nada mudou" ? "BLOCKED_CORRECTLY" : "BUG",
    });
    registrarNegativo(
      "PROIBIDO-11b · concluir a mesma OP duas vezes (duas abas)",
      mudou === "nada mudou" ? "BLOCKED_CORRECTLY" : "BUG",
      mudou,
    );
    check("NEGATIVO · o servidor recusou a segunda conclusão vinda da aba velha", mudou === "nada mudou", `${resultado} · ${mudou}`);
    await comAba(abaVelha, () => shot("adv-op-duas-abas-conclusao"));
    await abaVelha.close();
    S.dados.provaConcluirDuasAbas = true;
    salvarEstado();
  }

  op = await lerOp(registro.id);
  const depois = {
    lotesMp: await lerLotesDoItem(S.dados.mp.id),
    lotesMp2: await lerLotesDoItem(S.dados.mp2.id),
    movMp: (await lerMovimentos(S.dados.mp.id)).length,
    movMp2: (await lerMovimentos(S.dados.mp2.id)).length,
  };

  const lotesPa = await lerLotesDoItem(S.dados.itemPa.id);
  const lotePa = lotesPa.find((l) => num(l.onHand) > 0);
  const reservasAtivas = (op.reservation?.lines ?? []).filter((l) => l.releasedAt === null);
  const reservaLiberada = op.reservation?.status === "RELEASED";
  const reservadoZerado =
    depois.lotesMp.every((l) => num(l.reserved) === 0) && depois.lotesMp2.every((l) => num(l.reserved) === 0);
  const fisicoIntacto =
    antes.lotesMp.every((l) => String(l.onHand) === String(depois.lotesMp.find((x) => x.code === l.code)?.onHand)) &&
    antes.lotesMp2.every((l) => String(l.onHand) === String(depois.lotesMp2.find((x) => x.code === l.code)?.onHand));

  registrarCaso("CORRETO · conclusão válida da OP", {
    pre: `OP ${registro.code} Em produção, produzido ${op.producedQuantity} de ${op.plannedQuantity}, materiais reconciliados`,
    acao: "Concluir OP informando o motivo da variação",
    esperado: "status Concluída, lote de produto acabado criado, reserva remanescente liberada sem baixar estoque",
    real: `status ${op.status} · lote PA ${lotePa?.code ?? "—"} (${lotePa?.onHand ?? 0} un, ${lotePa?.status}) · reserva ${op.reservation?.status}`,
    invariante: "liberar reserva não movimenta estoque: o físico dos materiais fica igual",
    veredito: op.status === "COMPLETED" && Boolean(lotePa) && reservaLiberada && fisicoIntacto ? "PASS" : "FAIL",
  });

  check("CONCLUSÃO · a OP ficou Concluída", op.status === "COMPLETED", op.status);
  check("CONCLUSÃO · o motivo da variação ficou registrado", Boolean(op.completionReason), String(op.completionReason));
  check(
    `CONCLUSÃO · nasceu lote de produto acabado com ${op.producedQuantity} un`,
    Boolean(lotePa) && perto(lotePa.onHand, op.producedQuantity),
    JSON.stringify(lotesPa.map((l) => `${l.code}=${l.onHand}/${l.status}`)),
  );
  check("CONCLUSÃO · a reserva remanescente foi LIBERADA", reservaLiberada, String(op.reservation?.status));
  check("CONCLUSÃO · não sobrou reservado nos lotes de material", reservadoZerado, JSON.stringify(depois.lotesMp.map((l) => `${l.code}=${l.reserved}`)));
  check("CONCLUSÃO · liberar a reserva NÃO moveu estoque físico", fisicoIntacto, "");
  check(
    "CONCLUSÃO · liberar a reserva NÃO criou movimento de estoque",
    antes.movMp === depois.movMp && antes.movMp2 === depois.movMp2,
    `${antes.movMp}/${antes.movMp2} → ${depois.movMp}/${depois.movMp2}`,
  );
  check(
    "CONCLUSÃO · as linhas de reserva foram preservadas (nunca apagadas)",
    (op.reservation?.lines ?? []).length > 0,
    String((op.reservation?.lines ?? []).length),
  );
  void reservasAtivas;

  // ── Rastreabilidade e snapshot de custo ────────────────────────────────
  const consumosPorItem = {};
  for (const c of op.consumptions) consumosPorItem[c.itemCode] = (consumosPorItem[c.itemCode] ?? 0) + num(c.quantity);
  check(
    "RASTREABILIDADE · os dois materiais da formulação têm consumo registrado na OP",
    Object.keys(consumosPorItem).length === 2,
    JSON.stringify(consumosPorItem),
  );
  const bloqueadoTocado = op.consumptions.some((c) => c.lotCode === LOTE_BLOQUEADO);
  check("RASTREABILIDADE · nenhum consumo saiu do lote BLOQUEADO", !bloqueadoTocado, LOTE_BLOQUEADO);

  let custo = null;
  try {
    custo = await apiGet(`/production-orders/${registro.id}/cost`);
  } catch {
    /* rota pode ter outro nome — a tela é a fonte */
  }
  await abrir(registro.url, { espera: ".doc-title h1" });
  const temSecaoCusto = (await textos("section.form-section h3")).some((t) => /Custo industrial/i.test(t));
  check("CONCLUSÃO · a OP concluída mostra o snapshot de custo industrial", temSecaoCusto, JSON.stringify(await textos("section.form-section h3")));
  void custo;

  if (lotePa) {
    await abrirLote(lotePa.id);
    const tituloLote = await texto(".doc-title h1");
    check("RASTREABILIDADE · o lote de produto acabado abre pelo próprio documento", Boolean(tituloLote), tituloLote);
    S.dados.lotePa = { id: lotePa.id, code: lotePa.code, status: lotePa.status, onHand: lotePa.onHand };
    salvarEstado();
    await shot("adv-op-reconciled");
  }

  // ── Proibido 5: alterar justificativa DEPOIS de concluída ──────────────
  if (!S.dados.provaJustificativaDepois) {
    const outra = await novaAba();
    let resultado = "";
    const fotoAntes = await fotografar("antes de alterar justificativa da OP concluída");
    await deliberadamente("PROIBIDO-5", async () => {
      await comAba(outra, async () => {
        await abrir(registro.url, { espera: ".doc-title h1" });
        const linhaTabela = page
          .locator("section.form-section", { has: page.locator("h3", { hasText: "Necessidade de Materiais" }) })
          .locator("table tbody tr")
          .first();
        const botao = linhaTabela.getByRole("button", { name: "Justificar diferença", exact: true });
        if ((await botao.count()) === 0) {
          resultado = "a tela NÃO oferece “Justificar diferença” em OP concluída (o botão só existe Em produção)";
          return;
        }
        await botao.click();
        await page.waitForSelector("#variance-reason", { timeout: 15000 });
        await preencher("#variance-reason", "ADV alteracao depois de concluida");
        await clicarBotao("Registrar justificativa");
        await page.waitForTimeout(2800);
        resultado = JSON.stringify(await mensagensDeErro());
      });
    });
    const fotoDepois = await fotografar("depois");
    const mudou = diffFoto(fotoAntes, fotoDepois);

    registrarCaso("PROIBIDO-5 · alterar justificativa DEPOIS de concluída", {
      pre: `OP ${registro.code} Concluída, com as justificativas de material já carimbadas`,
      acao: "tentar registrar/alterar justificativa de diferença de material na ordem encerrada",
      esperado: "recusa; documento histórico não se reescreve",
      real: `${resultado} · ${mudou}`,
      invariante: "nenhuma varianceReason muda depois da conclusão",
      veredito: mudou === "nada mudou" ? "BLOCKED_CORRECTLY" : "BUG",
    });
    registrarNegativo("PROIBIDO-5 · alterar justificativa depois de concluída", mudou === "nada mudou" ? "BLOCKED_CORRECTLY" : "BUG", mudou);
    check("NEGATIVO · a OP concluída não aceitou nova justificativa", mudou === "nada mudou", `${resultado} · ${mudou}`);
    await outra.close();
    S.dados.provaJustificativaDepois = true;
    salvarEstado();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 9 · Liberação do produto acabado pela Qualidade
// ══════════════════════════════════════════════════════════════════════════
async function marco09LiberarProdutoAcabado() {
  const antes = await lerLotesDoItem(S.dados.itemPa.id);
  const aguardando = antes.filter((l) => l.status === "AWAITING_RELEASE");
  check(
    "QUALIDADE · o lote de produto acabado nasceu Aguardando liberação",
    aguardando.length > 0 || antes.some((l) => l.status === "AVAILABLE"),
    JSON.stringify(antes.map((l) => `${l.code}/${l.status}`)),
  );
  const movAntes = (await lerMovimentos(S.dados.itemPa.id)).length;
  await liberarLotesPendentes(S.dados.itemPa.id);
  const depois = await lerLotesDoItem(S.dados.itemPa.id);
  const movDepois = (await lerMovimentos(S.dados.itemPa.id)).length;
  const disponivel = depois.reduce((a, l) => a + num(l.available), 0);

  registrarCaso("CORRETO · liberação do produto acabado pela Qualidade", {
    pre: `lote ${aguardando.map((l) => l.code).join(", ") || depois[0]?.code} com ${depois[0]?.onHand} un`,
    acao: "abrir o lote e usar Qualidade › Liberar",
    esperado: "o lote passa a Disponível e a quantidade vira disponível para reserva comercial",
    real: JSON.stringify(depois.map((l) => `${l.code}/${l.status}/${l.available}`)),
    invariante: "liberação não movimenta estoque — só troca o status",
    veredito: disponivel > 0 && movAntes === movDepois ? "PASS" : "FAIL",
  });
  check("QUALIDADE · o produto acabado ficou disponível", disponivel > 0, String(disponivel));
  check("QUALIDADE · liberar não criou movimento", movAntes === movDepois, `${movAntes}→${movDepois}`);
  S.dados.paDisponivel = disponivel;
  salvarEstado();
  anotar(`ESTOQUE PA · ${disponivel} un disponíveis de ${S.dados.produto.code}`);
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 10 · Dois pedidos competindo pelo mesmo saldo
// ══════════════════════════════════════════════════════════════════════════
async function marco10PedidosCompetindo() {
  const disponivelInicial = S.dados.paDisponivel;

  // ── Pedido 2 e Pedido 3 nascem antes de qualquer aplicação ─────────────
  const p2 = await criarPedido("P2", PED2_QTD);
  const p3 = await criarPedido("P3", PED3_QTD);
  if (!p2 || !p3) return;
  check("PEDIDO-2 · confirmado", (await confirmarPedido(p2)) === "CONFIRMED", "");
  check("PEDIDO-3 · confirmado", (await confirmarPedido(p3)) === "CONFIRMED", "");

  // ── Os dois planos são calculados com o MESMO saldo ────────────────────
  await abrir(p2.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(2500);
  const plano2 = (await lerPlanoDaTela())?.[0];
  await abrir(p3.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(2500);
  const plano3Antes = (await lerPlanoDaTela())?.[0];
  await shot("adv-pedido-planos-concorrentes");

  const ok2 = plano2 && perto(plano2.reservar, PED2_QTD) && num(plano2.produzir) === 0;
  registrarCaso("PEDIDO-2 · cobertura com estoque SUFICIENTE", {
    pre: `${disponivelInicial} un disponíveis; pedido de ${PED2_QTD} un`,
    acao: "confirmar e abrir o Plano de Atendimento",
    esperado: `Reservar = ${PED2_QTD} e Produzir = 0 — estoque primeiro`,
    real: JSON.stringify(plano2),
    invariante: "plano é projeção; nada é reservado antes de aplicar",
    veredito: ok2 ? "PASS" : "FAIL",
  });
  check("PEDIDO-2 · o plano propôs reservar tudo", Boolean(ok2), JSON.stringify(plano2));

  const ok3Antes = plano3Antes && perto(plano3Antes.reservar, PED3_QTD);
  anotar(
    `COMPETIÇÃO · com ${disponivelInicial} un livres, o plano do ${p3.code} propôs reservar ${plano3Antes?.reservar} e produzir ${plano3Antes?.produzir}`,
  );
  check(
    `PEDIDO-3 · antes da competição o plano enxerga o saldo inteiro (reservar ${PED3_QTD})`,
    Boolean(ok3Antes),
    JSON.stringify(plano3Antes),
  );

  // ── Aplica o Pedido 2: consome parte do saldo ──────────────────────────
  if (!S.dados.p2Aplicado) {
    await abrir(p2.url, { espera: ".doc-title h1" });
    await page.waitForTimeout(2200);
    await clicarBotao("Aplicar Plano de Atendimento");
    await confirmarDialogo("Aplicar Plano");
    await page.waitForTimeout(3200);
    S.dados.p2Aplicado = true;
    salvarEstado();
  }
  const ped2 = await lerPedido(p2.id);
  check("PEDIDO-2 · virou Em atendimento", ped2.status === "IN_FULFILLMENT", ped2.status);
  check(
    "PEDIDO-2 · não gerou OP (estoque cobriu tudo)",
    (ped2.generatedProductionOrders ?? []).length === 0,
    JSON.stringify((ped2.generatedProductionOrders ?? []).map((o) => o.code)),
  );
  const lotesPaDepois2 = await lerLotesDoItem(S.dados.itemPa.id);
  const reservadoPa = lotesPaDepois2.reduce((a, l) => a + num(l.reserved), 0);
  const disponivelPaDepois2 = lotesPaDepois2.reduce((a, l) => a + num(l.available), 0);
  check(
    `PEDIDO-2 · reservou ${PED2_QTD} un de produto acabado`,
    perto(reservadoPa, PED2_QTD),
    String(reservadoPa),
  );
  check(
    `PEDIDO-2 · o disponível caiu para ${disponivelInicial - PED2_QTD}`,
    perto(disponivelPaDepois2, disponivelInicial - PED2_QTD),
    String(disponivelPaDepois2),
  );

  // ── A competição: o Pedido 3 tenta aplicar o plano VELHO ───────────────
  if (!S.dados.p3Competicao) {
    const foto = await caminhoProibido(
      "COMPETIÇÃO · segundo pedido aplicando plano calculado antes da reserva do primeiro",
      {
        pre: `${p3.code} tem na tela um plano de reservar ${plano3Antes?.reservar} un, calculado quando havia ${disponivelInicial} un livres; o ${p2.code} já reservou ${PED2_QTD} un`,
        acao: `aplicar o plano do ${p3.code} sem recarregar a tela`,
        esperado: "recusa ou recálculo — o segundo pedido só pode ver o disponível restante, nunca overbooking",
        invariante: `reservado total do produto acabado nunca ultrapassa o físico (${disponivelInicial} un)`,
      },
      async () => {
        await abrir(p3.url, { espera: ".doc-title h1" });
        await page.waitForTimeout(2500);
        // A tela recarregada recalcula sozinha; para provar a competição de
        // verdade, o campo é forçado ao valor do plano ANTIGO.
        const campo = page.locator(`input[aria-label="Reservar de ${S.dados.produto.code}"]`).first();
        if ((await campo.count()) > 0) {
          await campo.fill(String(PED3_QTD));
          await page.waitForTimeout(400);
          const produzir = page.locator(`input[aria-label="Produzir de ${S.dados.produto.code}"]`).first();
          if ((await produzir.count()) > 0) await produzir.fill("0");
          await page.waitForTimeout(400);
        }
        const botao = page.getByRole("button", { name: "Aplicar Plano de Atendimento", exact: true });
        if ((await botao.count()) === 0) return "(a tela não ofereceu aplicar o plano)";
        if (await botao.isDisabled()) return "o botão “Aplicar Plano de Atendimento” fica DESABILITADO";
        await botao.click();
        await confirmarDialogo("Aplicar Plano");
        await page.waitForTimeout(3200);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    void foto;
    const lotesPa = await lerLotesDoItem(S.dados.itemPa.id);
    const reservadoTotal = lotesPa.reduce((a, l) => a + num(l.reserved), 0);
    const fisicoTotal = lotesPa.reduce((a, l) => a + num(l.onHand), 0);
    check(
      "COMPETIÇÃO · o reservado total nunca ultrapassou o físico (sem overbooking)",
      reservadoTotal <= fisicoTotal + 1e-9,
      `reservado ${reservadoTotal} · físico ${fisicoTotal}`,
    );
    S.dados.p3Competicao = true;
    salvarEstado();
    await shot("adv-pedido-competicao-overbooking");
  }

  // ── Pedido 3 pelo caminho correto: cobertura PARCIAL ───────────────────
  if (!S.dados.p3Aplicado) {
    await abrir(p3.url, { espera: ".doc-title h1" });
    await page.waitForTimeout(2800);
    const plano3Agora = (await lerPlanoDaTela())?.[0];
    const restante = disponivelInicial - PED2_QTD;
    const ok3 = plano3Agora && perto(plano3Agora.reservar, restante) && perto(plano3Agora.produzir, PED3_QTD - restante);
    registrarCaso("PEDIDO-3 · cobertura PARCIAL (parte reserva, parte produz)", {
      pre: `${restante} un livres depois da reserva do ${p2.code}; pedido de ${PED3_QTD} un`,
      acao: "recarregar o Plano de Atendimento e aplicar",
      esperado: `Reservar = ${restante} e Produzir = ${PED3_QTD - restante}`,
      real: JSON.stringify(plano3Agora),
      invariante: "reservar + produzir é exatamente a quantidade pedida",
      veredito: ok3 ? "PASS" : "FAIL",
    });
    check("PEDIDO-3 · o plano recalculado dividiu reserva e produção", Boolean(ok3), JSON.stringify(plano3Agora));

    await clicarBotao("Aplicar Plano de Atendimento");
    await confirmarDialogo("Aplicar Plano");
    await page.waitForTimeout(3500);
    S.dados.p3Aplicado = true;
    salvarEstado();
  }

  const ped3 = await lerPedido(p3.id);
  check("PEDIDO-3 · virou Em atendimento", ped3.status === "IN_FULFILLMENT", ped3.status);
  const opsP3 = ped3.generatedProductionOrders ?? [];
  check("PEDIDO-3 · gerou uma OP para o déficit", opsP3.length === 1, JSON.stringify(opsP3.map((o) => `${o.code}/${o.plannedQuantity}`)));
  if (opsP3.length === 1) {
    S.dados.ops.OP3 = { id: opsP3[0].id, code: opsP3[0].code, url: `/producao/ordens/${opsP3[0].id}` };
    salvarEstado();
    const op3 = await lerOp(opsP3[0].id);
    check(
      `PEDIDO-3 · a OP do déficit planeja ${PED3_QTD - (disponivelInicial - PED2_QTD)} un`,
      perto(op3.plannedQuantity, PED3_QTD - (disponivelInicial - PED2_QTD)),
      op3.plannedQuantity,
    );
  }

  const lotesFinal = await lerLotesDoItem(S.dados.itemPa.id);
  const reservadoFinal = lotesFinal.reduce((a, l) => a + num(l.reserved), 0);
  const fisicoFinal = lotesFinal.reduce((a, l) => a + num(l.onHand), 0);
  check(
    "COMPETIÇÃO · a soma das reservas dos dois pedidos cabe no físico",
    reservadoFinal <= fisicoFinal + 1e-9,
    `reservado ${reservadoFinal} · físico ${fisicoFinal}`,
  );
  anotar(`COMPETIÇÃO · físico ${fisicoFinal} un · reservado ${reservadoFinal} un · livre ${(fisicoFinal - reservadoFinal).toFixed(6)} un`);
  await shot("adv-pedido-parcial-aplicado");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 11 · Cancelamentos: permitido, proibido e a liberação das reservas
// ══════════════════════════════════════════════════════════════════════════
async function marco11Cancelamentos() {
  // ── Cancelar pedido em estágio PERMITIDO ───────────────────────────────
  if (!S.dados.p4Cancelado) {
    const p4 = await criarPedido("P4", 100);
    if (!p4) return;
    const situacao = await confirmarPedido(p4);
    check("PEDIDO-4 · confirmado (estágio em que o cancelamento é permitido)", situacao === "CONFIRMED", situacao);
    const antes = await fotografar("antes do cancelamento permitido");
    await abrir(p4.url, { espera: ".doc-title h1" });
    await clicarBotao("Cancelar pedido");
    await preencher("#co-cancel-reason", "ADV cancelamento do cliente antes de qualquer compromisso");
    await confirmarModal("Cancelar pedido");
    await page.waitForTimeout(2500);
    const ped4 = await lerPedido(p4.id);
    const depois = await fotografar("depois do cancelamento permitido");
    const semEfeitoColateral = !diffFoto(antes, depois).includes("físico");

    registrarCaso("CORRETO · cancelamento de pedido em estágio permitido", {
      pre: `${p4.code} Confirmado, sem reserva de produto acabado e sem OP gerada`,
      acao: "Cancelar pedido informando o motivo",
      esperado: "pedido Cancelado; nada a liberar porque nada havia sido comprometido",
      real: `status ${ped4.status} · motivo "${ped4.cancelReason}"`,
      invariante: "cancelar não movimenta estoque nem toca reserva de terceiros",
      veredito: ped4.status === "CANCELLED" && semEfeitoColateral ? "PASS" : "FAIL",
    });
    check("CANCELAMENTO · o pedido em estágio permitido foi cancelado", ped4.status === "CANCELLED", ped4.status);
    check("CANCELAMENTO · o motivo ficou registrado", Boolean(ped4.cancelReason), String(ped4.cancelReason));
    check("CANCELAMENTO · nenhum estoque físico mudou", semEfeitoColateral, diffFoto(antes, depois));
    S.dados.p4Cancelado = true;
    salvarEstado();
    await shot("adv-pedido-cancelado-permitido");
  }

  // ── Cancelar pedido em estágio PROIBIDO ────────────────────────────────
  if (!S.dados.p2CancelProibido) {
    const p2 = S.dados.pedidos.P2;
    const ped2 = await lerPedido(p2.id);
    await caminhoProibido(
      "PROIBIDO · cancelar pedido Em atendimento com reserva ativa",
      {
        pre: `${p2.code} Em atendimento com ${PED2_QTD} un de produto acabado reservadas`,
        acao: "Cancelar pedido informando o motivo",
        esperado: "recusa; resolver as dependências primeiro — nada é cancelado/liberado em cascata",
        invariante: "a reserva continua ativa, o status continua Em atendimento, nada é revertido pela metade",
      },
      async () => {
        await abrir(p2.url, { espera: ".doc-title h1" });
        if (!(await existeBotao("Cancelar pedido"))) return "(a tela não oferece “Cancelar pedido” neste estado)";
        await clicarBotao("Cancelar pedido");
        await preencher("#co-cancel-reason", "ADV tentativa de cancelar pedido com reserva ativa");
        await confirmarModal("Cancelar pedido");
        await page.waitForTimeout(2800);
        const msg = JSON.stringify(await mensagensDeErro());
        await page.keyboard.press("Escape");
        return msg;
      },
    );
    void ped2;
    S.dados.p2CancelProibido = true;
    salvarEstado();
    await shot("adv-pedido-cancelamento-proibido");
  }

  // ── Cancelar OP Liberada: as reservas têm de voltar ────────────────────
  if (!S.dados.op3Cancelada && S.dados.ops?.OP3) {
    const registro = S.dados.ops.OP3;
    await abrir(registro.url, { espera: ".doc-title h1" });
    if (await existeBotao("Planejar OP")) {
      await clicarBotao("Planejar OP");
      await page.waitForTimeout(2500);
    }
    await abrir(registro.url, { espera: ".doc-title h1" });
    if (await existeBotao("Liberar OP")) {
      await clicarBotao("Liberar OP");
      await confirmarDialogo("Liberar");
      await page.waitForTimeout(3000);
    }
    let op3 = await lerOp(registro.id);
    if (!check("OP-3 · foi liberada (reserva de material efetivada)", op3.status === "RELEASED", op3.status)) {
      anotar(`OP-3 · não liberou: ${JSON.stringify(await mensagensDeErro())}`);
      S.dados.op3Cancelada = true;
      salvarEstado();
      return;
    }

    const antesLotes = await lerLotesDoItem(S.dados.mp.id);
    const antesMov = (await lerMovimentos(S.dados.mp.id)).length;
    const reservadoAntes = antesLotes.reduce((a, l) => a + num(l.reserved), 0);
    check("OP-3 · a liberação reservou material", reservadoAntes > 0, String(reservadoAntes));

    await abrir(registro.url, { espera: ".doc-title h1" });
    await clicarBotao("Cancelar OP");
    await preencher("#op-cancel-reason", "ADV cancelamento da ordem antes de qualquer consumo");
    await confirmarModal("Cancelar OP");
    await page.waitForTimeout(3000);

    op3 = await lerOp(registro.id);
    const depoisLotes = await lerLotesDoItem(S.dados.mp.id);
    const depoisMov = (await lerMovimentos(S.dados.mp.id)).length;
    const reservadoDepois = depoisLotes.reduce((a, l) => a + num(l.reserved), 0);
    const fisicoIgual = antesLotes.every(
      (l) => String(l.onHand) === String(depoisLotes.find((x) => x.code === l.code)?.onHand),
    );

    registrarCaso("CORRETO · cancelar OP Liberada libera as reservas", {
      pre: `OP ${registro.code} Liberada com ${reservadoAntes} kg reservados de ${S.dados.mp.code}`,
      acao: "Cancelar OP informando o motivo",
      esperado: "OP Cancelada e reservas liberadas; estoque físico intacto",
      real: `status ${op3.status} · reservado ${reservadoAntes}→${reservadoDepois} · movimentos ${antesMov}→${depoisMov}`,
      invariante: "liberar reserva não é movimento de estoque",
      veredito: op3.status === "CANCELLED" && reservadoDepois === 0 && fisicoIgual && antesMov === depoisMov ? "PASS" : "FAIL",
    });
    check("OP-3 · ficou Cancelada", op3.status === "CANCELLED", op3.status);
    check("OP-3 · as reservas foram liberadas", reservadoDepois === 0, `${reservadoAntes}→${reservadoDepois}`);
    check("OP-3 · o cancelamento não moveu estoque físico", fisicoIgual && antesMov === depoisMov, `${antesMov}→${depoisMov}`);
    check("OP-3 · a reserva ficou marcada como liberada, não apagada", op3.reservation?.status === "RELEASED", String(op3.reservation?.status));
    S.dados.op3Cancelada = true;
    salvarEstado();
    await shot("adv-op-cancelada-reservas-liberadas");
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 12 · Overbooking pelas outras portas
// ══════════════════════════════════════════════════════════════════════════
/**
 * Aplicar o Plano não é o único caminho que reserva produto acabado, e o
 * duplo clique não é exclusivo do consumo. As duas portas abaixo criam
 * compromisso comercial; se qualquer uma delas aceitar mais do que existe,
 * o pedido promete estoque que não tem.
 */
async function marco12OutrasPortas() {
  // ── Reservar produto acabado ACIMA do disponível ───────────────────────
  if (!S.dados.provaReservaAcima) {
    const p3 = S.dados.pedidos.P3;
    const lotesPa = await lerLotesDoItem(S.dados.itemPa.id);
    const disponivel = lotesPa.reduce((a, l) => a + num(l.available), 0);
    const ped3 = await lerPedido(p3.id);
    const faltaReservar = PED3_QTD - (S.dados.paDisponivel - PED2_QTD);

    await caminhoProibido(
      "PROIBIDO · reservar produto acabado acima do disponível",
      {
        pre: `${p3.code} ainda precisa reservar ${faltaReservar} un; disponível agora = ${disponivel} un (tudo já reservado por ${p3.code} e pelo pedido anterior)`,
        acao: `digitar ${faltaReservar} em “Reservar” na seção Reservar Produto Acabado e confirmar`,
        esperado: "recusa; reservar sem saldo livre é prometer estoque inexistente",
        invariante: "reservado total continua igual e nunca ultrapassa o físico",
      },
      async () => {
        await abrir(p3.url, { espera: ".doc-title h1" });
        await page.waitForTimeout(2200);
        const campo = page.locator(`input[aria-label="Reservar de ${S.dados.produto.code}"]`).first();
        if ((await campo.count()) === 0) return "(a tela não ofereceu campo de reserva)";
        if (await campo.isDisabled()) return "o campo “Reservar” fica DESABILITADO — não há o que reservar";
        await campo.fill(String(faltaReservar));
        await page.waitForTimeout(400);
        const botao = page.getByRole("button", { name: "Reservar disponível", exact: true });
        if ((await botao.count()) === 0) return "(a tela não ofereceu “Reservar disponível”)";
        if (await botao.isDisabled()) return "o botão “Reservar disponível” fica DESABILITADO";
        await botao.click();
        await page.waitForTimeout(2800);
        return JSON.stringify(await mensagensDeErro());
      },
    );
    void ped3;
    const depois = await lerLotesDoItem(S.dados.itemPa.id);
    check(
      "OVERBOOKING · o reservado do produto acabado continua dentro do físico",
      depois.reduce((a, l) => a + num(l.reserved), 0) <= depois.reduce((a, l) => a + num(l.onHand), 0) + 1e-9,
      JSON.stringify(depois.map((l) => `${l.code} res=${l.reserved} fis=${l.onHand}`)),
    );
    S.dados.provaReservaAcima = true;
    salvarEstado();
    await shot("adv-pedido-reserva-acima-do-disponivel");
  }

  // ── Duplo clique em “Aplicar Plano de Atendimento” ─────────────────────
  if (!S.dados.provaDuploAplicar) {
    const p5 = await criarPedido("P5", 300);
    if (!p5) return;
    check("PEDIDO-5 · confirmado", (await confirmarPedido(p5)) === "CONFIRMED", "");

    const antes = await fotografar("antes do duplo clique em aplicar plano");
    await abrir(p5.url, { espera: ".doc-title h1" });
    await page.waitForTimeout(2500);
    await deliberadamente("DUPLO-APLICAR", async () => {
      await clicarBotao("Aplicar Plano de Atendimento");
      const dialogo = page.locator(".confirm-dialog");
      await dialogo.waitFor({ state: "visible", timeout: 20000 });
      const alvo = dialogo.getByRole("button", { name: "Aplicar Plano", exact: true }).first();
      await alvo.click({ force: true });
      await alvo.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(4000);
    });

    const ped5 = await lerPedido(p5.id);
    const ops5 = ped5.generatedProductionOrders ?? [];
    const reservas5 = (ped5.reservations ?? []).filter((r) => r.status === "ACTIVE");
    const depois = await fotografar("depois do duplo clique em aplicar plano");
    const semDuplicata = ops5.length <= 1 && reservas5.length <= 1;

    registrarCaso("PROIBIDO · duplo clique em “Aplicar Plano de Atendimento”", {
      pre: `${p5.code} Confirmado, 300 un, sem produto acabado livre`,
      acao: "clicar duas vezes no confirmar do diálogo, sem esperar a resposta",
      esperado: "um único plano aplicado: no máximo uma OP e uma reserva",
      real: `status ${ped5.status} · OPs ${JSON.stringify(ops5.map((o) => `${o.code}=${o.plannedQuantity}`))} · reservas ativas ${reservas5.length}`,
      invariante: "aplicar o plano duas vezes não pode dobrar produção nem reserva",
      veredito: semDuplicata ? "BLOCKED_CORRECTLY" : "BUG",
    });
    registrarNegativo(
      "PROIBIDO · duplo clique em aplicar plano de atendimento",
      semDuplicata ? "BLOCKED_CORRECTLY" : "BUG",
      `OPs=${ops5.length} reservas=${reservas5.length}`,
    );
    check("NEGATIVO · o duplo clique não aplicou o plano duas vezes", semDuplicata, `OPs=${ops5.length} reservas=${reservas5.length}`);
    if (ops5.length === 1) {
      S.dados.ops = S.dados.ops ?? {};
      S.dados.ops.OP5 = { id: ops5[0].id, code: ops5[0].code, url: `/producao/ordens/${ops5[0].id}` };
    }
    void antes;
    void depois;
    S.dados.provaDuploAplicar = true;
    salvarEstado();
    await shot("adv-pedido-duplo-aplicar-plano");
  }

  // ── O pedido cujo déficit teve a OP cancelada ──────────────────────────
  const p3 = S.dados.pedidos.P3;
  const ped3 = await lerPedido(p3.id);
  const linha3 = ped3.lines[0];
  const opsVivas = (ped3.generatedProductionOrders ?? []).filter((o) => o.status !== "CANCELLED");
  const pendente = num(linha3.pendingProductionQuantity ?? NaN);
  registrarCaso("REGRA · pedido cuja OP de déficit foi cancelada", {
    pre: `${p3.code} Em atendimento: ${PED3_QTD} un pedidas, ${S.dados.paDisponivel - PED2_QTD} un reservadas, OP do déficit CANCELADA`,
    acao: "ler a pendência de produção da linha do pedido",
    esperado: "a OP cancelada não pode contar como cobertura — o saldo volta a ser pendência",
    real: `OPs vivas ${opsVivas.length} · pendingProductionQuantity ${Number.isNaN(pendente) ? "(campo ausente)" : pendente}`,
    invariante: "cobertura por OP cancelada é cobertura inexistente",
    veredito: Number.isNaN(pendente) || pendente > 0 ? "PASS" : "FAIL",
  });
  check(
    "REGRA · OP cancelada não conta como cobertura do pedido",
    Number.isNaN(pendente) || pendente > 0,
    `pendente=${pendente} opsVivas=${opsVivas.length}`,
  );

  /*
   * O campo "Reservar" do Plano de Atendimento não olha para a coluna
   * "Disponível" que está ao lado dele.
   *
   * `handleAdjustReserve` só verifica Reservar + Produzir = Pedido; não há
   * comparação com `line.finishedGoodsAvailable`, o botão continua aceso e a
   * recusa só chega do servidor — que aplica o plano inteiro ou nada. Num
   * pedido de várias linhas, o operador perde o preenchimento todo por causa
   * de uma linha, e só descobre depois de confirmar o diálogo.
   *
   * A integridade está de pé (a competição foi recusada com 400 e nada foi
   * escrito), e a mesma tela já faz o oposto no consumo da OP: lá o campo
   * mostra "Máximo disponível nesta reserva" e desabilita o botão antes do
   * envio. É a inconsistência que se reporta, não a perda de dado.
   */
  const competicao = S.registro.casos.find((c) => c.caso.startsWith("COMPETIÇÃO"));
  const recusaVeioDoServidor = Boolean(competicao && /rede:/.test(String(competicao.real)));
  if (recusaVeioDoServidor) {
    finding(
      "LOW",
      "Plano de Atendimento aceita digitar reserva acima do disponível; só o servidor recusa",
      "Comercial › Pedidos › um pedido CONFIRMED com produto acabado parcialmente reservado por outro pedido · " +
        "seção Plano de Atendimento · digitar em “Reservar” um valor maior que a coluna “Disponível” · " +
        "o botão “Aplicar Plano de Atendimento” continua habilitado e o erro só aparece depois de confirmar o diálogo, " +
        "descartando o preenchimento de todas as linhas. Comparar com Produção › OP › Consumo Real, onde o campo mostra " +
        "“Máximo disponível nesta reserva” e desabilita o botão antes do envio.",
    );
    anotar(
      "TELA · o Plano não valida a reserva contra a coluna Disponível que ele mesmo mostra; a autoridade do servidor está de pé",
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 13 · Ledger e reservas órfãs
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

async function marco12Ledger() {
  const linhas = [];
  let tudoFecha = true;

  for (const item of itensRastreados()) {
    const lotes = await lerLotesDoItem(item.id);
    const movimentos = await lerMovimentos(item.id);
    for (const lote of lotes) {
      const meus = movimentos.filter((m) => m.lotCode === lote.code);
      let entradas = 0;
      let saidas = 0;
      for (const m of meus) {
        const s = SINAL[m.type];
        if (s === undefined) {
          tudoFecha = false;
          linhas.push({ item: item.code, lote: lote.code, erro: `tipo desconhecido: ${m.type}` });
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
        item: item.code,
        lote: lote.code,
        validade: lote.expiryDate,
        status: lote.status,
        movimentos: meus.length,
        entradas: Number(entradas.toFixed(6)),
        saidas: Number(saidas.toFixed(6)),
        calculado: Number(calculado.toFixed(6)),
        saldoDoSistema: real,
        reservado: lote.reserved,
        diferenca: Number(diferenca.toFixed(9)),
        fecha,
      });
      check(
        `LEDGER · ${item.code}/${lote.code}: ${entradas} − ${saidas} = ${calculado} bate com ${real}`,
        fecha,
        `diferença ${diferenca}`,
      );
    }
  }

  S.dados.ledger = linhas;
  salvarEstado();
  console.log("\n── LEDGER ──");
  for (const l of linhas) console.log(JSON.stringify(l));

  if (!tudoFecha) {
    finding(
      "CRITICAL",
      "Reconstrução do ledger não fecha: saldo do lote diverge da soma dos movimentos",
      `Estoque › item › Ver movimentações · somar entradas e subtrair saídas por lote e comparar com o físico. ` +
        `Divergências: ${JSON.stringify(linhas.filter((l) => !l.fecha))}`,
    );
  }
  check("LEDGER · todo lote fecha entradas − saídas = saldo, com tolerância zero", tudoFecha, "");

  // ── Reservas órfãs ─────────────────────────────────────────────────────
  const orfas = [];
  for (const chave of Object.keys(S.dados.ops ?? {})) {
    const registro = S.dados.ops[chave];
    const op = await lerOp(registro.id);
    if (!["COMPLETED", "CANCELLED"].includes(op.status)) continue;
    if (op.reservation && op.reservation.status === "ACTIVE") {
      orfas.push(`${op.code} (${op.status}) com reserva ainda ACTIVE`);
    }
  }
  // Toda OP encerrada deste roteiro tem de deixar zero reservado nos itens.
  for (const item of [S.dados.mp, S.dados.mp2]) {
    const lotes = await lerLotesDoItem(item.id);
    const reservado = lotes.reduce((a, l) => a + num(l.reserved), 0);
    if (reservado > 1e-9) {
      const vivos = [];
      for (const chave of Object.keys(S.dados.ops ?? {})) {
        const op = await lerOp(S.dados.ops[chave].id);
        if (["RELEASED", "IN_PRODUCTION"].includes(op.status)) vivos.push(op.code);
      }
      if (vivos.length === 0) orfas.push(`${item.code} com ${reservado} reservado sem nenhuma OP viva`);
    }
  }
  check("LEDGER · nenhuma reserva órfã de OP encerrada", orfas.length === 0, JSON.stringify(orfas));
  if (orfas.length > 0) {
    finding(
      "HIGH",
      "Reserva órfã: OP encerrada deixou material reservado",
      `Produção › a OP encerrada › seção Materiais Reservados; e Estoque › item › coluna Reservado. Órfãs: ${JSON.stringify(orfas)}`,
    );
  }

  await abrir(`/estoque/movimentacoes?itemId=${S.dados.mp.id}`, { espera: ".page__title" });
  await page.waitForTimeout(1500);
  await shot("adv-op-ledger");
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 14 · Cancelamento proibido chegando ao SERVIDOR
// ══════════════════════════════════════════════════════════════════════════
/**
 * O caso 25 provou que a tela some com "Cancelar pedido" quando o pedido
 * entra em atendimento. Isso é o comportamento certo, mas não prova o
 * portão: uma tela aberta antes da mudança ainda tem o botão.
 *
 * Aqui a aba B arma o diálogo de cancelamento com o pedido ainda CONFIRMED,
 * a aba A aplica o Plano (gerando OP), e o envio sai da aba velha. É a única
 * forma de fazer a requisição nascer pela interface e ainda assim chegar ao
 * servidor com o estado errado.
 */
async function marco14CancelamentoNoServidor() {
  if (S.dados.provaCancelamentoServidor) return;
  const p6 = await criarPedido("P6", 200);
  if (!p6) return;
  check("PEDIDO-6 · confirmado", (await confirmarPedido(p6)) === "CONFIRMED", "");

  const abaVelha = await novaAba();
  await comAba(abaVelha, async () => {
    await abrir(p6.url, { espera: ".doc-title h1" });
    await page.waitForTimeout(2000);
    if (!(await existeBotao("Cancelar pedido"))) return;
    await clicarBotao("Cancelar pedido");
    await preencher("#co-cancel-reason", "ADV cancelamento enviado de tela anterior ao atendimento");
  });

  // Aba A leva o pedido para IN_FULFILLMENT, gerando uma OP.
  await abrir(p6.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(2500);
  await clicarBotao("Aplicar Plano de Atendimento");
  await confirmarDialogo("Aplicar Plano");
  await page.waitForTimeout(3200);
  const ped6 = await lerPedido(p6.id);
  if (!check("PEDIDO-6 · entrou Em atendimento com OP gerada", ped6.status === "IN_FULFILLMENT" && (ped6.generatedProductionOrders ?? []).length > 0, ped6.status)) {
    await abaVelha.close();
    return;
  }
  const opsP6 = ped6.generatedProductionOrders ?? [];
  S.dados.ops.OP6 = { id: opsP6[0].id, code: opsP6[0].code, url: `/producao/ordens/${opsP6[0].id}` };
  salvarEstado();

  const fotoAntes = await fotografar("antes do cancelamento pela aba velha");
  let resultado = "";
  await deliberadamente("PROIBIDO-25b", async () => {
    await comAba(abaVelha, async () => {
      if ((await page.locator("#co-cancel-reason").count()) === 0) {
        resultado = "(a aba velha não tinha o diálogo de cancelamento armado)";
        return;
      }
      await confirmarModal("Cancelar pedido");
      await page.waitForTimeout(2800);
      resultado = JSON.stringify(await mensagensDeErro());
    });
  });
  const fotoDepois = await fotografar("depois");
  const mudou = diffFoto(fotoAntes, fotoDepois);
  const final = await lerPedido(p6.id);
  const naoCancelou = final.status !== "CANCELLED";

  registrarCaso("PROIBIDO-25b · cancelar pedido pela aba anterior ao atendimento", {
    pre: `${p6.code} estava CONFIRMED quando a aba B abriu o diálogo de cancelamento; a aba A aplicou o Plano e gerou ${opsP6[0].code}`,
    acao: "confirmar o cancelamento pela aba B, cuja tela ainda acredita que o pedido é cancelável",
    esperado: "o servidor revalida o estágio e recusa — o portão não pode viver só no botão que some",
    real: `${resultado} · status final ${final.status} · ${mudou}`,
    invariante: "nenhum cancelamento em cascata: a OP gerada continua de pé e o pedido continua Em atendimento",
    veredito: naoCancelou && mudou === "nada mudou" ? "BLOCKED_CORRECTLY" : "BUG",
  });
  registrarNegativo(
    "PROIBIDO-25b · cancelar pedido Em atendimento vindo de tela velha",
    naoCancelou && mudou === "nada mudou" ? "BLOCKED_CORRECTLY" : "BUG",
    `status ${final.status} · ${mudou}`,
  );
  check(
    "NEGATIVO · o servidor recusou o cancelamento enviado da tela anterior ao atendimento",
    naoCancelou && mudou === "nada mudou",
    `${resultado} · ${mudou}`,
  );
  await comAba(abaVelha, () => shot("adv-pedido-cancelamento-aba-velha"));
  await abaVelha.close();
  S.dados.provaCancelamentoServidor = true;
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 15 · Varredura de console nas telas tocadas
// ══════════════════════════════════════════════════════════════════════════
/**
 * Passa por cada documento que a onda criou, sem escrever nada.
 *
 * Os marcos anteriores rodaram em execuções separadas e a contagem de
 * console/rede não sobrevive ao processo. Esta varredura é a leitura única
 * que fecha o relatório: se alguma tela do escopo quebra ao renderizar o
 * estado final, é aqui que aparece.
 */
async function marco14VarreduraDeConsole() {
  const antesConsole = consoleErrors.length;
  const antesPageError = pageErrors.length;
  const antesRede = respostasComErro.length;

  const rotas = [];
  for (const chave of Object.keys(S.dados.pedidos ?? {})) rotas.push(S.dados.pedidos[chave].url);
  for (const chave of Object.keys(S.dados.ops ?? {})) rotas.push(S.dados.ops[chave].url);
  rotas.push(
    "/comercial/pedidos",
    "/producao/ordens",
    "/estoque/lotes",
    `/estoque/${S.dados.mp.id}`,
    `/estoque/${S.dados.mp2.id}`,
    `/estoque/${S.dados.itemPa.id}`,
    `/estoque/movimentacoes?itemId=${S.dados.itemPa.id}`,
    `/producao/formulacoes/${S.dados.produto.id}`,
  );
  if (S.dados.lotePa) rotas.push(`/estoque/lotes/${S.dados.lotePa.id}`);

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
  check("CONSOLE · nenhuma exceção não tratada (pageerror) nas telas do escopo", novosPageError.length === 0, JSON.stringify(novosPageError.slice(0, 5)));
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
  salvarEstado();
  anotar(`VARREDURA · ${rotas.length} telas abertas · console ${novosConsole.length} · pageerror ${novosPageError.length} · >=400 ${novosRede.length}`);
  await shot("adv-op-varredura-console");
}

// ══════════════════════════════════════════════════════════════════════════
// Execução
// ══════════════════════════════════════════════════════════════════════════
let parada = null;

async function principal() {
  await login();
  await abrirNavegador();

  await marco(1, "massa-material", marco01Massa);
  await marco(2, "produto-e-formulacao", marco02ProdutoEFormulacao);
  await marco(3, "pedido-estoque-zero", marco03PedidoEstoqueZero);
  await marco(4, "liberacao-da-op", marco04LiberacaoDaOp);
  await marco(5, "separacao", marco05Separacao);
  await marco(6, "consumo-real", marco06ConsumoReal);
  await marco(7, "proibidos-da-conclusao", marco07ProibidosDaConclusao);
  await marco(8, "conclusao", marco08Conclusao);
  await marco(9, "liberar-produto-acabado", marco09LiberarProdutoAcabado);
  await marco(10, "pedidos-competindo", marco10PedidosCompetindo);
  await marco(11, "cancelamentos", marco11Cancelamentos);
  await marco(12, "outras-portas", marco12OutrasPortas);
  // O ledger fecha a onda: depois de tudo, cada lote tem de bater de novo.
  await marco(13, "cancelamento-no-servidor", marco14CancelamentoNoServidor);
  // Os dois últimos fecham a onda e por isso rodam sempre: depois de tudo,
  // cada lote tem de bater de novo e nenhuma tela pode estar quebrada.
  S.marcos = S.marcos.filter(
    (m) => m !== "14-ledger" && m !== "13-ledger" && m !== "12-ledger" && m !== "15-varredura-de-console" && m !== "14-varredura-de-console",
  );
  await marco(14, "ledger", marco12Ledger);
  await marco(15, "varredura-de-console", marco14VarreduraDeConsole);
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

    // Publica o que ESTA execucao produziu, para a suite seguinte da
    // cadeia reencontrar por id em vez de por codigo cravado no script.
    publicar("production", {
      runId: RUN.runId,
      prefixo: P,
      produto: S.dados.produto ?? null,
      itemPa: S.dados.itemPa ?? null,
      mp: S.dados.mp ?? null,
      mp2: S.dados.mp2 ?? null,
      lotePa: S.dados.lotePa ?? null,
    });

    const reg = S.registro;
    console.log("\n════════════════════ RESUMO ════════════════════");
    console.log(`run: ${RUN.runId} · prefixo de massa: ${P}`);
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
