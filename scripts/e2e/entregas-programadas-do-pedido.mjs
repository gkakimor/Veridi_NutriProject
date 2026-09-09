import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Entregas programadas — COM-04, pela interface.
 *
 * O que a suíte prova, clicando:
 *
 * 1. um Pedido confirmado aceita promessas com datas diferentes, e a soma
 *    delas zera o saldo programável;
 * 2. prometer acima do saldo é recusado ANTES do envio, na própria tela;
 * 3. programar não expede: nenhuma Expedição nasce das promessas;
 * 4. "Preparar expedição" a partir de uma entrega abre a separação limitada ao
 *    que aquela promessa pedia, e a confirmação atende só ela;
 * 5. atendimento parcial deixa a primeira entrega parcial e a segunda intacta;
 * 6. reprogramar o saldo encerra a promessa antiga — que continua mostrando o
 *    que já entregou — e cria a substituta só com o pendente.
 *
 * A massa de PRODUTO ACABADO não é fabricada aqui: a suíte DESCOBRE um produto
 * que já tem saldo no DEV e vende esse. A API entra como consulta de massa e
 * nada mais — todo o caminho de negócio é clique.
 *
 * Resíduo declarado: Expedição confirmada é irreversível por desenho. A suíte
 * deixa no DEV um Pedido carimbado pelo `runId`, com uma expedição confirmada e
 * o cronograma dela. Nada é apagado por SQL.
 *
 *   node scripts/e2e/entregas-programadas-do-pedido.mjs
 */

/** Total do Pedido e a divisão das duas promessas. */
const TOTAL = 10;
const ENTREGA_A = 4;
const ENTREGA_B = 6;
/** Quanto sai na primeira expedição — deixa 2 pendentes em A. */
const EXPEDIR = 2;

const DATA_A = "2026-10-15";
const DATA_B = "2026-11-15";
const DATA_REPROGRAMADA = "2026-12-15";

const run = obterRun({ novo: true, dono: "com-04" });

const falhas = [];
function afirmar(descricao, condicao, detalhe = "") {
  const linha = `${descricao}${detalhe ? ` — ${detalhe}` : ""}`;
  if (condicao) {
    console.log(`  ok   ${linha}`);
    return true;
  }
  falhas.push(linha);
  console.log(`  FALHA ${linha}`);
  return false;
}

const { pagina, api, erros, fechar } = await abrirNavegador();

/*
 * Recusa de negócio esperada não existe neste roteiro: o excesso é barrado na
 * tela, antes do envio. Qualquer 4xx/5xx aqui é defeito.
 */
const respostasComErro = [];
pagina.on("response", (resposta) => {
  if (resposta.status() >= 400) {
    respostasComErro.push({ status: resposta.status(), url: resposta.url() });
  }
});

/**
 * Clica, repetindo enquanto a tela ainda se remonta.
 *
 * Escolher um cliente dispara o carregamento do endereço e dos produtos dele,
 * e o botão seguinte é remontado no meio do clique. Repetir é a resposta certa:
 * o defeito seria o botão não funcionar, não a corrida entre o clique e o
 * segundo render.
 */
async function clicar(nome, { exact = true } = {}) {
  const botao = pagina.getByRole("button", { name: nome, exact }).first();
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      await botao.waitFor({ state: "visible", timeout: 20000 });
      await botao.click({ timeout: 5000 });
      return;
    } catch (erro) {
      if (tentativa >= 5) throw erro;
      await pagina.waitForLoadState("networkidle");
    }
  }
}

/**
 * Escolhe uma opção de um campo de busca de entidade, digitando.
 *
 * A lista traz "+ Novo <entidade>: …" como primeira opção — a criação em
 * contexto. Clicar nela abre um formulário e não seleciona nada; a suíte
 * precisa do registro que JÁ existe, então essa opção é descartada pelo texto.
 */
async function escolher(campoId, termo) {
  const campo = pagina.locator(`#${campoId}`);
  await campo.click();
  await campo.fill("");
  await campo.type(termo, { delay: 20 });
  const opcao = pagina
    .locator('[role="option"]', { hasText: termo })
    .filter({ hasNotText: /^\s*\+\s*Nov[oa]/ })
    .first();
  await opcao.waitFor({ state: "visible", timeout: 15000 });
  await opcao.click();
  await pagina.waitForLoadState("networkidle");
}

