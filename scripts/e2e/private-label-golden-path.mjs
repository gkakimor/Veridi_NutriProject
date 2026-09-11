import fs from "node:fs";
import path from "node:path";
import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Golden path private label — o negócio inteiro, pela interface, numa base
 * que só tem usuário e catálogo de unidades.
 *
 *   node scripts/e2e/private-label-golden-path.mjs
 *   node scripts/e2e/private-label-golden-path.mjs --run=<runId> --desde=<etapa>
 *
 * Cliente → Fornecedor → Itens → Custos → Produto → Formulação → Custo dos
 * materiais → Precificação → Projeto → Orçamento → Pedido → Necessidade de
 * produção → Necessidade de materiais → Compra → Recebimento → Qualidade →
 * Estoque → OP → Separação → Consumo → Produção realizada → Estoque de PA →
 * Reserva → Expedição → Faturamento.
 *
 * Regras (README desta pasta): massa carimbada com o runId; mutação de negócio
 * SÓ pela interface — a API entra para conferir, nunca para fabricar estado;
 * console sujo reprova. O navegador roda no fuso da operação (§72): quem usa
 * o sistema está em São Paulo, a máquina do laboratório pode não estar.
 *
 * Checkpoint: cada etapa concluída grava os ids que criou em
 * `handoff/golden-path-<runId>.json`. É mapa de entidades, não veredito:
 * `--run` + `--desde` retomam a MESMA massa e reexecutam a etapa pedida e as
 * seguintes, conferindo tudo de novo.
 */

const argumento = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
const DESDE = argumento("desde");
const RUN = argumento("run");

const run = RUN ? { runId: RUN } : DESDE ? obterRun() : obterRun({ novo: true, dono: "golden-path" });
const P = `GP${run.runId}`;
const ARQUIVO_ESTADO = path.resolve(`handoff/golden-path-${run.runId}.json`);
const estado =
  DESDE && fs.existsSync(ARQUIVO_ESTADO)
    ? JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, "utf8"))
    : { runId: run.runId, ids: {}, feitas: [], numeros: {} };
const salvarEstado = () => fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));

/* ───────────────────────────── Massa ───────────────────────────── */

const FUSO = "America/Sao_Paulo";
/** Dia civil da operação, deslocado em dias — nunca o dia da máquina. */
function diaComercial(deslocamento = 0) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());
  const dia = new Date(`${hoje}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + deslocamento);
  return dia.toISOString().slice(0, 10);
}
const HOJE = diaComercial(0);

const CLIENTE = `Cliente ${P} Private Label LTDA`;
const FORNECEDOR_MP = `Fornecedor ${P} Insumos`;
const FORNECEDOR_EMB = `Fornecedor ${P} Embalagens`;
const PRODUTO = `Suplemento ${P}`;

/** Base 100 un. Custo esperado da base: 600 + 250 + 80 + 15 + 12 = R$ 957,00. */
const BASE = 100;
const ITENS = [
  { chave: "mpA", tipo: "RAW_MATERIAL", unidade: "kg", nome: `Vitamina C ${P}`, qtd: "3", modo: "Base da fórmula", custo: 200, fisicoNaBase: 3 },
  { chave: "mpB", tipo: "RAW_MATERIAL", unidade: "g", nome: `Colageno ${P}`, qtd: "500", modo: "Base da fórmula", custo: 0.5, fisicoNaBase: 500 },
  { chave: "pote", tipo: "PACKAGING", unidade: "un", nome: `Pote 60 caps ${P}`, subtipo: "POT", qtd: "1", modo: "Por unidade acabada", custo: 0.8, fisicoNaBase: 100 },
  { chave: "rotulo", tipo: "PACKAGING", unidade: "un", nome: `Rotulo ${P}`, subtipo: "LABEL", qtd: "1", modo: "Por unidade acabada", custo: 0.15, fisicoNaBase: 100 },
  { chave: "caixa", tipo: "PACKAGING", unidade: "un", nome: `Caixa 20 potes ${P}`, subtipo: "BOX", qtd: "5", modo: "Base da fórmula", custo: 2.4, fisicoNaBase: 5, custoInicial: "2,40" },
];
const itemPor = (chave) => ITENS.find((i) => i.chave === chave);
/** Ofertas: MP B fica SEM custo até a etapa "custo-completo" — é o cenário de §46. */
const OFERTAS = [
  { item: "mpA", fornecedor: "fornecedorMp", preco: "200", uom: "kg" },
  { item: "pote", fornecedor: "fornecedorEmb", preco: "0,80", uom: "un" },
  { item: "rotulo", fornecedor: "fornecedorEmb", preco: "0,15", uom: "un" },
];
const OFERTA_TARDIA = { item: "mpB", fornecedor: "fornecedorMp", preco: "0,50", uom: "g" };

const CUSTO_MP_BASE = 3 * 200 + 500 * 0.5; // 850
const CUSTO_EMB_BASE = 100 * 0.8 + 100 * 0.15 + 5 * 2.4; // 107
const CUSTO_MATERIAIS_BASE = CUSTO_MP_BASE + CUSTO_EMB_BASE; // 957

/* ───────────────────────────── Verificação ───────────────────────────── */

const falhas = [];
const achados = [];

function afirmar(descricao, condicao, detalhe = "") {
  const sufixo = detalhe ? ` — ${detalhe}` : "";
  if (condicao) {
    console.log(`  ok   ${descricao}${sufixo}`);
    return true;
  }
  falhas.push(`${descricao}${sufixo}`);
  console.log(`  FALHA ${descricao}${sufixo}`);
  return false;
}

/** Observação que não impede o fluxo: vai para o relatório, não reprova. */
function anotar(severidade, texto) {
  achados.push(`${severidade} ${texto}`);
  console.log(`  obs  [${severidade}] ${texto}`);
}

/** Pré-condição de etapa: sem ela o fluxo não continua. */
class Bloqueio extends Error {}
function exigir(descricao, condicao, detalhe = "") {
  if (!afirmar(descricao, condicao, detalhe)) throw new Bloqueio(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
}

/** "R$ 1.234,56" → 1234.56. Só para conferir a aritmética do que a tela mostra. */
function numeroDe(texto) {
  if (texto === null || texto === undefined) return null;
  const limpo = String(texto).replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  if (!limpo) return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}
const bate = (obtido, esperado, tolerancia = 0.005) =>
  obtido !== null && Math.abs(obtido - esperado) < tolerancia;
const reais = (v) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const entidade = (corpo, chave) => corpo?.[chave] ?? corpo;

/* ───────────────────────────── Navegador ───────────────────────────── */

const { pagina, api, erros, fechar } = await abrirNavegador({ fuso: FUSO });
const respostasComErro = [];
pagina.on("response", (r) => {
  const u = new URL(r.url());
  if (u.port === "3333" && r.status() >= 400) respostasComErro.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
});

/** Registrar ANTES da ação: a resposta pode chegar antes de o `await` da ação voltar. */
function esperarResposta(metodos, caminho, timeout = 25000) {
  const aceitos = [metodos].flat();
  const promessa = pagina.waitForResponse(
    (r) => aceitos.includes(r.request().method()) && caminho.test(new URL(r.url()).pathname),
    { timeout },
  );
  promessa.catch(() => {});
  return promessa;
}

async function clicar(nome, { exact = true } = {}) {
  await pagina.getByRole("button", { name: nome, exact }).first().click();
}
const preencher = (id, valor) => pagina.locator(`#${id}`).first().fill(valor);
const escolher = (id, valor) => pagina.locator(`#${id}`).first().selectOption(valor);
const assentar = (ms = 500) => pagina.waitForTimeout(ms);

async function esperarTexto(texto, timeout = 25000) {
  await pagina.getByText(texto, { exact: false }).first().waitFor({ timeout });
}

/** O botão de confirmação DENTRO do diálogo — nunca o que o abriu. */
async function confirmarDialogo(rotulo) {
  await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: rotulo, exact: true }).click();
}

/**
 * Campo de busca de entidade: digita e escolhe a opção que JÁ existe — a
 * primeira da lista costuma ser "+ Novo …", a criação em contexto.
 */
async function escolherEntidade(campo, termo) {
  await campo.click();
  await campo.fill("");
  await campo.type(termo, { delay: 15 });
  const opcao = pagina
    .locator('[role="option"]', { hasText: termo })
    .filter({ hasNotText: /^\s*\+\s*Nov[oa]/ })
    .first();
  await opcao.waitFor({ state: "visible", timeout: 15000 });
  await opcao.click();
}

async function ler(caminho) {
  const r = await api(caminho);
  if (r.status >= 400) throw new Error(`GET ${caminho} → ${r.status}`);
  return r.corpo;
}

/* ───────────────────────────── Etapas ───────────────────────────── */

const ETAPAS = [];
const etapa = (nome, fn) => ETAPAS.push({ nome, fn });

etapa("cliente", async () => {
  await pagina.goto(`${WEB}/cadastros/clientes/novo`);
  await pagina.locator("#customer-legal-name").first().waitFor({ timeout: 25000 });
  await preencher("customer-legal-name", CLIENTE);
  await preencher("customer-email", `compras.${run.runId.toLowerCase()}@cliente-gp.com.br`);
  await preencher("customer-phone", "11987654321");
  const criado = esperarResposta("POST", /^\/customers$/);
  await clicar("Criar cliente", { exact: false });
  const resposta = await criado;
  exigir("cliente criado pela interface", resposta.ok(), `${resposta.status()}`);
  const cliente = entidade(await resposta.json(), "customer");
  estado.ids.cliente = { id: cliente.id, code: cliente.code, nome: CLIENTE };
  afirmar("o cliente nasce com código da sequência", /^CLI-\d{6}$/.test(cliente.code ?? ""), cliente.code);
});

