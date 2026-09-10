import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * O preço herdado sobrevive a um Tab — QUOTE-LINE-NOOP-BLUR-01.
 *
 * Na recompra, a linha da versão nova nasce com o preço da condição acordada,
 * de origem herdada (§74). A tela gravava a linha a cada saída de campo, mesmo
 * sem alteração, e o servidor tratava a presença da quantidade ou da unidade
 * no pedido como mudança: passar pelo campo com Tab apagava o preço, a origem
 * e o vínculo com o acordo.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. a recompra nasce com o preço herdado — pelo fluxo real: proposta
 *      enviada, aceita, e versão nova;
 *   2. passar com Tab pela quantidade, pela unidade e pelo preço, sem mudar
 *      nada, não manda nenhuma atualização de linha ao servidor;
 *   3. reaberta a ficha, o preço, a origem e o vínculo continuam os mesmos, e o
 *      envio continua disponível;
 *   4. mudar a quantidade DE VERDADE continua soltando o preço herdado — a
 *      regra de §74 não mudou.
 *
 * Toda mutação é de interface. A rede é só observada: as requisições de
 * atualização de linha são contadas, e o estado de preço e origem é lido da
 * mesma resposta que a própria tela recebe ao abrir o Projeto.
 *
 *   node scripts/e2e/preco-herdado-sobrevive-ao-tab.mjs
 */

