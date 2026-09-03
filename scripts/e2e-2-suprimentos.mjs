import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E-2 — Cenário SUPRIMENTOS → PRODUTO DIRETO, INTEIRO PELA INTERFACE.
 *
 * A regra que define esta validação é a mesma do E2E-1: **todo dado de
 * negócio nasce pela UI**. Nada de Prisma, SQL, `POST` de API ou fixture
 * para criar fornecedor, item, ordem de compra, recebimento, lote, cliente,
 * produto, formulação, estrutura de custos, cálculo, pedido ou ordem de
 * produção.
 *
 * Fora da UI só é permitido:
 *  - `POST /auth/login`, uma vez, para obter o cookie de sessão do navegador;
 *  - leituras (`GET`) como conferência secundária do que a tela afirmou;
 *  - instrumentação (console, rede, screenshots, downloads).
 *
 * Se uma etapa não puder ser concluída pela interface, o cenário FALHA ali —
 * e isso é resultado, não fracasso. Nenhuma etapa é "pulada por API".
 *
 * ## O que este cenário prova que o E2E-1 não provou
 *
 * O E2E-1 nasceu do COMERCIAL: projeto → produto → orçamento. Este nasce do
 * chão de fábrica e chega ao produto pelo outro lado — o cadastro DIRETO, sem
 * projeto nenhum. As diferenças são o alvo:
 *
 *  - produto direto nasce APROVADO e SEM formulação (o de projeto nasce em
 *    desenvolvimento e já com V1 em rascunho);
 *  - a formulação precisa ser criada EM BRANCO, pela tela;
 *  - o cliente e o item de embalagem nascem por CRIAÇÃO CONTEXTUAL, a partir
 *    do campo de busca de outro formulário, com o rascunho de origem
 *    sobrevivendo a um F5 na tela de criação.
 *
 * Massa técnica: Vitamina D3 60 cápsulas — um ativo (premix 100.000 UI/g),
 * dois excipientes e um pote. Dados independentes do E2E-1, prefixados
 * `E2E2`.
 *
 * ## O que mudou desde a execução anterior deste script
 *
 * Cinco mudanças de produto entraram entre uma execução e outra, e o script
 * foi reescrito para EXERCITÁ-LAS, não para desviar delas:
 *
 *  1. a OP não conclui com material por reconciliar — um material fica sem
 *     consumo DE PROPÓSITO, para o bloqueio ser medido, e só depois é
 *     resolvido por consumo parcial + justificativa por linha;
 *  2. Recurso Industrial passou a `RIN` (Recebimento continua `REC`) — os
 *     dois prefixos são conferidos lado a lado;
 *  3. a vírgula decimal passou a funcionar — antes era defeito reconfirmado,
 *     agora é comportamento esperado em CINCO campos, um deles atravessando
 *     uma ativação;
 *  4. a trilha virou link de verdade em telas de documento — as subidas são
 *     CLICADAS, e as telas que ficaram com trilha de texto são medidas;
 *  5. seis telas de gestão ganharam "Como funciona" — Precificação e Cálculo
 *     de custo, que não tinham nenhuma, são conferidas por tópico próprio.
 *
 * Esperado nesta versão: ZERO `RangeError`. A recursão da validação nativa
 * pt-BR foi corrigida; se voltar a aparecer, é regressão e vira finding.
 *
 *   pnpm exec dotenv -e .env -- node scripts/e2e-2-suprimentos.mjs
 */

const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "handoff/screens/e2e2";
const BAIXADOS = "handoff/e2e2-downloads";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

/**
 * Retomada entre execuções — mesma razão do E2E-1: a jornada cria dados que
 * NÃO são limpos no fim, e uma parada no marco 12 não pode obrigar a refazer
 * os 11 anteriores, o que duplicaria fornecedor, itens e ordens na base.
 *
 *   --reset  ignora o estado e começa do zero
 *   --ate=N  para depois do marco N
 */
const STATE_FILE = path.resolve("handoff/e2e2-state.json");
const RESET = process.argv.includes("--reset");
const ATE = Number(
  (process.argv.find((a) => a.startsWith("--ate=")) ?? "--ate=99").slice("--ate=".length),
);

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BAIXADOS, { recursive: true });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

const S =
  !RESET && fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    : { marcos: [], dados: {}, iniciadoEm: new Date().toISOString() };

S.registro = S.registro ?? { vazios: [], observacoes: [], ergonomia: [], findings: [], ajuda: [] };
S.registro.separadores = S.registro.separadores ?? [];

function acumular(lista, itens, chave) {
  for (const item of itens) {
    const id = chave(item);
    if (!lista.some((x) => chave(x) === id)) lista.push(item);
  }
}

function salvarEstado() {
  acumular(S.registro.vazios, vazios, (v) => `${v.tela}::${v.texto}`);
  acumular(S.registro.observacoes, observacoes, (o) => o);
  acumular(S.registro.ergonomia, ergonomia, (e) => e);
  acumular(S.registro.findings, findings, (f) => f.titulo);
  acumular(S.registro.ajuda, ajudas, (a) => a.tela);
  acumular(S.registro.separadores, separadores, (s) => `${s.campo}::${s.digitado}::${s.onde}`);
  fs.writeFileSync(STATE_FILE, JSON.stringify(S, null, 2));
}

// ── Sessão técnica (única exceção de escrita fora da UI: o login) ──────────
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

/*
 * O veredito vale para a JORNADA, não para a última execução.
 *
 * Marco concluído não roda de novo — é o que impede a retomada de duplicar
 * fornecedor e ordem na base. O efeito colateral é que a prova exercitada no
 * marco 3 não reaparece numa execução que começa no 15, e um relatório que só
 * olhasse a execução corrente diria "não exercitada" sobre algo que passou.
 * Cada resultado fica gravado junto do resto do estado.
 */
S.registro.verificacoes = S.registro.verificacoes ?? { ok: [], nok: [] };

function registrarVerificacao(label, passou) {
  const registro = S.registro.verificacoes;
  const lista = passou ? registro.ok : registro.nok;
  const oposta = passou ? registro.nok : registro.ok;
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

/** Defeito de produto encontrado. Relatar, nunca consertar. */
const findings = [];
function finding(severidade, titulo, comoReproduzir) {
  findings.push({ severidade, titulo, comoReproduzir });
  console.log(`  ⚑ ${severidade} — ${titulo}`);
}

const vazios = [];
function registrarVazio(tela, texto) {
  vazios.push({ tela, texto });
  console.log(`  ∅ ${tela}: "${texto}"`);
}

const ergonomia = [];
function ergo(texto) {
  ergonomia.push(texto);
  console.log(`  ⏱ ${texto}`);
}

/** Leitura integral de cada painel de ajuda contextual visitado. */
const ajudas = [];

// ── Identidades sintéticas ────────────────────────────────────────────────
const P = "E2E2";
const IDENT = {
  fornecedor: {
    legalName: `${P} Fornecedor Insumos LTDA`,
    tradeName: `${P} Fornecedor Insumos`,
    // Dígitos verificadores calculados; empresa inexistente.
    cnpj: "44.555.666/0001-81",
    email: "vendas@e2e2insumos.example.com",
    phone: "(11) 4002-8925",
  },
  cliente: {
    legalName: `${P} Cliente Produto Direto LTDA`,
    tradeName: `${P} Cliente Produto Direto`,
    cnpj: "55.666.777/0001-81",
    email: "suprimentos@e2e2cliente.example.com",
    phone: "(21) 4002-8926",
    zip: "20040-020",
    street: "Rua Sintetica do Cenario 2",
    number: "220",
    district: "Centro",
    city: "Rio de Janeiro",
    state: "RJ",
  },
};

/**
 * Massa técnica da Vitamina D3 60 cápsulas.
 *
 * O ativo entra como PREMIX 100.000 UI/g: 2.000 UI por cápsula = 20 mg de
 * premix. É assim que a dose sai em número redondo sem inventar pureza.
 */
const MP = [
  { nome: `${P} Vitamina D3 premix 100000UI/g`, mgPorDose: 20, precoKg: 900, comprar: "2" },
  { nome: `${P} Celulose microcristalina 102`, mgPorDose: 380, precoKg: 28, comprar: "15" },
  { nome: `${P} Estearato de magnesio vegetal`, mgPorDose: 6, precoKg: 48, comprar: "2" },
];
/** Criada por CRIAÇÃO CONTEXTUAL, dentro da ordem de compra. */
const EMBALAGEM = { nome: `${P} Pote PET 60 capsulas`, unidade: "un", preco: "1.35", comprar: "600" };

const PRODUTO = {
  nome: `${P} Vitamina D3 60 capsulas`,
  capsulasPorDose: "1",
  dosesPorPote: "60",
  unidadesPorCaixa: "24",
  vidaUtil: "24",
  loteMinimo: "500",
  referenciaExterna: "E2E2-D3-60",
  notas: "Rascunho preservado pela criacao contextual de cliente.",
};

const QUANTIDADE_PEDIDA = 500;
const QUANTIDADE_PRODUZIDA = 500;
const LOTE_VERIDI = "E2E2-D3-001";

/** Premissa de custo adicional — digitada com vírgula e conferida após a ativação. */
const PREMISSA_VALOR = "2.80";

// ── Instrumentação de navegador ───────────────────────────────────────────
const consoleErrors = [];
const pageErrors = [];
const avisosDeRede = [];
const respostasComErro = [];
let janelaDeliberada = null;
const deliberados = { console: [], rede: [], pageerror: [] };

const dialogosNativos = [];
const screenshots = [];
/** `GET /items?...` observados — a prova de que a busca vai ao servidor. */
const buscasDeItem = [];

let browser;
let page;

async function abrirNavegador() {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
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
  page.on("request", (req) => {
    if (req.method() !== "GET") return;
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return;
    }
    if (u.origin !== API || u.pathname !== "/items") return;
    buscasDeItem.push({
      search: u.searchParams.get("search"),
      type: u.searchParams.get("type"),
      query: u.search,
      em: Date.now(),
    });
  });
}

/** Executa `fn` marcando toda falha de console/rede como deliberada. */
async function deliberadamente(rotulo, fn) {
  janelaDeliberada = rotulo;
  try {
    return await fn();
  } finally {
    janelaDeliberada = null;
  }
}

let contadorDeShot = 0;
const shot = async (nome) => {
  await page.waitForTimeout(250);
  contadorDeShot += 1;
  const destino = path.join(OUT, `${nome}.png`);
  await page.screenshot({ path: destino, fullPage: false });
  screenshots.push(path.resolve(destino));
  return destino;
};