etapa("fornecedores", async () => {
  for (const [chave, nome] of [
    ["fornecedorMp", FORNECEDOR_MP],
    ["fornecedorEmb", FORNECEDOR_EMB],
  ]) {
    await pagina.goto(`${WEB}/cadastros/fornecedores/novo`);
    await pagina.locator("#supplier-legal-name").first().waitFor({ timeout: 25000 });
    await preencher("supplier-legal-name", nome);
    const criado = esperarResposta("POST", /^\/suppliers$/);
    await clicar("Criar fornecedor");
    const resposta = await criado;
    exigir(`fornecedor criado — ${nome}`, resposta.ok(), `${resposta.status()}`);
    const fornecedor = entidade(await resposta.json(), "supplier");
    estado.ids[chave] = { id: fornecedor.id, code: fornecedor.code, nome };
    afirmar(`código de fornecedor da sequência — ${nome}`, /^FOR-\d{6}$/.test(fornecedor.code ?? ""), fornecedor.code);
  }
});

etapa("itens", async () => {
  for (const it of ITENS) {
    await pagina.goto(`${WEB}/cadastros/itens/novo`);
    await pagina.locator("#item-type").first().waitFor({ timeout: 25000 });
    await escolher("item-type", it.tipo);
    await escolher("item-unit", it.unidade);
    await preencher("item-name", it.nome);
    if (it.subtipo && (await pagina.locator("#item-packaging-subtype").count())) {
      const valores = await pagina
        .locator("#item-packaging-subtype option")
        .evaluateAll((opcoes) => opcoes.map((o) => o.value));
      if (valores.includes(it.subtipo)) await escolher("item-packaging-subtype", it.subtipo);
      else anotar("P3", `subtipo de embalagem ${it.subtipo} não está entre ${valores.join("/")}`);
    }
    if (it.custoInicial) await preencher("item-initial-cost-reference", it.custoInicial);
    const controles = {
      lote: await pagina.locator("#item-controls-lot").isChecked().catch(() => null),
      validade: await pagina.locator("#item-controls-expiry").isChecked().catch(() => null),
      liberacao: await pagina.locator("#item-requires-quality-release").isChecked().catch(() => null),
    };
    const criado = esperarResposta("POST", /^\/items$/);
    await clicar("Criar item");
    const resposta = await criado;
    exigir(`item criado — ${it.nome}`, resposta.ok(), `${resposta.status()}`);
    const item = entidade(await resposta.json(), "item");
    estado.ids[it.chave] = { id: item.id, code: item.code, nome: it.nome, unidade: it.unidade };
    const prefixo = it.tipo === "RAW_MATERIAL" ? "MP" : "ME";
    afirmar(
      `${item.code} · ${it.unidade} · lote ${controles.lote ? "✓" : "✗"} validade ${controles.validade ? "✓" : "✗"} liberação ${controles.liberacao ? "✓" : "✗"}`,
      new RegExp(`^${prefixo}-\\d{6}$`).test(item.code ?? "") && item.unitCode === it.unidade,
      it.nome,
    );
  }
  const mpA = await ler(`/items/${estado.ids.mpA.id}`);
  afirmar(
    "matéria-prima exige liberação da Qualidade (o recebimento nasce bloqueado)",
    entidade(mpA, "item").requiresQualityRelease === true,
  );
});

async function criarRelacao({ item, fornecedor, preco, uom }) {
  await pagina.goto(`${WEB}/compras/item-fornecedor`);
  await clicar("Nova relação");
  await escolherEntidade(pagina.getByPlaceholder("Digite código ou nome do item…"), estado.ids[item].nome);
  await escolherEntidade(pagina.getByPlaceholder("Digite código ou nome do fornecedor…"), estado.ids[fornecedor].nome);
  await escolher("supplier-item-qualification", "APPROVED");
  await preencher("supplier-item-price", preco);
  await escolher("supplier-item-price-uom", uom);
  await preencher("supplier-item-effective", HOJE);
  const criada = esperarResposta("POST", /^\/supplier-items$/);
  await clicar("Criar relação");
  const resposta = await criada;
  exigir(
    `relação homologada com oferta — ${estado.ids[item].code} × ${estado.ids[fornecedor].code} a ${preco}/${uom}`,
    resposta.ok(),
    `${resposta.status()}`,
  );
  await assentar(800);
}

/** A seleção automática de custo do item hoje (`automatic` de /cost-references) — só para conferir. */
async function fonteDeCusto(chave) {
  const r = await api(`/items/${estado.ids[chave].id}/cost-references`);
  if (r.status >= 400) return { source: `HTTP ${r.status}`, unitCost: null };
  return r.corpo?.automatic ?? { source: "(sem automatic)", unitCost: null };
}

etapa("custos", async () => {
  for (const oferta of OFERTAS) await criarRelacao(oferta);
  const esperado = { mpA: "SUPPLIER_OFFER", mpB: "NO_COST", pote: "SUPPLIER_OFFER", rotulo: "SUPPLIER_OFFER", caixa: "MANUAL_REFERENCE" };
  for (const [chave, fonte] of Object.entries(esperado)) {
    const atual = await fonteDeCusto(chave);
    afirmar(
      `fonte de custo de ${estado.ids[chave].code}: ${fonte}`,
      String(atual.source).includes(fonte.replace("SUPPLIER_OFFER", "OFFER")),
      `${atual.source} ${atual.unitCost ?? ""}`,
    );
  }
});

etapa("produto", async () => {
  await pagina.goto(`${WEB}/cadastros/produtos/novo`);
  await pagina.locator("#product-customer").first().waitFor({ timeout: 25000 });
  await escolherEntidade(pagina.locator("#product-customer").first(), P);
  await preencher("product-name", PRODUTO);
  await escolher("product-finished-unit", "un");
  await preencher("product-units-per-box", "20");
  if (await pagina.locator("#product-shelf-life").count()) await preencher("product-shelf-life", "24");
  const criado = esperarResposta("POST", /^\/products$/);
  await clicar("Criar produto");
  const resposta = await criado;
  exigir("produto criado pela interface", resposta.ok(), `${resposta.status()}`);
  const produto = entidade(await resposta.json(), "product");
  const lido = entidade(await ler(`/products/${produto.id}`), "product");
  const pa = lido.finishedProductItem ?? null;
  estado.ids.produto = { id: produto.id, code: produto.code, nome: PRODUTO, paItemId: pa?.id ?? null, paCode: pa?.code ?? null };
  afirmar("produto do cliente, com código da sequência", /^PROD-\d{6}$/.test(produto.code ?? "") && lido.customerId === estado.ids.cliente.id, produto.code);
  afirmar("Produto ↔ item de produto acabado 1:1", Boolean(pa?.id) && /^PA-\d{6}$/.test(pa?.code ?? ""), pa?.code ?? "sem item acabado");
});

