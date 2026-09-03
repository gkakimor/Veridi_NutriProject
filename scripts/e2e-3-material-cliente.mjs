import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E-3 — MATERIAL FORNECIDO PELO CLIENTE, INTEIRO PELA INTERFACE.
 *
 * A regra é a mesma dos dois cenários anteriores: **todo dado de negócio
 * nasce pela UI**. Fora da tela só existem `POST /auth/login` (uma vez, para
 * o cookie do navegador) e leituras `GET` de conferência. Nada de Prisma,
 * SQL, `POST` de API ou fixture. Etapa que não passa pela interface FALHA —
 * e isso é resultado, não obstáculo a contornar.
 *
 * ## Por que este cenário é o mais difícil do domínio
 *
 * O cliente manda o material; a Veridi industrializa. Isso muda três coisas
 * ao mesmo tempo, e cada uma tem um jeito próprio de dar errado:
 *
 *  - PROPRIEDADE — o lote está fisicamente aqui e não é nosso. Material do
 *    cliente A não pode abastecer o cliente B, nem virar estoque Veridi.
 *  - CUSTO — a Veridi não comprou, então não há custo de aquisição. Não é
 *    custo zero nem custo desconhecido: é EXCLUÍDO da conta.
 *  - REPOSIÇÃO — quando falta, não se compra. Quem repõe é o cliente, e o
 *    sistema não pode oferecer o atalho de compra que oferece para o resto.
 *
 * Por isso o cenário tem DOIS clientes. Um só provaria que o sistema sabe
 * gravar um dono; dois provam que ele sabe SEPARAR.
 *
 * ## A assimetria, medida na mesma tela
 *
 * A prova central da etapa 9 não é a ausência de um botão. É a presença do
 * botão certo ao lado da ausência do errado: o pedido é montado de propósito
 * com DUAS faltas simultâneas — uma de material Veridi (vitamina C) e uma de
 * material do cliente (colágeno). O Plano de Atendimento mostra as duas
 * lado a lado, oferece compra para uma e explicitamente NÃO oferece para a
 * outra. Depois cada falta é resolvida pelo seu caminho: ordem de compra
 * para a Veridi, nova remessa para o cliente.
 *
 * Massa técnica: colágeno em stick, 1000 unidades. Dados independentes do
 * E2E-1 e do E2E-2, prefixados `E2E3`. Identidades sintéticas.
 *
 * Esperado: ZERO `RangeError`.
 *
 *   pnpm exec dotenv -e .env -- node scripts/e2e-3-material-cliente.mjs
 */

const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "handoff/screens/e2e3";
const BAIXADOS = "handoff/e2e3-downloads";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

/**
 * Retomada entre execuções — mesma razão dos cenários anteriores: a jornada
 * cria dados que NÃO são limpos no fim, e uma parada no marco 18 não pode
 * obrigar a refazer os 17 anteriores, o que duplicaria clientes, itens,
 * ordens e templates na base.
 *
 *   --reset  ignora o estado e começa do zero
 *   --ate=N  para depois do marco N
 */
const STATE_FILE = path.resolve("handoff/e2e3-state.json");
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
 * O veredito vale para a JORNADA, não para a última execução: marco
 * concluído não roda de novo, e um relatório que só olhasse a passagem
 * corrente diria "não exercitada" sobre uma prova que passou.
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
  if (!texto) return;
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
const P = "E2E3";

/**
 * DOIS clientes, e é essa a razão de existir do cenário.
 *
 * O cliente A manda material e produz. O cliente B manda material do MESMO
 * item e não produz nada. B existe para uma pergunta só: o lote de A aparece
 * em algum lugar como disponível para B? A resposta precisa ser não em três
 * telas diferentes.
 */
const CLIENTE_A = {
  legalName: `${P} Alfa Nutraceuticos LTDA`,
  tradeName: `${P} Alfa Nutraceuticos`,
  // Dígitos verificadores calculados; empresa inexistente.
  cnpj: "66.777.888/0001-81",
  email: "suprimentos@e2e3alfa.example.com",
  phone: "(11) 4002-8931",
  zip: "04571-010",
  street: "Rua Sintetica do Cenario 3",
  number: "330",
  district: "Brooklin",
  city: "Sao Paulo",
  state: "SP",
};

const CLIENTE_B = {
  legalName: `${P} Beta Suplementos LTDA`,
  tradeName: `${P} Beta Suplementos`,
  cnpj: "77.888.999/0001-81",
  email: "suprimentos@e2e3beta.example.com",
  phone: "(21) 4002-8932",
  zip: "22250-040",
  street: "Rua Sintetica do Cenario 3B",
  number: "44",
  district: "Botafogo",
  city: "Rio de Janeiro",
  state: "RJ",
};

const FORNECEDOR = {
  legalName: `${P} Insumos Industriais LTDA`,
  tradeName: `${P} Insumos Industriais`,
  cnpj: "88.999.000/0001-98",
  email: "vendas@e2e3insumos.example.com",
  phone: "(11) 4002-8933",
};

/**
 * Massa técnica — stick de colágeno, base de 1000 unidades.
 *
 * O colágeno é o material do CLIENTE: é ele que muda propriedade, custo e
 * reposição. Vitamina C e sachê são da Veridi e existem para dar contraste —
 * sem material Veridi na mesma formulação, "o custo do cliente não entra"
 * seria uma frase sobre um custo total zero, que não prova nada.
 */
const COLAGENO = {
  nome: `${P} Colageno hidrolisado bovino`,
  tipo: "RAW_MATERIAL",
  unidade: "kg",
  /** kg por 1000 unidades de produto acabado. */
  porBase: "10",
};
const VITAMINA_C = {
  nome: `${P} Vitamina C revestida 97pct`,
  tipo: "RAW_MATERIAL",
  unidade: "kg",
  // Digitado com VÍRGULA no template de formulação, e conferido depois da
  // ativação da versão.
  porBase: "0.5",
  precoKg: "180.00",
};
const SACHE = {
  nome: `${P} Sache stickpack laminado`,
  tipo: "PACKAGING",
  unidade: "un",
  porBase: "1000",
  precoUn: "0.42",
};
const ITENS = [COLAGENO, VITAMINA_C, SACHE];

const PRODUTO = {
  nome: `${P} Colageno stick 1000 unidades`,
  referenciaExterna: "E2E3-COL-STICK",
  vidaUtil: "24",
  loteMinimo: "1000",
  notas: "Material principal fornecido pelo cliente.",
};

/** Base da matriz técnica e da estrutura de custos — mil unidades. */
const BASE = "1000";
const QUANTIDADE_PEDIDA = 1000;
const QUANTIDADE_PRODUZIDA = 1000;
const LOTE_VERIDI = "E2E3-COL-001";

/**
 * As duas remessas do cliente A, e por que são duas.
 *
 * A primeira entra ANTES do pedido e cobre 6,5 dos 10 kg necessários. A
 * falta de 3,5 kg é o que faz o Plano de Atendimento ter algo a dizer sobre
 * material que não se compra. A segunda remessa resolve — pelo caminho do
 * cliente, não pelo de compras.
 */
const REMESSA_A1 = "6.5"; // digitado com vírgula
const REMESSA_A2 = "5";
const REMESSA_B1 = "3";

/** Compra Veridi, também em duas etapas e pela mesma razão. */
const COMPRA_1 = [
  { item: VITAMINA_C, quantidade: "0.3", preco: VITAMINA_C.precoKg },
  { item: SACHE, quantidade: "1200", preco: SACHE.precoUn },
];
const COMPRA_2 = [{ item: VITAMINA_C, quantidade: "0.5", preco: VITAMINA_C.precoKg }];

/** Recursos industriais do cenário. */
const RECURSOS = [
  { nome: `${P} Envasadora stickpack`, tipo: "EQUIPMENT", potencia: "7", tarifa: "120.00" },
  { nome: `${P} Mao de obra stick`, tipo: "LABOR", potencia: null, tarifa: "41.00" },
  // A tarifa de energia é digitada com vírgula.
  { nome: `${P} Energia eletrica stick`, tipo: "ENERGY", potencia: null, tarifa: "0.85" },
];

/** Faixa da política de precificação — a margem atravessa uma ativação. */
const MARGEM_ALVO = "32.5";

// ── Instrumentação de navegador ───────────────────────────────────────────
const consoleErrors = [];
const pageErrors = [];
const avisosDeRede = [];
const respostasComErro = [];
let janelaDeliberada = null;
const deliberados = { console: [], rede: [], pageerror: [] };

const dialogosNativos = [];
const screenshots = [];

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

const shot = async (nome) => {
  await page.waitForTimeout(250);
  const destino = path.join(OUT, `${nome}.png`);
  await page.screenshot({ path: destino, fullPage: false });
  screenshots.push(path.resolve(destino));
  return destino;
};

// ── Ferramentas de navegação (herdadas do E2E-2) ──────────────────────────
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
  const el = typeof seletor === "string" ? page.locator(seletor).first() : seletor;
  await el.waitFor({ state: "visible", timeout: 15000 });
  await el.fill(String(valor));
  await page.waitForTimeout(80);
}

async function selecionar(seletor, valor) {
  const el = typeof seletor === "string" ? page.locator(seletor).first() : seletor;
  await el.waitFor({ state: "visible", timeout: 15000 });
  await el.selectOption(valor);
  await page.waitForTimeout(120);
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
        ".form-alert, .field__error, .alert--error, [role='alert'], .toast--error, .doc-alert",
      ),
    ]
      .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
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
  page.locator("section.form-section").filter({ has: page.locator("h3", { hasText: titulo }) });

const hoje = () => new Date().toISOString().slice(0, 10);
const daquiAnos = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * A tela nomeia o cliente pelo NOME FANTASIA quando ele existe, e cai para a
 * razão social quando não existe. Exigir a razão social reprovaria a tela por
 * uma escolha de apresentação que é dela — e que é a certa: fantasia é como
 * o operador chama o cliente.
 */
const nomeiaCliente = (texto, ident) =>
  Boolean(texto) && (texto.includes(ident.tradeName) || texto.includes(ident.legalName));

const numeroBr = (t) =>
  t == null
    ? NaN
    : Number(
        String(t)
          .replace(/[^\d,.-]/g, "")
          .replace(/\.(?=\d{3}\b)/g, "")
          .replace(",", "."),
      );

// ── Decimal com vírgula ───────────────────────────────────────────────────
/**
 * Campos decimais em que a vírgula brasileira foi digitada DE PROPÓSITO.
 *
 * A prova pedida não é "o número gravou": é "o número gravou com VÍRGULA".
 * Sem esta lista, um relatório que dissesse "remessa registrada" esconderia
 * uma retentativa com ponto.
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
 * A retentativa com ponto existe só para a jornada não parar num campo — o
 * veredito já terá sido dado antes dela, e a retentativa deixa um finding de
 * REGRESSÃO gravado no estado.
 */
async function decimalComVirgula({ campo, nomeDoCampo, valor, acao, confirmou, ondeNaTela }) {
  const chave = nomeDoCampo ?? (typeof campo === "string" ? campo : ondeNaTela);
  const comVirgula = comoDigitado(valor);
  await preencher(campo, comVirgula);
  await deliberadamente(`decimal-virgula:${chave}`, async () => {
    await acao();
    await page.waitForTimeout(1600);
  });
  if (await confirmou()) {
    separadorPorCampo[chave] = "virgula";
    S.dados.separadorPorCampo = { ...(S.dados.separadorPorCampo ?? {}), [chave]: "virgula" };
    registrarSeparador({ campo: chave, onde: ondeNaTela, digitado: comVirgula, como: "virgula" });
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
    `REGRESSÃO · campo decimal "${chave}" recusou a vírgula brasileira (${ondeNaTela})`,
    `${ondeNaTela} · digitar "${comVirgula}" e executar a ação: nada é gravado e a tela devolve ` +
      `${JSON.stringify(errosComVirgula)}. A vírgula passou a ser aceita em 7cb5fdb ` +
      "(apps/web/src/lib/decimal-input.ts normaliza na tela e apps/api/src/lib/decimal-schema.ts " +
      "aceita no servidor); voltar a recusar é regressão dessa correção.",
  );

  await preencher(campo, String(valor));
  await acao();
  await page.waitForTimeout(1500);
  if (!(await confirmou())) {
    separadorPorCampo[chave] = "falhou";
    return "falhou";
  }
  separadorPorCampo[chave] = "ponto";
  S.dados.separadorPorCampo = { ...(S.dados.separadorPorCampo ?? {}), [chave]: "ponto" };
  return "ponto";
}

// ── Ajuda contextual ──────────────────────────────────────────────────────
/**
 * Abre a ajuda contextual da tela, lê o painel INTEIRO e o guarda.
 *
 * Não basta o modal abrir: o que se mede é se ele responde "o que é esta
 * tela", "quando eu uso" e "o que acontece depois" — e, nas telas de
 * template, se o painel é DELAS e não da vizinha.
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
    oQueE: (painel?.resumo ?? "").length > 60,
    quandoUso:
      (painel?.fluxos ?? []).some((f) => f.quando.length > 0) ||
      /\bquando\b|\bcaso\b|\bse (você|o|a)\b|situação/i.test(t),
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
// A JORNADA
// ══════════════════════════════════════════════════════════════════════════

// ── MARCO 1 · Cliente A e Cliente B ───────────────────────────────────────
/**
 * Dois clientes, pela tela, um de cada vez.
 *
 * B não vai produzir nada. Ele existe para a etapa 3: sem um segundo dono,
 * "o lote pertence a A" é uma frase sobre um campo preenchido, não sobre um
 * isolamento que alguém possa violar.
 */
