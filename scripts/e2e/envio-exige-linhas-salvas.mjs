import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Linha que falhou ao salvar segura o envio — QUOTE-SEND-LINE-DRAFT-01.
 *
 * O preço da linha grava ao sair do campo. Se esse salvamento falha, o campo
 * continua mostrando o que foi digitado — a pessoa precisa ver o que tentou
 * informar — e o servidor fica com o preço antigo. Antes, "Enviar ao cliente"
 * seguia disponível, e o envio congelava o preço ANTIGO. A tela passou a
 * segurar o envio enquanto alguma linha mostrar o que não foi gravado.
 *
 * A falha é produzida na requisição que a própria tela faz: a próxima
 * atualização de linha responde 503, uma vez. Nenhuma mutação de negócio sai
 * da suíte — quem cria, salva e envia é a interface.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. com o preço salvo, o envio está disponível;
 *   2. preço novo digitado: o envio fica indisponível antes mesmo de sair do
 *      campo;
 *   3. o salvamento do preço novo falha: o campo continua com o preço novo, o
 *      erro aparece, o envio segue indisponível com o motivo ligado ao botão,
 *      e insistir no clique não abre confirmação nem manda requisição de envio;
 *   4. a nova tentativa passa, sem recarregar a página, e o envio volta;
 *   5. enviado, o documento congela o preço NOVO — na versão reaberta e no
 *      impresso —, nunca o antigo;
 *   6. o console só tem o erro que a própria suíte provocou.
 *
 *   node scripts/e2e/envio-exige-linhas-salvas.mjs
 */