/** A seção "Custo estimado de materiais" da versão, como a pessoa a lê. */
const lerEstimativa = () =>
  pagina.evaluate(() => {
    const tabela = document.querySelector("table.table--custo-estimado");
    const linhas = tabela
      ? [...tabela.querySelectorAll("tbody tr")].map((tr) =>
          [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
        )
      : [];
    const secao = (tabela?.closest("section") ?? tabela?.parentElement?.parentElement ?? document.body).innerText;
    return { linhas, secao: secao.replace(/\s+/g, " ") };
  });

/** Rascunho ou ativa: a versão ativa é somente leitura, sem `#version-basis`. */
async function abrirVersaoDaFormulacao() {
  await pagina.goto(`${WEB}/producao/formulacoes/${estado.ids.produto.id}/versoes/${estado.ids.formulacao.versaoId}`);
  await pagina.locator("table.table--custo-estimado").first().waitFor({ timeout: 25000 });
  await assentar(1200);
}

etapa("formulacao", async () => {
  await pagina.goto(`${WEB}/producao/formulacoes/${estado.ids.produto.id}`);
  await clicar("Criar formulação em branco");
  await pagina.waitForURL(/\/versoes\/[0-9a-f-]{36}/, { timeout: 25000 });
  const versaoId = pagina.url().match(/\/versoes\/([0-9a-f-]{36})/)[1];
  estado.ids.formulacao = { versaoId };
  await preencher("version-basis", String(BASE));

  for (const it of ITENS) {
    await clicar("+ Adicionar componente");
    const seletor = pagina.locator('[id^="componente-component-"]').last();
    await escolherEntidade(seletor, estado.ids[it.chave].nome);
    const codigo = estado.ids[it.chave].code;
    const quantidade = pagina.getByLabel(`Quantidade de ${codigo}`, { exact: true });
    await quantidade.waitFor({ timeout: 15000 });
    await quantidade.fill(it.qtd);
    const linha = quantidade.locator("xpath=ancestor::tr[1]");
    await linha.getByLabel("Base de cálculo do componente").selectOption({ label: it.modo });
  }

  const salvo = esperarResposta(["PUT", "PATCH"], /^\/formulation-versions\/[0-9a-f-]{36}/);
  await clicar("Salvar rascunho");
  const resposta = await salvo;
  exigir("rascunho da formulação salvo", resposta.ok(), `${resposta.status()}`);
  await assentar(1500);

  // §46 — componente sem custo: o total não pode se passar por completo.
  await abrirVersaoDaFormulacao();
  const parcial = await lerEstimativa();
  const linhaMpB = parcial.linhas.find((l) => l[0]?.includes(estado.ids.mpB.code)) ?? [];
  afirmar(
    "componente sem custo aparece sem referência, e sem valor inventado",
    /Sem referência de custo/i.test(linhaMpB.join(" ")) && linhaMpB.at(-1) === "—",
    linhaMpB.join(" | "),
  );
  afirmar(
    "o total da base NÃO se apresenta como completo — Indisponível",
    /Custo estimado da base[^R]*Indisponível/i.test(parcial.secao),
    parcial.secao.match(/Custo estimado da base.{0,60}/)?.[0] ?? "",
  );
  afirmar(
    "a tela diz que o subtotal conhecido não é o custo total",
    /não representa o custo total/i.test(parcial.secao),
    parcial.secao.match(/Custo parcial.{0,160}/)?.[0] ?? "",
  );

  await clicar("Ativar versão");
  await pagina.getByRole("button", { name: "Ativar", exact: true }).last().click();
  await pagina.locator(".badge--active", { hasText: "Ativa" }).first().waitFor({ timeout: 25000 });
  const versoes = await ler(`/products/${estado.ids.produto.id}/formulations`);
  afirmar("formulação ativada — MP e embalagem na mesma receita", JSON.stringify(versoes).includes('"ACTIVE"'));
});

etapa("oferta-tardia", async () => {
  await criarRelacao(OFERTA_TARDIA);
  const fonte = await fonteDeCusto("mpB");
  afirmar(`com a oferta, ${estado.ids.mpB.code} passa a ter custo`, String(fonte.source).includes("OFFER"), `${fonte.source} ${fonte.unitCost ?? ""}`);
});

etapa("custo-completo", async () => {
  await abrirVersaoDaFormulacao();
  const completa = await lerEstimativa();

  let somaMp = 0;
  let somaEmb = 0;
  for (const it of ITENS) {
    const codigo = estado.ids[it.chave].code;
    const linha = completa.linhas.find((l) => l[0]?.includes(codigo)) ?? [];
    const custo = numeroDe(linha.at(-1));
    const esperado = it.fisicoNaBase * it.custo;
    afirmar(
      `${codigo}: ${it.fisicoNaBase} ${it.unidade} × ${reais(it.custo)} = ${reais(esperado)}`,
      bate(custo, esperado),
      linha.join(" | "),
    );
    if (codigo.startsWith("MP-")) somaMp += custo ?? 0;
    else somaEmb += custo ?? 0;
  }
  const total = numeroDe(completa.secao.match(/Custo estimado da base \(\d+ un\)\s*(R\$\s?[\d.,]+)/)?.[1]);
  const porUnidade = numeroDe(completa.secao.match(/Custo estimado por unidade\s*(R\$\s?[\d.,]+)/)?.[1]);
  afirmar(`matéria-prima ${reais(CUSTO_MP_BASE)} — soma das linhas MP-`, bate(somaMp, CUSTO_MP_BASE), reais(somaMp));
  afirmar(`embalagem ${reais(CUSTO_EMB_BASE)} — soma das linhas ME-`, bate(somaEmb, CUSTO_EMB_BASE), reais(somaEmb));
  afirmar(
    `custo dos materiais da base (${BASE} un) = Σ quantidade × custo = ${reais(CUSTO_MATERIAIS_BASE)}`,
    bate(total, CUSTO_MATERIAIS_BASE),
    completa.secao.match(/Custo estimado da base.{0,40}/)?.[0] ?? "",
  );
  afirmar(
    `por unidade ${reais(CUSTO_MATERIAIS_BASE / BASE)}`,
    bate(porUnidade, CUSTO_MATERIAIS_BASE / BASE),
    completa.secao.match(/Custo estimado por unidade.{0,30}/)?.[0] ?? "",
  );
  estado.numeros.custoMateriaisBase = total;
  if (!/separad|Matéria-prima.*Embalagem/i.test(completa.secao)) {
    anotar("P3", "a estimativa não separa matéria-prima de embalagem em subtotais — conferido pelo prefixo MP-/ME- das linhas");
  }
});

/* ─────────────── Custo industrial, CMV e Precificação ─────────────── */

/** Energia: 50 kWh por lote de 100 un, a R$ 0,80 — R$ 40,00 por lote. */
const KWH_POR_LOTE = 50;
const TARIFA_KWH = 0.8;
const ENERGIA_POR_LOTE = KWH_POR_LOTE * TARIFA_KWH; // 40
const QTD_PEDIDO = 200;
const LOTES_DO_PEDIDO = Math.ceil(QTD_PEDIDO / BASE); // 2
const CMV_BASE = CUSTO_MATERIAIS_BASE + ENERGIA_POR_LOTE; // 997
const CMV_PEDIDO = CUSTO_MATERIAIS_BASE * (QTD_PEDIDO / BASE) + ENERGIA_POR_LOTE * LOTES_DO_PEDIDO; // 1994
const MARGEM = 30;
const DESCONTO = 5;

etapa("energia", async () => {
  const nome = `Energia ${P}`;
  await pagina.goto(`${WEB}/gestao/recursos-industriais/novo`);
  await pagina.locator("#resource-name").first().waitFor({ timeout: 25000 });
  await preencher("resource-name", nome);
  await escolher("resource-type", "ENERGY");
  await clicar("Criar recurso");
  await pagina.waitForURL(/\/gestao\/recursos-industriais(\/[0-9a-f-]{36})?$/, { timeout: 25000 });
  if (!/\/recursos-industriais\/[0-9a-f-]{36}$/.test(pagina.url())) {
    await preencher("industrial-resources-search", nome);
    await assentar(1500);
    await pagina.getByRole("row", { name: new RegExp(nome) }).first().click();
    await pagina.waitForURL(/\/recursos-industriais\/[0-9a-f-]{36}$/, { timeout: 25000 });
  }
  const id = pagina.url().match(/\/recursos-industriais\/([0-9a-f-]{36})$/)[1];
  estado.ids.energia = { id, nome };
  await preencher("rate-value", "0.80");
  await clicar("Registrar tarifa");
  await assentar(1500);
  const recurso = JSON.stringify(await ler(`/industrial-resources/${id}`));
  afirmar("recurso de energia com tarifa R$ 0,80/kWh vigente", /"0\.8/.test(recurso), recurso.match(/"rates?":\[[^\]]{0,160}/)?.[0] ?? "");
});

/** Detalhamento do cálculo, como a tela o mostra. */
const lerDetalheDoCalculo = () =>
  pagina.evaluate(() => {
    const rotulos = [...document.querySelectorAll(".definition-list dt")];
    const valorDe = (regex) => rotulos.find((d) => regex.test(d.textContent ?? ""))?.nextElementSibling?.textContent?.trim() ?? null;
    return {
      quantidade: valorDe(/^Quantidade calculada$/),
      total: valorDe(/^Custo industrial total para /),
      unitario: valorDe(/^Custo por unidade$/),
    };
  });

etapa("estrutura-de-custos", async () => {
  await pagina.goto(`${WEB}/produtos/${estado.ids.produto.id}/custos`);
  await pagina.locator("#new-reference-output").first().waitFor({ timeout: 25000 });
  await preencher("new-reference-output", String(BASE));
  await clicar("Criar estrutura de custos");
  await esperarTexto("Rascunho");
  // O modo vem antes do consumo: fora do modo direto a energia nem é oferecida.
  await escolher("energy-mode", "DIRECT");
  await assentar(1500);
  await pagina.locator("#usage-resource").first().fill(estado.ids.energia.nome);
  await assentar(900);
  await pagina.getByRole("option", { name: new RegExp(estado.ids.energia.nome) }).first().click();
  await preencher("usage-quantity", String(KWH_POR_LOTE));
  await clicar("Adicionar recurso");
  await assentar(1500);

  await clicar("Ativar estrutura");
  await assentar(1500);
  const dialogo = (await pagina.locator(".confirm-dialog").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  if (dialogo) {
    anotar("P3", `ativar a estrutura mínima (energia direta) pediu confirmação: ${dialogo.slice(0, 220)}`);
    await pagina.locator(".confirm-dialog__actions button").last().click();
  }
  await pagina.getByText("Ativa", { exact: true }).first().waitFor({ timeout: 25000 });
  afirmar("estrutura de custos ativa, base de produção 100 un", true);
});

etapa("calculo", async () => {
  await pagina.goto(`${WEB}/produtos/${estado.ids.produto.id}/custos`);
  await clicar("Calcular custo");
  await esperarTexto("Custo industrial total para");
  const detalhe = await lerDetalheDoCalculo();
  afirmar(
    `custo industrial de ${BASE} un = materiais ${reais(CUSTO_MATERIAIS_BASE)} + energia ${reais(ENERGIA_POR_LOTE)} = ${reais(CMV_BASE)}`,
    bate(numeroDe(detalhe.total), CMV_BASE),
    `${detalhe.quantidade} · ${detalhe.total}`,
  );
  afirmar(`por unidade ${reais(CMV_BASE / BASE)}`, bate(numeroDe(detalhe.unitario), CMV_BASE / BASE), detalhe.unitario);
  await clicar("Salvar cálculo");
  await pagina.getByRole("button", { name: /^Salvar( assim mesmo)?$/ }).last().click();
  await esperarTexto("CALC-");
  const codigo = (await pagina.locator("body").innerText()).match(/CALC-\d{6}/)?.[0] ?? null;
  estado.ids.calculo = { code: codigo };
  afirmar("cálculo salvo — o documento que CMV e precificação leem", Boolean(codigo), codigo ?? "");
});

/** Cartões do CMV: rótulo → valor. */
const lerCartoesDoCmv = () =>
  pagina.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".cmv-card")].map((c) => [
        c.querySelector(".cmv-card__label")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        c.querySelector(".cmv-card__value")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      ]),
    ),
  );

etapa("cmv", async () => {
  await pagina.goto(`${WEB}/produtos/${estado.ids.produto.id}/cmv?quantity=${QTD_PEDIDO}`);
  await pagina.getByText("CMV total para", { exact: false }).first().waitFor({ timeout: 25000 });
  await assentar(800);
  const cartoes = await lerCartoesDoCmv();
  const rotuloTotal = Object.keys(cartoes).find((k) => k.startsWith("CMV total para")) ?? "";
  afirmar(
    `CMV de ${QTD_PEDIDO} un = ${LOTES_DO_PEDIDO} lotes: materiais ${reais(CUSTO_MATERIAIS_BASE * 2)} + energia ${reais(ENERGIA_POR_LOTE * 2)} = ${reais(CMV_PEDIDO)}`,
    rotuloTotal.includes(`${QTD_PEDIDO} un`) && bate(numeroDe(cartoes[rotuloTotal]), CMV_PEDIDO),
    `${rotuloTotal}: ${cartoes[rotuloTotal]}`,
  );
  afirmar(
    `CMV por unidade ${reais(CMV_PEDIDO / QTD_PEDIDO)}`,
    bate(numeroDe(cartoes["CMV por unidade"]), CMV_PEDIDO / QTD_PEDIDO),
    cartoes["CMV por unidade"],
  );
  console.log(`  qualidade do custo: ${cartoes["Qualidade do custo"] ?? "—"}`);
  estado.numeros.cmvPorUnidade = CMV_PEDIDO / QTD_PEDIDO;
});

