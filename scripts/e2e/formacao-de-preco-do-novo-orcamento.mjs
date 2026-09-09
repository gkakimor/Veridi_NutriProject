import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * De onde vem o preço da recompra — COM-PRICE, §74, pela interface.
 *
 * Um projeto aprovado volta a comprar. A proposta nova precisa dizer de onde
 * saiu o preço, e quem responde é quem negocia — não o sistema, em silêncio.
 * Antes desta capability a versão nova nascia com `unitPrice` copiado da
 * anterior e nada no documento dizia que aquilo tinha sido um acordo: nem se
 * a condição ainda valia, nem para qual quantidade tinha sido fechada.
 *
 * A suíte percorre três formações de preço clicando, e só clicando:
 *
 *   1. CONDIÇÃO VIGENTE, mesma quantidade — o caminho da recompra. A linha
 *      nasce com o preço acordado e com a origem visível; enviar, aceitar e
 *      gerar o Pedido leva EXATAMENTE aquele preço até o Pedido;
 *   2. QUANTIDADE DIFERENTE — a tela avisa que a condição foi negociada para
 *      outra quantidade, recusa manter sem motivo, e aceita com motivo;
 *   3. REAJUSTE PERCENTUAL — 8% sobre a condição, com o valor fechado pelo
 *      servidor.
 *
 * Nada de SQL, nada de API para avançar: banco e API entram só como leitura de
 * verificação, e nem isso é preciso aqui — a tela mostra o que foi gravado.
 *
 *   node scripts/e2e/formacao-de-preco-do-novo-orcamento.mjs
 */

/** Cliente real do catálogo — a suíte não cria cliente, cria o projeto dele. */
const CLIENTE = "CLI-000013";
const QUANTIDADE = "1000";
const QUANTIDADE_MENOR = "500";
const PRECO_ACORDADO = "12,50";
const VALIDADE_FUTURA = "2099-12-31";
const REAJUSTE = "8";

const run = obterRun({ novo: true, dono: "com-price" });

