import { criarFornecedor, criarItem } from "./fixtures/cadastros.mjs";
import { criarRun } from "./fixtures/run.mjs";
import { escolherOpcao } from "./fixtures/ui.mjs";
import { abrirNavegador, WEB } from "./lib/browser.mjs";

/**
 * O Recebimento avisa antes de enviar, e o aviso responde à correção.
 *
 * O defeito que esta suíte impede de voltar tinha duas metades na mesma tela.
 * A primeira: "Aberto: 12,5 kg" estava escrito logo acima do campo e digitar 30
 * não produzia aviso nenhum — a pessoa preenchia lote, validade e custo, passava
 * pelo diálogo de irreversibilidade e só então era recusada pelo servidor
 * (F-06-1). A segunda: depois da recusa, corrigir a quantidade não limpava o
 * alerta, que ficava na tela contando uma história que já não era verdade
 * (F-06-2).
 *
 * Massa: fornecedor e matéria-prima que controla lote e validade nascem por API
 * nesta execução, carimbados com o `runId` (E2E-BASELINE-REDESIGN-WAVE-01-02).
 * Antes a suíte digitava o código do primeiro fornecedor e da primeira
 * matéria-prima da sequência como "algum fornecedor e alguma matéria-prima" —
 * na base real os dois são da Veridi, e a suíte gravava recebimento e lote na
 * matéria-prima de verdade. Cadastro não é o que se prova
 * aqui: a ordem de compra e os recebimentos continuam nascendo pela interface,
 * clicando, e a OC leva o `runId` nas observações.
 *
 * A quantidade tem casa decimal de propósito: 12,5 pedidos, 4,25 recebidos,
 * 8,25 de saldo. Recebimento parcial e saldo exato num número que não é
 * redondo é onde arredondamento silencioso costuma aparecer.
 *
 * Nada é verificado por API nem por SQL: o que a suíte lê é o que a pessoa lê.
 * A rede é observada, não consultada — a tentativa inválida não pode produzir
 * requisição de confirmação.
 *
 *   node scripts/e2e/recebimento-validacao-viva.mjs
 */

const UNIDADE = "kg";
const PEDIDO = "12,5";
const PARCIAL = "4,25";
const SALDO_DEPOIS = "8,25";

const run = criarRun();

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

const campoReceber = (pagina) => pagina.getByLabel(/Receber agora/).first();
const botaoConfirmar = (pagina) => pagina.getByRole("button", { name: /Confirmar recebimento/ });

/*
 * Preenche lote e validade — o item controla os dois.
 *
 * Por `id` e não por rótulo: o ⓘ de ajuda vive DENTRO do `<label>` e carrega
 * `aria-label="Ajuda sobre Lote do fornecedor"`, então buscar pelo rótulo
 * acha o botão de ajuda antes do campo.
 */
async function preencherLoteEValidade(pagina, sufixo) {
  await pagina.locator('input[id^="supplier-lot-"]').first().fill(`E2E-${run.runId}-${sufixo}`);
  await pagina.locator('input[id^="expiry-"]').first().fill("2029-12-31");
}

/** URL da OC desta execução — o `finally` precisa dela para limpar. */
let urlDaOc = null;

/** Cancela a OC da execução pelo fluxo oficial, se ela ainda aceitar. */
async function cancelarOrdemSeAindaDer(pagina) {
  if (!urlDaOc) return;
  try {
    await pagina.goto(urlDaOc, { waitUntil: "networkidle" });
    const cancelar = pagina.getByRole("button", { name: "Cancelar OC" });
    if ((await cancelar.count()) === 0) return;
    await cancelar.click();
    await pagina.locator("#po-cancel-reason").fill(`Massa de E2E ${run.runId} — FIX-04`);
    await pagina.locator(".confirm-dialog__actions, .modal__actions").getByRole("button", { name: "Cancelar OC" }).click();
    await pagina.getByText("Cancelado", { exact: true }).first().waitFor({ timeout: 15000 });
    console.log(`  limpeza: OC da execução cancelada pelo fluxo oficial.`);
  } catch {
    console.log("  limpeza: não foi possível cancelar a OC desta execução — verifique manualmente.");
  }
}

