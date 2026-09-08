import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Resolver a dependência devolve o Pedido — e a recusa é 400, não 500.
 *
 * O cancelamento de Pedido em atendimento contava Ordens de Produção sem
 * olhar status. Cancelar a OP pelo fluxo oficial não devolvia o Pedido: ele
 * ficava em atendimento para sempre, e a própria suíte do FIX-05 deixava um
 * preso a cada execução. A tela ainda escondia a ação de cancelar nesse
 * estado, então nem a tentativa existia.
 *
 * Esta suíte percorre o caminho inteiro clicando: cria o Pedido, aplica o
 * Plano, deixa nascer a OP, tenta cancelar com a OP viva (tem de ser
 * RECUSADO, com motivo), cancela a OP, volta e cancela o Pedido. No fim
 * confere que a OP continua no histórico como Cancelada — cancelar Pedido
 * não apaga nada.
 *
 * **Não deixa resíduo**: o Pedido desta execução termina CANCELADO, pela
 * interface. Era exatamente esse resíduo que o defeito produzia.
 *
 * A recusa intermediária é observada na rede de propósito: ela precisa ser
 * `400`, e nenhuma resposta da execução pode ser `5xx`. Erro de regra de
 * negócio vestido de falha de servidor foi o segundo achado desta rodada.
 *
 *   node scripts/e2e/cancelamento-de-pedido-com-op-cancelada.mjs
 */

/** Catálogo real: a suíte só precisa de um produto aprovado com formulação ativa. */
const PRODUTO = "PROD-000031";
/** O produto e o Pedido têm de ser do MESMO cliente — o Plano recusa misturado. */
const CLIENTE = "CLI-000013";
const QUANTIDADE = "10";

const run = obterRun({ novo: true, dono: "fix-05b" });