etapa("precificacao", async () => {
  await pagina.goto(`${WEB}/produtos/${estado.ids.produto.id}/custos`);
  await pagina.getByRole("button", { name: "Criar precificação" }).first().waitFor({ timeout: 25000 });
  await pagina.getByRole("button", { name: "Criar precificação" }).first().click();
  await pagina.waitForURL(/\/gestao\/precificacao\/[0-9a-f-]{36}/, { timeout: 25000 });
  estado.ids.precificacao = { id: pagina.url().match(/\/precificacao\/([0-9a-f-]{36})/)[1] };
  await pagina.locator("#tier-quantity").first().waitFor({ timeout: 25000 });
  await preencher("tier-quantity", String(QTD_PEDIDO));
  await pagina.locator("#tier-mode").first().selectOption({ label: "Calcular pela margem" });
  await preencher("tier-margin", String(MARGEM));
  if (await pagina.locator("#tier-commission").count()) await preencher("tier-commission", "0");
  await clicar("Adicionar faixa");
  await assentar(1500);
  await clicar("Ativar precificação");
  await assentar(900);
  if (await pagina.locator(".confirm-dialog").count()) {
    const texto = (await pagina.locator(".confirm-dialog").first().innerText()).replace(/\s+/g, " ");
    anotar("P3", `ativar precificação com custo completo pediu confirmação: ${texto.slice(0, 160)}`);
    await pagina.locator(".confirm-dialog__actions button").last().click();
  }
  await assentar(1500);
  const { versao, faixa } = await faixaAtiva();
  const preco = Number(faixa?.selectedUnitPrice ?? faixa?.suggestedUnitPrice ?? NaN);
  const esperado = CMV_PEDIDO / QTD_PEDIDO / (1 - MARGEM / 100);
  afirmar(`precificação ativa — ${versao?.code ?? "?"}`, versao?.status === "ACTIVE" && versao?.pricingComplete === true);
  afirmar(
    `preço da faixa de ${QTD_PEDIDO} un, margem ${MARGEM}% sobre ${reais(CMV_PEDIDO / QTD_PEDIDO)}: ${esperado.toFixed(8)}`,
    Math.abs(preco - esperado) < 0.000001,
    `selecionado ${faixa?.selectedUnitPrice} · custo ${faixa?.industrialCostTotal} em ${faixa?.batchCount} lote(s)`,
  );
  estado.numeros.precoFaixa = preco;
});

/** A faixa da quantidade do pedido na precificação ativa do produto. */
async function faixaAtiva() {
  const versao = entidade(await ler(`/products/${estado.ids.produto.id}/active-pricing`), "pricingVersion");
  const faixa = (versao?.tiers ?? []).find((t) => Number(t.quantity) === QTD_PEDIDO) ?? null;
  return { versao, faixa };
}

/* ───────────────────────────── Comercial ───────────────────────────── */

etapa("projeto", async () => {
  await pagina.goto(`${WEB}/comercial/projetos`);
  await clicar("Novo projeto");
  await pagina.locator("#project-customer").first().waitFor({ timeout: 25000 });
  await escolherEntidade(pagina.locator("#project-customer").first(), P);
  await preencher("project-name", `Projeto ${P}`);
  await clicar("Criar projeto", { exact: false });
  await pagina.waitForURL(/\/comercial\/projetos\/[0-9a-f-]{36}/, { timeout: 25000 });
  estado.ids.projeto = { id: pagina.url().match(/\/projetos\/([0-9a-f-]{36})/)[1] };
  await esperarTexto(`Projeto ${P}`);
  const ficha = await pagina.locator("body").innerText();
  afirmar("o Resumo do Projeto mostra o contato do Cliente (projeção do cadastro)", ficha.includes("98765-4321") || ficha.includes("cliente-gp.com.br"));

  await clicar("+ Adicionar produto");
  await clicar("Vincular produto existente");
  await escolherEntidade(pagina.locator("#link-product").first(), estado.ids.produto.code);
  await clicar("Vincular produto");
  await esperarTexto(estado.ids.produto.code);
  const produtos = JSON.stringify(await ler(`/projects/${estado.ids.projeto.id}/products`));
  afirmar("produto do cliente vinculado ao Projeto", produtos.includes(estado.ids.produto.id));
});