/** O botão de confirmação DENTRO do diálogo — nunca o que o abriu. */
async function confirmarDialogo(rotulo) {
  await pagina
    .locator(".confirm-dialog__actions")
    .getByRole("button", { name: rotulo, exact: true })
    .click();
}

async function esperarTexto(texto, timeout = 25000) {
  await pagina.waitForFunction((alvo) => document.body.innerText.includes(alvo), texto, { timeout });
}

/**
 * Espera o título de uma seção do formulário.
 *
 * Não serve procurar no `innerText`: `.form-section h3` é `text-transform:
 * uppercase`, e o texto renderizado que o navegador devolve vem em caixa alta.
 * O nome real da seção está no DOM, e é por ele que se espera.
 */
async function esperarSecao(titulo, timeout = 25000) {
  await pagina.waitForFunction(
    (alvo) => [...document.querySelectorAll("h3")].some((h3) => h3.textContent.trim() === alvo),
    titulo,
    { timeout },
  );
}

const textoDaPagina = () => pagina.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

/** A linha da tabela de entregas cujo primeiro campo é "Entrega N". */
async function linhaDaEntrega(sequencia) {
  return pagina.evaluate((seq) => {
    const linhas = [...document.querySelectorAll("table tbody tr")];
    const alvo = linhas.find((tr) => tr.textContent.trim().startsWith(`Entrega ${seq}`));
    return alvo ? alvo.textContent.replace(/\s+/g, " ").trim() : null;
  }, sequencia);
}

let catalogo = null;
async function catalogoPorItem() {
  if (catalogo) return catalogo;
  catalogo = new Map();
  for (let page = 1; page <= 20; page += 1) {
    const { corpo } = await api(`/products?page=${page}&pageSize=100`);
    const lote = corpo?.products ?? [];
    if (lote.length === 0) break;
    for (const produto of lote) {
      if (produto.finishedProductItemId && produto.customer?.code) {
        catalogo.set(produto.finishedProductItemId, produto);
      }
    }
    if (lote.length < 100) break;
  }
  return catalogo;
}

async function produtoComSaldo() {
  for (let page = 1; page <= 20; page += 1) {
    const posicao = await api(`/inventory?type=FINISHED_PRODUCT&page=${page}&pageSize=100`);
    const linhas = posicao.corpo?.items ?? [];
    if (linhas.length === 0) return null;
    for (const linha of linhas) {
      if (Number(linha.available ?? "0") < TOTAL) continue;
      const produto = (await catalogoPorItem()).get(linha.itemId);
      if (produto) return { produto, disponivel: linha.available };
    }
  }
  return null;
}