const falhas = [];
function afirmar(descricao, condicao, detalhe = "") {
  if (condicao) {
    console.log(`  ok   ${descricao}`);
    return true;
  }
  falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  console.log(`  FALHA ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  return false;
}

/** Escolhe uma opção de um campo de busca de entidade, digitando. */
async function escolher(pagina, campoId, termo) {
  const campo = pagina.locator(`#${campoId}`);
  await campo.click();
  await campo.fill("");
  await campo.type(termo, { delay: 20 });
  const opcao = pagina.locator('[role="option"]', { hasText: termo }).first();
  await opcao.waitFor({ state: "visible", timeout: 15000 });
  await opcao.click();
}

/** Abre o diálogo de cancelamento do Pedido, preenche o motivo e confirma. */
async function tentarCancelarPedido(pagina, motivo) {
  await pagina.getByRole("button", { name: "Cancelar pedido" }).first().click();
  await pagina.locator("#co-cancel-reason").fill(motivo);
  await pagina
    .locator(".confirm-dialog__actions")
    .getByRole("button", { name: "Cancelar pedido" })
    .click();
}

let urlDoPedido = null;
let urlDaOp = null;

async function main() {
  const { pagina, erros, fechar } = await abrirNavegador();

  const respostas = [];
  pagina.on("response", (resposta) => {
    if (resposta.status() >= 400) respostas.push({ status: resposta.status(), url: resposta.url() });
  });

  try {
    console.log(`\nFIX-05b — cancelar Pedido depois de cancelar a OP (run ${run.runId})\n`);

    console.log("1. criar e confirmar o Pedido desta execução");
    await pagina.goto(`${WEB}/comercial/pedidos/novo`, { waitUntil: "networkidle" });
    await escolher(pagina, "co-customer", CLIENTE);
    await pagina.getByRole("button", { name: "+ Adicionar produto" }).click();
    const seletor = pagina.locator('[id^="pedido-produto-"]').last();
    await seletor.click();
    await seletor.type(PRODUTO, { delay: 20 });
    await pagina.locator('[role="option"]', { hasText: PRODUTO }).first().click();
    await pagina.getByLabel(new RegExp(`Quantidade de ${PRODUTO}`)).fill(QUANTIDADE);
    await pagina.locator("#co-notes").fill(`E2E ${run.runId} — FIX-05b`);
    await pagina.getByRole("button", { name: "Salvar rascunho" }).click();
    await pagina.waitForURL(/\/comercial\/pedidos\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await pagina.waitForFunction(
      () => /^PED-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
      { timeout: 20000 },
    );
    urlDoPedido = pagina.url();
    const codigoDoPedido = (await pagina.locator("h1").first().textContent())?.trim();
    afirmar(`pedido criado: ${codigoDoPedido}`, /^PED-\d+$/.test(codigoDoPedido ?? ""));

    await pagina.getByRole("button", { name: "Confirmar pedido" }).click();
    await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Confirmar" }).click();
    await pagina.getByRole("button", { name: "Aplicar Plano de Atendimento" }).waitFor({ timeout: 20000 });

    console.log("\n2. aplicar o Plano — nasce a OP em rascunho");
    await pagina.getByLabel(new RegExp(`Produzir de ${PRODUTO}`)).fill(QUANTIDADE);
    await pagina.getByRole("button", { name: "Aplicar Plano de Atendimento" }).click();
    await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Aplicar Plano" }).click();
    const linkDaOp = pagina.locator('a[href^="/producao/ordens/"]').first();
    await linkDaOp.waitFor({ timeout: 30000 });
    urlDaOp = `${WEB}${await linkDaOp.getAttribute("href")}`;
    afirmar("pedido em atendimento, com OP gerada", true);

    console.log("\n3. com a OP viva, cancelar o Pedido é RECUSADO — e a tela diz por quê");
    afirmar(
      "a ação de cancelar existe em atendimento",
      (await pagina.getByRole("button", { name: "Cancelar pedido" }).count()) > 0,
    );
    await tentarCancelarPedido(pagina, `Tentativa com OP viva — E2E ${run.runId}`);
    const recusa = pagina.locator(".form-alert").filter({ hasText: /Ordens de Produção/ }).first();
    await recusa.waitFor({ timeout: 20000 });
    const textoDaRecusa = (await recusa.textContent())?.trim() ?? "";
    afirmar(`a recusa nomeia a dependência: "${textoDaRecusa}"`, /Ordens de Produção/.test(textoDaRecusa));
    const recusaHttp = respostas.filter((r) => /\/customer-orders\/[^/]+\/cancel$/.test(r.url));
    afirmar(
      "a recusa é 400 — regra de negócio, não falha de servidor",
      recusaHttp.length === 1 && recusaHttp[0].status === 400,
      JSON.stringify(recusaHttp),
    );

    console.log("\n4. cancelar a OP pelo fluxo oficial");
    await pagina.goto(urlDaOp, { waitUntil: "networkidle" });
    await pagina.getByRole("button", { name: "Cancelar OP" }).first().click();
    await pagina.locator("textarea").last().fill(`Massa de E2E ${run.runId} — FIX-05b`);
    await pagina
      .locator(".confirm-dialog__actions, .modal__actions")
      .getByRole("button", { name: "Cancelar OP" })
      .click();
    await pagina.getByText("Cancelada", { exact: true }).first().waitFor({ timeout: 20000 });
    afirmar("OP cancelada", true);

    console.log("\n5. voltar ao Pedido e cancelar — agora vai");
    await pagina.goto(urlDoPedido, { waitUntil: "networkidle" });
    await pagina.getByRole("button", { name: "Cancelar pedido" }).first().waitFor({ timeout: 20000 });
    await tentarCancelarPedido(pagina, `Massa de E2E ${run.runId} — FIX-05b`);
    await pagina.getByText("Cancelado", { exact: true }).first().waitFor({ timeout: 20000 });
    afirmar(`${codigoDoPedido} cancelado pela interface`, true);
    afirmar(
      "a ação some depois de cancelado",
      (await pagina.getByRole("button", { name: "Cancelar pedido" }).count()) === 0,
    );

    console.log("\n6. o histórico não foi apagado");
    await pagina.goto(urlDaOp, { waitUntil: "networkidle" });
    await pagina.getByText("Cancelada", { exact: true }).first().waitFor({ timeout: 20000 });
    afirmar("a OP continua no histórico, cancelada", true);

    console.log("\n7. rede e console");
    const servidor = respostas.filter((r) => r.status >= 500);
    afirmar("nenhuma resposta 5xx", servidor.length === 0, JSON.stringify(servidor.slice(0, 3)));
    afirmar(
      "o único 4xx é a recusa provocada de propósito",
      respostas.length === 1 && respostas[0].status === 400,
      JSON.stringify(respostas.slice(0, 5)),
    );
    /*
     * O navegador registra "Failed to load resource" para a recusa esperada.
     * Qualquer OUTRO console.error é reprovação, como nas demais suítes.
     */
    const inesperados = erros.filter((linha) => !/Failed to load resource/.test(linha));
    afirmar("console limpo fora da recusa esperada", inesperados.length === 0, inesperados.slice(0, 5).join(" | "));
  } finally {
    await fechar();
  }

  console.log("");
  if (falhas.length > 0) {
    console.log(`REPROVADO — ${falhas.length} falha(s):`);
    for (const falha of falhas) console.log(`  - ${falha}`);
    process.exitCode = 1;
    return;
  }
  console.log("APROVADO — nenhum resíduo: o Pedido desta execução terminou cancelado.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
