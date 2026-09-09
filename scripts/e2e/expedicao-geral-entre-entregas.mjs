import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * COM-04b — a quantidade expedida ATRAVESSA entregas programadas.
 *
 * O defeito: uma linha de Expedição só ganhava vínculo quando cabia INTEIRA
 * numa promessa. Expedir 5 contra entregas de 4 e 6 não cabia em nenhuma,
 * ficava sem vínculo, e o cronograma jurava que nada tinha sido entregue.
 *
 * O que a suíte prova, clicando:
 *
 * 1. duas entregas programadas no mesmo Pedido;
 * 2. uma Expedição aberta pelo PEDIDO — sem escolher entrega — separando mais
 *    do que a primeira promessa pedia;
 * 3. a tela da separação mostra a associação: parte para a entrega 1, parte
 *    para a entrega 2, no mesmo lote;
 * 4. confirmada, a entrega 1 fica atendida e a entrega 2 parcial.
 *
 * O caminho do CTA de uma entrega específica (que NÃO atravessa, e recusa o
 * excesso) é provado onde é determinístico e barato:
 * `apps/api/src/modules/customer-orders/delivery-schedule.test.ts`.
 *
 * Massa: um produto que já tem saldo no DEV. Resíduo declarado — Expedição
 * confirmada é irreversível por desenho.
 *
 *   node scripts/e2e/expedicao-geral-entre-entregas.mjs
 */

const TOTAL = 10;
const ENTREGA_A = 4;
const ENTREGA_B = 6;
/** Atravessa: fecha a entrega 1 e começa a 2. */
const EXPEDIR = 5;

const DATA_A = "2026-10-15";
const DATA_B = "2026-11-15";

const run = obterRun({ novo: true, dono: "com-04b" });

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

const respostasComErro = [];
pagina.on("response", (resposta) => {
  if (resposta.status() >= 400) {
    respostasComErro.push({ status: resposta.status(), url: resposta.url() });
  }
});

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

async function confirmarDialogo(rotulo) {
  await pagina
    .locator(".confirm-dialog__actions")
    .getByRole("button", { name: rotulo, exact: true })
    .click();
}

async function esperarTexto(texto, timeout = 25000) {
  await pagina.waitForFunction((alvo) => document.body.innerText.includes(alvo), texto, { timeout });
}

/** `.form-section h3` é uppercase por CSS: o nome real está no DOM. */
async function esperarSecao(titulo, timeout = 25000) {
  await pagina.waitForFunction(
    (alvo) => [...document.querySelectorAll("h3")].some((h3) => h3.textContent.trim() === alvo),
    titulo,
    { timeout },
  );
}