try {
  console.log(`\n== massa (${run.runId})`);
  const alvo = await produtoComSaldo();
  if (!alvo) {
    console.log(`  SEM MASSA: nenhum produto acabado com ${TOTAL} disponíveis no DEV.`);
    console.log("  A suíte não avalia nada nesta condição — não é reprovação do produto.");
    await fechar();
    process.exit(0);
  }
  const { produto, disponivel } = alvo;
  console.log(`  produto ${produto.code} · cliente ${produto.customer.code} · disponível ${disponivel}`);

  /* ---------------- Pedido confirmado, com o Plano aplicado ---------------- */
  console.log("\n== pedido");
  await pagina.goto(`${WEB}/comercial/pedidos/novo`, { waitUntil: "networkidle" });
  await escolher("co-customer", produto.customer.code);

  await clicar("+ Adicionar produto");
  const seletor = pagina.locator('[id^="pedido-produto-"]').last();
  await seletor.click();
  await seletor.type(produto.code, { delay: 20 });
  await pagina
    .locator('[role="option"]', { hasText: produto.code })
    .filter({ hasNotText: /^\s*\+\s*Nov[oa]/ })
    .first()
    .click();
  await pagina.getByLabel(new RegExp(`Quantidade de ${produto.code}`)).fill(String(TOTAL));
  await pagina.locator("#co-notes").fill(`E2E ${run.runId} — COM-04`);

  await clicar("Salvar rascunho");
  await pagina.waitForURL(/\/comercial\/pedidos\/[0-9a-f-]{36}$/, { timeout: 25000 });
  await pagina.waitForFunction(
    () => /^PED-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
    { timeout: 25000 },
  );
  const urlDoPedido = pagina.url();
  const codigoDoPedido = (await pagina.locator("h1").first().textContent())?.trim() ?? "";
  afirmar("pedido criado", /^PED-\d+$/.test(codigoDoPedido), codigoDoPedido);

  await clicar("Confirmar pedido");
  await confirmarDialogo("Confirmar");
  await pagina.getByRole("button", { name: "Aplicar Plano de Atendimento" }).waitFor({ timeout: 25000 });

  await pagina.getByLabel(new RegExp(`Reservar de ${produto.code}`)).fill(String(TOTAL));
  await clicar("Aplicar Plano de Atendimento");
  await confirmarDialogo("Aplicar Plano");
  await esperarSecao("Entregas programadas");
  afirmar("pedido em atendimento, com a seção de entregas visível", true);

  /* ---------------- a primeira promessa ---------------- */
  console.log("\n== programar");
  await clicar("Adicionar entrega programada");
  await pagina.getByLabel(/Data programada/).fill(DATA_A);
  await pagina.getByLabel(new RegExp(`Programar ${produto.code}`)).fill(String(ENTREGA_A));
  await clicar("Salvar entrega");
  await esperarTexto("Entrega 1");
  afirmar("primeira entrega programada", true, `${ENTREGA_A} un em ${DATA_A}`);

  /* ---------------- excesso recusado na própria tela ---------------- */
  console.log("\n== excesso");
  await clicar("Adicionar entrega programada");
  await pagina.getByLabel(/Data programada/).fill(DATA_B);
  await pagina.getByLabel(new RegExp(`Programar ${produto.code}`)).fill(String(ENTREGA_B + 1));
  await esperarTexto("Quantidade acima do saldo");
  const salvarBloqueado = await pagina.getByRole("button", { name: "Salvar entrega" }).isDisabled();
  afirmar(
    "excesso é recusado na tela, antes de qualquer envio",
    salvarBloqueado,
    `${ENTREGA_B + 1} contra ${ENTREGA_B} disponíveis`,
  );

  await pagina.getByLabel(new RegExp(`Programar ${produto.code}`)).fill(String(ENTREGA_B));
  await clicar("Salvar entrega");
  await esperarTexto("Entrega 2");

  const depoisDasDuas = await textoDaPagina();
  afirmar("duas entregas, na ordem cronológica", /Entrega 1[\s\S]*Entrega 2/.test(depoisDasDuas));
  afirmar(
    "o saldo programável zerou e a tela diz por quê",
    depoisDasDuas.includes("não há saldo para programar"),
  );
  afirmar(
    "programar não criou expedição",
    !/EXP-\d+/.test(depoisDasDuas),
    "nenhum código de expedição na tela do Pedido",
  );

  /* ---------------- expedição parcial a partir da entrega 1 ---------------- */
  console.log("\n== expedir parte da entrega 1");
  await pagina.getByRole("button", { name: "Preparar expedição" }).first().click();
  await pagina.waitForURL(/\/comercial\/expedicoes\/[0-9a-f-]{36}$/, { timeout: 25000 });
  await pagina.waitForFunction(
    () => /^EXP-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
    { timeout: 25000 },
  );
  const codigoDaExpedicao = (await pagina.locator("h1").first().textContent())?.trim() ?? "";
  afirmar(
    "a separação nasceu da entrega programada",
    /^EXP-\d+$/.test(codigoDaExpedicao),
    codigoDaExpedicao,
  );

  const propostoNaSeparacao = await pagina.evaluate(() =>
    [...document.querySelectorAll('input[aria-label^="Quantidade do lote"]')].reduce(
      (soma, campo) => soma + Number(campo.value || 0),
      0,
    ),
  );
  afirmar(
    "a proposta veio limitada ao que a promessa pedia",
    propostoNaSeparacao === ENTREGA_A,
    `${propostoNaSeparacao} un`,
  );

  const lotes = await pagina.evaluate(() =>
    [...document.querySelectorAll('input[aria-label^="Quantidade do lote"]')].map((campo) =>
      (campo.getAttribute("aria-label") ?? "").replace("Quantidade do lote ", "").trim(),
    ),
  );
  const primeiroLote = lotes[0];
  await pagina.getByLabel(`Quantidade do lote ${primeiroLote}`).fill(String(EXPEDIR));
  for (const lote of lotes.slice(1)) {
    await pagina.getByLabel(`Quantidade do lote ${lote}`).fill("0");
  }
  await clicar("Salvar separação");
  await pagina.waitForLoadState("networkidle");

  const conferencia = pagina.getByLabel(`Lote conferido da linha ${primeiroLote}`);
  await conferencia.fill(primeiroLote);
  await conferencia.press("Enter");
  await esperarTexto("Conferido");

  await clicar("Confirmar expedição");
  await confirmarDialogo("Confirmar");
  await esperarTexto("Confirmada");
  afirmar("expedição confirmada", true, `${EXPEDIR} un em ${codigoDaExpedicao}`);

  /* ---------------- de volta ao Pedido: parcial e intacta ---------------- */
  console.log("\n== progresso das entregas");
  await pagina.goto(urlDoPedido, { waitUntil: "networkidle" });
  await esperarSecao("Entregas programadas");

  const linha1 = await linhaDaEntrega(1);
  const linha2 = await linhaDaEntrega(2);
  afirmar(
    "a entrega 1 ficou parcialmente atendida",
    (linha1 ?? "").includes("Parcialmente atendida"),
    linha1 ?? "",
  );
  afirmar("a entrega 2 continua intacta", (linha2 ?? "").includes("Programada"), linha2 ?? "");

  /* ---------------- reprogramar o saldo pendente ---------------- */
  console.log("\n== reprogramar o saldo da entrega 1");
  await pagina.getByRole("button", { name: "Reprogramar" }).first().click();
  await pagina.getByLabel(/Nova data programada/).fill(DATA_REPROGRAMADA);
  await pagina.getByLabel(/Motivo/).fill("Cliente pediu para adiar o restante");
  await confirmarDialogo("Reprogramar");
  await esperarTexto("Entrega 3");

  const depoisDeReprogramar = await textoDaPagina();
  const linha1Final = await linhaDaEntrega(1);
  const linha3 = await linhaDaEntrega(3);

  afirmar(
    "a entrega 1 virou histórico sem apagar o que entregou",
    (linha1Final ?? "").includes("Cancelada") && (linha1Final ?? "").includes(String(EXPEDIR)),
    linha1Final ?? "",
  );
  afirmar(
    "a cadeia aponta para a substituta, nas duas pontas",
    depoisDeReprogramar.includes("reprogramada para a 3") &&
      depoisDeReprogramar.includes("substitui a 1"),
  );
  afirmar(
    "a substituta nasceu só com o saldo pendente",
    (linha3 ?? "").includes(String(ENTREGA_A - EXPEDIR)),
    linha3 ?? "",
  );
  afirmar(
    "a entrega 2 seguiu intacta depois da reprogramação",
    ((await linhaDaEntrega(2)) ?? "").includes("Programada"),
  );

  const errosDeConsole = erros.filter((erro) => !/favicon|ResizeObserver/i.test(String(erro)));
  afirmar("console limpo", errosDeConsole.length === 0, errosDeConsole.slice(0, 3).join(" | "));
  afirmar(
    "nenhuma resposta 4xx/5xx",
    respostasComErro.length === 0,
    respostasComErro
      .map((r) => `${r.status} ${r.url}`)
      .slice(0, 3)
      .join(" | "),
  );

  console.log(
    `\n== resíduo declarado no DEV: ${codigoDoPedido} · ${codigoDaExpedicao} (${run.runId})`,
  );
} finally {
  await fechar();
}

console.log(`\n${falhas.length === 0 ? "VERDE" : `VERMELHO — ${falhas.length} falha(s)`}`);
for (const falha of falhas) console.log(`  - ${falha}`);
process.exit(falhas.length === 0 ? 0 : 1);
