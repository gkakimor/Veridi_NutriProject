import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * O desconto acordado no orçamento chega ao Faturamento — BILL-DISCOUNT-01b,
 * pela interface.
 *
 * O defeito: `CustomerOrder.agreedDiscountPercent` era gravado no aceite,
 * aparecia na Origem comercial do Pedido e morria ali. O Faturamento somava
 * `quantidade × preço` e pronto. Um pedido de R$ 200,00 com 10% acordado
 * faturava R$ 200,00 — e ninguém na tela explicava os R$ 20,00 de diferença.
 *
 * A suíte percorre o ciclo comercial inteiro clicando: projeto, orçamento com
 * desconto global, envio, aceite, aprovação, Pedido, reserva, expedição e
 * faturamento. No fim confere, no documento, os quatro números que o operador
 * lê — subtotal bruto, desconto comercial, ajuste de fechamento e total
 * faturado — e o impresso.
 *
 * A conta é feita FORA do sistema, e à mão:
 *
 *   2 un × R$ 100,0000  = R$ 200,00 de subtotal bruto
 *   10% de R$ 200,00    = R$  20,00 de desconto comercial
 *   sem fragmentação    = R$   0,00 de ajuste de fechamento
 *   total faturado      = R$ 180,00, igual ao total acordado no Pedido
 *
 * A fragmentação em vários faturamentos (o ajuste de centavos do documento de
 * fechamento) é provada onde ela é determinística e barata:
 * `packages/shared/src/billing-apropriacao.test.ts` e
 * `apps/api/src/modules/billings/billing-reconciliation.test.ts`.
 *
 * A massa de PRODUTO ACABADO não é fabricada aqui: a suíte DESCOBRE um
 * produto que já tem saldo disponível no DEV e vende esse. Produzir lote por
 * clique seria reencenar produção inteira para provar uma conta comercial.
 *
 *   node scripts/e2e/desconto-do-pedido-chega-ao-faturamento.mjs
 */

const QUANTIDADE = "2";
const PRECO = "100,00";
const DESCONTO = "10";
const VALIDADE_FUTURA = "2099-12-31";

const ESPERADO = {
  bruto: "R$ 200,00",
  desconto: "R$ 20,00",
  total: "R$ 180,00",
};

const run = obterRun({ novo: true, dono: "bill-discount-01b" });

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

const { pagina, api, erros, fechar } = await abrirNavegador();

async function clicar(nome, { exact = true } = {}) {
  await pagina.getByRole("button", { name: nome, exact }).first().click();
}

async function esperarTexto(texto, timeout = 25000) {
  await pagina.waitForFunction((alvo) => document.body.innerText.includes(alvo), texto, { timeout });
}

const textoDaPagina = () => pagina.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

/**
 * Um produto com saldo DISPONÍVEL de produto acabado, e o cliente dele.
 *
 * Leitura apenas — a API entra como consulta de massa, nunca para fabricar o
 * estado que a suíte deveria criar clicando. Sem massa, a suíte diz isso e
 * sai: um roteiro que depende de estoque inexistente e reporta "defeito do
 * produto" foi exatamente o erro que aposentou as suítes antigas.
 */