const textoDaPagina = () => pagina.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

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

  console.log("\n== pedido com duas entregas programadas");
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
  await pagina.locator("#co-notes").fill(`E2E ${run.runId} — COM-04b`);

  await clicar("Salvar rascunho");
  await pagina.waitForURL(/\/comercial\/pedidos\/[0-9a-f-]{36}$/, { timeout: 25000 });
  await pagina.waitForFunction(
    () => /^PED-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
    { timeout: 25000 },
  );
  const urlDoPedido = pagina.url();
  const codigoDoPedido = (await pagina.locator("h1").first().textContent())?.trim() ?? "";

  await clicar("Confirmar pedido");
  await confirmarDialogo("Confirmar");
  await pagina.getByRole("button", { name: "Aplicar Plano de Atendimento" }).waitFor({ timeout: 25000 });
  await pagina.getByLabel(new RegExp(`Reservar de ${produto.code}`)).fill(String(TOTAL));
  await clicar("Aplicar Plano de Atendimento");
  await confirmarDialogo("Aplicar Plano");
  await esperarSecao("Entregas programadas");

  for (const [data, quantidade] of [
    [DATA_A, ENTREGA_A],
    [DATA_B, ENTREGA_B],
  ]) {
    await clicar("Adicionar entrega programada");
    await pagina.getByLabel(/Data programada/).fill(data);
    await pagina.getByLabel(new RegExp(`Programar ${produto.code}`)).fill(String(quantidade));
    await clicar("Salvar entrega");
  }
  await esperarTexto("Entrega 2");
  afirmar("pedido com duas entregas programadas", true, `${ENTREGA_A} + ${ENTREGA_B}`);

  /* ---------------- Expedição pelo fluxo GERAL do Pedido ---------------- */
  console.log("\n== expedição geral, atravessando as duas entregas");
  await clicar("Preparar Expedição");
  await pagina.waitForURL(/\/comercial\/expedicoes\/[0-9a-f-]{36}$/, { timeout: 25000 });
  await pagina.waitForFunction(
    () => /^EXP-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
    { timeout: 25000 },
  );
  const codigoDaExpedicao = (await pagina.locator("h1").first().textContent())?.trim() ?? "";

  const lotes = await pagina.evaluate(() =>
    [...document.querySelectorAll('input[aria-label^="Quantidade do lote"]')].map((campo) =>
      (campo.getAttribute("aria-label") ?? "").replace("Quantidade do lote ", "").trim(),
    ),
  );
  afirmar(
    "a separação mostra UMA linha por lote reservado",
    lotes.length === new Set(lotes).size,
    lotes.join(" · "),
  );

  const primeiroLote = lotes[0];
  await pagina.getByLabel(`Quantidade do lote ${primeiroLote}`).fill(String(EXPEDIR));
  for (const lote of lotes.slice(1)) {
    await pagina.getByLabel(`Quantidade do lote ${lote}`).fill("0");
  }
  await clicar("Salvar separação");
  await pagina.waitForLoadState("networkidle");

  /*
   * A associação é lida DEPOIS de a tela receber a resposta do save: o
   * `networkidle` só diz que a rede parou, e o texto pode ainda ser o da
   * proposta inicial. O que se afirma é a repartição real — 4 na primeira
   * promessa e o excedente na segunda.
   */
  const associacaoEsperada = `Entrega 2 · ${EXPEDIR - ENTREGA_A}`;
  await esperarTexto(associacaoEsperada);
  const naSeparacao = await textoDaPagina();
  afirmar(
    "a tela associa a saída às duas entregas, com a repartição real",
    naSeparacao.includes(`Entrega 1 · ${ENTREGA_A}`) && naSeparacao.includes(associacaoEsperada),
    naSeparacao.match(/Entrega \d · [\d.,]+ · Entrega \d · [\d.,]+/)?.[0] ?? "",
  );
  afirmar(
    "o campo do lote continua mostrando a quantidade inteira",
    (await pagina.getByLabel(`Quantidade do lote ${primeiroLote}`).inputValue()).startsWith(
      String(EXPEDIR),
    ),
  );

  const conferencia = pagina.getByLabel(`Lote conferido da linha ${primeiroLote}`);
  await conferencia.fill(primeiroLote);
  await conferencia.press("Enter");
  await esperarTexto("Conferido");

  await clicar("Confirmar expedição");
  await confirmarDialogo("Confirmar");
  await esperarTexto("Confirmada");
  afirmar("expedição confirmada", true, `${EXPEDIR} un em ${codigoDaExpedicao}`);

  /* ---------------- de volta ao Pedido ---------------- */
  console.log("\n== progresso das entregas");
  await pagina.goto(urlDoPedido, { waitUntil: "networkidle" });
  await esperarSecao("Entregas programadas");

  const linha1 = await linhaDaEntrega(1);
  const linha2 = await linhaDaEntrega(2);
  afirmar(
    "a entrega 1 ficou atendida por inteiro",
    (linha1 ?? "").includes("Atendida") && !(linha1 ?? "").includes("Parcialmente"),
    linha1 ?? "",
  );
  afirmar(
    "a entrega 2 recebeu o excedente e ficou parcial",
    (linha2 ?? "").includes("Parcialmente atendida") &&
      (linha2 ?? "").includes(String(EXPEDIR - ENTREGA_A)),
    linha2 ?? "",
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