etapa("orcamento", async () => {
  await pagina.goto(`${WEB}/comercial/projetos/${estado.ids.projeto.id}`);
  await pagina.getByText(`Projeto ${P}`).first().waitFor({ timeout: 25000 });
  await assentar(800);
  const codigo = estado.ids.produto.code;
  const quantidade = pagina.getByLabel(`Quantidade de ${codigo}`, { exact: true });
  // O seletor de produto some quando todo produto do projeto já está no orçamento.
  const editor = pagina.locator("#quote-add-product").first();
  const aberto = async () => (await quantidade.count()) > 0 || (await editor.isVisible().catch(() => false));
  if (!(await aberto())) {
    // Retomada: o rascunho pode já existir — abrir, nunca criar um segundo.
    const abrir = pagina.getByRole("button", { name: "Abrir rascunho" }).first();
    if (await abrir.isVisible().catch(() => false)) await abrir.click();
    else await clicar("Criar nova versão");
    await Promise.any([quantidade.waitFor({ timeout: 25000 }), editor.waitFor({ timeout: 25000 })]);
  }
  if (!(await quantidade.count())) {
    const rotulo = await pagina.locator("#quote-add-product option", { hasText: codigo }).first().innerText();
    await editor.selectOption({ label: rotulo });
    await clicar("Adicionar");
    await quantidade.waitFor({ timeout: 25000 });
    await assentar(900);
  }
  const quantidadeInicial = numeroDe(await quantidade.inputValue());
  if (quantidadeInicial !== QTD_PEDIDO) {
    const linhaSalva = esperarResposta("PATCH", /^\/quote-lines\//);
    await quantidade.fill(String(QTD_PEDIDO));
    await quantidade.blur();
    await linhaSalva;
    await assentar(900);
  } else {
    console.log(`  a linha nasce com a quantidade da faixa ativa (${QTD_PEDIDO}) — nada a gravar`);
  }

  const lerLinha = async () => {
    const projeto = entidade(await ler(`/projects/${estado.ids.projeto.id}`), "project");
    const versao = (projeto.quoteVersions ?? []).at(-1) ?? {};
    return { versao, linha: (versao.lines ?? [])[0] ?? {} };
  };
  // A linha nasce com o preço da faixa quando a quantidade bate. Só aplicar à
  // mão quando não nasceu: o botão continua visível, e aplicar o mesmo preço
  // de novo não manda nada.
  if ((await lerLinha()).linha.priceSource !== "PRICING_TIER") {
    const precoSalvo = esperarResposta("PATCH", /^\/quote-lines\//);
    await clicar("Aplicar preço calculado");
    await precoSalvo;
    await assentar(900);
  } else {
    console.log("  a linha nasce com o preço da precificação ativa — origem PRICING_TIER");
  }
  estado.numeros.precoFaixa ??= Number((await faixaAtiva()).faixa?.selectedUnitPrice);
  const { linha } = await lerLinha();
  const precoDaLinha = Number(linha.unitPrice);
  afirmar(
    "o preço da linha vem da precificação ativa (fronteira de 4 casas, §60)",
    linha.priceSource === "PRICING_TIER" && Math.abs(precoDaLinha - estado.numeros.precoFaixa) < 0.00005,
    `linha ${linha.unitPrice} ${linha.priceSource} · faixa ${estado.numeros.precoFaixa}`,
  );
  estado.numeros.precoUnitario = precoDaLinha;

  await preencher("quote-valid-until", diaComercial(30));
  await preencher("quote-discount", String(DESCONTO));
  if (await pagina.locator("#quote-lead-time").count()) await preencher("quote-lead-time", "30");
  await pagina.locator("#quote-payment-method").first().selectOption({ label: "À vista" });
  await pagina.locator("#quote-notes").first().fill(`Golden path ${P}`);
  await clicar("Salvar condições");
  await assentar(1500);

  const versao = entidade(await ler(`/projects/${estado.ids.projeto.id}`), "project");
  const orcamento = (versao.quoteVersions ?? []).at(-1) ?? {};
  estado.ids.orcamento = { id: orcamento.id, code: orcamento.code ?? null };
  const bruto = Math.round(QTD_PEDIDO * estado.numeros.precoUnitario * 100) / 100;
  const desconto = Math.round(bruto * DESCONTO) / 100;
  estado.numeros.bruto = bruto;
  estado.numeros.desconto = desconto;
  estado.numeros.total = Math.round((bruto - desconto) * 100) / 100;
  afirmar(
    `orçamento fecha em ${reais(estado.numeros.total)} — ${QTD_PEDIDO} × ${reais(estado.numeros.precoUnitario)} = ${reais(bruto)} menos ${DESCONTO}%`,
    bate(Number(orcamento.total), estado.numeros.total),
    `total da versão ${orcamento.total}`,
  );

  await clicar("Enviar ao cliente");
  await assentar(500);
  await pagina.getByRole("button", { name: /Enviar mesmo assim|Enviar ao cliente/ }).last().click();
  await esperarTexto("Enviado");
  await clicar("Registrar aceite");
  await esperarTexto("Aceito");
  afirmar("proposta enviada e aceita", true, estado.ids.orcamento.code ?? "");
});

etapa("pedido", async () => {
  await pagina.goto(`${WEB}/comercial/projetos/${estado.ids.projeto.id}`);
  await clicar("Aprovar projeto");
  await assentar(700);
  await confirmarDialogo("Aprovar");
  await esperarTexto("Aprovado");
  await clicar("Gerar pedido a partir do orçamento aceito", { exact: false });
  await pagina.waitForFunction(
    () => location.pathname.includes("/comercial/pedidos/") && /PED-\d{6}/.test(document.body.innerText),
    { timeout: 30000 },
  );
  const id = pagina.url().match(/\/pedidos\/([0-9a-f-]{36})/)[1];
  const codigo = (await pagina.locator("h1").first().innerText()).match(/PED-\d{6}/)?.[0] ?? null;
  estado.ids.pedido = { id, code: codigo };
  const pedido = entidade(await ler(`/customer-orders/${id}`), "customerOrder");
  const origem = pedido.commercialOrigin ?? {};
  afirmar(
    "o Pedido congela bruto, desconto e total acordados",
    bate(Number(origem.subtotalAmount), estado.numeros.bruto) &&
      bate(Number(origem.paymentSchedule?.discountAmount), estado.numeros.desconto) &&
      bate(Number(origem.totalAmount), estado.numeros.total),
    `bruto ${origem.subtotalAmount} · desconto ${origem.paymentSchedule?.discountAmount} · total ${origem.totalAmount}`,
  );
  afirmar(
    "o Pedido nasce da proposta aceita, com o preço acordado na linha",
    origem.quoteVersionId === estado.ids.orcamento.id &&
      Math.abs(Number(pedido.lines?.[0]?.agreedPrice?.unitPrice ?? pedido.lines?.[0]?.agreedPrice) - estado.numeros.precoUnitario) < 0.00005,
    `${origem.quoteCode} · linha ${JSON.stringify(pedido.lines?.[0]?.agreedPrice)}`,
  );

  await clicar("Confirmar pedido");
  await assentar(500);
  await confirmarDialogo("Confirmar");
  await esperarTexto("Plano de Atendimento");
  afirmar("Pedido confirmado", true, codigo ?? "");
});

etapa("pedido-direto", async () => {
  await pagina.goto(`${WEB}/comercial/pedidos/novo`);
  await pagina.locator("#co-customer").first().waitFor({ timeout: 25000 });
  await escolherEntidade(pagina.locator("#co-customer").first(), P);
  await clicar("+ Adicionar produto");
  await escolherEntidade(pagina.locator('[id^="pedido-produto-"]').last(), estado.ids.produto.code);
  await pagina.getByLabel(new RegExp(`Quantidade de ${estado.ids.produto.code}`)).fill("10");
  await pagina.locator("#co-notes").first().fill(`Golden path ${P} — pedido direto, sem orçamento`);
  await clicar("Salvar rascunho");
  await pagina.waitForURL(/\/comercial\/pedidos\/[0-9a-f-]{36}$/, { timeout: 25000 });
  await pagina.waitForFunction(() => /^PED-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""), { timeout: 25000 });
  const codigo = (await pagina.locator("h1").first().innerText()).trim();
  estado.ids.pedidoDireto = { id: pagina.url().match(/\/pedidos\/([0-9a-f-]{36})$/)[1], code: codigo };
  afirmar("Pedido direto, sem orçamento, criado pela interface (rascunho)", /^PED-\d{6}$/.test(codigo), codigo);
});

/* ───────────────────────── Planejamento, compras e estoque ───────────────────────── */

/** Necessidade física canônica para 200 un — base 100, então 2×. */
const NECESSIDADE = { mpA: 6, mpB: 1000, pote: 200, rotulo: 200, caixa: 10 };
/** Preço de compra por item — o mesmo das ofertas e da referência. */
const PRECO_COMPRA = { mpA: "200", mpB: "0,50", pote: "0,80", rotulo: "0,15", caixa: "2,40" };
const chaveDoItem = (itemId) => Object.keys(NECESSIDADE).find((k) => estado.ids[k]?.id === itemId);
const fornecedorDe = (chave) => (["mpA", "mpB"].includes(chave) ? "fornecedorMp" : "fornecedorEmb");

/** Decimal cru da API ("6.000000000000") ou digitado em pt-BR ("0,50"). */
function decimalDe(texto) {
  if (texto === null || texto === undefined || texto === "") return null;
  const s = String(texto).trim();
  const v = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(v) ? v : null;
}

async function abrirPedido() {
  await pagina.goto(`${WEB}/comercial/pedidos/${estado.ids.pedido.id}`);
  await pagina.waitForFunction(() => /PED-\d{6}/.test(document.querySelector("h1")?.textContent ?? ""), null, { timeout: 25000 });
  await assentar(1200);
}

etapa("necessidade-producao", async () => {
  const plano = await ler(`/customer-orders/${estado.ids.pedido.id}/fulfillment-plan`);
  const linha = plano.lines?.[0] ?? {};
  afirmar(
    `pedido de ${QTD_PEDIDO} un sem PA em estoque: o sistema pede produção`,
    linha.situation === "REQUER_PRODUCAO" && decimalDe(linha.finishedGoodsAvailable) === 0 && decimalDe(linha.suggestedProductionQuantity) === QTD_PEDIDO,
    `${linha.situation} · disponível ${linha.finishedGoodsAvailable} · produzir ${linha.suggestedProductionQuantity}`,
  );
  for (const [chave, qtd] of Object.entries(NECESSIDADE)) {
    const impacto = (plano.materialImpact ?? []).find((m) => m.itemId === estado.ids[chave].id);
    afirmar(
      `necessidade de ${estado.ids[chave].code}: ${qtd} ${itemPor(chave).unidade}`,
      decimalDe(impacto?.requiredQuantity) === qtd && impacto?.unitCode === itemPor(chave).unidade,
      `${impacto?.requiredQuantity} ${impacto?.unitCode} · falta ${impacto?.shortage}`,
    );
  }
  await abrirPedido();
  const produzir = pagina.getByLabel(`Produzir de ${estado.ids.produto.code}`, { exact: true });
  await produzir.waitFor({ timeout: 25000 });
  afirmar("o plano sugere produzir tudo e reservar nada", decimalDe(await produzir.inputValue()) === QTD_PEDIDO, await produzir.inputValue());
  await clicar("Aplicar Plano de Atendimento");
  await confirmarDialogo("Aplicar Plano");
  const linkDaOp = pagina.locator('a[href^="/producao/ordens/"]').first();
  await linkDaOp.waitFor({ timeout: 30000 });
  estado.ids.op = { id: (await linkDaOp.getAttribute("href")).match(/\/producao\/ordens\/([0-9a-f-]{36})/)?.[1] ?? null };
  const pedido = await ler(`/customer-orders/${estado.ids.pedido.id}`);
  afirmar(
    "Plano aplicado: OP gerada para o pedido",
    Boolean(estado.ids.op.id) && (pedido.generatedProductionOrders ?? []).length === 1,
    `pedido ${pedido.status} · OPs ${JSON.stringify(pedido.generatedProductionOrders).slice(0, 160)}`,
  );
});

etapa("sugestao-compra", async () => {
  await abrirPedido();
  await esperarTexto("Sugestão de Compra");
  for (const [chave, qtd] of Object.entries(NECESSIDADE)) {
    const codigo = estado.ids[chave].code;
    const campo = pagina.getByLabel(`Comprar de ${codigo}`, { exact: true });
    await campo.waitFor({ timeout: 25000 });
    afirmar(`sugestão de compra de ${codigo}: ${qtd} ${itemPor(chave).unidade}`, decimalDe(await campo.inputValue()) === qtd, await campo.inputValue());
    const seletor = campo.locator("xpath=ancestor::tr[1]").locator("select");
    const escolhido = await seletor.inputValue();
    const esperado = estado.ids[fornecedorDe(chave)].id;
    if (!escolhido) {
      // Sem homologado (a Caixa só tem referência manual): escolher em "Demais fornecedores ativos".
      await seletor.selectOption(esperado);
      console.log(`  ${codigo}: nenhum homologado — fornecedor escolhido na lista de demais ativos`);
    } else {
      afirmar(`fornecedor pré-selecionado de ${codigo} é o único homologado`, escolhido === esperado, escolhido);
    }
  }
  await clicar("Gerar OCs em rascunho");
  await confirmarDialogo("Gerar OCs em rascunho");
  await assentar(2500);
  const pedido = await ler(`/customer-orders/${estado.ids.pedido.id}`);
  const ocs = pedido.linkedPurchaseOrders ?? [];
  estado.ids.ocs = ocs.map((oc) => ({ id: oc.id ?? oc.purchaseOrderId, code: oc.code ?? oc.purchaseOrderCode ?? null }));
  afirmar("uma OC em rascunho por fornecedor, ligada ao Pedido", ocs.length === 2, JSON.stringify(ocs).slice(0, 300));
});

etapa("compras", async () => {
  for (const oc of estado.ids.ocs) {
    const po = entidade(await ler(`/purchase-orders/${oc.id}`), "purchaseOrder");
    oc.code = po.code;
    oc.supplierId = po.supplierId;
    oc.linhas = (po.lines ?? []).map((l) => ({ id: l.id, itemId: l.itemId, itemCode: l.itemCode, qtd: l.orderedQuantity ?? l.quantity }));
    await pagina.goto(`${WEB}/compras/ordens/${oc.id}`);
    await pagina.waitForFunction(() => /^OC-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""), null, { timeout: 25000 });
    for (const l of oc.linhas) {
      await pagina.getByLabel(`Preço unitário de ${l.itemCode}`, { exact: true }).fill(PRECO_COMPRA[chaveDoItem(l.itemId)]);
    }
    const salvo = esperarResposta(["PUT", "PATCH", "POST"], /^\/purchase-orders\/[0-9a-f-]{36}/);
    await clicar("Salvar rascunho");
    exigir(`preços da ${po.code} salvos no rascunho`, (await salvo).ok());
    await assentar(1200);
    await clicar("Confirmar OC");
    await confirmarDialogo("Confirmar");
    await pagina.getByRole("button", { name: "Receber materiais" }).waitFor({ timeout: 25000 });
    const confirmada = entidade(await ler(`/purchase-orders/${oc.id}`), "purchaseOrder");
    afirmar(
      `${po.code} confirmada — ${oc.linhas.map((l) => `${l.itemCode} ${decimalDe(l.qtd)}`).join(", ")}`,
      // "Confirmado" na tela é ORDERED no domínio.
      ["ORDERED", "CONFIRMED"].includes(confirmada.status),
      confirmada.status,
    );
  }
});