const run = obterRun({ novo: true, dono: "comercial" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Tab ${P} LTDA`;
const NOME_DO_PROJETO = `Projeto Tab ${P}`;
const NOME_DO_PRODUTO = `Produto Tab ${P}`;

const VALIDADE = "2099-12-31";

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

async function main() {
  const { pagina, erros, fechar } = await abrirNavegador();

  /** Toda atualização de linha que sair do navegador — observada, nunca feita pela suíte. */
  const atualizacoes = [];
  pagina.on("request", (requisicao) => {
    if (
      requisicao.method() === "PATCH" &&
      /\/quote-lines\/[^/]+$/.test(new URL(requisicao.url()).pathname)
    ) {
      atualizacoes.push(requisicao.postData() ?? "");
    }
  });

  const ehLeituraDoProjeto = (r) =>
    r.request().method() === "GET" &&
    r.status() === 200 &&
    /\/projects\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname);

  /**
   * A releitura do Projeto que a próxima ação vai disparar. Registrar ANTES da
   * ação; o `catch` vazio impede que um tempo esgotado vire rejeição sem dono.
   */
  const esperarReleitura = () => {
    const resposta = pagina.waitForResponse(ehLeituraDoProjeto, { timeout: 25000 });
    resposta.catch(() => {});
    return resposta;
  };
  const assentar = () => pagina.waitForTimeout(400);

  /** A linha do rascunho, como a própria tela recebeu do servidor. */
  const linhaDoRascunho = async (resposta) => {
    const projeto = await resposta.json();
    const rascunho = projeto.quoteVersions.find((versao) => versao.status === "DRAFT");
    return rascunho?.lines?.[0] ?? null;
  };

  let urlDoProjeto = "";

  try {
    // ── 1. Cliente, Projeto e Produto ───────────────────────────────────
    console.log(`\n[1] Cliente, Projeto e Produto`);

    await pagina.goto(`${WEB}/cadastros/clientes/novo`);
    await pagina.locator("#customer-legal-name").first().waitFor({ timeout: 25000 });
    await pagina.locator("#customer-legal-name").first().fill(RAZAO_SOCIAL);
    await pagina.getByRole("button", { name: "Criar cliente" }).first().click();
    await pagina.waitForURL("**/cadastros/clientes**", { timeout: 25000 });

    await pagina.goto(`${WEB}/comercial/projetos`);
    await pagina.getByRole("button", { name: "Novo projeto" }).first().click();
    await pagina.locator("#project-customer").first().waitFor({ timeout: 25000 });
    await pagina.locator("#project-customer").first().fill(RAZAO_SOCIAL);
    const opcaoDoCliente = pagina.locator(
      "li.entity-select__option:not(.entity-select__create)",
      { hasText: P },
    );
    await opcaoDoCliente.first().waitFor({ timeout: 25000 });
    await opcaoDoCliente.first().click();
    await pagina.locator("#project-name").first().fill(NOME_DO_PROJETO);
    await pagina.getByRole("button", { name: "Criar projeto" }).first().click();
    await pagina.waitForURL(/\/comercial\/projetos\/[0-9a-f-]{36}/, { timeout: 25000 });
    urlDoProjeto = pagina.url();

    await pagina.getByRole("button", { name: "+ Adicionar produto" }).first().click();
    await pagina.getByRole("button", { name: "Criar novo produto" }).first().click();
    await pagina.locator("#new-product-name").first().fill(NOME_DO_PRODUTO);
    await pagina.getByRole("button", { name: "Criar produto" }).first().click();
    await pagina.getByText(NOME_DO_PRODUTO).first().waitFor({ timeout: 25000 });
    afirmar("projeto com produto", true, NOME_DO_PROJETO);

    // ── 2. V1 enviada e aceita ──────────────────────────────────────────
    console.log(`\n[2] V1 enviada e aceita`);

    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    const seletorDeProduto = pagina.locator("#quote-add-product").first();
    await seletorDeProduto.waitFor({ timeout: 25000 });
    const rotulo = await seletorDeProduto.locator("option", { hasText: P }).first().innerText();
    const codigo = rotulo.split(" · ")[0].trim();
    const campoQuantidade = () => pagina.getByLabel(`Quantidade de ${codigo}`);
    const campoUnidade = () => pagina.getByLabel(`Unidade de ${codigo}`);
    const campoPreco = () => pagina.getByLabel(`Preço unitário de ${codigo}`);

    let releitura = esperarReleitura();
    await seletorDeProduto.selectOption({ label: rotulo });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).first().click();
    await releitura;
    await campoQuantidade().waitFor({ timeout: 25000 });

    releitura = esperarReleitura();
    await campoQuantidade().fill("1000");
    await campoQuantidade().blur();
    await releitura;
    await assentar();

    releitura = esperarReleitura();
    await campoPreco().fill("12,50");
    await campoPreco().blur();
    await releitura;
    await assentar();

    await pagina.locator("#quote-valid-until").fill(VALIDADE);
    releitura = esperarReleitura();
    await pagina.getByRole("button", { name: "Salvar condições", exact: true }).first().click();
    await releitura;
    await assentar();

    releitura = esperarReleitura();
    await pagina.getByRole("button", { name: "Enviar ao cliente" }).first().click();
    await pagina.getByRole("alertdialog").getByRole("button", { name: "Enviar ao cliente" }).click();
    await releitura;
    await assentar();

    releitura = esperarReleitura();
    await pagina.getByRole("button", { name: "Registrar aceite" }).first().click();
    await releitura;
    await assentar();
    afirmar("V1 aceita", (await pagina.getByText("Aceito").count()) > 0);

    // ── 3. A recompra nasce com o preço herdado ─────────────────────────
    console.log(`\n[3] Versão nova: o preço vem da condição acordada`);

    releitura = esperarReleitura();
    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    const leituraDaV2 = await releitura;
    await campoPreco().waitFor({ timeout: 25000 });
    await assentar();
    const herdada = await linhaDoRascunho(leituraDaV2);
    afirmar(
      "a linha nasce com o preço acordado",
      herdada?.unitPrice === "12.5000",
      herdada?.unitPrice,
    );
    afirmar(
      "e com a origem herdada, ligada à linha do acordo",
      herdada?.priceOrigin === "INHERITED_AGREEMENT" && herdada?.inheritedFromQuoteLineId !== null,
      `${herdada?.priceOrigin} · ${herdada?.inheritedFromQuoteLineId}`,
    );
    const precoNaTela = await campoPreco().inputValue();
    afirmar("a tela mostra o preço herdado", precoNaTela === "12.5000", precoNaTela);

    // ── 4. Tab pelos campos, sem mudar nada ─────────────────────────────
    console.log(`\n[4] Tab pela quantidade, pela unidade e pelo preço, sem mudar nada`);

    const antes = atualizacoes.length;
    await campoQuantidade().focus();
    await pagina.keyboard.press("Tab");
    await pagina.waitForTimeout(1000);
    afirmar(
      "passar pela quantidade não manda atualização de linha",
      atualizacoes.length === antes,
      `${atualizacoes.length - antes} pedido(s) ${atualizacoes.slice(antes).join(" ")}`,
    );

    await campoUnidade().focus();
    await pagina.keyboard.press("Tab");
    await pagina.waitForTimeout(1000);
    afirmar(
      "passar pela unidade não manda atualização de linha",
      atualizacoes.length === antes,
      `${atualizacoes.length - antes} pedido(s) ${atualizacoes.slice(antes).join(" ")}`,
    );

    await campoPreco().focus();
    await pagina.keyboard.press("Tab");
    await pagina.waitForTimeout(1000);
    afirmar(
      "passar pelo preço não manda atualização de linha",
      atualizacoes.length === antes,
      `${atualizacoes.length - antes} pedido(s) ${atualizacoes.slice(antes).join(" ")}`,
    );
    const precoDepoisDoTab = await campoPreco().inputValue();
    afirmar("o preço continua na tela", precoDepoisDoTab === "12.5000", precoDepoisDoTab);

    // ── 5. Reaberta, a decisão de preço continua a mesma ────────────────
    console.log(`\n[5] Reaberta a ficha, a decisão de preço continua a mesma`);

    const [leituraReaberta] = await Promise.all([
      pagina.waitForResponse(ehLeituraDoProjeto, { timeout: 25000 }),
      pagina.goto(urlDoProjeto),
    ]);
    await campoPreco().waitFor({ timeout: 25000 });
    await assentar();
    const reaberta = await linhaDoRascunho(leituraReaberta);
    afirmar("o preço gravado é o herdado", reaberta?.unitPrice === "12.5000", reaberta?.unitPrice);
    afirmar(
      "a origem continua herdada",
      reaberta?.priceOrigin === "INHERITED_AGREEMENT",
      reaberta?.priceOrigin,
    );
    afirmar(
      "o vínculo com a linha do acordo continua",
      reaberta?.inheritedFromQuoteLineId === herdada?.inheritedFromQuoteLineId,
      reaberta?.inheritedFromQuoteLineId,
    );
    afirmar(
      '"Enviar ao cliente" continua disponível',
      await pagina.getByRole("button", { name: "Enviar ao cliente", exact: true }).first().isEnabled(),
    );
    afirmar("sem aviso de envio", (await pagina.locator("#quote-send-pending").count()) === 0);

    // ── 6. Mudança REAL de quantidade ───────────────────────────────────
    console.log(`\n[6] Mudança real de quantidade — a regra de §74 continua`);

    const antesDaMudanca = atualizacoes.length;
    releitura = esperarReleitura();
    await campoQuantidade().fill("1200");
    await campoQuantidade().blur();
    const leituraDepoisDaMudanca = await releitura;
    await assentar();
    afirmar(
      "a mudança real manda uma atualização",
      atualizacoes.length === antesDaMudanca + 1,
      `${atualizacoes.length - antesDaMudanca}`,
    );
    const mudada = await linhaDoRascunho(leituraDepoisDaMudanca);
    afirmar("a quantidade nova foi gravada", Number(mudada?.quotedQuantity) === 1200, mudada?.quotedQuantity);
    afirmar(
      "o preço herdado foi solto, como a regra manda",
      mudada?.unitPrice === null && mudada?.priceOrigin === null && mudada?.inheritedFromQuoteLineId === null,
      `${mudada?.unitPrice} · ${mudada?.priceOrigin} · ${mudada?.inheritedFromQuoteLineId}`,
    );
    afirmar("a tela mostra a linha sem preço", (await campoPreco().inputValue()) === "");

    afirmar("console limpo", erros.length === 0, erros.slice(0, 3).join(" | "));
  } finally {
    await fechar();
  }

  console.log("");
  if (falhas.length > 0) {
    console.log(`FALHOU — ${falhas.length} verificação(ões):`);
    for (const falha of falhas) console.log(`  - ${falha}`);
    process.exitCode = 1;
    return;
  }
  console.log("OK — passar pelo campo não apaga decisão de preço; mudar de verdade continua valendo.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