/** Produto por item de produto acabado — a busca do catálogo não casa código de item. */
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
  // A Posição de Estoque já responde "quais produtos acabados têm saldo".
  for (let page = 1; page <= 20; page += 1) {
    const posicao = await api(`/inventory?type=FINISHED_PRODUCT&page=${page}&pageSize=100`);
    const linhas = posicao.corpo?.items ?? [];
    if (linhas.length === 0) return null;
    for (const linha of linhas) {
      if (Number(linha.available ?? "0") < Number(QUANTIDADE)) continue;
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
    console.log("  SEM MASSA: nenhum produto com saldo disponível de produto acabado no DEV.");
    console.log("  A suíte não avalia nada nesta condição — não é reprovação do produto.");
    await fechar();
    process.exit(0);
  }
  const { produto, disponivel } = alvo;
  console.log(`  produto ${produto.code} · cliente ${produto.customer.code} · disponível ${disponivel}`);

  console.log("\n== orçamento com desconto global");
  await pagina.goto(`${WEB}/comercial/projetos`, { waitUntil: "networkidle" });
  await clicar("Novo projeto");
  await pagina.waitForSelector("#project-customer");
  await pagina.fill("#project-customer", produto.customer.code);
  await pagina.waitForTimeout(700);
  await pagina.keyboard.press("ArrowDown");
  await pagina.keyboard.press("Enter");
  await pagina.fill("#project-name", `Desconto ao faturamento ${run.runId}`);
  await clicar("Criar projeto", { exact: false });
  await pagina.waitForFunction(() => /\/comercial\/projetos\/[0-9a-f-]{10,}/.test(location.pathname), {
    timeout: 25000,
  });
  const urlDoProjeto = pagina.url();

  // O produto que já tem saldo entra no projeto — nada é criado do zero.
  await clicar("+ Adicionar produto");
  await clicar("Vincular produto existente");
  const busca = pagina.locator("#link-product");
  await busca.click();
  await busca.type(produto.code, { delay: 20 });
  await pagina.locator('[role="option"]', { hasText: produto.code }).first().click();
  await clicar("Vincular produto");
  await esperarTexto(produto.code);

  await clicar("Criar nova versão");
  await pagina.waitForTimeout(900);
  await pagina.waitForSelector("#quote-add-product");
  await pagina.selectOption("#quote-add-product", { index: 1 });
  await clicar("Adicionar");
  await pagina.waitForTimeout(900);

  const campoQuantidade = pagina.locator('input[aria-label^="Quantidade de"]').first();
  await campoQuantidade.fill(QUANTIDADE);
  await campoQuantidade.blur();
  const campoPreco = pagina.locator('input[aria-label^="Preço unitário de"]').first();
  await campoPreco.fill(PRECO);
  await campoPreco.blur();
  await pagina.waitForTimeout(700);

  await pagina.locator("#quote-discount").fill(DESCONTO);
  await pagina.locator("#quote-discount").blur();
  await pagina.locator("#quote-valid-until").fill(VALIDADE_FUTURA);
  await pagina.locator("#quote-valid-until").blur();
  await pagina.waitForTimeout(400);
  await clicar("Salvar condições");
  await pagina.waitForTimeout(1200);

  const propostaNaTela = await textoDaPagina();
  afirmar(
    "a proposta fecha em R$ 180,00 — 200,00 menos 10%",
    propostaNaTela.includes(ESPERADO.total),
    ESPERADO.total,
  );

  await clicar("Enviar ao cliente");
  await pagina.waitForTimeout(400);
  await pagina.getByRole("button", { name: /Enviar mesmo assim|Enviar ao cliente/ }).last().click();
  await esperarTexto("Enviado");
  await clicar("Registrar aceite");
  await esperarTexto("Aceito");
  await clicar("Aprovar projeto");
  await pagina.waitForTimeout(700);
  await clicar("Aprovar");
  await esperarTexto("Aprovado");

  console.log("\n== pedido");
  await clicar("Gerar pedido a partir do orçamento aceito", { exact: false });
  await pagina.waitForFunction(
    () => location.pathname.includes("/comercial/pedidos/") && /PED-\d{6}/.test(document.body.innerText),
    { timeout: 30000 },
  );
  const urlDoPedido = pagina.url();
  const pedidoNaTela = await textoDaPagina();
  afirmar("o Pedido congela o subtotal bruto", pedidoNaTela.includes(ESPERADO.bruto), ESPERADO.bruto);
  afirmar("o Pedido congela o total acordado", pedidoNaTela.includes(ESPERADO.total), ESPERADO.total);

  console.log("\n== reserva e expedição");
  // O Pedido nasce RASCUNHO: confirmar e ato de quem opera, nao efeito do aceite.
  await clicar("Confirmar pedido");
  await pagina.waitForTimeout(500);
  await pagina.getByRole("button", { name: "Confirmar", exact: true }).last().click();
  await pagina.waitForFunction(
    () => !document.body.innerText.includes("Confirmar pedido"),
    { timeout: 25000 },
  );

  await esperarTexto("Plano de Atendimento");
  const botaoPlano = pagina.getByRole("button", { name: /Aplicar Plano de Atendimento/ }).first();
  await botaoPlano.waitFor({ state: "visible", timeout: 25000 });
  await pagina.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => /Aplicar Plano de Atendimento/.test(b.textContent ?? "") && !b.disabled,
      ),
    { timeout: 25000 },
  );
  await botaoPlano.click();
  await pagina.waitForTimeout(600);
  await pagina.getByRole("button", { name: "Aplicar Plano", exact: true }).last().click();
  await esperarTexto("Em atendimento");

  await clicar("Preparar Expedição");
  await pagina.waitForFunction(() => location.pathname.includes("/comercial/expedicoes/"), {
    timeout: 25000,
  });
  /*
   * Conferência física: digitar o lote que está na linha. É de propósito que
   * o código não venha preenchido — conferir é olhar a etiqueta.
   */
  await pagina.waitForFunction(() => /EXP-\d{6}/.test(document.body.innerText), { timeout: 25000 });
  const campos = pagina.locator('input[aria-label^="Lote conferido da linha"]');
  await campos.first().waitFor({ state: "visible", timeout: 25000 });
  for (let tentativa = 0; tentativa < 10; tentativa += 1) {
    const restantes = await campos.count();
    if (restantes === 0) break;
    const campo = campos.first();
    const rotulo = (await campo.getAttribute("aria-label")) ?? "";
    const lote = rotulo.replace("Lote conferido da linha ", "").trim();
    await campo.fill(lote);
    await pagina.getByRole("button", { name: "Conferir lote" }).first().click();
    await pagina.waitForTimeout(1200);
    if ((await campos.count()) === restantes) break;
  }
  await clicar("Confirmar expedição");
  await pagina.waitForTimeout(500);
  await pagina.getByRole("button", { name: "Confirmar", exact: true }).last().click();
  await esperarTexto("Confirmada");

  console.log("\n== faturamento");
  await clicar("Preparar faturamento");
  await pagina.waitForFunction(() => location.pathname.includes("/comercial/faturamento/"), {
    timeout: 25000,
  });

  await pagina.waitForFunction(() => /FAT-\d{6}/.test(document.body.innerText), { timeout: 25000 });
  await pagina.waitForFunction(() => document.body.innerText.includes("Total faturado"), {
    timeout: 25000,
  });
  const rascunho = await textoDaPagina();
  afirmar(
    "o rascunho já mostra a prévia com desconto",
    rascunho.includes("Total faturado (prévia): R$ 180,00"),
    rascunho.match(/Total faturado \(prévia\): [^ ]+ ?[^ ]*/)?.[0] ?? "",
  );

  await clicar("Emitir faturamento");
  await pagina.waitForTimeout(500);
  await pagina.getByRole("button", { name: "Emitir", exact: true }).last().click();
  await esperarTexto("Emitido");

  const documento = await textoDaPagina();
  afirmar(
    `subtotal bruto ${ESPERADO.bruto}`,
    documento.includes(`Subtotal bruto: ${ESPERADO.bruto}`),
    documento.match(/Subtotal bruto: R\$ [\d.,]+/)?.[0] ?? "",
  );
  afirmar(
    `desconto comercial − ${ESPERADO.desconto}`,
    documento.includes(`Desconto comercial: − ${ESPERADO.desconto}`),
    documento.match(/Desconto comercial: − R\$ [\d.,]+/)?.[0] ?? "",
  );
  afirmar(
    "sem fragmentação não há ajuste de fechamento na tela",
    !documento.includes("Ajuste de fechamento"),
  );
  afirmar(
    `total faturado ${ESPERADO.total}`,
    documento.includes(`Total faturado: ${ESPERADO.total}`),
    documento.match(/Total faturado: R\$ [\d.,]+/)?.[0] ?? "",
  );
  afirmar(
    "o preço unitário da linha continua o acordado, sem desconto embutido",
    documento.includes("100,00"),
  );

  console.log("\n== impresso");
  const urlDoFaturamento = pagina.url();
  await pagina.goto(`${urlDoFaturamento}/imprimir`, { waitUntil: "networkidle" });
  await pagina.waitForTimeout(900);
  const impresso = await textoDaPagina();
  afirmar("o impresso traz o subtotal bruto", impresso.includes(ESPERADO.bruto));
  afirmar("o impresso traz o desconto comercial", impresso.includes(ESPERADO.desconto));
  afirmar("o impresso fecha no total acordado", impresso.includes(ESPERADO.total));

  console.log(`\n  pedido: ${urlDoPedido}`);
  console.log(`  projeto: ${urlDoProjeto}`);
} catch (erro) {
  falhas.push(`exceção: ${String(erro).slice(0, 300)}`);
  console.log(`  FALHA exceção — ${String(erro).slice(0, 300)}`);
} finally {
  await fechar();
}

if (erros.length > 0) {
  falhas.push(`console sujo: ${erros.length} erro(s)`);
  console.log(`\n  FALHA console sujo:`);
  for (const e of erros.slice(0, 10)) console.log(`    ${e}`);
}

console.log(`\n${falhas.length === 0 ? "APROVADO" : `REPROVADO — ${falhas.length} falha(s)`}`);
process.exit(falhas.length === 0 ? 0 : 1);
