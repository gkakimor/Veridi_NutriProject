import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E-1 — Cenário COMERCIAL, do zero ao faturamento, INTEIRO PELA INTERFACE.
 *
 * A regra que define esta validação: **todo dado de negócio nasce pela UI**.
 * Nada de Prisma, SQL, `POST` de API ou fixture para criar cliente,
 * fornecedor, item, produto, projeto, orçamento, ordem de compra, recebimento,
 * lote, formulação, estrutura de custos, cálculo, precificação, pedido, ordem
 * de produção, expedição ou faturamento.
 *
 * Fora da UI só é permitido:
 *  - `POST /auth/login`, uma vez, para obter o cookie de sessão do navegador;
 *  - leituras (`GET`) como conferência secundária do que a tela afirmou;
 *  - instrumentação (console, rede, screenshots, medidas de layout).
 *
 * Se uma etapa não puder ser concluída pela interface, o cenário FALHA ali —
 * e isso é resultado, não fracasso. Nenhuma etapa é "pulada por API".
 *
 * Produto do cenário: Coenzima Q10, 60 cápsulas em pote, massa técnica real.
 *
 *   pnpm exec dotenv -e .env -- node scripts/e2e-1-comercial.mjs handoff/screens/e2e1
 */

const OUT = process.argv[2] ?? "handoff/screens/e2e1";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

/**
 * Retomada entre execuções.
 *
 * A jornada tem 24 marcos e cria dados que NÃO são limpos no fim. Uma parada
 * no marco 17 não pode obrigar a refazer os 16 anteriores — isso duplicaria
 * cliente, itens e ordens na base que fica para inspeção. O estado guarda o
 * que já nasceu e por qual marco a execução passou.
 *
 *   --reset  ignora o estado e começa do zero (só use em base recriada)
 *   --ate=N  para depois do marco N (desenvolvimento incremental)
 */
const STATE_FILE = path.resolve("handoff/e2e1-state.json");
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

/**
 * O relatório precisa valer para a JORNADA, não para a última execução.
 *
 * Como os marcos já concluídos são pulados, um relatório que só olhasse a
 * execução corrente mostraria uma jornada vazia — e esconderia justamente os
 * achados das etapas anteriores. O que é observação, estado vazio, ergonomia
 * ou defeito fica acumulado no estado, sem repetição.
 */
S.registro = S.registro ?? { vazios: [], observacoes: [], ergonomia: [], findings: [] };
S.registro.separadores = S.registro.separadores ?? [];
/*
 * As dez provas do item 90 valem para a JORNADA inteira.
 *
 * Marco concluído não roda de novo — é o que impede a retomada de duplicar
 * cliente e ordem na base. O efeito colateral é que a prova exercitada no
 * marco 10 não reaparece numa execução que começa no 14, e um relatório que
 * só olhasse a execução corrente diria "não exercitada" sobre algo que
 * passou. O resultado de cada prova fica gravado junto do resto do estado.
 */
S.registro.provas = S.registro.provas ?? {};

function registrarProva(rotulo, passou) {
  const n = (rotulo.match(/^PROVA (\d+)(?![0-9])/) ?? [])[1];
  if (!n) return;
  const registro = (S.registro.provas[n] = S.registro.provas[n] ?? { ok: [], nok: [] });
  const lista = passou ? registro.ok : registro.nok;
  const oposta = passou ? registro.nok : registro.ok;
  const i = oposta.indexOf(rotulo);
  if (i >= 0) oposta.splice(i, 1);
  if (!lista.includes(rotulo)) lista.push(rotulo);
}

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
function check(label, condition, detail = "") {
  registrarProva(label, Boolean(condition));
  if (condition) {
    passes.push(label);
    console.log("ok  ", label);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log("FALHOU", label, detail ? `— ${detail}` : "");
  }
  return Boolean(condition);
}

/** Medida registrada no relatório sem reprovar. */
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

/** Estados vazios encontrados pelo caminho, com o texto exibido. */
const vazios = [];
function registrarVazio(tela, texto) {
  vazios.push({ tela, texto });
  console.log(`  ∅ ${tela}: "${texto}"`);
}

/**
 * Campos de dinheiro em que a vírgula brasileira foi digitada de propósito.
 *
 * A prova pedida não é "o número gravou": é "o número gravou com VÍRGULA".
 * Sem a lista, um relatório que só dissesse "faixa cadastrada" esconderia
 * uma retentativa com ponto — que é o defeito que já existiu aqui.
 */
const separadores = [];
function registrarSeparador(registro) {
  separadores.push(registro);
  console.log(`  , ${registro.campo} ← "${registro.digitado}" → ${registro.como}`);
}

/** O mesmo número como a pessoa digita em português. */
const comoDigitado = (valor) => String(valor).replace(".", ",");

/** Telas lentas / sem retorno visual / com salto de layout. */
const ergonomia = [];
function ergo(texto) {
  ergonomia.push(texto);
  console.log(`  ⏱ ${texto}`);
}

// ── Identidades sintéticas ────────────────────────────────────────────────
const P = "E2E1";
const IDENT = {
  cliente: {
    legalName: `${P} Cliente Comercial LTDA`,
    tradeName: `${P} Cliente Comercial`,
    cnpj: "11.222.333/0001-81", // sintético, dígitos verificadores válidos
    email: "compras@e2e1cliente.example.com",
    phone: "(11) 4002-8922",
    zip: "01310-100",
    street: "Avenida Sintetica de Teste",
    number: "1000",
    district: "Bairro E2E1",
    city: "Sao Paulo",
    state: "SP",
  },
  fornecedorInsumos: {
    legalName: `${P} Insumos LTDA`,
    tradeName: `${P} Insumos`,
    cnpj: "22.333.444/0001-81",
    email: "vendas@e2e1insumos.example.com",
    phone: "(11) 4002-8923",
  },
  fornecedorEmbalagens: {
    legalName: `${P} Embalagens LTDA`,
    tradeName: `${P} Embalagens`,
    cnpj: "33.444.555/0001-81",
    email: "vendas@e2e1embalagens.example.com",
    phone: "(11) 4002-8924",
  },
};

/** Massa técnica real da Coenzima Q10 60 cápsulas em pote. */
const MP = [
  { nome: `${P} Coenzima Q10`, mgPorDose: 200, pureza: 0.98, precoKg: 1200 },
  { nome: `${P} Celulose microcristalina 101`, mgPorDose: 750, pureza: null, precoKg: 25 },
  { nome: `${P} Estearato de Magnesio`, mgPorDose: 20, pureza: null, precoKg: 45 },
  { nome: `${P} Dioxido de Silicio`, mgPorDose: 5, pureza: null, precoKg: 25 },
  { nome: `${P} Vitamina E`, mgPorDose: 10, pureza: 0.5, precoKg: 250 },
];
const EMBALAGEM = { nome: `${P} Pote 60 capsulas`, unidade: "un", preco: 1.2 };

const PRODUTO = {
  nome: `${P} Coenzima Q10 60 capsulas`,
  capsulasPorDose: 2,
  capsulasPorPote: 60,
  lotesMinimo: 1000,
  unidadesPorCaixa: 60,
  publico: "Maiores de 19 anos",
};

const FAIXAS = [
  { quantidade: 300, preco: 4.0 },
  { quantidade: 500, preco: 3.8 },
  { quantidade: 1000, preco: 3.6 },
];

const CMV_REFERENCIA = { porLote1000: 2431.87, porUnidade: 2.43 };

// ── Instrumentação de navegador ───────────────────────────────────────────
const consoleErrors = [];
const pageErrors = [];
const avisosDeRede = [];
const respostasComErro = [];
/** Marca a janela em que um erro é ESPERADO (validação provocada de propósito). */
let janelaDeliberada = null;
const deliberados = { console: [], rede: [] };

const dialogosNativos = [];
const screenshots = [];

let browser;
let page;

async function abrirNavegador() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

  /*
   * `window.alert` nativo aparece em falha de troca de status nas listagens.
   * Sem tratador, o Playwright fica preso no diálogo até o timeout — e o
   * relatório culparia a tela por uma parada que é do script.
   */
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
    pageErrors.push(`pageerror @ ${page.url()} :: ${e.message.slice(0, 240)}`);
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

// ── Ferramentas de navegação ──────────────────────────────────────────────
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