const falhas = [];
function afirmar(descricao, condicao, detalhe = "") {
  if (condicao) {
    console.log(`  ok   ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
    return true;
  }
  falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  console.log(`  FALHA ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  return false;
}

const { pagina, erros, fechar } = await abrirNavegador();

async function clicar(nome, { exact = true } = {}) {
  await pagina.getByRole("button", { name: nome, exact }).first().click();
}

async function esperarTexto(texto, timeout = 20000) {
  await pagina.waitForFunction((alvo) => document.body.innerText.includes(alvo), texto, { timeout });
}

/**
 * Informa a validade e grava as condições.
 *
 * "Salvar condições" fica desabilitado quando não há nada a gravar — e é
 * exatamente o que acontece na recompra: a versão nova já nasce com a validade
 * da condição vigente sugerida (§74). Insistir no clique travaria a suíte num
 * botão que está certo em não estar disponível.
 */
async function definirValidade(valor) {
  await pagina.locator("#quote-valid-until").fill(valor);
  await pagina.locator("#quote-valid-until").blur();
  await pagina.waitForTimeout(400);
  const botao = pagina.getByRole("button", { name: "Salvar condições", exact: true }).first();
  if (await botao.isEnabled()) {
    await botao.click();
    await pagina.waitForTimeout(900);
  }
}

async function enviarProposta() {
  await clicar("Enviar ao cliente");
  await pagina.waitForTimeout(300);
  await pagina.getByRole("button", { name: /Enviar mesmo assim|Enviar ao cliente/ }).last().click();
  await esperarTexto("Enviado");
}

/** O preço unitário que está no campo da primeira linha. */
async function precoNaTela() {
  return pagina.locator('input[aria-label^="Preço unitário de"]').first().inputValue();
}

async function textoDaPagina() {
  return pagina.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
}

try {
  console.log(`\n== ciclo 1 — o acordo nasce (${run.runId})`);

  await pagina.goto(`${WEB}/comercial/projetos`, { waitUntil: "networkidle" });
  await clicar("Novo projeto");
  await pagina.waitForSelector("#project-customer");
  await pagina.fill("#project-customer", CLIENTE);
  await pagina.waitForTimeout(600);
  await pagina.keyboard.press("ArrowDown");
  await pagina.keyboard.press("Enter");
  await pagina.fill("#project-name", `Formação de preço ${run.runId}`);
  await clicar("Criar projeto", { exact: false });
  await pagina.waitForFunction(
    () => /\/comercial\/projetos\/[0-9a-f-]{10,}/.test(location.pathname),
    { timeout: 20000 },
  );
  const urlDoProjeto = pagina.url();
  console.log(`  projeto: ${urlDoProjeto}`);

  await pagina.waitForSelector("#technical-unit");
  await pagina.fill("#technical-unit", "un");
  await clicar("Preparar produto técnico");
  await esperarTexto("Produto");

  await clicar("Criar nova versão");
  await pagina.waitForTimeout(800);
  await pagina.waitForSelector("#quote-add-product");
  await pagina.selectOption("#quote-add-product", { index: 1 });
  await clicar("Adicionar");
  await pagina.waitForTimeout(800);

  const quantidade1 = pagina.locator('input[aria-label^="Quantidade de"]').first();
  await quantidade1.fill(QUANTIDADE);
  await quantidade1.blur();
  const preco1 = pagina.locator('input[aria-label^="Preço unitário de"]').first();
  await preco1.fill(PRECO_ACORDADO);
  await preco1.blur();
  await pagina.waitForTimeout(600);

  await definirValidade(VALIDADE_FUTURA);
  await enviarProposta();
  await clicar("Registrar aceite");
  await esperarTexto("Aceito");

  await clicar("Aprovar projeto");
  await pagina.waitForTimeout(600);
  await clicar("Aprovar");
  await esperarTexto("Aprovado");

  await clicar("Gerar pedido a partir do orçamento aceito", { exact: false });
  await pagina.waitForFunction(() => location.pathname.includes("/comercial/pedidos/"), {
    timeout: 20000,
  });
  console.log("  pedido 1 gerado — o acordo passa a ser história com Pedido");

  /* ─────── cenário 1: condição vigente, mesma quantidade ─────── */
  console.log("\n== cenário 1 — condição vigente e mesma quantidade");

  await pagina.goto(urlDoProjeto, { waitUntil: "networkidle" });
  await esperarTexto("Aprovado");
  await clicar("Novo orçamento");
  await pagina.waitForTimeout(1200);

  const telaComAcordo = await textoDaPagina();
  afirmar(
    "a tela pergunta como formar o preço",
    telaComAcordo.includes("Como formar o preço?"),
  );
  afirmar(
    "e mostra a condição acordada, com documento e validade",
    /Condição acordada.*ORC-\d{6}/.test(telaComAcordo),
  );
  afirmar(
    "a linha nasce com o preço do acordo",
    (await precoNaTela()).replace(".", ",").startsWith("12,5"),
    await precoNaTela(),
  );
  afirmar(
    "nenhum aviso de quantidade diferente — a quantidade é a mesma",
    !telaComAcordo.includes("foi negociada para"),
  );

  await definirValidade(VALIDADE_FUTURA);
  await enviarProposta();
  await clicar("Registrar aceite");
  await esperarTexto("Aceito");

  await clicar("Gerar pedido a partir do orçamento aceito", { exact: false });
  await pagina.waitForFunction(() => location.pathname.includes("/comercial/pedidos/"), {
    timeout: 20000,
  });
  await pagina.waitForTimeout(900);
  const textoDoPedido = await textoDaPagina();
  afirmar(
    "o Pedido novo carrega o preço da condição mantida",
    textoDoPedido.includes("12,50"),
    textoDoPedido.match(/R\$ ?[\d.,]+/g)?.slice(0, 4).join(" ") ?? "",
  );

  /* ─────── cenário 2: quantidade diferente ─────── */
  console.log("\n== cenário 2 — quantidade diferente exige decisão explícita");

  await pagina.goto(urlDoProjeto, { waitUntil: "networkidle" });
  await clicar("Novo orçamento");
  await pagina.waitForTimeout(1200);

  const quantidade3 = pagina.locator('input[aria-label^="Quantidade de"]').first();
  await quantidade3.fill(QUANTIDADE_MENOR);
  await quantidade3.blur();
  await pagina.waitForTimeout(1200);

  afirmar(
    "mudar a quantidade solta o preço herdado — ele era de outra negociação",
    (await precoNaTela()).trim() === "",
    await precoNaTela(),
  );
  const telaComAviso = await textoDaPagina();
  afirmar(
    "a tela diz para qual quantidade a condição foi negociada",
    telaComAviso.includes("foi negociada para") && telaComAviso.includes("1000"),
  );

  await clicar("Manter condição");
  await pagina.waitForTimeout(1200);
  const telaPedindoMotivo = await textoDaPagina();
  afirmar(
    "manter a condição mesmo assim pede o motivo",
    telaPedindoMotivo.includes("Informe o motivo"),
  );

  const campoMotivo = pagina.locator('input[aria-label^="Motivo para a condição"]').first();
  await campoMotivo.fill(`Cliente estratégico — recompra menor ${run.runId}`);
  await clicar("Confirmar");
  await pagina.waitForTimeout(1400);

  afirmar(
    "com o motivo, a decisão comercial passa e o preço volta",
    (await precoNaTela()).replace(".", ",").startsWith("12,5"),
    await precoNaTela(),
  );

  /* ─────── cenário 3: reajuste percentual ─────── */
  console.log("\n== cenário 3 — reajuste percentual sobre a condição");

  const campoReajuste = pagina.locator('input[aria-label^="Percentual de reajuste"]').first();
  await campoReajuste.fill(REAJUSTE);
  await pagina.waitForTimeout(400);
  const comPrevia = await textoDaPagina();
  afirmar("a tela mostra a prévia do novo preço", comPrevia.includes("Novo preço"));

  await clicar("Aplicar reajuste");
  await pagina.waitForTimeout(1400);
  afirmar(
    "o servidor fecha 8% sobre 12,50 em 13,50",
    (await precoNaTela()).replace(".", ",").startsWith("13,5"),
    await precoNaTela(),
  );

  /*
   * O console traz 409 desta própria suíte: o cenário 2 tenta manter a
   * condição SEM motivo de propósito, e a recusa é o comportamento correto —
   * o navegador registra toda resposta 4xx como erro de recurso. O que não
   * pode aparecer é erro que ninguém pediu.
   */
  const inesperados = erros.filter((erro) => !/status of 409/.test(erro));
  afirmar("console sem erro inesperado", inesperados.length === 0, inesperados.slice(0, 3).join(" | "));
} catch (erro) {
  falhas.push(`exceção: ${erro.message}`);
  console.log(`\n  EXCEÇÃO ${erro.stack}`);
} finally {
  await fechar();
}

console.log(`\n${falhas.length === 0 ? "SUÍTE VERDE" : `SUÍTE VERMELHA (${falhas.length})`}`);
for (const falha of falhas) console.log(`  - ${falha}`);
process.exit(falhas.length === 0 ? 0 : 1);