const run = obterRun({ novo: true, dono: "comercial" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Linha ${P} LTDA`;
const NOME_DO_PROJETO = `Projeto Linha ${P}`;
const NOME_DO_PRODUTO = `Produto Linha ${P}`;

const VALIDADE = "2099-09-20";
const PRECO_ANTIGO = "10,00";
const PRECO_NOVO = "12,50";
/** 1.000 × R$ 12,50 e 1.000 × R$ 10,00 — o total de cada preço. */
const TOTAL_NOVO = "12.500,00";
const TOTAL_ANTIGO = "10.000,00";

const PRODUTOS = "Salve as alterações dos produtos antes de enviar o orçamento.";
const USA_O_SALVO = "O envio usa somente os valores já salvos.";
const FALHA_PROVOCADA = "Serviço indisponível no momento. Tente de novo.";

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
  const { contexto, pagina, erros, fechar } = await abrirNavegador();

  /** Toda requisição de ENVIO que sair do navegador — observada, nunca feita pela suíte. */
  const envios = [];
  pagina.on("request", (requisicao) => {
    if (
      requisicao.method() === "POST" &&
      /\/quote-versions\/[^/]+\/send$/.test(new URL(requisicao.url()).pathname)
    ) {
      envios.push(requisicao.url());
    }
  });

  /*
   * A falha provocada: enquanto ligada, a PRÓXIMA atualização de linha que a
   * tela fizer recebe 503 — uma vez só. Tudo o mais segue para a API real.
   */
  let falharProximaAtualizacao = false;
  let falhasProvocadas = 0;
  await pagina.route("**/quote-lines/**", async (rota) => {
    if (falharProximaAtualizacao && rota.request().method() === "PATCH") {
      falharProximaAtualizacao = false;
      falhasProvocadas += 1;
      await rota.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "service_unavailable", message: FALHA_PROVOCADA }),
      });
      return;
    }
    await rota.continue();
  });

  /**
   * A releitura do Projeto que toda mutação bem-sucedida dispara. Registrar
   * ANTES da ação; o `catch` vazio impede que um tempo esgotado vire rejeição
   * sem dono e derrube o processo sem fechar o navegador.
   */
  const esperarReleitura = () => {
    const resposta = pagina.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        /\/projects\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname),
      { timeout: 25000 },
    );
    resposta.catch(() => {});
    return resposta;
  };
  const assentar = () => pagina.waitForTimeout(400);

  const botaoEnviar = () =>
    pagina
      .locator(".quote-workspace")
      .getByRole("button", { name: "Enviar ao cliente", exact: true })
      .first();
  const aviso = () => pagina.locator("#quote-send-pending");
  const textoDoAviso = async () => ((await aviso().count()) ? (await aviso().innerText()).trim() : null);

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

    // ── 2. V1 com preço e condições salvos ──────────────────────────────
    console.log(`\n[2] V1 com preço e condições salvos`);

    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    const seletorDeProduto = pagina.locator("#quote-add-product").first();
    await seletorDeProduto.waitFor({ timeout: 25000 });
    const rotulo = await seletorDeProduto.locator("option", { hasText: P }).first().innerText();
    const codigo = rotulo.split(" · ")[0].trim();
    const campoPreco = () => pagina.getByLabel(`Preço unitário de ${codigo}`);
    const campoQuantidade = () => pagina.getByLabel(`Quantidade de ${codigo}`);

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
    await campoPreco().fill(PRECO_ANTIGO);
    await campoPreco().blur();
    await releitura;
    await assentar();

    await pagina.locator("#quote-valid-until").fill(VALIDADE);
    releitura = esperarReleitura();
    await pagina.getByRole("button", { name: "Salvar condições", exact: true }).first().click();
    await releitura;
    await assentar();
    afirmar('com tudo salvo, "Enviar ao cliente" está disponível', await botaoEnviar().isEnabled());
    afirmar("com tudo salvo, não há aviso de envio", (await aviso().count()) === 0);

    // ── 3. Preço novo digitado ──────────────────────────────────────────
    console.log(`\n[3] Preço novo digitado, ainda no campo`);

    await campoPreco().fill(PRECO_NOVO);
    afirmar(
      "antes de sair do campo, o envio já está indisponível",
      await botaoEnviar().isDisabled(),
    );

    // ── 4. O salvamento do preço novo falha ─────────────────────────────
    console.log(`\n[4] O salvamento do preço novo falha`);

    falharProximaAtualizacao = true;
    const resposta503 = pagina.waitForResponse((r) => r.status() === 503, { timeout: 25000 });
    resposta503.catch(() => {});
    await campoPreco().blur();
    await resposta503;
    await pagina.locator(".form-alert", { hasText: FALHA_PROVOCADA }).first().waitFor({ timeout: 25000 });
    afirmar("a falha foi provocada uma vez", falhasProvocadas === 1, `${falhasProvocadas}`);
    afirmar("o erro aparece na tela", true, FALHA_PROVOCADA);
    afirmar(
      "o campo continua com o preço novo",
      (await campoPreco().inputValue()) === PRECO_NOVO,
      await campoPreco().inputValue(),
    );
    afirmar('"Enviar ao cliente" indisponível', await botaoEnviar().isDisabled());
    afirmar(
      "a mensagem diz o que fazer",
      (await textoDoAviso()) === `${PRODUTOS} ${USA_O_SALVO}`,
      (await textoDoAviso()) ?? "(sem mensagem)",
    );
    afirmar(
      "a mensagem está ligada ao botão",
      (await botaoEnviar().getAttribute("aria-describedby")) === "quote-send-pending",
    );
    afirmar("o botão também diz o motivo", (await botaoEnviar().getAttribute("title")) === PRODUTOS);

    // `force` ignora a espera por botão habilitado: é o clique de quem insiste.
    await botaoEnviar()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await pagina.waitForTimeout(800);
    afirmar("nenhuma confirmação de envio se abriu", (await pagina.getByRole("alertdialog").count()) === 0);
    afirmar("nenhuma requisição de envio saiu do navegador", envios.length === 0, `${envios.length}`);

    // ── 5. Nova tentativa ───────────────────────────────────────────────
    console.log(`\n[5] Nova tentativa, sem recarregar a página`);

    releitura = esperarReleitura();
    await campoPreco().focus();
    await campoPreco().blur();
    await releitura;
    await assentar();
    afirmar('salvo, "Enviar ao cliente" volta a ficar disponível', await botaoEnviar().isEnabled());
    afirmar("salvo, o aviso sai da tela", (await aviso().count()) === 0);
    afirmar(
      "salvo, o erro sai da tela",
      (await pagina.locator(".form-alert", { hasText: FALHA_PROVOCADA }).count()) === 0,
    );
    afirmar("salvar a linha não enviou nada", envios.length === 0, `${envios.length}`);

    // ── 6. Enviar ───────────────────────────────────────────────────────
    console.log(`\n[6] Enviar ao cliente`);

    releitura = esperarReleitura();
    await botaoEnviar().click();
    const confirmacao = pagina.getByRole("alertdialog");
    await confirmacao.waitFor({ timeout: 25000 });
    await confirmacao.getByRole("button", { name: "Enviar ao cliente", exact: true }).click();
    await releitura;
    await assentar();
    afirmar("uma requisição de envio, e só uma", envios.length === 1, `${envios.length}`);

    // ── 7. O documento congelou o preço NOVO ────────────────────────────
    console.log(`\n[7] O que foi congelado é o preço novo`);

    await pagina.goto(urlDoProjeto);
    const linhaDaProposta = pagina.locator("table.table--quote-lines tbody tr").first();
    await linhaDaProposta.waitFor({ timeout: 25000 });
    const celulas = (await linhaDaProposta.locator("td").allInnerTexts()).map((t) =>
      t.replace(/\s+/g, " ").trim(),
    );
    afirmar(
      "a versão enviada mostra o preço novo",
      (celulas[4] ?? "").includes(PRECO_NOVO),
      celulas[4],
    );
    afirmar(
      "e o total do preço novo",
      (celulas[5] ?? "").includes(TOTAL_NOVO),
      celulas[5],
    );
    afirmar(
      "a versão está enviada, somente leitura",
      (await pagina.getByLabel(`Preço unitário de ${codigo}`).count()) === 0,
    );

    const [impresso] = await Promise.all([
      contexto.waitForEvent("page", { timeout: 25000 }),
      pagina.getByRole("button", { name: "Imprimir", exact: true }).first().click(),
    ]);
    impresso.on("pageerror", (e) => erros.push(`pageerror (impresso): ${String(e).slice(0, 200)}`));
    impresso.on("console", (m) => m.type() === "error" && erros.push(`console.error (impresso): ${m.text().slice(0, 200)}`));
    await impresso.waitForLoadState("networkidle");
    await impresso
      .waitForFunction((alvo) => document.body.innerText.includes(alvo), TOTAL_NOVO, { timeout: 25000 })
      .catch(() => {});
    const textoImpresso = await impresso.locator("body").innerText();
    await impresso.close();
    afirmar("o impresso traz o total do preço novo", textoImpresso.includes(TOTAL_NOVO));
    afirmar("o impresso traz o preço novo", textoImpresso.includes(PRECO_NOVO));
    afirmar("o impresso não traz o total do preço antigo", !textoImpresso.includes(TOTAL_ANTIGO));

    // A falha provocada deixa o próprio registro do navegador ("Failed to load
    // resource ... 503"): é o único erro esperado, e só uma vez.
    const provocados = erros.filter((e) => /\b503\b/.test(e));
    const inesperados = erros.filter((e) => !/\b503\b/.test(e));
    afirmar(
      "console: só o erro da falha provocada",
      inesperados.length === 0 && provocados.length <= falhasProvocadas,
      [...inesperados, ...provocados].slice(0, 3).join(" | ") || "limpo",
    );
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
  console.log("OK — linha que a tela mostra e o servidor não tem segura o envio; o que vai é o salvo.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