/** Recebe pela tela as linhas pedidas da OC; linha sem alvo fica vazia (não recebe agora). */
async function receber(oc, porItem) {
  // Linhas relidas agora: salvar o rascunho da OC recria as linhas, e o id
  // guardado antes deixa de existir.
  const atual = entidade(await ler(`/purchase-orders/${oc.id}`), "purchaseOrder");
  oc.linhas = (atual.lines ?? []).map((l) => ({ id: l.id, itemId: l.itemId, itemCode: l.itemCode, qtd: l.orderedQuantity ?? l.quantity }));
  await pagina.goto(`${WEB}/compras/ordens/${oc.id}`);
  await clicar("Receber materiais");
  await pagina.waitForURL(/\/compras\/recebimentos\/novo/, { timeout: 25000 });
  await pagina.locator('input[id^="receive-now-"]').first().waitFor({ timeout: 25000 });
  for (const l of oc.linhas) {
    const alvo = porItem[chaveDoItem(l.itemId)];
    if (!alvo) continue;
    await pagina.locator(`#receive-now-${l.id}`).fill(alvo.qtd);
    if (await pagina.locator(`#supplier-lot-${l.id}`).count()) await pagina.locator(`#supplier-lot-${l.id}`).fill(alvo.lote);
    if (await pagina.locator(`#expiry-${l.id}`).count()) await pagina.locator(`#expiry-${l.id}`).fill(diaComercial(365));
    // Custo real é decisão explícita: a tela nunca assume o preço da OC.
    await pagina
      .locator(`#cost-${l.id}`)
      .locator("xpath=ancestor::div[contains(@class,'field')][1]")
      .getByRole("button", { name: "Usar preço da OC" })
      .click();
  }
  const confirmado = esperarResposta("POST", /^\/purchase-orders\/[0-9a-f-]{36}\/receipts$/);
  await clicar("Confirmar recebimento");
  await confirmarDialogo("Confirmar");
  const resposta = await confirmado;
  exigir(`recebimento da ${oc.code} confirmado`, resposta.ok(), `${resposta.status()}`);
  await pagina.waitForURL(/\/compras\/recebimentos\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await pagina.waitForFunction(() => /^REC-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""), null, { timeout: 25000 });
  return (await pagina.locator("h1").first().innerText()).trim();
}

const ocDe = (fornecedor) => estado.ids.ocs.find((o) => o.supplierId === estado.ids[fornecedor].id);

etapa("recebimento-parcial", async () => {
  const oc = ocDe("fornecedorMp");
  const rec = await receber(oc, { mpA: { qtd: "4", lote: `LF-${run.runId}-A1` } });
  const po = entidade(await ler(`/purchase-orders/${oc.id}`), "purchaseOrder");
  afirmar(`${rec}: 4 de 6 kg de ${estado.ids.mpA.code} — OC recebida parcialmente`, po.status === "PARTIALLY_RECEIVED", po.status);
});

etapa("recebimento-completo", async () => {
  const ocMp = ocDe("fornecedorMp");
  const rec2 = await receber(ocMp, {
    mpA: { qtd: "2", lote: `LF-${run.runId}-A2` },
    mpB: { qtd: "1000", lote: `LF-${run.runId}-B1` },
  });
  const ocEmb = ocDe("fornecedorEmb");
  const rec3 = await receber(ocEmb, {
    pote: { qtd: "200", lote: `LF-${run.runId}-P1` },
    rotulo: { qtd: "200", lote: `LF-${run.runId}-R1` },
    caixa: { qtd: "10", lote: `LF-${run.runId}-C1` },
  });
  for (const oc of [ocMp, ocEmb]) {
    const po = entidade(await ler(`/purchase-orders/${oc.id}`), "purchaseOrder");
    afirmar(`${po.code} totalmente recebida (${oc === ocMp ? rec2 : rec3})`, po.status === "RECEIVED", po.status);
  }
});

/** Lotes do item, como a API os devolve. */
async function lotesDe(chave) {
  const r = await ler(`/lots?itemId=${estado.ids[chave].id}&pageSize=50`);
  return r.lots ?? r.items ?? r.data ?? (Array.isArray(r) ? r : []);
}

etapa("qualidade", async () => {
  const todos = [];
  for (const chave of Object.keys(NECESSIDADE)) for (const lote of await lotesDe(chave)) todos.push({ chave, ...lote });
  for (const l of todos) {
    console.log(`  ${l.code} · ${estado.ids[l.chave].code} · fornecedor ${l.supplierLotCode ?? l.supplierLot ?? "—"} · validade ${String(l.expiryDate ?? "—").slice(0, 10)} · ${l.status} · ${l.quantity ?? l.currentQuantity ?? l.onHand ?? "?"}`);
  }
  const mp = todos.filter((l) => ["mpA", "mpB"].includes(l.chave));
  afirmar(
    "três lotes de matéria-prima (dois de MP-A, um de MP-B), todos aguardando liberação",
    mp.length === 3 && mp.every((l) => l.status === "AWAITING_RELEASE"),
    mp.map((l) => l.status).join(","),
  );
  afirmar(
    "lote interno próprio e lote do fornecedor preservado à parte",
    mp.every((l) => /^LT-/.test(l.code ?? "") && String(l.supplierLotCode ?? l.supplierLot ?? "").startsWith("LF-")),
  );
  const emb = todos.filter((l) => !["mpA", "mpB"].includes(l.chave));
  afirmar("embalagem, sem exigência de liberação, nasce utilizável", emb.length === 3 && emb.every((l) => l.status !== "AWAITING_RELEASE"), emb.map((l) => l.status).join(","));

  afirmar(
    `lote interno com o dia comercial do recebimento — LT-${HOJE.replace(/-/g, "")}-… (RECEIPT-BUSINESS-DAY-01)`,
    todos.every((l) => String(l.code ?? "").startsWith(`LT-${HOJE.replace(/-/g, "")}-`)),
    todos.map((l) => l.code).join(", "),
  );

  // O Plano de Atendimento só responde com o Pedido confirmado; em atendimento, a posição é /inventory.
  const mpAAntes = await ler(`/inventory/${estado.ids.mpA.id}`);
  afirmar(
    "matéria-prima em quarentena está no físico e fora do disponível, e o motivo é dito",
    decimalDe(mpAAntes.onHand) === 6 &&
      decimalDe(mpAAntes.available) === 0 &&
      (mpAAntes.unavailable ?? []).some((u) => u.reason === "AWAITING_QUALITY_RELEASE"),
    `físico ${mpAAntes.onHand} · disponível ${mpAAntes.available} · ${JSON.stringify(mpAAntes.unavailable)}`,
  );

  for (const l of mp) {
    await pagina.goto(`${WEB}/estoque/lotes/${l.id}`);
    await pagina.getByRole("button", { name: "Liberar", exact: true }).first().waitFor({ timeout: 25000 });
    await clicar("Liberar");
    await confirmarDialogo("Liberar");
    await assentar(1500);
    const depois = entidade(await ler(`/lots/${l.id}`), "lot");
    afirmar(`${depois.code ?? l.code} liberado pela Qualidade`, depois.status !== "AWAITING_RELEASE", depois.status);
  }
  estado.ids.lotes = todos.map((l) => ({ chave: l.chave, id: l.id, code: l.code }));
});

etapa("estoque", async () => {
  for (const [chave, qtd] of Object.entries(NECESSIDADE)) {
    const m = await ler(`/inventory/${estado.ids[chave].id}`);
    afirmar(
      `estoque de ${estado.ids[chave].code}: ${qtd} ${itemPor(chave).unidade} físico e disponível, nada reservado`,
      decimalDe(m.onHand) === qtd && decimalDe(m.available) === qtd && decimalDe(m.reserved) === 0,
      `físico ${m.onHand} · reservado ${m.reserved} · disponível ${m.available}`,
    );
  }
  await pagina.goto(`${WEB}/estoque`);
  await pagina.locator("#inventory-search").first().fill(P);
  await assentar(1500);
  const tela = await pagina.locator("table").first().innerText().catch(() => "");
  afirmar("a Posição de Estoque mostra os cinco materiais da execução", Object.keys(NECESSIDADE).every((k) => tela.includes(estado.ids[k].code)));
});

/* ───────────────────────────── Produção ───────────────────────────── */

/** Uma seção da tela pelo título (`FormSection` desenha o título num `h3`). */
const secao = (titulo) =>
  pagina.locator("section.form-section", { has: pagina.locator("h3", { hasText: titulo }) }).first();
const lerOp = async () => entidade(await ler(`/production-orders/${estado.ids.op.id}`), "productionOrder");
const resumoDasNecessidades = (op, campo) =>
  (op.requirements ?? []).map((r) => `${r.itemCode} ${r[campo]}/${r.requiredQuantity}`).join(", ");

async function abrirOp() {
  await pagina.goto(`${WEB}/producao/ordens/${estado.ids.op.id}`);
  await pagina.waitForFunction(() => /OP-\d{6}/.test(document.querySelector("h1")?.textContent ?? ""), null, { timeout: 25000 });
  await assentar(1200);
}