async function criarCliente(c) {
  await abrir("/cadastros/clientes");
  await clicarLink("+ Novo cliente");
  const foi = await esperarUrl((u) => u.pathname === "/cadastros/clientes/novo", 20000);
  check(
    `CLIENTE · "${c.tradeName}" · a listagem leva à tela canônica de cadastro`,
    foi && (await texto(".page__title")) === "Novo cliente",
    `${caminho()} · título="${await texto(".page__title")}"`,
  );

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

  const voltou = await esperarUrl((u) => u.pathname === "/cadastros/clientes", 25000);
  if (!check(`CLIENTE · "${c.tradeName}" · salvar leva de volta à lista`, voltou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
  }
  await page.waitForTimeout(700);
}

async function marco01Clientes() {
  await abrir("/cadastros/clientes");
  registrarVazio("Cadastros › Clientes", await texto("td.table__empty"));

  const existentes =
    (await apiGet(`/customers?search=${encodeURIComponent(P)}&pageSize=50`)).customers ?? [];
  const porRazao = new Map(existentes.map((c) => [c.legalName, c]));

  for (const c of [CLIENTE_A, CLIENTE_B]) {
    if (porRazao.has(c.legalName)) {
      anotar(`CLIENTE · "${c.legalName}" já existia de execução anterior — criação pulada`);
      continue;
    }
    await criarCliente(c);
  }

  await abrir("/cadastros/clientes");
  await preencher("#customers-search", P);
  await page.waitForTimeout(1400);
  const linhas = await textos("table tbody tr");
  check(
    "CLIENTE · os DOIS clientes E2E3 aparecem na busca, cada um com código CLI próprio",
    linhas.filter((l) => /CLI-\d+/.test(l)).length >= 2 &&
      linhas.some((l) => l.includes(CLIENTE_A.legalName)) &&
      linhas.some((l) => l.includes(CLIENTE_B.legalName)),
    JSON.stringify(linhas.map((l) => l.slice(0, 90))),
  );
  await shot("e2e3-01-clientes");

  const lidos =
    (await apiGet(`/customers?search=${encodeURIComponent(P)}&pageSize=50`)).customers ?? [];
  const a = lidos.find((c) => c.legalName === CLIENTE_A.legalName);
  const b = lidos.find((c) => c.legalName === CLIENTE_B.legalName);
  check(
    "CLIENTE · a leitura técnica confirma dois registros DISTINTOS nascidos pela tela",
    Boolean(a) && Boolean(b) && a.id !== b.id && a.code !== b.code,
    JSON.stringify(lidos.map((c) => `${c.code}/${c.legalName}`)),
  );
  S.dados.clienteA = a ? { id: a.id, code: a.code, legalName: a.legalName } : null;
  S.dados.clienteB = b ? { id: b.id, code: b.code, legalName: b.legalName } : null;
  anotar(
    `CLIENTE · A=${S.dados.clienteA?.code} (${CLIENTE_A.tradeName}) · ` +
      `B=${S.dados.clienteB?.code} (${CLIENTE_B.tradeName})`,
  );
}

// ── MARCO 2 · Itens de estoque ────────────────────────────────────────────
async function marco02Itens() {
  await abrir("/cadastros/itens");
  S.dados.itens = S.dados.itens ?? {};

  const jaExistem = new Set(
    ((await apiGet(`/items?search=${encodeURIComponent(P)}&pageSize=50`)).items ?? []).map(
      (i) => i.name,
    ),
  );

  for (const it of ITENS) {
    if (jaExistem.has(it.nome)) {
      anotar(`ITEM · "${it.nome}" já existia — criação pulada`);
      continue;
    }
    await abrir("/cadastros/itens/novo");
    await selecionar("#item-type", it.tipo);
    await selecionar("#item-unit", it.unidade);
    await preencher("#item-name", it.nome);
    if (it.tipo === "PACKAGING" && (await page.locator("#item-packaging-subtype").count()) > 0) {
      const subtipos = await page.evaluate(() =>
        [...document.querySelectorAll("#item-packaging-subtype option")].map((o) => o.value),
      );
      const escolha = subtipos.find((v) => v === "SACHET") ?? subtipos.filter(Boolean)[0];
      if (escolha) await selecionar("#item-packaging-subtype", escolha);
    }
    /*
     * Controle de lote é REQUISITO do material de cliente: sem lote não há
     * saldo de terceiro identificável, e o recebimento recusa. Confere-se o
     * estado do interruptor em vez de assumir o padrão.
     */
    if (!(await page.locator("#item-controls-lot").isChecked())) {
      await page.locator("#item-controls-lot").check();
    }
    await clicarBotao("Criar item");
    const ok = await esperarUrl((u) => u.pathname === "/cadastros/itens", 25000);
    if (!check(`ITEM · "${it.nome}" foi criado e a tela voltou à lista`, ok, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
  }

  await abrir("/cadastros/itens");
  await preencher("#items-search", P);
  await page.waitForTimeout(1400);
  const codigos = await textos("table tbody tr td.is-code");
  check(
    "ITEM · os três itens E2E3 aparecem na busca, com prefixo por tipo",
    codigos.filter((c) => /^(MP|ME)-\d+/.test(c)).length >= ITENS.length,
    JSON.stringify(codigos),
  );
  await shot("e2e3-02-itens");

  for (const it of (await apiGet(`/items?search=${encodeURIComponent(P)}&pageSize=50`)).items ?? []) {
    S.dados.itens[it.name] = {
      id: it.id,
      code: it.code,
      type: it.type,
      controlsLot: it.controlsLot,
      unitCode: it.unitCode,
    };
  }
  const colageno = S.dados.itens[COLAGENO.nome];
  check(
    "ITEM · o material que virá do cliente controla LOTE — sem isso não há saldo de terceiro identificável",
    colageno?.controlsLot === true,
    JSON.stringify(colageno ?? {}),
  );
  anotar(
    `ITEM · ${Object.values(S.dados.itens)
      .map((i) => `${i.code}/${i.type}`)
      .join(" · ")}`,
  );
}

// ── MARCO 3 · Fornecedor ──────────────────────────────────────────────────
async function marco03Fornecedor() {
  const existentes =
    (await apiGet(`/suppliers?search=${encodeURIComponent(P)}&pageSize=20`)).suppliers ?? [];
  if (existentes.length > 0) {
    S.dados.fornecedor = { id: existentes[0].id, code: existentes[0].code };
    anotar(`FORNECEDOR · ${existentes[0].code} já existia — marco pulado`);
    return;
  }

  await abrir("/cadastros/fornecedores");
  registrarVazio("Cadastros › Fornecedores", await texto("td.table__empty"));
  await clicarLink("+ Novo fornecedor");
  const foi = await esperarUrl((u) => u.pathname === "/cadastros/fornecedores/novo", 20000);
  check("FORNECEDOR · a listagem leva à tela canônica de cadastro", foi, caminho());

  await preencher("#supplier-legal-name", FORNECEDOR.legalName);
  await preencher("#supplier-trade-name", FORNECEDOR.tradeName);
  await preencher("#supplier-cnpj", FORNECEDOR.cnpj);
  await preencher("#supplier-email", FORNECEDOR.email);
  await preencher("#supplier-phone", FORNECEDOR.phone);
  await clicarBotao("Criar fornecedor");
  const voltou = await esperarUrl((u) => u.pathname === "/cadastros/fornecedores", 25000);
  if (!check("FORNECEDOR · salvar leva de volta à lista", voltou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }

  const lidos =
    (await apiGet(`/suppliers?search=${encodeURIComponent(P)}&pageSize=20`)).suppliers ?? [];
  check(
    "FORNECEDOR · o registro nascido pela tela tem código FOR e CNPJ gravado",
    lidos.length === 1 && /^FOR-\d+$/.test(lidos[0].code) && Boolean(lidos[0].cnpj),
    JSON.stringify(lidos.map((x) => `${x.code}/${x.cnpj}`)),
  );
  if (lidos[0]) S.dados.fornecedor = { id: lidos[0].id, code: lidos[0].code };
  await shot("e2e3-03-fornecedor");
}

// ── Compra e recebimento da Veridi (o contraste do material do cliente) ────
/**
 * Uma ordem de compra pela tela, com as linhas dadas.
 *
 * Fica em função porque o cenário compra DUAS vezes: a primeira de propósito
 * insuficiente, para o Plano de Atendimento ter uma falta Veridi ao lado da
 * falta do cliente; a segunda para resolvê-la — pelo caminho de compras, que
 * é justamente o que não existe do outro lado.
 */
async function criarOrdemDeCompra(linhas, rotulo) {
  await abrir("/compras/ordens");
  registrarVazio("Compras › Ordens de Compra", await texto("td.table__empty"));
  await clicarBotao("+ Nova OC");
  const naTela = await esperarUrl((u) => u.pathname === "/compras/ordens/nova", 20000);
  check(`OC ${rotulo} · a listagem leva à tela de nova ordem`, naTela, caminho());
  await page.waitForSelector("#po-supplier", { timeout: 20000 });

  await escolherEntidade("#po-supplier", FORNECEDOR.tradeName, FORNECEDOR.tradeName);
  await preencher("#po-order-date", hoje());

  for (let i = 0; i < linhas.length; i += 1) {
    await clicarBotao("+ Adicionar item");
    await page.waitForTimeout(300);
    const combo = page.locator('input[id^="po-line-item-"]').nth(i);
    await escolherEntidade(combo, linhas[i].item.nome, linhas[i].item.nome);
    const linha = page.locator("table.table tbody tr").nth(i);
    const decimais = linha.locator('input[inputmode="decimal"]');
    await decimais.nth(0).fill(linhas[i].quantidade);
    await decimais.nth(1).fill(linhas[i].preco);
    await page.waitForTimeout(150);
  }

  await clicarBotao("Salvar rascunho");
  const salvou = await esperarUrl(
    (u) => /^\/compras\/ordens\/[0-9a-f-]{36}$/.test(u.pathname),
    30000,
  );
  if (!check(`OC ${rotulo} · o rascunho foi salvo e ganhou URL própria`, salvou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return null;
  }
  await page.waitForTimeout(700);
  const codigo = await texto(".doc-title h1");
  check(
    `OC ${rotulo} · nasce como Rascunho, com código OC gerado`,
    /^OC-\d+$/.test(codigo) && (await texto(".doc-title .badge")) === "Rascunho",
    `código="${codigo}" situação="${await texto(".doc-title .badge")}"`,
  );

  await clicarBotao("Confirmar OC");
  await confirmarDialogo("Confirmar");
  await page.waitForTimeout(1200);
  check(
    `OC ${rotulo} · a ordem passou de Rascunho para Confirmado`,
    (await texto(".doc-title .badge")) === "Confirmado",
    await texto(".doc-title .badge"),
  );
  return { code: codigo, url: caminho() };
}

/** Recebe integralmente uma OC pela tela e devolve o documento gerado. */
async function receberOrdemDeCompra(oc, linhas, rotulo, nfSufixo) {
  await abrir(oc.url, { espera: ".doc-title h1" });
  await clicarBotao("Receber materiais");
  const foi = await esperarUrl((u) => u.pathname === "/compras/recebimentos/novo", 25000);
  if (
    !check(
      `RECEBIMENTO ${rotulo} · “Receber materiais” leva ao recebimento da própria OC`,
      foi,
      caminho(),
    )
  ) {
    return null;
  }
  await page.waitForSelector('input[id^="receive-now-"]', { timeout: 30000 });

  await preencher("#receipt-date", hoje());
  await preencher("#receipt-invoice", `NF-E2E3-${nfSufixo}`);

  const campos = page.locator('input[id^="receive-now-"]');
  const quantas = await campos.count();
  check(
    `RECEBIMENTO ${rotulo} · a tela abre uma linha para cada item em aberto da OC`,
    quantas === linhas.length,
    `linhas=${quantas} esperadas=${linhas.length}`,
  );

  for (let i = 0; i < quantas; i += 1) {
    const id = await campos.nth(i).getAttribute("id");
    const poLineId = id.replace("receive-now-", "");
    const rotuloSecao = await texto(`section.form-section:has(#${id}) h3`).catch(() => "");
    const linha = linhas.find((l) => rotuloSecao.includes(l.item.nome)) ?? linhas[i];
    await campos.nth(i).fill(linha.quantidade);
    const loteFornecedor = page.locator(`#supplier-lot-${poLineId}`);
    if ((await loteFornecedor.count()) > 0) {
      await loteFornecedor.fill(`FOR-E2E3-${nfSufixo}-${String(i + 1).padStart(2, "0")}`);
    }
    const validade = page.locator(`#expiry-${poLineId}`);
    if ((await validade.count()) > 0) await validade.fill(daquiAnos(2));
    const custo = page.locator(`#cost-${poLineId}`);
    if ((await custo.count()) > 0) await custo.fill(linha.preco);
  }

  await clicarBotao("Confirmar recebimento");
  await confirmarDialogo("Confirmar");
  const virou = await esperarUrl(
    (u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname),
    30000,
  );
  if (!check(`RECEBIMENTO ${rotulo} · confirmado, com documento próprio`, virou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return null;
  }
  await page.waitForTimeout(800);
  const origem = await lerDefinicao("Origem");
  check(
    `RECEBIMENTO ${rotulo} · o documento declara a origem “Ordem de Compra”`,
    origem === "Ordem de Compra",
    origem,
  );
  return { code: await texto(".doc-title h1"), url: caminho() };
}

/** Valor de um `<dt>` da lista de definições do documento aberto. */
async function lerDefinicao(rotulo) {
  return page.evaluate((alvo) => {
    const dt = [...document.querySelectorAll("dl.definition-list dt")].find(
      (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim() === alvo,
    );
    return (dt?.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim();
  }, rotulo);
}

/**
 * TODOS os valores cujo rótulo COMEÇA com `rotulo`.
 *
 * Existe porque um `<dt>` pode carregar um ⓘ de ajuda junto do texto — o
 * rótulo deixa de bater por igualdade sem que nada na tela tenha mudado — e
 * porque um documento pode declarar o mesmo campo em duas seções (o lote traz
 * "Proprietário" no cabeçalho e de novo no bloco de material do cliente).
 */
async function lerDefinicoes(rotulo) {
  return page.evaluate((alvo) => {
    return [...document.querySelectorAll("dl.definition-list dt")]
      .filter((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(alvo))
      .map((el) => (el.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim());
  }, rotulo);
}

// ── MARCO 4 · Compra Veridi nº 1, insuficiente de propósito ────────────────
async function marco04CompraVeridi() {
  if (!S.dados.compra1) {
    S.dados.compra1 = await criarOrdemDeCompra(COMPRA_1, "1");
    if (!S.dados.compra1) return;
    salvarEstado();
  } else {
    anotar(`OC · ${S.dados.compra1.code} já existia — criação pulada`);
  }

  if (!S.dados.recebimento1) {
    S.dados.recebimento1 = await receberOrdemDeCompra(S.dados.compra1, COMPRA_1, "1", "0001");
    if (!S.dados.recebimento1) return;
    salvarEstado();
  } else {
    anotar(`RECEBIMENTO · ${S.dados.recebimento1.code} já existia — pulado`);
  }

  anotar(
    `COMPRA · a primeira OC comprou ${COMPRA_1[0].quantidade} kg de vitamina C para uma ` +
      `necessidade de ${VITAMINA_C.porBase} kg — a falta é DE PROPÓSITO, e é ela que dá ao ` +
      "Plano de Atendimento uma falta Veridi para contrastar com a falta do cliente",
  );
  await shot("e2e3-04-compra-veridi");
}

// ── MARCO 5 · Material do cliente A, SEM ordem de compra ───────────────────
/**
 * A entrada que não é compra.
 *
 * Todo o resto do módulo de Compras parte de uma OC: fornecedor, preço,
 * custo de aquisição. Aqui não existe nenhum dos três, e a tela precisa
 * dizer isso em vez de parecer um cadastro pela metade. O que se mede é
 * exatamente o que NÃO está lá — e o dono que está.
 */
async function receberMaterialDoCliente({
  cliente,
  clienteIdent,
  item,
  quantidade,
  comVirgula,
  documento,
  loteFabricante,
  rotulo,
  sufixoShot,
}) {
  await abrir("/compras/recebimentos", { espera: ".page__title" });
  registrarVazio("Compras › Recebimentos", await texto("td.table__empty"));

  /*
   * A entrada é pelo BOTÃO da listagem, não pela URL: a rota não está na
   * navegação lateral, e se o único caminho até ela fosse digitar o endereço
   * a capacidade não existiria para ninguém.
   */
  await clicarBotao("Receber material do cliente");
  const foi = await esperarUrl(
    (u) => u.pathname === "/compras/recebimentos/material-do-cliente",
    20000,
  );
  check(
    `MATERIAL DO CLIENTE ${rotulo} · a lista de Recebimentos oferece a entrada de material de terceiro`,
    foi,
    caminho(),
  );
  await page.waitForSelector("#customer-receipt-customer", { timeout: 20000 });

  const titulo = await texto(".doc-title h1");
  const trilha = await textos("nav.page-crumbs li");
  check(
    `MATERIAL DO CLIENTE ${rotulo} · a tela se anuncia como material enviado pelo cliente, com trilha própria`,
    titulo === "Material enviado pelo cliente" &&
      trilha.join(" › ") === "Recebimentos › Material do cliente",
    `título="${titulo}" trilha=${JSON.stringify(trilha)}`,
  );

  /*
   * A prova de que isto NÃO é compra: fornecedor e ordem de compra não
   * existem como campo nenhum — nem desabilitados, nem opcionais.
   */
  const camposDaTela = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter((el) => el.type !== "hidden")
      .map((el) => el.id || el.getAttribute("aria-label") || ""),
  );
  const rotulosDaTela = (await textos("label")).join(" | ");
  check(
    `MATERIAL DO CLIENTE ${rotulo} · não há campo de fornecedor nem de ordem de compra — não é uma compra`,
    !/fornecedor|ordem de compra/i.test(rotulosDaTela.replace(/lote do fabricante/gi, "")) &&
      !camposDaTela.some((c) => /supplier|purchase-order|po-/i.test(c)),
    `rótulos="${rotulosDaTela}" campos=${JSON.stringify(camposDaTela)}`,
  );
  const subtituloOrigem = await texto("section.form-section:has(#customer-receipt-customer) .form-section__sub, section.form-section:has(#customer-receipt-customer) p");
  anotar(`MATERIAL DO CLIENTE ${rotulo} · a seção Origem explica: "${subtituloOrigem}"`);

  await escolherEntidade("#customer-receipt-customer", clienteIdent.tradeName, clienteIdent.tradeName);
  await preencher("#customer-receipt-date", hoje());
  await preencher("#customer-receipt-document", documento);
  await preencher(
    "#customer-receipt-notes",
    `Remessa do cliente ${clienteIdent.tradeName} para industrializacao pela Veridi.`,
  );

  const linha = page.locator("table.table tbody tr").first();
  await linha
    .locator('select[aria-label="Item recebido"]')
    .selectOption({ label: `${item.code} — ${item.nome}` });
  await page.waitForTimeout(300);
  await linha.locator('input[aria-label="Lote do fabricante"]').fill(loteFabricante);
  await linha.locator('input[aria-label="Validade"]').fill(daquiAnos(2));
  await linha.locator('input[aria-label="Localização"]').fill("DOCA-CLIENTE");

  const campoQuantidade = linha.locator('input[inputmode="decimal"]').first();
  const antesDeConfirmar = ((await apiGet("/lots?pageSize=100")).lots ?? []).length;

  const registrar = async () => {
    await clicarBotao("Confirmar recebimento");
    const tituloDialogo = await confirmarDialogo("Confirmar");
    if (tituloDialogo) {
      anotar(`MATERIAL DO CLIENTE ${rotulo} · diálogo de confirmação: "${tituloDialogo}"`);
      check(
        `MATERIAL DO CLIENTE ${rotulo} · confirmar avisa que o lote fica com o cliente como proprietário`,
        /material do cliente/i.test(tituloDialogo),
        tituloDialogo,
      );
    }
    await esperarUrl((u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname), 25000);
  };

  let separador = "n/a";
  if (comVirgula) {
    /*
     * DECIMAL · a quantidade de material de terceiro é digitada com VÍRGULA.
     *
     * É o pior lugar possível para um separador mal normalizado: "6,5" virado
     * em 65 criaria dez vezes mais estoque de um material que não é nosso, e
     * a conferência física só descobriria na doca.
     */
    separador = await decimalComVirgula({
      campo: campoQuantidade,
      nomeDoCampo: "Recebimento de material do cliente › Quantidade",
      valor: quantidade,
      acao: registrar,
      confirmou: async () =>
        /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(caminho()),
      ondeNaTela: "Compras › Material enviado pelo cliente › Quantidade",
    });
    if (separador === "falhou") {
      check(`MATERIAL DO CLIENTE ${rotulo} · o recebimento foi registrado`, false, caminho());
      return null;
    }
  } else {
    await campoQuantidade.fill(quantidade);
    await page.waitForTimeout(200);
    await registrar();
  }

  if (
    !check(
      `MATERIAL DO CLIENTE ${rotulo} · confirmado, com documento de recebimento próprio`,
      /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(caminho()),
      `${caminho()} · erros=${JSON.stringify(await mensagensDeErro())}`,
    )
  ) {
    return null;
  }
  await page.waitForTimeout(900);

  const codigo = await texto(".doc-title h1");
  const origem = await lerDefinicao("Origem");
  const proprietario = await lerDefinicao("Cliente proprietário");
  const notaFiscal = await lerDefinicao("Nota fiscal");
  check(
    `MATERIAL DO CLIENTE ${rotulo} · o documento nasce com código REC e declara a origem “${
      "Material enviado pelo cliente"
    }”`,
    /^REC-\d+$/.test(codigo) && origem === "Material enviado pelo cliente",
    `código="${codigo}" origem="${origem}"`,
  );
  check(
    `MATERIAL DO CLIENTE ${rotulo} · o documento nomeia o CLIENTE PROPRIETÁRIO no lugar do fornecedor`,
    proprietario.includes(clienteIdent.legalName) || proprietario.includes(cliente.code),
    `proprietário="${proprietario}"`,
  );
  anotar(
    `MATERIAL DO CLIENTE ${rotulo} · ${codigo} · origem "${origem}" · proprietário "${proprietario}" · ` +
      `nota fiscal "${notaFiscal}" (material do cliente costuma chegar sem NF de venda)`,
  );

  /*
   * ETAPA 8, medida já aqui: sem compra, não há custo de aquisição. A tela
   * não deixa o campo vazio nem escreve zero — ela diz que não se aplica.
   */
  const linhaDoc = page.locator("table.table tbody tr").first();
  const celulas = await textos(linhaDoc.locator("td"));
  check(
    `MATERIAL DO CLIENTE ${rotulo} · a linha recebida declara o custo de aquisição como NÃO APLICÁVEL`,
    celulas.some((c) => /Não aplicável/i.test(c)) &&
      celulas.some((c) => /Material do cliente/i.test(c)),
    JSON.stringify(celulas),
  );
  const temEdicaoDeCusto = await linhaDoc
    .getByRole("button", { name: "Informar custo", exact: false })
    .count();
  check(
    `MATERIAL DO CLIENTE ${rotulo} · a ação de informar custo não existe na linha — nem desabilitada`,
    temEdicaoDeCusto === 0,
    `botões de custo encontrados=${temEdicaoDeCusto}`,
  );
  await shot(`e2e3-${sufixoShot}-recebimento-material-cliente`);

  const depois = (await apiGet("/lots?pageSize=100")).lots ?? [];
  check(
    `MATERIAL DO CLIENTE ${rotulo} · o recebimento gerou exatamente UM lote interno novo`,
    depois.length === antesDeConfirmar + 1,
    `antes=${antesDeConfirmar} depois=${depois.length}`,
  );
  const meuLote = depois.find(
    (l) => l.itemCode === item.code && l.ownerCustomerId === cliente.id && !S.dados.lotesVistos?.includes(l.code),
  );
  S.dados.lotesVistos = [...(S.dados.lotesVistos ?? []), ...(meuLote ? [meuLote.code] : [])];
  check(
    `MATERIAL DO CLIENTE ${rotulo} · o lote nasce com PROPRIETÁRIO = cliente, não Veridi`,
    Boolean(meuLote) && meuLote.ownerType === "CUSTOMER" && meuLote.ownerCustomerId === cliente.id,
    JSON.stringify(
      depois
        .filter((l) => l.itemCode === item.code)
        .map((l) => `${l.code}/${l.ownerType}/${l.ownerCustomerName ?? "—"}/${l.quantity ?? ""}`),
    ),
  );
  if (comVirgula && meuLote) {
    /*
     * "Gravou" mede-se no SALDO, não no formulário. `6,5` mal normalizado
     * vira 65 — dez vezes mais material de terceiro do que chegou na doca,
     * e a divergência só apareceria na conferência física.
     */
    const entrou = Number(meuLote.initialReceivedQuantity);
    const saldo = Number(meuLote.onHand);
    check(
      `DECIMAL · "${comoDigitado(quantidade)}" virou ${quantidade} de saldo no lote — não ${String(
        quantidade,
      ).replace(".", "")}`,
      Math.abs(entrou - Number(quantidade)) < 0.001 && Math.abs(saldo - Number(quantidade)) < 0.001,
      `lote=${meuLote.code} entrada=${entrou} saldo=${saldo}`,
    );
  }
  return meuLote ? { code: meuLote.code, id: meuLote.id, receipt: { code: codigo, url: caminho() } } : null;
}

async function marco05MaterialClienteA() {
  if (S.dados.remessaA1) {
    anotar(`MATERIAL DO CLIENTE A · remessa ${S.dados.remessaA1.code} já existia — marco pulado`);
    return;
  }
  const item = S.dados.itens[COLAGENO.nome];
  const resultado = await receberMaterialDoCliente({
    cliente: S.dados.clienteA,
    clienteIdent: CLIENTE_A,
    item: { ...item, nome: COLAGENO.nome },
    quantidade: REMESSA_A1,
    comVirgula: true,
    documento: "REMESSA-E2E3-A-001",
    loteFabricante: "FABR-COL-A-001",
    rotulo: "A#1",
    sufixoShot: "05",
  });
  if (!resultado) return;
  S.dados.remessaA1 = resultado;
  salvarEstado();
  anotar(
    `MATERIAL DO CLIENTE A · ${REMESSA_A1.replace(".", ",")} kg entraram sem ordem de compra e sem ` +
      "fornecedor — o material está fisicamente na Veridi e continua sendo do cliente",
  );
}

// ── MARCO 6 · Material do cliente B, o segundo dono ────────────────────────
async function marco06MaterialClienteB() {
  if (S.dados.remessaB1) {
    anotar(`MATERIAL DO CLIENTE B · remessa ${S.dados.remessaB1.code} já existia — marco pulado`);
    return;
  }
  const item = S.dados.itens[COLAGENO.nome];
  const resultado = await receberMaterialDoCliente({
    cliente: S.dados.clienteB,
    clienteIdent: CLIENTE_B,
    item: { ...item, nome: COLAGENO.nome },
    quantidade: REMESSA_B1,
    comVirgula: false,
    documento: "REMESSA-E2E3-B-001",
    loteFabricante: "FABR-COL-B-001",
    rotulo: "B#1",
    sufixoShot: "06",
  });
  if (!resultado) return;
  S.dados.remessaB1 = resultado;
  salvarEstado();
  anotar(
    `MATERIAL DO CLIENTE B · ${REMESSA_B1} kg do MESMO item (${item.code}) entraram para o cliente B. ` +
      "Mesmo item, mesma prateleira, dono diferente — é isso que torna o isolamento verificável " +
      "em vez de presumido",
  );
}

// ── MARCO 7 · Qualidade libera os lotes ───────────────────────────────────
async function liberarLotesPendentes(rotulo) {
  const lotes = ((await apiGet("/lots?pageSize=100")).lots ?? []).filter((l) =>
    (l.itemName ?? "").startsWith(P),
  );
  const pendentes = lotes.filter((l) => l.status !== "AVAILABLE" && l.origin !== "PRODUCTION");
  for (const lote of pendentes) {
    await abrir(`/estoque/lotes/${lote.id}`, { espera: ".doc-title h1" });
    if (!(await existeBotao("Liberar"))) {
      anotar(`QUALIDADE · ${lote.code} sem ação "Liberar" na tela (situação ${lote.status})`);
      continue;
    }
    await clicarBotao("Liberar");
    const titulo = await confirmarDialogo("Liberar");
    check(
      `QUALIDADE ${rotulo} · liberar ${lote.code} pede confirmação explícita`,
      /Liberar lote/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(900);
    check(
      `QUALIDADE ${rotulo} · ${lote.code} (${lote.itemName}) ficou Disponível`,
      (await texto(".doc-title .badge")) === "Disponível",
      await texto(".doc-title .badge"),
    );
  }
  return pendentes.length;
}

async function marco07Qualidade() {
  await abrir("/qualidade/documentos", { espera: ".page__title" });
  registrarVazio("Qualidade › Documentos / CoA", await texto("td.table__empty"));
  await shot("e2e3-07a-fila-coa");

  const liberados = await liberarLotesPendentes("1");
  anotar(`QUALIDADE · ${liberados} lote(s) liberados pela tela nesta rodada`);

  const depois = ((await apiGet("/lots?pageSize=100")).lots ?? []).filter((l) =>
    (l.itemName ?? "").startsWith(P),
  );
  check(
    "QUALIDADE · todos os lotes E2E3 desta rodada estão Disponíveis",
    depois.length > 0 && depois.every((l) => l.status === "AVAILABLE"),
    JSON.stringify(depois.map((l) => `${l.code}/${l.status}`)),
  );
  /*
   * A liberação da Qualidade não muda o dono. Vale a pena conferir: é o
   * momento em que um lote de terceiro passa a ser "usável", e usável não é
   * sinônimo de nosso.
   */
  const doCliente = depois.filter((l) => l.ownerType === "CUSTOMER");
  check(
    "QUALIDADE · liberar o lote NÃO transfere propriedade — o material do cliente continua do cliente",
    doCliente.length === 2 && doCliente.every((l) => Boolean(l.ownerCustomerId)),
    JSON.stringify(doCliente.map((l) => `${l.code}/${l.status}/${l.ownerCustomerName}`)),
  );
  await shot("e2e3-07-lotes-liberados");
}

// ── MARCO 8 · Isolamento de propriedade ───────────────────────────────────
/**
 * A pergunta desta etapa não é "o dono foi gravado?", e sim "o dono SEPARA?".
 *
 * As duas remessas são do MESMO item, liberadas, disponíveis e na mesma
 * prateleira. Se o isolamento fosse só um rótulo na tela, os dois lotes
 * apareceriam um para o outro em algum lugar. Três telas são perguntadas:
 * a de Materiais de Clientes (com filtro por cliente), a de Lotes (que
 * publica a coluna Proprietário) e o documento do lote.
 */
async function marco08Isolamento() {
  const loteA = S.dados.remessaA1.code;
  const loteB = S.dados.remessaB1.code;

  await abrir("/estoque/materiais-de-clientes", { espera: ".page__title" });
  await page.waitForTimeout(1200);
  const ajuda = await lerAjuda("Estoque › Materiais de Clientes");
  if (ajuda) {
    anotar(`AJUDA · Materiais de Clientes → "${ajuda.titulo}": ${ajuda.resumo.slice(0, 180)}`);
  }

  const todos = await textos("table tbody tr");
  check(
    "ISOLAMENTO · sem filtro, a tela de Materiais de Clientes mostra os dois lotes e nomeia os dois donos",
    todos.some((l) => l.includes(loteA) && l.includes(CLIENTE_A.legalName)) &&
      todos.some((l) => l.includes(loteB) && l.includes(CLIENTE_B.legalName)),
    JSON.stringify(todos.map((l) => l.slice(0, 110))),
  );
  await shot("e2e3-08a-materiais-de-clientes");

  const filtrar = async (cliente, nomeLegal) => {
    await selecionar("#customer-materials-customer", { label: `${cliente.code} — ${nomeLegal}` });
    await page.waitForTimeout(1400);
    return textos("table tbody tr");
  };

  const soDoA = await filtrar(S.dados.clienteA, CLIENTE_A.legalName);
  check(
    `ISOLAMENTO · filtrando por ${S.dados.clienteA.code} (A), o lote ${loteB} do cliente B NÃO aparece`,
    soDoA.some((l) => l.includes(loteA)) && !soDoA.some((l) => l.includes(loteB)),
    JSON.stringify(soDoA.map((l) => l.slice(0, 110))),
  );
  await shot("e2e3-08b-materiais-cliente-a");

  const soDoB = await filtrar(S.dados.clienteB, CLIENTE_B.legalName);
  check(
    `ISOLAMENTO · filtrando por ${S.dados.clienteB.code} (B), o lote ${loteA} do cliente A NÃO aparece como disponível`,
    soDoB.some((l) => l.includes(loteB)) && !soDoB.some((l) => l.includes(loteA)),
    JSON.stringify(soDoB.map((l) => l.slice(0, 110))),
  );
  anotar(
    `ISOLAMENTO · sob o cliente B a tela lista apenas ${JSON.stringify(
      soDoB.map((l) => (l.match(/LT-\d{8}-\d{6}/) ?? [])[0]).filter(Boolean),
    )} — o lote ${loteA}, do mesmo item e disponível, fica de fora`,
  );
  await shot("e2e3-08c-materiais-cliente-b");

  // ── A posição de estoque publica o PROPRIETÁRIO ─────────────────────────
  await abrir("/estoque/lotes", { espera: ".page__title" });
  await preencher("#lots-search", COLAGENO.nome);
  await page.waitForTimeout(1500);
  const cabecalhos = await textos("table thead th");
  const linhasLotes = await textos("table tbody tr");
  check(
    "ISOLAMENTO · a lista de Lotes tem coluna Proprietário — o dono é informação de tela, não de banco",
    cabecalhos.some((h) => /Propriet/i.test(h)),
    JSON.stringify(cabecalhos),
  );
  check(
    "ISOLAMENTO · cada lote do colágeno exibe o cliente dono, e os dois donos são diferentes",
    linhasLotes.some((l) => l.includes(loteA) && l.includes(CLIENTE_A.legalName)) &&
      linhasLotes.some((l) => l.includes(loteB) && l.includes(CLIENTE_B.legalName)),
    JSON.stringify(linhasLotes.map((l) => l.slice(0, 130))),
  );
  anotar(`ISOLAMENTO · Estoque › Lotes: ${JSON.stringify(linhasLotes.map((l) => l.slice(0, 120)))}`);
  await shot("e2e3-08d-lotes-com-proprietario");

  // ── O documento do lote ─────────────────────────────────────────────────
  await abrir(`/estoque/lotes/${S.dados.remessaA1.id}`, { espera: ".doc-title h1" });
  const proprietarios = await lerDefinicoes("Proprietário");
  const proprietario = proprietarios[0] ?? "";
  check(
    "ISOLAMENTO · o documento do lote de A nomeia o proprietário como “Cliente — <razão social>”",
    /^Cliente\b/.test(proprietario) && proprietario.includes(CLIENTE_A.legalName),
    `"${proprietario}" · todos=${JSON.stringify(proprietarios)}`,
  );
  check(
    "ISOLAMENTO · o documento cita o CÓDIGO do cliente junto do nome — dois lotes de razões sociais parecidas não se confundem",
    proprietario.includes(S.dados.clienteA.code),
    `"${proprietario}"`,
  );
  if (proprietarios.length > 1) {
    anotar(
      `ISOLAMENTO · o documento do lote declara o proprietário em ${proprietarios.length} lugares ` +
        `(${JSON.stringify(proprietarios)}) — cabeçalho e bloco de material do cliente`,
    );
  }
  const corpoLote = await texto(".doc-body");
  check(
    "ISOLAMENTO · o lote de A não menciona o cliente B em lugar nenhum do documento",
    !corpoLote.includes(CLIENTE_B.legalName) && !corpoLote.includes(S.dados.clienteB.code),
    corpoLote.slice(0, 200),
  );
  anotar(`ISOLAMENTO · documento do lote ${loteA}: proprietário "${proprietario}"`);
  await shot("e2e3-08-lote-a-proprietario");
}

// ── MARCO 9 · Produto do cliente A ────────────────────────────────────────
async function marco09Produto() {
  if (S.dados.produto) {
    const produto = await apiGet(`/products/${S.dados.produto.id}`);
    check(
      `PRODUTO · ${S.dados.produto.code}, criado pela tela em execução anterior, continua ligado ao cliente A`,
      produto.customerId === S.dados.clienteA.id,
      `produto.customerId=${produto.customerId} A=${S.dados.clienteA.id}`,
    );
    anotar(`PRODUTO · ${S.dados.produto.code} veio de execução anterior — criação pulada`);
    return;
  }

  await abrir("/cadastros/produtos", { espera: ".page__title" });
  await clicarLink("+ Novo produto");
  const naTela = await esperarUrl((u) => u.pathname === "/cadastros/produtos/novo", 20000);
  check(
    "PRODUTO · Cadastros › Produtos › “+ Novo produto” abre a tela canônica",
    naTela && (await texto(".page__title")) === "Novo produto",
    `${caminho()} · "${await texto(".page__title")}"`,
  );

  await preencher("#product-name", PRODUTO.nome);
  await escolherEntidade("#product-customer", CLIENTE_A.tradeName, CLIENTE_A.tradeName);
  await preencher("#product-external-code", PRODUTO.referenciaExterna);

  const opcoes = async (seletor) =>
    page.evaluate(
      (s) => [...document.querySelectorAll(`${s} option`)].map((o) => o.value),
      seletor,
    );
  const escolher = async (seletor, preferida) => {
    const valores = await opcoes(seletor);
    const alvo = valores.includes(preferida) ? preferida : valores.filter(Boolean)[0];
    if (alvo) await selecionar(seletor, alvo);
    return alvo;
  };
  await escolher("#product-dosage-form", "POWDER");
  await escolher("#product-presentation", "SACHET");
  await escolher("#product-target-age", "ADULT");
  await preencher("#product-shelf-life", PRODUTO.vidaUtil);
  await preencher("#product-minimum-batch", PRODUTO.loteMinimo);
  await preencher("#product-notes", PRODUTO.notas);
  await shot("e2e3-09a-produto-preenchido");

  await clicarBotao("Criar produto");
  const salvou = await esperarUrl((u) => u.pathname === "/cadastros/produtos", 30000);
  if (!check("PRODUTO · salvar leva de volta à lista de produtos", salvou, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(1200);

  const produtos =
    (await apiGet(`/products?search=${encodeURIComponent(P)}&pageSize=20`)).products ?? [];
  const produto = produtos.find((x) => x.name === PRODUTO.nome);
  if (
    !check(
      "PRODUTO · o produto existe, com código PROD gerado e item de Produto Acabado próprio",
      Boolean(produto) &&
        /^PROD-\d+$/.test(produto?.code ?? "") &&
        /^PA-\d+$/.test(produto?.finishedProductItem?.code ?? ""),
      JSON.stringify(produtos.map((x) => `${x.code}/${x.name}`)),
    )
  ) {
    return;
  }
  check(
    "PRODUTO · o vínculo é com o CLIENTE A, por id — é ele que definirá qual material do cliente a OP aceita",
    produto.customerId === S.dados.clienteA.id,
    `produto.customerId=${produto.customerId} A=${S.dados.clienteA.id} B=${S.dados.clienteB.id}`,
  );
  S.dados.produto = {
    id: produto.id,
    code: produto.code,
    name: produto.name,
    itemPA: produto.finishedProductItem?.code ?? null,
    itemPAId: produto.finishedProductItem?.id ?? null,
  };
  salvarEstado();
  anotar(
    `PRODUTO · ${produto.code} (${produto.name}) do cliente ${S.dados.clienteA.code}, ` +
      `item PA ${S.dados.produto.itemPA}, lifecycle ${produto.lifecycle}`,
  );
  await shot("e2e3-09-produto");
}

// ── MARCO 10 · Template de Formulação (FT) ────────────────────────────────
/**
 * A matriz técnica, e o campo que carrega o cenário inteiro.
 *
 * "Fornecimento padrão" é o único lugar da biblioteca onde a propriedade do
 * material aparece antes de existir estoque nenhum. É a decisão de projeto —
 * "este componente quem manda é o cliente" — viajando do template para a
 * formulação, e de lá para o custo, para a compra e para a ordem de produção.
 */
const NOME_FT = `${P} Stick de colageno — matriz`;

async function marco10TemplateFormulacao() {
  if (S.dados.ft?.templateId) {
    anotar(`FT · ${S.dados.ft.code} já existia — marco pulado`);
    return;
  }

  await abrir("/producao/templates-formulacao", { espera: ".page__title" });
  registrarVazio("Produção › Templates de Formulação", await texto("td.table__empty"));

  await clicarBotao("Novo template");
  await preencher("#template-name", NOME_FT);
  await clicarBotao("Criar");
  const foi = await esperarUrl(
    (u) => /^\/producao\/templates-formulacao\/[0-9a-f-]{36}$/.test(u.pathname),
    25000,
  );
  if (!check("FT · criar a matriz abre o detalhe do template, com URL própria", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  const templateId = caminho().split("/").pop();
  await page.waitForTimeout(900);

  const codigo = (await texto(".doc-title")).split(" ")[0];
  check("FT · a matriz nasce com código FT gerado", /^FT-\d+/.test(codigo), codigo);
  check(
    "FT · a matriz nasce com um rascunho editável e nenhuma versão ativa",
    (await page.locator("#template-base").count()) > 0 &&
      (await textos("section.form-section h3")).some((h) => /^Rascunho/.test(h)),
    JSON.stringify(await textos("section.form-section h3")),
  );
  await preencher("#template-base", BASE);
  await preencher("#template-unidade", "un");

  const linhasDoTemplate = () =>
    page
      .locator("section.form-section")
      .filter({ has: page.locator("h3", { hasText: "Rascunho" }) })
      .locator("table.table tbody tr");

  const componentes = [
    { item: COLAGENO, quantidade: COLAGENO.porBase, unidade: "kg", fornecimento: "CUSTOMER" },
    { item: VITAMINA_C, quantidade: VITAMINA_C.porBase, unidade: "kg", fornecimento: "VERIDI" },
    { item: SACHE, quantidade: SACHE.porBase, unidade: "un", fornecimento: "VERIDI" },
  ];

  for (let i = 0; i < componentes.length; i += 1) {
    await clicarBotao("+ Adicionar componente");
    await page.waitForTimeout(300);
    const linha = linhasDoTemplate().nth(i);
    await escolherEntidade(
      page.locator('input[id^="template-item-"]').nth(i),
      componentes[i].item.nome,
      componentes[i].item.nome,
    );
    // A quantidade da vitamina C é digitada adiante, com vírgula.
    if (i !== 1) await linha.locator('input[inputmode="decimal"]').first().fill(componentes[i].quantidade);
    await linha.locator("td").nth(2).locator("input").fill(componentes[i].unidade);
    await linha
      .locator('select[aria-label="Fornecimento padrão"]')
      .selectOption(componentes[i].fornecimento);
    await page.waitForTimeout(150);
  }
  await shot("e2e3-10a-ft-componentes");

  const lerTemplate = async () => apiGet(`/formulation-templates/${templateId}`);
  const quantidadeNoRascunho = async (codigoItem) => {
    const t = await lerTemplate();
    const c = (t.draftVersion?.components ?? []).find((x) => x.itemCode === codigoItem);
    return c ? Number(c.quantity) : null;
  };

  /*
   * DECIMAL · a quantidade da vitamina C é digitada com VÍRGULA no rascunho,
   * e o mesmo número é conferido DEPOIS da ativação, adiante neste marco.
   */
  const separador = await decimalComVirgula({
    campo: linhasDoTemplate().nth(1).locator('input[inputmode="decimal"]').first(),
    nomeDoCampo: "Template de formulação › Quantidade do componente",
    valor: VITAMINA_C.porBase,
    acao: async () => {
      await clicarBotao("Salvar rascunho");
    },
    confirmou: async () => {
      const q = await quantidadeNoRascunho(S.dados.itens[VITAMINA_C.nome].code);
      return q !== null && Math.abs(q - Number(VITAMINA_C.porBase)) < 0.0001;
    },
    ondeNaTela: "Produção › Templates de Formulação › Rascunho › Quantidade",
  });
  if (
    !check(
      "FT · o rascunho da matriz foi salvo com os três componentes",
      separador !== "falhou",
      `separador aceito: ${separador} · erros=${JSON.stringify(await mensagensDeErro())}`,
    )
  ) {
    return;
  }

  const rascunho = (await lerTemplate()).draftVersion;
  check(
    "FT · o rascunho guarda o fornecimento padrão POR COMPONENTE — colágeno do cliente, o resto da Veridi",
    (rascunho?.components ?? []).length === 3 &&
      rascunho.components.find((c) => c.itemCode === S.dados.itens[COLAGENO.nome].code)
        ?.supplyResponsibility === "CUSTOMER" &&
      rascunho.components
        .filter((c) => c.itemCode !== S.dados.itens[COLAGENO.nome].code)
        .every((c) => c.supplyResponsibility === "VERIDI"),
    JSON.stringify(
      (rascunho?.components ?? []).map((c) => `${c.itemCode}=${c.supplyResponsibility}`),
    ),
  );

  await clicarBotao("Ativar versão");
  await page.waitForTimeout(2500);
  const depoisDaAtivacao = await lerTemplate();
  check(
    "FT · a matriz foi ATIVADA pela tela e passou a ter versão ativa",
    Boolean(depoisDaAtivacao.activeVersion) && depoisDaAtivacao.activeVersion.status === "ACTIVE",
    `${JSON.stringify(depoisDaAtivacao.activeVersion?.status)} · erros=${JSON.stringify(
      await mensagensDeErro(),
    )}`,
  );

  /*
   * PROVA DE ATIVAÇÃO · ativar copia e congela. Um decimal mal normalizado
   * some ou muda de ordem de grandeza exatamente aqui, e "salvou" não é a
   * mesma afirmação que "continua valendo depois de virar história".
   */
  const ativaVitC = (depoisDaAtivacao.activeVersion?.components ?? []).find(
    (c) => c.itemCode === S.dados.itens[VITAMINA_C.nome].code,
  );
  const sobreviveu =
    ativaVitC != null && Math.abs(Number(ativaVitC.quantity) - Number(VITAMINA_C.porBase)) < 0.0001;
  check(
    `DECIMAL · "${comoDigitado(VITAMINA_C.porBase)}" continua valendo ${VITAMINA_C.porBase} DEPOIS ` +
      "de a versão do template ser ativada",
    sobreviveu,
    JSON.stringify(
      (depoisDaAtivacao.activeVersion?.components ?? []).map((c) => `${c.itemCode}=${c.quantity}`),
    ),
  );
  if (sobreviveu) {
    registrarSeparador({
      campo: "Template de formulação › Quantidade do componente",
      onde: "Produção › Templates de Formulação (sobreviveu à ATIVAÇÃO da versão)",
      digitado: comoDigitado(VITAMINA_C.porBase),
      como: "virgula",
    });
  }
  check(
    "FT · o fornecimento padrão do colágeno atravessou a ativação como CLIENTE",
    (depoisDaAtivacao.activeVersion?.components ?? []).find(
      (c) => c.itemCode === S.dados.itens[COLAGENO.nome].code,
    )?.supplyResponsibility === "CUSTOMER",
    JSON.stringify(
      (depoisDaAtivacao.activeVersion?.components ?? []).map(
        (c) => `${c.itemCode}=${c.supplyResponsibility}`,
      ),
    ),
  );

  const composicaoNaTela = await textos(
    "section.form-section:has(h3:text-matches('Versão ativa')) table tbody tr",
  );
  check(
    "FT · a versão ativa mostra na tela o fornecimento padrão de cada componente, em português",
    composicaoNaTela.some((l) => l.includes(S.dados.itens[COLAGENO.nome].code) && /Cliente/.test(l)),
    JSON.stringify(composicaoNaTela.map((l) => l.slice(0, 100))),
  );
  anotar(`FT · composição da versão ativa: ${JSON.stringify(composicaoNaTela.map((l) => l.slice(0, 90)))}`);

  S.dados.ft = {
    templateId,
    code: codigo,
    url: `/producao/templates-formulacao/${templateId}`,
    activeVersionId: depoisDaAtivacao.activeVersion?.id ?? null,
  };
  salvarEstado();
  await shot("e2e3-10-ft-ativa");
}

// ── MARCO 11 · Formulação do produto, a partir da matriz ──────────────────
async function marco11Formulacao() {
  const produtoId = S.dados.produto.id;
  const jaAtiva = ((await apiGet(`/products/${produtoId}/formulations`)).versions ?? []).find(
    (v) => v.status === "ACTIVE",
  );
  if (jaAtiva) {
    S.dados.formulacao = { versionId: jaAtiva.id, label: jaAtiva.versionLabel };
    anotar(`FORMULAÇÃO · ${jaAtiva.versionLabel} já estava ATIVA — marco pulado`);
    salvarEstado();
    return;
  }

  await abrir(`/producao/formulacoes/${produtoId}`, { espera: ".doc-title h1" });
  registrarVazio("Formulação do produto (nenhuma versão)", await texto("td.table__empty"));
  check(
    "FORMULAÇÃO · a tela do produto oferece “Usar template da biblioteca”",
    await existeBotao("Usar template da biblioteca"),
    JSON.stringify(await textos("button")),
  );

  await clicarBotao("Usar template da biblioteca");
  await page.waitForSelector("#template-busca", { timeout: 20000 });
  await preencher("#template-busca", S.dados.ft.code);
  await page.waitForTimeout(1400);
  const disponiveis = await textos(".full-workspace-modal table tbody tr, table tbody tr");
  check(
    "FORMULAÇÃO · a biblioteca oferece a matriz ATIVA na busca por código",
    disponiveis.some((l) => l.includes(S.dados.ft.code)),
    JSON.stringify(disponiveis.map((l) => l.slice(0, 90))),
  );
  await clicarBotao("Revisar");
  await page.waitForTimeout(1200);

  /*
   * A revisão antes de aplicar existe para uma pergunta só: o que exatamente
   * vai ser copiado para dentro deste produto? A resposta precisa incluir
   * quem fornece cada componente — é a informação que muda o custo.
   */
  const previa = await textos("table tbody tr");
  check(
    "FORMULAÇÃO · a revisão do template mostra o fornecimento padrão antes de aplicar",
    previa.some((l) => l.includes(S.dados.itens[COLAGENO.nome].code) && /Cliente/.test(l)),
    JSON.stringify(previa.map((l) => l.slice(0, 100))),
  );
  await shot("e2e3-11a-revisao-do-template");

  await clicarBotao("Usar este template");
  const foi = await esperarUrl((u) => /\/versoes\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check("FORMULAÇÃO · aplicar o template abre a versão criada, com URL própria", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  S.dados.formulacaoUrl = caminho();
  await page.waitForSelector("#version-basis", { timeout: 25000 });

  const proveniencia = await texto(".template-origin__line");
  check(
    "FORMULAÇÃO · a versão declara de qual matriz nasceu — usar template é COPIAR, e a cópia diz de onde veio",
    proveniencia.includes(S.dados.ft.code),
    `"${proveniencia}"`,
  );
  check(
    "FORMULAÇÃO · a versão nasce Rascunho, com a base copiada da matriz",
    (await texto(".doc-title .badge")) === "Rascunho" &&
      (await page.locator("#version-basis").inputValue()).startsWith(BASE),
    `${await texto(".doc-title .badge")} · base="${await page.locator("#version-basis").inputValue()}"`,
  );

  // ── O componente marcado como fornecido pelo cliente ────────────────────
  const linhasComponente = () =>
    page
      .locator("section.form-section")
      .filter({ has: page.locator("h3", { hasText: "Componentes" }) })
      .locator("table.table tbody tr");
  /*
   * A linha é achada pelo `aria-label` da quantidade, não pelo texto: no
   * rascunho o item mora dentro de um campo de busca, e o código está no
   * VALOR do input — invisível para um filtro por texto.
   */
  const linhaColageno = linhasComponente()
    .filter({
      has: page.locator(
        `input[aria-label="Quantidade de ${S.dados.itens[COLAGENO.nome].code}"]`,
      ),
    })
    .first();
  const seletorFornecimento = linhaColageno.locator(
    'select[aria-label="Responsabilidade de fornecimento"]',
  );
  check(
    "FORMULAÇÃO · o colágeno chegou marcado como fornecido pelo CLIENTE, herdado da matriz",
    (await seletorFornecimento.inputValue()) === "CUSTOMER",
    await seletorFornecimento.inputValue(),
  );
  /*
   * O campo é AJUSTÁVEL no produto — o template é sugestão, não imposição.
   * Vale exercitar a troca de ida e volta: um seletor que só exibe o valor
   * herdado passaria na verificação acima sem nunca ter funcionado.
   */
  await seletorFornecimento.selectOption("VERIDI");
  await page.waitForTimeout(250);
  const virouVeridi = (await seletorFornecimento.inputValue()) === "VERIDI";
  await seletorFornecimento.selectOption("CUSTOMER");
  await page.waitForTimeout(250);
  check(
    "FORMULAÇÃO · o fornecimento é editável no produto sem tocar na biblioteca (troca e volta)",
    virouVeridi && (await seletorFornecimento.inputValue()) === "CUSTOMER",
    `trocou=${virouVeridi} voltou=${await seletorFornecimento.inputValue()}`,
  );
  await shot("e2e3-11b-componente-do-cliente");

  await clicarBotao("Salvar rascunho");
  await page.waitForTimeout(2200);
  check(
    "FORMULAÇÃO · o rascunho foi salvo sem erro",
    (await mensagensDeErro()).length === 0,
    JSON.stringify(await mensagensDeErro()),
  );

  await clicarBotao("Ativar versão");
  await confirmarDialogo("Ativar");
  await page.waitForTimeout(2500);
  check(
    "FORMULAÇÃO · a versão foi ATIVADA pela tela",
    (await texto(".doc-title .badge")) === "Ativa",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const ativa = ((await apiGet(`/products/${produtoId}/formulations`)).versions ?? []).find(
    (v) => v.status === "ACTIVE",
  );
  check(
    "FORMULAÇÃO · a versão ativa tem os três componentes e mantém o colágeno como material do cliente",
    (ativa?.components ?? []).length === 3 &&
      ativa.components.find((c) => c.itemCode === S.dados.itens[COLAGENO.nome].code)
        ?.supplyResponsibility === "CUSTOMER",
    JSON.stringify(
      (ativa?.components ?? []).map(
        (c) => `${c.itemCode} ${c.quantity}${c.unitCode}/${c.supplyResponsibility}`,
      ),
    ),
  );
  S.dados.formulacao = { versionId: ativa?.id ?? null, label: ativa?.versionLabel ?? null };
  salvarEstado();
  anotar(
    `FORMULAÇÃO · ${ativa?.versionLabel} ativa a partir de ${S.dados.ft.code}: ` +
      JSON.stringify(
        (ativa?.components ?? []).map(
          (c) => `${c.itemCode} ${c.quantity}${c.unitCode} (${c.supplyResponsibility})`,
        ),
      ),
  );
  await shot("e2e3-11-formulacao-ativa");
}

// ── MARCO 12 · Recursos industriais ───────────────────────────────────────
async function registrarTarifa(r) {
  registrarVazio(`Recurso ${r.nome} › Histórico de tarifas`, await texto("td.table__empty"));

  /* DECIMAL · campo de dinheiro, vírgula de propósito. */
  const como = await decimalComVirgula({
    campo: "#rate-value",
    nomeDoCampo: "Recurso industrial › Valor da tarifa",
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

async function marco12Recursos() {
  await abrir("/gestao/recursos-industriais", { espera: ".page__title" });
  const existentes = (await apiGet("/industrial-resources?pageSize=200")).resources ?? [];
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
    await abrir("/gestao/recursos-industriais/novo", { espera: ".page__title" });
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

  const depois = (await apiGet("/industrial-resources?pageSize=200")).resources ?? [];
  const meus = depois.filter((r) => r.name.startsWith(P));
  for (const r of meus) S.dados.recursos[r.name] = { id: r.id, code: r.code };
  salvarEstado();
  check(
    `RECURSO · os ${RECURSOS.length} recursos E2E3 existem, todos com tarifa vigente e prefixo RIN`,
    meus.length === RECURSOS.length &&
      meus.every((r) => r.currentRate != null) &&
      meus.every((r) => /^RIN-\d+$/.test(r.code)),
    JSON.stringify(meus.map((r) => `${r.code}/${r.currentRate?.rateValue ?? "SEM TARIFA"}`)),
  );
  await shot("e2e3-12-recursos");
}

// ── MARCO 13 · Template de Estrutura de Custos (TEC) ──────────────────────
const NOME_TEC = `${P} Stick de colageno — estrutura`;

async function marco13TemplateEstrutura() {
  if (S.dados.tec?.templateId) {
    anotar(`TEC · ${S.dados.tec.code} já existia — marco pulado`);
    return;
  }

  await abrir("/gestao/templates-estrutura", { espera: ".page__title" });
  registrarVazio("Gestão › Templates de Estrutura de Custos", await texto("td.table__empty"));

  await clicarBotao("Novo template");
  await preencher("#cost-template-name", NOME_TEC);
  await clicarBotao("Criar");
  const foi = await esperarUrl(
    (u) => /^\/gestao\/templates-estrutura\/[0-9a-f-]{36}$/.test(u.pathname),
    25000,
  );
  if (!check("TEC · criar o template abre o detalhe, com URL própria", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  const templateId = caminho().split("/").pop();
  await page.waitForTimeout(900);
  const codigo = (await texto(".doc-title")).split(" ")[0];
  check("TEC · o template nasce com código TEC gerado", /^TEC-\d+/.test(codigo), codigo);

  await preencher("#tec-base", BASE);
  await preencher("#tec-unidade", "un");

  const rascunhoTec = () =>
    page
      .locator("section.form-section")
      .filter({ has: page.locator("h3", { hasText: "Rascunho" }) });

  const equipamento = S.dados.recursos[RECURSOS[0].nome];
  const maoDeObra = S.dados.recursos[RECURSOS[1].nome];
  const energia = S.dados.recursos[RECURSOS[2].nome];

  const usos = [
    { recurso: equipamento, nome: RECURSOS[0].nome, quantidade: "6.5", comVirgula: true },
    { recurso: maoDeObra, nome: RECURSOS[1].nome, quantidade: "14", comVirgula: false },
  ];
  for (let i = 0; i < usos.length; i += 1) {
    await clicarBotao("+ Adicionar recurso");
    await page.waitForTimeout(300);
    const linha = rascunhoTec().locator("table.table tbody tr").nth(i);
    await linha
      .locator('select[aria-label="Recurso industrial"]')
      .selectOption({ label: `${usos[i].recurso.code} — ${usos[i].nome}` });
    await linha.locator('select[aria-label="Unidade de uso"]').selectOption("HOUR");
    if (!usos[i].comVirgula) {
      await linha.locator('input[inputmode="decimal"]').first().fill(usos[i].quantidade);
    }
    await page.waitForTimeout(150);
  }

  await selecionar("#tec-energia", "FROM_EQUIPMENT");
  await page.waitForTimeout(600);
  await selecionar("#tec-recurso-energia", { label: `${energia.code} — ${RECURSOS[2].nome}` });
  await shot("e2e3-13a-tec-configurado");

  const lerTec = async () => apiGet(`/cost-templates/${templateId}`);
  const usoNoRascunho = async (recursoId) => {
    const t = await lerTec();
    const u = (t.draftVersion?.resourceUsages ?? []).find(
      (x) => x.industrialResourceId === recursoId,
    );
    return u ? Number(u.usageQuantity) : null;
  };

  /*
   * DECIMAL · "6,5" horas de envasadora — campo de QUANTIDADE, não de
   * dinheiro. A correção do separador é do sistema, e este par (consumo aqui,
   * tarifa no recurso) é o que mostra isso.
   */
  const separador = await decimalComVirgula({
    campo: rascunhoTec().locator("table.table tbody tr").nth(0).locator('input[inputmode="decimal"]').first(),
    nomeDoCampo: "Template de estrutura › Uso por lote",
    valor: usos[0].quantidade,
    acao: async () => {
      await clicarBotao("Salvar rascunho");
    },
    confirmou: async () => {
      const q = await usoNoRascunho(equipamento.id);
      return q !== null && Math.abs(q - Number(usos[0].quantidade)) < 0.0001;
    },
    ondeNaTela: "Gestão › Templates de Estrutura › Rascunho › Uso por lote",
  });
  if (
    !check(
      "TEC · o rascunho foi salvo com os dois recursos e a energia derivada dos equipamentos",
      separador !== "falhou",
      `separador aceito: ${separador} · erros=${JSON.stringify(await mensagensDeErro())}`,
    )
  ) {
    return;
  }

  await clicarBotao("Ativar versão");
  await page.waitForTimeout(2500);
  const ativo = await lerTec();
  check(
    "TEC · o template foi ATIVADO pela tela e passou a ter versão ativa",
    Boolean(ativo.activeVersion) && ativo.activeVersion.status === "ACTIVE",
    `${JSON.stringify(ativo.activeVersion?.status)} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  /*
   * A biblioteca guarda CONFIGURAÇÃO, nunca tarifa. É a diferença entre um
   * template que envelhece junto com os preços e um que continua válido: a
   * tarifa é resolvida na data do cálculo, no produto.
   */
  const usosAtivos = ativo.activeVersion?.resourceUsages ?? [];
  check(
    "TEC · a versão ativa guarda o USO dos recursos e nenhuma tarifa congelada — preço se resolve no cálculo",
    usosAtivos.length === 2 &&
      usosAtivos.every((u) => u.rateValueSnapshot == null || u.rateValueSnapshot === undefined),
    JSON.stringify(usosAtivos.map((u) => `${u.resourceName}=${u.usageQuantity}/${u.rateValueSnapshot ?? "sem tarifa"}`)),
  );
  check(
    "TEC · a energia derivada dos equipamentos atravessou a ativação com o recurso de tarifa escolhido",
    ativo.activeVersion?.energyCalculationMode === "FROM_EQUIPMENT" &&
      ativo.activeVersion?.energyResourceId === energia.id,
    `${ativo.activeVersion?.energyCalculationMode} / ${ativo.activeVersion?.energyResourceId}`,
  );
  anotar(
    `TEC · ${codigo} ativo: base ${ativo.activeVersion?.referenceOutputQuantity} ` +
      `${ativo.activeVersion?.referenceOutputUomCode}, ${usosAtivos.length} recurso(s), ` +
      `energia ${ativo.activeVersion?.energyCalculationMode}`,
  );

  S.dados.tec = {
    templateId,
    code: codigo,
    url: `/gestao/templates-estrutura/${templateId}`,
    activeVersionId: ativo.activeVersion?.id ?? null,
  };
  salvarEstado();
  await shot("e2e3-13-tec-ativo");
}

// ── MARCO 14 · Estrutura de custos do produto, a partir do TEC ─────────────
async function marco14EstruturaDeCustos() {
  const produtoId = S.dados.produto.id;
  const antes = (await apiGet(`/products/${produtoId}/industrial-costs`)).current;
  const jaAtiva = antes?.status === "ACTIVE" && antes.complete;
  if (jaAtiva) {
    anotar(`ESTRUTURA · ${antes.label} já ativa e completa — criação pulada, conferências refeitas`);
  }

  await abrir(`/produtos/${produtoId}/custos`, { espera: ".doc-title h1, .page__title" });
  if (!antes) {
    registrarVazio(
      "Produto › Estrutura de custos (nenhuma versão)",
      await texto("section.form-section p.field__hint"),
    );
    check(
      "ESTRUTURA · com formulação ativa, a tela oferece partir de um template em vez de montar do zero",
      await existeBotao("Usar template"),
      JSON.stringify(await textos("button")),
    );
    await clicarBotao("Usar template");
    await page.waitForSelector("#tec-busca", { timeout: 20000 });
    await preencher("#tec-busca", S.dados.tec.code);
    await page.waitForTimeout(1400);
    const listados = await textos("table tbody tr");
    check(
      "ESTRUTURA · a biblioteca oferece o TEC ativo na busca por código",
      listados.some((l) => l.includes(S.dados.tec.code)),
      JSON.stringify(listados.map((l) => l.slice(0, 90))),
    );
    await clicarBotao("Revisar");
    await page.waitForTimeout(1000);
    await shot("e2e3-14a-revisao-tec");
    await clicarBotao("Usar este template");
    await page.waitForTimeout(3500);
  }

  /*
   * `current` é a versão ATIVA; enquanto a estrutura é rascunho ele vale
   * `null`. Ler por ali diria "nenhum material declarado" logo depois de o
   * template ter copiado três — e acusaria a tela de perder o que acabou de
   * receber.
   */
  const respostaCustos = await apiGet(`/products/${produtoId}/industrial-costs`);
  const rascunho = respostaCustos.draft ?? respostaCustos.current ?? {};
  check(
    "ESTRUTURA · aplicar o template criou a estrutura do produto, com a proveniência gravada",
    rascunho.originCostTemplateCode === S.dados.tec.code,
    `origem=${rascunho.originCostTemplateCode} esperado=${S.dados.tec.code}`,
  );
  const provenienciaNaTela = (await texto(".doc-body")).includes(S.dados.tec.code);
  check(
    "ESTRUTURA · a tela do produto diz de qual template a estrutura nasceu",
    provenienciaNaTela,
    (await texto(".doc-body")).slice(0, 220),
  );

  /*
   * A lista de materiais NÃO vem do template — vem da formulação. É por isso
   * que o colágeno aparece aqui já marcado como material do cliente sem
   * ninguém ter dito nada nesta tela.
   */
  const materiaisNaTela = (
    await textos(
      secao("Matérias-primas e embalagens da formulação").locator("table tbody tr"),
    )
  ).filter((l) => /MP-|ME-/.test(l));
  const materiaisDaEstrutura = (rascunho.materials ?? []).map(
    (m) => `${m.itemCode}=${m.customerSupplied ? "CLIENTE" : "VERIDI"}`,
  );
  check(
    "ESTRUTURA · os materiais vêm da FORMULAÇÃO, e o colágeno chega marcado como fornecido pelo cliente",
    (rascunho.materials ?? []).length === 3 &&
      (rascunho.materials ?? []).find((m) => m.itemCode === S.dados.itens[COLAGENO.nome].code)
        ?.customerSupplied === true,
    JSON.stringify(materiaisDaEstrutura),
  );
  check(
    "ESTRUTURA · a TELA distingue material do cliente de material Veridi na coluna Fornecimento",
    materiaisNaTela.some(
      (l) => l.includes(S.dados.itens[COLAGENO.nome].code) && /Fornecido pelo cliente/i.test(l),
    ) &&
      materiaisNaTela.some(
        (l) => l.includes(S.dados.itens[VITAMINA_C.nome].code) && /Veridi/.test(l),
      ),
    JSON.stringify(materiaisNaTela.map((l) => l.slice(0, 110))),
  );
  anotar(`ESTRUTURA · materiais herdados da formulação: ${JSON.stringify(materiaisDaEstrutura)}`);
  anotar(
    `ESTRUTURA · linhas de material na tela: ${JSON.stringify(
      materiaisNaTela.map((l) => l.slice(0, 110)),
    )}`,
  );
  await shot("e2e3-14b-estrutura-materiais");

  const energiaDerivada = await page.evaluate(() => {
    const s = document.querySelector("#secao-energia");
    const dt = [...(s?.querySelectorAll("dt") ?? [])].find((el) =>
      (el.textContent ?? "").includes("derivado"),
    );
    return (dt?.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim();
  });
  check(
    "ESTRUTURA · a energia derivada dos equipamentos, herdada do template, é calculada na tela",
    /kWh/.test(energiaDerivada),
    energiaDerivada,
  );

  if ((await texto(".doc-title .badge")) !== "Ativa") {
    await clicarBotao("Ativar estrutura");
    await page.waitForTimeout(700);
    if ((await page.locator(".confirm-dialog").count()) > 0) {
      const titulo = await confirmarDialogo("Ativar");
      anotar(`ESTRUTURA · ativação pediu confirmação: "${titulo}"`);
    }
    await page.waitForTimeout(2500);
  }
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
  /*
   * O material do cliente não gera pendência de custo. Isso é o oposto de um
   * detalhe: se ele fosse tratado como "custo não informado", a estrutura
   * ficaria eternamente incompleta por um valor que não existe para informar.
   */
  const pendenciasDeCusto = (gravada.pendencies ?? []).filter((p) => p.code === "RATE_NOT_INFORMED");
  check(
    "ESTRUTURA · o material do cliente NÃO vira pendência de tarifa — não há valor a informar, e isso não é lacuna",
    pendenciasDeCusto.length === 0,
    JSON.stringify((gravada.pendencies ?? []).map((p) => `${p.code}/${p.description}`)),
  );
  S.dados.estrutura = { code: gravada.code, label: gravada.label };
  salvarEstado();
  anotar(
    `ESTRUTURA · ${gravada.label} ativa · ${(gravada.resourceUsages ?? []).length} recurso(s) · ` +
      `energia ${gravada.energyCalculationMode} (${gravada.derivedEnergyKwh ?? "—"} kWh/lote)`,
  );
  await shot("e2e3-14-estrutura-ativa");
}

// ── MARCO 15 · Custo SEM aquisição da Veridi ──────────────────────────────
/**
 * A etapa que separa "excluído" de "desconhecido".
 *
 * As duas coisas produzem a mesma tela distraída — um traço no lugar do
 * número — e significam o oposto uma da outra. Custo desconhecido é lacuna:
 * degrada a qualidade do cálculo, gera pendência e pede providência. Material
 * do cliente não é lacuna nenhuma: não existe valor a informar, porque a
 * Veridi não comprou.
 *
 * Por isso a verificação não para em "o colágeno não tem custo". Ela exige
 * as quatro afirmações juntas: subtotal nulo COM origem declarada, soma dos
 * materiais igual à dos itens Veridi sozinhos, qualidade NÃO degradada e
 * nenhum aviso apontando para o colágeno.
 */
async function marco15Calculo() {
  const produtoId = S.dados.produto.id;
  await abrir(`/produtos/${produtoId}/custos`, { espera: ".doc-title h1" });

  await preencher("#cost-reference-date", hoje());
  const t0 = Date.now();
  await clicarBotao("Calcular custo");
  await page.waitForTimeout(2800);
  const gasto = Date.now() - t0;
  if (gasto > 4000) ergo(`cálculo de custo levou ${gasto}ms até renderizar o resultado`);

  const avisoNaTela = (await textos("p.field__hint")).find((t) =>
    /Materiais fornecidos pelo cliente/i.test(t),
  );
  check(
    "CUSTO · a tela declara, em texto, que o material do cliente entra na estrutura física e NÃO no valor",
    Boolean(avisoNaTela) && avisoNaTela.includes(S.dados.itens[COLAGENO.nome].code),
    `"${avisoNaTela ?? "—"}"`,
  );
  anotar(`CUSTO · aviso do cálculo na tela: "${avisoNaTela ?? "—"}"`);

  const custoUnidade = await lerDefinicao("Custo por unidade");
  check(
    "CUSTO · o custo por unidade foi calculado e apareceu na tela",
    Boolean(custoUnidade) && custoUnidade !== "—",
    `custo/unidade="${custoUnidade}"`,
  );
  await shot("e2e3-15a-calculo-resultado");

  await clicarBotao("Salvar cálculo");
  await page.waitForTimeout(800);
  if ((await page.locator(".confirm-dialog").count()) > 0) {
    const rotulo =
      (await page.locator('.confirm-dialog button:has-text("Salvar assim mesmo")').count()) > 0
        ? "Salvar assim mesmo"
        : "Salvar";
    anotar(`CUSTO · diálogo de gravação: "${await confirmarDialogo(rotulo)}"`);
  }
  const foi = await esperarUrl((u) => /^\/calculos-custo\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check("CUSTO · salvar cria um documento CALC próprio e abre ele", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(900);
  const calculoId = caminho().split("/").pop();
  const codigoCalc = await texto(".doc-title .code");
  check("CUSTO · o documento salvo tem código CALC", /^CALC-\d+/.test(codigoCalc), codigoCalc);

  // ── A conta, conferida linha a linha ────────────────────────────────────
  const snapshot = await apiGet(`/industrial-cost-calculations/${calculoId}`);
  const materiais = snapshot.materials ?? [];
  const colageno = materiais.find((m) => m.itemCode === S.dados.itens[COLAGENO.nome].code);
  const veridi = materiais.filter((m) => !m.customerSupplied);

  check(
    "CUSTO · o material do cliente entra no cálculo com subtotal NULO e ORIGEM DECLARADA — excluído, não esquecido",
    colageno != null &&
      colageno.customerSupplied === true &&
      colageno.unitCost === null &&
      colageno.subtotal === null &&
      colageno.costSource === "EXCLUDED_CUSTOMER_SUPPLIED",
    JSON.stringify(
      materiais.map((m) => `${m.itemCode}: ${m.costSource} unit=${m.unitCost} sub=${m.subtotal}`),
    ),
  );
  check(
    "CUSTO · a quantidade física do material do cliente CONTINUA na estrutura — some do valor, não da receita",
    colageno != null && Number(colageno.requiredQuantity) > 0,
    `${colageno?.requiredQuantity} ${colageno?.unitCode}`,
  );

  const somaVeridi = veridi.reduce((s, m) => s + Number(m.subtotal ?? 0), 0);
  const subtotalMateriais = Number(snapshot.materialsSubtotalKnown);
  check(
    "CUSTO · o subtotal de materiais é EXATAMENTE a soma dos itens Veridi — o do cliente não soma nada",
    Math.abs(subtotalMateriais - somaVeridi) < 0.01 && veridi.length === 2,
    `subtotal=${subtotalMateriais} soma Veridi=${somaVeridi.toFixed(2)} ` +
      `(${veridi.map((m) => `${m.itemCode}=${m.subtotal}`).join(", ")})`,
  );

  /*
   * A prova de que não é "custo desconhecido": material sem custo conhecido
   * derruba a qualidade para PARTIAL/NO_COST e produz aviso apontando o item.
   * Com a exclusão correta, nem uma coisa nem outra acontece.
   */
  const avisosDoColageno = (snapshot.warnings ?? []).filter((w) =>
    JSON.stringify(w).includes(S.dados.itens[COLAGENO.nome].code),
  );
  check(
    "CUSTO · a qualidade do cálculo NÃO é degradada pelo material do cliente",
    snapshot.quality === "COMPLETE_REAL_REFERENCE" ||
      snapshot.quality === "COMPLETE_WITH_ESTIMATES",
    `qualidade=${snapshot.quality} · avisos=${JSON.stringify(
      (snapshot.warnings ?? []).map((w) => w.code ?? w),
    )}`,
  );
  check(
    "CUSTO · nenhum aviso do cálculo aponta o colágeno — “sem custo informado” seria a mensagem errada",
    avisosDoColageno.length === 0,
    JSON.stringify(avisosDoColageno),
  );

  const esperadoPelaCompra =
    Number(VITAMINA_C.porBase) * Number(VITAMINA_C.precoKg) +
    Number(SACHE.porBase) * Number(SACHE.precoUn);
  anotar(
    `CUSTO · materiais = ${subtotalMateriais.toFixed(2)} · conferência à mão contra os preços ` +
      `digitados na OC (${VITAMINA_C.porBase}kg × ${VITAMINA_C.precoKg} + ${SACHE.porBase}un × ` +
      `${SACHE.precoUn} = ${esperadoPelaCompra.toFixed(2)}) · colágeno ` +
      `${colageno?.requiredQuantity} ${colageno?.unitCode} entra na receita e sai da conta`,
  );
  check(
    "CUSTO · o subtotal bate com os preços de compra digitados na ordem — a conta é conferível à mão",
    Math.abs(subtotalMateriais - esperadoPelaCompra) < 0.02,
    `tela=${subtotalMateriais} mão=${esperadoPelaCompra.toFixed(2)}`,
  );

  S.dados.calculo = {
    id: calculoId,
    code: codigoCalc,
    url: caminho(),
    custoUnidade,
    materiaisSubtotal: subtotalMateriais,
  };
  salvarEstado();
  await shot("e2e3-15-calculo-salvo");
}

// ── MARCO 16 · Política de Precificação (TPP) ─────────────────────────────
const NOME_TPP = `${P} Industrializacao com material do cliente`;

async function marco16PoliticaDePreco() {
  if (S.dados.tpp?.policyId) {
    anotar(`TPP · ${S.dados.tpp.code} já existia — marco pulado`);
    return;
  }

  await abrir("/gestao/politicas-precificacao", { espera: ".page__title" });
  registrarVazio("Gestão › Políticas de Precificação", await texto("td.table__empty"));

  await clicarBotao("Nova política");
  await preencher("#policy-name", NOME_TPP);
  await clicarBotao("Criar");
  const foi = await esperarUrl(
    (u) => /^\/gestao\/politicas-precificacao\/[0-9a-f-]{36}$/.test(u.pathname),
    25000,
  );
  if (!check("TPP · criar a política abre o detalhe, com URL própria", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  const policyId = caminho().split("/").pop();
  await page.waitForTimeout(900);
  const codigo = (await texto(".doc-title")).split(" ")[0];
  check("TPP · a política nasce com código TPP gerado", /^TPP-\d+/.test(codigo), codigo);

  const rascunhoTpp = () =>
    page
      .locator("section.form-section")
      .filter({ has: page.locator("h3", { hasText: "Rascunho" }) });

  const faixas = [
    { quantidade: String(QUANTIDADE_PEDIDA), margem: MARGEM_ALVO, comissao: "5", comVirgula: true },
    { quantidade: "5000", margem: "28", comissao: "4", comVirgula: false },
  ];
  for (let i = 0; i < faixas.length; i += 1) {
    await clicarBotao("+ Adicionar faixa");
    await page.waitForTimeout(250);
    const linha = rascunhoTpp().locator("table.table tbody tr").nth(i);
    await linha.locator('input[aria-label="Quantidade da faixa"]').fill(faixas[i].quantidade);
    if (!faixas[i].comVirgula) {
      await linha.locator('input[aria-label="Margem alvo"]').fill(faixas[i].margem);
    }
    await linha.locator('input[aria-label="Comissão"]').fill(faixas[i].comissao);
    await page.waitForTimeout(120);
  }
  await shot("e2e3-16a-tpp-faixas");

  const lerPolitica = async () => apiGet(`/pricing-policies/${policyId}`);
  const margemNoRascunho = async () => {
    const p = await lerPolitica();
    const t = (p.draftVersion?.tiers ?? []).find(
      (x) => Number(x.quantity) === Number(faixas[0].quantidade),
    );
    return t ? Number(t.targetContributionMarginPercent) : null;
  };

  /* DECIMAL · a margem alvo é digitada com vírgula e conferida após a ativação. */
  const separador = await decimalComVirgula({
    campo: rascunhoTpp().locator("table.table tbody tr").nth(0).locator('input[aria-label="Margem alvo"]'),
    nomeDoCampo: "Política de precificação › Margem alvo (%)",
    valor: MARGEM_ALVO,
    acao: async () => {
      await clicarBotao("Salvar rascunho");
    },
    confirmou: async () => {
      const m = await margemNoRascunho();
      return m !== null && Math.abs(m - Number(MARGEM_ALVO)) < 0.0001;
    },
    ondeNaTela: "Gestão › Políticas de Precificação › Rascunho › Margem alvo (%)",
  });
  if (
    !check(
      "TPP · o rascunho foi salvo com as duas faixas",
      separador !== "falhou",
      `separador aceito: ${separador} · erros=${JSON.stringify(await mensagensDeErro())}`,
    )
  ) {
    return;
  }

  await clicarBotao("Ativar versão");
  await page.waitForTimeout(2500);
  const ativa = await lerPolitica();
  check(
    "TPP · a política foi ATIVADA pela tela e passou a ter versão ativa",
    Boolean(ativa.activeVersion) && ativa.activeVersion.status === "ACTIVE",
    `${JSON.stringify(ativa.activeVersion?.status)} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  const faixaAtiva = (ativa.activeVersion?.tiers ?? []).find(
    (t) => Number(t.quantity) === Number(faixas[0].quantidade),
  );
  const sobreviveu =
    faixaAtiva != null &&
    Math.abs(Number(faixaAtiva.targetContributionMarginPercent) - Number(MARGEM_ALVO)) < 0.0001;
  check(
    `DECIMAL · "${comoDigitado(MARGEM_ALVO)}" continua valendo ${MARGEM_ALVO} DEPOIS de a política ser ativada`,
    sobreviveu,
    JSON.stringify(
      (ativa.activeVersion?.tiers ?? []).map(
        (t) => `${t.quantity}=${t.targetContributionMarginPercent}%`,
      ),
    ),
  );
  if (sobreviveu) {
    registrarSeparador({
      campo: "Política de precificação › Margem alvo (%)",
      onde: "Gestão › Políticas de Precificação (sobreviveu à ATIVAÇÃO da versão)",
      digitado: comoDigitado(MARGEM_ALVO),
      como: "virgula",
    });
  }
  /*
   * A política guarda REGRA, nunca preço. Vale conferir: se um preço fosse
   * congelado aqui, a biblioteca envelheceria junto com o custo e ninguém
   * saberia quando parou de valer.
   */
  check(
    "TPP · a versão ativa guarda margem e comissão, e NENHUM preço — preço nasce do custo, na aplicação",
    (ativa.activeVersion?.tiers ?? []).every(
      (t) => t.unitPrice === undefined || t.unitPrice === null,
    ),
    JSON.stringify(ativa.activeVersion?.tiers ?? []),
  );

  S.dados.tpp = {
    policyId,
    code: codigo,
    url: `/gestao/politicas-precificacao/${policyId}`,
    activeVersionId: ativa.activeVersion?.id ?? null,
  };
  salvarEstado();
  anotar(
    `TPP · ${codigo} ativa com faixas ${JSON.stringify(
      (ativa.activeVersion?.tiers ?? []).map(
        (t) => `${t.quantity} un → ${t.targetContributionMarginPercent}% margem`,
      ),
    )}`,
  );
  await shot("e2e3-16-tpp-ativa");
}

// ── MARCO 17 · Precificação a partir da política ──────────────────────────
async function marco17Precificacao() {
  if (S.dados.precificacao) {
    anotar(`PRECIFICAÇÃO · ${S.dados.precificacao.label} já existia — marco pulado`);
    return;
  }

  await abrir(`/produtos/${S.dados.produto.id}/custos`, { espera: ".doc-title h1" });
  await page.waitForTimeout(1200);
  const linhaCalc = page.locator("table tbody tr").filter({ hasText: S.dados.calculo.code }).first();
  check(
    "PRECIFICAÇÃO · o cálculo salvo aparece no histórico do produto, com a ação de aplicar política",
    (await linhaCalc.count()) > 0 &&
      (await linhaCalc.getByRole("button", { name: "Usar política", exact: true }).count()) > 0,
    `linha="${await texto(linhaCalc)}"`,
  );
  await linhaCalc.getByRole("button", { name: "Usar política", exact: true }).click();
  await page.waitForSelector("#tpp-busca", { timeout: 20000 });
  await preencher("#tpp-busca", S.dados.tpp.code);
  await page.waitForTimeout(1400);
  const listadas = await textos("table tbody tr");
  check(
    "PRECIFICAÇÃO · a biblioteca oferece a política ATIVA na busca por código",
    listadas.some((l) => l.includes(S.dados.tpp.code)),
    JSON.stringify(listadas.map((l) => l.slice(0, 90))),
  );
  await clicarBotao("Ver prévia");
  await page.waitForTimeout(2000);

  /*
   * A prévia é o momento em que a regra encontra o custo. É aqui que o preço
   * aparece pela primeira vez — e ele nasce sobre um custo que já excluiu o
   * material do cliente.
   */
  const previa = await textos("table tbody tr");
  anotar(`PRECIFICAÇÃO · prévia da política sobre ${S.dados.calculo.code}: ${JSON.stringify(previa.map((l) => l.slice(0, 110)))}`);
  await shot("e2e3-17a-previa-da-politica");

  await clicarBotao("Aplicar e criar precificação");
  const foi = await esperarUrl(
    (u) => /^\/gestao\/precificacao\/[0-9a-f-]{36}$/.test(u.pathname),
    30000,
  );
  if (!check("PRECIFICAÇÃO · aplicar a política cria o documento de precificação e abre ele", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(1500);

  const rotulo = await texto(".doc-title .code");
  const situacao = await texto(".doc-title .badge");
  const corpo = await texto(".doc-body");
  check(
    "PRECIFICAÇÃO · o documento nasce Rascunho e cita o cálculo que lhe serve de base econômica",
    /Rascunho/i.test(situacao) && corpo.includes(S.dados.calculo.code),
    `rótulo="${rotulo}" situação="${situacao}"`,
  );
  const faixasNaTela = await textos("table tbody tr");
  check(
    "PRECIFICAÇÃO · as faixas vieram da política, com preço calculado sobre o custo (a política não guardava preço)",
    faixasNaTela.some((l) => l.includes(String(QUANTIDADE_PEDIDA))) &&
      faixasNaTela.some((l) => /R\$/.test(l)),
    JSON.stringify(faixasNaTela.map((l) => l.slice(0, 110))),
  );
  anotar(`PRECIFICAÇÃO · faixas na tela: ${JSON.stringify(faixasNaTela.map((l) => l.slice(0, 110)))}`);

  if (await existeBotao("Ativar precificação")) {
    await clicarBotao("Ativar precificação");
    await page.waitForTimeout(700);
    if ((await page.locator(".confirm-dialog").count()) > 0) {
      anotar(`PRECIFICAÇÃO · diálogo de ativação: "${await confirmarDialogo("Ativar")}"`);
    }
    await page.waitForTimeout(2500);
  }
  check(
    "PRECIFICAÇÃO · a versão foi ativada pela tela",
    /Ativa/i.test(await texto(".doc-title .badge")),
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  S.dados.precificacao = { url: caminho(), label: rotulo };
  salvarEstado();
  await shot("e2e3-17-precificacao");
}

// ── MARCO 18 · Pedido e Plano de Atendimento ──────────────────────────────
/**
 * A tela onde as duas faltas convivem.
 *
 * O pedido é de 1000 unidades e o estoque foi montado de propósito curto dos
 * DOIS lados: falta vitamina C (Veridi) e falta colágeno (cliente). A prova
 * da etapa 9 não é "não apareceu botão de compra" — isso passaria numa tela
 * que não oferece compra para ninguém. É a ASSIMETRIA: no mesmo Plano, a
 * falta Veridi ganha caminho até Compras e a falta do cliente ganha uma
 * explicação de que não há compra a sugerir.
 */
async function marco18PedidoEPlano() {
  if (!S.dados.pedido?.confirmado) {
    await abrir("/comercial/pedidos", { espera: ".page__title" });
    registrarVazio("Comercial › Pedidos", await texto("td.table__empty"));
    if (await existeBotao("+ Novo pedido")) {
      await clicarBotao("+ Novo pedido");
    }
    if (caminho() !== "/comercial/pedidos/novo") {
      await abrir("/comercial/pedidos/novo", { espera: ".doc-title h1" });
    }
    await page.waitForSelector("#co-customer", { timeout: 20000 });

    await escolherEntidade("#co-customer", CLIENTE_A.tradeName, CLIENTE_A.tradeName);
    await clicarBotao("+ Adicionar produto");
    await page.waitForTimeout(400);
    const comboProduto = page.locator('input[id^="pedido-produto-"]').first();
    await escolherEntidade(comboProduto, PRODUTO.nome, PRODUTO.nome);
    const linhaProduto = page.locator("table.table--order-lines tbody tr").first();
    await linhaProduto
      .locator('input[inputmode="decimal"]')
      .first()
      .fill(String(QUANTIDADE_PEDIDA));
    await page.waitForTimeout(250);

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
    anotar(`PEDIDO · diálogo de confirmação: "${await confirmarDialogo("Confirmar")}"`);
    await page.waitForTimeout(2500);
    check(
      "PEDIDO · confirmado, os produtos e quantidades ficam congelados",
      (await texto(".doc-title .badge")) === "Confirmado",
      `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
    );
    S.dados.pedido.confirmado = true;
    salvarEstado();
  } else {
    anotar(`PEDIDO · ${S.dados.pedido.code} já confirmado — criação pulada`);
    await abrir(S.dados.pedido.url, { espera: ".doc-title h1" });
  }

  if ((await texto(".doc-title .badge")) !== "Confirmado") {
    anotar("PLANO · o pedido já não estava Confirmado — plano aplicado em execução anterior");
  } else {
    // ── O Plano, com as duas faltas na mesma tela ─────────────────────────
    await page.waitForSelector('input[aria-label^="Produzir de"]', { timeout: 40000 });
    await page.getByLabel(`Produzir de ${S.dados.produto.code}`).fill(String(QUANTIDADE_PEDIDA));
    await page.waitForTimeout(2500);

    const impacto = secao("Plano de Atendimento").locator("table").nth(1);
    const linhasImpacto = await textos(impacto.locator("tbody tr"));
    const linhaColageno = linhasImpacto.find((l) =>
      l.includes(S.dados.itens[COLAGENO.nome].code),
    );
    const linhaVitC = linhasImpacto.find((l) => l.includes(S.dados.itens[VITAMINA_C.nome].code));
    check(
      "PLANO · o impacto de materiais identifica o colágeno como MATERIAL DO CLIENTE e nomeia o dono",
      Boolean(linhaColageno) &&
        /Material do cliente/i.test(linhaColageno) &&
        nomeiaCliente(linhaColageno, CLIENTE_A),
      `"${linhaColageno ?? "—"}"`,
    );
    check(
      "PLANO · a coluna “Em Compra” do material do cliente é um traço — não existe compra da Veridi para ele",
      Boolean(linhaColageno) && Boolean(linhaVitC) && /—/.test(linhaColageno),
      `cliente="${linhaColageno}" veridi="${linhaVitC}"`,
    );
    anotar(`PLANO · impacto de materiais: ${JSON.stringify(linhasImpacto.map((l) => l.slice(0, 130)))}`);

    const calloutVeridi = page.locator("div.callout").filter({ hasText: "Veridi com falta" });
    const calloutCliente = page
      .locator("div.callout")
      .filter({ hasText: "Material fornecido pelo cliente com falta" });
    const temVeridi = (await calloutVeridi.count()) > 0;
    const temCliente = (await calloutCliente.count()) > 0;
    check(
      "ETAPA 9 · as DUAS faltas aparecem no mesmo Plano — uma Veridi, uma do cliente",
      temVeridi && temCliente,
      `callouts=${JSON.stringify(await textos("div.callout"))}`,
    );
    if (temVeridi && temCliente) {
      const botoesVeridi = await textos(calloutVeridi.locator("button"));
      const botoesCliente = await textos(calloutCliente.locator("button, a"));
      check(
        "ETAPA 9 · a falta VERIDI oferece caminho até a compra — é assim que o sistema se comporta quando há o que comprar",
        botoesVeridi.some((b) => /sugest(ã|a)o de compra/i.test(b)),
        JSON.stringify(botoesVeridi),
      );
      check(
        "ETAPA 9 · a falta do CLIENTE não oferece ação nenhuma de compra — nem botão, nem link",
        botoesCliente.length === 0,
        JSON.stringify(botoesCliente),
      );
      const textoCliente = await texto(calloutCliente);
      check(
        "ETAPA 9 · e a tela EXPLICA por quê: depende de nova remessa do cliente, não de compra da Veridi",
        /não há compra da veridi a sugerir/i.test(textoCliente) &&
          /remessa do cliente/i.test(textoCliente),
        `"${textoCliente}"`,
      );
      anotar(`ETAPA 9 · falta Veridi: "${await texto(calloutVeridi)}"`);
      anotar(`ETAPA 9 · falta do cliente: "${textoCliente}"`);
    }
    await shot("e2e3-18a-plano-duas-faltas");

    await clicarBotao("Aplicar Plano de Atendimento");
    const titulo = await confirmarDialogo("Aplicar Plano");
    check(
      "PLANO · aplicar pede confirmação explícita",
      /Aplicar Plano de Atendimento/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(4000);
  }

  check(
    "PLANO · aplicado, o pedido passou a Em atendimento",
    (await texto(".doc-title .badge")) === "Em atendimento",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const ops = ((await apiGet("/production-orders?pageSize=100")).productionOrders ?? []).filter(
    (o) => o.productCode === S.dados.produto.code,
  );
  check(
    "PLANO · o plano criou uma Ordem de Produção para o déficit",
    ops.length === 1,
    JSON.stringify(ops.map((o) => `${o.code}/${o.status}/${o.plannedQuantity}`)),
  );
  if (!ops[0]) return;
  S.dados.op = { id: ops[0].id, code: ops[0].code, url: `/producao/ordens/${ops[0].id}` };
  salvarEstado();
  await shot("e2e3-18-plano-aplicado");
}

// ── MARCO 19 · A OP com falta, e os dois caminhos de reposição ────────────
/**
 * A mesma assimetria, agora dentro da Ordem de Produção.
 *
 * A OP planejada é o segundo lugar onde a falta aparece, e o mais perigoso:
 * é a tela de quem vai produzir. Um atalho de compra na linha do material do
 * cliente mandaria o operador abrir uma OC de algo que a Veridi não compra.
 */
async function marco19FaltaEReposicao() {
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

  const necessidade = secao("Necessidade de Materiais");
  const linhaColageno = necessidade
    .locator("tbody tr")
    .filter({ hasText: S.dados.itens[COLAGENO.nome].code })
    .first();
  const linhaVitC = necessidade
    .locator("tbody tr")
    .filter({ hasText: S.dados.itens[VITAMINA_C.nome].code })
    .first();

  const textoColageno = await texto(linhaColageno);
  check(
    "ETAPA 10 · a linha do colágeno declara o fornecimento como CLIENTE e nomeia o cliente elegível",
    /Cliente/.test(textoColageno) && nomeiaCliente(textoColageno, CLIENTE_A),
    `"${textoColageno.slice(0, 200)}"`,
  );
  check(
    "ETAPA 9 · na OP, a linha do material do cliente diz “Aguardando material do cliente” e não oferece compra",
    /Aguardando material do cliente/i.test(textoColageno) &&
      (await linhaColageno.getByRole("button").count()) === 0,
    `"${textoColageno.slice(0, 200)}" · botões=${await linhaColageno.getByRole("button").count()}`,
  );
  const botoesVitC = await textos(linhaVitC.locator("button"));
  check(
    "ETAPA 9 · na MESMA tabela, a linha do material Veridi em falta oferece o caminho até a compra",
    botoesVitC.some((b) => /compra/i.test(b)),
    `"${(await texto(linhaVitC)).slice(0, 200)}" · botões=${JSON.stringify(botoesVitC)}`,
  );
  anotar(`ETAPA 9 · linha do cliente na OP: "${textoColageno.slice(0, 200)}"`);
  anotar(`ETAPA 9 · linha Veridi na OP: "${(await texto(linhaVitC)).slice(0, 200)}"`);

  const liberar = page.getByRole("button", { name: "Liberar OP", exact: true });
  if ((await liberar.count()) > 0) {
    const travado = await liberar.isDisabled();
    const dica = (await textos("div.line-actions p.field__hint, div.line-actions p.form-alert")).join(" | ");
    check(
      "OP · com material faltando dos dois lados, “Liberar OP” está DESABILITADO e a tela diz por quê",
      travado,
      `desabilitado=${travado} · dica="${dica}"`,
    );
    anotar(`OP · impedimento de liberação: "${dica}"`);
  }
  await shot("e2e3-19a-op-com-falta");

  // ── Caminho 1 · o que é da Veridi se resolve COMPRANDO ──────────────────
  if (!S.dados.compra2) {
    S.dados.compra2 = await criarOrdemDeCompra(COMPRA_2, "2");
    if (!S.dados.compra2) return;
    salvarEstado();
  }
  if (!S.dados.recebimento2) {
    S.dados.recebimento2 = await receberOrdemDeCompra(S.dados.compra2, COMPRA_2, "2", "0002");
    if (!S.dados.recebimento2) return;
    salvarEstado();
  }

  // ── Caminho 2 · o que é do cliente se resolve com nova REMESSA ──────────
  if (!S.dados.remessaA2) {
    const resultado = await receberMaterialDoCliente({
      cliente: S.dados.clienteA,
      clienteIdent: CLIENTE_A,
      item: { ...S.dados.itens[COLAGENO.nome], nome: COLAGENO.nome },
      quantidade: REMESSA_A2,
      comVirgula: false,
      documento: "REMESSA-E2E3-A-002",
      loteFabricante: "FABR-COL-A-002",
      rotulo: "A#2",
      sufixoShot: "19b",
    });
    if (!resultado) return;
    S.dados.remessaA2 = resultado;
    salvarEstado();
  }

  await liberarLotesPendentes("2");
  anotar(
    "REPOSIÇÃO · as duas faltas foram resolvidas por caminhos DIFERENTES: a vitamina C por uma " +
      `segunda ordem de compra (${S.dados.compra2.code} → ${S.dados.recebimento2.code}) e o ` +
      `colágeno por uma segunda remessa do cliente (${S.dados.remessaA2.receipt.code}) — ` +
      "nenhuma ordem de compra foi aberta para material que a Veridi não compra",
  );

  const ordensDeCompra = ((await apiGet("/purchase-orders?pageSize=100")).purchaseOrders ?? [])
    .filter((o) => (o.supplierName ?? "").startsWith(P));
  const linhasDeCompra = [];
  for (const oc of ordensDeCompra) {
    const detalhe = (oc.lines ?? []).length > 0 ? oc : await apiGet(`/purchase-orders/${oc.id}`);
    for (const l of detalhe.lines ?? []) linhasDeCompra.push(l.itemCode);
  }
  check(
    "ETAPA 9 · a jornada inteira NUNCA gerou uma linha de compra do material do cliente",
    !linhasDeCompra.includes(S.dados.itens[COLAGENO.nome].code),
    `itens comprados=${JSON.stringify(linhasDeCompra)} · colágeno=${
      S.dados.itens[COLAGENO.nome].code
    }`,
  );
  await shot("e2e3-19-reposicao");
}

// ── MARCO 20 · Produção ciente do proprietário ────────────────────────────
/**
 * A OP do cliente A só enxerga material do cliente A.
 *
 * Duas provas, e a segunda é a que importa. A primeira é passiva: a reserva
 * escolheu lotes de A. A segunda é ativa — o operador INFORMA o lote do
 * cliente B no Picking e o sistema recusa. Sem a segunda, "o sistema separa"
 * seria uma afirmação sobre uma sugestão automática que ninguém tentou
 * contrariar.
 */
async function marco20Producao() {
  if (S.dados.lotePa) {
    const op = await apiGet(`/production-orders/${S.dados.op.id}`);
    check(
      `PRODUÇÃO · ${S.dados.op.code}, executada pela tela em execução anterior, está Concluída`,
      op.status === "COMPLETED",
      String(op.status),
    );
    anotar(`PRODUÇÃO · ${S.dados.op.code} e o lote ${S.dados.lotePa.code} vieram de execução anterior`);
    await abrir(S.dados.op.url, { espera: ".doc-title h1" });
    await shot("e2e3-20-op-concluida");
    return;
  }

  await abrir(S.dados.op.url, { espera: ".doc-title h1" });
  if ((await texto(".doc-title .badge")) === "Planejada") {
    const liberar = page.getByRole("button", { name: "Liberar OP", exact: true });
    if (await liberar.isDisabled()) {
      const dica = (await textos("div.line-actions p.field__hint, div.line-actions p.form-alert")).join(" | ");
      check("OP · reposto o material, “Liberar OP” ficou habilitado", false, dica);
      return;
    }
    await clicarBotao("Liberar OP");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(3500);
  }
  check(
    "OP · com as duas faltas resolvidas, a ordem foi liberada",
    (await texto(".doc-title .badge")) === "Liberada",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  // ── Prova passiva: a reserva só olhou para lotes do cliente A ───────────
  const opLiberada = await apiGet(`/production-orders/${S.dados.op.id}`);
  const reqColageno = (opLiberada.requirements ?? []).find(
    (r) => r.itemCode === S.dados.itens[COLAGENO.nome].code,
  );
  const lotesSugeridos = (reqColageno?.suggestedAllocations ?? []).map((a) => a.lotCode);
  const lotesDeA = [S.dados.remessaA1.code, S.dados.remessaA2.code];
  check(
    "ETAPA 10 · o requisito do material do cliente declara o dono elegível — o cliente DESTA OP",
    reqColageno?.eligibleOwnerType === "CUSTOMER" &&
      reqColageno?.eligibleOwnerCustomerId === S.dados.clienteA.id,
    `${reqColageno?.eligibleOwnerType}/${reqColageno?.eligibleOwnerCustomerName}`,
  );
  check(
    `ETAPA 10 · a alocação só propôs lotes do cliente A — ${S.dados.remessaB1.code}, do cliente B, ficou de fora`,
    lotesSugeridos.length > 0 &&
      lotesSugeridos.every((c) => lotesDeA.includes(c)) &&
      !lotesSugeridos.includes(S.dados.remessaB1.code),
    `sugeridos=${JSON.stringify(lotesSugeridos)} · de A=${JSON.stringify(lotesDeA)} · de B=${
      S.dados.remessaB1.code
    }`,
  );
  anotar(
    `ETAPA 10 · lotes reservados para o colágeno: ${JSON.stringify(lotesSugeridos)} — o lote ` +
      `${S.dados.remessaB1.code} do cliente B tem saldo disponível e não foi considerado`,
  );
  await shot("e2e3-20a-op-liberada");

  // ── Prova ativa: informar o lote do cliente B e ser recusado ────────────
  const picking = secao("Picking");
  const linhaDoColageno = picking
    .locator("tbody tr")
    .filter({ hasText: S.dados.itens[COLAGENO.nome].code })
    .filter({ hasText: "Pendente" })
    .first();
  if ((await linhaDoColageno.count()) > 0) {
    await deliberadamente("lote-de-outro-cliente", async () => {
      await linhaDoColageno
        .getByRole("button", { name: "Escanear / Informar lote", exact: true })
        .click();
      await page.waitForSelector("#lot-scanner-manual", { timeout: 20000 });
      await preencher("#lot-scanner-manual", S.dados.remessaB1.code);
      await page.locator("#lot-scanner-manual").press("Enter");
      await page.waitForTimeout(2600);
    });

    const abriuDialogo = (await page.locator("#mismatch-title").count()) > 0;
    check(
      `ETAPA 10 · informar o lote ${S.dados.remessaB1.code} (do cliente B) é reconhecido como divergência`,
      abriuDialogo,
      `diálogo de divergência aberto=${abriuDialogo}`,
    );
    await shot("e2e3-20b-lote-de-outro-cliente");

    if (abriuDialogo) {
      /*
       * O diálogo oferece "usar o lote diferente" porque, no caso comum, a
       * divergência é só FEFO contrariado — mesmo dono, outro lote. Aqui não
       * é: o lote é de OUTRO DONO, e a insistência é justamente o gesto que
       * precisa ser recusado. Um sistema que só sugerisse bem, mas aceitasse
       * a substituição manual, misturaria material de dois clientes no
       * primeiro dia de operação real.
       */
      await deliberadamente("substituir-por-lote-de-outro-cliente", async () => {
        await page.getByRole("button", { name: "Usar lote diferente", exact: true }).click();
        await page.waitForTimeout(3000);
      });

      const recusa = (await mensagensDeErro()).join(" | ");
      check(
        "ETAPA 10 · insistir no lote do cliente B é RECUSADO: material do cliente A nunca é substituído por material de outro dono",
        /pertence a outro propriet/i.test(recusa) && recusa.includes(S.dados.remessaB1.code),
        `mensagem="${recusa}"`,
      );
      check(
        "ETAPA 10 · a recusa diz de quem a necessidade aceita material, em vez de só negar",
        /cliente desta OP/i.test(recusa),
        `mensagem="${recusa}"`,
      );
      anotar(`ETAPA 10 · recusa do servidor exibida na tela: "${recusa}"`);
      const recusaHttp = deliberados.rede.filter(
        (r) => r.janela === "substituir-por-lote-de-outro-cliente",
      );
      anotar(
        `ETAPA 10 · a recusa é do SERVIDOR, não da tela: ${JSON.stringify(
          recusaHttp.map((r) => `${r.method} ${r.pathname} → ${r.status}`),
        )}`,
      );
      await shot("e2e3-20c-recusa-de-outro-proprietario");

      const aindaDeB =
        ((await apiGet("/lots?pageSize=100")).lots ?? []).find(
          (l) => l.code === S.dados.remessaB1.code,
        ) ?? {};
      check(
        `ETAPA 10 · o lote ${S.dados.remessaB1.code} continua intocado: nada foi reservado para a OP de A`,
        Number(aindaDeB.reserved ?? 0) === 0 &&
          Math.abs(Number(aindaDeB.onHand ?? 0) - Number(REMESSA_B1)) < 0.001,
        `reservado=${aindaDeB.reserved} saldo=${aindaDeB.onHand}`,
      );
      if ((await page.locator("#mismatch-title").count()) > 0) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
      }
    }
  } else {
    check(
      "ETAPA 10 · há linha de Picking pendente do material do cliente para a prova ativa",
      false,
      "nenhuma linha de Picking pendente do colágeno encontrada",
    );
  }

  // ── Picking correto, com os lotes que a OP de fato aceita ───────────────
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });
  const pickingOk = secao("Picking");
  for (let passo = 0; passo < 20; passo += 1) {
    const pendentes = pickingOk.locator("tbody tr").filter({ hasText: "Pendente" });
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
  const conferidas = (await textos(pickingOk.locator("tbody tr"))).filter((t) =>
    /LT-|Pendente|Conferido/.test(t),
  );
  check(
    "PICKING · todas as linhas de reserva foram conferidas por lote",
    conferidas.length > 0 && conferidas.every((l) => l.includes("Conferido")),
    JSON.stringify(conferidas.map((l) => l.slice(0, 90))),
  );
  anotar(
    `PICKING · linhas conferidas: ${JSON.stringify(conferidas.map((l) => l.slice(0, 100)))}`,
  );
  await shot("e2e3-20d-picking");
  salvarEstado();
}

// ── MARCO 21 · Consumo reconciliado ───────────────────────────────────────
/**
 * A OP não conclui com material por reconciliar — e a prova é o BLOQUEIO.
 *
 * Uma jornada que consumisse tudo passaria por cima da regra e o relatório
 * afirmaria uma proteção nunca exercida. Aqui o material do CLIENTE fica de
 * propósito sem consumo: é o pior caso, porque a sobra não é nossa e some da
 * prestação de contas se ninguém a cobrar.
 */
const codigoDaLinha = async (linha) => {
  const primeira = ((await linha.locator("td").first().textContent()) ?? "").replace(/\s+/g, " ");
  return (primeira.match(/\b[A-Z]{2,3}-\d+/) ?? [""])[0];
};

async function marco21Reconciliacao() {
  if (S.dados.lotePa) {
    anotar(`RECONCILIAÇÃO · ${S.dados.op.code} já concluída em execução anterior — marco pulado`);
    return;
  }
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });

  const pendenteDeProposito = S.dados.itens[COLAGENO.nome].code;
  S.dados.materialPendente = pendenteDeProposito;
  anotar(
    `RECONCILIAÇÃO · ${pendenteDeProposito} (material do cliente) fica SEM consumo de propósito, ` +
      "para o bloqueio da conclusão ser medido em vez de suposto",
  );

  const consumo = secao("Consumo Real");
  const cabecalhos = await textos(consumo.locator("thead th"));
  const colRestante = cabecalhos.findIndex((h) => h.startsWith("Restante"));
  anotar(`CONSUMO · colunas da tabela: ${JSON.stringify(cabecalhos)}`);

  const linhasIniciais = await consumo.locator("tbody tr").count();
  let confirmadas = 0;
  let deixadas = 0;
  for (let passo = 0; passo < 20; passo += 1) {
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
      const celulas = await textos(linha.locator("td"));
      const restante = numeroBr(colRestante >= 0 ? celulas[colRestante] : "");
      if (!Number.isFinite(restante) || restante <= 0) continue;
      await campo.first().fill(String(restante));
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
    "CONSUMO · os materiais da Veridi tiveram consumo apontado; o do cliente ficou de fora, de propósito",
    confirmadas > 0 && deixadas > 0 && confirmadas < linhasIniciais,
    `confirmadas=${confirmadas} de ${linhasIniciais} linhas · deixadas=${deixadas} (${pendenteDeProposito})`,
  );
  await shot("e2e3-21a-consumo-parcial-da-veridi");

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

  // ── O BLOQUEIO ──────────────────────────────────────────────────────────
  const botaoConcluir = page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true });
  await botaoConcluir.waitFor({ state: "visible", timeout: 20000 });
  check(
    `ETAPA 11 · com ${pendenteDeProposito} sem consumo, o botão “Concluir OP” está DESABILITADO`,
    await botaoConcluir.isDisabled(),
    `desabilitado=${await botaoConcluir.isDisabled()}`,
  );
  const aviso = (await textos(".line-actions p.form-alert")).join(" | ");
  check(
    "ETAPA 11 · a tela NOMEIA o material que falta reconciliar, em vez de só desabilitar o botão",
    /falta reconciliar/i.test(aviso) && aviso.includes(pendenteDeProposito),
    `aviso="${aviso}"`,
  );
  anotar(`ETAPA 11 · impedimento exibido na tela: "${aviso}"`);
  const situacaoNaTabela = await texto(
    secao("Necessidade de Materiais").locator("tbody tr").filter({ hasText: pendenteDeProposito }).first(),
  );
  check(
    "ETAPA 11 · a linha do material pendente mostra a situação da reconciliação",
    /sem consumo|consumo parcial/i.test(situacaoNaTabela),
    situacaoNaTabela.slice(0, 200),
  );
  await shot("e2e3-21b-concluir-bloqueado");

  /*
   * O botão desabilitado não é contornável pelo navegador, e isso é
   * resultado, não lacuna: o React decide o `onClick` pelas PROPS, então
   * soltar o atributo `disabled` do DOM e clicar não dispara handler nenhum —
   * nada sai do navegador, e não há requisição para o servidor recusar. A
   * recusa equivalente do servidor (`unreconciled_materials`) é coberta por
   * apps/api/src/modules/production-orders/material-reconciliation.test.ts,
   * fora do alcance desta jornada, que não faz POST de API.
   */

  // ── Consumo PARCIAL do material do cliente ──────────────────────────────
  /*
   * Consumir o restante inteiro fecharia a pendência sem nunca exercitar a
   * justificativa — que é a outra metade da regra. O parcial mantém a linha
   * na rastreabilidade e ainda deixa a diferença a explicar; e a diferença
   * de material de terceiro é exatamente o que precisa ficar registrado.
   */
  const consumo21 = secao("Consumo Real");
  const cabecalhos21 = await textos(consumo21.locator("thead th"));
  const colRestante21 = cabecalhos21.findIndex((h) => h.startsWith("Restante"));
  let consumidoNoParcial = 0;
  const linhasDoCliente = consumo21.locator("tbody tr").filter({ hasText: pendenteDeProposito });
  const quantasDoCliente = await linhasDoCliente.count();
  for (let i = 0; i < quantasDoCliente; i += 1) {
    const linha = consumo21.locator("tbody tr").filter({ hasText: pendenteDeProposito }).nth(i);
    const campo = linha.locator('input[inputmode="decimal"]').first();
    if ((await campo.count()) === 0 || (await campo.isDisabled())) continue;
    const celulas = await textos(linha.locator("td"));
    const restante = numeroBr(colRestante21 >= 0 ? celulas[colRestante21] : "");
    if (!Number.isFinite(restante) || restante <= 0) continue;
    // A ÚLTIMA linha é consumida pela metade: é o que deixa a diferença.
    const alvo =
      i === quantasDoCliente - 1 ? Number((restante / 2).toFixed(3)) : restante;
    await campo.fill(comoDigitado(String(alvo)));
    await page.waitForTimeout(250);
    const botao = linha.getByRole("button", { name: "Confirmar consumo", exact: true });
    if ((await botao.count()) === 0 || (await botao.isDisabled())) continue;
    await botao.click();
    await page.waitForTimeout(2800);
    consumidoNoParcial += alvo;
    registrarSeparador({
      campo: "Consumo Real › Consumir agora",
      onde: `Produção › OP ${S.dados.op.code} › Consumo Real (${pendenteDeProposito})`,
      digitado: comoDigitado(String(alvo)),
      como: "virgula",
    });
    break; // a tabela re-renderiza; a próxima passagem relê
  }

  const opParcial = await apiGet(`/production-orders/${S.dados.op.id}`);
  const reqCliente = (opParcial.requirements ?? []).find((r) => r.itemCode === pendenteDeProposito);
  check(
    `DECIMAL · Consumo Real aceitou a vírgula e gravou ${Number(reqCliente?.consumedQuantity ?? 0)}`,
    Number(reqCliente?.consumedQuantity ?? 0) > 0,
    `consumido=${reqCliente?.consumedQuantity} · digitado com vírgula=${consumidoNoParcial}`,
  );
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });
  const aindaBloqueado = await page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true })
    .isDisabled();
  const avisoParcial = (await textos(".line-actions p.form-alert")).join(" | ");
  check(
    "ETAPA 11 · consumo PARCIAL não resolve a pendência: a tela continua cobrando o material do cliente",
    aindaBloqueado && avisoParcial.includes(pendenteDeProposito),
    `desabilitado=${aindaBloqueado} aviso="${avisoParcial}"`,
  );
  anotar(
    `ETAPA 11 · ${pendenteDeProposito} recebeu consumo parcial (${reqCliente?.consumedQuantity} de ` +
      `${reqCliente?.requiredQuantity}) — a diferença de material de terceiro fica para justificar`,
  );
  await shot("e2e3-21c-parcial-ainda-bloqueia");

  // ── Justificar a diferença ──────────────────────────────────────────────
  const linhaNecessidade = secao("Necessidade de Materiais")
    .locator("tbody tr")
    .filter({ hasText: pendenteDeProposito })
    .first();
  await linhaNecessidade.getByRole("button", { name: "Justificar diferença", exact: true }).click();
  await page.waitForSelector("#variance-reason", { timeout: 20000 });
  const tituloJustificativa = await texto("#variance-title");
  check(
    "ETAPA 11 · “Justificar diferença” abre o pedido de motivo para AQUELE material",
    tituloJustificativa.includes(pendenteDeProposito),
    tituloJustificativa,
  );
  await preencher(
    "#variance-reason",
    `Sobra de material do cliente ${CLIENTE_A.tradeName} devolvida ao lote de origem: o envase ` +
      "consumiu menos do que a formulacao previa, e o saldo continua sendo do cliente.",
  );
  await shot("e2e3-21d-justificar-diferenca");
  await clicarBotao("Registrar justificativa");
  await page.waitForTimeout(3000);

  const opAntes = await apiGet(`/production-orders/${S.dados.op.id}`);
  const requisitos = opAntes.requirements ?? [];
  const porReconciliar = requisitos.filter(
    (r) => r.reconciliationStatus === "PENDING_NONE" || r.reconciliationStatus === "PENDING_PARTIAL",
  );
  check(
    "ETAPA 11 · nenhum material continua por reconciliar antes de concluir a OP",
    requisitos.length > 0 && porReconciliar.length === 0,
    JSON.stringify(requisitos.map((r) => `${r.itemCode}=${r.reconciliationStatus}`)),
  );
  check(
    "ETAPA 11 · a diferença do material do cliente ficou como divergência JUSTIFICADA, com motivo e autor",
    requisitos.some(
      (r) =>
        r.itemCode === pendenteDeProposito &&
        r.reconciliationStatus === "VARIANCE_ACCEPTED" &&
        (r.varianceReason ?? "").length > 0 &&
        (r.varianceAcceptedBy ?? "").length > 0,
    ),
    JSON.stringify(
      requisitos
        .filter((r) => r.itemCode === pendenteDeProposito)
        .map((r) => `${r.reconciliationStatus}/${r.varianceReason}/${r.varianceAcceptedBy}`),
    ),
  );
  const progresso = (await textos(".form-section__sub")).find((t) =>
    /materiais reconciliados/.test(t),
  );
  check(
    "ETAPA 11 · a tela mostra o progresso da reconciliação completo",
    /(\d+) de \1 materiais reconciliados/.test(progresso ?? ""),
    `"${progresso ?? "—"}"`,
  );
  anotar(`ETAPA 11 · progresso na tela: "${progresso ?? "—"}"`);
  await shot("e2e3-21e-tudo-reconciliado");

  // ── Conclusão, agora permitida ──────────────────────────────────────────
  const concluir = page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true });
  check(
    "ETAPA 11 · reconciliado tudo, o MESMO botão “Concluir OP” fica habilitado",
    !(await concluir.isDisabled()),
    `desabilitado=${await concluir.isDisabled()}`,
  );
  await concluir.click();
  await page.waitForTimeout(900);
  if ((await page.locator("#op-completion-reason").count()) > 0) {
    await preencher("#op-completion-reason", "Rendimento conforme planejado no cenario E2E3.");
  }
  await confirmarModal("Concluir OP");
  await page.waitForTimeout(3500);
  check(
    "PRODUÇÃO · a OP foi concluída pela tela",
    (await texto(".doc-title .badge")) === "Concluída",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
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
    /*
     * O produto acabado é da VERIDI, mesmo tendo sido feito com material do
     * cliente. O material continua do cliente até ser consumido; o que sai da
     * linha é produto, e produto tem outro dono e outro destino.
     */
    check(
      "PRODUÇÃO · o lote de produto acabado é da VERIDI — industrializar com material de terceiro não transfere o produto",
      lotes[0].ownerType === "VERIDI" && lotes[0].ownerCustomerId === null,
      `${lotes[0].code}/${lotes[0].ownerType}/${lotes[0].ownerCustomerName ?? "—"}`,
    );
    anotar(`PRODUÇÃO · lote de PA ${lotes[0].code} (${LOTE_VERIDI}) situação ${lotes[0].status}`);
  }

  const sobraDoCliente =
    ((await apiGet("/lots?pageSize=100")).lots ?? []).filter(
      (l) => l.ownerCustomerId === S.dados.clienteA.id,
    ) ?? [];
  anotar(
    `ETAPA 11 · saldo remanescente do cliente A após a produção: ${JSON.stringify(
      sobraDoCliente.map((l) => `${l.code}=${l.onHand} ${l.unitCode}`),
    )} — a sobra continua sendo do cliente`,
  );
  salvarEstado();
  await shot("e2e3-21-op-concluida");
}

// ── MARCO 22 · Rastreabilidade do lote de produto acabado ─────────────────
/**
 * A árvore do lote acabado tem que mostrar o material do cliente COMO material
 * do cliente.
 *
 * A coluna se chama "Origem do material" e, para material comprado, traz o
 * fornecedor. Para material de terceiro não existe fornecedor: escrever um
 * traço ali leria como "fornecedor desconhecido" — a única leitura pior do
 * que nenhuma, porque um recall começaria procurando uma nota fiscal que não
 * existe.
 */
async function marco22Rastreabilidade() {
  await abrir(`/estoque/lotes/${S.dados.lotePa.id}`, { espera: ".doc-title h1" });
  const corpo = await texto(".doc-body");
  check(
    "ETAPA 12 · o lote de produto acabado aponta a OP que o produziu",
    corpo.includes(S.dados.op.code),
    corpo.slice(0, 260),
  );

  const arvore = await textos(secao("Rastreabilidade").locator("tbody tr"));
  const linhaColageno = arvore.find((l) => l.includes(S.dados.itens[COLAGENO.nome].code));
  const linhaVitC = arvore.find((l) => l.includes(S.dados.itens[VITAMINA_C.nome].code));
  check(
    "ETAPA 12 · a árvore lista o material do cliente entre os materiais consumidos",
    Boolean(linhaColageno),
    JSON.stringify(arvore.map((l) => l.slice(0, 110))),
  );
  check(
    "ETAPA 12 · o material do cliente aparece identificado como tal, com o nome do CLIENTE no lugar do fornecedor",
    Boolean(linhaColageno) &&
      /Material do cliente/i.test(linhaColageno) &&
      nomeiaCliente(linhaColageno, CLIENTE_A),
    `"${linhaColageno ?? "—"}"`,
  );
  check(
    "ETAPA 12 · na MESMA árvore, o material comprado continua mostrando o fornecedor — a distinção é visível",
    Boolean(linhaVitC) && linhaVitC.includes(FORNECEDOR.legalName),
    `"${linhaVitC ?? "—"}"`,
  );
  check(
    "ETAPA 12 · a genealogia cita os lotes de A e NENHUM lote do cliente B",
    arvore.some((l) => l.includes(S.dados.remessaA1.code) || l.includes(S.dados.remessaA2.code)) &&
      !arvore.some((l) => l.includes(S.dados.remessaB1.code)),
    JSON.stringify(arvore.map((l) => l.slice(0, 110))),
  );
  anotar(`ETAPA 12 · genealogia do lote ${S.dados.lotePa.code}: ${JSON.stringify(arvore.map((l) => l.slice(0, 120)))}`);

  /*
   * A rastreabilidade só vale se o consumo REGISTRADO for o mesmo que a
   * árvore mostra — genealogia de reserva seria intenção, não história.
   */
  const op = await apiGet(`/production-orders/${S.dados.op.id}`);
  const consumidos = (op.requirements ?? []).filter((r) => Number(r.consumedQuantity ?? 0) > 0);
  check(
    "ETAPA 12 · a árvore reflete o consumo REAL registrado na OP, não a reserva",
    consumidos.every((r) => arvore.some((l) => l.includes(r.itemCode))),
    JSON.stringify(consumidos.map((r) => `${r.itemCode}=${r.consumedQuantity}`)),
  );
  await shot("e2e3-22-rastreabilidade");

  // ── E do lado do material: o lote do cliente aponta o que virou ─────────
  await abrir(`/estoque/lotes/${S.dados.remessaA1.id}`, { espera: ".doc-title h1" });
  const corpoMp = await texto(".doc-body");
  check(
    "ETAPA 12 · o lote do material do cliente aponta a OP em que foi consumido",
    corpoMp.includes(S.dados.op.code),
    corpoMp.slice(0, 260),
  );
  anotar(
    `ETAPA 12 · cadeia fechada: ${S.dados.remessaA1.code} (material de ${CLIENTE_A.tradeName}) → ` +
      `${S.dados.op.code} → ${S.dados.lotePa.code}`,
  );
  await shot("e2e3-22b-rastreabilidade-material-do-cliente");
}

// ── MARCO 23 · Expedição e faturamento ────────────────────────────────────
async function marco23Faturamento() {
  /*
   * O lote de produto acabado nasce aguardando a Qualidade — industrializar
   * com material de terceiro não pula a liberação. Sem ela não há saldo
   * disponível para reservar, e a expedição nem chega a existir.
   */
  await abrir(`/estoque/lotes/${S.dados.lotePa.id}`, { espera: ".doc-title h1" });
  if (await existeBotao("Liberar")) {
    await clicarBotao("Liberar");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(1200);
  }
  check(
    "QUALIDADE · o lote de produto acabado foi liberado pela tela antes de qualquer reserva",
    (await texto(".doc-title .badge")) === "Disponível",
    await texto(".doc-title .badge"),
  );

  if (!S.dados.expedicao) {
    await abrir("/comercial/expedicoes", { espera: ".page__title" });
    registrarVazio("Comercial › Expedições", await texto("td.table__empty"));

    await abrir(S.dados.pedido.url, { espera: ".doc-title h1" });
    const reservar = page.getByLabel(`Reservar de ${S.dados.produto.code}`);
    if ((await reservar.count()) > 0) {
      await reservar.first().fill(String(QUANTIDADE_PRODUZIDA));
      await page.waitForTimeout(500);
      if (await existeBotao("Reservar disponível")) {
        await clicarBotao("Reservar disponível");
        await page.waitForTimeout(3000);
      }
    }
    await clicarBotao("Preparar Expedição");
    const foi = await esperarUrl(
      (u) => /^\/comercial\/expedicoes\/[0-9a-f-]{36}$/.test(u.pathname),
      30000,
    );
    if (!check("EXPEDIÇÃO · nasce do Pedido, com a reserva já feita", foi, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
    await page.waitForTimeout(1500);
    S.dados.expedicao = { url: caminho(), code: await texto(".doc-title h1") };
    salvarEstado();
  } else {
    await abrir(S.dados.expedicao.url, { espera: ".doc-title h1" });
  }

  check(
    "EXPEDIÇÃO · a expedição tem código EXP gerado",
    /^EXP-\d+/.test(await texto(".doc-title h1")),
    await texto(".doc-title h1"),
  );

  if ((await texto(".doc-title .badge")) !== "Confirmada") {
    const linhas = page.locator("div.shipment-product table tbody tr");
    const n = await linhas.count();
    for (let i = 0; i < n; i += 1) {
      const linha = linhas.nth(i);
      const conteudo = ((await linha.textContent()) ?? "").replace(/\s+/g, " ");
      if (conteudo.includes("Conferido")) continue;
      const lote = (conteudo.match(/LT-\d{8}-\d{6}/) ?? [])[0];
      if (!lote) continue;
      const campoLote = linha.getByLabel(`Lote conferido da linha ${lote}`);
      if ((await campoLote.count()) === 0) continue;
      await campoLote.fill(lote);
      await linha.getByRole("button", { name: "Conferir lote", exact: true }).click();
      await page.waitForTimeout(1800);
    }
    await clicarBotao("Confirmar expedição");
    anotar(`EXPEDIÇÃO · diálogo de confirmação: "${await confirmarDialogo("Confirmar")}"`);
    await page.waitForTimeout(3500);
  }
  check(
    "EXPEDIÇÃO · confirmada",
    (await texto(".doc-title .badge")) === "Confirmada",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  await shot("e2e3-23a-expedicao");

  await abrir("/comercial/faturamento", { espera: ".page__title" });
  for (const v of await textos("td.table__empty")) registrarVazio("Comercial › Faturamento", v);

  if (!S.dados.faturamento) {
    await abrir(S.dados.expedicao.url, { espera: ".doc-title h1" });
    await clicarBotao("Preparar faturamento");
    const foi = await esperarUrl(
      (u) => /^\/comercial\/faturamento\/[0-9a-f-]{36}$/.test(u.pathname),
      30000,
    );
    if (!check("FATURAMENTO · nasce da expedição confirmada", foi, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
    await page.waitForTimeout(1500);
    S.dados.faturamento = { url: caminho(), code: await texto(".doc-title h1") };
    salvarEstado();
  } else {
    await abrir(S.dados.faturamento.url, { espera: ".doc-title h1" });
  }

  check(
    "FATURAMENTO · o documento tem código FAT gerado",
    /^FAT-\d+/.test(await texto(".doc-title h1")),
    await texto(".doc-title h1"),
  );
  const campoRef = page.locator("#billing-external-reference");
  if ((await campoRef.count()) > 0 && !(await campoRef.isDisabled())) {
    await campoRef.fill("NF-E2E3-SAIDA-0001");
    await clicarBotao("Salvar rascunho");
    await page.waitForTimeout(2000);
  }
  const rodape = await texto("div.table-foot");
  anotar(`FATURAMENTO · rodapé do documento: "${rodape}"`);
  /*
   * O faturamento é da INDUSTRIALIZAÇÃO. Não há linha de venda do colágeno,
   * porque o colágeno nunca foi da Veridi — cobrar por ele seria vender ao
   * cliente o material que ele mesmo mandou.
   */
  const corpoFat = await texto(".doc-body");
  check(
    "ETAPA 13 · o faturamento cobra o produto industrializado, e NÃO o material que o cliente enviou",
    corpoFat.includes(S.dados.produto.code) &&
      !corpoFat.includes(S.dados.itens[COLAGENO.nome].code),
    corpoFat.slice(0, 260),
  );

  if (await existeBotao("Emitir faturamento")) {
    await clicarBotao("Emitir faturamento");
    anotar(`FATURAMENTO · diálogo de emissão: "${await confirmarDialogo("Emitir")}"`);
    await page.waitForTimeout(3000);
  }
  check(
    "FATURAMENTO · emitido",
    (await texto(".doc-title .badge")) === "Emitido",
    `${await texto(".doc-title .badge")} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  salvarEstado();
  await shot("e2e3-23-faturamento");
}

// ── MARCO 24 · Consulta de Cliente ────────────────────────────────────────
const ABAS = [
  { rota: "resumo", nome: "Resumo" },
  { rota: "produtos", nome: "Produtos" },
  { rota: "projetos", nome: "Projetos" },
  { rota: "pedidos", nome: "Pedidos" },
  { rota: "producao", nome: "Produção" },
  { rota: "estoque", nome: "Estoque" },
  { rota: "faturamentos", nome: "Faturamentos" },
];

/**
 * A Consulta é a tela onde o vazamento de dados entre clientes seria mais
 * caro: aqui o cliente é a RAIZ, e tudo que aparece é lido como sendo dele.
 * Um lote do cliente B sob o cabeçalho do cliente A não seria um detalhe de
 * filtro — seria a Veridi dizendo a A que tem material de A que não tem.
 */
async function lerAbas(customerId, prefixoShot) {
  const conteudo = {};
  for (const aba of ABAS) {
    await abrir(`/consultas/clientes/${customerId}/${aba.rota}`, { espera: ".consult-body" });
    await page.waitForTimeout(1200);
    conteudo[aba.nome] = (await texto(".consult-body")).slice(0, 1200);
    registrarVazio(
      `Consulta do Cliente › ${aba.nome}`,
      await texto(".consult-body td.table__empty"),
    );
    if (aba.rota === "estoque") {
      await abrir(`/consultas/clientes/${customerId}/estoque/materiais`, {
        espera: ".consult-body",
      });
      await page.waitForTimeout(1200);
      conteudo["Estoque › Materiais"] = (await texto(".consult-body")).slice(0, 1200);
      await shot(`${prefixoShot}-estoque-materiais`);
    }
  }
  return conteudo;
}

async function marco24ConsultaDeCliente() {
  await abrir("/consultas/clientes", { espera: ".page__title" });
  await preencher("#consultation-search", P);
  await page.waitForTimeout(1500);
  const encontrados = await textos("table tbody tr");
  check(
    "CONSULTA · a busca encontra os dois clientes do cenário",
    encontrados.some((l) => l.includes(CLIENTE_A.legalName)) &&
      encontrados.some((l) => l.includes(CLIENTE_B.legalName)),
    JSON.stringify(encontrados.map((l) => l.slice(0, 90))),
  );
  await page.locator("table tbody tr").filter({ hasText: CLIENTE_A.legalName }).first().click();
  const abriu = await esperarUrl(
    (u) => u.pathname.startsWith(`/consultas/clientes/${S.dados.clienteA.id}`),
    20000,
  );
  check("CONSULTA · clicar na linha abre a consulta daquele cliente", abriu, caminho());
  await page.waitForSelector(".consult-head", { timeout: 20000 });

  const cabecalho = await texto(".consult-head h1");
  check(
    "CONSULTA · o cabeçalho identifica o cliente A como raiz da navegação",
    cabecalho === CLIENTE_A.legalName,
    cabecalho,
  );
  const abasNaTela = await textos("nav.consult-tabs a.consult-tabs__link");
  check(
    "CONSULTA · a Consulta tem as sete abas do ciclo",
    ABAS.every((a) => abasNaTela.includes(a.nome)),
    JSON.stringify(abasNaTela),
  );
  await shot("e2e3-24a-consulta-cliente-a");

  const deA = await lerAbas(S.dados.clienteA.id, "e2e3-24b-consulta-a");
  const codigosDeA = {
    Produtos: S.dados.produto.code,
    Pedidos: (S.dados.pedido.code ?? "").split(" ")[0],
    Produção: S.dados.op.code,
    Faturamentos: (S.dados.faturamento?.code ?? "").split(" ")[0],
  };
  for (const [aba, codigo] of Object.entries(codigosDeA)) {
    if (!codigo) continue;
    check(
      `CONSULTA · a aba ${aba} do cliente A mostra ${codigo}`,
      (deA[aba] ?? "").includes(codigo),
      (deA[aba] ?? "").slice(0, 200),
    );
  }

  // ── ETAPA 14 · o documento do cliente B sob o cabeçalho do cliente A ────
  const materiaisDeA = deA["Estoque › Materiais"] ?? "";
  check(
    "ETAPA 14 · sob o cabeçalho do cliente A, o material do cliente A aparece",
    materiaisDeA.includes(S.dados.remessaA1.code) || materiaisDeA.includes(S.dados.remessaA2.code),
    materiaisDeA.slice(0, 240),
  );
  check(
    `ETAPA 14 · e o lote ${S.dados.remessaB1.code}, do cliente B, NÃO aparece sob o cabeçalho do cliente A`,
    !materiaisDeA.includes(S.dados.remessaB1.code),
    materiaisDeA.slice(0, 300),
  );
  const tudoDeA = Object.values(deA).join(" ");
  check(
    "ETAPA 14 · nenhuma aba do cliente A cita o cliente B, nem pelo código, nem pela razão social",
    !tudoDeA.includes(CLIENTE_B.legalName) && !tudoDeA.includes(S.dados.clienteB.code),
    tudoDeA.slice(0, 300),
  );
  anotar(
    `ETAPA 14 · Consulta de ${S.dados.clienteA.code}: materiais = ` +
      `"${materiaisDeA.replace(/\s+/g, " ").slice(0, 220)}"`,
  );

  // ── E o inverso, que é a outra metade da prova ──────────────────────────
  await abrir(`/consultas/clientes/${S.dados.clienteB.id}/resumo`, { espera: ".consult-head" });
  const cabecalhoB = await texto(".consult-head h1");
  check(
    "ETAPA 14 · a consulta do cliente B abre sob o cabeçalho DELE",
    cabecalhoB === CLIENTE_B.legalName,
    cabecalhoB,
  );
  const deB = await lerAbas(S.dados.clienteB.id, "e2e3-24c-consulta-b");
  const materiaisDeB = deB["Estoque › Materiais"] ?? "";
  check(
    `ETAPA 14 · sob o cabeçalho do cliente B só aparece o lote dele (${S.dados.remessaB1.code})`,
    materiaisDeB.includes(S.dados.remessaB1.code) &&
      !materiaisDeB.includes(S.dados.remessaA1.code) &&
      !materiaisDeB.includes(S.dados.remessaA2.code),
    materiaisDeB.slice(0, 300),
  );
  const tudoDeB = Object.values(deB).join(" ");
  check(
    "ETAPA 14 · o cliente B não vê produto, pedido, produção nem faturamento do cliente A",
    !tudoDeB.includes(S.dados.produto.code) &&
      !tudoDeB.includes(S.dados.op.code) &&
      !tudoDeB.includes((S.dados.pedido.code ?? "").split(" ")[0]),
    tudoDeB.slice(0, 300),
  );
  anotar(
    `ETAPA 14 · Consulta de ${S.dados.clienteB.code}: materiais = ` +
      `"${materiaisDeB.replace(/\s+/g, " ").slice(0, 220)}" — o cliente B mandou material e não ` +
      "produziu nada, e é exatamente isso que a consulta dele mostra",
  );
  await shot("e2e3-24-consulta-cliente-b");
}

// ── MARCO 25 · Ajuda contextual nas telas de template ─────────────────────
/**
 * "O painel abre" não é a verificação.
 *
 * Um painel emprestado da tela vizinha abre igual, tem a mesma cara e explica
 * a coisa errada — foi exatamente esse o defeito corrigido em Precificação.
 * Templates de Estrutura e Políticas de Precificação ganharam tópico PRÓPRIO,
 * e a prova é comparativa: o painel delas precisa falar do assunto delas E
 * ser diferente do painel das telas vizinhas, lidas na mesma execução.
 */
const TELAS_DE_TEMPLATE = [
  {
    nome: "Produção › Templates de Formulação (lista)",
    rota: () => "/producao/templates-formulacao",
    espera: ".page__title",
    proprio: /template|matriz/i,
  },
  {
    nome: "Produção › Template de Formulação (detalhe)",
    rota: () => S.dados.ft.url,
    espera: ".doc-title",
    proprio: /rascunho|vers(ã|a)o|template/i,
  },
  {
    nome: "Gestão › Templates de Estrutura (lista)",
    rota: () => "/gestao/templates-estrutura",
    espera: ".page__title",
    proprio: /templates? de estrutura/i,
  },
  {
    nome: "Gestão › Template de Estrutura (detalhe)",
    rota: () => S.dados.tec.url,
    espera: ".doc-title",
    proprio: /templates? de estrutura/i,
  },
  {
    nome: "Gestão › Políticas de Precificação (lista)",
    rota: () => "/gestao/politicas-precificacao",
    espera: ".page__title",
    proprio: /pol(í|i)ticas? de precifica/i,
  },
  {
    nome: "Gestão › Política de Precificação (detalhe)",
    rota: () => S.dados.tpp.url,
    espera: ".doc-title",
    proprio: /pol(í|i)ticas? de precifica/i,
  },
];

/** As telas VIZINHAS, lidas para a comparação não depender de texto fixo. */
const TELAS_VIZINHAS = [
  { nome: "Gestão › Precificação (lista)", rota: () => "/gestao/precificacao", espera: ".page__title" },
  {
    nome: "Cálculo de custo (documento CALC)",
    rota: () => S.dados.calculo.url,
    espera: ".doc-title h1, .doc-title",
  },
];

async function marco25AjudaDosTemplates() {
  const vizinhos = [];
  for (const tela of TELAS_VIZINHAS) {
    await abrir(tela.rota(), { espera: tela.espera });
    await page.waitForTimeout(700);
    const painel = await lerAjuda(tela.nome);
    if (painel) vizinhos.push({ tela: tela.nome, titulo: painel.titulo });
    anotar(`AJUDA (vizinha) · ${tela.nome} → "${painel?.titulo ?? "sem painel"}"`);
  }
  check(
    "AJUDA · as telas vizinhas (Precificação e Cálculo) têm painéis próprios, e são a referência da comparação",
    vizinhos.length === TELAS_VIZINHAS.length &&
      new Set(vizinhos.map((v) => v.titulo)).size === vizinhos.length,
    JSON.stringify(vizinhos),
  );

  const titulosVizinhos = vizinhos.map((v) => v.titulo);
  for (const tela of TELAS_DE_TEMPLATE) {
    await abrir(tela.rota(), { espera: tela.espera });
    await page.waitForTimeout(700);
    const painel = await lerAjuda(tela.nome);
    if (
      !check(
        `AJUDA · ${tela.nome} oferece o painel “Como funciona” e ele abre`,
        Boolean(painel),
        `nenhum .context-help__trigger em ${caminho()}`,
      )
    ) {
      continue;
    }
    check(
      `AJUDA · ${tela.nome} · o painel é DESTA tela — o título nomeia o assunto dela`,
      tela.proprio.test(painel.titulo),
      `título="${painel.titulo}"`,
    );
    check(
      `AJUDA · ${tela.nome} · o painel NÃO é o da tela vizinha (Precificação / Cálculo de custo)`,
      !titulosVizinhos.includes(painel.titulo),
      `título="${painel.titulo}" · vizinhos=${JSON.stringify(titulosVizinhos)}`,
    );
    check(
      `AJUDA · ${tela.nome} · responde “o que é / quando uso / o que acontece depois”`,
      painel.oQueE && painel.quandoUso && painel.oQueAcontece,
      `oQueE=${painel.oQueE} quandoUso=${painel.quandoUso} depois=${painel.oQueAcontece} · ` +
        `resumo="${painel.resumo.slice(0, 140)}"`,
    );
    anotar(
      `AJUDA · ${tela.nome} → "${painel.titulo}" · ${painel.conceitos} conceitos · ` +
        `${painel.fluxos.length} fluxo(s) · ${painel.tamanho} caracteres`,
    );
    await shot(
      `e2e3-25-ajuda-${tela.nome.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 44)}`,
    );
  }

  /*
   * As três bibliotecas explicam a MESMA regra por três ângulos — matriz,
   * configuração, política — e por isso é fácil um painel acabar servindo aos
   * três. Títulos distintos são a prova barata de que não serviram.
   */
  const titulosDeTemplate = ajudas
    .filter((a) => TELAS_DE_TEMPLATE.some((t) => t.nome === a.tela))
    .map((a) => a.titulo);
  const distintos = new Set(titulosDeTemplate);
  check(
    "AJUDA · as três bibliotecas abrem painéis distintos entre si e distintos dos das telas vizinhas",
    distintos.size >= 3 && titulosDeTemplate.every((t) => !titulosVizinhos.includes(t)),
    `templates=${JSON.stringify(titulosDeTemplate)} · vizinhos=${JSON.stringify(titulosVizinhos)}`,
  );
}

// ── MARCO 26 · Breadcrumbs ────────────────────────────────────────────────
/**
 * Trilha se prova CLICANDO.
 *
 * Conferir `href` provaria que o atributo existe; o que interessa é que o
 * clique SOBE um nível real, com a lista certa do outro lado.
 */
async function marco26Breadcrumbs() {
  const trilhas = [
    {
      nome: "Gestão › Template de Estrutura (documento)",
      rota: () => S.dados.tec.url,
      espera: ".doc-title",
      clicar: "Templates de Estrutura",
      destino: "/gestao/templates-estrutura",
    },
    {
      nome: "Gestão › Política de Precificação (documento)",
      rota: () => S.dados.tpp.url,
      espera: ".doc-title",
      clicar: "Políticas de Precificação",
      destino: "/gestao/politicas-precificacao",
    },
    {
      nome: "Produção › Template de Formulação (documento)",
      rota: () => S.dados.ft.url,
      espera: ".doc-title",
      clicar: "Templates de Formulação",
      destino: "/producao/templates-formulacao",
    },
    {
      nome: "Compras › Recebimento de material do cliente (documento)",
      rota: () => S.dados.remessaA1.receipt.url,
      espera: ".doc-title h1",
      clicar: "Recebimentos",
      destino: "/compras/recebimentos",
    },
    {
      nome: "Gestão › Precificação (documento)",
      rota: () => S.dados.precificacao.url,
      espera: ".doc-title",
      clicar: "Precificação",
      destino: "/gestao/precificacao",
    },
    {
      nome: "Estoque › Lote de produto acabado (documento)",
      rota: () => `/estoque/lotes/${S.dados.lotePa.id}`,
      espera: ".doc-title h1",
      clicar: "Lotes",
      destino: "/estoque/lotes",
    },
  ];

  let subidas = 0;
  for (const t of trilhas) {
    await abrir(t.rota(), { espera: t.espera });
    await page.waitForTimeout(600);
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
    "PROVA · pelo menos TRÊS níveis reais foram subidos clicando na trilha (sem o Voltar do navegador)",
    subidas >= 3,
    `subidas bem-sucedidas=${subidas} de ${trilhas.length} tentativas`,
  );
  S.dados.subidasPelaTrilha = subidas;
  salvarEstado();
  await shot("e2e3-26-breadcrumbs");

  /*
   * O que SOBROU do padrão antigo: trilha de TEXTO, visualmente idêntica e
   * sem levar a lugar nenhum. Medir é mais honesto do que declarar a
   * migração concluída.
   */
  const aindaTexto = [];
  for (const alvo of [
    { nome: "Comercial › Pedido (documento)", rota: S.dados.pedido.url },
    { nome: "Comercial › Faturamento (documento)", rota: S.dados.faturamento?.url },
    { nome: "Consulta de Cliente › Estoque", rota: `/consultas/clientes/${S.dados.clienteA.id}/estoque/materiais` },
  ]) {
    if (!alvo.rota) continue;
    await abrir(alvo.rota, { espera: ".doc-title, .consult-head, .page__title" });
    await page.waitForTimeout(400);
    const docCrumb = await texto(".doc-crumb");
    const linksNoDocCrumb = await page.locator(".doc-crumb a").count();
    const temTrilhaDeVerdade = (await page.locator("nav.page-crumbs, nav.consult-trail").count()) > 0;
    if (docCrumb && linksNoDocCrumb === 0 && !temTrilhaDeVerdade) {
      aindaTexto.push(`${alvo.nome} (${alvo.rota}) → "${docCrumb}"`);
    }
  }
  anotar(
    "BREADCRUMB · telas ainda com trilha de TEXTO (.doc-crumb sem link): " +
      (aindaTexto.length === 0 ? "nenhuma das conferidas" : JSON.stringify(aindaTexto)),
  );
  if (aindaTexto.length > 0) {
    finding(
      "LOW",
      `Trilha de texto (.doc-crumb) sobrevive em ${aindaTexto.length} tela(s) conferida(s)`,
      "Abrir " +
        aindaTexto.join(" · ") +
        '. A trilha é <div class="doc-crumb"> com texto puro, visualmente igual ao breadcrumb de ' +
        'verdade (<nav class="page-crumbs"> com <Link>), e nenhum nível sobe. A convivência dos ' +
        "dois padrões faz a trilha funcionar em umas telas e não em outras, sem nada que distinga " +
        "as duas.",
    );
  }
}

// ── MARCO 27 · A vírgula decimal, somada da jornada inteira ───────────────
async function marco27Decimais() {
  salvarEstado();
  /*
   * Só conta quem de fato TEM vírgula: um valor redondo atravessa o campo sem
   * exercitar separador nenhum, e contá-lo inflaria a evidência com um caso
   * que não prova nada.
   */
  const comVirgula = S.registro.separadores.filter(
    (s) => s.como === "virgula" && s.digitado.includes(","),
  );
  const campos = new Set(comVirgula.map((s) => s.campo));
  check(
    "PROVA · a vírgula brasileira foi digitada e ACEITA em pelo menos TRÊS campos decimais distintos",
    campos.size >= 3,
    JSON.stringify([...campos]),
  );
  const atravessaramAtivacao = comVirgula.filter((s) => /ATIVA(Ç|C)(Ã|A)O/i.test(s.onde));
  check(
    "PROVA · pelo menos UM valor digitado com vírgula sobreviveu a uma ATIVAÇÃO e continuou valendo o mesmo número",
    atravessaramAtivacao.length >= 1,
    JSON.stringify(atravessaramAtivacao.map((s) => `${s.campo} ← "${s.digitado}" · ${s.onde}`)),
  );
  /*
   * "Nenhum campo precisou de ponto" não se mede pelo mapa da execução
   * corrente: numa retomada ele chega vazio, o que diria "nenhum campo foi
   * testado" com cara de aprovação. O sinal durável é o outro lado — toda
   * retentativa com ponto DEIXA um finding de regressão gravado no estado.
   */
  const regressoes = S.registro.findings.filter((f) => /campo decimal .* recusou/i.test(f.titulo));
  check(
    "PROVA · nenhum campo decimal precisou de retentativa com ponto na jornada inteira",
    regressoes.length === 0 && campos.size >= 3,
    `findings de recusa=${JSON.stringify(regressoes.map((f) => f.titulo))}`,
  );
  anotar(
    `DECIMAL · campos com vírgula aceita (${campos.size}): ` +
      JSON.stringify(comVirgula.map((s) => `${s.campo} ← "${s.digitado}" · ${s.onde}`)),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Execução
// ══════════════════════════════════════════════════════════════════════════
const JORNADA = [
  [1, "clientes", marco01Clientes],
  [2, "itens", marco02Itens],
  [3, "fornecedor", marco03Fornecedor],
  [4, "compra-veridi", marco04CompraVeridi],
  [5, "material-cliente-a", marco05MaterialClienteA],
  [6, "material-cliente-b", marco06MaterialClienteB],
  [7, "qualidade", marco07Qualidade],
  [8, "isolamento", marco08Isolamento],
  [9, "produto", marco09Produto],
  [10, "template-formulacao", marco10TemplateFormulacao],
  [11, "formulacao", marco11Formulacao],
  [12, "recursos", marco12Recursos],
  [13, "template-estrutura", marco13TemplateEstrutura],
  [14, "estrutura-de-custos", marco14EstruturaDeCustos],
  [15, "calculo-sem-aquisicao", marco15Calculo],
  [16, "politica-de-preco", marco16PoliticaDePreco],
  [17, "precificacao", marco17Precificacao],
  [18, "pedido-e-plano", marco18PedidoEPlano],
  [19, "falta-e-reposicao", marco19FaltaEReposicao],
  [20, "producao", marco20Producao],
  [21, "reconciliacao", marco21Reconciliacao],
  [22, "rastreabilidade", marco22Rastreabilidade],
  [23, "faturamento", marco23Faturamento],
  [24, "consulta-de-cliente", marco24ConsultaDeCliente],
  [25, "ajuda-dos-templates", marco25AjudaDosTemplates],
  [26, "breadcrumbs", marco26Breadcrumbs],
  [27, "decimais", marco27Decimais],
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
        await shot("e2e3-99-excecao");
      } catch {
        /* screenshot é cortesia, não requisito */
      }
    }
  }
} finally {
  if (browser) await browser.close();
}

/*
 * ZERO `RangeError` é o resultado esperado.
 *
 * A recursão da validação nativa pt-BR foi corrigida em 4ba458b. Qualquer
 * ocorrência — provocada ou espontânea — é REGRESSÃO, e a espontânea é a pior
 * das duas, porque acontece sem ninguém ter feito nada de errado.
 */
const recursaoDeliberada = deliberados.pageerror.filter((e) =>
  /Maximum call stack size exceeded/.test(e),
).length;
const recursaoEspontanea = pageErrors.filter((e) =>
  /Maximum call stack size exceeded/.test(e),
).length;
console.log(
  `\nRangeError "Maximum call stack size exceeded" nesta execução: ` +
    `${recursaoDeliberada + recursaoEspontanea} (esperado: 0) — ${recursaoDeliberada} em janela ` +
    `deliberada, ${recursaoEspontanea} fora dela`,
);
if (recursaoEspontanea > 0) {
  finding(
    "HIGH",
    `REGRESSÃO · a recursão da validação nativa disparou ${recursaoEspontanea} vez(es) em operação normal`,
    "apps/web/src/lib/native-validation-ptbr.ts — o tratador de `invalid` chama " +
      "`campo.reportValidity()`, que dispara `invalid` de novo no mesmo campo, sem guarda de " +
      "reentrância (a guarda entrou em 4ba458b). Ocorrências: " +
      JSON.stringify(
        pageErrors.filter((e) => /Maximum call stack size exceeded/.test(e)).slice(0, 5),
      ),
  );
}

salvarEstado();

// ── Relatório ─────────────────────────────────────────────────────────────
console.log("\n════════════ RELATÓRIO E2E-3 · MATERIAL FORNECIDO PELO CLIENTE ════════════");
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
  console.log(
    `    o que é: ${a.oQueE ? "sim" : "NÃO"} · quando uso: ${a.quandoUso ? "sim" : "NÃO"} · ` +
      `o que acontece depois: ${a.oQueAcontece ? "sim" : "NÃO"}`,
  );
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
console.log("\n erros DELIBERADOS (recusa provocada de propósito):");
console.log(`   rede: ${deliberados.rede.length}`);
for (const r of deliberados.rede.slice(0, 25)) {
  console.log(`   ⓘ [${r.janela}] ${r.method} ${r.pathname} → ${r.status}`);
}
console.log(`   console.error: ${deliberados.console.length}`);
console.log(`   pageerror: ${deliberados.pageerror.length} (RangeError: ${recursaoDeliberada})`);
console.log(` avisos "Failed to load resource": ${avisosDeRede.length}`);
console.log(` diálogos nativos (alert/confirm): ${dialogosNativos.length}`);
for (const d of dialogosNativos) console.log(`   ! ${d}`);

const separadoresComVirgula = S.registro.separadores.filter((s) => s.digitado.includes(","));
console.log(`\n── Decimal com VÍRGULA (${separadoresComVirgula.length} registros) ──`);
for (const s of separadoresComVirgula) {
  console.log(` , ${s.campo} ← "${s.digitado}" (${s.como}) · ${s.onde}`);
}
const semVirgula = S.registro.separadores.filter((s) => !s.digitado.includes(","));
if (semVirgula.length > 0) {
  console.log(" (não contam como prova — valor redondo, sem casa decimal:)");
  for (const s of semVirgula) console.log(`   · ${s.campo} ← "${s.digitado}" · ${s.onde}`);
}
console.log(
  " separador aceito por campo (jornada): " +
    JSON.stringify({ ...(S.dados.separadorPorCampo ?? {}), ...separadorPorCampo }),
);

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
  "\n── Verificações da JORNADA INTEIRA (marcos concluídos em qualquer execução) ──\n" +
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