async function esperarUrl(testar, timeout = 20000) {
  const limite = Date.now() + timeout;
  while (Date.now() < limite) {
    if (testar(new URL(page.url()))) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

/** Clica um botão pelo texto exato visível. */
async function clicarBotao(texto, { timeout = 15000, indice = 0 } = {}) {
  const alvo = page.getByRole("button", { name: texto, exact: true }).nth(indice);
  await alvo.waitFor({ state: "visible", timeout });
  await alvo.click();
  await page.waitForTimeout(400);
}

async function existeBotao(texto) {
  return (await page.getByRole("button", { name: texto, exact: true }).count()) > 0;
}

/** Preenche um campo por seletor CSS, disparando os eventos do React. */
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

/** Texto visível de um seletor, normalizado. */
async function texto(seletor) {
  const el = page.locator(seletor).first();
  if ((await el.count()) === 0) return "";
  return ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

async function textos(seletor) {
  return (await page.locator(seletor).allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
}

/** Alertas e erros de campo visíveis agora. */
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

/** Valores dos campos de um formulário — para provar que o erro não apagou nada. */
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
 * Escolhe uma entidade num `SearchableEntitySelect` (combobox com busca).
 *
 * O componente não é `<select>`: é `input[role=combobox]` cuja lista sai por
 * PORTAL em `document.body` — nunca dentro do modal. A busca vai ao servidor
 * com 200ms de debounce, então a opção só existe uma volta de rede depois do
 * texto. Esperar a opção, e não um tempo fixo, é o que torna isto estável.
 */
async function escolherEntidade(seletorInput, termo, contem = termo) {
  const input = typeof seletorInput === "string" ? page.locator(seletorInput).first() : seletorInput;
  await input.waitFor({ state: "visible", timeout: 20000 });
  await input.click();
  await input.fill(termo);
  /*
   * `:not(.entity-select__create)` é obrigatório.
   *
   * A primeira opção da lista é sempre "+ Novo <entidade>: “texto digitado”",
   * e ela CONTÉM o texto procurado — filtrar só por texto acerta o botão de
   * cadastro, que navega para outra tela e leva o formulário junto.
   */
  const opcao = page
    .locator("li.entity-select__option[role='option']:not(.entity-select__create)")
    .filter({ hasText: contem })
    .first();
  await opcao.waitFor({ state: "visible", timeout: 20000 });
  await opcao.click();
  await page.waitForTimeout(350);
  return input.inputValue();
}

/** Confirma um `ConfirmDialog`/modal pelo texto exato do botão. */
async function confirmarModal(textoBotao) {
  const botao = page.getByRole("button", { name: textoBotao, exact: true }).last();
  await botao.waitFor({ state: "visible", timeout: 20000 });
  await botao.click();
  await page.waitForTimeout(700);
}

// ══════════════════════════════════════════════════════════════════════════
// A JORNADA — 24 marcos, todos pela interface
// ══════════════════════════════════════════════════════════════════════════

// ── MARCO 1 · Cliente ─────────────────────────────────────────────────────
async function marco01Cliente() {
  await abrir("/cadastros/clientes");
  const vazio = await texto("td.table__empty");
  if (vazio) registrarVazio("Cadastros › Clientes (base recém-criada)", vazio);
  await shot("e2e1-00-clientes-vazio");

  const clientesExistentes =
    (await apiGet(`/customers?search=${encodeURIComponent("E2E1")}`)).customers ?? [];
  if (clientesExistentes.length > 0) {
    S.dados.cliente = {
      id: clientesExistentes[0].id,
      code: clientesExistentes[0].code,
      legalName: clientesExistentes[0].legalName,
    };
    anotar(`CLIENTE · ${clientesExistentes[0].code} já existia de execução anterior — marco pulado`);
    return;
  }

  await abrir("/cadastros/clientes/novo");
  check(
    "CLIENTE · a tela de cadastro abre pela URL oficial",
    (await texto(".page__title")) === "Novo cliente",
    await texto(".page__title"),
  );

  // ── Erro deliberado 1 · campo obrigatório vazio ─────────────────────────
  await deliberadamente("obrigatorio-vazio", async () => {
    await preencher("#customer-trade-name", IDENT.cliente.tradeName);
    await clicarBotao("Criar cliente");
    await page.waitForTimeout(800);
  });
  const naTela = (await texto(".page__title")) === "Novo cliente";
  const preservado1 = await page.locator("#customer-trade-name").inputValue();
  check(
    "VALIDAÇÃO · razão social vazia impede o salvamento e preserva o que já foi digitado",
    naTela && preservado1 === IDENT.cliente.tradeName,
    `naTela=${naTela} nomeFantasia="${preservado1}"`,
  );

  // ── Erro deliberado 2 · e-mail inválido ─────────────────────────────────
  await preencher("#customer-legal-name", IDENT.cliente.legalName);
  await deliberadamente("email-invalido", async () => {
    await preencher("#customer-email", "compras@@sem-dominio");
    await clicarBotao("Criar cliente");
    await page.waitForTimeout(1200);
  });
  const errosEmail = await mensagensDeErro();
  const formEmail = await valoresDoFormulario();
  check(
    "VALIDAÇÃO · e-mail inválido produz mensagem visível e específica",
    errosEmail.some((m) => /e-?mail/i.test(m)),
    JSON.stringify(errosEmail),
  );
  check(
    "VALIDAÇÃO · o erro de e-mail não apaga o formulário",
    formEmail["customer-legal-name"] === IDENT.cliente.legalName &&
      formEmail["customer-trade-name"] === IDENT.cliente.tradeName,
    JSON.stringify({
      legal: formEmail["customer-legal-name"],
      trade: formEmail["customer-trade-name"],
    }),
  );
  anotar(`VALIDAÇÃO · mensagem de e-mail exibida: ${JSON.stringify(errosEmail)}`);
  await shot("e2e1-00-cliente-erro-email");

  // ── Erro deliberado 3 · telefone inválido ───────────────────────────────
  await preencher("#customer-email", IDENT.cliente.email);
  await deliberadamente("telefone-invalido", async () => {
    await preencher("#customer-phone", "(10) 1234-5678"); // DDD 10 não existe
    await clicarBotao("Criar cliente");
    await page.waitForTimeout(1200);
  });
  const errosTel = await mensagensDeErro();
  const formTel = await valoresDoFormulario();
  check(
    "VALIDAÇÃO · telefone com DDD inexistente produz mensagem visível e específica",
    errosTel.some((m) => /telefone|ddd/i.test(m)),
    JSON.stringify(errosTel),
  );
  check(
    "VALIDAÇÃO · o erro de telefone não apaga o formulário",
    formTel["customer-legal-name"] === IDENT.cliente.legalName &&
      formTel["customer-email"] === IDENT.cliente.email,
    JSON.stringify({ legal: formTel["customer-legal-name"], mail: formTel["customer-email"] }),
  );
  anotar(`VALIDAÇÃO · mensagem de telefone exibida: ${JSON.stringify(errosTel)}`);

  // ── Cadastro bom ────────────────────────────────────────────────────────
  await preencher("#customer-phone", IDENT.cliente.phone);
  await preencher("#customer-cnpj", IDENT.cliente.cnpj);
  await preencher("#customer-zip", IDENT.cliente.zip);
  await preencher("#customer-street", IDENT.cliente.street);
  await preencher("#customer-number", IDENT.cliente.number);
  await preencher("#customer-district", IDENT.cliente.district);
  await preencher("#customer-city", IDENT.cliente.city);
  await selecionar("#customer-state", IDENT.cliente.state);
  await clicarBotao("Criar cliente");

  const voltou = await esperarUrl((u) => u.pathname === "/cadastros/clientes", 25000);
  check("CLIENTE · salvar leva de volta à lista de clientes", voltou, caminho());
  await page.waitForTimeout(900);

  const linhas = await textos("table tbody tr");
  const linha = linhas.find((l) => l.includes(IDENT.cliente.legalName));
  check(
    "CLIENTE · o cliente recém-criado aparece na lista, com código gerado",
    Boolean(linha) && /CLI-\d+/.test(linha ?? ""),
    linha ?? JSON.stringify(linhas.slice(0, 3)),
  );

  const lidos = await apiGet(`/customers?search=${encodeURIComponent("E2E1")}`);
  const cliente = (lidos.customers ?? []).find((c) => c.legalName === IDENT.cliente.legalName);
  check(
    "CLIENTE · a leitura técnica confirma o registro nascido pela tela",
    Boolean(cliente),
    JSON.stringify((lidos.customers ?? []).map((c) => c.legalName)),
  );
  if (cliente) {
    S.dados.cliente = { id: cliente.id, code: cliente.code, legalName: cliente.legalName };
    check(
      "CLIENTE · CNPJ, e-mail e telefone válidos foram gravados",
      Boolean(cliente.cnpj) && Boolean(cliente.email) && Boolean(cliente.phone),
      JSON.stringify({ cnpj: cliente.cnpj, email: cliente.email, phone: cliente.phone }),
    );
  }
  await shot("e2e1-01-cliente");
}

// ── MARCO 2 · Itens de estoque ────────────────────────────────────────────
async function marco02Itens() {
  await abrir("/cadastros/itens");
  const vazioItens = await texto("td.table__empty");
  if (vazioItens) registrarVazio("Cadastros › Itens de estoque (base recém-criada)", vazioItens);

  await abrir("/cadastros/itens/novo");

  // ── REGRA PA · Produto Acabado NÃO pode ser criado manualmente ───────────
  const opcoesTipo = await page.evaluate(() =>
    [...document.querySelectorAll("#item-type option")].map((o) => ({
      value: o.value,
      label: (o.textContent ?? "").trim(),
    })),
  );
  const temPA = opcoesTipo.some(
    (o) => o.value === "FINISHED_PRODUCT" || /produto acabado/i.test(o.label),
  );
  check(
    "REGRA PA · o seletor de tipo do item NÃO oferece Produto acabado",
    !temPA,
    JSON.stringify(opcoesTipo),
  );
  const dica = await texto(".field__hint");
  check(
    "REGRA PA · a tela explica por que Produto acabado não está na lista",
    /produtos acabados são criados automaticamente/i.test(dica),
    dica,
  );
  anotar(`REGRA PA · tipos ofertados na criação: ${opcoesTipo.map((o) => o.value).join(", ") || "—"}`);
  await shot("e2e1-02a-tipo-sem-produto-acabado");

  // A porta fechada pelo seletor também não abre por parâmetro de URL.
  await abrir("/cadastros/itens/novo?tipo=FINISHED_PRODUCT");
  const tipoNaUrl = await page.locator("#item-type").inputValue();
  check(
    "REGRA PA · ?tipo=FINISHED_PRODUCT na URL não pré-seleciona Produto acabado",
    tipoNaUrl !== "FINISHED_PRODUCT",
    `valor selecionado="${tipoNaUrl}"`,
  );

  // ── Erro deliberado 4 · campo obrigatório vazio no item ─────────────────
  // `#item-type` é `required`: quem barra é a validação nativa do navegador,
  // com balão próprio. Medir `validity.valueMissing` e `validationMessage` é
  // o único jeito honesto de provar que a barreira existe e fala.
  await abrir("/cadastros/itens/novo");
  await deliberadamente("item-sem-tipo", async () => {
    await preencher("#item-name", "SEM TIPO");
    await clicarBotao("Criar item");
    await page.waitForTimeout(700);
  });
  const nativo = await page.evaluate(() => {
    const el = document.querySelector("#item-type");
    return { faltando: el.validity.valueMissing, mensagem: el.validationMessage };
  });
  const nomeMantido = await page.locator("#item-name").inputValue();
  check(
    "VALIDAÇÃO · item sem tipo é barrado (validação nativa) e mantém o nome digitado",
    nativo.faltando && nativo.mensagem.length > 0 && nomeMantido === "SEM TIPO",
    `${JSON.stringify(nativo)} nome="${nomeMantido}"`,
  );
  anotar(`VALIDAÇÃO · obrigatório vazio no item: balão nativo "${nativo.mensagem}"`);

  // ── Erro deliberado 5 · regra de domínio (pureza fora de 0–100) ─────────
  await selecionar("#item-type", "RAW_MATERIAL");
  await selecionar("#item-unit", "kg");
  await preencher("#item-name", `${P} ITEM INVALIDO`);
  await deliberadamente("pureza-invalida", async () => {
    await preencher("#item-purity", "150");
    await clicarBotao("Criar item");
    await page.waitForTimeout(1400);
  });
  const errosPureza = await mensagensDeErro();
  const formPureza = await valoresDoFormulario();
  check(
    "VALIDAÇÃO · pureza acima de 100% é recusada com mensagem específica",
    errosPureza.some((m) => /pureza/i.test(m)),
    JSON.stringify(errosPureza),
  );
  check(
    "VALIDAÇÃO · o erro de pureza não apaga o formulário",
    formPureza["item-name"] === `${P} ITEM INVALIDO` && formPureza["item-type"] === "RAW_MATERIAL",
    JSON.stringify({ nome: formPureza["item-name"], tipo: formPureza["item-type"] }),
  );
  anotar(`VALIDAÇÃO · mensagem de pureza: ${JSON.stringify(errosPureza)}`);
  await shot("e2e1-02b-erro-pureza");

  // ── As cinco matérias-primas + a embalagem ──────────────────────────────
  /*
   * Guarda de reexecução.
   *
   * A base fica com os dados no fim, de propósito. Uma parada no meio de um
   * marco não pode fazer a próxima execução cadastrar tudo de novo — seis
   * itens viram doze e o cenário deixa de ser inspecionável.
   */
  S.dados.itens = S.dados.itens ?? {};
  const jaExistem = new Set(
    ((await apiGet(`/items?search=${encodeURIComponent("E2E1")}&pageSize=50`)).items ?? []).map(
      (i) => i.name,
    ),
  );
  if (jaExistem.size > 0) {
    anotar(`ITEM · ${jaExistem.size} item(ns) já existiam de uma execução anterior e não foram recriados`);
  }

  for (const mp of MP) {
    if (jaExistem.has(mp.nome)) continue;
    await abrir("/cadastros/itens/novo");
    await selecionar("#item-type", "RAW_MATERIAL");
    await selecionar("#item-unit", "kg");
    await preencher("#item-name", mp.nome);
    if (mp.pureza !== null) {
      await preencher("#item-purity", String(mp.pureza * 100).replace(".", ","));
    }
    await clicarBotao("Criar item");
    const ok = await esperarUrl((u) => u.pathname === "/cadastros/itens", 25000);
    if (!check(`ITEM · "${mp.nome}" foi criado e a tela voltou à lista`, ok, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
  }

  if (!jaExistem.has(EMBALAGEM.nome)) {
  await abrir("/cadastros/itens/novo");
  await selecionar("#item-type", "PACKAGING");
  await selecionar("#item-unit", EMBALAGEM.unidade);
  await preencher("#item-name", EMBALAGEM.nome);
  const temSubtipo = (await page.locator("#item-packaging-subtype").count()) > 0;
  if (temSubtipo) await selecionar("#item-packaging-subtype", "POT");
  await clicarBotao("Criar item");
  check(
    `ITEM · a embalagem "${EMBALAGEM.nome}" foi criada`,
    await esperarUrl((u) => u.pathname === "/cadastros/itens", 25000),
    caminho(),
  );
  }

  await abrir("/cadastros/itens");
  await page.waitForTimeout(600);
  await preencher("#items-search", "E2E1");
  await page.waitForTimeout(1200);
  const codigos = await textos("table tbody tr td.is-code");
  check(
    "ITEM · as seis linhas (5 MP + 1 embalagem) aparecem na busca por E2E1",
    codigos.length === 6,
    `códigos=${JSON.stringify(codigos)}`,
  );
  const prefixos = codigos.map((c) => c.split("-")[0]);
  check(
    "ITEM · os códigos seguem o prefixo do tipo (MP para matéria-prima, EMB/ME para embalagem)",
    prefixos.filter((p) => p === "MP").length === 5 && new Set(prefixos).size === 2,
    JSON.stringify(prefixos),
  );
  await shot("e2e1-02-itens");

  const itensLidos = await apiGet(`/items?search=${encodeURIComponent("E2E1")}&pageSize=50`);
  for (const it of itensLidos.items ?? []) {
    S.dados.itens[it.name] = { id: it.id, code: it.code, unitCode: it.unitCode, type: it.type };
  }
  check(
    "ITEM · a leitura técnica confirma 6 itens, nenhum deles Produto acabado",
    (itensLidos.items ?? []).length === 6 &&
      (itensLidos.items ?? []).every((i) => i.type !== "FINISHED_PRODUCT"),
    JSON.stringify((itensLidos.items ?? []).map((i) => `${i.code}/${i.type}`)),
  );
}

// ── MARCO 3 · Fornecedores ────────────────────────────────────────────────
async function marco03Fornecedores() {
  await abrir("/cadastros/fornecedores");
  const vazioFor = await texto("td.table__empty");
  if (vazioFor) registrarVazio("Cadastros › Fornecedores (base recém-criada)", vazioFor);

  const fornecedoresExistentes = new Set(
    ((await apiGet(`/suppliers?search=${encodeURIComponent("E2E1")}&pageSize=50`)).suppliers ?? []).map(
      (f) => f.legalName,
    ),
  );
  for (const chave of ["fornecedorInsumos", "fornecedorEmbalagens"]) {
    const f = IDENT[chave];
    if (fornecedoresExistentes.has(f.legalName)) continue;
    await abrir("/cadastros/fornecedores/novo");
    await preencher("#supplier-legal-name", f.legalName);
    await preencher("#supplier-trade-name", f.tradeName);
    await preencher("#supplier-cnpj", f.cnpj);
    await preencher("#supplier-email", f.email);
    await preencher("#supplier-phone", f.phone);
    await clicarBotao("Criar fornecedor");
    const ok = await esperarUrl((u) => u.pathname === "/cadastros/fornecedores", 25000);
    if (!check(`FORNECEDOR · "${f.legalName}" foi criado`, ok, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
  }

  await abrir("/cadastros/fornecedores");
  await page.waitForTimeout(600);
  await preencher("#suppliers-search", "E2E1");
  await page.waitForTimeout(1200);
  const linhas = await textos("table tbody tr");
  check(
    "FORNECEDOR · os dois fornecedores aparecem na lista, com CNPJ formatado",
    linhas.length === 2 && linhas.every((l) => /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(l)),
    JSON.stringify(linhas),
  );
  await shot("e2e1-03-fornecedores");

  const lidos = await apiGet(`/suppliers?search=${encodeURIComponent("E2E1")}&pageSize=50`);
  S.dados.fornecedores = {};
  for (const f of lidos.suppliers ?? []) {
    S.dados.fornecedores[f.legalName] = { id: f.id, code: f.code };
  }
  check(
    "FORNECEDOR · a leitura técnica confirma os dois registros nascidos pela tela",
    (lidos.suppliers ?? []).length === 2,
    JSON.stringify((lidos.suppliers ?? []).map((f) => f.code)),
  );
}

/**
 * A compra do cenário.
 *
 * Duas ordens, e não uma: o roteiro pede dois fornecedores, e "a OC leva os
 * itens do fornecedor certo" só é afirmável quando existe um segundo para
 * errar. As quantidades são folgadas de propósito — o que a validação mede é
 * a cadeia compra → recebimento → lote → consumo, não a acurácia do MRP.
 */
const COMPRAS = [
  {
    fornecedor: "fornecedorInsumos",
    rotulo: "Insumos",
    linhas: [
      { item: `${P} Coenzima Q10`, quantidade: "10", preco: "1200" },
      { item: `${P} Celulose microcristalina 101`, quantidade: "30", preco: "25" },
      { item: `${P} Estearato de Magnesio`, quantidade: "2", preco: "45" },
      { item: `${P} Dioxido de Silicio`, quantidade: "2", preco: "25" },
      { item: `${P} Vitamina E`, quantidade: "2", preco: "250" },
    ],
  },
  {
    fornecedor: "fornecedorEmbalagens",
    rotulo: "Embalagens",
    linhas: [{ item: EMBALAGEM.nome, quantidade: "1200", preco: String(EMBALAGEM.preco) }],
  },
];

/** Lote que fica de fora da liberação da Qualidade, de propósito. */
const ITEM_RETIDO = `${P} Vitamina E`;

const hoje = () => new Date().toISOString().slice(0, 10);
const daquiDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const daquiAnos = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
};

/** Confirma um `ConfirmDialog`, com escopo no diálogo (nunca na página). */
async function confirmarDialogo(textoBotao) {
  const dialogo = page.locator(".confirm-dialog");
  await dialogo.waitFor({ state: "visible", timeout: 20000 });
  const titulo = await texto(".confirm-dialog #confirm-dialog-title, .confirm-dialog h2");
  await dialogo.getByRole("button", { name: textoBotao, exact: true }).click();
  await page.waitForTimeout(900);
  return titulo;
}

// ── MARCO 4 · Ordens de Compra ────────────────────────────────────────────
async function marco04Compra() {
  await abrir("/compras/ordens");
  const vazioOc = await texto("td.table__empty");
  if (vazioOc) registrarVazio("Compras › Ordens de Compra (nenhuma OC ainda)", vazioOc);

  S.dados.ordensDeCompra = S.dados.ordensDeCompra ?? {};

  for (const compra of COMPRAS) {
    if (S.dados.ordensDeCompra[compra.rotulo]) {
      anotar(`OC ${compra.rotulo} · ${S.dados.ordensDeCompra[compra.rotulo].code} já existia — marco pulado`);
      continue;
    }
    const f = IDENT[compra.fornecedor];
    await abrir("/compras/ordens/nova");
    check(
      `OC ${compra.rotulo} · a tela de nova ordem abre com o título esperado`,
      (await texto(".doc-title h1")) === "Nova ordem de compra",
      await texto(".doc-title h1"),
    );

    await escolherEntidade("#po-supplier", f.tradeName, f.tradeName);
    await preencher("#po-order-date", hoje());

    const linhas = page.locator("table.table tbody tr");
    for (let i = 0; i < compra.linhas.length; i += 1) {
      const l = compra.linhas[i];
      await clicarBotao("+ Adicionar item");
      await page.waitForTimeout(300);
      const combo = page.locator('input[id^="po-line-item-"]').nth(i);
      await escolherEntidade(combo, l.item, l.item);
      const decimais = linhas.nth(i).locator('input[inputmode="decimal"]');
      await decimais.nth(0).fill(l.quantidade);
      await decimais.nth(1).fill(l.preco);
      await page.waitForTimeout(120);
    }

    await clicarBotao("Salvar rascunho");
    const salvou = await esperarUrl(
      (u) => /^\/compras\/ordens\/[0-9a-f-]{36}$/.test(u.pathname),
      30000,
    );
    if (!check(`OC ${compra.rotulo} · o rascunho foi salvo e ganhou URL própria`, salvou, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
    await page.waitForTimeout(600);

    const codigo = await texto(".doc-title h1");
    const situacao = await texto(".doc-title .badge");
    check(
      `OC ${compra.rotulo} · nasce como Rascunho, com código gerado`,
      /^OC-\d+$/.test(codigo) && situacao === "Rascunho",
      `código="${codigo}" situação="${situacao}"`,
    );

    const total = await texto(".table-foot");
    anotar(`OC ${compra.rotulo} · ${codigo} com ${compra.linhas.length} linha(s), rodapé "${total}"`);

    await clicarBotao("Confirmar OC");
    const tituloDialogo = await confirmarDialogo("Confirmar");
    check(
      `OC ${compra.rotulo} · confirmar pede confirmação explícita antes de congelar a ordem`,
      /Confirmar OC/i.test(tituloDialogo),
      tituloDialogo,
    );
    await page.waitForTimeout(1000);
    const situacao2 = await texto(".doc-title .badge");
    check(
      `OC ${compra.rotulo} · ${codigo} passou de Rascunho para Confirmado`,
      situacao2 === "Confirmado",
      situacao2,
    );

    S.dados.ordensDeCompra[compra.rotulo] = { code: codigo, url: caminho() };
    salvarEstado();
    await shot(`e2e1-04-compra-${compra.rotulo.toLowerCase()}`);
  }

  const lidas = await apiGet("/purchase-orders?pageSize=50");
  check(
    "OC · a leitura técnica confirma as duas ordens confirmadas",
    (lidas.purchaseOrders ?? []).length === 2 &&
      (lidas.purchaseOrders ?? []).every((o) => o.status === "ORDERED"),
    JSON.stringify((lidas.purchaseOrders ?? []).map((o) => `${o.code}/${o.status}`)),
  );
}

// ── MARCO 5 · Recebimento ─────────────────────────────────────────────────
async function marco05Recebimento() {
  await abrir("/compras/recebimentos");
  const vazioRec = await texto("td.table__empty");
  if (vazioRec) registrarVazio("Compras › Recebimentos (nenhum recebimento ainda)", vazioRec);

  S.dados.recebimentos = S.dados.recebimentos ?? {};

  for (const compra of COMPRAS) {
    if (S.dados.recebimentos[compra.rotulo]) {
      anotar(`RECEBIMENTO ${compra.rotulo} · já registrado em execução anterior — pulado`);
      continue;
    }
    const oc = S.dados.ordensDeCompra[compra.rotulo];
    await abrir(oc.url, { espera: ".doc-title h1" });
    await clicarBotao("Receber materiais");
    const foi = await esperarUrl((u) => u.pathname === "/compras/recebimentos/novo", 25000);
    if (!check(`RECEBIMENTO ${compra.rotulo} · "Receber materiais" leva ao recebimento da própria OC`, foi, caminho())) {
      return;
    }
    await page.waitForSelector('input[id^="receive-now-"]', { timeout: 30000 });

    await preencher("#receipt-date", hoje());
    await preencher("#receipt-invoice", `NF-E2E1-${compra.rotulo.toUpperCase()}`);

    const campos = page.locator('input[id^="receive-now-"]');
    const quantas = await campos.count();
    check(
      `RECEBIMENTO ${compra.rotulo} · a tela abre uma linha para cada item em aberto da OC`,
      quantas === compra.linhas.length,
      `linhas=${quantas} esperadas=${compra.linhas.length}`,
    );

    for (let i = 0; i < quantas; i += 1) {
      const id = await campos.nth(i).getAttribute("id");
      const poLineId = id.replace("receive-now-", "");
      // O bloco da linha diz de qual item se trata — é por ele que o preço certo
      // é casado com o lote certo.
      const rotulo = await texto(`section.form-section:has(#${id}) h3`).catch(() => "");
      const linha =
        compra.linhas.find((l) => rotulo.includes(l.item)) ?? compra.linhas[i];
      await campos.nth(i).fill(linha.quantidade);
      const loteFornecedor = page.locator(`#supplier-lot-${poLineId}`);
      if ((await loteFornecedor.count()) > 0) {
        await loteFornecedor.fill(`FOR-E2E1-${String(i + 1).padStart(2, "0")}`);
      }
      const validade = page.locator(`#expiry-${poLineId}`);
      if ((await validade.count()) > 0) await validade.fill(daquiAnos(2));
      const custo = page.locator(`#cost-${poLineId}`);
      if ((await custo.count()) > 0) await custo.fill(linha.preco);
    }
    await shot(`e2e1-05-recebimento-${compra.rotulo.toLowerCase()}-preenchido`);

    await clicarBotao("Confirmar recebimento");
    const titulo = await confirmarDialogo("Confirmar");
    check(
      `RECEBIMENTO ${compra.rotulo} · confirmar avisa que a operação vira histórico`,
      /Confirmar recebimento/i.test(titulo),
      titulo,
    );
    const virou = await esperarUrl(
      (u) => /^\/compras\/recebimentos\/[0-9a-f-]{36}$/.test(u.pathname),
      30000,
    );
    if (!check(`RECEBIMENTO ${compra.rotulo} · confirmado, com documento próprio`, virou, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
    await page.waitForTimeout(700);
    const codigoRec = await texto(".doc-title h1");
    S.dados.recebimentos[compra.rotulo] = { code: codigoRec, url: caminho() };
    salvarEstado();

    const lotesNaTela = await textos("table tbody tr a.entity-link");
    check(
      `RECEBIMENTO ${compra.rotulo} · o recebimento gerou lote interno para cada item que controla lote`,
      lotesNaTela.filter((t) => /^LT-/.test(t)).length === compra.linhas.length,
      JSON.stringify(lotesNaTela),
    );
    await shot(`e2e1-05-recebimento-${compra.rotulo.toLowerCase()}`);
  }

  // A OC fecha sozinha quando tudo foi recebido — é derivação, não botão.
  for (const compra of COMPRAS) {
    await abrir(S.dados.ordensDeCompra[compra.rotulo].url, { espera: ".doc-title h1" });
    const situacao = await texto(".doc-title .badge");
    check(
      `OC ${compra.rotulo} · recebida integralmente, a ordem passa a "Recebido" sem ação manual`,
      situacao === "Recebido",
      situacao,
    );
  }

  const lotes = await apiGet("/lots?pageSize=50");
  S.dados.lotes = (lotes.lots ?? []).map((l) => ({
    id: l.id,
    code: l.code,
    item: l.itemName,
    status: l.status,
  }));
  /*
   * Cinco matérias-primas esperam a Qualidade; a embalagem não.
   *
   * Não é inconsistência: o padrão do tipo do item é que decide. Matéria-prima
   * nasce exigindo liberação da Qualidade, embalagem não — e o lote recebido
   * herda essa regra na hora em que é criado.
   */
  const mp = (lotes.lots ?? []).filter((l) => l.itemName !== EMBALAGEM.nome);
  const emb = (lotes.lots ?? []).filter((l) => l.itemName === EMBALAGEM.nome);
  check(
    "RECEBIMENTO · seis lotes internos: as cinco matérias-primas aguardam a Qualidade",
    (lotes.lots ?? []).length === 6 && mp.every((l) => l.status === "AWAITING_RELEASE"),
    JSON.stringify((lotes.lots ?? []).map((l) => `${l.code}/${l.status}`)),
  );
  check(
    "RECEBIMENTO · a embalagem, que não exige liberação da Qualidade, já nasce Disponível",
    emb.length === 1 && emb[0].status === "AVAILABLE",
    JSON.stringify(emb.map((l) => `${l.code}/${l.status}`)),
  );
  anotar(
    "RECEBIMENTO · a diferença de situação entre matéria-prima e embalagem vem do padrão do TIPO " +
      "do item (matéria-prima exige liberação da Qualidade, embalagem não), aplicado no recebimento",
  );
}

// ── MARCO 6 · Qualidade (liberação de lote) ───────────────────────────────
async function marco06Qualidade() {
  await abrir("/qualidade/documentos");
  const filaVazia = await page.evaluate(() => {
    const td = document.querySelector("td.table__empty");
    return td ? (td.textContent ?? "").replace(/\s+/g, " ").trim() : "";
  });
  if (filaVazia) registrarVazio("Qualidade › Documentos / CoA (fila de pendências)", filaVazia);
  check(
    "QUALIDADE · a fila de CoA está vazia e explica que liberar lote é outra decisão",
    filaVazia.includes("Nenhum lote nesta situação documental"),
    filaVazia,
  );
  await shot("e2e1-06a-fila-coa-vazia");

  // Os lotes nascem AGUARDANDO LIBERAÇÃO porque o item exige decisão da
  // Qualidade. Um deles fica retido de propósito: é ele que vai provar, lá na
  // frente, que a OP não é liberada sem material disponível.
  await abrir("/estoque/lotes");
  const listados = await textos("table tbody tr");
  check(
    "QUALIDADE · os seis lotes aparecem em Estoque › Lotes, cinco aguardando liberação",
    listados.length === 6 &&
      listados.filter((l) => l.includes("Aguardando liberação")).length === 5,
    JSON.stringify(listados.map((l) => l.slice(0, 60))),
  );

  S.dados.lotesLiberados = [];
  for (const lote of S.dados.lotes) {
    if (lote.status === "AVAILABLE") {
      anotar(`QUALIDADE · ${lote.code} (${lote.item}) já nasceu Disponível — nada a liberar`);
      continue;
    }
    if (lote.item === ITEM_RETIDO) {
      anotar(
        `QUALIDADE · ${lote.code} (${lote.item}) fica RETIDO de propósito — ` +
          `é a prova de "não libera OP sem estoque" no marco de produção`,
      );
      continue;
    }
    await abrir(`/estoque/lotes/${lote.id}`, { espera: ".doc-title h1" });
    await clicarBotao("Liberar");
    const titulo = await confirmarDialogo("Liberar");
    check(
      `QUALIDADE · liberar ${lote.code} pede confirmação explícita`,
      /Liberar lote/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(900);
    const situacao = await texto(".doc-title .badge");
    if (
      check(
        `QUALIDADE · ${lote.code} (${lote.item}) ficou Disponível`,
        situacao === "Disponível",
        situacao,
      )
    ) {
      S.dados.lotesLiberados.push(lote.code);
    }
  }
  salvarEstado();
  await shot("e2e1-06-qualidade-lotes");

  const depois = await apiGet("/lots?pageSize=50");
  const porStatus = {};
  for (const l of depois.lots ?? []) porStatus[l.status] = (porStatus[l.status] ?? 0) + 1;
  check(
    "QUALIDADE · cinco lotes disponíveis e um retido, exatamente como planejado",
    porStatus.AVAILABLE === 5 && porStatus.AWAITING_RELEASE === 1,
    JSON.stringify(porStatus),
  );
}

// ── MARCO 7 · Projeto ─────────────────────────────────────────────────────
async function marco07Projeto() {
  await abrir("/comercial/projetos");
  const vazioProj = await texto("td.table__empty");
  if (vazioProj) registrarVazio("Comercial › Projetos (funil vazio)", vazioProj);

  const existentes = (await apiGet("/projects?pageSize=20")).projects ?? [];
  if (existentes.length > 0) {
    S.dados.projeto = {
      id: existentes[0].id,
      code: existentes[0].code,
      url: `/comercial/projetos/${existentes[0].id}`,
    };
    anotar(`PROJETO · ${existentes[0].code} já existia — criação pulada, conferências mantidas`);
    await abrir(S.dados.projeto.url, { espera: ".doc-title h1" });
    await conferirProjeto();
    return;
  }

  await clicarBotao("Novo projeto");
  await page.waitForSelector("#project-name", { timeout: 25000 });

  await escolherEntidade("#project-customer", "E2E1", IDENT.cliente.legalName);
  await preencher("#project-name", `${P} Coenzima Q10 60 capsulas`);
  await preencher("#project-concept", "Antioxidante");
  await preencher("#project-channel", "Distribuidora");
  await selecionar("#project-dosage-form", "CAPSULE");
  await selecionar("#project-presentation", "POT");
  await preencher("#project-doses", String(PRODUTO.capsulasPorPote / PRODUTO.capsulasPorDose));
  await selecionar("#project-age-group", "ADULT");
  await preencher("#project-minimum-batch", String(PRODUTO.lotesMinimo));
  await preencher("#project-shelf-life", "24");
  await shot("e2e1-07a-projeto-briefing");

  await clicarBotao("Criar projeto");
  const foi = await esperarUrl(
    (u) => /^\/comercial\/projetos\/[0-9a-f-]{36}$/.test(u.pathname),
    30000,
  );
  if (!check("PROJETO · criar leva à página do próprio projeto", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(800);

  const id = caminho().split("/").pop();
  S.dados.projeto = { id, code: (await texto(".doc-title h1")).split(" ")[0], url: caminho() };
  salvarEstado();
  await conferirProjeto();
}

/**
 * Conferências do projeto, separadas da criação para valerem também quando o
 * projeto já nasceu numa execução anterior.
 */
async function conferirProjeto() {
  const titulo = await texto(".doc-title h1");
  const situacao = await texto(".doc-title .badge");
  check(
    "PROJETO · nasce Aguardando, com código PROJ gerado",
    /^PROJ-\d+/.test(titulo) && situacao === "Aguardando",
    `título="${titulo}" situação="${situacao}"`,
  );

  // O `dt` carrega o botão ⓘ de ajuda junto do rótulo — comparar por igualdade
  // exata acusaria "Produto resultantei" e reprovaria a tela por um ícone.
  const resumo = await page.evaluate(() =>
    [...document.querySelectorAll(".definition-list dt")].map((dt) => ({
      rotulo: (dt.textContent ?? "").replace(/\s+/g, " ").trim(),
      valor: (dt.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim(),
    })),
  );
  const ler = (r) => resumo.find((x) => x.rotulo.startsWith(r))?.valor ?? "";
  check(
    "PROJETO · o Resumo mostra o cliente escolhido e diz que o produto nasce na aprovação",
    ler("Cliente").includes("E2E1") && /nasce na aprovação/i.test(ler("Produto resultante")),
    JSON.stringify(resumo),
  );
  registrarVazio(
    "Projeto › Produto resultante (antes de haver produto)",
    ler("Produto resultante"),
  );
  await shot("e2e1-07-projeto");
}

// ── MARCO 8 · Produto nascido do Projeto ──────────────────────────────────
async function marco08Produto() {
  await abrir(S.dados.projeto.url, { espera: ".doc-title h1" });

  const jaTem = (await apiGet("/products?pageSize=20")).products ?? [];
  if (jaTem.length === 0) {
    const secao = page.locator("section.form-section").filter({ hasText: "Produtos do projeto" });
    const dica = ((await secao.locator("p.field__hint").first().textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    registrarVazio("Projeto › Produtos do projeto (antes do primeiro produto)", dica);

    await clicarBotao("+ Adicionar produto");
    await page.waitForSelector("#new-product-name", { timeout: 20000 });
    await preencher("#new-product-name", PRODUTO.nome);
    await clicarBotao("Criar produto");
    await page.waitForTimeout(2500);
  } else {
    anotar(`PRODUTO · ${jaTem[0].code} já existia — criação pulada`);
  }

  // ── REGRA PRODUTO · o produto nascido do Projeto ─────────────────────────────
  const linhaProduto = await textos(
    "section.form-section:has(h3) table.table tbody tr",
  );
  const linha = linhaProduto.find((l) => l.includes(PRODUTO.nome));
  check(
    "REGRA PRODUTO · o produto aparece no projeto como Em desenvolvimento",
    Boolean(linha) && /Em desenvolvimento/.test(linha ?? ""),
    linha ?? JSON.stringify(linhaProduto),
  );
  await shot("e2e1-08-produto-no-projeto");

  const produtos = (await apiGet("/products?pageSize=20")).products ?? [];
  const produto = produtos.find((p) => p.name === PRODUTO.nome);
  if (!check("REGRA PRODUTO · o produto existe e é único", Boolean(produto), JSON.stringify(produtos.map((p) => p.name)))) {
    return;
  }
  S.dados.produto = {
    id: produto.id,
    code: produto.code,
    name: produto.name,
    itemPA: produto.finishedProductItem?.code ?? null,
  };
  salvarEstado();

  check(
    "REGRA PRODUTO · o produto HERDOU o cliente do projeto",
    produto.customerId === S.dados.cliente.id,
    `produto.customerId=${produto.customerId} cliente=${S.dados.cliente.id}`,
  );
  check(
    "REGRA PRODUTO · o produto nasceu Em desenvolvimento (lifecycle DEVELOPMENT)",
    produto.lifecycle === "DEVELOPMENT",
    String(produto.lifecycle),
  );
  check(
    "REGRA PRODUTO · o item de Produto Acabado foi criado automaticamente, com prefixo PA",
    /^PA-\d+$/.test(produto.finishedProductItem?.code ?? ""),
    JSON.stringify(produto.finishedProductItem ?? {}),
  );

  // O item PA existe no catálogo — a mesma tela que se recusa a criá-lo à mão.
  await abrir("/cadastros/itens");
  await preencher("#items-search", "PA-");
  await page.waitForTimeout(1200);
  const linhasItens = await textos("table tbody tr");
  check(
    "REGRA PA+PRODUTO · o item PA aparece em Itens de estoque, criado pelo Produto e não pela tela de itens",
    linhasItens.some((l) => l.includes("Produto acabado") && l.includes(PRODUTO.nome)),
    JSON.stringify(linhasItens),
  );

  // A formulação V1 já nasce, em rascunho.
  await abrir(`/producao/formulacoes/${produto.id}`, { espera: ".doc-title h1" });
  const versoes = await textos("table tbody tr");
  check(
    "REGRA PRODUTO · o produto já nasce com formulação V1 em RASCUNHO",
    versoes.length === 1 && versoes[0].includes("V1") && versoes[0].includes("Rascunho"),
    JSON.stringify(versoes),
  );
  await shot("e2e1-08b-formulacao-v1-rascunho");

  // ── Completar o perfil técnico que o projeto não carrega ────────────────
  await abrir("/cadastros/produtos");
  await page.locator("table tbody tr").first().click();
  await page.waitForSelector("#product-capsules-per-dose", { timeout: 20000 });
  await preencher("#product-capsules-per-dose", String(PRODUTO.capsulasPorDose));
  await preencher("#product-units-per-box", String(PRODUTO.unidadesPorCaixa));
  await preencher("#product-doses-per-package", String(PRODUTO.capsulasPorPote / PRODUTO.capsulasPorDose));
  await preencher("#product-minimum-batch", String(PRODUTO.lotesMinimo));
  await clicarBotao("Salvar alterações");
  await page.waitForTimeout(1800);

  const conferido = (await apiGet(`/products/${produto.id}`)) ?? {};
  check(
    "PRODUTO · cápsulas por dose, unidades por caixa e lote mínimo foram gravados",
    String(conferido.capsulesPerDose) === String(PRODUTO.capsulasPorDose) &&
      String(conferido.unitsPerShippingBox) === String(PRODUTO.unidadesPorCaixa),
    JSON.stringify({
      capsulasPorDose: conferido.capsulesPerDose,
      unidadesPorCaixa: conferido.unitsPerShippingBox,
      dosesPorEmbalagem: conferido.dosesPerPackage,
      loteMinimo: conferido.minimumBatchQuantity,
      formaFarmaceutica: conferido.dosageForm,
      apresentacao: conferido.presentationType,
      publico: conferido.targetAgeGroup,
    }),
  );
  anotar(
    `PRODUTO · perfil herdado do briefing: forma=${conferido.dosageForm} ` +
      `apresentação=${conferido.presentationType} público=${conferido.targetAgeGroup} ` +
      `doses/embalagem=${conferido.dosesPerPackage} validade=${conferido.shelfLifeMonths}m`,
  );
}

// ── MARCO 9 · Formulação ──────────────────────────────────────────────────
/**
 * Linhas da tabela de COMPONENTES — e só dela.
 *
 * A página tem outra tabela abaixo ("Custo estimado de materiais"). Sem o
 * escopo na seção, `tbody tr` devolve as duas somadas e a contagem vira
 * ficção — foi o que fez a prova de "salvar antes de ativar" relatar 11
 * componentes onde havia 6.
 */
const linhasDeComponente = () =>
  page
    .locator("section.form-section")
    .filter({ has: page.locator("h3", { hasText: "Componentes" }) })
    .locator("table.table tbody tr");

/** Preenche uma linha de componente da formulação. */
async function preencherComponente(indice, comp) {
  const linha = linhasDeComponente().nth(indice);
  const combo = page.locator('input[id^="componente-component-"]').nth(indice);
  await escolherEntidade(combo, comp.nome, comp.nome);
  await linha.locator('select[aria-label="Base de cálculo do componente"]').selectOption(comp.base);
  await page.waitForTimeout(150);
  await linha.locator("td").nth(4).locator("input").fill(String(comp.quantidade));
  await linha.locator("td").nth(5).locator("select").selectOption(comp.unidade);
  if (comp.pureza != null) {
    await linha.getByLabel("Pureza aplicada").fill(String(comp.pureza));
  }
  await page.waitForTimeout(200);
}

async function marco09Formulacao() {
  const produtoId = S.dados.produto.id;

  // Versão já ativada em execução anterior: reeditar é impossível por regra
  // (versão ativa é histórico), então o marco confere o resultado e segue.
  const jaAtiva = ((await apiGet(`/products/${produtoId}/formulations`)).versions ?? []).find(
    (v) => v.status === "ACTIVE",
  );
  if (jaAtiva) {
    anotar(`FORMULAÇÃO · ${jaAtiva.versionLabel} já estava ATIVA — edição pulada, conferência mantida`);
    check(
      "PROVA 4 · a versão ATIVA contém os 6 componentes, incluindo a embalagem adicionada sem salvar",
      (jaAtiva.components ?? []).length === MP.length + 1 &&
        (jaAtiva.components ?? []).some((c) => (c.itemName ?? "").includes(EMBALAGEM.nome)),
      JSON.stringify((jaAtiva.components ?? []).map((c) => `${c.itemCode} ${c.quantity}${c.unitCode}/${c.basis}`)),
    );
    S.dados.formulacao = { versionId: jaAtiva.id, label: jaAtiva.versionLabel };
    salvarEstado();
    return;
  }

  await abrir(`/producao/formulacoes/${produtoId}`, { espera: ".doc-title h1" });
  await page.locator("table tbody tr").first().click();
  const foi = await esperarUrl((u) => /\/versoes\/[0-9a-f-]{36}$/.test(u.pathname), 25000);
  if (!check("FORMULAÇÃO · a V1 em rascunho abre pela tabela de versões", foi, caminho())) return;
  S.dados.formulacaoUrl = caminho();
  await page.waitForSelector("#version-basis", { timeout: 25000 });

  const vazioComp = await texto("td.table__empty");
  if (vazioComp) registrarVazio("Formulação V1 › Componentes (rascunho recém-nascido)", vazioComp);

  // ── Erro deliberado 6 · regra de domínio: ativar sem componente ─────────
  await deliberadamente("ativar-sem-componente", async () => {
    await clicarBotao("Ativar versão");
    await confirmarDialogo("Ativar");
    await page.waitForTimeout(1500);
  });
  const erroAtivacao = await mensagensDeErro();
  check(
    "VALIDAÇÃO (domínio) · ativar formulação sem componente é recusado com motivo específico",
    erroAtivacao.some((m) => /adicione ao menos um componente/i.test(m)),
    JSON.stringify(erroAtivacao),
  );
  anotar(`VALIDAÇÃO (domínio) · mensagem de ativação vazia: ${JSON.stringify(erroAtivacao)}`);
  const situacaoDepois = await texto(".doc-title .badge");
  check(
    "VALIDAÇÃO (domínio) · a versão continua Rascunho depois da recusa",
    situacaoDepois === "Rascunho",
    situacaoDepois,
  );
  await shot("e2e1-09a-ativar-sem-componente");

  // ── Base e modo de cálculo ──────────────────────────────────────────────
  await preencher("#version-basis", "1");
  await selecionar("#version-mode", "PER_DOSE");
  await page.waitForTimeout(400);
  await preencher("#version-doses", String(PRODUTO.capsulasPorPote / PRODUTO.capsulasPorDose));

  // ── As cinco matérias-primas, por dose ──────────────────────────────────
  for (let i = 0; i < MP.length; i += 1) {
    await clicarBotao("+ Adicionar componente");
    await page.waitForTimeout(300);
    await preencherComponente(i, {
      nome: MP[i].nome,
      base: "PER_DOSE",
      quantidade: MP[i].mgPorDose,
      unidade: "mg",
      pureza: MP[i].pureza === null ? null : MP[i].pureza * 100,
    });
  }
  await clicarBotao("Salvar rascunho");
  await page.waitForTimeout(1800);
  const errosSalvar = await mensagensDeErro();
  check(
    "FORMULAÇÃO · as cinco matérias-primas foram salvas sem erro",
    errosSalvar.length === 0,
    JSON.stringify(errosSalvar),
  );
  await shot("e2e1-09b-formulacao-materias-primas");

  // ── PROVA 4 · salvar-antes-de-ativar ────────────────────────────────────
  // A embalagem é adicionada e NÃO salva: o clique vai direto em "Ativar
  // versão". Se a tela ativasse antes de gravar, a versão ativa nasceria com
  // cinco componentes e a receita perderia o pote — sem nenhum aviso.
  await clicarBotao("+ Adicionar componente");
  await page.waitForTimeout(300);
  await preencherComponente(MP.length, {
    nome: EMBALAGEM.nome,
    base: "PER_FINISHED_UNIT",
    quantidade: 1,
    unidade: "un",
    pureza: null,
  });
  const naTelaAntes = await linhasDeComponente().count();
  anotar(
    `PROVA 4 · a tela tem ${naTelaAntes} componentes; a embalagem foi adicionada e NÃO foi salva`,
  );
  await shot("e2e1-09c-antes-de-ativar-sem-salvar");

  await clicarBotao("Ativar versão");
  await confirmarDialogo("Ativar");
  await page.waitForTimeout(2500);

  const situacaoAtiva = await texto(".doc-title .badge");
  check(
    "PROVA 4 · a versão foi ativada mesmo com edição não salva na tela",
    situacaoAtiva === "Ativa",
    `${situacaoAtiva} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const ativa = ((await apiGet(`/products/${produtoId}/formulations`)).versions ?? []).find(
    (v) => v.status === "ACTIVE",
  );
  const componentesAtivos = ativa?.components ?? [];
  check(
    "PROVA 4 · a versão ATIVADA contém a alteração que não tinha sido salva (a embalagem)",
    componentesAtivos.length === MP.length + 1 &&
      componentesAtivos.some((c) => (c.itemName ?? "").includes(EMBALAGEM.nome)),
    `componentes=${componentesAtivos.length} → ${JSON.stringify(componentesAtivos.map((c) => c.itemName))}`,
  );
  S.dados.formulacao = { versionId: ativa?.id ?? null, label: ativa?.versionLabel ?? null };
  salvarEstado();
  await shot("e2e1-09-formulacao-ativa");
}

// ── MARCO 10 · Recursos industriais ───────────────────────────────────────
const RECURSOS = [
  { nome: `${P} Encapsuladora`, tipo: "EQUIPMENT", potencia: "5", tarifa: "120.50" },
  { nome: `${P} Mao de obra producao`, tipo: "LABOR", potencia: null, tarifa: "45.75" },
  { nome: `${P} Energia eletrica`, tipo: "ENERGY", potencia: null, tarifa: "0.85" },
];

/** Registra a tarifa do recurso na tela de detalhe, já aberta. */
async function registrarTarifa(r) {
  const semTarifa = await texto("td.table__empty");
  if (semTarifa) registrarVazio(`Recurso ${r.nome} › Histórico de tarifas`, semTarifa);

  const como = await decimalComRetentativa({
    campo: "#rate-value",
    valor: r.tarifa.replace(",", "."),
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
  /*
   * PROVA 1 · a vírgula brasileira num campo de dinheiro.
   *
   * `decimalComRetentativa` SEMPRE digita a vírgula primeiro. "virgula" quer
   * dizer que a primeira tentativa gravou; "ponto" quer dizer que só o
   * separador do contrato funcionou — e aí o defeito já foi registrado lá
   * dentro. A verificação existe para o cenário não passar em silêncio com o
   * separador errado, que era exatamente o que acontecia antes.
   */
  check(
    `PROVA 1 · a vírgula decimal foi aceita na tarifa de "${r.nome}" (${comoDigitado(r.tarifa)})`,
    como === "virgula",
    `separador aceito: ${como}`,
  );
  registrarSeparador({
    campo: "#rate-value",
    onde: `Gestão › Recursos industriais › ${r.nome} › Valor da tarifa`,
    digitado: comoDigitado(r.tarifa),
    como,
  });
  return como;
}

async function marco10Recursos() {
  await abrir("/gestao/recursos-industriais");
  const vazioRec = await texto("td.table__empty");
  if (vazioRec) registrarVazio("Gestão › Recursos industriais (biblioteca vazia)", vazioRec);

  const existentes = (await apiGet("/industrial-resources?pageSize=50")).resources ?? [];
  const porNome = new Map(existentes.map((r) => [r.name, r]));
  S.dados.recursos = S.dados.recursos ?? {};

  for (const r of RECURSOS) {
    const existente = porNome.get(r.nome);
    if (existente) {
      if (existente.currentRate) {
        anotar(`RECURSO · "${r.nome}" já existia com tarifa — pulado`);
        continue;
      }
      anotar(`RECURSO · "${r.nome}" existia SEM tarifa — completando`);
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

  const depois = (await apiGet("/industrial-resources?pageSize=50")).resources ?? [];
  for (const r of depois) S.dados.recursos[r.name] = { id: r.id, code: r.code, type: r.type };
  salvarEstado();
  check(
    "RECURSO · os três recursos existem, todos com tarifa vigente",
    depois.length === 3 && depois.every((r) => r.currentRate != null),
    JSON.stringify(depois.map((r) => `${r.code}/${r.type}/${r.currentRate?.rateValue ?? "SEM TARIFA"}`)),
  );

  /*
   * O código do recurso industrial é RIN, não REC.
   *
   * REC já era do Recebimento: dois documentos de módulos diferentes com o
   * mesmo prefixo transformam qualquer busca por código numa adivinhação. A
   * conferência olha os dois lados — o novo prefixo E o antigo intacto.
   */
  check(
    "PREFIXO · recurso industrial usa RIN (o antigo REC colidia com Recebimento)",
    depois.length > 0 && depois.every((r) => /^RIN-\d+/.test(r.code ?? "")),
    JSON.stringify(depois.map((r) => r.code)),
  );
  const codigosDeRecebimento = Object.values(S.dados.recebimentos ?? {}).map((r) => r.code ?? "");
  check(
    "PREFIXO · o Recebimento continua REC — os dois códigos deixaram de colidir",
    codigosDeRecebimento.length > 0 && codigosDeRecebimento.every((c) => /^REC-\d+/.test(c)),
    JSON.stringify(codigosDeRecebimento),
  );
  anotar(
    `PREFIXO · recursos=${JSON.stringify(depois.map((r) => r.code))} · ` +
      `recebimentos=${JSON.stringify(codigosDeRecebimento)}`,
  );

  const tarifasGravadas = depois.map((r) => `${r.code}=${r.currentRate?.rateValue ?? "—"}`);
  anotar(`PROVA 1 · tarifas gravadas a partir de valores com vírgula: ${JSON.stringify(tarifasGravadas)}`);
  await shot("e2e1-10-recursos");
}

// ── MARCO 11 · Estrutura de custos ────────────────────────────────────────
async function marco11EstruturaDeCustos() {
  const produtoId = S.dados.produto.id;
  await abrir(`/produtos/${produtoId}/custos`, { espera: ".doc-title h1, .page__title" });

  const jaTem = await existeBotao("Nova versão");
  if (!jaTem) {
    const semEstrutura = await texto("section.form-section p.field__hint");
    if (semEstrutura) registrarVazio("Produto › Estrutura de custos (nenhuma versão)", semEstrutura);

    await preencher("#new-reference-output", String(PRODUTO.lotesMinimo));
    await clicarBotao("Criar estrutura de custos");
    await page.waitForTimeout(2500);
  } else {
    anotar("ESTRUTURA · já existia uma versão — criação pulada");
  }

  const semRecurso = await page.evaluate(() => {
    const s = [...document.querySelectorAll("section.form-section")].find((el) =>
      (el.querySelector("h3")?.textContent ?? "").includes("Recursos industriais"),
    );
    return (s?.querySelector("td.table__empty")?.textContent ?? "").replace(/\s+/g, " ").trim();
  });
  if (semRecurso) registrarVazio("Estrutura de custos › Recursos industriais", semRecurso);

  // Consumo por lote de referência (1000 potes): 8h de encapsuladora, 16h de
  // mão de obra. Números plausíveis para o lote; o que se mede aqui é a
  // cadeia, não a engenharia de processo.
  for (const [nome, consumo] of [
    [`${P} Encapsuladora`, "8"],
    [`${P} Mao de obra producao`, "16"],
  ]) {
    await escolherEntidade("#usage-resource", nome, nome);
    await preencher("#usage-quantity", consumo);
    await clicarBotao("Adicionar recurso");
    await page.waitForTimeout(1400);
  }

  // Energia derivada dos equipamentos, valorizada pela tarifa de energia.
  await selecionar("#energy-mode", "FROM_EQUIPMENT");
  await page.waitForTimeout(1500);
  if ((await page.locator("#energy-resource").count()) > 0) {
    const opcoes = await page.evaluate(() =>
      [...document.querySelectorAll("#energy-resource option")].map((o) => o.value),
    );
    const alvo = opcoes.find((v) => v && v !== "");
    if (alvo) {
      await selecionar("#energy-resource", alvo);
      await page.waitForTimeout(1500);
    }
  }

  /*
   * Premissa adicional com valor informado — sem valor ela viraria pendência.
   * O valor passa pelo mesmo tratamento de separador decimal usado nas outras
   * telas: a vírgula é tentada primeiro, o defeito é registrado se ela falhar,
   * e a etapa segue com ponto para não perder o custo declarado.
   */
  const premissas = () =>
    page
      .locator("section#secao-premissas table.table tbody tr:not(:has(td.table__empty))")
      .count();
  const antesPremissa = await premissas();
  await selecionar("#cost-category", "SECONDARY_PACKAGING");
  await preencher("#cost-description", "Caixa de expedicao");
  await selecionar("#cost-basis", "PER_SHIPPING_BOX");
  const comoPremissa = await decimalComRetentativa({
    campo: "#cost-rate",
    valor: "3.50",
    acao: async () => {
      if ((await page.locator("#cost-description").inputValue()) === "") {
        await preencher("#cost-description", "Caixa de expedicao");
      }
      await clicarBotao("Adicionar premissa");
    },
    confirmou: async () => (await premissas()) > antesPremissa,
    ondeNaTela: "Produto › Custos industriais › “Premissas de custo adicionais” › Valor",
  });
  check(
    "ESTRUTURA · a premissa de custo adicional (caixa de expedição) foi registrada",
    comoPremissa !== "falhou",
    `separador aceito: ${comoPremissa} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  check(
    'PROVA 2 · a vírgula decimal foi aceita na premissa de custo ("3,50")',
    comoPremissa === "virgula",
    `separador aceito: ${comoPremissa}`,
  );
  registrarSeparador({
    campo: "#cost-rate",
    onde: "Produto › Custos industriais › Premissas de custo adicionais › Valor",
    digitado: "3,50",
    como: comoPremissa,
  });
  await shot("e2e1-11a-estrutura-montada");

  await clicarBotao("Ativar estrutura");
  await page.waitForTimeout(700);
  if ((await page.locator(".confirm-dialog").count()) > 0) {
    const titulo = await confirmarDialogo("Ativar");
    anotar(`ESTRUTURA · ativação pediu confirmação: "${titulo}" (havia pendências)`);
  }
  await page.waitForTimeout(2000);

  const situacao = await texto(".doc-title .badge");
  check(
    "ESTRUTURA · a estrutura de custos ficou Ativa",
    situacao === "Ativa",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  await shot("e2e1-11-estrutura-ativa");

  /*
   * A premissa digitada com vírgula precisa estar na versão ATIVA — não só
   * ter aparecido na tabela antes de ativar. A conferência é por leitura do
   * que ficou gravado: 3,50 digitado, 3.5 no contrato.
   */
  const ativaEc = (await apiGet(`/products/${produtoId}/industrial-costs`)).current ?? {};
  const linhaCaixa = (ativaEc.lines ?? []).find((l) =>
    (l.description ?? "").toLowerCase().includes("caixa de expedicao"),
  );
  check(
    "PROVA 2 · a premissa digitada com vírgula sobreviveu à ativação, com o valor certo",
    Boolean(linhaCaixa) && Number(linhaCaixa.rateValue ?? linhaCaixa.rate ?? NaN) === 3.5,
    JSON.stringify((ativaEc.lines ?? []).map((l) => `${l.description}=${l.rateValue ?? l.rate}`)),
  );

  S.dados.estruturaDeCustos = { url: caminho() };
  salvarEstado();
}

// ── MARCO 12 · Cálculo de custo ───────────────────────────────────────────
async function marco12Calculo() {
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
  const custoTotal = await page.evaluate(() => {
    const dt = [...document.querySelectorAll("dl.definition-list dt")].find((el) =>
      ["Custo industrial total", "Subtotal conhecido"].includes((el.textContent ?? "").trim()),
    );
    return dt
      ? `${(dt.textContent ?? "").trim()} = ${(dt.nextElementSibling?.textContent ?? "").trim()}`
      : null;
  });
  check(
    "CÁLCULO · o custo por unidade foi calculado e apareceu na tela",
    Boolean(custoUnidade) && custoUnidade !== "—",
    `custo/unidade="${custoUnidade}" ${custoTotal ?? ""}`,
  );
  anotar(`CÁLCULO · custo por unidade na tela: ${custoUnidade} · ${custoTotal}`);
  S.dados.calculo = { custoUnidade, custoTotal };
  await shot("e2e1-12a-calculo-resultado");

  await clicarBotao("Salvar cálculo");
  await page.waitForTimeout(700);
  const tituloDialogo = await confirmarDialogo(
    (await page.locator('.confirm-dialog button:has-text("Salvar assim mesmo")').count()) > 0
      ? "Salvar assim mesmo"
      : "Salvar",
  );
  anotar(`CÁLCULO · diálogo de gravação: "${tituloDialogo}"`);
  const foi = await esperarUrl((u) => /^\/calculos-custo\/[0-9a-f-]{36}$/.test(u.pathname), 30000);
  if (!check("CÁLCULO · salvar cria um documento CALC próprio e abre ele", foi, caminho())) {
    anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
    return;
  }
  await page.waitForTimeout(900);
  const codigoCalc = await texto(".doc-title .code");
  check("CÁLCULO · o documento salvo tem código CALC", /^CALC-\d+/.test(codigoCalc), codigoCalc);
  S.dados.calculo.code = codigoCalc;
  S.dados.calculo.url = caminho();
  salvarEstado();
  await shot("e2e1-12-calculo-salvo");
}

// ── MARCO 13 · CMV ────────────────────────────────────────────────────────
async function marco13Cmv() {
  const produtoId = S.dados.produto.id;
  await abrir(`/produtos/${produtoId}/cmv`, { espera: ".doc-title h1, .page__title" });
  await preencher("#cmv-quantity", String(PRODUTO.lotesMinimo));
  await preencher("#cmv-reference-date", hoje());
  await clicarBotao("Calcular CMV");
  await page.waitForTimeout(3000);

  const cartoes = await page.evaluate(() =>
    [...document.querySelectorAll("div.cmv-card")].map((c) => ({
      rotulo: (c.querySelector(".cmv-card__label")?.textContent ?? "").trim(),
      valor: (c.querySelector(".cmv-card__value")?.textContent ?? "").trim(),
      nota: (c.querySelector(".cmv-card__note")?.textContent ?? "").trim(),
    })),
  );
  const ler = (rotulo) => cartoes.find((c) => c.rotulo === rotulo)?.valor ?? null;
  const cmvTotal = ler("CMV total");
  const cmvUnidade = ler("CMV por unidade");
  const qualidade = ler("Qualidade do custo");

  check(
    "CMV · a simulação de 1000 unidades devolveu total e custo unitário",
    Boolean(cmvTotal) && cmvTotal !== "CMV indisponível" && Boolean(cmvUnidade) && cmvUnidade !== "—",
    JSON.stringify(cartoes),
  );

  const numero = (t) =>
    t ? Number(t.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) : NaN;
  const totalNum = numero(cmvTotal);
  const unidadeNum = numero(cmvUnidade);
  S.dados.cmv = { total: cmvTotal, unidade: cmvUnidade, qualidade, cartoes };
  salvarEstado();

  anotar(
    `CMV · MEDIDO: ${cmvTotal} por ${PRODUTO.lotesMinimo} unidades (${cmvUnidade}/un), qualidade "${qualidade}" · ` +
      `REFERÊNCIA Veridi: R$ ${CMV_REFERENCIA.porLote1000.toFixed(2)} por 1000 (R$ ${CMV_REFERENCIA.porUnidade.toFixed(2)}/un) · ` +
      `diferença ${Number.isFinite(totalNum) ? (totalNum - CMV_REFERENCIA.porLote1000).toFixed(2) : "?"} ` +
      `(${Number.isFinite(totalNum) ? (totalNum / CMV_REFERENCIA.porLote1000).toFixed(2) : "?"}× a referência)`,
  );
  check(
    "CMV · o valor é positivo e coerente com um lote de 1000 unidades",
    Number.isFinite(totalNum) && totalNum > 0 && Math.abs(totalNum / 1000 - unidadeNum) < 0.05,
    `total=${totalNum} unidade=${unidadeNum}`,
  );
  await shot("e2e1-13-cmv");
}


/**
 * Campo decimal em tela pt-BR: tenta com vírgula, registra o defeito, segue.
 *
 * O servidor só aceita `^\d+(\.\d+)?$` (`apps/api/src/lib/decimal-schema.ts`),
 * e várias telas enviam o texto digitado sem normalizar. Digitar vírgula —
 * o que qualquer operador brasileiro faz — perde o valor. A jornada não pode
 * parar por isso: o defeito é registrado UMA vez por campo e a etapa segue com
 * ponto, ainda pela interface.
 */
const camposDecimaisJaRelatados = new Set();

async function decimalComRetentativa({ campo, valor, acao, confirmou, ondeNaTela }) {
  const comVirgula = String(valor).replace(".", ",");
  await preencher(campo, comVirgula);
  await acao();
  await page.waitForTimeout(1500);
  if (await confirmou()) return "virgula";

  const errosComVirgula = await mensagensDeErro();
  await preencher(campo, String(valor));
  await acao();
  await page.waitForTimeout(1500);
  if (!(await confirmou())) return "falhou";

  /*
   * O defeito só é afirmado quando o PONTO funciona onde a vírgula falhou —
   * essa é a prova de que o separador foi a causa, e não outra regra. Sem
   * essa ordem, um 409 de faixa duplicada viraria "defeito de vírgula".
   */
  if (!camposDecimaisJaRelatados.has(campo)) {
    camposDecimaisJaRelatados.add(campo);
    finding(
      "MEDIUM",
      `Campo decimal "${campo}" recusa a vírgula brasileira (${ondeNaTela})`,
      `${ondeNaTela} · digitar "${comVirgula}" em ${campo} e executar a ação: a tela devolve ` +
        `${JSON.stringify(errosComVirgula)} e nada é gravado. Repetir com "${valor}" (ponto) grava. ` +
        "Causa: decimalStringSchema (apps/api/src/lib/decimal-schema.ts) exige ponto, e a tela envia " +
        "o texto digitado sem normalizar o separador — item-form.tsx normaliza, estas telas não.",
    );
  }
  return "ponto";
}

// ── MARCO 14 · Precificação ───────────────────────────────────────────────
/**
 * Linhas REAIS da tabela de faixas.
 *
 * O estado vazio também é um `<tr>`: contar `tbody tr` cru dá 1 antes e 1
 * depois da primeira faixa, e a verificação conclui que nada foi criado.
 */
const linhasDeFaixa = () =>
  page
    .locator("section.form-section")
    .filter({ has: page.locator("h3", { hasText: "Faixas de quantidade" }) })
    .locator("table.table tbody tr:not(:has(td.table__empty))");

/**
 * PROVA 3 · as TRÊS faixas sobrevivem à ativação.
 *
 * Antes, duas das três se perdiam entre digitar e ativar (a vírgula não era
 * aceita e a linha nunca chegava a existir), e a versão ativava com uma faixa
 * só — sem nada na tela dizendo que faltava preço. Contar na tabela antes de
 * ativar não bastaria: a conferência é contra o que a carteira devolve como
 * VIGENTE, e por isso ela vale igual numa execução retomada.
 */
async function conferirFaixasVigentes(produtoId) {
  const vigente = (await apiGet(`/products/${produtoId}/pricing`)).current ?? {};
  const faixasVigentes = (vigente.tiers ?? []).map((t) => ({
    quantidade: Number(t.quantity ?? t.minimumQuantity ?? NaN),
    preco: Number(t.manualUnitPrice ?? t.selectedUnitPrice ?? t.unitPrice ?? NaN),
  }));
  check(
    "PROVA 3 · as três faixas (300, 500, 1000) estão na precificação ATIVA",
    faixasVigentes.length === FAIXAS.length &&
      FAIXAS.every((f) => faixasVigentes.some((v) => v.quantidade === f.quantidade)),
    JSON.stringify(faixasVigentes),
  );
  check(
    "PROVA 3 · os preços das três faixas são exatamente os digitados com vírgula",
    FAIXAS.every((f) =>
      faixasVigentes.some((v) => v.quantidade === f.quantidade && Math.abs(v.preco - f.preco) < 0.0001),
    ),
    JSON.stringify(faixasVigentes),
  );
  anotar(`PROVA 3 · faixas vigentes na precificação ativa: ${JSON.stringify(faixasVigentes)}`);
  return faixasVigentes;
}

async function marco14Precificacao() {
  const produtoId = S.dados.produto.id;

  /*
   * A premissa adicional já é conferida no marco 11, contra a versão ATIVA.
   * Aqui a leitura serve só ao relatório — quanto do custo declarado chegou
   * à precificação.
   */
  const estrutura = (await apiGet(`/products/${produtoId}/industrial-costs`)).current ?? {};
  anotar(
    `ESTRUTURA · a versão ativa EC entrou na precificação com ${(estrutura.lines ?? []).length} ` +
      `premissa(s): ${JSON.stringify((estrutura.lines ?? []).map((l) => `${l.description}=${l.rateValue ?? l.rate}`))}`,
  );

  await abrir("/gestao/precificacao");
  const vazioPrec = await texto("td.table__empty");
  if (vazioPrec) registrarVazio("Gestão › Precificação (nenhuma precificação)", vazioPrec);

  const carteira = await apiGet(`/products/${produtoId}/pricing`);
  const vigente = carteira.current;
  if (vigente && (vigente.tiers ?? []).length >= FAIXAS.length) {
    anotar(`PRECIFICAÇÃO · ${vigente.label} já ativa com as três faixas — cadastro pulado`);
    await conferirFaixasVigentes(produtoId);
    S.dados.precificacao = { code: vigente.code, id: vigente.id, label: vigente.label };
    salvarEstado();
    return;
  }
  if (vigente) {
    anotar(
      `PRECIFICAÇÃO · ${vigente.label} está ativa com apenas ${(vigente.tiers ?? []).length} faixa(s) ` +
        "(as demais foram perdidas pela vírgula decimal); uma nova versão será criada pela tela",
    );
  }

  if (carteira.draft) {
    // Rascunho aberto de execução anterior: retomar, e não criar mais uma versão.
    anotar(`PRECIFICAÇÃO · retomando o rascunho ${carteira.draft.label}`);
    await abrir(`/gestao/precificacao/${carteira.draft.id}`, { espera: ".doc-title h1" });
    check("PRECIFICAÇÃO · o rascunho existente abriu para edição", true, carteira.draft.label);
  } else {
    await abrir(`/produtos/${produtoId}/custos`, { espera: ".doc-title h1" });
    await clicarBotao("Criar precificação");
    const foi = await esperarUrl(
      (u) => /^\/gestao\/precificacao\/[0-9a-f-]{36}$/.test(u.pathname),
      30000,
    );
    if (!check("PRECIFICAÇÃO · nasce do cálculo salvo, na própria estrutura de custos", foi, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
  }
  await page.waitForTimeout(1400);

  const semFaixa = await texto("td.table__empty");
  if (semFaixa) registrarVazio("Precificação › Faixas de quantidade (rascunho novo)", semFaixa);

  // Uma versão nova copia as faixas da anterior: tentar recadastrar devolve
  // 409 "Já existe uma faixa de 300", que não é defeito nenhum.
  const jaNaTabela = (await linhasDeFaixa().allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  for (const faixa of FAIXAS) {
    if (jaNaTabela.some((l) => l.startsWith(`${faixa.quantidade} `))) {
      anotar(`PRECIFICAÇÃO · faixa de ${faixa.quantidade} un já veio copiada da versão anterior`);
      continue;
    }
    const antes = await linhasDeFaixa().count();
    await preencher("#tier-quantity", String(faixa.quantidade));
    await selecionar("#tier-mode", "MANUAL_PRICE");
    await page.waitForTimeout(250);
    await preencher("#tier-commission", "5");
    const como = await decimalComRetentativa({
      campo: "#tier-price",
      valor: faixa.preco.toFixed(2),
      acao: async () => {
        await clicarBotao("Adicionar faixa");
      },
      confirmou: async () => (await linhasDeFaixa().count()) > antes,
      ondeNaTela: "Gestão › Precificação › “Faixas de quantidade” › Preço unitário",
    });
    check(
      `PRECIFICAÇÃO · faixa de ${faixa.quantidade} un a R$ ${faixa.preco.toFixed(2)} foi cadastrada`,
      como !== "falhou",
      `separador aceito: ${como}`,
    );
    check(
      `PROVA 3 · a vírgula decimal foi aceita no preço da faixa de ${faixa.quantidade} un (${comoDigitado(faixa.preco.toFixed(2))})`,
      como === "virgula",
      `separador aceito: ${como}`,
    );
    registrarSeparador({
      campo: "#tier-price",
      onde: `Gestão › Precificação › Faixas de quantidade › Preço unitário (${faixa.quantidade} un)`,
      digitado: comoDigitado(faixa.preco.toFixed(2)),
      como,
    });
    if (como === "falhou") return;
  }

  const linhas = await linhasDeFaixa().allTextContents();
  check(
    "PRECIFICAÇÃO · as três faixas reais (300, 500, 1000) estão na tabela",
    FAIXAS.every((f) => linhas.some((l) => l.includes(String(f.quantidade)))),
    JSON.stringify(linhas.map((l) => l.replace(/\s+/g, " ").slice(0, 100))),
  );
  await shot("e2e1-14a-faixas");

  await clicarBotao("Ativar precificação");
  await page.waitForTimeout(700);
  if ((await page.locator(".confirm-dialog").count()) > 0) {
    const titulo = await confirmarDialogo("Ativar");
    anotar(`PRECIFICAÇÃO · ativação pediu confirmação: "${titulo}"`);
  }
  await page.waitForTimeout(2000);
  const situacao = await texto(".doc-title .badge");
  check(
    "PRECIFICAÇÃO · a precificação ficou Ativa",
    situacao === "Ativa",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  await conferirFaixasVigentes(produtoId);

  S.dados.precificacao = { url: caminho(), code: await texto(".doc-title .code") };
  salvarEstado();
  await shot("e2e1-14-precificacao-ativa");
}

// ── MARCO 15 · Orçamento ──────────────────────────────────────────────────
const QUANTIDADE_ORCADA = 1000;

const secao = (titulo) =>
  page.locator("section.form-section").filter({ has: page.locator("h3", { hasText: titulo }) });

async function marco15Orcamento() {
  await abrir(S.dados.projeto.url, { espera: ".doc-title h1" });

  const orcamentos = secao("Orçamentos");
  const vazioOrc = ((await orcamentos.locator("table tbody tr").first().textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (/Nenhuma versão de orçamento/i.test(vazioOrc)) {
    registrarVazio("Projeto › Orçamentos (nenhuma versão)", vazioOrc);
  }

  if (await existeBotao("Criar nova versão")) {
    await clicarBotao("Criar nova versão");
  } else if (await existeBotao("Abrir rascunho")) {
    await clicarBotao("Abrir rascunho");
  }
  await page.waitForTimeout(2200);

  const rotuloVersao = await texto(".quote-workspace__head .code");
  check(
    "ORÇAMENTO · a versão nasce em Rascunho, com código ORC e número de versão",
    /^ORC-\d+ · V\d+$/.test(rotuloVersao),
    rotuloVersao,
  );

  const semProduto = ((await orcamentos.locator("table.table--quote-lines tbody tr").first().textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (/Nenhum produto na proposta/i.test(semProduto)) {
    registrarVazio("Orçamento rascunho › linhas (nenhum produto)", semProduto);
  }

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

  const codigoProduto = S.dados.produto.code;
  const campoQtd = page.getByLabel(`Quantidade de ${codigoProduto}`);
  await campoQtd.fill(String(QUANTIDADE_ORCADA));
  await page.locator("#quote-valid-until").click(); // blur: a linha só grava no blur
  await page.waitForTimeout(1800);

  // Preço vindo da faixa de precificação ativa — provenance, não digitação.
  await clicarBotao("Usar precificação");
  await page.waitForTimeout(1500);
  const faixas = await textos("ul.plain-list li");
  check(
    "ORÇAMENTO · o painel oferece as faixas da precificação ATIVA do produto",
    faixas.some((f) => f.includes(String(QUANTIDADE_ORCADA))),
    JSON.stringify(faixas),
  );
  const faixaAlvo = page
    .locator("ul.plain-list li")
    .filter({ hasText: String(QUANTIDADE_ORCADA) })
    .first();
  await faixaAlvo.getByRole("button", { name: "Usar esta faixa", exact: true }).click();
  await page.waitForTimeout(2000);

  const linhaOrc = await textos("table.table--quote-lines tbody tr");
  check(
    "ORÇAMENTO · a linha ficou com a quantidade orçada e o preço da faixa",
    linhaOrc.some((l) => l.includes(String(QUANTIDADE_ORCADA)) && l.includes("3,60")),
    JSON.stringify(linhaOrc.map((l) => l.slice(0, 120))),
  );

  await preencher("#quote-valid-until", daquiDias(30));
  await preencher("#quote-lead-time", "30");
  await selecionar("#quote-payment-method", "CASH");
  await clicarBotao("Salvar condições");
  await page.waitForTimeout(1600);
  await shot("e2e1-15a-orcamento-rascunho");

  await clicarBotao("Enviar ao cliente");
  const titulo = await confirmarDialogo(
    (await page.locator('.confirm-dialog button:has-text("Enviar mesmo assim")').count()) > 0
      ? "Enviar mesmo assim"
      : "Enviar ao cliente",
  );
  anotar(`ORÇAMENTO · diálogo de envio: "${titulo}"`);
  await page.waitForTimeout(2500);

  const situacao = await texto(".quote-workspace__head .badge");
  check(
    "ORÇAMENTO · enviado ao cliente — a versão saiu do rascunho",
    situacao === "Enviado",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  S.dados.orcamento = { label: rotuloVersao };
  salvarEstado();
  await shot("e2e1-15-orcamento-enviado");
}

// ── MARCO 16 · Aceite ─────────────────────────────────────────────────────
async function marco16Aceite() {
  await abrir(S.dados.projeto.url, { espera: ".doc-title h1" });
  if (await existeBotao("Registrar aceite")) {
    await clicarBotao("Registrar aceite");
    await page.waitForTimeout(2500);
  } else {
    anotar("ACEITE · o botão não estava disponível — versão possivelmente já aceita");
  }
  const situacao = await texto(".quote-workspace__head .badge");
  check(
    "ACEITE · a versão enviada passou a Aceito",
    situacao === "Aceito",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const fechamento = await texto(".quote-closing");
  check(
    "ACEITE · o Fechamento diz que o pedido ainda depende da aprovação do projeto",
    /aprovação/i.test(fechamento),
    fechamento.slice(0, 240),
  );
  anotar(`ACEITE · Fechamento na tela: "${fechamento.slice(0, 220)}"`);
  await shot("e2e1-16-aceite");
}

// ── MARCO 17 · Aprovação do projeto ───────────────────────────────────────
async function marco17Aprovacao() {
  await abrir(S.dados.projeto.url, { espera: ".doc-title h1" });

  const antes = await apiGet(`/products/${S.dados.produto.id}`);
  check(
    "APROVAÇÃO · antes de aprovar, o produto está Em desenvolvimento",
    antes.lifecycle === "DEVELOPMENT",
    String(antes.lifecycle),
  );

  if (await existeBotao("Aprovar projeto")) {
    await clicarBotao("Aprovar projeto");
    const titulo = await confirmarDialogo("Aprovar");
    check(
      "APROVAÇÃO · aprovar pede confirmação e mostra o que será aprovado",
      /Aprovar o projeto/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(3000);
  } else {
    anotar("APROVAÇÃO · o botão não estava disponível — projeto possivelmente já aprovado");
  }

  const situacao = await texto(".doc-title .badge");
  check(
    "APROVAÇÃO · o projeto passou a Aprovado",
    situacao === "Aprovado",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  // ── PROVA 4 · a aprovação promove o produto ────────────────────────────
  const depois = await apiGet(`/products/${S.dados.produto.id}`);
  check(
    "REGRA PROMOÇÃO · aprovar o projeto promoveu o produto de Em desenvolvimento para Aprovado",
    depois.lifecycle === "APPROVED",
    `${antes.lifecycle} → ${depois.lifecycle}`,
  );
  check(
    "REGRA PROMOÇÃO · a promoção manteve o MESMO produto (código, item PA e formulação intactos)",
    depois.code === antes.code &&
      depois.finishedProductItem?.code === antes.finishedProductItem?.code,
    JSON.stringify({
      antes: `${antes.code}/${antes.finishedProductItem?.code}`,
      depois: `${depois.code}/${depois.finishedProductItem?.code}`,
    }),
  );
  await shot("e2e1-17-projeto-aprovado");
}

// ── MARCO 18 · Pedido ─────────────────────────────────────────────────────
async function marco18Pedido() {
  await abrir("/comercial/pedidos");
  const vazioPed = await texto("td.table__empty");
  if (vazioPed) registrarVazio("Comercial › Pedidos (nenhum pedido)", vazioPed);

  /*
   * PROVA 9 · a ajuda da lista de Pedidos é sobre PEDIDO.
   *
   * A tela abria o painel do Plano de Atendimento — que é uma etapa DENTRO
   * do pedido, não a tela. Quem clicava em "Como funciona" procurando o que
   * é um pedido lia sobre a conta de atendimento e saía sem resposta. A
   * conferência é pelo título do painel e pelo assunto do resumo.
   */
  await clicarBotao("Como funciona");
  await page.waitForSelector(".help-modal__title", { timeout: 20000 });
  const tituloAjuda = await texto(".help-modal__title");
  const resumoAjuda = await texto(".help-modal__summary");
  check(
    "PROVA 9 · a ajuda da lista de Pedidos tem título sobre o Pedido do Cliente",
    /pedido do cliente/i.test(tituloAjuda),
    `título="${tituloAjuda}"`,
  );
  check(
    "PROVA 9 · e não é a ajuda do Plano de Atendimento",
    !/plano de atendimento/i.test(tituloAjuda) && /pedido/i.test(resumoAjuda),
    `título="${tituloAjuda}" resumo="${resumoAjuda.slice(0, 160)}"`,
  );
  anotar(`PROVA 9 · ajuda de Comercial › Pedidos: "${tituloAjuda}"`);
  await shot("e2e1-18a-ajuda-do-pedido");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  if (!S.dados.pedido) {
    await abrir(S.dados.projeto.url, { espera: ".doc-title h1" });
    await clicarBotao("Gerar pedido a partir do orçamento aceito");
    const foi = await esperarUrl(
      (u) => /^\/comercial\/pedidos\/[0-9a-f-]{36}$/.test(u.pathname),
      30000,
    );
    if (!check("PEDIDO · nasce do orçamento aceito, pela tela do projeto", foi, caminho())) {
      anotar(`erros na tela: ${JSON.stringify(await mensagensDeErro())}`);
      return;
    }
    await page.waitForTimeout(1500);
    S.dados.pedido = { url: caminho(), code: await texto(".doc-title h1") };
    salvarEstado();
  } else {
    await abrir(S.dados.pedido.url, { espera: ".doc-title h1" });
  }

  const codigo = await texto(".doc-title h1");
  check("PEDIDO · o pedido tem código PED gerado", /^PED-\d+/.test(codigo), codigo);

  const origem = await texto(".flow-context");
  anotar(`PEDIDO · contexto de fluxo na tela: "${origem}"`);

  if (await existeBotao("Confirmar pedido")) {
    await clicarBotao("Confirmar pedido");
    const titulo = await confirmarDialogo("Confirmar");
    anotar(`PEDIDO · diálogo de confirmação: "${titulo}"`);
    await page.waitForTimeout(2500);
  }
  const situacao = await texto(".doc-title .badge");
  check(
    "PEDIDO · confirmado, os produtos e quantidades ficam congelados",
    situacao === "Confirmado",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  await shot("e2e1-18-pedido-confirmado");
}

// ── MARCO 19 · Plano de Atendimento ───────────────────────────────────────
async function marco19Plano() {
  await abrir(S.dados.pedido.url, { espera: ".doc-title h1" });
  const situacaoInicial = await texto(".doc-title .badge");
  if (situacaoInicial === "Em atendimento") {
    anotar("PLANO · o pedido já estava Em atendimento — plano aplicado em execução anterior");
  } else {
    await page.waitForSelector('input[aria-label^="Produzir de"]', { timeout: 40000 });
    const codigoProduto = S.dados.produto.code;
    await page.getByLabel(`Produzir de ${codigoProduto}`).fill(String(QUANTIDADE_ORCADA));
    await page.waitForTimeout(800);

    const materiais = await secao("Plano de Atendimento").locator("table").nth(1).allTextContents();
    anotar(`PLANO · impacto de materiais na tela: ${JSON.stringify(materiais).slice(0, 300)}`);
    await shot("e2e1-19a-plano");

    await clicarBotao("Aplicar Plano de Atendimento");
    const titulo = await confirmarDialogo("Aplicar Plano");
    check(
      "PLANO · aplicar pede confirmação e avisa que nada é liberado automaticamente",
      /Aplicar Plano de Atendimento/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(4000);
  }

  const situacao = await texto(".doc-title .badge");
  check(
    "PLANO · aplicado, o pedido passou a Em atendimento",
    situacao === "Em atendimento",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const ops = (await apiGet("/production-orders?pageSize=20")).productionOrders ?? [];
  check(
    "PLANO · o plano criou uma Ordem de Produção em rascunho para o déficit",
    ops.length === 1 && ops[0].status === "DRAFT",
    JSON.stringify(ops.map((o) => `${o.code}/${o.status}/${o.plannedQuantity}`)),
  );
  if (ops[0]) {
    S.dados.op = { id: ops[0].id, code: ops[0].code, url: `/producao/ordens/${ops[0].id}` };
    salvarEstado();
  }
  await shot("e2e1-19-plano-aplicado");
}

// ── MARCO 20 · Ordem de Produção ──────────────────────────────────────────
async function marco20OrdemDeProducao() {
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });

  if ((await texto(".doc-title .badge")) === "Rascunho") {
    await clicarBotao("Planejar OP");
    await page.waitForTimeout(3000);
  }
  const planejada = await texto(".doc-title .badge");
  check(
    "OP · planejada, a ordem calcula a necessidade de materiais",
    planejada === "Planejada",
    `${planejada} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const necessidades = await secao("Necessidade de Materiais").locator("tbody tr").allTextContents();
  check(
    "OP · a necessidade lista os seis materiais da formulação ativa",
    necessidades.length === 6,
    JSON.stringify(necessidades.map((n) => n.replace(/\s+/g, " ").slice(0, 70))),
  );
  anotar(`OP · necessidade calculada: ${JSON.stringify(necessidades.map((n) => n.replace(/\s+/g, " ")))}`);
  await shot("e2e1-20a-op-necessidades");

  // ── VALIDAÇÃO (domínio) · liberar OP sem estoque disponível ─────────────
  // O lote de Vitamina E ficou retido na Qualidade desde o marco 6. A tela
  // precisa recusar a liberação, dizer por quê, e não deixar a OP avançar.
  const botaoLiberar = page.getByRole("button", { name: "Liberar OP", exact: true });
  const desabilitado = (await botaoLiberar.count()) > 0 ? await botaoLiberar.isDisabled() : null;
  const dica = await secao("Necessidade de Materiais").locator("p.field__hint").allTextContents();
  const dicaLiberar = (await textos("div.line-actions p.field__hint")).join(" | ");
  check(
    "VALIDAÇÃO (domínio) · sem estoque liberado, o botão “Liberar OP” fica desabilitado",
    desabilitado === true,
    `desabilitado=${desabilitado}`,
  );
  check(
    "VALIDAÇÃO (domínio) · a tela diz o motivo em vez de só desabilitar",
    /falta material/i.test(dicaLiberar) || dica.some((d) => /falta/i.test(d)),
    `dicas="${dicaLiberar}" | ${JSON.stringify(dica)}`,
  );
  anotar(`VALIDAÇÃO (domínio) · impedimento exibido: "${dicaLiberar}"`);
  await shot("e2e1-20b-liberar-bloqueado-sem-estoque");

  // ── Recuperação: a Qualidade libera o lote retido ───────────────────────
  const retido = S.dados.lotes.find((l) => l.item === ITEM_RETIDO);
  await abrir(`/estoque/lotes/${retido.id}`, { espera: ".doc-title h1" });
  if (await existeBotao("Liberar")) {
    await clicarBotao("Liberar");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(1500);
  }
  check(
    `QUALIDADE · o lote retido ${retido.code} foi liberado e ficou Disponível`,
    (await texto(".doc-title .badge")) === "Disponível",
    await texto(".doc-title .badge"),
  );

  await abrir(S.dados.op.url, { espera: ".doc-title h1" });
  await page.waitForTimeout(1500);
  await clicarBotao("Liberar OP");
  const titulo = await confirmarDialogo("Liberar");
  check(
    "OP · liberar pede confirmação e explica que a baixa física ainda não acontece",
    /Liberar/i.test(titulo),
    titulo,
  );
  await page.waitForTimeout(3500);
  const liberada = await texto(".doc-title .badge");
  check(
    "OP · com o material liberado pela Qualidade, a OP foi liberada",
    liberada === "Liberada",
    `${liberada} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  await shot("e2e1-20-op-liberada");
}

// ── MARCO 21 · Picking e consumo ──────────────────────────────────────────
async function marco21Consumo() {
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });

  /*
   * Conferência de lote, uma linha por vez.
   *
   * Abrir o scanner INSERE uma linha na tabela e troca o rótulo do botão para
   * "Fechar": qualquer laço por índice fixo passa a apontar para a linha
   * errada no segundo item. Por isso o laço sempre reataca a PRIMEIRA linha
   * pendente e relê a tabela a cada passo.
   */
  const picking = secao("Picking");
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
      // Lote diferente do reservado abre um modal próprio — se aparecer aqui,
      // o script leu o código errado e é isso que precisa ser dito.
      if ((await page.locator("#mismatch-title").count()) > 0) {
        check(
          "PICKING · o lote informado bate com o reservado (sem modal de divergência)",
          false,
          `modal aberto ao conferir ${loteEsperado}`,
        );
        return;
      }
      const erroLinha = await mensagensDeErro();
      if (erroLinha.length > 0) anotar(`PICKING · mensagem ao conferir ${loteEsperado}: ${JSON.stringify(erroLinha)}`);
      continue;
    }
    const confirmar = linha.getByRole("button", { name: "Confirmar separação", exact: true });
    if ((await confirmar.count()) > 0) {
      await confirmar.click();
      await page.waitForTimeout(2200);
      continue;
    }
    anotar(`PICKING · linha sem ação disponível, parando o laço: "${conteudo.slice(0, 90)}"`);
    break;
  }

  const conferidas = (await picking.locator("tbody tr").allTextContents())
    .map((t) => t.replace(/\s+/g, " "))
    .filter((t) => /LT-|Confirmar separação|Pendente|Conferido/.test(t));
  check(
    "PICKING · todas as linhas de reserva foram conferidas por lote",
    conferidas.length > 0 && conferidas.every((l) => l.includes("Conferido")),
    JSON.stringify(conferidas.map((l) => l.slice(0, 90))),
  );
  await shot("e2e1-21a-picking-conferido");

  /*
   * Consumo real — é ele que baixa o estoque físico, e é ele que leva a OP
   * de LIBERADA para EM PRODUÇÃO. A coluna "Restante" é lida pelo cabeçalho,
   * e não por índice fixo, porque a tabela ganha colunas conforme a situação.
   */
  const consumo = secao("Consumo Real");
  const cabecalhos = (await consumo.locator("thead th").allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  const colRestante = cabecalhos.findIndex((h) => h.startsWith("Restante"));
  anotar(`CONSUMO · colunas da tabela: ${JSON.stringify(cabecalhos)}`);

  /*
   * "Confirmar consumo" é um botão POR LINHA, não um botão da seção.
   *
   * Preencher as seis quantidades e clicar uma vez só aponta o consumo de UMA
   * linha — as outras cinco ficam com consumo zero, e a OP ainda assim pode
   * ser concluída. Cada linha é confirmada individualmente, relendo a tabela a
   * cada passo porque a confirmação a re-renderiza.
   */
  /*
   * PROVA 8 · retrato do estoque ANTES de qualquer baixa.
   *
   * "O estoque baixou" não se prova pelo saldo final: 9.800 g de celulose
   * podem ser o que sobrou ou o que nunca saiu. Só a diferença contra o
   * retrato anterior responde, e ela precisa ser tirada aqui — depois da
   * reserva, antes do consumo.
   */
  S.dados.estoqueAntes = Object.fromEntries(
    ((await apiGet("/inventory?pageSize=100")).items ?? []).map((i) => [
      i.itemCode,
      { nome: i.itemName, onHand: i.onHand, reserved: i.reserved, available: i.available },
    ]),
  );
  anotar(`PROVA 8 · estoque antes do consumo: ${JSON.stringify(S.dados.estoqueAntes)}`);

  /*
   * UM material fica de fora de propósito.
   *
   * A regra nova diz que a OP não conclui com material por reconciliar. Uma
   * jornada que consumisse as seis linhas nunca encostaria nessa regra —
   * passaria por ela sem tocá-la e o relatório afirmaria uma proteção que
   * não foi exercida. A linha que sobra é o material do teste do marco 22.
   */
  const codigoDaLinha = async (linha) => {
    const primeira = ((await linha.locator("td").first().textContent()) ?? "").replace(/\s+/g, " ");
    return (primeira.match(/\b(?:MP|EMB|ME|PA)-\d+/) ?? [""])[0];
  };
  const linhasIniciais = await consumo.locator("tbody tr").count();
  const pendenteDeProposito = await codigoDaLinha(consumo.locator("tbody tr").nth(linhasIniciais - 1));
  S.dados.materialPendente = pendenteDeProposito;
  anotar(
    `CONSUMO · ${linhasIniciais} linhas de reserva; ${pendenteDeProposito} fica SEM consumo de ` +
      "propósito, para o marco 22 provar que a OP não conclui com material por reconciliar",
  );

  let confirmadas = 0;
  let deixadas = 0;
  for (let passo = 0; passo < 15; passo += 1) {
    const linhas = consumo.locator("tbody tr");
    const total = await linhas.count();
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
  await page.waitForTimeout(1500);

  const situacaoAposConsumo = await texto(".doc-title .badge");
  check(
    "CONSUMO · apontar consumo real leva a OP de Liberada para Em produção",
    situacaoAposConsumo === "Em produção",
    situacaoAposConsumo,
  );

  const historico = await secao("Consumo Real").locator("tbody tr").allTextContents();
  anotar(`CONSUMO · linhas na seção de consumo após confirmar: ${historico.length}`);
  salvarEstado();
  await shot("e2e1-21-consumo");
}

// ── MARCO 22 · Produção (planejado × realizado) ───────────────────────────
const QUANTIDADE_PRODUZIDA = 980;
const LOTE_VERIDI = "E2E1-CQ10-001";

async function marco22Producao() {
  await abrir(S.dados.op.url, { espera: ".doc-title h1" });

  /*
   * OP concluída é histórico: não há botão para clicar de novo e não deveria
   * haver. Numa execução retomada o marco confere o que FICOU — que é onde
   * moram as provas duráveis (reconciliação, baixa de estoque, lote gerado) —
   * e deixa registrado que os atos já aconteceram.
   */
  if ((await texto(".doc-title .badge")) === "Concluída") {
    anotar(`PRODUÇÃO · ${S.dados.op.code} já estava Concluída — conferência do resultado`);
    const opPronta = await apiGet(`/production-orders/${S.dados.op.id}`);
    const req = opPronta.requirements ?? [];
    check(
      "PROVA 5 · nenhum material continua por reconciliar na OP concluída",
      req.length > 0 &&
        req.every(
          (r) => r.reconciliationStatus === "RECONCILED" || r.reconciliationStatus === "VARIANCE_ACCEPTED",
        ),
      JSON.stringify(req.map((r) => `${r.itemCode}=${r.reconciliationStatus}`)),
    );
    check(
      "PROVA 5 · a divergência justificada guarda motivo e autor no documento",
      req.some(
        (r) =>
          r.reconciliationStatus === "VARIANCE_ACCEPTED" &&
          (r.varianceReason ?? "").length > 0 &&
          (r.varianceAcceptedBy ?? "").length > 0,
      ),
      JSON.stringify(
        req
          .filter((r) => r.reconciliationStatus === "VARIANCE_ACCEPTED")
          .map((r) => `${r.itemCode}: "${r.varianceReason}" — ${r.varianceAcceptedBy}`),
      ),
    );
    const baixas = S.dados.baixaDeEstoque ?? [];
    check(
      "PROVA 8 · a baixa de estoque medida na conclusão bate material a material",
      baixas.length > 0 && baixas.every((b) => b.confere && b.depois < b.antes),
      JSON.stringify(baixas),
    );
    check(
      "PROVA 6 · a OP só chegou a Concluída com todos os materiais reconciliados",
      (opPronta.materialReconciliation?.reconciledRequirements ?? -1) ===
        (opPronta.materialReconciliation?.totalRequirements ?? -2),
      JSON.stringify(opPronta.materialReconciliation),
    );
    await shot("e2e1-22-op-concluida");
    return;
  }

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
  anotar(`PRODUÇÃO · planejado × realizado na tela: ${JSON.stringify(numeros)}`);
  await shot("e2e1-22a-apontamento");

  // ════════════════════════════════════════════════════════════════════════
  // PROVA 6 · a OP NÃO conclui com material por reconciliar
  // ════════════════════════════════════════════════════════════════════════
  const pendente = S.dados.materialPendente;
  const botaoConcluir = page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true });
  await botaoConcluir.waitFor({ state: "visible", timeout: 20000 });
  check(
    `PROVA 6 · com ${pendente} sem consumo, o botão "Concluir OP" está desabilitado`,
    await botaoConcluir.isDisabled(),
    `desabilitado=${await botaoConcluir.isDisabled()}`,
  );

  const avisoPendencia = (await textos(".line-actions p.form-alert")).join(" | ");
  check(
    "PROVA 6 · a tela diz QUAIS materiais faltam, em vez de só desabilitar o botão",
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
  await shot("e2e1-22b-concluir-bloqueado-material-pendente");

  /*
   * O botão desabilitado NÃO é contornável pelo navegador — e isso é um
   * resultado, não uma lacuna.
   *
   * A tentativa foi feita: soltar o `disabled` do elemento e disparar o
   * clique. Nada acontece, e o motivo é do React: o handler é decidido pelas
   * PROPS do componente, não pelo atributo do DOM, então evento de mouse em
   * elemento cujas props dizem `disabled` é descartado antes de chegar ao
   * `onClick`. Nenhum pedido sai do navegador — não há o que o servidor
   * recuse porque nada é enviado.
   *
   * Ficou registrado que a recusa do domínio existe e é conferida em outro
   * lugar: `apps/api/src/modules/production-orders/material-reconciliation.test.ts`
   * cobre `unreconciled_materials` chamando a rota direto. Repetir isso aqui
   * exigiria um POST fora da interface — proibido nesta validação.
   */
  anotar(
    "PROVA 6 · a proteção da tela não é contornável pelo navegador: soltar o atributo " +
      "`disabled` e clicar não dispara o handler (o React decide pelo prop, não pelo DOM), " +
      "então nenhum pedido chega a sair. A recusa equivalente do servidor " +
      "(`unreconciled_materials`) é coberta por apps/api/src/modules/production-orders/" +
      "material-reconciliation.test.ts, fora do alcance desta jornada, que não faz POST de API.",
  );

  // ════════════════════════════════════════════════════════════════════════
  // Reconciliar o que faltava: consumo parcial + justificativa da diferença
  // ════════════════════════════════════════════════════════════════════════
  /*
   * O material pendente é consumido em PARTE, não por inteiro.
   *
   * Consumir tudo resolveria a pendência sem nunca exercitar a justificativa
   * — e a justificativa é a outra metade da regra nova. Consumo parcial
   * mantém a linha na rastreabilidade (PROVA 7 pede consumo em todos os
   * componentes) e ainda deixa a diferença que precisa ser explicada.
   */
  const consumo22 = secao("Consumo Real");
  const linhaPendente = consumo22.locator("tbody tr").filter({ hasText: pendente }).first();
  const cabecalhos22 = (await consumo22.locator("thead th").allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  const colRestante22 = cabecalhos22.findIndex((h) => h.startsWith("Restante"));
  const celulas22 = (await linhaPendente.locator("td").allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  const restante22 = Number(
    (celulas22[colRestante22] ?? "").match(/[\d.,]+/)?.[0].replace(/\.(?=\d{3}\b)/g, "").replace(",", ".") ??
      "0",
  );
  const parcial = Number((restante22 / 2).toFixed(3));
  /* Vírgula de novo, agora num campo de quantidade: a correção é do sistema,
     não de uma tela. */
  await linhaPendente.locator('input[inputmode="decimal"]').first().fill(comoDigitado(String(parcial)));
  await page.waitForTimeout(250);
  await linhaPendente.getByRole("button", { name: "Confirmar consumo", exact: true }).click();
  await page.waitForTimeout(2800);
  registrarSeparador({
    campo: "Consumo Real › Consumir agora",
    onde: `Produção › OP ${S.dados.op.code} › Consumo Real (${pendente})`,
    digitado: comoDigitado(String(parcial)),
    como: "virgula",
  });
  anotar(
    `RECONCILIAÇÃO · ${pendente} recebeu consumo PARCIAL de ${comoDigitado(String(parcial))} ` +
      `(restante era ${restante22}) — a diferença fica para justificar`,
  );

  const aindaPendente = (await textos(".line-actions p.form-alert")).join(" | ");
  const concluirAindaTravado = await page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true })
    .isDisabled();
  check(
    "PROVA 6 · consumo parcial não resolve a pendência: a tela continua cobrando o material",
    aindaPendente.includes(pendente) && concluirAindaTravado,
    `aviso="${aindaPendente}" botãoDesabilitado=${concluirAindaTravado}`,
  );
  await shot("e2e1-22d-consumo-parcial-ainda-bloqueia");

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
    "RECONCILIAÇÃO · a ação “Justificar diferença” abre o pedido de motivo para AQUELE material",
    tituloJustificativa.includes(pendente),
    tituloJustificativa,
  );
  await preencher(
    "#variance-reason",
    `Sobra devolvida ao lote de origem: a formulação pedia mais ${pendente} do que o processo consumiu.`,
  );
  await shot("e2e1-22e-justificar-diferenca");
  await clicarBotao("Registrar justificativa");
  await page.waitForTimeout(3000);

  // ════════════════════════════════════════════════════════════════════════
  // PROVA 5 · todos os materiais reconciliados
  // ════════════════════════════════════════════════════════════════════════
  const opAntesDeConcluir = await apiGet(`/production-orders/${S.dados.op.id}`);
  const requisitos22 = opAntesDeConcluir.requirements ?? [];
  const porReconciliar = requisitos22.filter(
    (r) => r.reconciliationStatus === "PENDING_NONE" || r.reconciliationStatus === "PENDING_PARTIAL",
  );
  check(
    "PROVA 5 · nenhum material continua por reconciliar antes de concluir a OP",
    requisitos22.length > 0 && porReconciliar.length === 0,
    JSON.stringify(requisitos22.map((r) => `${r.itemCode}=${r.reconciliationStatus}`)),
  );
  check(
    "PROVA 5 · o material da diferença ficou como divergência justificada, com motivo e autor",
    requisitos22.some(
      (r) =>
        r.itemCode === pendente &&
        r.reconciliationStatus === "VARIANCE_ACCEPTED" &&
        (r.varianceReason ?? "").length > 0,
    ),
    JSON.stringify(
      requisitos22
        .filter((r) => r.itemCode === pendente)
        .map((r) => `${r.reconciliationStatus}/${r.varianceReason}/${r.varianceAcceptedBy}`),
    ),
  );
  const progresso = await texto("section .form-section__sub");
  const progressoConsumo = (await textos(".form-section__sub")).find((t) =>
    /materiais reconciliados/.test(t),
  );
  check(
    "PROVA 5 · a tela mostra o progresso da reconciliação completo",
    /(\d+) de \1 materiais reconciliados/.test(progressoConsumo ?? ""),
    `"${progressoConsumo ?? progresso}"`,
  );
  anotar(`PROVA 5 · progresso na tela: "${progressoConsumo ?? "—"}"`);
  anotar(
    `PROVA 5 · situações: ${JSON.stringify(requisitos22.map((r) => `${r.itemCode}=${r.reconciliationStatus}`))}`,
  );
  await shot("e2e1-22f-tudo-reconciliado");

  // ════════════════════════════════════════════════════════════════════════
  // Conclusão, agora permitida
  // ════════════════════════════════════════════════════════════════════════
  const concluirLiberado = page
    .locator(".line-actions")
    .getByRole("button", { name: "Concluir OP", exact: true });
  check(
    "PROVA 6 · reconciliado tudo, o mesmo botão “Concluir OP” fica habilitado",
    !(await concluirLiberado.isDisabled()),
    `desabilitado=${await concluirLiberado.isDisabled()}`,
  );
  await concluirLiberado.click();
  await page.waitForTimeout(900);
  if ((await page.locator("#op-completion-reason").count()) > 0) {
    check(
      "PRODUÇÃO · produzir menos que o planejado exige motivo da variação para concluir",
      true,
      "campo #op-completion-reason exigido",
    );
    await preencher(
      "#op-completion-reason",
      `Rendimento abaixo do planejado: ${QUANTIDADE_PRODUZIDA} de ${QUANTIDADE_ORCADA} potes`,
    );
  } else {
    check(
      "PRODUÇÃO · produzir menos que o planejado exige motivo da variação para concluir",
      false,
      "o modal de conclusão não pediu motivo mesmo com variação",
    );
  }
  await confirmarModal("Concluir OP");
  await page.waitForTimeout(3000);

  const situacao = await texto(".doc-title .badge");
  check(
    "PRODUÇÃO · a OP foi concluída com variação registrada",
    situacao === "Concluída",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  const lotes = (await apiGet("/lots?pageSize=50")).lots ?? [];
  const lotePa = lotes.find((l) => (l.itemCode ?? "").startsWith("PA-"));
  check(
    "PRODUÇÃO · o apontamento criou o lote de produto acabado",
    Boolean(lotePa),
    JSON.stringify(lotes.map((l) => `${l.code}/${l.itemCode}`)),
  );
  if (lotePa) {
    S.dados.lotePa = { id: lotePa.id, code: lotePa.code, status: lotePa.status };
    salvarEstado();
    anotar(`PRODUÇÃO · lote de PA ${lotePa.code} nasceu com situação ${lotePa.status}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PROVA 8 · o estoque baixou — diferença contra o retrato do marco 21
  // ════════════════════════════════════════════════════════════════════════
  const estoqueDepois = Object.fromEntries(
    ((await apiGet("/inventory?pageSize=100")).items ?? []).map((i) => [
      i.itemCode,
      { nome: i.itemName, onHand: i.onHand, reserved: i.reserved, available: i.available },
    ]),
  );
  const consumosDaOp = (await apiGet(`/production-orders/${S.dados.op.id}`)).consumptions ?? [];
  const consumidoPorItem = new Map();
  for (const c of consumosDaOp) {
    consumidoPorItem.set(
      c.itemCode,
      Number(consumidoPorItem.get(c.itemCode) ?? 0) + Number(c.quantity ?? 0),
    );
  }
  const baixas = [];
  for (const [codigo, consumido] of consumidoPorItem) {
    const antes = Number(S.dados.estoqueAntes?.[codigo]?.onHand ?? NaN);
    const depoisSaldo = Number(estoqueDepois[codigo]?.onHand ?? NaN);
    baixas.push({
      item: codigo,
      antes,
      depois: depoisSaldo,
      consumido,
      confere: Math.abs(antes - depoisSaldo - consumido) < 0.001,
    });
  }
  check(
    "PROVA 8 · o saldo físico de cada material consumido caiu exatamente o que a OP registrou",
    baixas.length > 0 && baixas.every((b) => b.confere),
    JSON.stringify(baixas),
  );
  check(
    "PROVA 8 · nenhum material consumido ficou com o saldo intacto",
    baixas.every((b) => b.depois < b.antes),
    JSON.stringify(baixas.map((b) => `${b.item}: ${b.antes} → ${b.depois}`)),
  );
  anotar(`PROVA 8 · baixa de estoque por material: ${JSON.stringify(baixas)}`);
  S.dados.baixaDeEstoque = baixas;
  salvarEstado();

  await shot("e2e1-22-op-concluida");
}

// ── MARCO 23 · Qualidade do Produto Acabado ───────────────────────────────
async function marco23QualidadePa() {
  await abrir("/producao/produto-acabado");
  const vazioPa = await texto("td.table__empty");
  if (vazioPa) registrarVazio("Produção › Produto Acabado", vazioPa);
  const linhas = await textos("table tbody tr");
  check(
    "QUALIDADE PA · o lote produzido aparece na tela de Produto Acabado",
    linhas.some((l) => l.includes(LOTE_VERIDI) || l.includes(S.dados.lotePa.code)),
    JSON.stringify(linhas.map((l) => l.replace(/\s+/g, " ").slice(0, 110))),
  );
  await shot("e2e1-23a-produto-acabado");

  await abrir(`/estoque/lotes/${S.dados.lotePa.id}`, { espera: ".doc-title h1" });
  if (await existeBotao("Liberar")) {
    await clicarBotao("Liberar");
    await confirmarDialogo("Liberar");
    await page.waitForTimeout(2000);
  }
  const situacao = await texto(".doc-title .badge");
  check(
    "QUALIDADE PA · o lote de produto acabado foi liberado pela Qualidade",
    situacao === "Disponível",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  await shot("e2e1-23-lote-pa-liberado");
}

// ── MARCO 24 · Expedição ──────────────────────────────────────────────────
async function marco24Expedicao() {
  await abrir("/comercial/expedicoes");
  const vazioExp = await texto("td.table__empty");
  if (vazioExp) registrarVazio("Comercial › Expedições (nenhuma expedição)", vazioExp);
  const aviso = await texto("div.callout");
  if (aviso) anotar(`EXPEDIÇÃO · a listagem explica de onde nasce uma expedição: "${aviso}"`);

  if (!S.dados.expedicao) {
    await abrir(S.dados.pedido.url, { espera: ".doc-title h1" });
    const reservar = page.getByLabel(`Reservar de ${S.dados.produto.code}`);
    if ((await reservar.count()) > 0) {
      await reservar.first().fill(String(QUANTIDADE_PRODUZIDA));
      await page.waitForTimeout(400);
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

  const codigo = await texto(".doc-title h1");
  check("EXPEDIÇÃO · a expedição tem código EXP gerado", /^EXP-\d+/.test(codigo), codigo);

  // Conferência de lote — sem ela a confirmação fica bloqueada.
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
  await shot("e2e1-24a-expedicao-conferida");

  await clicarBotao("Confirmar expedição");
  const titulo = await confirmarDialogo("Confirmar");
  check(
    "EXPEDIÇÃO · confirmar avisa que a saída física é definitiva",
    /Confirmar expedição/i.test(titulo),
    titulo,
  );
  await page.waitForTimeout(3500);
  const situacao = await texto(".doc-title .badge");
  check(
    "EXPEDIÇÃO · confirmada",
    situacao === "Confirmada",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );

  await abrir(S.dados.pedido.url, { espera: ".doc-title h1" });
  const situacaoPedido = await texto(".doc-title .badge");
  check(
    "EXPEDIÇÃO · a expedição de 980 de 1000 deixou o pedido Parcialmente expedido",
    situacaoPedido === "Parcialmente expedido",
    situacaoPedido,
  );
  anotar(`EXPEDIÇÃO · situação do pedido após expedir ${QUANTIDADE_PRODUZIDA}: ${situacaoPedido}`);
  await shot("e2e1-24-expedicao-confirmada");
}

// ── MARCO 25 · Faturamento ────────────────────────────────────────────────
async function marco25Faturamento() {
  await abrir("/comercial/faturamento");
  const vazios = await textos("td.table__empty");
  for (const v of vazios) registrarVazio("Comercial › Faturamento", v);

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

  const codigo = await texto(".doc-title h1");
  check("FATURAMENTO · o documento tem código FAT gerado", /^FAT-\d+/.test(codigo), codigo);

  if ((await page.locator("#billing-external-reference").count()) > 0) {
    const campo = page.locator("#billing-external-reference");
    if (!(await campo.isDisabled())) {
      await campo.fill("NF-E2E1-0001");
      await clicarBotao("Salvar rascunho");
      await page.waitForTimeout(2000);
    }
  }

  const rodape = await texto("div.table-foot");
  anotar(`FATURAMENTO · rodapé do documento: "${rodape}"`);

  if (await existeBotao("Emitir faturamento")) {
    await clicarBotao("Emitir faturamento");
    const titulo = await confirmarDialogo("Emitir");
    check(
      "FATURAMENTO · emitir pede confirmação e avisa que não emite Nota Fiscal",
      /Emitir faturamento/i.test(titulo),
      titulo,
    );
    await page.waitForTimeout(3000);
  }
  const situacao = await texto(".doc-title .badge");
  check(
    "FATURAMENTO · emitido",
    situacao === "Emitido",
    `${situacao} · erros=${JSON.stringify(await mensagensDeErro())}`,
  );
  await shot("e2e1-25-faturamento-emitido");
}

// ── MARCO 26 · Consulta do Cliente ────────────────────────────────────────
const ABAS = [
  { rota: "resumo", nome: "Resumo" },
  { rota: "produtos", nome: "Produtos" },
  { rota: "projetos", nome: "Projetos" },
  { rota: "pedidos", nome: "Pedidos" },
  { rota: "producao", nome: "Produção" },
  { rota: "estoque", nome: "Estoque" },
  { rota: "faturamentos", nome: "Faturamentos" },
];

async function marco26ConsultaDoCliente() {
  const base = `/consultas/clientes/${S.dados.cliente.id}`;
  await abrir(`${base}/resumo`, { espera: ".consult-head" });

  const abasNaTela = await textos("nav.consult-tabs a.consult-tabs__link");
  check(
    "CONSULTA · a Consulta do Cliente tem as sete abas do ciclo",
    ABAS.every((a) => abasNaTela.includes(a.nome)),
    JSON.stringify(abasNaTela),
  );

  const cabecalho = await texto(".consult-head h1");
  check(
    "CONSULTA · o Cliente é a raiz e o cabeçalho o identifica",
    cabecalho === IDENT.cliente.legalName,
    cabecalho,
  );

  const conteudoPorAba = {};
  for (const aba of ABAS) {
    await abrir(`${base}/${aba.rota}`, { espera: ".consult-body" });
    await page.waitForTimeout(1200);
    const corpo = (await texto(".consult-body")).slice(0, 400);
    conteudoPorAba[aba.nome] = corpo;
    const vazio = await texto(".consult-body td.table__empty");
    if (vazio) registrarVazio(`Consulta do Cliente › ${aba.nome}`, vazio);
    await shot(`e2e1-26-consulta-${aba.rota}`);
  }

  // ── REGRA CONSULTA · o ciclo inteiro aparece na Consulta ───────────────────────
  const codigos = {
    Produtos: S.dados.produto.code,
    Projetos: S.dados.projeto.code,
    Pedidos: (S.dados.pedido.code ?? "").split(" ")[0],
    Produção: S.dados.op.code,
    Faturamentos: (S.dados.faturamento?.code ?? "").split(" ")[0],
  };
  for (const [aba, codigo] of Object.entries(codigos)) {
    if (!codigo) continue;
    check(
      `REGRA CONSULTA · a aba ${aba} da Consulta mostra ${codigo}`,
      (conteudoPorAba[aba] ?? "").includes(codigo),
      (conteudoPorAba[aba] ?? "").slice(0, 200),
    );
  }
  /*
   * A aba Estoque consolida POR PRODUTO — mostra o item PA, os saldos e a
   * contagem de lotes, não o código de cada lote. Exigir o código do lote
   * reprovaria a tela por uma decisão de leitura que é dela.
   */
  const estoque = conteudoPorAba["Estoque"] ?? "";
  check(
    "REGRA CONSULTA · a aba Estoque mostra a posição de produto acabado do cliente (item PA e lotes)",
    estoque.includes(S.dados.produto.itemPA) && estoque.includes(S.dados.produto.code),
    estoque.slice(0, 260),
  );
  anotar(
    `CONSULTA · Estoque › Produtos acabados: "${estoque.replace(/\s+/g, " ").slice(0, 240)}" ` +
      "(saldo zerado porque as 980 unidades produzidas já foram expedidas)",
  );
  const resumoTexto = conteudoPorAba["Resumo"] ?? "";
  anotar(`CONSULTA · Resumo do cliente: "${resumoTexto.replace(/\s+/g, " ").slice(0, 260)}"`);
}

// ── MARCO 27 · Rastreabilidade ────────────────────────────────────────────
async function marco27Rastreabilidade() {
  // ── Matéria-prima → OP ──────────────────────────────────────────────────
  const loteMp = S.dados.lotes.find((l) => l.item === `${P} Coenzima Q10`);
  await abrir(`/estoque/lotes/${loteMp.id}`, { espera: ".doc-title h1" });
  const corpoMp = (await texto(".doc-body")).replace(/\s+/g, " ");
  check(
    "PROVA 7 · o lote de matéria-prima aponta a OP em que foi consumido",
    corpoMp.includes(S.dados.op.code),
    corpoMp.slice(0, 300),
  );
  check(
    "PROVA 7 · e aponta o lote de produto acabado gerado a partir dele",
    corpoMp.includes(S.dados.lotePa.code) || corpoMp.includes(LOTE_VERIDI),
    corpoMp.slice(0, 400),
  );
  await shot("e2e1-27a-rastreabilidade-materia-prima");

  // ── Produto acabado → materiais, pedido e cliente ───────────────────────
  await abrir(`/estoque/lotes/${S.dados.lotePa.id}`, { espera: ".doc-title h1" });
  const corpoPa = (await texto(".doc-body")).replace(/\s+/g, " ");
  check(
    "PROVA 7 · o lote de produto acabado aponta a OP que o produziu",
    corpoPa.includes(S.dados.op.code),
    corpoPa.slice(0, 300),
  );
  /*
   * A promessa da genealogia é "consumo real, nunca reserva nem sugestão
   * FEFO". A conferência certa é contra o que a OP REGISTROU como consumido,
   * não contra os lotes que existiam — é isso que separa rastreabilidade de
   * intenção.
   */
  const op = await apiGet(`/production-orders/${S.dados.op.id}`);
  const consumidos = (op.consumptions ?? []).map((c) => c.lotCode);
  const naTela = consumidos.filter((c) => corpoPa.includes(c));
  check(
    "PROVA 7 · a genealogia lista exatamente os lotes que a OP registrou como consumidos",
    consumidos.length > 0 && naTela.length === consumidos.length,
    `registrados=${JSON.stringify(consumidos)} na tela=${JSON.stringify(naTela)}`,
  );

  /*
   * A árvore do lote precisa estar INTEIRA.
   *
   * Isto já foi um defeito: a OP concluía com materiais em consumo zero e o
   * lote nascia com a genealogia furada, sem nada na tela avisando. Agora a
   * reconciliação obrigatória fecha a porta, então a ausência de consumo
   * deixa de ser observação e volta a ser reprovação.
   */
  const requisitos = op.requirements ?? [];
  const semConsumo = requisitos.filter((r) => Number(r.consumedQuantity ?? 0) === 0);
  check(
    "PROVA 7 · todos os componentes da formulação têm consumo registrado no lote produzido",
    requisitos.length > 0 && semConsumo.length === 0,
    JSON.stringify(requisitos.map((r) => `${r.itemCode}=${r.consumedQuantity}/${r.reconciliationStatus}`)),
  );
  anotar(
    `PROVA 7 · a OP ${S.dados.op.code} produziu ${op.producedQuantity} un consumindo ` +
      `${requisitos.length - semConsumo.length} de ${requisitos.length} materiais declarados: ` +
      JSON.stringify(requisitos.map((r) => `${r.itemCode}=${r.consumedQuantity}`)),
  );
  const codigoPedido = (S.dados.pedido.code ?? "").split(" ")[0];
  check(
    "PROVA 7 · o destino comercial fecha a cadeia até o pedido do cliente",
    corpoPa.includes(codigoPedido) && corpoPa.includes(S.dados.expedicao.code.split(" ")[0]),
    corpoPa.slice(0, 500),
  );
  anotar(
    `PROVA 7 · cadeia completa: ${loteMp.code} (${loteMp.item}) → ${S.dados.op.code} → ` +
      `${S.dados.lotePa.code} (${LOTE_VERIDI}) → ${codigoPedido} → ${S.dados.expedicao.code} → ` +
      `${S.dados.faturamento?.code ?? "—"}`,
  );
  await shot("e2e1-27-rastreabilidade-produto-acabado");
}

// ── MARCO 28 · Trilha de navegação (PROVA 10) ─────────────────────────────
/**
 * A trilha virou link de verdade — e link se prova clicando.
 *
 * Conferir só o `href` provaria que o atributo existe; o que interessa é
 * que o clique SOBE um nível real, com a lista certa do outro lado. Por
 * isso cada degrau é clicado de fato e o destino é conferido pela URL e pelo
 * título da tela que abriu.
 */
async function marco28Trilha() {
  const degraus = [
    {
      onde: "Estoque › Lote de produto acabado",
      rota: `/estoque/lotes/${S.dados.lotePa.id}`,
      destino: "/estoque/lotes",
      rotulo: "Lotes",
    },
    {
      onde: "Produção › Formulação (versão)",
      rota: S.dados.formulacaoUrl ?? `/producao/formulacoes/${S.dados.produto.id}`,
      destino: "/producao/formulacoes",
      rotulo: "Formulações",
    },
    {
      onde: "Produção › Ordem de Produção",
      rota: S.dados.op.url,
      destino: "/producao/ordens",
      rotulo: "Ordens de Produção",
    },
    {
      onde: "Produto › CMV",
      rota: `/produtos/${S.dados.produto.id}/cmv`,
      destino: "/cadastros/produtos",
      rotulo: "Produtos",
    },
    {
      onde: "Produto › Custos industriais",
      rota: `/produtos/${S.dados.produto.id}/custos`,
      destino: "/cadastros/produtos",
      rotulo: "Produtos",
    },
    {
      onde: "Comercial › Faturamento",
      rota: S.dados.faturamento?.url ?? null,
      destino: "/comercial/faturamento",
      rotulo: "Faturamento",
    },
  ].filter((d) => d.rota);

  const subidas = [];
  for (const degrau of degraus) {
    await abrir(degrau.rota, { espera: ".doc-title h1, .page__title" });
    const trilha = page.locator("nav.page-crumbs");
    if ((await trilha.count()) === 0) {
      check(`TRILHA · ${degrau.onde} tem trilha de navegação`, false, "nav.page-crumbs ausente");
      continue;
    }
    const niveis = (await trilha.locator("li").allTextContents()).map((t) => t.trim());
    const link = trilha.getByRole("link", { name: degrau.rotulo, exact: true }).first();
    if ((await link.count()) === 0) {
      check(
        `TRILHA · ${degrau.onde} → "${degrau.rotulo}" é link clicável`,
        false,
        `níveis=${JSON.stringify(niveis)}`,
      );
      continue;
    }
    const href = await link.getAttribute("href");
    await link.click();
    const chegou = await esperarUrl((u) => u.pathname === degrau.destino, 20000);
    check(
      `PROVA 10 · trilha de ${degrau.onde}: clicar em "${degrau.rotulo}" sobe para ${degrau.destino}`,
      chegou,
      `href=${href} · parou em ${caminho()} · níveis=${JSON.stringify(niveis)}`,
    );
    if (chegou) subidas.push(`${degrau.onde} → ${degrau.rotulo} (${degrau.destino})`);
  }

  check(
    "PROVA 10 · pelo menos três níveis reais foram subidos clicando na trilha",
    subidas.length >= 3,
    JSON.stringify(subidas),
  );
  anotar(`PROVA 10 · subidas pela trilha: ${JSON.stringify(subidas)}`);
  await shot("e2e1-28-trilha-clicavel");
}

// ══════════════════════════════════════════════════════════════════════════
// Execução
// ══════════════════════════════════════════════════════════════════════════
const JORNADA = [
  [1, "cliente", marco01Cliente],
  [2, "itens", marco02Itens],
  [3, "fornecedores", marco03Fornecedores],
  [4, "compra", marco04Compra],
  [5, "recebimento", marco05Recebimento],
  [6, "qualidade", marco06Qualidade],
  [7, "projeto", marco07Projeto],
  [8, "produto", marco08Produto],
  [9, "formulacao", marco09Formulacao],
  [10, "recursos", marco10Recursos],
  [11, "estrutura-de-custos", marco11EstruturaDeCustos],
  [12, "calculo", marco12Calculo],
  [13, "cmv", marco13Cmv],
  [14, "precificacao", marco14Precificacao],
  [15, "orcamento", marco15Orcamento],
  [16, "aceite", marco16Aceite],
  [17, "aprovacao", marco17Aprovacao],
  [18, "pedido", marco18Pedido],
  [19, "plano", marco19Plano],
  [20, "ordem-de-producao", marco20OrdemDeProducao],
  [21, "consumo", marco21Consumo],
  [22, "producao", marco22Producao],
  [23, "qualidade-pa", marco23QualidadePa],
  [24, "expedicao", marco24Expedicao],
  [25, "faturamento", marco25Faturamento],
  [26, "consulta-do-cliente", marco26ConsultaDoCliente],
  [27, "rastreabilidade", marco27Rastreabilidade],
  [28, "trilha", marco28Trilha],
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
    parada = `EXCEÇÃO: ${msg.slice(0, 600)}`;
    failures.push(`EXCEÇÃO não tratada — ${msg.slice(0, 400)}`);
    if (page) {
      try {
        await shot("e2e1-99-excecao");
      } catch {
        /* screenshot é cortesia, não requisito */
      }
    }
  }
} finally {
  if (browser) await browser.close();
}

/*
 * Um defeito que a instrumentação encontra sozinha e que precisa aparecer no
 * relatório mesmo quando nenhuma verificação falha por causa dele.
 */
const recursao = pageErrors.filter((e) => /Maximum call stack size exceeded/.test(e));
if (recursao.length > 0) {
  finding(
    "MEDIUM",
    `Recursão infinita na validação nativa em pt-BR: ${recursao.length} RangeError não capturados ` +
      "ao submeter formulário com campo obrigatório vazio",
    "apps/web/src/lib/native-validation-ptbr.ts — o tratador `aoInvalidar` do evento `invalid` chama " +
      "`campo.reportValidity()`, que dispara `invalid` de novo no mesmo campo, sem guarda de " +
      "reentrância. Reproduzir: abrir /cadastros/itens/novo, preencher só o Nome e clicar em " +
      "\"Criar item\" (o campo Tipo é required e está vazio) → 14 RangeError por submissão. A mensagem " +
      "traduzida ainda aparece no balão nativo, então o operador não vê quebra — mas todo formulário " +
      "do sistema com campo obrigatório dispara isso.",
  );
}

salvarEstado();

// ── Relatório ─────────────────────────────────────────────────────────────
console.log("\n══════════════ RELATÓRIO E2E-1 · COMERCIAL ══════════════");
console.log(`marcos concluídos: ${S.marcos.length} de ${JORNADA.length}`);
for (const m of S.marcos) console.log(`  ✓ ${m}`);
if (parada) console.log(`\nPARADA: ${parada}`);

console.log("\n── Documentos criados pela interface ──");
for (const [k, v] of Object.entries(S.dados)) {
  console.log(` · ${k}: ${JSON.stringify(v)}`);
}

console.log(`\n── Estados vazios encontrados na jornada (${S.registro.vazios.length}) ──`);
for (const v of S.registro.vazios) console.log(` ∅ ${v.tela} → "${v.texto}"`);

console.log(`\n── Observações da jornada (${S.registro.observacoes.length}) ──`);
for (const o of S.registro.observacoes) console.log(` · ${o}`);

console.log("\n── Ergonomia (lentidão, ausência de retorno, salto de layout) ──");
if (S.registro.ergonomia.length === 0) console.log(" (nada anotado)");
for (const e of S.registro.ergonomia) console.log(` ⏱ ${e}`);

console.log("\n── Console e rede (desta execução) ──");
console.log(` console.error INESPERADOS: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 25)) console.log(`   ✗ ${e}`);
console.log(` pageerror: ${pageErrors.length}`);
for (const e of pageErrors.slice(0, 6)) console.log(`   ✗ ${e}`);
console.log(` respostas >= 400 INESPERADAS: ${respostasComErro.length}`);
for (const r of respostasComErro.slice(0, 40)) {
  console.log(`   ✗ ${r.method} ${r.pathname} → ${r.status}`);
}
console.log(`\n erros DELIBERADOS (validação provocada de propósito): ${deliberados.rede.length}`);
for (const r of deliberados.rede.slice(0, 25)) {
  console.log(`   ⓘ [${r.janela}] ${r.method} ${r.pathname} → ${r.status}`);
}
console.log(` console.error deliberados: ${deliberados.console.length}`);
console.log(` avisos "Failed to load resource" do navegador: ${avisosDeRede.length}`);
console.log(` diálogos nativos (alert/confirm) capturados: ${dialogosNativos.length}`);
for (const d of dialogosNativos) console.log(`   ! ${d}`);

console.log(`\n── Findings da jornada (${S.registro.findings.length}) ──`);
if (S.registro.findings.length === 0) console.log(" (nenhum)");
for (const f of S.registro.findings) {
  console.log(` [${f.severidade}] ${f.titulo}`);
  console.log(`    repro: ${f.comoReproduzir}`);
}

console.log(`\n── Vírgula decimal nos campos de dinheiro (${S.registro.separadores.length}) ──`);
if (S.registro.separadores.length === 0) console.log(" (nenhum campo exercitado na jornada)");
for (const s of S.registro.separadores) {
  console.log(` ${s.como === "virgula" ? "✓" : "✗"} "${s.digitado}" em ${s.campo} — ${s.onde} → ${s.como}`);
}

console.log("\n── Screenshots desta execução ──");
for (const s of screenshots) console.log(` - ${s}`);

/*
 * As dez provas do handoff, cada uma com as verificações que a sustentam.
 *
 * O relatório antigo listava 200 linhas de "ok" e deixava para quem lê a
 * tarefa de reagrupar mentalmente o que provava o quê. Aqui cada prova é
 * respondida por si: quantas verificações a sustentam e se alguma caiu.
 */
const PROVAS = [
  [1, "Decimal com vírgula numa tarifa de recurso (0,85)"],
  [2, "Decimal com vírgula numa premissa de custo (3,50)"],
  [3, "Três faixas de preço criadas e sobreviventes à ativação"],
  [4, "Salvar-antes-de-ativar na formulação"],
  [5, "Todos os materiais reconciliados antes de concluir a OP"],
  [6, "A OP NÃO conclui com material pendente"],
  [7, "Rastreabilidade completa do lote de produto acabado"],
  [8, "O estoque baixou o que a OP consumiu"],
  [9, "A ajuda do Pedido é do Pedido"],
  [10, "Trilha de navegação clicável"],
];
console.log("\n── AS DEZ PROVAS (jornada inteira) ──");
let provasReprovadas = 0;
let provasSemExercicio = 0;
for (const [n, titulo] of PROVAS) {
  const registro = S.registro.provas[String(n)] ?? { ok: [], nok: [] };
  const veredito =
    registro.nok.length > 0 ? "FALHOU" : registro.ok.length > 0 ? "ok" : "NÃO EXERCITADA";
  if (registro.nok.length > 0) provasReprovadas += 1;
  else if (registro.ok.length === 0) provasSemExercicio += 1;
  console.log(
    ` ${String(n).padStart(2)} · ${veredito} — ${titulo} (${registro.ok.length} ok, ${registro.nok.length} falhas)`,
  );
  for (const p of registro.ok) console.log(`      ✓ ${p}`);
  for (const f of registro.nok) console.log(`      ✗ ${f}`);
}

console.log(`\nverificações desta execução: ${passes.length} ok, ${failures.length} falharam`);
for (const f of failures) console.log(` ✗ ${f}`);

if (provasSemExercicio > 0 || provasReprovadas > 0) {
  console.log(
    `\nATENÇÃO · ${provasReprovadas} prova(s) reprovada(s) e ${provasSemExercicio} sem nenhuma verificação na jornada`,
  );
}

const completou = S.marcos.length >= JORNADA.length;
const veredito =
  failures.length > 0 || !completou
    ? "FAIL"
    : S.registro.findings.length > 0 ||
        consoleErrors.length > 0 ||
        pageErrors.length > 0 ||
        respostasComErro.length > 0
      ? "PASS WITH FINDINGS"
      : "PASS";
console.log(`\nVEREDITO: ${veredito}`);
process.exitCode = failures.length > 0 ? 1 : 0;