etapa("op", async () => {
  let op = await lerOp();
  afirmar(
    `${op.code} nasceu do Pedido ${op.customerOrderCode} em rascunho: ${QTD_PEDIDO} un, formulação ${op.formulationVersionLabel}, fator ${op.productionFactor}`,
    op.status === "DRAFT" && op.origin === "CUSTOMER_ORDER" && decimalDe(op.plannedQuantity) === QTD_PEDIDO && op.productId === estado.ids.produto.id,
    `${op.status} · ${op.origin}`,
  );
  await abrirOp();
  await clicar("Planejar OP");
  await pagina.getByText("Planejada", { exact: true }).first().waitFor({ timeout: 30000 });
  op = await lerOp();
  for (const [chave, qtd] of Object.entries(NECESSIDADE)) {
    const r = (op.requirements ?? []).find((x) => x.itemId === estado.ids[chave].id);
    afirmar(
      `necessidade congelada na OP: ${estado.ids[chave].code} ${qtd} ${itemPor(chave).unidade} — ${r?.availabilityStatus ?? "?"}`,
      decimalDe(r?.requiredQuantity) === qtd && r?.stockUnitCode === itemPor(chave).unidade,
      `${r?.requiredQuantity} ${r?.stockUnitCode} · disponível ${r?.available}`,
    );
  }
  await abrirOp();
  await clicar("Liberar OP");
  await confirmarDialogo("Liberar");
  await pagina.getByText("Liberada", { exact: true }).first().waitFor({ timeout: 30000 });
  op = await lerOp();
  estado.ids.op.code = op.code;
  estado.ids.op.numero = op.officialNumber;
  afirmar(
    `OP liberada com número oficial ${op.officialNumber}, material reservado por inteiro`,
    op.status === "RELEASED" &&
      /^\d{3}\/\d{2}$/.test(String(op.officialNumber ?? "")) &&
      (op.requirements ?? []).every((r) => decimalDe(r.allocatedQuantity) === decimalDe(r.requiredQuantity)),
    `${op.status} · ${resumoDasNecessidades(op, "allocatedQuantity")}`,
  );
});

etapa("separacao", async () => {
  await abrirOp();
  const pendentes = () => pagina.getByRole("button", { name: "Escanear / Informar lote", exact: true });
  const conferidos = () =>
    pagina.evaluate(() => [...document.querySelectorAll(".badge")].filter((b) => b.textContent?.trim() === "Conferido").length);
  const total = await pendentes().count();
  exigir("a OP liberada tem linhas de separação por lote", total > 0, `${total} linha(s)`);
  for (let i = 0; i < total + 2 && (await pendentes().count()) > 0; i += 1) {
    const botao = pendentes().first();
    const lote = (await botao.locator("xpath=ancestor::tr[1]").locator("td").nth(1).innerText()).trim();
    const antes = await conferidos();
    await botao.click();
    // Conferir é digitar o lote da etiqueta — o mesmo campo do leitor de código.
    await pagina.locator("#lot-scanner-manual").fill(lote);
    await clicar("Buscar");
    await pagina.waitForFunction(
      (n) => [...document.querySelectorAll(".badge")].filter((b) => b.textContent?.trim() === "Conferido").length > n,
      antes,
      { timeout: 25000 },
    );
    console.log(`  separação: ${lote} conferido`);
  }
  afirmar(
    "toda linha da reserva conferida pelo lote real",
    (await pendentes().count()) === 0 && (await conferidos()) === total,
    `${await conferidos()} de ${total}`,
  );
});

etapa("consumo", async () => {
  await abrirOp();
  const tabela = secao("Consumo Real");
  await tabela.locator("tbody tr").first().waitFor({ timeout: 25000 });
  const lotes = await tabela
    .locator("tbody tr")
    .evaluateAll((trs) => trs.map((tr) => tr.children[1]?.textContent?.trim() ?? "").filter((t) => t && t !== "—"));
  for (const lote of lotes) {
    const linha = tabela.locator("tbody tr", { hasText: lote }).first();
    const restante = numeroDe(await linha.locator("td").nth(4).innerText());
    if (!restante) continue;
    await linha.locator("input").fill(String(restante).replace(".", ","));
    const consumido = esperarResposta("POST", /^\/production-orders\/[0-9a-f-]{36}\/consumptions$/);
    await linha.getByRole("button", { name: "Confirmar consumo" }).click();
    const resposta = await consumido;
    exigir(`consumo real de ${lote}: ${restante}`, resposta.ok(), `${resposta.status()}`);
    await assentar(1200);
  }
  const op = await lerOp();
  afirmar(
    "consumo real = necessidade da fórmula em todo material — nada a reconciliar",
    op.status === "IN_PRODUCTION" &&
      op.materialReconciliation?.pendingRequirements === 0 &&
      (op.requirements ?? []).every((r) => decimalDe(r.consumedQuantity) === decimalDe(r.requiredQuantity)),
    `${op.status} · ${JSON.stringify(op.materialReconciliation)} · ${resumoDasNecessidades(op, "consumedQuantity")}`,
  );
});

etapa("producao", async () => {
  await abrirOp();
  await pagina.locator("#output-quantity").first().waitFor({ timeout: 25000 });
  await preencher("output-quantity", String(QTD_PEDIDO));
  await escolher("output-destination", "NEW_LOT");
  await preencher("output-business-lot", `LV-${run.runId}`);
  if (await pagina.locator("#output-expiry").count()) await preencher("output-expiry", diaComercial(730));
  const registrado = esperarResposta("POST", /^\/production-orders\/[0-9a-f-]{36}\/outputs$/);
  await clicar("Registrar produção");
  const resposta = await registrado;
  exigir("produção realizada registrada", resposta.ok(), `${resposta.status()}`);
  await assentar(1500);
  const op = await lerOp();
  afirmar(
    `produzido ${QTD_PEDIDO} de ${QTD_PEDIDO} un`,
    decimalDe(op.producedQuantity) === QTD_PEDIDO && decimalDe(op.remainingQuantity) === 0,
    `${op.producedQuantity} · resta ${op.remainingQuantity}`,
  );
});

etapa("conclusao", async () => {
  await abrirOp();
  afirmar("a tela não acusa material por reconciliar", (await pagina.getByText(/Falta reconciliar/).count()) === 0);
  await clicar("Concluir OP");
  await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Concluir OP", exact: true }).click();
  await assentar(2000);
  const op = await lerOp();
  afirmar("OP concluída — produzido igual ao planejado, sem motivo de variação", op.status === "COMPLETED" && !op.completionReason, op.status);
  for (const chave of Object.keys(NECESSIDADE)) {
    const m = await ler(`/inventory/${estado.ids[chave].id}`);
    afirmar(
      `${estado.ids[chave].code} consumido por inteiro: físico 0, nada reservado, nada negativo`,
      decimalDe(m.onHand) === 0 && decimalDe(m.reserved) === 0,
      `físico ${m.onHand} · reservado ${m.reserved}`,
    );
  }
});

etapa("pa-estoque", async () => {
  const resposta = await ler(`/lots?itemId=${estado.ids.produto.paItemId}&pageSize=50`);
  const lista = resposta.lots ?? resposta.items ?? resposta.data ?? (Array.isArray(resposta) ? resposta : []);
  const pa = lista[0] ?? {};
  estado.ids.lotePA = { id: pa.id, code: pa.code };
  afirmar(
    `um lote de PA com o dia comercial da produção: ${pa.code}, ${QTD_PEDIDO} un, aguardando liberação`,
    lista.length === 1 && pa.status === "AWAITING_RELEASE" && String(pa.code ?? "").startsWith(`LT-${HOJE.replace(/-/g, "")}-`),
    `${pa.code} · lote Veridi ${pa.businessLotNumber ?? "?"} · validade ${String(pa.expiryDate ?? "—").slice(0, 10)} · ${pa.status}`,
  );
  const detalhe = entidade(await ler(`/lots/${pa.id}`), "lot");
  afirmar("rastreabilidade: o lote de PA aponta para a OP que o produziu", detalhe.productionOrderCode === estado.ids.op.code, `${detalhe.productionOrderCode}`);

  await pagina.goto(`${WEB}/estoque/lotes/${pa.id}`);
  await pagina.getByRole("button", { name: "Liberar", exact: true }).first().waitFor({ timeout: 25000 });
  await clicar("Liberar");
  await confirmarDialogo("Liberar");
  await assentar(1500);
  const inv = await ler(`/inventory/${estado.ids.produto.paItemId}`);
  afirmar(
    `PA liberado pela Qualidade: ${QTD_PEDIDO} un físico e disponível`,
    decimalDe(inv.onHand) === QTD_PEDIDO && decimalDe(inv.available) === QTD_PEDIDO,
    `físico ${inv.onHand} · disponível ${inv.available}`,
  );
});

/* ───────────────────────── Atendimento, expedição e faturamento ───────────────────────── */

etapa("reserva", async () => {
  await abrirPedido();
  const bloco = secao("Reservar Produto Acabado");
  await bloco.waitFor({ timeout: 25000 });
  await bloco.getByLabel(`Reservar de ${estado.ids.produto.code}`, { exact: true }).fill(String(QTD_PEDIDO));
  await bloco.getByRole("button", { name: "Reservar disponível", exact: true }).click();
  await assentar(2000);
  const inv = await ler(`/inventory/${estado.ids.produto.paItemId}`);
  afirmar(
    `${QTD_PEDIDO} un do PA produzido reservadas para o Pedido`,
    decimalDe(inv.reserved) === QTD_PEDIDO && decimalDe(inv.available) === 0,
    `reservado ${inv.reserved} · disponível ${inv.available}`,
  );
  await clicar("Preparar Expedição");
  await pagina.waitForURL(/\/comercial\/expedicoes\/[0-9a-f-]{36}/, { timeout: 25000 });
  estado.ids.expedicao = { id: pagina.url().match(/\/expedicoes\/([0-9a-f-]{36})/)[1] };
});