async function main() {
  const { pagina, api, erros, fechar } = await abrirNavegador();

  /*
   * A rede é a prova de que a recusa foi da TELA: a tentativa inválida não
   * pode produzir POST de confirmação. Contar requisições é observação, não
   * assertion sobre o domínio.
   */
  const confirmacoes = [];
  pagina.on("request", (requisicao) => {
    if (requisicao.method() === "POST" && /\/purchase-orders\/[^/]+\/receipts$/.test(requisicao.url())) {
      confirmacoes.push(requisicao.url());
    }
  });

  try {
    console.log(`\nFIX-04 — validação viva no Recebimento (run ${run.runId})\n`);

    console.log("0. fornecedor e matéria-prima desta execução, por API");
    const fornecedor = await criarFornecedor(api, run);
    const item = await criarItem(api, run, {
      tipo: "RAW_MATERIAL",
      unidade: UNIDADE,
      controlaLote: true,
      controlaValidade: true,
    });
    afirmar(
      `matéria-prima ${item.codigo} da execução controla lote e validade`,
      item.controlaLote === true && item.controlaValidade === true,
    );

    console.log("\n1. criar a OC desta execução, pela interface");
    await pagina.goto(`${WEB}/compras/ordens/nova`, { waitUntil: "networkidle" });
    await escolherOpcao(pagina, "#po-supplier", fornecedor.nome);
    await pagina.getByRole("button", { name: "+ Adicionar item" }).click();
    await escolherOpcao(pagina, pagina.locator('[id^="po-line-item-"]').first(), item.codigo);
    await pagina.getByLabel(new RegExp(`Quantidade de ${item.codigo}`)).fill(PEDIDO);
    await pagina.locator("#po-notes").fill(`E2E ${run.runId} — FIX-04`);
    await pagina.getByRole("button", { name: "Salvar rascunho" }).click();
    await pagina.waitForURL(/\/compras\/ordens\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await pagina.waitForFunction(
      () => /^OC-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
      { timeout: 20000 },
    );
    urlDaOc = pagina.url();
    const codigoDaOc = (await pagina.locator("h1").first().textContent())?.trim();
    afirmar(`ordem de compra criada: ${codigoDaOc}`, /^OC-\d+$/.test(codigoDaOc ?? ""));

    await pagina.getByRole("button", { name: "Confirmar OC" }).click();
    await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Confirmar" }).click();
    await pagina.getByRole("button", { name: "Receber materiais" }).waitFor({ timeout: 20000 });
    afirmar("OC confirmada e pronta para receber", true);

    console.log("\n2. quantidade acima do saldo — a tela recusa sozinha");
    await pagina.getByRole("button", { name: "Receber materiais" }).click();
    await pagina.waitForURL(/\/compras\/recebimentos\/novo/, { timeout: 20000 });
    await campoReceber(pagina).waitFor({ timeout: 20000 });
    afirmar(
      `a tela declara o saldo aberto: ${PEDIDO} ${UNIDADE}`,
      (await pagina.getByText(new RegExp(`Aberto: ${PEDIDO} ${UNIDADE}`)).count()) > 0,
    );

    await campoReceber(pagina).fill("30");
    const aviso = pagina.getByText(new RegExp(`Máximo ${PEDIDO} ${UNIDADE}`));
    await aviso.waitFor({ timeout: 10000 });
    afirmar("erro aparece imediatamente, sem envio", true);
    afirmar("ação de confirmar bloqueada", await botaoConfirmar(pagina).isDisabled());
    afirmar("nenhuma requisição de confirmação foi feita", confirmacoes.length === 0,
      `requisições: ${confirmacoes.length}`);

    console.log("\n3. corrigir para um parcial válido — o erro some");
    await campoReceber(pagina).fill(PARCIAL);
    await aviso.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    afirmar(
      "o erro desapareceu na edição",
      (await pagina.getByText(new RegExp(`Máximo ${PEDIDO} ${UNIDADE}`)).count()) === 0,
    );
    afirmar("ação de confirmar liberada", !(await botaoConfirmar(pagina).isDisabled()));

    console.log("\n4. receber o parcial");
    await preencherLoteEValidade(pagina, "A");
    await botaoConfirmar(pagina).click();
    await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Confirmar" }).click();
    await pagina.waitForURL(/\/compras\/recebimentos\/[0-9a-f-]{36}$/, { timeout: 30000 });
    // `waitForURL` acerta a rota antes de a tela ter o código do documento.
    await pagina.waitForFunction(
      () => /^REC-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
      { timeout: 20000 },
    );
    const codigoDoRecebimento = (await pagina.locator("h1").first().textContent())?.trim();
    afirmar(`recebimento gravado: ${codigoDoRecebimento}`, /^REC-\d+$/.test(codigoDoRecebimento ?? ""));
    afirmar("exatamente uma requisição de confirmação até aqui", confirmacoes.length === 1,
      `requisições: ${confirmacoes.length}`);

    console.log("\n5. o saldo da OC reflete o parcial");
    await pagina.goto(urlDaOc, { waitUntil: "networkidle" });
    await pagina.getByText(new RegExp(`Aberto: ${SALDO_DEPOIS}`)).waitFor({ timeout: 20000 });
    afirmar(`saldo aberto agora é ${SALDO_DEPOIS} ${UNIDADE}`, true);

    console.log("\n6. acima do NOVO saldo — a tela recusa contra o saldo atual");
    await pagina.getByRole("button", { name: "Receber materiais" }).click();
    await pagina.waitForURL(/\/compras\/recebimentos\/novo/, { timeout: 20000 });
    await campoReceber(pagina).waitFor({ timeout: 20000 });
    await campoReceber(pagina).fill("9");
    const avisoNovo = pagina.getByText(new RegExp(`Máximo ${SALDO_DEPOIS} ${UNIDADE}`));
    await avisoNovo.waitFor({ timeout: 10000 });
    afirmar("erro contra o saldo atual, não contra o pedido original", true);
    afirmar("ação bloqueada de novo", await botaoConfirmar(pagina).isDisabled());
    afirmar("continua sem requisição nova", confirmacoes.length === 1,
      `requisições: ${confirmacoes.length}`);

    console.log("\n7. receber exatamente o saldo — sem falso positivo");
    await campoReceber(pagina).fill(SALDO_DEPOIS);
    afirmar(
      "o erro desapareceu na edição",
      (await pagina.getByText(new RegExp(`Máximo ${SALDO_DEPOIS} ${UNIDADE}`)).count()) === 0,
    );
    afirmar("ação liberada para o saldo exato", !(await botaoConfirmar(pagina).isDisabled()));
    await preencherLoteEValidade(pagina, "B");
    await botaoConfirmar(pagina).click();
    await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Confirmar" }).click();
    await pagina.waitForURL(/\/compras\/recebimentos\/[0-9a-f-]{36}$/, { timeout: 30000 });
    await pagina.waitForFunction(
      () => /^REC-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
      { timeout: 20000 },
    );
    afirmar("segundo recebimento gravado", true);

    console.log("\n8. a OC fecha");
    await pagina.goto(urlDaOc, { waitUntil: "networkidle" });
    await pagina.getByText("Recebido", { exact: true }).first().waitFor({ timeout: 20000 });
    afirmar("OC totalmente recebida", true);
    afirmar("duas requisições de confirmação no total — nenhuma inválida saiu",
      confirmacoes.length === 2, `requisições: ${confirmacoes.length}`);

    console.log("\n9. console");
    afirmar("console limpo", erros.length === 0, erros.slice(0, 5).join(" | "));
  } finally {
    /*
     * Uma OC confirmada e nunca recebida é resíduo de laboratório: ela aparece
     * na lista de "OCs com saldo em aberto" da próxima pessoa. Na passagem
     * feliz a ordem termina RECEBIDA e não há o que cancelar — este bloco só
     * age quando a suíte parou no meio.
     */
    await cancelarOrdemSeAindaDer(pagina);
    await fechar();
  }

  console.log("");
  if (falhas.length > 0) {
    console.log(`REPROVADO — ${falhas.length} falha(s):`);
    for (const falha of falhas) console.log(`  - ${falha}`);
    process.exitCode = 1;
    return;
  }
  console.log("APROVADO");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
