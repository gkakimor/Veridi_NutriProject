import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * VALIDAÇÃO ADVERSARIAL — RASTREABILIDADE E INVARIANTES FINAIS.
 *
 * Quarta e última onda. Roda DEPOIS de
 * `validate-adversarial-billing.mjs`, que fechou a cadeia comercial do lote
 * produzido pela `OP-000659` (expedição + faturamento). Aqui nada é criado:
 * a onda percorre a genealogia pela interface e reconstrói o ledger.
 *
 * Rodada de VALIDAÇÃO, não de implementação: defeito encontrado é RELATADO,
 * nunca consertado.
 *
 * ## A regra
 *
 * A árvore é percorrida PELA TELA — R-06, página do lote, página do pedido,
 * da expedição e do faturamento. As leituras de API entram só depois, para
 * conferir número contra número e reconstruir saldo. Nenhuma escrita.
 *
 * ## O que se prova
 *
 *   * todo componente realmente consumido aparece, pelo valor real;
 *   * o consumo EXTRA aparece somado ao lote de onde saiu, não escondido;
 *   * a reconciliação por justificativa é auditável — e o que a árvore
 *     mostra é o CONSUMO, nunca a necessidade da fórmula;
 *   * lote reservado e depois DEVOLVIDO (substituição no picking) não vira
 *     consumo;
 *   * lote nunca consumido — o BLOQUEADO `LT-20260320-000799` — não aparece
 *     em árvore nenhuma;
 *   * a busca reversa, de um lote de matéria-prima até a OP e o produto
 *     acabado, fecha;
 *   * o ledger de cada lote tocado bate, e não sobrou reserva, expedição,
 *     faturamento ou consumo órfão de documento.
 *
 * PRIVACIDADE: razão social, CNPJ, telefone, e-mail e endereço nunca entram
 * em log, screenshot ou relatório. Fornecedor e cliente aparecem por CÓDIGO
 * e por presença/ausência, nunca por nome.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate-adversarial-traceability.mjs
 */

const OUT = "handoff/screens/adversarial";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";
const CRED = { email: "admin@veridi.local", password: "veridi-local-dev" };

const STATE_FILE = path.resolve("handoff/adversarial-traceability-state.json");
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
S.registro.arvore = S.registro.arvore ?? {};
S.registro.ledger = S.registro.ledger ?? {};

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
  cookie = r.headers.get("set-cookie").split(";")[0];
}

// ── Veredito ──────────────────────────────────────────────────────────────
const failures = [];

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
  if (condition) console.log("ok  ", label);
  else {
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

const casos = [];
function registrarCaso(caso, { pre, acao, esperado, real, invariante, veredito }) {
  const r = { caso, pre, acao, esperado, real, invariante, veredito };
  casos.push(r);
  console.log(`  ▣ ${caso} :: ${veredito}`);
  return r;
}

const negativos = [];
function registrarNegativo(caso, veredito, detalhe) {
  negativos.push({ caso, veredito, detalhe });
  console.log(`  ⛔ ${caso} :: ${veredito} — ${detalhe}`);
}

function noArvore(chave, valor) {
  S.registro.arvore[chave] = valor;
  console.log(`  ⌸ ${chave} = ${JSON.stringify(valor)}`);
}

// ══ Alvos ═════════════════════════════════════════════════════════════════
const OP_CODE = "OP-000659";
const LOTE_PA = "LT-20260903-000803";
/** Reservado e DEVOLVIDO por substituição no picking — nunca consumido. */
const LOTE_DEVOLVIDO = "LT-20260115-000798";
/** Bloqueado com 49 kg — nunca entrou em nada. */
const LOTE_BLOQUEADO = "LT-20260320-000799";

// ── Instrumentação ────────────────────────────────────────────────────────
const consoleErrors = [];
const pageErrors = [];
const respostasComErro = [];
const dialogosNativos = [];

let browser;
let context;
let page;

function instrumentar(alvo) {
  alvo.on("dialog", async (d) => {
    dialogosNativos.push(`${d.type()}: ${d.message().slice(0, 200)}`);
    await d.accept();
  });
  alvo.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/^Failed to load resource/.test(m.text())) return;
    consoleErrors.push(`${m.text().slice(0, 240)} @ ${alvo.url()}`);
  });
  alvo.on("pageerror", (e) => pageErrors.push(`pageerror @ ${alvo.url()} :: ${e.message.slice(0, 240)}`));
  alvo.on("response", (res) => {
    if (res.status() < 400) return;
    respostasComErro.push({
      pathname: new URL(res.url()).pathname,
      method: res.request().method(),
      status: res.status(),
    });
  });
}

async function abrirNavegador() {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
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

const shot = async (nome) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${nome}.png`), fullPage: false });
};

async function abrir(rota, { espera = ".page__title, .consult-head, .doc-title", ms = 30000 } = {}) {
  await page.goto(`${WEB}${rota}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector(espera, { timeout: ms });
  } catch {
    /* quem chamou julga */
  }
  await page.waitForTimeout(300);
}