// ── Ferramentas de navegação (herdadas do E2E-1) ──────────────────────────
async function abrir(rota, { espera = ".page__title, .consult-head, .doc-title", ms = 30000 } = {}) {
  const t0 = Date.now();
  await page.goto(`${WEB}${rota}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector(espera, { timeout: ms });
  } catch {
    /* a checagem de quem chamou é que julga */
  }
  await page.waitForTimeout(250);
  const gasto = Date.now() - t0;
  if (gasto > 4000) ergo(`carregamento longo: ${rota} levou ${gasto}ms até "${espera}"`);
  return gasto;
}

const caminho = () => new URL(page.url()).pathname;
const urlCompleta = () => page.url().replace(WEB, "");

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

async function clicarLink(texto, { timeout = 15000 } = {}) {
  const alvo = page.getByRole("link", { name: texto, exact: true }).first();
  await alvo.waitFor({ state: "visible", timeout });
  await alvo.click();
  await page.waitForTimeout(500);
}

async function existeBotao(texto) {
  return (await page.getByRole("button", { name: texto, exact: true }).count()) > 0;
}

async function preencher(seletor, valor) {
  const el = page.locator(seletor).first();
  await el.waitFor({ state: "visible", timeout: 15000 });
  await el.fill(String(valor));
  await page.waitForTimeout(80);
}

async function selecionar(seletor, valor) {
  const el = page.locator(seletor).first();
  await el.waitFor({ state: "visible", timeout: 15000 });
  await el.selectOption(valor);
  await page.waitForTimeout(120);
}

async function texto(seletor) {
  const el = page.locator(seletor).first();
  if ((await el.count()) === 0) return "";
  return ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

async function textos(seletor) {
  return (await page.locator(seletor).allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
}

async function mensagensDeErro() {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".form-alert, .field__error, .alert--error, [role='alert'], .toast--error, .doc-alert",
      ),
    ]
      .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
}

async function valoresDoFormulario() {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("input, select, textarea")]
        .filter((el) => el.id && el.type !== "hidden")
        .map((el) => [el.id, el.value]),
    ),
  );
}

const marco = async (n, nome, fn) => {
  const chave = `${n}-${nome}`;
  if (S.marcos.includes(chave)) {
    console.log(`\n═══ MARCO ${n} · ${nome} — já concluído em execução anterior, pulando`);
    return;
  }
  if (n > ATE) {
    console.log(`\n═══ MARCO ${n} · ${nome} — além de --ate=${ATE}, parando`);
    throw new Error("__PARADA_SOLICITADA__");
  }
  console.log(`\n═══ MARCO ${n} · ${nome} ═══`);
  const antes = failures.length;
  await fn();
  if (failures.length === antes) {
    S.marcos.push(chave);
    salvarEstado();
  } else {
    salvarEstado();
    throw new Error(`__MARCO_FALHOU__ ${chave}`);
  }
};

/**
 * Escolhe uma entidade num `SearchableEntitySelect`.
 *
 * A lista sai por PORTAL em `document.body`, a busca vai ao servidor com
 * 200ms de debounce, e a PRIMEIRA opção é sempre "+ Novo <entidade>" — que
 * contém o texto digitado. Sem `:not(.entity-select__create)` o clique acerta
 * o cadastro e leva o formulário embora.
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
  const titulo = await texto(".confirm-dialog #confirm-dialog-title, .confirm-dialog h2");
  await dialogo.getByRole("button", { name: textoBotao, exact: true }).click();
  await page.waitForTimeout(900);
  return titulo;
}

async function confirmarModal(textoBotao) {
  const botao = page.getByRole("button", { name: textoBotao, exact: true }).last();
  await botao.waitFor({ state: "visible", timeout: 20000 });
  await botao.click();
  await page.waitForTimeout(700);
}

/** Seção de formulário pelo título do `<h3>` — escopo estável entre re-renders. */
const secao = (titulo) =>
  page
    .locator("section.form-section")
    .filter({ has: page.locator("h3", { hasText: titulo }) });

const hoje = () => new Date().toISOString().slice(0, 10);
const daquiAnos = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Campos decimais em que a vírgula brasileira foi digitada DE PROPÓSITO.
 *
 * A prova pedida não é "o número gravou": é "o número gravou com VÍRGULA".
 * Sem esta lista, um relatório que só dissesse "tarifa cadastrada" esconderia
 * uma retentativa com ponto — que é exatamente o defeito que existiu aqui.
 */
const separadores = [];
function registrarSeparador(registro) {
  separadores.push(registro);
  console.log(`  , ${registro.campo} ← "${registro.digitado}" → ${registro.como}`);
}

/** O mesmo número como a pessoa digita em português. */
const comoDigitado = (valor) => String(valor).replace(".", ",");

const separadorPorCampo = {};

/**
 * Campo decimal em tela pt-BR: a VÍRGULA é o comportamento esperado.
 *
 * A versão anterior deste script tratava a vírgula como defeito a
 * reconfirmar — digitava, via falhar, retentava com ponto e reportava. A
 * correção entrou; então a ordem se inverte: a vírgula tem de gravar, e é a
 * necessidade de ponto que vira finding de REGRESSÃO. A retentativa continua
 * existindo só para a jornada não parar num campo — o veredito já terá sido
 * dado antes dela.
 */
async function decimalComVirgula({ campo, valor, acao, confirmou, ondeNaTela }) {
  const comVirgula = comoDigitado(valor);
  await preencher(campo, comVirgula);
  await deliberadamente(`decimal-virgula:${campo}`, async () => {
    await acao();
    await page.waitForTimeout(1600);
  });
  if (await confirmou()) {
    separadorPorCampo[campo] = "virgula";
    S.dados.separadorPorCampo = { ...(S.dados.separadorPorCampo ?? {}), [campo]: "virgula" };
    registrarSeparador({ campo, onde: ondeNaTela, digitado: comVirgula, como: "virgula" });
    check(`DECIMAL · ${ondeNaTela} aceita a vírgula brasileira ("${comVirgula}")`, true);
    return "virgula";
  }

  const errosComVirgula = await mensagensDeErro();
  check(
    `DECIMAL · ${ondeNaTela} aceita a vírgula brasileira ("${comVirgula}")`,
    false,
    JSON.stringify(errosComVirgula),
  );
  finding(
    "HIGH",
    `REGRESSÃO · campo decimal "${campo}" voltou a recusar a vírgula brasileira (${ondeNaTela})`,
    `${ondeNaTela} · digitar "${comVirgula}" em ${campo} e executar a ação: nada é gravado e a tela ` +
      `devolve ${JSON.stringify(errosComVirgula)}. A vírgula passou a ser aceita em 7cb5fdb ` +
      "(apps/web/src/lib/decimal-input.ts normaliza na tela e apps/api/src/lib/decimal-schema.ts " +
      "aceita no servidor); voltar a recusar é regressão dessa correção.",
  );

  await preencher(campo, String(valor));
  await acao();
  await page.waitForTimeout(1500);
  if (!(await confirmou())) {
    separadorPorCampo[campo] = "falhou";
    return "falhou";
  }
  separadorPorCampo[campo] = "ponto";
  S.dados.separadorPorCampo = { ...(S.dados.separadorPorCampo ?? {}), [campo]: "ponto" };
  return "ponto";
}

/**
 * Abre a ajuda contextual da tela, lê o painel INTEIRO e o guarda.
 *
 * Não basta o modal abrir: o que se mede é se ele responde "o que é esta
 * tela", "quando eu uso" e "o que acontece depois".
 */
async function lerAjuda(tela, { indice = 0 } = {}) {
  const gatilho = page.locator("button.context-help__trigger").nth(indice);
  if ((await gatilho.count()) === 0) return null;
  await gatilho.scrollIntoViewIfNeeded();
  await gatilho.click();
  await page.waitForSelector(".help-modal", { timeout: 20000 });
  await page.waitForTimeout(300);

  const painel = await page.evaluate(() => {
    const raiz = document.querySelector(".help-modal");
    if (!raiz) return null;
    const limpar = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      titulo: limpar(raiz.querySelector(".help-modal__title")),
      resumo: limpar(raiz.querySelector(".help-modal__summary")),
      conceitos: [...raiz.querySelectorAll(".help-modal__concepts dt")].map((dt) => ({
        termo: limpar(dt),
        texto: limpar(dt.nextElementSibling),
      })),
      fluxos: [...raiz.querySelectorAll(".help-modal__flow")].map((sec) => ({
        nome: limpar(sec.querySelector(".help-modal__flow-name")),
        quando: limpar(sec.querySelector(".help-modal__flow-when")),
        etapas: [...sec.querySelectorAll(".help-modal__steps li")].map(limpar),
        caixas: [...sec.querySelectorAll("li")].map(limpar).filter(Boolean).slice(0, 24),
      })),
      integral: limpar(raiz),
    };
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const t = painel?.integral ?? "";
  const registro = {
    tela,
    titulo: painel?.titulo ?? "",
    resumo: painel?.resumo ?? "",
    conceitos: (painel?.conceitos ?? []).length,
    fluxos: (painel?.fluxos ?? []).map((f) => ({
      nome: f.nome,
      quando: f.quando,
      etapas: f.etapas.length,
    })),
    tamanho: t.length,
    // "O que é esta tela" — resumo próprio, não só o título repetido.
    oQueE: (painel?.resumo ?? "").length > 60,
    // "Quando eu uso" — condição declarada em algum fluxo, ou o texto diz a
    // situação em que a tela entra.
    quandoUso:
      (painel?.fluxos ?? []).some((f) => f.quando.length > 0) ||
      /\bquando\b|\bcaso\b|\bse (você|o|a)\b|situação/i.test(t),
    // "O que acontece depois" — consequência do ato da tela.
    oQueAcontece:
      /depois|em seguida|passa a|vira |gera |cria |a partir daí|dali em diante|resulta|próxim/i.test(
        t,
      ),
    integral: t,
  };
  ajudas.push(registro);
  return registro;
}

// ══════════════════════════════════════════════════════════════════════════
// A JORNADA — 18 marcos, todos pela interface
// ══════════════════════════════════════════════════════════════════════════

// ── MARCO 1 · Fornecedor ──────────────────────────────────────────────────
async function marco01Fornecedor() {
  await abrir("/cadastros/fornecedores");
  const existentes = (await apiGet(`/suppliers?search=${encodeURIComponent(P)}&pageSize=20`))
    .suppliers ?? [];
  if (existentes.length > 0) {
    S.dados.fornecedor = { id: existentes[0].id, code: existentes[0].code };
    anotar(`FORNECEDOR · ${existentes[0].code} já existia de execução anterior — marco pulado`);
    return;
  }

  await clicarLink("+ Novo fornecedor");
  const foi = await esperarUrl((u) => u.pathname === "/cadastros/fornecedores/novo", 20000);
  check(
    "FORNECEDOR · o botão da listagem leva à tela oficial, com URL própria",
    foi && (await texto(".page__title")) === "Novo fornecedor",
    `${caminho()} · título="${await texto(".page__title")}"`,
  );

  const f = IDENT.fornecedor;
  await preencher("#supplier-legal-name", f.legalName);
  await preencher("#supplier-trade-name", f.tradeName);
  await preencher("#supplier-cnpj", f.cnpj);
  await preencher("#supplier-email", f.email);
  await preencher("#supplier-phone", f.phone);
  await shot("e2e2-01a-fornecedor-preenchido");
  await clicarBotao("Criar fornecedor");

  const voltou = await esperarUrl((u) => u.pathname === "/cadastros/fornecedores", 25000);
  if (!check("FORNECEDOR · salvar leva de volta à lista", voltou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(700);
  await preencher("#suppliers-search", P);
  await page.waitForTimeout(1400);
  const linhas = await textos("table tbody tr");
  check(
    "FORNECEDOR · o fornecedor novo aparece na busca por E2E2, com código FOR gerado",
    linhas.length === 1 && /FOR-\d+/.test(linhas[0]) && linhas[0].includes(f.legalName),
    JSON.stringify(linhas),
  );
  await shot("e2e2-01-fornecedor");

  const lidos = (await apiGet(`/suppliers?search=${encodeURIComponent(P)}&pageSize=20`)).suppliers ?? [];
  check(
    "FORNECEDOR · a leitura técnica confirma o registro nascido pela tela, com CNPJ gravado",
    lidos.length === 1 && Boolean(lidos[0].cnpj) && Boolean(lidos[0].email),
    JSON.stringify(lidos.map((x) => `${x.code}/${x.cnpj}`)),
  );
  if (lidos[0]) S.dados.fornecedor = { id: lidos[0].id, code: lidos[0].code };
}

// ── MARCO 2 · Itens de estoque (as três matérias-primas) ──────────────────
async function marco02Itens() {
  await abrir("/cadastros/itens");
  S.dados.itens = S.dados.itens ?? {};

  const jaExistem = new Set(
    ((await apiGet(`/items?search=${encodeURIComponent(P)}&pageSize=50`)).items ?? []).map(
      (i) => i.name,
    ),
  );

  for (const mp of MP) {
    if (jaExistem.has(mp.nome)) {
      anotar(`ITEM · "${mp.nome}" já existia — criação pulada`);
      continue;
    }
    await abrir("/cadastros/itens/novo");
    await selecionar("#item-type", "RAW_MATERIAL");
    await selecionar("#item-unit", "kg");
    await preencher("#item-name", mp.nome);
    await clicarBotao("Criar item");
    const ok = await esperarUrl((u) => u.pathname === "/cadastros/itens", 25000);
    if (!check(`ITEM · "${mp.nome}" foi criado e a tela voltou à lista`, ok, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
  }

  await abrir("/cadastros/itens");
  await preencher("#items-search", P);
  await page.waitForTimeout(1400);
  /*
   * A contagem é dos MP, não das linhas: numa reexecução a mesma busca já
   * traz a embalagem e o item de produto acabado que nascerão adiante, e
   * exigir "exatamente três linhas" reprovaria o que está certo.
   */
  const codigos = await textos("table tbody tr td.is-code");
  check(
    "ITEM · as três matérias-primas E2E2 aparecem na busca, com prefixo MP",
    codigos.filter((c) => c.startsWith("MP-")).length === MP.length,
    JSON.stringify(codigos),
  );
  await shot("e2e2-02-itens");

  for (const it of (await apiGet(`/items?search=${encodeURIComponent(P)}&pageSize=50`)).items ?? []) {
    S.dados.itens[it.name] = { id: it.id, code: it.code, type: it.type };
  }
  anotar(
    `ITEM · a embalagem "${EMBALAGEM.nome}" NÃO foi criada aqui de propósito — ` +
      "ela nasce por criação contextual dentro da ordem de compra (marco 3)",
  );
}

// ── MARCO 3 · Compra + CRIAÇÃO CONTEXTUAL nº 1 ────────────────────────────
/**
 * Espera a tela de criação contextual TERMINAR de renderizar.
 *
 * `navigate()` troca a URL antes de o React montar a página nova. Ler o
 * botão "← Voltar para X" no instante da troca devolve string vazia e
 * acusaria a tela de não dizer para onde volta — defeito de script, não de
 * produto.
 */
async function esperarTelaDeCriacao(titulo) {
  await page.waitForSelector(".page__title", { timeout: 20000 });
  await page
    .locator(".page__title", { hasText: titulo })
    .first()
    .waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(400);
}

/**
 * Prova de que "+ Novo item de estoque" leva à tela canônica e VOLTA inteiro.
 *
 * Roda quando a embalagem já existe (reexecução): o item não pode ser criado
 * de novo sem duplicar o catálogo, mas o mecanismo continua sendo o que
 * precisa ser provado — a saída, o token na URL, o rótulo de volta e o
 * rascunho da ordem intacto. O caminho de CANCELAMENTO é justamente o que a
 * criação bem-sucedida não exercita.
 */
async function provarIdaEVoltaContextual() {
  await abrir("/compras/ordens/nova", { espera: ".doc-title h1" });
  await page.waitForSelector("#po-supplier", { timeout: 20000 });
  await escolherEntidade("#po-supplier", IDENT.fornecedor.tradeName, IDENT.fornecedor.tradeName);
  await preencher("#po-order-date", hoje());
  await clicarBotao("+ Adicionar item");
  await page.waitForTimeout(300);
  const combo = page.locator('input[id^="po-line-item-"]').first();
  await escolherEntidade(combo, MP[0].nome, MP[0].nome);
  const rascunhoAntes = await valoresDoFormulario();

  await clicarBotao("+ Adicionar item");
  await page.waitForTimeout(300);
  const segundo = page.locator('input[id^="po-line-item-"]').nth(1);
  await segundo.click();
  await segundo.fill(EMBALAGEM.nome);
  await page.waitForTimeout(1200);
  const resultados = await page
    .locator("li.entity-select__option[role='option']:not(.entity-select__create)")
    .count();
  check(
    "PROVA 1a · o cadastro no contexto é oferecido MESMO com resultado na busca",
    resultados >= 1 && (await page.locator("li.entity-select__create").count()) === 1,
    `resultados=${resultados}`,
  );
  await page.locator("li.entity-select__create").click();

  const foi = await esperarUrl(
    (u) => u.pathname === "/cadastros/itens/novo" && u.searchParams.has("origem"),
    20000,
  );
  check(
    "PROVA 1a · o cadastro contextual NAVEGA para a página canônica do item, com token de origem",
    foi,
    urlCompleta(),
  );
  await esperarTelaDeCriacao("Novo item de estoque");
  const voltarPara = await texto(".page__header button.btn--ghost");
  check(
    "PROVA 1a · a tela de criação diz PARA ONDE se volta",
    /Voltar para Ordem de compra/i.test(voltarPara),
    `"${voltarPara}"`,
  );
  const trilha = await textos("nav.page-crumbs li");
  check(
    "PROVA 1a · a trilha continua canônica (Cadastros › Itens de estoque › Novo item de estoque)",
    trilha.join(" › ") === "Cadastros › Itens de estoque › Novo item de estoque",
    JSON.stringify(trilha),
  );
  await shot("e2e2-03a-criacao-contextual-item");

  const itensAntes = ((await apiGet(`/items?search=${encodeURIComponent(P)}&pageSize=50`)).items ?? [])
    .length;
  await clicarBotao("← Voltar para Ordem de compra");
  const voltou = await esperarUrl((u) => u.pathname === "/compras/ordens/nova", 25000);
  check("PROVA 1a · o botão de volta devolve à ordem de compra de origem", voltou, urlCompleta());
  await page.waitForTimeout(1800);

  const rascunhoDepois = await valoresDoFormulario();
  const primeiraLinha = await page.locator('input[id^="po-line-item-"]').first().inputValue();
  check(
    "PROVA 1a · cancelar preserva o rascunho da ordem (data e a linha já escolhida)",
    rascunhoDepois["po-order-date"] === rascunhoAntes["po-order-date"] &&
      primeiraLinha.includes(S.dados.itens[MP[0].nome]?.code ?? "MP-"),
    `data="${rascunhoDepois["po-order-date"]}" linha1="${primeiraLinha}"`,
  );
  const itensDepois = ((await apiGet(`/items?search=${encodeURIComponent(P)}&pageSize=50`)).items ?? [])
    .length;
  check(
    "PROVA 1a · voltar sem salvar NÃO cria item nenhum no catálogo",
    itensDepois === itensAntes,
    `antes=${itensAntes} depois=${itensDepois}`,
  );
  await shot("e2e2-03b-volta-sem-criar");
}

async function marco03Compra() {
  const embalagemNoCatalogo =
    (await apiGet(`/items?search=${encodeURIComponent(EMBALAGEM.nome)}`)).items ?? [];

  if (S.dados.ordemDeCompra) {
    /*
     * Reexecução. A ordem e a embalagem já nasceram pela interface numa
     * passagem anterior — recriar duplicaria o catálogo. O que se reconfere
     * é o estado da ordem e o mecanismo da criação contextual, pelo caminho
     * que a criação bem-sucedida não percorre: o da volta sem salvar.
     */
    await abrir(S.dados.ordemDeCompra.url, { espera: ".doc-title h1" });
    const situacao = await texto(".doc-title .badge");
    check(
      `OC · ${S.dados.ordemDeCompra.code}, criada pela tela em execução anterior, está congelada`,
      ["Confirmado", "Parcialmente recebido", "Recebido"].includes(situacao),
      situacao,
    );
    // Escopo na seção "Itens": depois do recebimento a página ganha a tabela
    // dos recebimentos, e contar `table tbody tr` cru somaria as duas.
    const linhas = await page
      .locator("section.form-section")
      .filter({ has: page.locator("h3", { hasText: "Itens" }) })
      .locator("table.table tbody tr")
      .allTextContents();
    check(
      "OC · a ordem tem as quatro linhas, incluindo a embalagem nascida no contexto",
      linhas.length === LINHAS_COMPRA.length &&
        linhas.some((l) => l.includes(embalagemNoCatalogo[0]?.code ?? "ME-")),
      JSON.stringify(linhas.map((l) => l.replace(/\s+/g, " ").slice(0, 60))),
    );
    anotar(
      `OC · ${S.dados.ordemDeCompra.code} e o item ${embalagemNoCatalogo[0]?.code} vieram de uma ` +
        "execução anterior deste mesmo script — a embalagem nasceu pelo “+ Novo item de estoque” " +
        "do campo de item da própria ordem",
    );
    await provarIdaEVoltaContextual();
    await abrir(S.dados.ordemDeCompra.url, { espera: ".doc-title h1" });
    await shot("e2e2-03-oc-confirmada");
    return;
  }

  await abrir("/compras/ordens");
  const vazioOc = await texto("td.table__empty");
  if (vazioOc) registrarVazio("Compras › Ordens de Compra", vazioOc);

  await clicarBotao("+ Nova OC");
  const naTela = await esperarUrl((u) => u.pathname === "/compras/ordens/nova", 20000);
  check("OC · a listagem leva à tela de nova ordem", naTela, caminho());
  await page.waitForSelector("#po-supplier", { timeout: 20000 });

  await escolherEntidade("#po-supplier", IDENT.fornecedor.tradeName, IDENT.fornecedor.tradeName);
  await preencher("#po-order-date", hoje());

  // As três matérias-primas, pelo catálogo que já existe.
  for (let i = 0; i < MP.length; i += 1) {
    await clicarBotao("+ Adicionar item");
    await page.waitForTimeout(300);
    const combo = page.locator('input[id^="po-line-item-"]').nth(i);
    await escolherEntidade(combo, MP[i].nome, MP[i].nome);
    const linha = page.locator("table.table tbody tr").nth(i);
    const decimais = linha.locator('input[inputmode="decimal"]');
    await decimais.nth(0).fill(MP[i].comprar);
    await decimais.nth(1).fill(String(MP[i].precoKg));
    await page.waitForTimeout(120);
  }

  // ── PROVA 1a · CRIAÇÃO CONTEXTUAL a partir do campo de item ─────────────
  // A embalagem não existe no catálogo. Descobrir isso NO MEIO da ordem é o
  // caso real: o campo de busca precisa oferecer o cadastro sem perder a
  // ordem que já está montada.
  await clicarBotao("+ Adicionar item");
  await page.waitForTimeout(300);
  const rascunhoAntes = await valoresDoFormulario();
  const comboEmbalagem = page.locator('input[id^="po-line-item-"]').nth(MP.length);
  await comboEmbalagem.click();
  await comboEmbalagem.fill(EMBALAGEM.nome);
  await page.waitForTimeout(1200);

  const semResultado = await page
    .locator("li.entity-select__option[role='option']:not(.entity-select__create)")
    .count();
  check(
    "PROVA 1a · o item que ainda não existe não aparece na busca, e o cadastro é oferecido ali",
    semResultado === 0 && (await page.locator("li.entity-select__create").count()) === 1,
    `resultados=${semResultado}`,
  );
  anotar(`PROVA 1a · opção de cadastro no campo: "${await texto("li.entity-select__create")}"`);

  await page.locator("li.entity-select__create").click();
  const foiParaItem = await esperarUrl(
    (u) => u.pathname === "/cadastros/itens/novo" && u.searchParams.has("origem"),
    20000,
  );
  check(
    "PROVA 1a · o cadastro contextual NAVEGA para a página canônica do item, com token de origem",
    foiParaItem,
    urlCompleta(),
  );
  await esperarTelaDeCriacao("Novo item de estoque");
  const voltarPara = await texto(".page__header button.btn--ghost");
  check(
    "PROVA 1a · a tela de criação diz PARA ONDE se volta",
    /Voltar para Ordem de compra/i.test(voltarPara),
    `"${voltarPara}"`,
  );
  await shot("e2e2-03a-criacao-contextual-item");

  await selecionar("#item-type", "PACKAGING");
  await selecionar("#item-unit", EMBALAGEM.unidade);
  await preencher("#item-name", EMBALAGEM.nome);
  if ((await page.locator("#item-packaging-subtype").count()) > 0) {
    await selecionar("#item-packaging-subtype", "POT");
  }
  await clicarBotao("Criar item");

  const voltou = await esperarUrl((u) => u.pathname === "/compras/ordens/nova", 25000);
  if (!check("PROVA 1a · salvar devolve à ordem de compra de origem", voltou, urlCompleta())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(1800);

  const rascunhoDepois = await valoresDoFormulario();
  check(
    "PROVA 1a · o rascunho da ordem sobreviveu: fornecedor, data e as três linhas continuam lá",
    rascunhoDepois["po-order-date"] === rascunhoAntes["po-order-date"] &&
      (await page.locator('input[id^="po-line-item-"]').count()) === MP.length + 1,
    JSON.stringify({
      data: rascunhoDepois["po-order-date"],
      linhas: await page.locator('input[id^="po-line-item-"]').count(),
    }),
  );

  const itemNovo = (await apiGet(`/items?search=${encodeURIComponent(EMBALAGEM.nome)}`)).items ?? [];
  const valorNoCampo = await page.locator('input[id^="po-line-item-"]').nth(MP.length).inputValue();
  check(
    "PROVA 1a · o item recém-criado voltou SELECIONADO na linha que pediu o cadastro",
    itemNovo.length === 1 && valorNoCampo.includes(itemNovo[0].code),
    `campo="${valorNoCampo}" item=${JSON.stringify(itemNovo.map((i) => i.code))}`,
  );
  if (itemNovo[0]) S.dados.itens[itemNovo[0].name] = { id: itemNovo[0].id, code: itemNovo[0].code };
  await shot("e2e2-03b-item-voltou-selecionado");

  /*
   * DECIMAL 1 · o preço da embalagem é digitado com VÍRGULA, e o que se mede
   * é o TOTAL da ordem.
   *
   * Recusar a vírgula era o defeito conhecido; calcular errado com cara de
   * certo era o pior dele — `Number("1,35")` virava `NaN`, a linha sumia da
   * soma e o rodapé exibia um total MENOR do que a ordem vale, sem sinal
   * nenhum de linha faltando. Conferir só "a ordem salvou" passaria por cima
   * disso; conferir o total contra a conta feita à mão não passa.
   */
  const linhaEmb = page.locator("table.table tbody tr").nth(MP.length);
  const decimaisEmb = linhaEmb.locator('input[inputmode="decimal"]');
  await decimaisEmb.nth(0).fill(EMBALAGEM.comprar);
  await decimaisEmb.nth(1).fill(comoDigitado(EMBALAGEM.preco));
  await page.waitForTimeout(400);

  const totalEsperado = LINHAS_COMPRA.reduce(
    (soma, l) => soma + Number(l.quantidade) * Number(l.preco),
    0,
  );
  const rodape = await texto(".table-foot");
  const totalNaTela = Number(
    (rodape.match(/[\d.]+,\d{2}/) ?? ["0"])[0].replace(/\./g, "").replace(",", "."),
  );
  check(
    `PROVA 4 · com "${comoDigitado(EMBALAGEM.preco)}" na linha, o total da OC soma as 4 linhas ` +
      `(R$ ${totalEsperado.toFixed(2)}) — a linha com vírgula não some da conta`,
    Math.abs(totalNaTela - totalEsperado) < 0.02,
    `rodapé="${rodape}" · lido=${totalNaTela} · esperado=${totalEsperado}`,
  );
  registrarSeparador({
    campo: "Ordem de compra › linha › Preço unitário",
    onde: "Compras › Nova OC › linha da embalagem",
    digitado: comoDigitado(EMBALAGEM.preco),
    como: "virgula",
  });
  anotar(`OC · rodapé com a linha de vírgula somada: "${rodape}"`);
  await shot("e2e2-03c-total-com-virgula");

  await clicarBotao("Salvar rascunho");
  const salvou = await esperarUrl(
    (u) => /^\/compras\/ordens\/[0-9a-f-]{36}$/.test(u.pathname),
    30000,
  );
  if (!check("OC · o rascunho foi salvo e ganhou URL própria", salvou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(700);

  const codigo = await texto(".doc-title h1");
  const situacao = await texto(".doc-title .badge");
  check(
    "OC · nasce como Rascunho, com código OC gerado",
    /^OC-\d+$/.test(codigo) && situacao === "Rascunho",
    `código="${codigo}" situação="${situacao}"`,
  );
  anotar(`OC · ${codigo} com 4 linhas · rodapé "${await texto(".table-foot")}"`);

  await clicarBotao("Confirmar OC");
  const tituloDialogo = await confirmarDialogo("Confirmar");
  check(
    "OC · confirmar pede confirmação explícita antes de congelar a ordem",
    /Confirmar OC/i.test(tituloDialogo),
    tituloDialogo,
  );
  await page.waitForTimeout(1200);
  check(
    "OC · a ordem passou de Rascunho para Confirmado",
    (await texto(".doc-title .badge")) === "Confirmado",
    await texto(".doc-title .badge"),
  );
  S.dados.ordemDeCompra = { code: codigo, url: caminho() };
  salvarEstado();
  await shot("e2e2-03-oc-confirmada");
}


// ── MARCO 4 · Recebimento ─────────────────────────────────────────────────
const LINHAS_COMPRA = [
  ...MP.map((m) => ({ item: m.nome, quantidade: m.comprar, preco: String(m.precoKg) })),
  { item: EMBALAGEM.nome, quantidade: EMBALAGEM.comprar, preco: EMBALAGEM.preco },
];

async function marco04Recebimento() {
  if (S.dados.recebimento) {
    anotar(`RECEBIMENTO · ${S.dados.recebimento.code} já existia — marco pulado`);
    return;
  }

  await abrir("/compras/recebimentos");
  const vazioRec = await texto("td.table__empty");
  if (vazioRec) registrarVazio("Compras › Recebimentos", vazioRec);

  await abrir(S.dados.ordemDeCompra.url, { espera: ".doc-title h1" });
  await clicarBotao("Receber materiais");
  const foi = await esperarUrl((u) => u.pathname === "/compras/recebimentos/novo", 25000);
  if (!check("RECEBIMENTO · “Receber materiais” leva ao recebimento da própria OC", foi, caminho())) {
    return;
  }
  await page.waitForSelector('input[id^="receive-now-"]', { timeout: 30000 });

  await preencher("#receipt-date", hoje());
  await preencher("#receipt-invoice", `NF-E2E2-0001`);

  const campos = page.locator('input[id^="receive-now-"]');
  const quantas = await campos.count();
  check(
    "RECEBIMENTO · a tela abre uma linha para cada item em aberto da OC",
    quantas === LINHAS_COMPRA.length,
    `linhas=${quantas} esperadas=${LINHAS_COMPRA.length}`,
  );

  for (let i = 0; i < quantas; i += 1) {
    const id = await campos.nth(i).getAttribute("id");
    const poLineId = id.replace("receive-now-", "");
    const rotulo = await texto(`section.form-section:has(#${id}) h3`).catch(() => "");
    const linha = LINHAS_COMPRA.find((l) => rotulo.includes(l.item)) ?? LINHAS_COMPRA[i];
    await campos.nth(i).fill(linha.quantidade);
    const loteFornecedor = page.locator(`#supplier-lot-${poLineId}`);
    if ((await loteFornecedor.count()) > 0) {
      await loteFornecedor.fill(`FOR-E2E2-${String(i + 1).padStart(2, "0")}`);
    }
    const validade = page.locator(`#expiry-${poLineId}`);
    if ((await validade.count()) > 0) await validade.fill(daquiAnos(2));
    const custo = page.locator(`#cost-${poLineId}`);
    if ((await custo.count()) > 0) await custo.fill(linha.preco);
  }
  await shot("e2e2-04a-recebimento-preenchido");

  await clicarBotao("Confirmar recebimento");
  const titulo = await confirmarDialogo("Confirmar");
  check(
    "RECEBIMENTO · confirmar avisa que a operação vira histórico",
    /Confirmar recebimento/i.test(titulo),
    titulo,
  );
  const virou = await esperarUrl(
    (u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname),
    30000,
  );
  if (!check("RECEBIMENTO · confirmado, com documento próprio", virou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(800);
  const codigoRec = await texto(".doc-title h1");
  S.dados.recebimento = { code: codigoRec, url: caminho() };
  salvarEstado();

  const lotesNaTela = await textos("table tbody tr a.entity-link");
  check(
    "RECEBIMENTO · o recebimento gerou um lote interno para cada item recebido",
    lotesNaTela.filter((t) => /^LT-/.test(t)).length === LINHAS_COMPRA.length,
    JSON.stringify(lotesNaTela),
  );
  await shot("e2e2-04-recebimento");

  await abrir(S.dados.ordemDeCompra.url, { espera: ".doc-title h1" });
  check(
    "OC · recebida integralmente, a ordem passa a “Recebido” sem ação manual",
    (await texto(".doc-title .badge")) === "Recebido",
    await texto(".doc-title .badge"),
  );
}

// ── MARCO 5 · Qualidade ───────────────────────────────────────────────────
async function marco05Qualidade() {
  await abrir("/qualidade/documentos");
  const fila = await texto("td.table__empty");
  if (fila) registrarVazio("Qualidade › Documentos / CoA (fila de pendências)", fila);
  await shot("e2e2-05a-fila-coa");

  const lotes = ((await apiGet("/lots?pageSize=100")).lots ?? []).filter((l) =>
    // O lote de PRODUÇÃO (o produto acabado) nasce depois e não pertence a
    // este marco: aqui só se conferem os lotes que o RECEBIMENTO gerou.
    (l.itemName ?? "").startsWith(P) && l.origin !== "PRODUCTION",
  );
  check(
    "QUALIDADE · os quatro lotes E2E2 existem",
    lotes.length === LINHAS_COMPRA.length,
    JSON.stringify(lotes.map((l) => `${l.code}/${l.itemName}/${l.status}`)),
  );

  const emb = lotes.filter((l) => l.itemName === EMBALAGEM.nome);
  check(
    "QUALIDADE · a embalagem, que não exige liberação, já nasce Disponível",
    emb.length === 1 && emb[0].status === "AVAILABLE",
    JSON.stringify(emb.map((l) => `${l.code}/${l.status}`)),
  );

  S.dados.lotes = lotes.map((l) => ({ id: l.id, code: l.code, item: l.itemName }));
  for (const lote of lotes) {
    if (lote.status === "AVAILABLE") continue;
    await abrir(`/estoque/lotes/${lote.id}`, { espera: ".doc-title h1" });
    await clicarBotao("Liberar");
    const titulo = await confirmarDialogo("Liberar");
    check(
      `QUALIDADE · liberar ${lote.code} pede confirmação explícita`,
      /Liberar lote/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(900);
    check(
      `QUALIDADE · ${lote.code} (${lote.itemName}) ficou Disponível`,
      (await texto(".doc-title .badge")) === "Disponível",
      await texto(".doc-title .badge"),
    );
  }
  salvarEstado();

  const depois = ((await apiGet("/lots?pageSize=100")).lots ?? []).filter((l) =>
    // O lote de PRODUÇÃO (o produto acabado) nasce depois e não pertence a
    // este marco: aqui só se conferem os lotes que o RECEBIMENTO gerou.
    (l.itemName ?? "").startsWith(P) && l.origin !== "PRODUCTION",
  );
  check(
    "QUALIDADE · os quatro lotes E2E2 estão Disponíveis",
    depois.length === LINHAS_COMPRA.length && depois.every((l) => l.status === "AVAILABLE"),
    JSON.stringify(depois.map((l) => `${l.code}/${l.status}`)),
  );
  await shot("e2e2-05-lotes-liberados");
}

// ── MARCO 6 · Estoque ─────────────────────────────────────────────────────
async function marco06Estoque() {
  await abrir("/estoque");
  await page.waitForTimeout(800);
  await preencher("#inventory-search", P).catch(async () => {
    const busca = page.locator('.toolbar__search input[type="search"], .toolbar__search input').first();
    if ((await busca.count()) > 0) await busca.fill(P);
  });
  await page.waitForTimeout(1400);
  const linhas = await textos("table tbody tr");
  check(
    "ESTOQUE · a posição mostra os quatro itens E2E2 com saldo entrado pelo recebimento",
    linhas.filter((l) => l.includes(P)).length >= LINHAS_COMPRA.length,
    JSON.stringify(linhas.slice(0, 6).map((l) => l.slice(0, 80))),
  );
  anotar(`ESTOQUE · posição na tela: ${JSON.stringify(linhas.filter((l) => l.includes(P)).map((l) => l.slice(0, 90)))}`);
  await shot("e2e2-06-estoque");
}

// ── MARCO 7 · Produto direto + CRIAÇÃO CONTEXTUAL nº 2 (ciclo inteiro) ────
async function marco07ProdutoDireto() {
  if (S.dados.produto) {
    /*
     * Reexecução. Criar outro produto duplicaria o cenário; o que se
     * reconfere é o que o produto direto CONTINUA sendo — aprovado, com item
     * PA próprio e ligado por id ao cliente que nasceu na criação
     * contextual. As provas de NASCIMENTO (sem formulação, F5 na tela de
     * cliente, rascunho intacto) valem para a execução que o criou.
     */
    const produto = await apiGet(`/products/${S.dados.produto.id}`);
    check(
      `PROVA 2 · ${S.dados.produto.code}, criado direto pela tela, continua APROVADO / operacional`,
      produto.lifecycle === "APPROVED",
      String(produto.lifecycle),
    );
    check(
      "PROVA 2 · o item de Produto Acabado gerado junto continua vinculado, com prefixo PA",
      /^PA-\d+$/.test(produto.finishedProductItem?.code ?? ""),
      JSON.stringify(produto.finishedProductItem ?? {}),
    );
    check(
      "PROVA 1b · o vínculo com o cliente criado no contexto continua sendo por id",
      produto.customerId === S.dados.cliente?.id,
      `produto.customerId=${produto.customerId} cliente=${S.dados.cliente?.id}`,
    );
    anotar(
      `PRODUTO · ${S.dados.produto.code} nasceu numa execução anterior deste script, direto por ` +
        "Cadastros › Produtos › + Novo produto, com o cliente criado pelo “+ Novo cliente” do " +
        "próprio campo (ciclo com F5 na tela de cadastro)",
    );
    await conferirProdutoNaLista();
    await shot("e2e2-07-produto-direto");
    return;
  }

  await abrir("/cadastros/produtos");
  await clicarLink("+ Novo produto");
  const naTela = await esperarUrl((u) => u.pathname === "/cadastros/produtos/novo", 20000);
  check(
    "PROVA 2 · Cadastros › Produtos › “+ Novo produto” abre a tela canônica",
    naTela && (await texto(".page__title")) === "Novo produto",
    `${caminho()} · "${await texto(".page__title")}"`,
  );

  // ── Cliente é obrigatório: provar antes de preencher ────────────────────
  const recursaoAntes = pageErrors.filter((e) => /Maximum call stack/.test(e)).length;
  const deliberadaAntes = deliberados.pageerror.length;
  await preencher("#product-name", PRODUTO.nome);
  await deliberadamente("produto-sem-cliente", async () => {
    await clicarBotao("Criar produto");
    await page.waitForTimeout(1200);
  });
  const nativo = await page.evaluate(() => {
    const el = document.querySelector("#product-customer");
    return { faltando: el?.validity?.valueMissing ?? null, mensagem: el?.validationMessage ?? "" };
  });
  check(
    "PROVA 2 · cliente é obrigatório: sem ele o produto não é criado",
    caminho() === "/cadastros/produtos/novo" && nativo.faltando === true,
    `${caminho()} · ${JSON.stringify(nativo)}`,
  );
  anotar(`PROVA 2 · balão nativo do cliente obrigatório: "${nativo.mensagem}"`);
  const recursaoDeliberada = deliberados.pageerror.filter((e) =>
    /Maximum call stack/.test(e),
  ).length;
  anotar(
    `VALIDAÇÃO NATIVA · o envio com campo obrigatório vazio gerou ${recursaoDeliberada} ` +
      `RangeError "Maximum call stack size exceeded" (antes: ${recursaoAntes} fora de janela, ` +
      `${deliberadaAntes} deliberados)`,
  );
  await shot("e2e2-07a-cliente-obrigatorio");

  // ── Rascunho completo ANTES de sair para criar o cliente ────────────────
  await preencher("#product-external-code", PRODUTO.referenciaExterna);
  const formas = await page.evaluate(() =>
    [...document.querySelectorAll("#product-dosage-form option")].map((o) => o.value),
  );
  const apresentacoes = await page.evaluate(() =>
    [...document.querySelectorAll("#product-presentation option")].map((o) => o.value),
  );
  const publicos = await page.evaluate(() =>
    [...document.querySelectorAll("#product-target-age option")].map((o) => o.value),
  );
  const forma = formas.includes("CAPSULE") ? "CAPSULE" : formas.find(Boolean);
  const apresentacao = apresentacoes.includes("POT") ? "POT" : apresentacoes.find(Boolean);
  const publico = publicos.includes("ADULT") ? "ADULT" : publicos.find(Boolean);
  if (forma) await selecionar("#product-dosage-form", forma);
  if (apresentacao) await selecionar("#product-presentation", apresentacao);
  if (publico) await selecionar("#product-target-age", publico);
  await preencher("#product-capsules-per-dose", PRODUTO.capsulasPorDose);
  await preencher("#product-doses-per-package", PRODUTO.dosesPorPote);
  await preencher("#product-units-per-box", PRODUTO.unidadesPorCaixa);
  await preencher("#product-shelf-life", PRODUTO.vidaUtil);
  await preencher("#product-minimum-batch", PRODUTO.loteMinimo);
  await preencher("#product-notes", PRODUTO.notas);
  const rascunhoAntes = await valoresDoFormulario();
  await shot("e2e2-07b-produto-rascunho-antes-de-sair");

  // ── PROVA 1b · CRIAÇÃO CONTEXTUAL, ciclo inteiro com F5 ─────────────────
  const combo = page.locator("#product-customer");
  await combo.click();
  await combo.fill(IDENT.cliente.tradeName);
  await page.waitForTimeout(900);
  const criar = page.locator("li.entity-select__create");
  check(
    "PROVA 1b · o campo Cliente do produto oferece “+ Novo cliente” com o texto digitado",
    (await criar.count()) === 1 && (await criar.textContent()).includes(IDENT.cliente.tradeName),
    (await criar.textContent().catch(() => "")) ?? "",
  );
  await criar.click();

  const foiParaCliente = await esperarUrl(
    (u) => u.pathname === "/cadastros/clientes/novo" && u.searchParams.has("origem"),
    20000,
  );
  check(
    "PROVA 1b · a URL MUDA para a página canônica de cliente, carregando o token de origem",
    foiParaCliente,
    urlCompleta(),
  );
  const urlDeCriacao = urlCompleta();

  // ── O F5 que separa contexto de navegação de pilha de histórico ─────────
  const t0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await esperarTelaDeCriacao("Novo cliente");
  const gastoF5 = Date.now() - t0;
  if (gastoF5 > 4000) ergo(`F5 na criação contextual de cliente levou ${gastoF5}ms`);

  const voltarDepoisDoF5 = await texto(".page__header button.btn--ghost");
  const trilhaDepoisDoF5 = await textos("nav.page-crumbs li");
  check(
    "PROVA 1b · depois do F5 a tela CONTINUA sabendo que é contextual e para onde volta",
    urlCompleta() === urlDeCriacao && /Voltar para Produto/i.test(voltarDepoisDoF5),
    `url="${urlCompleta()}" botão="${voltarDepoisDoF5}"`,
  );
  check(
    "PROVA 1b · a trilha permanece canônica (Cadastros › Clientes › Novo cliente), não a de origem",
    trilhaDepoisDoF5.join(" › ") === "Cadastros › Clientes › Novo cliente",
    JSON.stringify(trilhaDepoisDoF5),
  );
  await shot("e2e2-07c-cliente-contextual-apos-f5");

  const c = IDENT.cliente;
  await preencher("#customer-legal-name", c.legalName);
  await preencher("#customer-trade-name", c.tradeName);
  await preencher("#customer-cnpj", c.cnpj);
  await preencher("#customer-email", c.email);
  await preencher("#customer-phone", c.phone);
  await preencher("#customer-zip", c.zip);
  await preencher("#customer-street", c.street);
  await preencher("#customer-number", c.number);
  await preencher("#customer-district", c.district);
  await preencher("#customer-city", c.city);
  await selecionar("#customer-state", c.state);
  await clicarBotao("Criar cliente");

  const voltouAoProduto = await esperarUrl(
    (u) => u.pathname === "/cadastros/produtos/novo",
    25000,
  );
  if (
    !check(
      "PROVA 1b · salvar o cliente devolve à tela de produto de origem",
      voltouAoProduto,
      urlCompleta(),
    )
  ) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(2000);

  const clientesE2E2 =
    (await apiGet(`/customers?search=${encodeURIComponent(P)}&pageSize=20`)).customers ?? [];
  const cliente = clientesE2E2.find((x) => x.legalName === c.legalName);
  check(
    "PROVA 1b · o cliente foi criado pela tela canônica, com código CLI gerado",
    Boolean(cliente) && /^CLI-\d+$/.test(cliente?.code ?? ""),
    JSON.stringify(clientesE2E2.map((x) => `${x.code}/${x.legalName}`)),
  );
  S.dados.cliente = cliente ? { id: cliente.id, code: cliente.code } : null;

  const rascunhoDepois = await valoresDoFormulario();
  const camposDoRascunho = [
    "product-name",
    "product-external-code",
    "product-dosage-form",
    "product-presentation",
    "product-target-age",
    "product-capsules-per-dose",
    "product-doses-per-package",
    "product-units-per-box",
    "product-shelf-life",
    "product-minimum-batch",
    "product-notes",
  ];
  const divergentes = camposDoRascunho.filter(
    (k) => rascunhoDepois[k] !== rascunhoAntes[k],
  );
  check(
    "PROVA 1b · o rascunho do produto voltou INTACTO — os 11 campos preenchidos continuam iguais",
    divergentes.length === 0,
    `divergentes=${JSON.stringify(
      divergentes.map((k) => `${k}: "${rascunhoAntes[k]}" → "${rascunhoDepois[k]}"`),
    )}`,
  );

  const valorCliente = await page.locator("#product-customer").inputValue();
  check(
    "PROVA 1b · o cliente novo voltou SELECIONADO no campo, exibido pelo código real",
    Boolean(cliente) && valorCliente.includes(cliente.code) && valorCliente.includes(c.legalName),
    `campo="${valorCliente}" esperado contém "${cliente?.code}"`,
  );
  await shot("e2e2-07d-produto-rascunho-intacto");

  // ── O produto nasce ─────────────────────────────────────────────────────
  await clicarBotao("Criar produto");
  const salvou = await esperarUrl((u) => u.pathname === "/cadastros/produtos", 30000);
  if (!check("PROVA 2 · salvar leva de volta à lista de produtos", salvou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(1200);

  const produtos = (await apiGet(`/products?search=${encodeURIComponent(P)}&pageSize=20`)).products ?? [];
  const produto = produtos.find((x) => x.name === PRODUTO.nome);
  if (
    !check(
      "PROVA 2 · o produto direto existe, com código PROD gerado",
      Boolean(produto) && /^PROD-\d+$/.test(produto?.code ?? ""),
      JSON.stringify(produtos.map((x) => `${x.code}/${x.name}`)),
    )
  ) {
    return;
  }
  S.dados.produto = {
    id: produto.id,
    code: produto.code,
    name: produto.name,
    itemPA: produto.finishedProductItem?.code ?? null,
    itemPAId: produto.finishedProductItem?.id ?? null,
  };
  salvarEstado();

  check(
    "PROVA 1b · o vínculo foi feito pelo ID do cliente recém-criado, não pelo nome digitado",
    produto.customerId === S.dados.cliente?.id,
    `produto.customerId=${produto.customerId} cliente=${S.dados.cliente?.id}`,
  );
  check(
    "PROVA 2 · o item de Produto Acabado foi criado automaticamente, com prefixo PA",
    /^PA-\d+$/.test(produto.finishedProductItem?.code ?? ""),
    JSON.stringify(produto.finishedProductItem ?? {}),
  );
  check(
    "PROVA 2 · o produto DIRETO nasce APROVADO / operacional — não em desenvolvimento",
    produto.lifecycle === "APPROVED",
    String(produto.lifecycle),
  );
  anotar(
    `PROVA 2 · diferença medida contra o E2E-1: produto de PROJETO nasce lifecycle=DEVELOPMENT; ` +
      `produto DIRETO nasce lifecycle=${produto.lifecycle}`,
  );

  const formulacoes = (await apiGet(`/products/${produto.id}/formulations`)).versions ?? [];
  check(
    "PROVA 2 · o produto direto nasce SEM formulação nenhuma — nem rascunho",
    formulacoes.length === 0,
    JSON.stringify(formulacoes.map((v) => `${v.versionLabel}/${v.status}`)),
  );
  anotar(
    "PROVA 2 · diferença medida contra o E2E-1: produto de PROJETO nasce com V1 em Rascunho; " +
      "produto DIRETO nasce com zero versões",
  );

  await conferirProdutoNaLista();
  await shot("e2e2-07-produto-direto");
}

/**
 * O que a listagem de Produtos afirma sobre o produto direto.
 *
 * Separado da criação para valer também na reexecução, quando o produto já
 * nasceu numa passagem anterior e o marco não pode criar outro.
 */
async function conferirProdutoNaLista() {
  await abrir("/cadastros/produtos");
  await preencher("#products-search", P);
  await page.waitForTimeout(1400);
  const linhas = await textos("table tbody tr");
  const linha = linhas.find((l) => l.includes(S.dados.produto.code));
  check(
    "PROVA 2 · o produto aparece na lista, Ativo, com o item PA e o cliente criado no contexto",
    Boolean(linha) &&
      linha.includes(IDENT.cliente.tradeName) &&
      linha.includes(S.dados.produto.itemPA) &&
      /Ativo/.test(linha),
    JSON.stringify(linhas.map((l) => l.slice(0, 130))),
  );
  anotar(`PRODUTO · linha na listagem: "${linha ?? "—"}"`);
}

// ── MARCO 8 · Formulação em branco + busca de catálogo no servidor ────────
const linhasDeComponente = () =>
  page
    .locator("section.form-section")
    .filter({ has: page.locator("h3", { hasText: "Componentes" }) })
    .locator("table.table tbody tr");

async function preencherComponente(indice, comp) {
  const linha = linhasDeComponente().nth(indice);
  const combo = page.locator('input[id^="componente-"]').nth(indice);
  await escolherEntidade(combo, comp.nome, comp.nome);
  await linha.locator('select[aria-label="Base de cálculo do componente"]').selectOption(comp.base);
  await page.waitForTimeout(150);
  await linha.locator("td").nth(4).locator("input").fill(String(comp.quantidade));
  await linha.locator("td").nth(5).locator("select").selectOption(comp.unidade);
  await page.waitForTimeout(200);
}

async function marco08Formulacao() {
  const produtoId = S.dados.produto.id;

  const jaAtiva = ((await apiGet(`/products/${produtoId}/formulations`)).versions ?? []).find(
    (v) => v.status === "ACTIVE",
  );
  if (jaAtiva) {
    anotar(`FORMULAÇÃO · ${jaAtiva.versionLabel} já estava ATIVA — marco pulado`);
    S.dados.formulacao = { versionId: jaAtiva.id, label: jaAtiva.versionLabel };
    salvarEstado();
    return;
  }

  await abrir(`/producao/formulacoes/${produtoId}`, { espera: ".doc-title h1" });
  const semAtiva = await texto("section.form-section .field__hint");
  registrarVazio("Formulação do produto direto (nenhuma versão)", semAtiva);
  const semVersoes = await texto("td.table__empty");
  if (semVersoes) registrarVazio("Formulação › Histórico de versões (produto direto)", semVersoes);
  check(
    "PROVA 3 · a tela do produto direto oferece “Criar formulação em branco”",
    await existeBotao("Criar formulação em branco"),
    JSON.stringify(await textos(".line-actions button")),
  );
  await shot("e2e2-08a-formulacao-vazia");

  await clicarBotao("Criar formulação em branco");
  const foi = await esperarUrl((u) => /\/versoes\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check("PROVA 3 · criar em branco abre a versão nova, com URL própria", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  S.dados.formulacaoUrl = caminho();
  await page.waitForSelector("#version-basis", { timeout: 25000 });
  check(
    "PROVA 3 · a versão em branco nasce Rascunho e SEM componentes",
    (await texto(".doc-title .badge")) === "Rascunho" &&
      (await texto("td.table__empty")).length > 0,
    `${await texto(".doc-title .badge")} · vazio="${await texto("td.table__empty")}"`,
  );

  await preencher("#version-basis", "1");
  await selecionar("#version-mode", "PER_DOSE");
  await page.waitForTimeout(400);
  await preencher("#version-doses", PRODUTO.dosesPorPote);

  // ── PROVA 4 · a busca de catálogo vai ao SERVIDOR ───────────────────────
  await clicarBotao("+ Adicionar componente");
  await page.waitForTimeout(300);
  const buscasAntes = buscasDeItem.length;
  const primeiro = page.locator('input[id^="componente-"]').first();
  await primeiro.click();
  await primeiro.fill(`${P} Vitamina D3 premix`);
  await page.waitForTimeout(1600);

  const buscasDoTermo = buscasDeItem.slice(buscasAntes);
  check(
    "PROVA 4 · digitar no campo de item dispara GET /items?search= no servidor",
    buscasDoTermo.some((b) => (b.search ?? "").includes("Vitamina D3 premix")),
    JSON.stringify(buscasDoTermo.map((b) => b.query)),
  );
  const opcoes = await textos("li.entity-select__option[role='option']:not(.entity-select__create)");
  check(
    "PROVA 4 · o resultado do servidor aparece na lista",
    opcoes.some((o) => o.includes(`${P} Vitamina D3 premix`)),
    JSON.stringify(opcoes),
  );
  anotar(
    `PROVA 4 · consultas observadas para o termo: ${JSON.stringify(
      buscasDoTermo.map((b) => b.query),
    )}`,
  );
  await shot("e2e2-08b-busca-no-servidor");

  // ── PROVA 4b · item INELEGÍVEL continua fora ────────────────────────────
  const codigoPa = S.dados.produto.itemPA;
  const buscasAntesPa = buscasDeItem.length;
  await primeiro.fill(codigoPa);
  await page.waitForTimeout(1600);
  const buscasPa = buscasDeItem.slice(buscasAntesPa);
  const opcoesPa = await textos(
    "li.entity-select__option[role='option']:not(.entity-select__create)",
  );
  const paNoCatalogo = (await apiGet(`/items?search=${encodeURIComponent(codigoPa)}`)).items ?? [];
  check(
    "PROVA 4b · a busca pelo item de Produto Acabado também vai ao servidor",
    buscasPa.some((b) => (b.search ?? "") === codigoPa),
    JSON.stringify(buscasPa.map((b) => b.query)),
  );
  check(
    "PROVA 4b · o item existe no catálogo, mas fica FORA da lista do campo de componente",
    paNoCatalogo.length === 1 &&
      paNoCatalogo[0].type === "FINISHED_PRODUCT" &&
      !opcoesPa.some((o) => o.includes(codigoPa)),
    `catálogo=${JSON.stringify(paNoCatalogo.map((i) => `${i.code}/${i.type}`))} · lista=${JSON.stringify(opcoesPa)}`,
  );
  anotar(
    `PROVA 4b · ${codigoPa} existe em /items (type=FINISHED_PRODUCT) e não é ofertado no campo de ` +
      "componente — o filtro de elegibilidade é do servidor (type=RAW_MATERIAL + type=PACKAGING), " +
      "não do navegador",
  );
  await shot("e2e2-08c-item-inelegivel-fora");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ── Os quatro componentes ───────────────────────────────────────────────
  for (let i = 0; i < MP.length; i += 1) {
    if (i > 0) {
      await clicarBotao("+ Adicionar componente");
      await page.waitForTimeout(300);
    }
    await preencherComponente(i, {
      nome: MP[i].nome,
      base: "PER_DOSE",
      quantidade: MP[i].mgPorDose,
      unidade: "mg",
    });
  }
  await clicarBotao("+ Adicionar componente");
  await page.waitForTimeout(300);
  await preencherComponente(MP.length, {
    nome: EMBALAGEM.nome,
    base: "PER_FINISHED_UNIT",
    quantidade: 1,
    unidade: "un",
  });

  await clicarBotao("Salvar rascunho");
  await page.waitForTimeout(2000);
  const errosSalvar = await mensagensDeErro();
  check(
    "PROVA 3 · os quatro componentes foram salvos sem erro",
    errosSalvar.length === 0,
    JSON.stringify(errosSalvar),
  );
  await shot("e2e2-08d-formulacao-componentes");

  await clicarBotao("Ativar versão");
  await confirmarDialogo("Ativar");
  await page.waitForTimeout(2500);
  check(
    "PROVA 3 · a formulação em branco foi ATIVADA pela tela",
    (await texto(".doc-title .badge")) === "Ativa",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const ativa = ((await apiGet(`/products/${produtoId}/formulations`)).versions ?? []).find(
    (v) => v.status === "ACTIVE",
  );
  check(
    "PROVA 3 · a versão ativa tem os 4 componentes (3 matérias-primas + 1 embalagem)",
    (ativa?.components ?? []).length === MP.length + 1,
    JSON.stringify((ativa?.components ?? []).map((c) => `${c.itemCode} ${c.quantity}${c.unitCode}/${c.basis}`)),
  );
  S.dados.formulacao = { versionId: ativa?.id ?? null, label: ativa?.versionLabel ?? null };
  salvarEstado();
  await shot("e2e2-08-formulacao-ativa");
}

// ── MARCO 9 · Recursos industriais ────────────────────────────────────────
const RECURSOS = [
  { nome: `${P} Encapsuladora automatica`, tipo: "EQUIPMENT", potencia: "4", tarifa: "95.00" },
  { nome: `${P} Mao de obra envase`, tipo: "LABOR", potencia: null, tarifa: "38.50" },
  // A tarifa de energia é o valor exato que o roteiro manda medir na vírgula.
  { nome: `${P} Energia eletrica`, tipo: "ENERGY", potencia: null, tarifa: "0.85" },
];

async function registrarTarifa(r) {
  const semTarifa = await texto("td.table__empty");
  if (semTarifa) registrarVazio(`Recurso ${r.nome} › Histórico de tarifas`, semTarifa);

  /* DECIMAL 2 · campo de dinheiro, vírgula de propósito. */
  const como = await decimalComVirgula({
    campo: "#rate-value",
    valor: r.tarifa,
    acao: async () => {
      await clicarBotao("Registrar tarifa");
    },
    confirmou: async () => (await textos("table tbody tr")).some((t) => /Vigente/.test(t)),
    ondeNaTela: "Gestão › Recursos industriais › detalhe › Valor da tarifa",
  });
  check(
    `RECURSO · "${r.nome}" recebeu tarifa vigente`,
    como !== "falhou",
    `separador aceito: ${como} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  return como;
}

async function marco09Recursos() {
  await abrir("/gestao/recursos-industriais");
  const existentes = (await apiGet("/industrial-resources?pageSize=100")).resources ?? [];
  const porNome = new Map(existentes.map((r) => [r.name, r]));
  S.dados.recursos = S.dados.recursos ?? {};

  for (const r of RECURSOS) {
    const existente = porNome.get(r.nome);
    if (existente?.currentRate) {
      anotar(`RECURSO · "${r.nome}" já existia com tarifa — pulado`);
      continue;
    }
    if (existente) {
      await abrir(`/gestao/recursos-industriais/${existente.id}`, { espera: ".doc-title h1" });
      await registrarTarifa(r);
      continue;
    }
    await abrir("/gestao/recursos-industriais/novo");
    await preencher("#resource-name", r.nome);
    await selecionar("#resource-type", r.tipo);
    await page.waitForTimeout(300);
    if (r.potencia && (await page.locator("#resource-power").count()) > 0) {
      await preencher("#resource-power", r.potencia);
    }
    await clicarBotao("Criar recurso");
    const foi = await esperarUrl(
      (u) => /^\/gestao\/recursos-industriais\/[0-9a-f-]{36}$/.test(u.pathname),
      25000,
    );
    if (!check(`RECURSO · "${r.nome}" foi criado e abriu o próprio detalhe`, foi, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
    await registrarTarifa(r);
  }

  const depois = (await apiGet("/industrial-resources?pageSize=100")).resources ?? [];
  const meus = depois.filter((r) => r.name.startsWith(P));
  for (const r of meus) S.dados.recursos[r.name] = { id: r.id, code: r.code };
  salvarEstado();
  check(
    `RECURSO · os ${RECURSOS.length} recursos E2E2 existem, todos com tarifa vigente`,
    meus.length === RECURSOS.length && meus.every((r) => r.currentRate != null),
    JSON.stringify(meus.map((r) => `${r.code}/${r.currentRate?.rateValue ?? "SEM TARIFA"}`)),
  );

  /*
   * ── O prefixo `RIN` ────────────────────────────────────────────────────
   *
   * Recurso industrial e Recebimento usavam `REC` com sequences separadas, e
   * as duas começavam em 1: `REC-000001` nomeava um recebimento E um recurso
   * ao mesmo tempo. Conferir só "o recurso tem código" não pegaria isso —
   * ele TINHA. O que se mede é o prefixo de cada um e a ausência de colisão
   * entre os códigos das duas entidades na base inteira.
   */
  const codigosDeRecurso = meus.map((r) => r.code);
  check(
    "RIN · todo recurso industrial nasce com o prefixo RIN",
    codigosDeRecurso.length > 0 && codigosDeRecurso.every((c) => /^RIN-\d+$/.test(c)),
    JSON.stringify(codigosDeRecurso),
  );
  check(
    "RIN · o Recebimento continua com o prefixo REC (a troca foi só do recurso)",
    /^REC-\d+$/.test(S.dados.recebimento?.code ?? ""),
    S.dados.recebimento?.code ?? "sem recebimento no estado",
  );
  const todosRecursos = (depois ?? []).map((r) => r.code);
  const todosRecebimentos = ((await apiGet("/receipts?pageSize=100")).receipts ?? []).map(
    (r) => r.code,
  );
  const colisao = todosRecursos.filter((c) => todosRecebimentos.includes(c));
  check(
    "RIN · nenhum código de recurso industrial colide com código de recebimento na base",
    colisao.length === 0,
    JSON.stringify({ colisao, recursos: todosRecursos, recebimentos: todosRecebimentos }),
  );
  anotar(
    `RIN · recursos ${JSON.stringify(todosRecursos)} × recebimentos ` +
      `${JSON.stringify(todosRecebimentos)} — nenhum código em comum`,
  );
  await shot("e2e2-09-recursos");
}

// ── MARCO 10 · Estrutura de custos ────────────────────────────────────────
/**
 * Usos de recurso declarados na versão que está sendo montada.
 *
 * Lidos da TELA, não de `/industrial-costs`.`current`: aquele campo é a
 * versão ATIVA, e enquanto a estrutura é rascunho ele vale `null` — uma
 * leitura por ali diria "nenhum recurso declarado" logo depois de declarar
 * um, e acusaria a tela de perder o que ela acabou de gravar.
 */
async function usosDeRecurso() {
  return page.evaluate(() => {
    const s = document.querySelector("#secao-recursos");
    return [...(s?.querySelectorAll("table tbody tr") ?? [])]
      .map((tr) => (tr.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => t && !/Nenhum/i.test(t));
  });
}

async function marco10EstruturaDeCustos() {
  const produtoId = S.dados.produto.id;
  await abrir(`/produtos/${produtoId}/custos`, { espera: ".doc-title h1, .page__title" });

  const antes = (await apiGet(`/products/${produtoId}/industrial-costs`)).current;
  if (antes?.status === "ACTIVE" && antes.complete) {
    /*
     * A estrutura já nasceu numa passagem anterior. Recriá-la duplicaria a
     * versão; o que continua valendo é a PROVA do decimal, que fala do que
     * ficou gravado depois da ativação — e isso é lido, não refeito.
     */
    anotar(`ESTRUTURA · ${antes.label} já ativa e completa — criação pulada`);
    conferirDecimaisAposAtivacao(antes);
    salvarEstado();
    return;
  }

  if (!antes) {
    const semEstrutura = await texto("section.form-section p.field__hint");
    if (semEstrutura) registrarVazio("Produto › Estrutura de custos (nenhuma versão)", semEstrutura);
    await preencher("#new-reference-output", PRODUTO.loteMinimo);
    await clicarBotao("Criar estrutura de custos");
    await page.waitForTimeout(2500);
    const semRecurso = await page.evaluate(() => {
      const s = [...document.querySelectorAll("section.form-section")].find((el) =>
        (el.querySelector("h3")?.textContent ?? "").includes("Recursos industriais"),
      );
      return (s?.querySelector("td.table__empty")?.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    if (semRecurso) registrarVazio("Estrutura de custos › Recursos industriais", semRecurso);
  } else if (antes.status === "ACTIVE") {
    /*
     * A versão ativa ficou INCOMPLETA — a tela deixou ativá-la assim, depois
     * de perguntar. Versão ativa é histórico e não se reedita: a correção é
     * uma versão nova, pela própria tela.
     */
    anotar(
      `ESTRUTURA · ${antes.label} está ATIVA porém incompleta ` +
        `(${(antes.pendencies ?? []).map((p) => p.code).join(", ")}); ` +
        "uma nova versão será criada pela tela para fechar a pendência",
    );
    await clicarBotao("Nova versão");
    const titulo = await confirmarDialogo("Criar versão");
    check(
      "ESTRUTURA · criar nova versão pede confirmação explícita",
      /nova versão da estrutura de custos/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(2500);
  } else {
    anotar(`ESTRUTURA · retomando o rascunho ${antes.label}`);
  }

  // ── Recursos industriais ────────────────────────────────────────────────
  /*
   * DECIMAL 3 · "6,5" horas de encapsuladora — campo de QUANTIDADE, não de
   * dinheiro. A correção da vírgula foi do sistema, não de uma tela de preço,
   * e é isso que este par mede: um campo de consumo e um de tarifa.
   */
  const jaDeclarados = await usosDeRecurso();
  for (const [nome, consumo, comVirgula] of [
    [`${P} Encapsuladora automatica`, "6.5", true],
    [`${P} Mao de obra envase`, "10", false],
  ]) {
    if (jaDeclarados.some((linha) => linha.includes(nome))) {
      anotar(`ESTRUTURA · recurso "${nome}" já declarado nesta versão — não recadastrado`);
      continue;
    }
    await escolherEntidade("#usage-resource", nome, nome);
    const digitado = comVirgula ? comoDigitado(consumo) : consumo;
    await preencher("#usage-quantity", digitado);
    await clicarBotao("Adicionar recurso");
    await page.waitForTimeout(1800);
    if (comVirgula) {
      const linhas = await usosDeRecurso();
      const linha = linhas.find((l) => l.includes(nome)) ?? "";
      check(
        `DECIMAL · Estrutura de custos › Consumo por lote aceita "${digitado}"`,
        linha.length > 0 && /6[.,]5/.test(linha),
        `linhas na tela=${JSON.stringify(linhas)} · erros=${JSON.stringify(await mensagensDeErro())}`,
      );
      if (linha) {
        registrarSeparador({
          campo: "Estrutura de custos › Consumo por lote de referência",
          onde: "Produto › Custos industriais › Recursos industriais",
          digitado,
          como: "virgula",
        });
      }
    }
  }
  const recursosNaTela = await page.evaluate(() => {
    const s = document.querySelector("#secao-recursos");
    return [...(s?.querySelectorAll("table tbody tr") ?? [])]
      .map((tr) => (tr.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => !/Nenhum/i.test(t));
  });
  check(
    "ESTRUTURA · os dois recursos industriais estão declarados na estrutura",
    recursosNaTela.length === 2,
    JSON.stringify(recursosNaTela.map((r) => r.slice(0, 70))),
  );

  // ── Premissa adicional: o campo de dinheiro que o roteiro manda medir ───
  const premissas = () =>
    page
      .locator("section#secao-premissas table.table tbody tr:not(:has(td.table__empty))")
      .count();
  const antesPremissa = await premissas();
  if (antesPremissa === 0) {
    await selecionar("#cost-category", "SECONDARY_PACKAGING");
    await preencher("#cost-description", "Caixa de expedicao E2E2");
    await selecionar("#cost-basis", "PER_SHIPPING_BOX");
    /*
     * DECIMAL 4 · o valor que precisa ATRAVESSAR UMA ATIVAÇÃO.
     *
     * "Gravou" e "continua gravado depois de a versão virar histórico" são
     * afirmações diferentes: ativar copia, congela e derruba a versão
     * anterior, e é aí que um número mal normalizado vira 280 ou some. O
     * valor é conferido de novo depois do "Ativar estrutura", no documento
     * que passou a valer.
     */
    const comoPremissa = await decimalComVirgula({
      campo: "#cost-rate",
      valor: PREMISSA_VALOR,
      acao: async () => {
        if ((await page.locator("#cost-description").inputValue()) === "") {
          await preencher("#cost-description", "Caixa de expedicao E2E2");
        }
        await clicarBotao("Adicionar premissa");
      },
      confirmou: async () => (await premissas()) > antesPremissa,
      ondeNaTela: "Produto › Custos industriais › “Premissas de custo adicionais” › Valor",
    });
    check(
      "ESTRUTURA · a premissa de custo adicional foi registrada pela tela",
      comoPremissa !== "falhou",
      `separador aceito: ${comoPremissa} · erros=${JSON.stringify(await mensagensDeErro())}`,
    );
  } else {
    anotar(`ESTRUTURA · a nova versão já veio com ${antesPremissa} premissa(s) copiada(s)`);
  }

  // ── Energia: sem ela a estrutura fica com pendência BLOQUEANTE ──────────
  await selecionar("#energy-mode", "FROM_EQUIPMENT");
  await page.waitForTimeout(2000);
  const opcoesEnergia = await page.evaluate(() =>
    [...document.querySelectorAll("#energy-resource option")].map((o) => ({
      value: o.value,
      label: (o.textContent ?? "").trim(),
    })),
  );
  const energiaE2E2 = opcoesEnergia.find((o) => o.value && o.label.includes(`${P} Energia`));
  check(
    "ESTRUTURA · o seletor de tarifa de energia só oferece recursos do tipo Energia",
    Boolean(energiaE2E2),
    JSON.stringify(opcoesEnergia),
  );
  if (energiaE2E2) {
    await selecionar("#energy-resource", energiaE2E2.value);
    await page.waitForTimeout(2000);
  }
  const energiaDerivada = await page.evaluate(() => {
    const s = document.querySelector("#secao-energia");
    const dt = [...(s?.querySelectorAll("dt") ?? [])].find((el) =>
      (el.textContent ?? "").includes("derivado"),
    );
    return (dt?.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim();
  });
  check(
    "ESTRUTURA · a energia derivada dos equipamentos é calculada e mostrada na tela",
    /kWh/.test(energiaDerivada),
    energiaDerivada,
  );
  anotar(`ESTRUTURA · energia derivada declarada na tela: "${energiaDerivada}"`);
  await shot("e2e2-10a-estrutura-montada");

  await clicarBotao("Ativar estrutura");
  await page.waitForTimeout(700);
  if ((await page.locator(".confirm-dialog").count()) > 0) {
    const titulo = await confirmarDialogo("Ativar");
    anotar(`ESTRUTURA · ativação pediu confirmação: "${titulo}"`);
  }
  await page.waitForTimeout(2500);
  check(
    "ESTRUTURA · a estrutura de custos ficou Ativa",
    (await texto(".doc-title .badge")) === "Ativa",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const gravada = (await apiGet(`/products/${produtoId}/industrial-costs`)).current ?? {};
  check(
    "ESTRUTURA · a versão ativa está COMPLETA, sem pendência bloqueante",
    gravada.complete === true,
    JSON.stringify((gravada.pendencies ?? []).map((p) => `${p.code}/${p.severity}`)),
  );
  anotar(
    `ESTRUTURA · ${gravada.label} ativa com ${(gravada.lines ?? []).length} premissa(s), ` +
      `${(gravada.resourceUsages ?? []).length} recurso(s), energia=${gravada.energyCalculationMode} ` +
      `(${gravada.derivedEnergyKwh ?? "—"} kWh/lote)`,
  );

  conferirDecimaisAposAtivacao(gravada);
  salvarEstado();
  await shot("e2e2-10-estrutura-ativa");
}

/**
 * PROVA 4 · o decimal com vírgula ATRAVESSOU a ativação.
 *
 * "Gravou" e "continua gravado depois de a versão virar histórico" são
 * afirmações diferentes: ativar copia, congela e derruba a versão anterior, e
 * é aí que um número mal normalizado vira 280 ou some. Separado da criação
 * para valer também na reexecução, quando a estrutura já nasceu antes.
 */
function conferirDecimaisAposAtivacao(gravada) {
  const premissaGravada = (gravada.lines ?? []).find((l) =>
    (l.description ?? "").includes("Caixa de expedicao E2E2"),
  );
  const usoGravado = (gravada.resourceUsages ?? []).find((u) =>
    (u.resourceName ?? "").includes("Encapsuladora"),
  );
  check(
    `PROVA 4 · "${comoDigitado(PREMISSA_VALOR)}" digitado com vírgula continua valendo ` +
      `${PREMISSA_VALOR} DEPOIS de a estrutura ser ativada`,
    premissaGravada != null &&
      Math.abs(Number(premissaGravada.rateValue) - Number(PREMISSA_VALOR)) < 0.001,
    JSON.stringify((gravada.lines ?? []).map((l) => `${l.description}=${l.rateValue}`)),
  );
  const consumoOk =
    usoGravado != null && Math.abs(Number(usoGravado.usageQuantity) - 6.5) < 0.001;
  check(
    'PROVA 4 · "6,5" (consumo por lote) continua 6.5 na versão ativa — não virou 65 nem 6',
    consumoOk,
    JSON.stringify((gravada.resourceUsages ?? []).map((u) => `${u.resourceName}=${u.usageQuantity}`)),
  );
  if (consumoOk) {
    registrarSeparador({
      campo: "Estrutura de custos › Consumo por lote de referência",
      onde: "Produto › Custos industriais › Recursos industriais (sobreviveu à ativação)",
      digitado: "6,5",
      como: "virgula",
    });
  }
  anotar(
    `PROVA 4 · valores digitados com vírgula depois da ativação: ` +
      `premissa=${premissaGravada?.rateValue}, consumo=${usoGravado?.usageQuantity}, ` +
      `tarifas congeladas=${
        (gravada.resourceUsages ?? []).map((u) => u.rateValueSnapshot).join("/") || "—"
      }`,
  );
  S.dados.estruturaDeCustos = {
    code: gravada.code,
    label: gravada.label,
    premissaAposAtivacao: premissaGravada?.rateValue ?? null,
    consumoAposAtivacao: usoGravado?.usageQuantity ?? null,
  };
}


// ── MARCO 11 · Cálculo de custo ───────────────────────────────────────────
async function marco11Calculo() {
  const produtoId = S.dados.produto.id;
  await abrir(`/produtos/${produtoId}/custos`, { espera: ".doc-title h1" });

  const semCalculo = await page.evaluate(() => {
    const s = [...document.querySelectorAll("section.form-section")].find((el) =>
      (el.querySelector("h3")?.textContent ?? "").includes("Cálculos salvos"),
    );
    return (s?.querySelector("td.table__empty")?.textContent ?? "").replace(/\s+/g, " ").trim();
  });
  if (semCalculo) registrarVazio("Produto › Cálculos salvos (nenhum ainda)", semCalculo);

  await preencher("#cost-reference-date", hoje());
  const t0 = Date.now();
  await clicarBotao("Calcular custo");
  await page.waitForTimeout(2500);
  const gasto = Date.now() - t0;
  if (gasto > 4000) ergo(`cálculo de custo levou ${gasto}ms até renderizar o resultado`);

  const custoUnidade = await page.evaluate(() => {
    const dt = [...document.querySelectorAll("dl.definition-list dt")].find(
      (el) => (el.textContent ?? "").trim() === "Custo por unidade",
    );
    return dt ? (dt.nextElementSibling?.textContent ?? "").trim() : null;
  });
  check(
    "CÁLCULO · o custo por unidade foi calculado e apareceu na tela",
    Boolean(custoUnidade) && custoUnidade !== "—",
    `custo/unidade="${custoUnidade}"`,
  );
  anotar(`CÁLCULO · custo por unidade na tela: ${custoUnidade}`);
  await shot("e2e2-11a-calculo-resultado");

  await clicarBotao("Salvar cálculo");
  await page.waitForTimeout(800);
  if ((await page.locator(".confirm-dialog").count()) > 0) {
    const rotulo =
      (await page.locator('.confirm-dialog button:has-text("Salvar assim mesmo")').count()) > 0
        ? "Salvar assim mesmo"
        : "Salvar";
    const tituloDialogo = await confirmarDialogo(rotulo);
    anotar(`CÁLCULO · diálogo de gravação: "${tituloDialogo}"`);
  }
  const foi = await esperarUrl((u) => /^\/calculos-custo\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check("CÁLCULO · salvar cria um documento CALC próprio e abre ele", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(900);
  const codigoCalc = await texto(".doc-title .code");
  check("CÁLCULO · o documento salvo tem código CALC", /^CALC-\d+/.test(codigoCalc), codigoCalc);
  S.dados.calculo = { code: codigoCalc, url: caminho(), custoUnidade };
  salvarEstado();
  await shot("e2e2-11-calculo-salvo");
}

// ── MARCO 12 · CMV ────────────────────────────────────────────────────────
async function marco12Cmv() {
  const produtoId = S.dados.produto.id;
  await abrir(`/produtos/${produtoId}/cmv`, { espera: ".doc-title h1, .page__title" });
  await preencher("#cmv-quantity", String(QUANTIDADE_PEDIDA));
  await preencher("#cmv-reference-date", hoje());
  const t0 = Date.now();
  await clicarBotao("Calcular CMV");
  await page.waitForTimeout(3000);
  const gasto = Date.now() - t0;
  if (gasto > 4000) ergo(`cálculo de CMV levou ${gasto}ms`);

  const cartoes = await page.evaluate(() =>
    [...document.querySelectorAll("div.cmv-card")].map((c) => ({
      rotulo: (c.querySelector(".cmv-card__label")?.textContent ?? "").trim(),
      valor: (c.querySelector(".cmv-card__value")?.textContent ?? "").trim(),
      nota: (c.querySelector(".cmv-card__note")?.textContent ?? "").trim(),
    })),
  );
  const ler = (r) => cartoes.find((c) => c.rotulo === r)?.valor ?? null;
  const total = ler("CMV total");
  const unidade = ler("CMV por unidade");
  check(
    "CMV · a simulação devolveu total e custo unitário",
    Boolean(total) && total !== "CMV indisponível" && Boolean(unidade) && unidade !== "—",
    JSON.stringify(cartoes),
  );
  const numero = (t) =>
    t ? Number(t.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) : NaN;
  const totalNum = numero(total);
  const unidadeNum = numero(unidade);
  check(
    "CMV · o valor é positivo e coerente com o lote simulado",
    Number.isFinite(totalNum) &&
      totalNum > 0 &&
      Math.abs(totalNum / QUANTIDADE_PEDIDA - unidadeNum) < 0.05,
    `total=${totalNum} unidade=${unidadeNum}`,
  );
  S.dados.cmv = { total, unidade, qualidade: ler("Qualidade do custo") };
  anotar(
    `CMV · ${total} por ${QUANTIDADE_PEDIDA} unidades (${unidade}/un), ` +
      `qualidade "${ler("Qualidade do custo")}"`,
  );
  salvarEstado();
  await shot("e2e2-12-cmv");
}

// ── MARCO 13 · Pedido ─────────────────────────────────────────────────────
async function marco13Pedido() {
  if (S.dados.pedido?.confirmado) {
    anotar(`PEDIDO · ${S.dados.pedido.code} já confirmado — marco pulado`);
    return;
  }

  await abrir("/comercial/pedidos");
  const vazioPed = await texto("td.table__empty");
  if (vazioPed) registrarVazio("Comercial › Pedidos", vazioPed);

  await clicarBotao("+ Novo pedido").catch(async () => {
    await abrir("/comercial/pedidos/novo", { espera: ".doc-title h1" });
  });
  if (caminho() !== "/comercial/pedidos/novo") {
    await abrir("/comercial/pedidos/novo", { espera: ".doc-title h1" });
  }
  await page.waitForSelector("#co-customer", { timeout: 20000 });

  await escolherEntidade("#co-customer", IDENT.cliente.tradeName, IDENT.cliente.tradeName);
  await clicarBotao("+ Adicionar produto");
  await page.waitForTimeout(400);
  const comboProduto = page.locator('input[id^="pedido-produto-"]').first();
  await escolherEntidade(comboProduto, PRODUTO.nome, PRODUTO.nome);
  check(
    "PEDIDO · o produto DIRETO é aceito no pedido — nasceu operacional, não em desenvolvimento",
    (await comboProduto.inputValue()).includes(S.dados.produto.code),
    await comboProduto.inputValue(),
  );
  const linhaProduto = page.locator("table.table--order-lines tbody tr").first();
  await linhaProduto.locator('input[inputmode="decimal"]').first().fill(String(QUANTIDADE_PEDIDA));
  await page.waitForTimeout(200);

  await clicarBotao("Salvar rascunho");
  const salvou = await esperarUrl(
    (u) => /^\/comercial\/pedidos\/[0-9a-f-]{36}$/.test(u.pathname),
    30000,
  );
  if (!check("PEDIDO · o rascunho foi salvo e ganhou URL própria", salvou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(900);
  const codigo = await texto(".doc-title h1");
  check("PEDIDO · o pedido tem código PED gerado", /^PED-\d+/.test(codigo), codigo);
  S.dados.pedido = { code: codigo, url: caminho() };
  salvarEstado();

  await clicarBotao("Confirmar pedido");
  const titulo = await confirmarDialogo("Confirmar");
  anotar(`PEDIDO · diálogo de confirmação: "${titulo}"`);
  await page.waitForTimeout(2500);
  check(
    "PEDIDO · confirmado, os produtos e quantidades ficam congelados",
    (await texto(".doc-title .badge")) === "Confirmado",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  S.dados.pedido.confirmado = true;
  salvarEstado();
  await shot("e2e2-13-pedido-confirmado");
}

// ── MARCO 14 · Produção ───────────────────────────────────────────────────
async function marco14Producao() {
  if (S.dados.lotePa) {
    /*
     * Reexecução: a OP já foi concluída e o lote de produto acabado existe.
     * Refazer o caminho produziria uma segunda OP e um segundo lote sem
     * pedido que os justifique.
     */
    const op = await apiGet(`/production-orders/${S.dados.op.id}`);
    check(
      `PRODUÇÃO · ${S.dados.op.code}, executada pela tela em execução anterior, está Concluída`,
      op.status === "COMPLETED",
      String(op.status),
    );
    check(
      "PRODUÇÃO · a OP registrou consumo real em todos os materiais da formulação",
      (op.requirements ?? []).length === MP.length + 1 &&
        (op.requirements ?? []).every((r) => Number(r.consumedQuantity ?? 0) > 0),
      JSON.stringify(
        (op.requirements ?? []).map((r) => `${r.itemCode}:${r.consumedQuantity ?? 0}`),
      ),
    );
    check(
      "PROVA 6 · nenhum material ficou por reconciliar na OP concluída em execução anterior",
      (op.requirements ?? []).length > 0 &&
        (op.requirements ?? []).every(
          (r) =>
            r.reconciliationStatus === "RECONCILED" ||
            r.reconciliationStatus === "VARIANCE_ACCEPTED",
        ),
      JSON.stringify((op.requirements ?? []).map((r) => `${r.itemCode}=${r.reconciliationStatus}`)),
    );
    anotar(
      `PRODUÇÃO · ${S.dados.op.code} produziu ${op.producedQuantity} de ${op.plannedQuantity} un; ` +
        `lote de PA ${S.dados.lotePa.code}`,
    );
    await abrir(S.dados.op.url, { espera: ".doc-title h1" });
    await shot("e2e2-14-op-concluida");
    return;
  }

  await abrir(S.dados.pedido.url, { espera: ".doc-title h1" });

  if ((await texto(".doc-title .badge")) === "Confirmado") {
    /*
     * A ajuda do Plano de Atendimento é lida AQUI, e não no marco 15.
     *
     * A seção do Plano — e o painel que a explica — só existe enquanto o
     * pedido está Confirmado. Aplicado o plano, ele vira "Em atendimento" e a
     * seção sai da tela. Ler a ajuda depois exigiria abrir outro documento e
     * chamar de "ajuda do Plano" o que não é; ler agora é ler onde ela mora.
     * O documento tem painel PRÓPRIO no índice 0 desde a correção a346cec, e
     * o do Plano é o do índice 1.
     */
    const ajudaDoPedido = await lerAjuda("Pedido (documento, status Confirmado)", { indice: 0 });
    const ajudaDoPlano = await lerAjuda("Plano de Atendimento (seção do pedido)", { indice: 1 });
    S.dados.ajudaLida = {
      pedido: ajudaDoPedido?.titulo ?? null,
      plano: ajudaDoPlano?.titulo ?? null,
    };
    check(
      "AJUDA · o documento do Pedido tem painel PRÓPRIO, separado do painel do Plano",
      Boolean(ajudaDoPedido) &&
        Boolean(ajudaDoPlano) &&
        ajudaDoPedido.titulo !== ajudaDoPlano.titulo &&
        !/plano de atendimento/i.test(ajudaDoPedido.titulo),
      `pedido="${ajudaDoPedido?.titulo}" plano="${ajudaDoPlano?.titulo}"`,
    );
    anotar(
      `AJUDA · Pedido → "${ajudaDoPedido?.titulo}" · Plano de Atendimento → ` +
        `"${ajudaDoPlano?.titulo}" (lidos no documento Confirmado, antes de aplicar o plano)`,
    );
    await shot("e2e2-14z-ajuda-pedido-e-plano");

    await page.waitForSelector('input[aria-label^="Produzir de"]', { timeout: 40000 });
    await page.getByLabel(`Produzir de ${S.dados.produto.code}`).fill(String(QUANTIDADE_PEDIDA));
    await page.waitForTimeout(900);
    const materiais = await page
      .locator("section.form-section")
      .filter({ has: page.locator("h3", { hasText: "Plano de Atendimento" }) })
      .locator("table")
      .nth(1)
      .allTextContents();
    anotar(`PLANO · impacto de materiais na tela: ${JSON.stringify(materiais).slice(0, 400)}`);
    await shot("e2e2-14a-plano");

    await clicarBotao("Aplicar Plano de Atendimento");
    const titulo = await confirmarDialogo("Aplicar Plano");
    check(
      "PLANO · aplicar pede confirmação e avisa que nada é liberado automaticamente",
      /Aplicar Plano de Atendimento/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(4000);
  } else {
    anotar("PLANO · o pedido já não estava Confirmado — plano aplicado em execução anterior");
  }

  check(
    "PLANO · aplicado, o pedido passou a Em atendimento",
    (await texto(".doc-title .badge")) === "Em atendimento",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const ops = ((await apiGet("/production-orders?pageSize=50")).productionOrders ?? []).filter(
    (o) => o.productCode === S.dados.produto.code,
  );
  check(
    "PLANO · o plano criou uma Ordem de Produção em rascunho para o déficit",
    ops.length === 1,
    JSON.stringify(ops.map((o) => `${o.code}/${o.status}/${o.plannedQuantity}`)),
  );
  if (!ops[0]) return;
  S.dados.op = { id: ops[0].id, code: ops[0].code, url: `/producao/ordens/${ops[0].id}` };
  salvarEstado();
  await shot("e2e2-14b-plano-aplicado");

  // ── A OP ────────────────────────────────────────────────────────────────
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });
  if ((await texto(".doc-title .badge")) === "Rascunho") {
    await clicarBotao("Planejar OP");
    await page.waitForTimeout(3500);
  }
  check(
    "OP · planejada, a ordem calcula a necessidade de materiais",
    (await texto(".doc-title .badge")) === "Planejada",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  const necessidades = await page
    .locator("section.form-section")
    .filter({ has: page.locator("h3", { hasText: "Necessidade de Materiais" }) })
    .locator("tbody tr")
    .allTextContents();
  check(
    "OP · a necessidade lista os quatro materiais da formulação ativa",
    necessidades.length === MP.length + 1,
    JSON.stringify(necessidades.map((n) => n.replace(/\s+/g, " ").slice(0, 70))),
  );
  anotar(`OP · necessidade calculada: ${JSON.stringify(necessidades.map((n) => n.replace(/\s+/g, " ")))}`);
  await shot("e2e2-14c-op-necessidades");

  if (await existeBotao("Liberar OP")) {
    const botao = page.getByRole("button", { name: "Liberar OP", exact: true });
    if (await botao.isDisabled()) {
      const dica = (await textos("div.line-actions p.field__hint")).join(" | ");
      check("OP · o botão Liberar OP está habilitado (há material disponível)", false, dica);
      return;
    }
    await clicarBotao("Liberar OP");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(3500);
  }
  check(
    "OP · com material disponível, a OP foi liberada",
    (await texto(".doc-title .badge")) === "Liberada",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  await shot("e2e2-14d-op-liberada");

  // ── Picking ─────────────────────────────────────────────────────────────
  const picking = page
    .locator("section.form-section")
    .filter({ has: page.locator("h3", { hasText: "Picking" }) });
  for (let passo = 0; passo < 15; passo += 1) {
    const pendentes = picking.locator("tbody tr").filter({ hasText: "Pendente" });
    if ((await pendentes.count()) === 0) break;
    const linha = pendentes.first();
    const conteudo = ((await linha.textContent()) ?? "").replace(/\s+/g, " ");
    const loteEsperado = (conteudo.match(/LT-\d{8}-\d{6}/) ?? [])[0];
    const escanear = linha.getByRole("button", { name: "Escanear / Informar lote", exact: true });
    if ((await escanear.count()) > 0) {
      await escanear.click();
      await page.waitForSelector("#lot-scanner-manual", { timeout: 20000 });
      await preencher("#lot-scanner-manual", loteEsperado ?? "");
      await page.locator("#lot-scanner-manual").press("Enter");
      await page.waitForTimeout(2400);
      if ((await page.locator("#mismatch-title").count()) > 0) {
        check("PICKING · o lote informado bate com o reservado", false, `divergência em ${loteEsperado}`);
        return;
      }
      continue;
    }
    const confirmar = linha.getByRole("button", { name: "Confirmar separação", exact: true });
    if ((await confirmar.count()) > 0) {
      await confirmar.click();
      await page.waitForTimeout(2200);
      continue;
    }
    anotar(`PICKING · linha sem ação disponível: "${conteudo.slice(0, 90)}"`);
    break;
  }
  const conferidas = (await picking.locator("tbody tr").allTextContents())
    .map((t) => t.replace(/\s+/g, " "))
    .filter((t) => /LT-|Pendente|Conferido/.test(t));
  check(
    "PICKING · todas as linhas de reserva foram conferidas por lote",
    conferidas.length > 0 && conferidas.every((l) => l.includes("Conferido")),
    JSON.stringify(conferidas.map((l) => l.slice(0, 90))),
  );
  await shot("e2e2-14e-picking");

  // ── Consumo real, linha a linha ─────────────────────────────────────────
  const consumo = secao("Consumo Real");
  const cabecalhos = (await consumo.locator("thead th").allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  const colRestante = cabecalhos.findIndex((h) => h.startsWith("Restante"));
  anotar(`CONSUMO · colunas da tabela: ${JSON.stringify(cabecalhos)}`);

  /*
   * PROVA 6 · UM material fica SEM consumo, de propósito.
   *
   * A regra nova diz que a OP não conclui com material por reconciliar. Uma
   * jornada que consumisse as quatro linhas nunca encostaria nela — passaria
   * por cima e o relatório afirmaria uma proteção que não foi exercida. A
   * linha que sobra é o material do teste do bloqueio, logo adiante.
   */
  const codigoDaLinha = async (linha) => {
    const primeira = ((await linha.locator("td").first().textContent()) ?? "").replace(/\s+/g, " ");
    return (primeira.match(/\b(?:MP|EMB|ME|PA)-\d+/) ?? [""])[0];
  };
  const linhasIniciais = await consumo.locator("tbody tr").count();
  const pendenteDeProposito = await codigoDaLinha(
    consumo.locator("tbody tr").nth(linhasIniciais - 1),
  );
  S.dados.materialPendente = pendenteDeProposito;
  anotar(
    `CONSUMO · ${linhasIniciais} linhas de reserva; ${pendenteDeProposito} fica SEM consumo de ` +
      "propósito, para o bloqueio da conclusão ser medido em vez de suposto",
  );

  let confirmadas = 0;
  let deixadas = 0;
  for (let passo = 0; passo < 15; passo += 1) {
    const total = await consumo.locator("tbody tr").count();
    let agiu = false;
    for (let i = 0; i < total; i += 1) {
      const linha = consumo.locator("tbody tr").nth(i);
      const campo = linha.locator('input[inputmode="decimal"]');
      if ((await campo.count()) === 0) continue;
      if (await campo.first().isDisabled()) continue;
      if ((await codigoDaLinha(linha)) === pendenteDeProposito) {
        deixadas += 1;
        continue;
      }
      const celulas = (await linha.locator("td").allTextContents()).map((t) =>
        t.replace(/\s+/g, " ").trim(),
      );
      const bruto = colRestante >= 0 ? celulas[colRestante] : "";
      const restante = (bruto.match(/[\d.,]+/) ?? [""])[0]
        .replace(/\.(?=\d{3}\b)/g, "")
        .replace(",", ".");
      if (!restante || Number(restante) <= 0) continue;
      await campo.first().fill(restante);
      await page.waitForTimeout(200);
      const botao = linha.getByRole("button", { name: "Confirmar consumo", exact: true });
      if ((await botao.count()) === 0 || (await botao.isDisabled())) continue;
      await botao.click();
      await page.waitForTimeout(2600);
      confirmadas += 1;
      agiu = true;
      break; // a tabela foi re-renderizada: recomeçar a leitura
    }
    if (!agiu) break;
  }
  check(
    "CONSUMO · todas as linhas de reserva menos a reservada ao teste tiveram consumo apontado",
    confirmadas === linhasIniciais - 1 && deixadas > 0,
    `confirmadas=${confirmadas} de ${linhasIniciais} · deixada=${pendenteDeProposito}`,
  );
  salvarEstado();
  await shot("e2e2-14f-consumo");

  // ── Apontamento de produção ─────────────────────────────────────────────
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });
  if ((await page.locator("#output-quantity").count()) > 0) {
    await preencher("#output-quantity", String(QUANTIDADE_PRODUZIDA));
    await selecionar("#output-destination", "NEW_LOT");
    await preencher("#output-business-lot", LOTE_VERIDI);
    if ((await page.locator("#output-expiry").count()) > 0) {
      await preencher("#output-expiry", daquiAnos(2));
    }
    await clicarBotao("Registrar produção");
    await page.waitForTimeout(4000);
  } else {
    anotar("PRODUÇÃO · formulário de apontamento ausente — produção possivelmente já registrada");
  }

  const numeros = await page.evaluate(() =>
    [...document.querySelectorAll("dl.definition-list dt")]
      .map((dt) => ({
        rotulo: (dt.textContent ?? "").replace(/\s+/g, " ").trim(),
        valor: (dt.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim(),
      }))
      .filter((x) => ["Planejado", "Produzido", "Restante", "Variação"].includes(x.rotulo)),
  );
  check(
    "PRODUÇÃO · a tela mostra planejado e produzido lado a lado",
    numeros.some((n) => n.rotulo === "Planejado") && numeros.some((n) => n.rotulo === "Produzido"),
    JSON.stringify(numeros),
  );
  anotar(`PRODUÇÃO · planejado × realizado: ${JSON.stringify(numeros)}`);

  // ════════════════════════════════════════════════════════════════════════
  // PROVA 6 · a OP NÃO conclui com material por reconciliar
  // ════════════════════════════════════════════════════════════════════════
  const pendente = S.dados.materialPendente;
  const botaoConcluir = page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true });
  await botaoConcluir.waitFor({ state: "visible", timeout: 20000 });
  check(
    `PROVA 6 · com ${pendente} sem consumo, o botão "Concluir OP" está DESABILITADO`,
    await botaoConcluir.isDisabled(),
    `desabilitado=${await botaoConcluir.isDisabled()}`,
  );

  const avisoPendencia = (await textos(".line-actions p.form-alert")).join(" | ");
  check(
    "PROVA 6 · a tela NOMEIA o material que falta, em vez de só desabilitar o botão",
    /falta reconciliar/i.test(avisoPendencia) && avisoPendencia.includes(pendente),
    `aviso="${avisoPendencia}"`,
  );
  anotar(`PROVA 6 · impedimento exibido na tela: "${avisoPendencia}"`);

  const situacaoNaTabela = await secao("Necessidade de Materiais")
    .locator("tbody tr")
    .filter({ hasText: pendente })
    .first()
    .textContent();
  check(
    "PROVA 6 · a linha do material pendente mostra a situação da reconciliação",
    /sem consumo|consumo parcial/i.test((situacaoNaTabela ?? "").replace(/\s+/g, " ")),
    (situacaoNaTabela ?? "").replace(/\s+/g, " ").slice(0, 200),
  );
  await shot("e2e2-14g-concluir-bloqueado-material-pendente");

  /*
   * O botão desabilitado não é contornável pelo navegador, e isso é
   * resultado, não lacuna: o React decide o `onClick` pelas PROPS, então
   * soltar o atributo `disabled` do DOM e clicar não dispara handler nenhum —
   * nada sai do navegador, e não há requisição para o servidor recusar. A
   * recusa equivalente do servidor (`unreconciled_materials`) é coberta por
   * apps/api/src/modules/production-orders/material-reconciliation.test.ts,
   * fora do alcance desta jornada, que não faz POST de API.
   */

  // ── Consumo PARCIAL: não resolve a pendência, e é assim que deve ser ─────
  /*
   * Consumir o restante inteiro fecharia a pendência sem nunca exercitar a
   * justificativa — que é a outra metade da regra nova. O parcial mantém a
   * linha na rastreabilidade e ainda deixa a diferença a explicar.
   *
   * DECIMAL 5 · a quantidade é digitada com VÍRGULA. A correção do separador
   * é do sistema, não de uma tela de dinheiro.
   */
  const consumo14 = secao("Consumo Real");
  const linhaPendente = consumo14.locator("tbody tr").filter({ hasText: pendente }).first();
  const cabecalhos14 = (await consumo14.locator("thead th").allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  const colRestante14 = cabecalhos14.findIndex((h) => h.startsWith("Restante"));
  const celulas14 = (await linhaPendente.locator("td").allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  const restante14 = Number(
    (celulas14[colRestante14] ?? "")
      .match(/[\d.,]+/)?.[0]
      .replace(/\.(?=\d{3}\b)/g, "")
      .replace(",", ".") ?? "0",
  );
  const parcial = Number((restante14 / 2).toFixed(3));
  await linhaPendente
    .locator('input[inputmode="decimal"]')
    .first()
    .fill(comoDigitado(String(parcial)));
  await page.waitForTimeout(250);
  await linhaPendente.getByRole("button", { name: "Confirmar consumo", exact: true }).click();
  await page.waitForTimeout(2800);
  registrarSeparador({
    campo: "Consumo Real › Consumir agora",
    onde: `Produção › OP ${S.dados.op.code} › Consumo Real (${pendente})`,
    digitado: comoDigitado(String(parcial)),
    como: "virgula",
  });
  const consumoGravado = (
    (await apiGet(`/production-orders/${S.dados.op.id}`)).requirements ?? []
  ).find((r) => r.itemCode === pendente);
  check(
    `DECIMAL · Consumo Real aceita "${comoDigitado(String(parcial))}" e grava ${parcial}`,
    consumoGravado != null && Math.abs(Number(consumoGravado.consumedQuantity) - parcial) < 0.001,
    `gravado=${consumoGravado?.consumedQuantity} esperado=${parcial}`,
  );
  anotar(
    `RECONCILIAÇÃO · ${pendente} recebeu consumo PARCIAL de ${comoDigitado(String(parcial))} ` +
      `(restante era ${restante14}) — a diferença fica para justificar`,
  );

  const aindaPendente = (await textos(".line-actions p.form-alert")).join(" | ");
  const concluirAindaTravado = await page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true })
    .isDisabled();
  check(
    "PROVA 6 · consumo parcial NÃO resolve a pendência: a tela continua cobrando o material",
    aindaPendente.includes(pendente) && concluirAindaTravado,
    `aviso="${aindaPendente}" botãoDesabilitado=${concluirAindaTravado}`,
  );
  await shot("e2e2-14h-consumo-parcial-ainda-bloqueia");

  // ── "Justificar diferença", na coluna Situação da Necessidade de Materiais
  const linhaNecessidade = secao("Necessidade de Materiais")
    .locator("tbody tr")
    .filter({ hasText: pendente })
    .first();
  await linhaNecessidade
    .getByRole("button", { name: "Justificar diferença", exact: true })
    .click();
  await page.waitForSelector("#variance-reason", { timeout: 20000 });
  const tituloJustificativa = await texto("#variance-title");
  check(
    "RECONCILIAÇÃO · “Justificar diferença” abre o pedido de motivo para AQUELE material",
    tituloJustificativa.includes(pendente),
    tituloJustificativa,
  );
  await preencher(
    "#variance-reason",
    `Sobra devolvida ao lote de origem: a formulacao pedia mais ${pendente} do que o envase consumiu.`,
  );
  await shot("e2e2-14i-justificar-diferenca");
  await clicarBotao("Registrar justificativa");
  await page.waitForTimeout(3000);

  // ── Reconciliação completa ──────────────────────────────────────────────
  const opAntesDeConcluir = await apiGet(`/production-orders/${S.dados.op.id}`);
  const requisitos = opAntesDeConcluir.requirements ?? [];
  const porReconciliar = requisitos.filter(
    (r) => r.reconciliationStatus === "PENDING_NONE" || r.reconciliationStatus === "PENDING_PARTIAL",
  );
  check(
    "PROVA 6 · nenhum material continua por reconciliar antes de concluir a OP",
    requisitos.length > 0 && porReconciliar.length === 0,
    JSON.stringify(requisitos.map((r) => `${r.itemCode}=${r.reconciliationStatus}`)),
  );
  check(
    "PROVA 6 · a diferença ficou registrada como divergência justificada, com motivo e autor",
    requisitos.some(
      (r) =>
        r.itemCode === pendente &&
        r.reconciliationStatus === "VARIANCE_ACCEPTED" &&
        (r.varianceReason ?? "").length > 0 &&
        (r.varianceAcceptedBy ?? "").length > 0,
    ),
    JSON.stringify(
      requisitos
        .filter((r) => r.itemCode === pendente)
        .map((r) => `${r.reconciliationStatus}/${r.varianceReason}/${r.varianceAcceptedBy}`),
    ),
  );
  const progressoConsumo = (await textos(".form-section__sub")).find((t) =>
    /materiais reconciliados/.test(t),
  );
  check(
    "PROVA 6 · a tela mostra o progresso da reconciliação completo",
    /(\d+) de \1 materiais reconciliados/.test(progressoConsumo ?? ""),
    `"${progressoConsumo ?? "—"}"`,
  );
  anotar(`PROVA 6 · progresso na tela: "${progressoConsumo ?? "—"}"`);
  anotar(
    `PROVA 6 · situações finais: ${JSON.stringify(
      requisitos.map((r) => `${r.itemCode}=${r.reconciliationStatus}`),
    )}`,
  );
  await shot("e2e2-14j-tudo-reconciliado");

  // ── Conclusão, agora permitida ──────────────────────────────────────────
  const concluirLiberado = page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true });
  check(
    "PROVA 6 · reconciliado tudo, o MESMO botão “Concluir OP” fica habilitado",
    !(await concluirLiberado.isDisabled()),
    `desabilitado=${await concluirLiberado.isDisabled()}`,
  );
  await concluirLiberado.click();
  await page.waitForTimeout(900);
  if ((await page.locator("#op-completion-reason").count()) > 0) {
    await preencher("#op-completion-reason", "Rendimento conforme planejado no cenario E2E2.");
  }
  await confirmarModal("Concluir OP");
  await page.waitForTimeout(3500);
  check(
    "PRODUÇÃO · a OP foi concluída pela tela",
    (await texto(".doc-title .badge")) === "Concluída",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  const opConcluida = await apiGet(`/production-orders/${S.dados.op.id}`);
  check(
    "PROVA 6 · a OP só chegou a Concluída com TODOS os materiais reconciliados",
    (opConcluida.materialReconciliation?.reconciledRequirements ?? -1) ===
      (opConcluida.materialReconciliation?.totalRequirements ?? -2),
    JSON.stringify(opConcluida.materialReconciliation),
  );

  const lotes = ((await apiGet("/lots?pageSize=100")).lots ?? []).filter(
    (l) => l.itemCode === S.dados.produto.itemPA,
  );
  check(
    "PRODUÇÃO · o apontamento criou o lote de produto acabado",
    lotes.length === 1,
    JSON.stringify(lotes.map((l) => `${l.code}/${l.status}`)),
  );
  if (lotes[0]) {
    S.dados.lotePa = { id: lotes[0].id, code: lotes[0].code, status: lotes[0].status };
    anotar(`PRODUÇÃO · lote de PA ${lotes[0].code} nasceu com situação ${lotes[0].status}`);
  }
  salvarEstado();
  await shot("e2e2-14-op-concluida");
}

// ── MARCO 15 · Ajuda contextual ───────────────────────────────────────────
const TELAS_DE_AJUDA = [
  {
    nome: "Formulação (versão do produto)",
    rota: () => S.dados.formulacaoUrl ?? `/producao/formulacoes/${S.dados.produto.id}`,
    espera: ".doc-title h1",
  },
  {
    /*
     * O Pedido ganhou painel PRÓPRIO e INCONDICIONAL (a346cec): antes o único
     * ajuda do documento vivia dentro da seção do Plano e sumia justamente
     * quando o pedido virava "Em atendimento". Aqui o documento é aberto no
     * estado em que a ajuda antes desaparecia — é esse o teste.
     */
    nome: "Pedido (documento em Em atendimento)",
    rota: () => S.dados.pedido.url,
    espera: ".doc-title h1",
  },
  {
    nome: "Ordem de Produção",
    rota: () => S.dados.op.url,
    espera: ".doc-title h1",
  },
  {
    nome: "CMV do produto",
    rota: () => `/produtos/${S.dados.produto.id}/cmv`,
    espera: ".doc-title h1, .page__title",
  },
  {
    nome: "Faturamento",
    rota: () => "/comercial/faturamento",
    espera: ".page__title",
  },
];

/**
 * Telas de gestão que NÃO tinham ajuda nenhuma até 62013d9.
 *
 * A verificação não é "o painel abre": um painel que abrisse com o tópico do
 * CMV abriria igual e explicaria a tela do vizinho — foi exatamente o defeito
 * corrigido. O que se mede é o painel abrir E falar da PRÓPRIA tela.
 */
const TELAS_DE_GESTAO_SEM_AJUDA_ANTES = [
  {
    nome: "Gestão › Precificação (lista)",
    rota: () => "/gestao/precificacao",
    espera: ".page__title",
    // O título do painel precisa falar de PREÇO, não de CMV nem de custo.
    proprio: /pre(ç|c)o|precifica/i,
    naoPodeSer: /^Como o CMV/i,
  },
  {
    nome: "Cálculo de custo (documento CALC)",
    rota: () => S.dados.calculo.url,
    espera: ".doc-title h1, .page__title",
    proprio: /c(á|a)lculo|custo/i,
    naoPodeSer: /^Como o CMV/i,
  },
];

async function marco15Ajuda() {
  for (const tela of TELAS_DE_AJUDA) {
    await abrir(tela.rota(), { espera: tela.espera });
    await page.waitForTimeout(800);
    const painel = await lerAjuda(tela.nome);

    if (
      !check(
        `AJUDA · ${tela.nome} oferece o painel “Como funciona” e ele abre`,
        Boolean(painel),
        "nenhum botão .context-help__trigger na tela",
      )
    ) {
      continue;
    }
    check(
      `AJUDA · ${tela.nome} · o painel responde “o que é esta tela”`,
      painel.oQueE,
      `resumo (${painel.resumo.length} car.): "${painel.resumo.slice(0, 160)}"`,
    );
    check(
      `AJUDA · ${tela.nome} · o painel responde “quando eu uso”`,
      painel.quandoUso,
      JSON.stringify(painel.fluxos),
    );
    check(
      `AJUDA · ${tela.nome} · o painel responde “o que acontece depois”`,
      painel.oQueAcontece,
      `${painel.tamanho} caracteres de conteúdo`,
    );
    anotar(
      `AJUDA · ${tela.nome} → "${painel.titulo}" · ${painel.conceitos} conceitos · ` +
        `${painel.fluxos.length} fluxo(s) · ${painel.tamanho} caracteres`,
    );
    await shot(`e2e2-15-ajuda-${tela.nome.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`);
  }

  // ── A lista de Pedidos, que abria a ajuda do Plano, agora tem a própria ──
  await abrir("/comercial/pedidos", { espera: ".page__title" });
  await page.waitForTimeout(600);
  const tituloDaTela = await texto(".page__title");
  const ajudaDaLista = await lerAjuda("Comercial › Pedidos (LISTA)");
  if (
    !check(
      "AJUDA · a lista de Pedidos tem um painel de ajuda",
      Boolean(ajudaDaLista),
      "nenhum gatilho de ajuda na listagem",
    )
  ) {
    return;
  }

  const abreOPlano = /plano de atendimento/i.test(ajudaDaLista.titulo);
  anotar(
    `AJUDA · a tela "${tituloDaTela}" abre o painel "${ajudaDaLista.titulo}" — ` +
      `resumo: "${ajudaDaLista.resumo.slice(0, 200)}"`,
  );
  check(
    "AJUDA · a lista de Pedidos abre painel PRÓPRIO, não mais o do Plano de Atendimento",
    !abreOPlano,
    `tela="${tituloDaTela}" painel="${ajudaDaLista.titulo}"`,
  );
  if (abreOPlano) {
    finding(
      "MEDIUM",
      "REGRESSÃO · Comercial › Pedidos (lista) voltou a abrir a ajuda do PLANO DE ATENDIMENTO",
      `Abrir /comercial/pedidos (título "${tituloDaTela}") e clicar em “ⓘ Como funciona”: o painel ` +
        `que abre é "${ajudaDaLista.titulo}", que explica dividir um pedido já confirmado entre ` +
        "estoque e produção — coisa que só existe dentro do documento. O tópico próprio " +
        '"comercial.pedidos" foi escrito em a346cec e o contrato de tela↔tópico está em ' +
        "apps/web/src/pages/help-topic-contract.test.ts.",
    );
  }
  await shot("e2e2-15-ajuda-lista-pedidos");

  // ══════════════════════════════════════════════════════════════════════════
  // PROVA 7b · Precificação e Cálculo de custo, que NÃO tinham ajuda nenhuma
  // ══════════════════════════════════════════════════════════════════════════
  for (const tela of TELAS_DE_GESTAO_SEM_AJUDA_ANTES) {
    await abrir(tela.rota(), { espera: tela.espera });
    await page.waitForTimeout(700);
    const painel = await lerAjuda(tela.nome);
    if (
      !check(
        `PROVA 7 · ${tela.nome} passou a ter “Como funciona” (antes não tinha nenhum)`,
        Boolean(painel),
        `nenhum .context-help__trigger em ${caminho()}`,
      )
    ) {
      continue;
    }
    check(
      `PROVA 7 · ${tela.nome} · o painel é da PRÓPRIA tela, não emprestado do CMV`,
      tela.proprio.test(painel.titulo) && !tela.naoPodeSer.test(painel.titulo),
      `título="${painel.titulo}"`,
    );
    check(
      `PROVA 7 · ${tela.nome} · o painel responde “o que é / quando uso / o que acontece depois”`,
      painel.oQueE && painel.quandoUso && painel.oQueAcontece,
      `oQueE=${painel.oQueE} quandoUso=${painel.quandoUso} depois=${painel.oQueAcontece}`,
    );
    anotar(
      `PROVA 7 · ${tela.nome} → "${painel.titulo}" · ${painel.conceitos} conceitos · ` +
        `${painel.fluxos.length} fluxo(s) · ${painel.tamanho} caracteres`,
    );
    await shot(
      `e2e2-15-ajuda-nova-${tela.nome.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
    );
  }

  // O painel do Plano de Atendimento foi lido no marco 14, onde ele mora.
  const planoLido = S.registro.ajuda
    .concat(ajudas)
    .find((a) => /Plano de Atendimento \(seção do pedido\)/.test(a.tela));
  check(
    "AJUDA · Plano de Atendimento · o painel foi lido na seção que ele explica",
    Boolean(planoLido) &&
      planoLido.oQueE &&
      planoLido.quandoUso &&
      planoLido.oQueAcontece,
    planoLido
      ? `"${planoLido.titulo}" · oQueE=${planoLido.oQueE} quandoUso=${planoLido.quandoUso} depois=${planoLido.oQueAcontece}`
      : "não lido no marco 14",
  );
}


// ── MARCO 16 · Exportação ─────────────────────────────────────────────────
const EXPORTACOES = [
  {
    tela: "Cadastros › Itens de estoque",
    rota: "/cadastros/itens",
    busca: "#items-search",
    slug: "itens",
  },
  {
    tela: "Compras › Ordens de Compra",
    rota: "/compras/ordens",
    busca: "#po-search",
    slug: "ordens_de_compra",
  },
  {
    tela: "Estoque › Lotes",
    rota: "/estoque/lotes",
    busca: "#lots-search",
    slug: "lotes",
  },
];

async function marco16Exportacao() {
  S.dados.exportacoes = [];
  for (const alvo of EXPORTACOES) {
    await abrir(alvo.rota, { espera: ".page__title" });
    if ((await page.locator(alvo.busca).count()) > 0) {
      await preencher(alvo.busca, P);
      await page.waitForTimeout(1400);
    }
    const linhasNaTela = (await textos("table tbody tr")).filter((l) => !/Nenhum/i.test(l)).length;

    const t0 = Date.now();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.getByRole("link", { name: "Exportar CSV", exact: true }).first().click(),
    ]);
    const nome = download.suggestedFilename();
    const destino = path.resolve(BAIXADOS, nome);
    await download.saveAs(destino);
    const conteudo = fs.readFileSync(destino, "utf8");
    const linhasCsv = conteudo.trim().split(/\r?\n/);
    const gasto = Date.now() - t0;
    if (gasto > 4000) ergo(`exportação de ${alvo.tela} levou ${gasto}ms até o arquivo chegar`);

    check(
      `EXPORTAÇÃO · ${alvo.tela} · o arquivo chega com nome coerente (veridi_<assunto>_<data>.csv)`,
      new RegExp(`^veridi_${alvo.slug}_\\d{4}-\\d{2}-\\d{2}\\.csv$`).test(nome),
      nome,
    );
    check(
      `EXPORTAÇÃO · ${alvo.tela} · o arquivo NÃO está vazio (cabeçalho + linhas)`,
      conteudo.length > 0 && linhasCsv.length >= 2,
      `${conteudo.length} bytes, ${linhasCsv.length} linha(s)`,
    );
    check(
      `EXPORTAÇÃO · ${alvo.tela} · o CSV respeita o filtro da tela e traz o cenário E2E2`,
      conteudo.includes(P),
      `cabeçalho="${linhasCsv[0]?.slice(0, 120)}"`,
    );
    anotar(
      `EXPORTAÇÃO · ${alvo.tela} → ${nome} · ${conteudo.length} bytes · ` +
        `${linhasCsv.length - 1} linha(s) de dado para ${linhasNaTela} linha(s) na tela`,
    );
    S.dados.exportacoes.push({ tela: alvo.tela, arquivo: destino, bytes: conteudo.length });
    salvarEstado();
  }
  await shot("e2e2-16-exportacao");
}

// ── MARCO 17 · Breadcrumbs ────────────────────────────────────────────────
/**
 * A trilha virou link de verdade — e link se prova CLICANDO.
 *
 * Conferir `href` provaria que o atributo existe; o que interessa é que o
 * clique SOBE um nível real, com a lista certa do outro lado. Dez telas de
 * documento usavam `.doc-crumb` (texto puro, visualmente idêntico ao
 * breadcrumb) e passaram a `PageBreadcrumbs` em a346cec — então as telas
 * escolhidas aqui são justamente as que antes não levavam a lugar nenhum.
 */
async function marco17Breadcrumbs() {
  const trilhas = [
    {
      nome: "Produção › Ordem de Produção (documento)",
      rota: () => S.dados.op.url,
      espera: ".doc-title h1",
      clicar: "Ordens de Produção",
      destino: "/producao/ordens",
    },
    {
      nome: "Estoque › Lote de produto acabado (documento)",
      rota: () => `/estoque/lotes/${S.dados.lotePa.id}`,
      espera: ".doc-title h1",
      clicar: "Lotes",
      destino: "/estoque/lotes",
    },
    {
      nome: "Produto › CMV (documento)",
      rota: () => `/produtos/${S.dados.produto.id}/cmv`,
      espera: ".doc-title h1, .page__title",
      clicar: "Produtos",
      destino: "/cadastros/produtos",
    },
    {
      nome: "Produto › Custos industriais (documento)",
      rota: () => `/produtos/${S.dados.produto.id}/custos`,
      espera: ".doc-title h1, .page__title",
      clicar: "Produtos",
      destino: "/cadastros/produtos",
    },
    {
      nome: "Produção › Formulação (versão)",
      rota: () => S.dados.formulacaoUrl,
      espera: ".doc-title h1",
      clicar: "Formulações",
      destino: "/producao/formulacoes",
    },
    {
      nome: "Ordens de Compra › OC",
      rota: () => S.dados.ordemDeCompra.url,
      espera: ".doc-title h1",
      clicar: "Ordens de Compra",
      destino: "/compras/ordens",
    },
    {
      nome: "Recebimentos › REC",
      rota: () => S.dados.recebimento.url,
      espera: ".doc-title h1",
      clicar: "Recebimentos",
      destino: "/compras/recebimentos",
    },
    {
      nome: "Cadastros › Itens de estoque › Novo item",
      rota: "/cadastros/itens/novo",
      espera: ".page__title",
      clicar: "Itens de estoque",
      destino: "/cadastros/itens",
    },
  ];

  let subidas = 0;
  for (const t of trilhas) {
    const rota = typeof t.rota === "function" ? t.rota() : t.rota;
    await abrir(rota, { espera: t.espera });
    await page.waitForTimeout(500);
    const itens = await textos("nav.page-crumbs li");
    if (itens.length === 0) {
      check(`BREADCRUMB · ${t.nome} exibe a trilha da página`, false, "nav.page-crumbs ausente");
      continue;
    }
    const atual = await texto('nav.page-crumbs [aria-current="page"]');
    const link = page.locator("nav.page-crumbs a").filter({ hasText: t.clicar }).first();
    if ((await link.count()) === 0) {
      check(
        `BREADCRUMB · ${t.nome} tem o nível "${t.clicar}" clicável na trilha`,
        false,
        JSON.stringify(itens),
      );
      continue;
    }
    await link.click();
    const chegou = await esperarUrl((u) => u.pathname === t.destino, 20000);
    if (
      check(
        `BREADCRUMB · ${t.nome} → clicar em "${t.clicar}" sobe para ${t.destino}`,
        chegou,
        `${caminho()} · trilha=${JSON.stringify(itens)} · atual="${atual}"`,
      )
    ) {
      subidas += 1;
    }
    anotar(`BREADCRUMB · ${t.nome} · trilha na tela: ${itens.join(" › ")} (atual: "${atual}")`);
  }

  check(
    "PROVA 8 · pelo menos TRÊS níveis reais foram subidos clicando na trilha (sem o Voltar do navegador)",
    subidas >= 3,
    `subidas bem-sucedidas=${subidas} de ${trilhas.length} tentativas`,
  );
  S.dados.subidasPelaTrilha = subidas;
  await shot("e2e2-17-breadcrumbs");

  /*
   * O que SOBROU do padrão antigo.
   *
   * A migração de `.doc-crumb` para `PageBreadcrumbs` cobriu as telas de
   * documento da jornada, e o marco acima prova isso clicando. Estas aqui
   * continuam com texto puro — visualmente idêntico a uma trilha e sem levar
   * a lugar nenhum. Medir quantas ainda são assim é mais honesto do que
   * declarar a migração concluída.
   */
  const aindaTexto = [];
  const paraConferir = [
    { nome: "Comercial › Pedido (documento)", rota: S.dados.pedido.url, espera: ".doc-title h1" },
    {
      nome: "Cálculo de custo (documento CALC)",
      rota: S.dados.calculo.url,
      espera: ".doc-title h1, .page__title",
    },
    { nome: "Gestão › Templates de Estrutura", rota: "/gestao/templates-estrutura", espera: ".page__title" },
  ];
  for (const alvo of paraConferir) {
    await abrir(alvo.rota, { espera: alvo.espera });
    await page.waitForTimeout(400);
    const docCrumb = await texto(".doc-crumb");
    const linksNoDocCrumb = await page.locator(".doc-crumb a").count();
    const temTrilhaDeVerdade = (await page.locator("nav.page-crumbs").count()) > 0;
    if (docCrumb && linksNoDocCrumb === 0 && !temTrilhaDeVerdade) {
      aindaTexto.push(`${alvo.nome} (${alvo.rota}) → "${docCrumb}"`);
    }
  }
  anotar(
    `BREADCRUMB · telas ainda com trilha de TEXTO (.doc-crumb sem link): ` +
      `${aindaTexto.length === 0 ? "nenhuma das conferidas" : JSON.stringify(aindaTexto)}`,
  );
  if (aindaTexto.length > 0) {
    finding(
      "LOW",
      `Trilha de texto (.doc-crumb) sobrevive em ${aindaTexto.length} tela(s): a migração para ` +
        "PageBreadcrumbs cobriu os documentos da jornada, não o resto",
      "Abrir " +
        aindaTexto.join(" · ") +
        '. A trilha é <div class="doc-crumb"> com texto puro, visualmente igual ao breadcrumb de ' +
        'verdade (<nav class="page-crumbs"> com <Link>), e nenhum nível sobe. O commit a346cec ' +
        "migrou dez telas de documento; estas ficaram de fora. A convivência dos dois padrões faz " +
        "a trilha funcionar em umas telas e não em outras, sem nada que distinga as duas.",
    );
  }
}

// ── MARCO 18 · As correções, medidas onde os defeitos moravam ─────────────
/**
 * Onde a execução anterior reconfirmava DOIS defeitos, esta mede as duas
 * correções — no mesmo lugar e pelo mesmo caminho.
 *
 * A afirmação inverteu de lado, então a verificação também: o que antes era
 * "a recusa foi observada" agora é "a recusa NÃO acontece mais", e o que era
 * "contamos os RangeError" agora é "não há nenhum". Um marco que só contasse
 * concordaria com qualquer resultado.
 *
 * Nada aqui grava: um formulário barrado pela validação nativa não cria
 * produto. A base fica exatamente como estava.
 */
async function marco18Regressoes() {
  /*
   * ── Correção A · a vírgula decimal, somada da JORNADA inteira ──────────
   *
   * A soma é do estado, não da execução corrente: marco concluído não roda de
   * novo, e um relatório que só olhasse esta passagem diria "um campo" sobre
   * cinco que passaram.
   */
  salvarEstado();
  /*
   * Só conta quem de fato TEM vírgula.
   *
   * Um valor redondo — "250" — atravessa o campo sem exercitar separador
   * nenhum, e contá-lo como prova de vírgula seria inflar a evidência com
   * um caso que não prova nada.
   */
  const comVirgula = S.registro.separadores.filter(
    (s) => s.como === "virgula" && s.digitado.includes(","),
  );
  const porCampo = { ...(S.dados.separadorPorCampo ?? {}), ...separadorPorCampo };
  check(
    "PROVA 4 · a vírgula brasileira foi digitada e ACEITA em pelo menos três campos decimais",
    comVirgula.length >= 3,
    JSON.stringify(comVirgula.map((s) => `${s.campo} ← "${s.digitado}"`)),
  );
  /*
   * "Nenhum campo precisou de ponto" não se mede pelo mapa da execução
   * corrente: marco concluído não roda de novo, e numa retomada o mapa chega
   * vazio — o que diria "nenhum campo foi testado" com cara de aprovação.
   *
   * O sinal durável é o outro lado: toda retentativa com ponto DEIXA um
   * finding de regressão, gravado no estado. Zero findings desse tipo, com
   * pelo menos três campos aceitos com vírgula, é a afirmação honesta.
   */
  const regressoesDeVirgula = S.registro.findings.filter((f) =>
    /campo decimal .* recusa/i.test(f.titulo),
  );
  check(
    "PROVA 4 · nenhum campo decimal precisou de retentativa com ponto na jornada inteira",
    regressoesDeVirgula.length === 0 &&
      comVirgula.length >= 3 &&
      Object.values(porCampo).every((v) => v === "virgula"),
    `findings de recusa=${JSON.stringify(regressoesDeVirgula.map((f) => f.titulo))} · ` +
      `mapa desta execução=${JSON.stringify(porCampo)}`,
  );
  anotar(
    `PROVA 4 · campos com vírgula aceita (${comVirgula.length}): ` +
      JSON.stringify(comVirgula.map((s) => `${s.campo} ← "${s.digitado}" · ${s.onde}`)),
  );
  check(
    "PROVA 4 · um deles atravessou uma ATIVAÇÃO e continuou valendo o mesmo número",
    S.dados.estruturaDeCustos?.premissaAposAtivacao != null &&
      Math.abs(Number(S.dados.estruturaDeCustos.premissaAposAtivacao) - Number(PREMISSA_VALOR)) <
        0.001,
    `premissa após ativar a estrutura: ${S.dados.estruturaDeCustos?.premissaAposAtivacao}`,
  );

  // ── Correção B · a recursão da validação nativa em pt-BR ────────────────
  /*
   * A prova continua sendo PROVOCADA: um formulário com campo obrigatório
   * vazio é exatamente o gesto que estourava a pilha. Medir o console numa
   * navegação tranquila não diria nada sobre a correção.
   */
  await abrir("/cadastros/produtos/novo", { espera: ".page__title" });
  const produtosAntes =
    ((await apiGet(`/products?search=${encodeURIComponent(P)}&pageSize=20`)).products ?? []).length;
  const antesDaJanela = deliberados.pageerror.length;
  await preencher("#product-name", `${P} SONDA DE VALIDACAO (nao deve ser criada)`);
  await deliberadamente("obrigatorio-vazio", async () => {
    await clicarBotao("Criar produto");
    await page.waitForTimeout(1500);
  });
  const recursao = deliberados.pageerror
    .slice(antesDaJanela)
    .filter((e) => /Maximum call stack size exceeded/.test(e));
  const nativo = await page.evaluate(() => {
    const el = document.querySelector("#product-customer");
    return { faltando: el?.validity?.valueMissing ?? null, mensagem: el?.validationMessage ?? "" };
  });
  const produtosDepois =
    ((await apiGet(`/products?search=${encodeURIComponent(P)}&pageSize=20`)).products ?? []).length;

  check(
    "VALIDAÇÃO · o campo obrigatório vazio barra o envio (nenhum produto criado)",
    nativo.faltando === true && produtosDepois === produtosAntes,
    `${JSON.stringify(nativo)} produtos antes=${produtosAntes} depois=${produtosDepois}`,
  );
  check(
    "VALIDAÇÃO · a submissão com campo obrigatório vazio NÃO produz RangeError (esperado: zero)",
    recursao.length === 0,
    `${recursao.length} RangeError nesta submissão: ${JSON.stringify(recursao.slice(0, 3))}`,
  );
  anotar(
    `VALIDAÇÃO · submissão provocada com obrigatório vazio: ${recursao.length} RangeError · ` +
      `balão nativo traduzido: "${nativo.mensagem}"`,
  );
  await shot("e2e2-18-validacao-nativa-sem-recursao");

  if (recursao.length > 0) {
    finding(
      "HIGH",
      `REGRESSÃO · a recursão da validação nativa pt-BR voltou: ${recursao.length} RangeError ` +
        "“Maximum call stack size exceeded” por submissão com campo obrigatório vazio",
      "Abrir /cadastros/produtos/novo, preencher só o Nome e clicar em “Criar produto” (o campo " +
        `Cliente é required e está vazio): ${recursao.length} RangeError não capturados aparecem ` +
        "no console em série. O tratador de `invalid` em apps/web/src/lib/native-validation-ptbr.ts " +
        "voltou a chamar `campo.reportValidity()` sem guarda de reentrância — a correção está em " +
        "4ba458b. O operador não vê quebra (o balão traduzido aparece), e é isso que torna o " +
        "defeito silencioso: o console fica poluído em TODO formulário com campo obrigatório.",
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Execução
// ══════════════════════════════════════════════════════════════════════════
const JORNADA = [
  [1, "fornecedor", marco01Fornecedor],
  [2, "itens", marco02Itens],
  [3, "compra", marco03Compra],
  [4, "recebimento", marco04Recebimento],
  [5, "qualidade", marco05Qualidade],
  [6, "estoque", marco06Estoque],
  [7, "produto-direto", marco07ProdutoDireto],
  [8, "formulacao-em-branco", marco08Formulacao],
  [9, "recursos", marco09Recursos],
  [10, "estrutura-de-custos", marco10EstruturaDeCustos],
  [11, "calculo", marco11Calculo],
  [12, "cmv", marco12Cmv],
  [13, "pedido", marco13Pedido],
  [14, "producao", marco14Producao],
  [15, "ajuda-contextual", marco15Ajuda],
  [16, "exportacao", marco16Exportacao],
  [17, "breadcrumbs", marco17Breadcrumbs],
  [18, "regressoes", marco18Regressoes],
];

let parada = null;

try {
  await login();
  await abrirNavegador();
  for (const [n, nome, fn] of JORNADA) {
    await marco(n, nome, fn);
  }
} catch (erro) {
  const msg = String(erro?.message ?? erro);
  if (msg.includes("__PARADA_SOLICITADA__")) {
    parada = `parada solicitada por --ate=${ATE}`;
  } else if (msg.startsWith("__MARCO_FALHOU__")) {
    parada = `marco reprovado: ${msg.replace("__MARCO_FALHOU__ ", "")}`;
  } else {
    parada = `EXCEÇÃO: ${msg.slice(0, 800)}`;
    failures.push(`EXCEÇÃO não tratada — ${msg.slice(0, 400)}`);
    if (page) {
      try {
        await shot("e2e2-99-excecao");
      } catch {
        /* screenshot é cortesia, não requisito */
      }
    }
  }
} finally {
  if (browser) await browser.close();
}

/*
 * ZERO `RangeError` é o resultado esperado desta versão.
 *
 * A recursão da validação nativa pt-BR foi corrigida em 4ba458b. A contagem
 * abaixo não é curiosidade: qualquer ocorrência — provocada ou espontânea —
 * é REGRESSÃO, e a espontânea é a pior das duas, porque acontece sem ninguém
 * ter feito nada de errado.
 */
const recursaoDeliberada = deliberados.pageerror.filter((e) =>
  /Maximum call stack size exceeded/.test(e),
).length;
const recursaoEspontanea = pageErrors.filter((e) =>
  /Maximum call stack size exceeded/.test(e),
).length;
const recursaoTotal = recursaoDeliberada + recursaoEspontanea;
console.log(
  `\nRangeError "Maximum call stack size exceeded" nesta execução: ${recursaoTotal} ` +
    `(esperado: 0) — ${recursaoDeliberada} em submissão provocada, ${recursaoEspontanea} fora dela`,
);
if (recursaoEspontanea > 0) {
  finding(
    "HIGH",
    `REGRESSÃO · a recursão da validação nativa disparou ${recursaoEspontanea} vez(es) FORA de ` +
      "submissão provocada, em operação normal da jornada",
    "apps/web/src/lib/native-validation-ptbr.ts — o tratador de `invalid` chama " +
      "`campo.reportValidity()`, que dispara `invalid` de novo no mesmo campo, sem guarda de " +
      "reentrância (a guarda entrou em 4ba458b). Ocorrências registradas em: " +
      JSON.stringify(
        pageErrors.filter((e) => /Maximum call stack size exceeded/.test(e)).slice(0, 5),
      ),
  );
}

salvarEstado();

// ── Relatório ─────────────────────────────────────────────────────────────
console.log("\n══════════════ RELATÓRIO E2E-2 · SUPRIMENTOS → PRODUTO DIRETO ══════════════");
console.log(`marcos concluídos: ${S.marcos.length} de ${JORNADA.length}`);
for (const m of S.marcos) console.log(`  ✓ ${m}`);
if (parada) console.log(`\nPARADA: ${parada}`);

console.log("\n── Documentos criados pela interface ──");
for (const [k, v] of Object.entries(S.dados)) {
  console.log(` · ${k}: ${JSON.stringify(v)}`);
}

console.log(`\n── Estados vazios encontrados (${S.registro.vazios.length}) ──`);
for (const v of S.registro.vazios) console.log(` ∅ ${v.tela} → "${v.texto}"`);

console.log(`\n── Observações (${S.registro.observacoes.length}) ──`);
for (const o of S.registro.observacoes) console.log(` · ${o}`);

console.log("\n── Ergonomia (lentidão, ausência de retorno, salto de layout) ──");
if (S.registro.ergonomia.length === 0) console.log(" (nada anotado)");
for (const e of S.registro.ergonomia) console.log(` ⏱ ${e}`);

console.log(`\n── Ajuda contextual lida (${S.registro.ajuda.length} painéis) ──`);
for (const a of S.registro.ajuda) {
  console.log(` ⓘ ${a.tela} → "${a.titulo}"`);
  console.log(`    o que é: ${a.oQueE ? "sim" : "NÃO"} · quando uso: ${a.quandoUso ? "sim" : "NÃO"} · o que acontece depois: ${a.oQueAcontece ? "sim" : "NÃO"}`);
  console.log(`    resumo: ${a.resumo}`);
  console.log(`    conceitos=${a.conceitos} fluxos=${JSON.stringify(a.fluxos)} tamanho=${a.tamanho}`);
}

console.log("\n── Console e rede (desta execução) ──");
console.log(` console.error INESPERADOS: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 25)) console.log(`   ✗ ${e}`);
console.log(` pageerror INESPERADOS: ${pageErrors.length}`);
for (const e of pageErrors.slice(0, 10)) console.log(`   ✗ ${e}`);
console.log(` respostas >= 400 INESPERADAS: ${respostasComErro.length}`);
for (const r of respostasComErro.slice(0, 40)) {
  console.log(`   ✗ ${r.method} ${r.pathname} → ${r.status}`);
}
console.log(`\n erros DELIBERADOS (validação provocada de propósito):`);
console.log(`   rede: ${deliberados.rede.length}`);
for (const r of deliberados.rede.slice(0, 25)) {
  console.log(`   ⓘ [${r.janela}] ${r.method} ${r.pathname} → ${r.status}`);
}
console.log(`   console.error: ${deliberados.console.length}`);
console.log(`   pageerror: ${deliberados.pageerror.length} (RangeError de recursão: ${recursaoDeliberada})`);
console.log(` avisos "Failed to load resource": ${avisosDeRede.length}`);
console.log(` diálogos nativos (alert/confirm): ${dialogosNativos.length}`);
for (const d of dialogosNativos) console.log(`   ! ${d}`);

const separadoresComVirgula = S.registro.separadores.filter((s) => s.digitado.includes(","));
console.log(`\n── Decimal com VÍRGULA (${separadoresComVirgula.length} campos) ──`);
for (const s of separadoresComVirgula) {
  console.log(` , ${s.campo} ← "${s.digitado}" (${s.como}) · ${s.onde}`);
}
const semVirgula = S.registro.separadores.filter((s) => !s.digitado.includes(","));
if (semVirgula.length > 0) {
  console.log(` (não contam como prova — valor redondo, sem casa decimal:)`);
  for (const s of semVirgula) console.log(`   · ${s.campo} ← "${s.digitado}" · ${s.onde}`);
}
console.log(
  ` separador aceito por campo (jornada): ` +
    JSON.stringify({ ...(S.dados.separadorPorCampo ?? {}), ...separadorPorCampo }),
);

console.log(`\n── Busca de catálogo observada (${buscasDeItem.length} GET /items) ──`);
for (const b of buscasDeItem.filter((x) => x.search).slice(0, 20)) console.log(`   → ${b.query}`);

console.log(`\n── Findings (${S.registro.findings.length}) ──`);
if (S.registro.findings.length === 0) console.log(" (nenhum)");
for (const f of S.registro.findings) {
  console.log(` [${f.severidade}] ${f.titulo}`);
  console.log(`    repro: ${f.comoReproduzir}`);
}

console.log("\n── Screenshots desta execução ──");
for (const s of screenshots) console.log(` - ${s}`);

console.log(`\nverificações desta execução: ${passes.length} ok, ${failures.length} falharam`);
for (const f of failures) console.log(` ✗ ${f}`);

console.log(
  `\n── Verificações da JORNADA INTEIRA (marcos concluídos em qualquer execução) ──\n` +
    ` ${S.registro.verificacoes.ok.length} ok, ${S.registro.verificacoes.nok.length} reprovadas`,
);
for (const v of S.registro.verificacoes.ok) console.log(`   ok   ${v}`);
for (const v of S.registro.verificacoes.nok) console.log(`   ✗    ${v}`);

const completou = S.marcos.length >= JORNADA.length;
const reprovadasNaJornada = S.registro.verificacoes.nok.length;
const veredito =
  failures.length > 0 || reprovadasNaJornada > 0 || !completou
    ? "FAIL"
    : S.registro.findings.length > 0 ||
        consoleErrors.length > 0 ||
        pageErrors.length > 0 ||
        respostasComErro.length > 0
      ? "PASS WITH FINDINGS"
      : "PASS";
console.log(`\nVEREDITO: ${veredito}`);
if (!completou) {
  console.log(
    ` (jornada incompleta: ${S.marcos.length} de ${JORNADA.length} marcos — o veredito de uma ` +
      "jornada parcial é sempre FAIL, por construção)",
  );
}
process.exitCode = failures.length > 0 || reprovadasNaJornada > 0 ? 1 : 0;