etapa("expedicao", async () => {
  await pagina.goto(`${WEB}/comercial/expedicoes/${estado.ids.expedicao.id}`);
  await pagina.waitForFunction(() => /EXP-\d{6}/.test(document.body.innerText), null, { timeout: 25000 });
  // Conferência física: digitar o lote da etiqueta. O código não vem preenchido de propósito.
  const campos = pagina.locator('input[aria-label^="Lote conferido da linha"]');
  await campos.first().waitFor({ timeout: 25000 });
  for (let i = 0; i < 10 && (await campos.count()) > 0; i += 1) {
    const campo = campos.first();
    const lote = ((await campo.getAttribute("aria-label")) ?? "").replace("Lote conferido da linha ", "").trim();
    const antes = await campos.count();
    await campo.fill(lote);
    await pagina.getByRole("button", { name: "Conferir lote" }).first().click();
    await pagina.waitForFunction(
      (n) => document.querySelectorAll('input[aria-label^="Lote conferido da linha"]').length < n,
      antes,
      { timeout: 25000 },
    );
    console.log(`  expedição: ${lote} conferido`);
  }
  await clicar("Confirmar expedição");
  await confirmarDialogo("Confirmar");
  await esperarTexto("Confirmada");
  const exp = entidade(await ler(`/shipments/${estado.ids.expedicao.id}`), "shipment");
  estado.ids.expedicao.code = exp.code;
  const linhas = exp.lines ?? [];
  afirmar(
    `${exp.code} confirmada — ${QTD_PEDIDO} un saindo do lote real ${estado.ids.lotePA.code}`,
    exp.status === "CONFIRMED" &&
      linhas.length > 0 &&
      linhas.every((l) => l.lotId === estado.ids.lotePA.id) &&
      linhas.reduce((s, l) => s + (decimalDe(l.quantity ?? l.shippedQuantity) ?? 0), 0) === QTD_PEDIDO,
    JSON.stringify(linhas.map((l) => ({ lote: l.lotCode, q: l.quantity ?? l.shippedQuantity }))),
  );
  const inv = await ler(`/inventory/${estado.ids.produto.paItemId}`);
  afirmar("saída de estoque: PA físico 0, reserva consumida", decimalDe(inv.onHand) === 0 && decimalDe(inv.reserved) === 0, `físico ${inv.onHand} · reservado ${inv.reserved}`);
  const pedido = await ler(`/customer-orders/${estado.ids.pedido.id}`);
  afirmar(
    "o Pedido registra tudo expedido, nada em aberto",
    decimalDe(pedido.lines?.[0]?.shippedQuantity) === QTD_PEDIDO && decimalDe(pedido.lines?.[0]?.outstandingQuantity) === 0,
    `${pedido.status} · expedido ${pedido.lines?.[0]?.shippedQuantity} · em aberto ${pedido.lines?.[0]?.outstandingQuantity}`,
  );
});

/** O primeiro campo que existir entre os nomes possíveis — o DTO nomeia valores monetários do seu jeito. */
const campoDe = (objeto, ...nomes) => nomes.map((n) => objeto?.[n]).find((v) => v !== undefined && v !== null);

etapa("faturamento", async () => {
  await pagina.goto(`${WEB}/comercial/expedicoes/${estado.ids.expedicao.id}`);
  await clicar("Preparar faturamento");
  await pagina.waitForURL(/\/comercial\/faturamento\/[0-9a-f-]{36}/, { timeout: 25000 });
  estado.ids.faturamento = { id: pagina.url().match(/\/faturamento\/([0-9a-f-]{36})/)[1] };
  await pagina.waitForFunction(
    () => /FAT-\d{6}/.test(document.body.innerText) && document.body.innerText.includes("Total faturado"),
    null,
    { timeout: 25000 },
  );
  const lerRodape = async () => {
    const texto = (await pagina.locator("body").innerText()).replace(/\s+/g, " ");
    return {
      bruto: numeroDe(texto.match(/Subtotal bruto(?: \(prévia\))?: (R\$\s?[\d.,]+)/)?.[1]),
      desconto: numeroDe(texto.match(/Desconto comercial: − (R\$\s?[\d.,]+)/)?.[1]),
      ajuste: texto.match(/Ajuste de fechamento: ([−+]) ?(R\$\s?[\d.,]+)/)?.slice(1).join(" ") ?? null,
      total: numeroDe(texto.match(/Total faturado(?: \(prévia\))?: (R\$\s?[\d.,]+)/)?.[1]),
    };
  };
  const n = estado.numeros;
  const previa = await lerRodape();
  afirmar(
    `prévia do faturamento: bruto ${reais(n.bruto)} · desconto − ${reais(n.desconto)} · total ${reais(n.total)}`,
    bate(previa.bruto, n.bruto) && bate(previa.desconto, n.desconto) && bate(previa.total, n.total),
    JSON.stringify(previa),
  );
  await clicar("Emitir faturamento");
  await confirmarDialogo("Emitir");
  await esperarTexto("Emitido");
  const emitido = await lerRodape();
  const fat = entidade(await ler(`/billings/${estado.ids.faturamento.id}`), "billing");
  estado.ids.faturamento.code = fat.code;
  const bruto = Number(campoDe(fat, "grossAmount", "subtotalAmount", "grossTotal"));
  const desconto = Number(campoDe(fat, "discountAmount", "discountTotal") ?? 0);
  const ajuste = Number(campoDe(fat, "commercialAdjustmentAmount", "adjustmentAmount") ?? 0);
  const total = Number(campoDe(fat, "totalAmount", "total", "billedTotal"));
  afirmar(
    `${fat.code} emitido: gross ${bruto} · discount ${desconto} · commercialAdjustment ${ajuste} · total ${total}`,
    fat.status === "ISSUED" && bate(bruto, n.bruto) && bate(desconto, n.desconto) && bate(ajuste, 0) && bate(total, n.total),
    `${fat.status} · tela ${JSON.stringify(emitido)}`,
  );
  afirmar("sem fragmentação, não há ajuste de fechamento na tela", emitido.ajuste === null, String(emitido.ajuste));
  const linha = (fat.lines ?? [])[0] ?? {};
  afirmar(
    "o preço unitário faturado é o acordado, sem desconto embutido na linha",
    Math.abs(Number(campoDe(linha, "unitPrice", "agreedUnitPrice")) - n.precoUnitario) < 0.00005,
    `linha ${JSON.stringify({ unitPrice: linha.unitPrice, agreed: linha.agreedUnitPrice, q: linha.quantity })}`,
  );
});

etapa("conferencia-final", async () => {
  const pedido = await ler(`/customer-orders/${estado.ids.pedido.id}`);
  console.log(`  ${pedido.code}: ${pedido.status} · faturamento ${pedido.billingStatus}`);
  afirmar(
    "o Pedido termina expedido e faturado por inteiro",
    (pedido.billings ?? []).length === 1 && /FULL|COMPLET|BILLED/i.test(String(pedido.billingStatus)),
    `${pedido.status} · ${pedido.billingStatus}`,
  );
  const op = await lerOp();
  const consumidos = new Set((op.consumptions ?? []).map((c) => c.lotCode ?? c.lot?.code).filter(Boolean));
  const recebidos = (estado.ids.lotes ?? []).map((l) => l.code);
  afirmar(
    "rastreabilidade: cada lote recebido de MP e embalagem foi consumido na OP que gerou o lote de PA expedido",
    recebidos.length === 6 && recebidos.every((c) => consumidos.has(c)),
    `recebidos ${recebidos.join(", ")} · consumidos ${[...consumidos].join(", ")}`,
  );
  console.log(
    `\n  cadeia: ${estado.ids.cliente.code} · ${estado.ids.produto.code} · ${estado.ids.orcamento.code ?? "ORC"} → ${estado.ids.pedido.code} → ` +
      `${(estado.ids.ocs ?? []).map((o) => o.code).join("+")} → ${estado.ids.op.code} (${estado.ids.op.numero}) → ${estado.ids.lotePA.code} → ` +
      `${estado.ids.expedicao.code} → ${estado.ids.faturamento.code}`,
  );
});

/* ───────────────────────────── Execução ───────────────────────────── */

let bloqueio = null;
try {
  const inicio = DESDE ? ETAPAS.findIndex((e) => e.nome === DESDE) : 0;
  if (inicio < 0) throw new Error(`etapa desconhecida: ${DESDE}. Etapas: ${ETAPAS.map((e) => e.nome).join(", ")}`);
  console.log(`golden path ${P} — ${DESDE ? `retomando em "${DESDE}"` : "execução nova"} · hoje ${HOJE} (${FUSO})`);
  for (const { nome, fn } of ETAPAS.slice(inicio)) {
    console.log(`\n[${nome}]`);
    await fn();
    estado.feitas = [...new Set([...estado.feitas, nome])];
    salvarEstado();
  }
} catch (erro) {
  bloqueio = erro;
  const captura = `handoff/golden-path-${run.runId}-falha.png`;
  const tela = await pagina.screenshot({ path: captura, fullPage: true }).then(() => captura, () => "(sem captura)");
  console.log(`\nPAROU: ${erro instanceof Bloqueio ? "bloqueio de fluxo" : "erro"} — ${String(erro.message).slice(0, 600)}`);
  console.log(`  tela: ${pagina.url()} · captura: ${tela}`);
} finally {
  salvarEstado();
  console.log("\n-- console e rede");
  afirmar("console limpo", erros.length === 0, erros.slice(0, 3).join(" | "));
  if (respostasComErro.length) console.log(`  respostas 4xx/5xx: ${[...new Set(respostasComErro)].join(" · ")}`);
  if (achados.length) {
    console.log("\n-- observações (não reprovam)");
    for (const a of achados) console.log(`  ${a}`);
  }
  await fechar();
}

if (bloqueio || falhas.length) {
  console.log(`\nREPROVADO — ${falhas.length} falha(s)${bloqueio ? ", fluxo interrompido" : ""}. Retomar: --run=${run.runId} --desde=<etapa>`);
  process.exitCode = 1;
} else {
  console.log(`\nAPROVADO — golden path ${P}. Estado: ${path.relative(process.cwd(), ARQUIVO_ESTADO)}`);
}