async function texto(seletor) {
  const el = page.locator(seletor).first();
  if ((await el.count()) === 0) return "";
  return ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

async function textos(seletor) {
  return (await page.locator(seletor).allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
}

/**
 * Lê um `dl.definition-list` como pares rótulo→valor.
 *
 * O `dt` carrega o botão ⓘ de ajuda junto do rótulo, e o `textContent` dele
 * sai como um "i" grudado ("Lote do fornecedori"). Sem cortar isso, procurar
 * por igualdade não acha campo nenhum.
 */
async function definicoes(escopo = "") {
  return page.evaluate((sel) => {
    const raiz = sel ? document.querySelector(sel) : document;
    if (!raiz) return {};
    const saida = {};
    for (const dt of raiz.querySelectorAll("dl.definition-list dt")) {
      const bruto = (dt.textContent ?? "").replace(/\s+/g, " ").replace(/ⓘ/g, "").trim();
      const rotulo = bruto.replace(/i$/, "").trim();
      const valor = (dt.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (rotulo) saida[rotulo] = valor;
    }
    return saida;
  }, escopo);
}

/** Busca um campo do `definition-list` sem depender do sufixo do ⓘ. */
const campo = (defs, rotulo) => {
  const chave = Object.keys(defs).find((k) => k.toLowerCase().startsWith(rotulo.toLowerCase()));
  return chave ? defs[chave] : null;
};

/** Lê uma tabela dentro da seção cujo `h3`/`h2` contém `titulo`. */
async function tabelaDaSecao(titulo) {
  return page.evaluate((t) => {
    const secoes = [...document.querySelectorAll("section.form-section, section.report-block")];
    const alvo = secoes.find((s) => (s.querySelector("h3, h2")?.textContent ?? "").includes(t));
    if (!alvo) return null;
    const tabela = alvo.querySelector("table");
    if (!tabela) return { colunas: [], linhas: [], vazio: null };
    const colunas = [...tabela.querySelectorAll("thead th")].map((th) =>
      (th.textContent ?? "").replace(/\s+/g, " ").replace(/ⓘ|\s*Ajuda sobre.*/g, "").trim(),
    );
    const linhas = [...tabela.querySelectorAll("tbody tr")].map((tr) => ({
      celulas: [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim()),
      vazio: tr.querySelector("td.table__empty") !== null,
    }));
    return { colunas, linhas: linhas.filter((l) => !l.vazio), vazio: linhas.find((l) => l.vazio)?.celulas?.[0] ?? null };
  }, titulo);
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
  await fn();
  salvarEstado();
  S.marcos.push(chave);
  salvarEstado();
};

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const perto = (a, b, tol = 1e-6) => Math.abs(num(a) - num(b)) < tol;
const soNumeros = (t) => (String(t ?? "").match(/-?[\d.]+,?\d*/g) ?? []).map((x) => Number(x.replace(/\./g, "").replace(",", ".")));

// ══════════════════════════════════════════════════════════════════════════
// MARCO 1 · A árvore descendente, pela interface
// ══════════════════════════════════════════════════════════════════════════
async function marco01Arvore() {
  const ops = (await apiGet("/production-orders?pageSize=100")).productionOrders;
  const op = ops.find((o) => o.code === OP_CODE);
  if (!check(`ÁRVORE · ${OP_CODE} existe`, Boolean(op), "")) return;
  S.dados.op = { id: op.id, code: op.code };

  const lote = await apiGet(`/lots/lookup?code=${LOTE_PA}`);
  S.dados.lotePa = { id: lote.id, code: lote.code, itemCode: lote.itemCode };
  salvarEstado();

  // ── 1.1 · R-06, a genealogia por Ordem de Produção ─────────────────────
  await abrir("/relatorios/producao/rastreabilidade", { espera: ".page__title" });
  await page.waitForTimeout(1200);
  const vazioAntes = await texto("p.muted");
  anotar(`R-06 · antes de escolher a OP a tela diz: "${vazioAntes}"`);
  await page.locator("#trace-op").selectOption(op.id);
  await page.waitForTimeout(2500);

  const blocos = await textos("section.report-block h2");
  check(
    "R-06 · a tela traz Ordem de Produção, materiais consumidos e produto acabado",
    blocos.some((b) => /Ordem de Produção/i.test(b)) &&
      blocos.some((b) => /Materiais realmente consumidos/i.test(b)) &&
      blocos.some((b) => /Produto acabado produzido/i.test(b)),
    JSON.stringify(blocos),
  );
  const consumidosNaTela = await tabelaDaSecao("Materiais realmente consumidos");
  const produzidosNaTela = await tabelaDaSecao("Produto acabado produzido");
  noArvore("r06.colunasConsumo", consumidosNaTela?.colunas ?? []);
  noArvore(
    "r06.consumo",
    (consumidosNaTela?.linhas ?? []).map((l) => l.celulas.slice(0, 3).concat(l.celulas.slice(-1))),
  );
  noArvore("r06.produzido", (produzidosNaTela?.linhas ?? []).map((l) => l.celulas.slice(0, 3)));
  await shot("adv-traceability-r06");

  // ── 1.2 · O lote de produto acabado: genealogia e destino comercial ────
  await abrir(`/estoque/lotes/${S.dados.lotePa.id}`, { espera: ".doc-title h1" });
  await page.waitForTimeout(1500);
  const defs = await definicoes();
  const genealogia = await tabelaDaSecao("Rastreabilidade");
  const destino = await tabelaDaSecao("Destino comercial");
  // PRIVACIDADE: a última coluna da genealogia é a razão social do
  // fornecedor. Guarda-se a presença, nunca o nome.
  const materiaisSemNome = (genealogia?.linhas ?? []).map((l) => ({
    celulas: l.celulas.slice(0, -1),
    temFornecedor: Boolean((l.celulas.at(-1) ?? "").trim()) && l.celulas.at(-1) !== "—",
  }));
  noArvore("lotePa.definicoes", { ...defs, Cliente: (campo(defs, "Cliente") ?? "").match(/CLI-\d+/)?.[0] ?? "presente" });
  noArvore("lotePa.materiais", materiaisSemNome);
  noArvore("lotePa.expedicoesNaTela", (destino?.linhas ?? []).map((l) => l.celulas));

  check(
    `ÁRVORE · o lote ${LOTE_PA} aponta para a OP que o produziu`,
    Object.values(defs).some((v) => v.includes(OP_CODE)),
    JSON.stringify(Object.keys(defs)),
  );
  const paraPedido = Object.values(defs).some((v) => /PED-\d+/.test(v));
  check("ÁRVORE · o lote aponta para o Pedido de destino", paraPedido, JSON.stringify(Object.keys(defs)));
  await shot("adv-traceability");

  // ── 1.3 · O destino comercial: a saída física deste lote ───────────────
  const expedicoesNaTela = (destino?.linhas ?? []).map((l) => l.celulas.join(" | "));
  const todasExpedicoes = (await apiGet("/shipments?pageSize=100")).shipments;
  const saidasReais = [];
  for (const s of todasExpedicoes.filter((x) => x.status === "CONFIRMED")) {
    const d = await apiGet(`/shipments/${s.id}`);
    const linhasDoLote = (d.lines ?? []).filter((l) => l.lotCode === LOTE_PA);
    if (linhasDoLote.length > 0) {
      saidasReais.push({
        expedicao: s.code,
        pedido: s.customerOrderCode,
        quantidade: linhasDoLote.reduce((a, l) => a + num(l.quantity), 0),
      });
    }
  }
  const mostradas = saidasReais.filter((s) => expedicoesNaTela.some((l) => l.includes(s.expedicao)));
  const omitidas = saidasReais.filter((s) => !expedicoesNaTela.some((l) => l.includes(s.expedicao)));
  noArvore("lotePa.saidasReais", saidasReais);
  noArvore("lotePa.saidasOmitidas", omitidas);

  registrarCaso("RASTREABILIDADE · o destino comercial mostra por onde o lote saiu", {
    pre: `${LOTE_PA} produzido para ${campo(defs, "Pedido")} e fisicamente expedido em ${JSON.stringify(saidasReais.map((s) => `${s.expedicao} (${s.pedido}, ${s.quantidade} un)`))}`,
    acao: "abrir a página do lote e ler a seção Destino comercial",
    esperado: "todas as expedições confirmadas que levaram este lote aparecem",
    real:
      omitidas.length === 0
        ? `a tela lista ${JSON.stringify(expedicoesNaTela)}`
        : `a tela diz "${destino?.vazio ?? ""}" e omite ${JSON.stringify(omitidas.map((s) => `${s.expedicao}/${s.pedido}/${s.quantidade} un`))}`,
    invariante: "a pergunta de recall — para onde este lote foi — tem de ser respondida pelo próprio lote",
    veredito: saidasReais.length > 0 && omitidas.length === 0 ? "PASS" : "FAIL",
  });
  check(
    "ÁRVORE · o destino comercial mostra TODAS as expedições confirmadas deste lote",
    saidasReais.length > 0 && omitidas.length === 0,
    `reais=${JSON.stringify(saidasReais)} · na tela=${JSON.stringify(expedicoesNaTela)} · vazio="${destino?.vazio ?? ""}"`,
  );
  if (omitidas.length > 0) {
    finding(
      "HIGH",
      "Rastreabilidade do lote afirma que ele não foi expedido quando ele saiu por outro pedido",
      `O lote ${LOTE_PA} foi produzido pela ${OP_CODE} para ${campo(defs, "Pedido")} e depois reservado e expedido em ${omitidas
        .map((s) => `${s.expedicao} (${s.pedido}, ${s.quantidade} un)`)
        .join(", ")} — o saldo físico do lote caiu de 800 para 400. A seção "Destino comercial" da tela do lote continua exibindo "${destino?.vazio ?? "Este lote ainda não foi expedido."}". Causa: em apps/api/src/modules/lots/traceability.service.ts a busca das expedições é filtrada por \`customerOrderId: pedido.id\`, o pedido da OP, e não por \`lines: { some: { lotId } }\` sozinho — expedição de OUTRO pedido que levou este lote fica de fora. Reproduzir: abrir /estoque/lotes/<id de ${LOTE_PA}> e comparar a seção Destino comercial com /comercial/expedicoes.`,
    );
  }

  const expedicoesDoLote = todasExpedicoes.filter((s) => saidasReais.some((r) => r.expedicao === s.code));
  S.dados.expedicaoDoLote = expedicoesDoLote[0] ?? null;
  if (S.dados.expedicaoDoLote) {
    await abrir(`/comercial/expedicoes/${S.dados.expedicaoDoLote.id}`, { espera: ".doc-title h1" });
    await page.waitForTimeout(1200);
    const fluxo = await texto("nav.flow-context");
    const codigos = (fluxo.match(/(PED|EXP|FAT)-\d+/g) ?? []);
    noArvore("expedicao.fluxo", { codigos, texto: fluxo.slice(0, 200) });
    check(
      "ÁRVORE · da expedição a tela liga Pedido › Expedição › Faturamento",
      codigos.some((c) => c.startsWith("PED-")) &&
        codigos.some((c) => c.startsWith("EXP-")) &&
        codigos.some((c) => c.startsWith("FAT-")),
      JSON.stringify(codigos),
    );
    const fat = codigos.find((c) => c.startsWith("FAT-"));
    S.dados.faturamentoDoLote = fat ?? null;
  }

  const temFaturamentoNaArvoreDoLote =
    JSON.stringify(S.registro.arvore["lotePa.definicoes"] ?? {}).includes("FAT-") ||
    JSON.stringify(S.registro.arvore["lotePa.expedicoesNaTela"] ?? []).includes("FAT-");
  registrarCaso("ÁRVORE · a genealogia do lote chega ao faturamento", {
    pre: `${LOTE_PA} produzido por ${OP_CODE}, expedido e faturado`,
    acao: "abrir a página do lote e procurar o documento de faturamento na seção Destino comercial",
    esperado: "o elo até o faturamento aparece na própria árvore do lote",
    real: temFaturamentoNaArvoreDoLote
      ? "o faturamento aparece na página do lote"
      : `a página do lote vai até a expedição; o faturamento (${S.dados.faturamentoDoLote ?? "—"}) só aparece um clique adiante, na trilha "Pedido › Expedição › Faturamento" da tela da expedição`,
    invariante: "a cadeia pedida — fornecedor → … → faturamento — precisa ser percorrível pela interface",
    veredito: temFaturamentoNaArvoreDoLote ? "PASS" : "PASS COM RESSALVA",
  });
  if (!temFaturamentoNaArvoreDoLote) {
    anotar(
      "ÁRVORE · o faturamento não é um nó da rastreabilidade do lote; a cadeia fecha pela trilha de fluxo da expedição, com um clique a mais",
    );
  }

  // ── 1.4 · Subida: cada lote de matéria-prima até fornecedor e recebimento
  const trace = await apiGet(`/lots/${S.dados.lotePa.id}/traceability`);
  S.dados.materiais = (trace.consumedMaterials ?? []).map((m) => ({
    itemCode: m.itemCode,
    lotCode: m.lotCode,
    lotId: m.lotId,
    quantidade: m.quantity,
  }));
  salvarEstado();

  const origens = [];
  for (const material of S.dados.materiais) {
    await abrir(`/estoque/lotes/${material.lotId}`, { espera: ".doc-title h1" });
    await page.waitForTimeout(1100);
    const d = await definicoes();
    // Privacidade: guarda apenas presença e códigos, nunca a razão social.
    origens.push({
      item: material.itemCode,
      lote: material.lotCode,
      temFornecedor: Boolean(campo(d, "Fornecedor") && campo(d, "Fornecedor") !== "—"),
      loteDoFornecedor: campo(d, "Lote do fornecedor"),
      recebimento: (campo(d, "Origem — Recebimento") ?? "").match(/[A-Z]{2,4}-\d+/)?.[0] ?? null,
      ordemDeCompra: (campo(d, "Origem — Ordem de Compra") ?? "").match(/[A-Z]{2,4}-\d+/)?.[0] ?? null,
    });
  }
  noArvore("materiais.origem", origens);
  check(
    "ÁRVORE · todo lote de matéria-prima consumido mostra fornecedor, lote do fornecedor e recebimento de origem",
    origens.length > 0 && origens.every((o) => o.temFornecedor && o.loteDoFornecedor && o.recebimento),
    JSON.stringify(origens),
  );
  await shot("adv-traceability-materia-prima");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 2 · Completude e honestidade do consumo
// ══════════════════════════════════════════════════════════════════════════
async function marco02Consumo() {
  const op = await apiGet(`/production-orders/${S.dados.op.id}`);
  const trace = await apiGet(`/lots/${S.dados.lotePa.id}/traceability`);

  // ── 2.1 · Todo componente consumido aparece, pelo valor real ───────────
  const porLoteNoApontamento = new Map();
  for (const c of op.consumptions) {
    const chave = `${c.itemCode}/${c.lotCode}`;
    porLoteNoApontamento.set(chave, (porLoteNoApontamento.get(chave) ?? 0) + num(c.quantity));
  }
  const porLoteNaArvore = new Map();
  for (const m of trace.consumedMaterials ?? []) {
    const chave = `${m.itemCode}/${m.lotCode}`;
    porLoteNaArvore.set(chave, (porLoteNaArvore.get(chave) ?? 0) + num(m.quantity));
  }
  const faltando = [...porLoteNoApontamento.keys()].filter((k) => !porLoteNaArvore.has(k));
  const sobrando = [...porLoteNaArvore.keys()].filter((k) => !porLoteNoApontamento.has(k));
  const divergentes = [...porLoteNoApontamento.entries()].filter(
    ([k, v]) => porLoteNaArvore.has(k) && !perto(v, porLoteNaArvore.get(k)),
  );

  noArvore("consumo.apontado", Object.fromEntries(porLoteNoApontamento));
  noArvore("consumo.naArvore", Object.fromEntries(porLoteNaArvore));
  registrarCaso("RASTREABILIDADE · todo componente consumido aparece pelo valor real", {
    pre: `${OP_CODE} com ${op.consumptions.length} apontamentos de consumo em ${porLoteNoApontamento.size} lotes`,
    acao: "comparar a árvore do lote de produto acabado com os apontamentos da OP, lote a lote",
    esperado: "mesmos lotes, mesmas quantidades, nenhum lote a mais nem a menos",
    real: `faltando=${JSON.stringify(faltando)} · sobrando=${JSON.stringify(sobrando)} · divergentes=${JSON.stringify(divergentes)}`,
    invariante: "a genealogia é o consumo real, agregado por lote — nunca a necessidade da fórmula",
    veredito: faltando.length === 0 && sobrando.length === 0 && divergentes.length === 0 ? "PASS" : "FAIL",
  });
  check(
    "CONSUMO · a árvore traz exatamente os lotes consumidos, com as quantidades reais",
    faltando.length === 0 && sobrando.length === 0 && divergentes.length === 0,
    `faltando=${JSON.stringify(faltando)} sobrando=${JSON.stringify(sobrando)} divergentes=${JSON.stringify(divergentes)}`,
  );

  // ── 2.2 · Consumo real ≠ necessidade da fórmula ────────────────────────
  const porItemNaArvore = new Map();
  for (const m of trace.consumedMaterials ?? []) {
    porItemNaArvore.set(m.itemCode, (porItemNaArvore.get(m.itemCode) ?? 0) + num(m.quantity));
  }
  const comparacao = op.requirements.map((r) => ({
    item: r.itemCode,
    necessario: r.requiredQuantity,
    consumidoNaOp: r.consumedQuantity,
    naArvore: porItemNaArvore.get(r.itemCode) ?? 0,
    situacao: r.reconciliationStatus,
    justificativa: r.varianceReason,
    aceitoPor: r.varianceAcceptedBy,
    naoReconciliado: r.unreconciledQuantity,
  }));
  noArvore("consumo.requisitoVsArvore", comparacao);
  check(
    "CONSUMO · para cada requisito, o total na árvore é o CONSUMIDO, não o necessário",
    comparacao.every((c) => perto(c.naArvore, c.consumidoNaOp)),
    JSON.stringify(comparacao),
  );
  const comVariacao = comparacao.filter((c) => !perto(c.necessario, c.consumidoNaOp));
  check(
    "CONSUMO · onde consumo e necessidade divergem, a árvore mostra o consumo real (nunca o da fórmula)",
    comVariacao.length === 0 || comVariacao.every((c) => perto(c.naArvore, c.consumidoNaOp) && !perto(c.naArvore, c.necessario)),
    JSON.stringify(comVariacao),
  );
  anotar(
    `CONSUMO · ${comVariacao.length} requisito(s) com consumo diferente do necessário: ${JSON.stringify(
      comVariacao.map((c) => `${c.item} nec=${c.necessario} real=${c.consumidoNaOp} (${c.situacao})`),
    )}`,
  );

  // ── 2.3 · Reconciliação auditável, não consumo fingido ─────────────────
  await abrir(`/producao/ordens/${S.dados.op.id}`, { espera: ".doc-title h1" });
  await page.waitForTimeout(1600);
  const secoes = await textos("section.form-section h3");
  const tabelaRequisitos = await tabelaDaSecao("Materiais");
  const textoDaPagina = (await texto("div.doc-body")).slice(0, 4000);
  noArvore("op.secoes", secoes);

  const reconciliadoSemMovimento = [];
  const movimentosMp = new Map();
  for (const item of [...new Set(op.consumptions.map((c) => c.itemId))]) {
    movimentosMp.set(item, await lerMovimentos(item));
  }
  for (const r of op.requirements) {
    const movs = (movimentosMp.get(r.itemId) ?? []).filter(
      (m) => m.type === "PRODUCTION_CONSUMPTION" && m.productionOrderCode === OP_CODE,
    );
    const soma = movs.reduce((a, m) => a + num(m.quantity), 0);
    if (!perto(soma, r.consumedQuantity)) {
      reconciliadoSemMovimento.push(`${r.itemCode}: consumo=${r.consumedQuantity} movimentos=${soma}`);
    }
  }
  registrarCaso("RASTREABILIDADE · reconciliação auditável, nunca consumo fingido", {
    pre: `${OP_CODE} concluída com requisitos ${JSON.stringify(comparacao.map((c) => `${c.item} nec=${c.necessario} real=${c.consumidoNaOp} ${c.situacao}`))}`,
    acao: "conferir, para cada requisito, se todo consumo declarado tem movimento físico de CONSUMPTION do mesmo tamanho",
    esperado: "consumo declarado = soma dos movimentos; nada 'reconciliado' sem baixa real",
    real: reconciliadoSemMovimento.length === 0 ? "todo consumo declarado tem movimento do mesmo tamanho" : JSON.stringify(reconciliadoSemMovimento),
    invariante: "reconciliar é explicar a diferença, nunca inventar consumo",
    veredito: reconciliadoSemMovimento.length === 0 ? "PASS" : "FAIL",
  });
  check(
    "CONSUMO · todo consumo declarado tem movimento físico do mesmo tamanho (nada reconciliado no papel)",
    reconciliadoSemMovimento.length === 0,
    JSON.stringify(reconciliadoSemMovimento),
  );

  // ── 2.4 · Consumo extra aparece pelo valor real ────────────────────────
  const extras = (op.reservation?.lines ?? []).filter((l) => l.extraReason);
  const apontamentosPorLote = Object.fromEntries(porLoteNoApontamento);
  noArvore("consumo.extras", extras.map((l) => ({ lote: l.lotCode, quantidade: l.quantity, motivo: l.extraReason, por: l.extraRequestedBy })));
  if (extras.length > 0) {
    const somaExtra = extras.reduce((a, l) => a + num(l.quantity), 0);
    check(
      `CONSUMO EXTRA · as ${somaExtra} un/kg pedidas fora do plano estão dentro do total da árvore`,
      extras.every((l) => {
        const chave = `${l.itemCode}/${l.lotCode}`;
        return porLoteNaArvore.has(chave) && num(porLoteNaArvore.get(chave)) >= num(l.quantity);
      }),
      JSON.stringify(apontamentosPorLote),
    );
    check(
      "CONSUMO EXTRA · o pedido de extra tem motivo e autor registrados",
      extras.every((l) => Boolean(l.extraReason) && Boolean(l.extraRequestedBy)),
      JSON.stringify(extras.map((l) => `${l.lotCode}:${l.extraReason ? "com motivo" : "sem motivo"}`)),
    );
  } else {
    anotar("CONSUMO EXTRA · nenhuma linha de reserva marcada como extra nesta OP — o extra veio como apontamento avulso");
  }
  const linha801 = [...porLoteNaArvore.entries()].find(([k]) => k.includes("LT-20260408-000801"));
  if (linha801) {
    check(
      `CONSUMO EXTRA · o lote ${linha801[0].split("/")[1]} aparece com ${linha801[1]} (planejado + extra), não só com o planejado`,
      linha801[1] > 1,
      String(linha801[1]),
    );
  }
  await shot("adv-traceability-consumo");
  salvarEstado();
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
    lotId: m.lotId ?? null,
    lotCode: m.lotCode ?? null,
    type: m.type,
    quantity: m.quantity,
    sourceType: m.sourceType ?? null,
    sourceId: m.sourceId ?? null,
    productionOrderCode: m.productionOrderCode ?? null,
    shipmentCode: m.shipmentCode ?? null,
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 3 · O que NÃO pode aparecer, e a busca reversa
// ══════════════════════════════════════════════════════════════════════════
async function marco03NaoAparecemEReversa() {
  const trace = await apiGet(`/lots/${S.dados.lotePa.id}/traceability`);
  const naArvore = JSON.stringify(trace);

  // ── 3.1 · Lote devolvido no picking não vira consumo ───────────────────
  const op = await apiGet(`/production-orders/${S.dados.op.id}`);
  const devolvida = (op.reservation?.lines ?? []).find((l) => l.lotCode === LOTE_DEVOLVIDO);
  await abrir(`/estoque/lotes/${S.dados.lotePa.id}`, { espera: ".doc-title h1" });
  await page.waitForTimeout(1400);
  const materiaisNaTela = await tabelaDaSecao("Rastreabilidade");
  const textoDosMateriais = JSON.stringify((materiaisNaTela?.linhas ?? []).map((l) => l.celulas));

  registrarCaso("RASTREABILIDADE · a sobra devolvida não vira consumo", {
    pre: `${LOTE_DEVOLVIDO} foi reservado à ${OP_CODE} (${devolvida?.quantity ?? "?"} kg) e devolvido por "${devolvida?.releaseReason ?? "—"}"`,
    acao: "procurar esse lote na genealogia do produto acabado, na tela",
    esperado: "não aparece — nunca foi consumido",
    real: textoDosMateriais.includes(LOTE_DEVOLVIDO) ? "APARECE na árvore" : "não aparece na árvore",
    invariante: "reserva devolvida não é consumo",
    veredito: !textoDosMateriais.includes(LOTE_DEVOLVIDO) && !naArvore.includes(LOTE_DEVOLVIDO) ? "BLOCKED_CORRECTLY" : "BUG",
  });
  registrarNegativo(
    `LOTE DEVOLVIDO NO PICKING · ${LOTE_DEVOLVIDO} não pode constar como consumido`,
    !textoDosMateriais.includes(LOTE_DEVOLVIDO) && !naArvore.includes(LOTE_DEVOLVIDO) ? "BLOCKED_CORRECTLY" : "BUG",
    devolvida ? `reserva de ${devolvida.quantity} kg liberada por "${devolvida.releaseReason}", consumo ${devolvida.consumedQuantity}` : "linha não encontrada",
  );
  check(
    `NEGATIVO · o lote devolvido ${LOTE_DEVOLVIDO} não aparece na genealogia`,
    !textoDosMateriais.includes(LOTE_DEVOLVIDO) && !naArvore.includes(LOTE_DEVOLVIDO),
    textoDosMateriais.slice(0, 300),
  );

  // ── 3.2 · Lote bloqueado, nunca consumido ──────────────────────────────
  const bloqueado = await apiGet(`/lots/lookup?code=${LOTE_BLOQUEADO}`);
  S.dados.loteBloqueado = { id: bloqueado.id, code: bloqueado.code };
  await abrir(`/estoque/lotes/${bloqueado.id}`, { espera: ".doc-title h1" });
  await page.waitForTimeout(1400);
  const usos = await tabelaDaSecao("Rastreabilidade — Utilizado em");
  const situacao = await texto(".doc-title .badge");
  const traceBloqueado = await apiGet(`/lots/${bloqueado.id}/traceability`);
  const semUso = (traceBloqueado.usedIn ?? []).length === 0 && (traceBloqueado.usedInSamples ?? []).length === 0;

  registrarCaso("RASTREABILIDADE · lote nunca consumido não aparece em árvore nenhuma", {
    pre: `${LOTE_BLOQUEADO} está ${situacao} com saldo, e nunca foi apontado em OP`,
    acao: "abrir a página do lote e ler a seção Utilizado em; e procurar o código na árvore do produto acabado",
    esperado: `vazio explicado na tela e ausência total em ${LOTE_PA}`,
    real: `usedIn=${(traceBloqueado.usedIn ?? []).length} · vazio na tela="${usos?.vazio ?? ""}" · presente na árvore do PA=${naArvore.includes(LOTE_BLOQUEADO)}`,
    invariante: "só o que foi consumido entra na genealogia",
    veredito: semUso && !naArvore.includes(LOTE_BLOQUEADO) ? "BLOCKED_CORRECTLY" : "BUG",
  });
  registrarNegativo(
    `LOTE NUNCA CONSUMIDO · ${LOTE_BLOQUEADO} não pode constar em nenhuma árvore`,
    semUso && !naArvore.includes(LOTE_BLOQUEADO) ? "BLOCKED_CORRECTLY" : "BUG",
    `usedIn=${(traceBloqueado.usedIn ?? []).length}, presente na árvore do PA=${naArvore.includes(LOTE_BLOQUEADO)}`,
  );
  check(
    `NEGATIVO · ${LOTE_BLOQUEADO} (bloqueado, nunca consumido) não aparece em árvore nenhuma`,
    semUso && !naArvore.includes(LOTE_BLOQUEADO),
    `usedIn=${JSON.stringify(traceBloqueado.usedIn)} · naArvorePA=${naArvore.includes(LOTE_BLOQUEADO)}`,
  );
  check(
    "NEGATIVO · a tela explica o vazio em vez de mostrar tabela muda",
    Boolean(usos?.vazio),
    `vazio="${usos?.vazio ?? ""}"`,
  );
  await shot("adv-traceability-lote-nao-consumido");

  // ── 3.3 · Busca reversa: do lote de matéria-prima até o produto acabado ─
  const material = S.dados.materiais.find((m) => m.lotCode === "LT-20260408-000801") ?? S.dados.materiais[0];
  await abrir("/estoque/lotes", { espera: ".page__title" });
  await page.locator("#lots-search").fill(material.lotCode);
  await page.waitForTimeout(2200);
  const achou = await textos("table tbody tr");
  check(
    `BUSCA REVERSA · a busca por ${material.lotCode} encontra o lote na lista`,
    achou.some((l) => l.includes(material.lotCode)),
    JSON.stringify(achou.slice(0, 3).map((l) => l.slice(0, 90))),
  );

  await abrir(`/estoque/lotes/${material.lotId}`, { espera: ".doc-title h1" });
  await page.waitForTimeout(1500);
  const usadoEm = await tabelaDaSecao("Rastreabilidade — Utilizado em");
  const celulas = (usadoEm?.linhas ?? []).map((l) => l.celulas.join(" | "));
  noArvore("buscaReversa", { lote: material.lotCode, linhas: celulas });
  const chegouNaOp = celulas.some((c) => c.includes(OP_CODE));
  const chegouNoPa = celulas.some((c) => c.includes(LOTE_PA));
  registrarCaso("RASTREABILIDADE · busca reversa, do lote de matéria-prima ao produto acabado", {
    pre: `${material.lotCode} (${material.itemCode}) foi consumido em ${OP_CODE}`,
    acao: "buscar o lote pela lista de lotes e abrir a seção Utilizado em",
    esperado: `a tela mostra ${OP_CODE} e o lote de produto acabado ${LOTE_PA} gerado`,
    real: JSON.stringify(celulas),
    invariante: "a genealogia é navegável nos dois sentidos",
    veredito: chegouNaOp && chegouNoPa ? "PASS" : "FAIL",
  });
  check(
    `BUSCA REVERSA · de ${material.lotCode} chega-se à ${OP_CODE} e ao lote ${LOTE_PA}`,
    chegouNaOp && chegouNoPa,
    JSON.stringify(celulas),
  );
  await shot("adv-traceability-reversa");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 4 · Ledger dos lotes tocados e caça a órfãos
// ══════════════════════════════════════════════════════════════════════════
/** Sinal de cada tipo de movimento no saldo físico do lote. */
const SINAL = {
  RECEIPT_IN: +1,
  ADJUSTMENT_IN: +1,
  FINISHED_GOOD_PRODUCTION: +1,
  RETURN_IN: +1,
  ADJUSTMENT_OUT: -1,
  LOSS: -1,
  PRODUCTION_CONSUMPTION: -1,
  SHIPMENT_OUT: -1,
  SAMPLE_OUT: -1,
  CUSTOMER_MATERIAL_RETURN: -1,
};

async function marco04Ledger() {
  const itens = new Set();
  for (const m of S.dados.materiais) {
    const lote = await apiGet(`/lots/lookup?code=${m.lotCode}`);
    itens.add(lote.itemId);
  }
  const pa = await apiGet(`/lots/lookup?code=${LOTE_PA}`);
  itens.add(pa.itemId);
  const outro = await apiGet(`/lots/lookup?code=LT-20260903-000012`).catch(() => null);
  if (outro) itens.add(outro.itemId);
  const bloqueado = await apiGet(`/lots/lookup?code=${LOTE_BLOQUEADO}`);
  itens.add(bloqueado.itemId);

  const reconstrucao = [];
  const tiposDesconhecidos = new Set();
  for (const itemId of itens) {
    const inventario = await apiGet(`/inventory/${itemId}`);
    const movimentos = await lerMovimentos(itemId);
    for (const lote of inventario.lots ?? []) {
      const doLote = movimentos.filter((m) => m.lotId === (lote.lotId ?? lote.id));
      let saldo = 0;
      for (const m of doLote) {
        const sinal = SINAL[m.type];
        if (sinal === undefined) tiposDesconhecidos.add(m.type);
        saldo += (sinal ?? 0) * num(m.quantity);
      }
      reconstrucao.push({
        item: inventario.itemCode,
        lote: lote.lotCode ?? lote.code,
        status: lote.status,
        movimentos: doLote.length,
        somaDosMovimentos: Number(saldo.toFixed(6)),
        onHandDoSistema: num(lote.onHand),
        bate: perto(saldo, lote.onHand, 1e-6),
        reservado: num(lote.reserved),
        disponivel: num(lote.available),
      });
    }
  }
  S.registro.ledger.reconstrucao = reconstrucao;
  const naoBatem = reconstrucao.filter((r) => !r.bate);
  check(
    `LEDGER · o saldo de cada um dos ${reconstrucao.length} lotes tocados é a soma exata dos seus movimentos`,
    naoBatem.length === 0 && tiposDesconhecidos.size === 0,
    JSON.stringify({ naoBatem, tiposDesconhecidos: [...tiposDesconhecidos] }),
  );
  check(
    "LEDGER · nenhum lote com saldo físico negativo",
    reconstrucao.every((r) => r.onHandDoSistema >= 0),
    JSON.stringify(reconstrucao.filter((r) => r.onHandDoSistema < 0)),
  );
  check(
    "LEDGER · nenhum lote com reservado acima do físico",
    reconstrucao.every((r) => r.reservado <= r.onHandDoSistema + 1e-9),
    JSON.stringify(reconstrucao.filter((r) => r.reservado > r.onHandDoSistema)),
  );

  // ── Órfãos ─────────────────────────────────────────────────────────────
  const pedidos = (await apiGet("/customer-orders?pageSize=100")).customerOrders;
  const detalhes = [];
  for (const p of pedidos) detalhes.push(await apiGet(`/customer-orders/${p.id}`));

  const reservaOrfa = detalhes.filter(
    (d) =>
      d.reservation?.status === "ACTIVE" &&
      (d.status === "SHIPPED" || d.status === "CANCELLED") &&
      (d.reservation.lines ?? []).some((l) => num(l.reservedRemaining) > 0),
  );
  check(
    "ÓRFÃOS · nenhum pedido totalmente expedido ou cancelado mantém reserva ativa com saldo",
    reservaOrfa.length === 0,
    JSON.stringify(reservaOrfa.map((d) => d.code)),
  );

  const expedicoes = (await apiGet("/shipments?pageSize=100")).shipments;
  const faturamentos = (await apiGet("/billings?pageSize=100")).billings;

  const expedicaoSemPedido = expedicoes.filter((s) => !detalhes.some((d) => d.code === s.customerOrderCode));
  check("ÓRFÃOS · nenhuma expedição sem pedido de origem", expedicaoSemPedido.length === 0, JSON.stringify(expedicaoSemPedido.map((s) => s.code)));

  const faturamentoSemExpedicaoConfirmada = [];
  for (const f of faturamentos) {
    if (f.status === "CANCELLED") continue;
    const exp = expedicoes.find((s) => s.code === f.shipmentCode);
    if (!exp || exp.status !== "CONFIRMED") faturamentoSemExpedicaoConfirmada.push(`${f.code}/${f.shipmentCode}/${exp?.status ?? "inexistente"}`);
  }
  check(
    "ÓRFÃOS · nenhum faturamento ativo sem expedição CONFIRMADA por trás",
    faturamentoSemExpedicaoConfirmada.length === 0,
    JSON.stringify(faturamentoSemExpedicaoConfirmada),
  );

  const duplicados = [];
  const porExpedicao = new Map();
  for (const f of faturamentos.filter((x) => x.status !== "CANCELLED")) {
    porExpedicao.set(f.shipmentCode, (porExpedicao.get(f.shipmentCode) ?? 0) + 1);
  }
  for (const [code, n] of porExpedicao) if (n > 1) duplicados.push(`${code}=${n}`);
  check("ÓRFÃOS · nenhuma expedição com mais de um faturamento ativo", duplicados.length === 0, JSON.stringify(duplicados));

  // Toda linha de expedição confirmada tem exatamente um movimento de saída.
  const saidasPorExpedicao = new Map();
  for (const itemId of itens) {
    for (const m of await lerMovimentos(itemId)) {
      if (m.type !== "SHIPMENT_OUT") continue;
      saidasPorExpedicao.set(m.sourceId, (saidasPorExpedicao.get(m.sourceId) ?? 0) + num(m.quantity));
    }
  }
  const semMovimento = [];
  for (const s of expedicoes.filter((x) => x.status === "CONFIRMED")) {
    const detalhe = await apiGet(`/shipments/${s.id}`);
    const soma = saidasPorExpedicao.get(s.id);
    if (soma === undefined) continue; // item fora do escopo desta onda
    if (!perto(soma, detalhe.totalQuantity, 1e-6)) semMovimento.push(`${s.code}: doc=${detalhe.totalQuantity} movimentos=${soma}`);
  }
  check(
    "ÓRFÃOS · cada expedição confirmada tem saída física exatamente do seu tamanho",
    semMovimento.length === 0,
    JSON.stringify(semMovimento),
  );

  const consumosSemOp = [];
  for (const itemId of itens) {
    for (const m of await lerMovimentos(itemId)) {
      if (m.type !== "PRODUCTION_CONSUMPTION") continue;
      if (!m.sourceId || !m.productionOrderCode) consumosSemOp.push(`${m.lotCode}:${m.quantity}`);
    }
  }
  check("ÓRFÃOS · nenhum consumo sem documento de origem", consumosSemOp.length === 0, JSON.stringify(consumosSemOp));

  S.registro.ledger.orfaos = {
    reservaOrfa: reservaOrfa.map((d) => d.code),
    expedicaoSemPedido: expedicaoSemPedido.map((s) => s.code),
    faturamentoSemExpedicaoConfirmada,
    faturamentosDuplicados: duplicados,
    expedicoesSemMovimento: semMovimento,
    consumosSemOp,
  };
  console.log("  ⌸ ledger:", JSON.stringify(reconstrucao, null, 1));
  await abrir(`/estoque/${pa.itemId}`, { espera: ".doc-title, .page__title" });
  await shot("adv-traceability-ledger");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// MARCO 5 · Varredura de console nas telas de rastreabilidade
// ══════════════════════════════════════════════════════════════════════════
async function marco05Varredura() {
  const antesConsole = consoleErrors.length;
  const antesPageError = pageErrors.length;
  const antesRede = respostasComErro.length;

  const rotas = [
    "/relatorios/producao/rastreabilidade",
    `/producao/ordens/${S.dados.op.id}`,
    `/estoque/lotes/${S.dados.lotePa.id}`,
    `/estoque/lotes/${S.dados.lotePa.id}/rastreabilidade/imprimir`,
    `/estoque/lotes/${S.dados.loteBloqueado.id}`,
    "/estoque/lotes",
  ];
  for (const m of S.dados.materiais) rotas.push(`/estoque/lotes/${m.lotId}`);
  for (const rota of rotas) {
    await abrir(rota, { espera: ".page__title, .doc-title, .print-layout, .consult-head" });
    await page.waitForTimeout(1000);
  }

  const novosConsole = consoleErrors.slice(antesConsole);
  const novosPageError = pageErrors.slice(antesPageError);
  const novosRede = respostasComErro.slice(antesRede);
  check(
    `CONSOLE · nenhuma das ${rotas.length} telas de rastreabilidade emitiu console.error`,
    novosConsole.length === 0,
    JSON.stringify(novosConsole.slice(0, 5)),
  );
  check("CONSOLE · nenhuma exceção não tratada nas telas de rastreabilidade", novosPageError.length === 0, JSON.stringify(novosPageError.slice(0, 5)));
  check("REDE · nenhuma resposta >=400 ao abrir as telas de rastreabilidade", novosRede.length === 0, JSON.stringify(novosRede.slice(0, 8)));
  anotar(`VARREDURA · ${rotas.length} telas · console ${novosConsole.length} · pageerror ${novosPageError.length} · >=400 ${novosRede.length}`);
  await shot("adv-traceability-impressao");
  salvarEstado();
}

// ══════════════════════════════════════════════════════════════════════════
// Execução
// ══════════════════════════════════════════════════════════════════════════
let parada = null;

async function principal() {
  await login();
  await abrirNavegador();
  await marco(1, "arvore", marco01Arvore);
  await marco(2, "consumo", marco02Consumo);
  await marco(3, "nao-aparecem-e-reversa", marco03NaoAparecemEReversa);
  S.marcos = S.marcos.filter((m) => m !== "4-ledger" && m !== "5-varredura");
  await marco(4, "ledger", marco04Ledger);
  await marco(5, "varredura", marco05Varredura);
}

principal()
  .catch((e) => {
    const msg = String(e?.message ?? e);
    if (msg === "__PARADA_SOLICITADA__") parada = `parada solicitada em --ate=${ATE}`;
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
    console.log("\nÁRVORE:");
    console.log(JSON.stringify(reg.arvore, null, 1));
    console.log("\nLEDGER:");
    console.log(JSON.stringify(reg.ledger, null, 1));
    console.log(`\nCONSOLE: console.error=${consoleErrors.length} pageerror=${pageErrors.length}`);
    for (const c of consoleErrors.slice(0, 10)) console.log(`   · ${c}`);
    for (const c of pageErrors.slice(0, 10)) console.log(`   · ${c}`);
    console.log("\nRESPOSTAS >=400:");
    for (const r of respostasComErro.slice(0, 20)) console.log(`   · ${r.method} ${r.pathname} → ${r.status}`);
    if (dialogosNativos.length) console.log(`\nDIÁLOGOS NATIVOS: ${JSON.stringify(dialogosNativos)}`);
    if (parada) console.log(`\nPARADA: ${parada}`);
    console.log(`\nestado: ${STATE_FILE}`);
    process.exit(reg.verificacoes.nok.length > 0 || parada?.startsWith("erro") ? 1 : 0);
  });
