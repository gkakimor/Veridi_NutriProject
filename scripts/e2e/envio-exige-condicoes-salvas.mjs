import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Enviar exige as condições salvas — QUOTE-SEND-DIRTY-01.
 *
 * O envio congela o que está GRAVADO. Com uma condição alterada e não salva, a
 * tela mostraria uma validade e o cliente receberia outra. A tela passou a
 * bloquear o envio enquanto houver condição por salvar — sem auto-salvar e sem
 * "enviar mesmo assim".
 *
 * O que esta suíte prova, clicando:
 *
 *   1. rascunho com as condições salvas: "Enviar ao cliente" disponível, sem
 *      aviso nenhum;
 *   2. validade alterada e NÃO salva: o botão fica indisponível, a mensagem
 *      aparece ligada a ele, e tentar enviar não abre confirmação nem manda
 *      requisição de envio;
 *   3. adicionar e remover produto com a condição por salvar não libera o envio;
 *   4. salvar libera o envio na mesma tela, sem recarregar a página;
 *   5. enviado, o documento congela a validade NOVA — na lista de versões, na
 *      versão enviada reaberta e no impresso —, nunca a anterior.
 *
 * Toda mutação é de interface; a rede é só observada. Massa própria, carimbada
 * pelo `runId`.
 *
 *   node scripts/e2e/envio-exige-condicoes-salvas.mjs
 */

const run = obterRun({ novo: true, dono: "comercial" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Envio ${P} LTDA`;
const NOME_DO_PROJETO = `Projeto Envio ${P}`;
const PRODUTO_A = `Produto A Envio ${P}`;
const PRODUTO_B = `Produto B Envio ${P}`;

const VALIDADE_SALVA = "2099-09-20";
const VALIDADE_SALVA_BR = "20/09/2099";
const VALIDADE_NOVA = "2099-10-31";
const VALIDADE_NOVA_BR = "31/10/2099";

const SALVE_ANTES = "Salve as alterações das condições antes de enviar o orçamento.";
const USA_O_SALVO = "O envio usa somente as condições já salvas.";

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

  /**
   * A releitura do Projeto que toda mutação dispara. Registrar ANTES da ação:
   * a resposta pode chegar antes de o `await` da ação voltar. O `catch` vazio
   * impede que um tempo esgotado vire rejeição sem dono e derrube o processo
   * sem fechar o navegador.
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

  const valorDe = (seletor) => pagina.locator(seletor).first().inputValue();
  const situacao = async () =>
    (await pagina.locator(".quote-conditions .form-status").first().innerText()).trim();
  const botaoEnviar = () =>
    pagina.locator(".quote-workspace").getByRole("button", { name: "Enviar ao cliente", exact: true }).first();
  const botaoSalvar = () =>
    pagina.getByRole("button", { name: "Salvar condições", exact: true }).first();
  const aviso = () => pagina.locator("#quote-send-pending");

  /** Envio indisponível, com o motivo ligado ao botão. */
  const conferirBloqueio = async (momento) => {
    afirmar(`${momento}: "Enviar ao cliente" indisponível`, await botaoEnviar().isDisabled());
    const texto = (await aviso().count()) ? (await aviso().innerText()).trim() : null;
    afirmar(
      `${momento}: a mensagem diz o que fazer`,
      texto === `${SALVE_ANTES} ${USA_O_SALVO}`,
      texto ?? "(sem mensagem)",
    );
    afirmar(
      `${momento}: a mensagem está ligada ao botão`,
      (await botaoEnviar().getAttribute("aria-describedby")) === "quote-send-pending",
    );
  };

  const linhaDaVersao = (rotulo) =>
    pagina.locator("tbody tr", { has: pagina.locator("td.is-code", { hasText: rotulo }) }).first();
  const celulasDaV1 = async () =>
    (await linhaDaVersao(/ · V1$/).locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

  let urlDoProjeto = "";

  try {
    // ── 1. Cliente, Projeto e dois produtos ─────────────────────────────
    console.log(`\n[1] Cliente, Projeto e dois produtos`);

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

    for (const nome of [PRODUTO_A, PRODUTO_B]) {
      await pagina.getByRole("button", { name: "+ Adicionar produto" }).first().click();
      await pagina.getByRole("button", { name: "Criar novo produto" }).first().click();
      await pagina.locator("#new-product-name").first().fill(nome);
      await pagina.getByRole("button", { name: "Criar produto" }).first().click();
      await pagina.getByText(nome).first().waitFor({ timeout: 25000 });
    }
    afirmar("projeto com dois produtos", true, NOME_DO_PROJETO);

    // ── 2. V1 com uma linha precificada ─────────────────────────────────
    console.log(`\n[2] V1 com uma linha precificada`);

    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    const seletorDeProduto = pagina.locator("#quote-add-product").first();
    await seletorDeProduto.waitFor({ timeout: 25000 });
    const rotuloDe = async (nome) =>
      seletorDeProduto.locator("option", { hasText: nome }).first().innerText();
    const rotuloA = await rotuloDe(PRODUTO_A);
    const rotuloB = await rotuloDe(PRODUTO_B);
    const codigoA = rotuloA.split(" · ")[0].trim();
    const codigoB = rotuloB.split(" · ")[0].trim();

    let releitura = esperarReleitura();
    await seletorDeProduto.selectOption({ label: rotuloA });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).first().click();
    await releitura;
    await pagina.getByLabel(`Quantidade de ${codigoA}`).waitFor({ timeout: 25000 });

    releitura = esperarReleitura();
    await pagina.getByLabel(`Quantidade de ${codigoA}`).fill("1000");
    await pagina.getByLabel(`Quantidade de ${codigoA}`).blur();
    await releitura;
    await assentar();

    releitura = esperarReleitura();
    await pagina.getByLabel(`Preço unitário de ${codigoA}`).fill("12,50");
    await pagina.getByLabel(`Preço unitário de ${codigoA}`).blur();
    await releitura;
    await assentar();

    // ── 3. Condições iniciais, salvas ───────────────────────────────────
    console.log(`\n[3] Condições iniciais salvas: o envio está disponível`);

    await pagina.locator("#quote-valid-until").fill(VALIDADE_SALVA);
    await pagina.locator("#quote-discount").fill("5");
    releitura = esperarReleitura();
    await botaoSalvar().click();
    await releitura;
    await assentar();
    afirmar("condições iniciais salvas", (await situacao()) === "Tudo salvo", await situacao());
    afirmar('com tudo salvo, "Enviar ao cliente" está disponível', await botaoEnviar().isEnabled());
    afirmar("com tudo salvo, não há aviso de envio", (await aviso().count()) === 0);

    // ── 4. Validade alterada, sem salvar ────────────────────────────────
    console.log(`\n[4] Validade alterada e NÃO salva`);

    await pagina.locator("#quote-valid-until").fill(VALIDADE_NOVA);
    afirmar(
      "o formulário diz que há alteração pendente",
      (await situacao()) === "Alterações não salvas",
      await situacao(),
    );
    await conferirBloqueio("com a validade por salvar");
    afirmar(
      "o botão também diz o motivo ao passar o mouse",
      (await botaoEnviar().getAttribute("title")) === SALVE_ANTES,
    );

    // ── 5. Tentar enviar ────────────────────────────────────────────────
    console.log(`\n[5] Tentar enviar mesmo assim`);

    // `force` ignora a espera por botão habilitado: é o clique de quem insiste.
    await botaoEnviar()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await pagina.waitForTimeout(800);
    afirmar("nenhuma confirmação de envio se abriu", (await pagina.getByRole("alertdialog").count()) === 0);
    afirmar("nenhuma requisição de envio saiu do navegador", envios.length === 0, `${envios.length}`);
    const antes = await celulasDaV1();
    afirmar("a V1 continua em rascunho", /Rascunho/.test(antes[5] ?? ""), antes[5]);

    // ── 6. Linha adicionada e removida com a condição por salvar ─────────
    console.log(`\n[6] Linha adicionada e removida com a condição por salvar`);

    releitura = esperarReleitura();
    await seletorDeProduto.selectOption({ label: rotuloB });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).first().click();
    await releitura;
    await pagina.getByLabel(`Quantidade de ${codigoB}`).waitFor({ timeout: 25000 });
    await assentar();
    afirmar(
      "depois de adicionar produto, a validade digitada continua",
      (await valorDe("#quote-valid-until")) === VALIDADE_NOVA,
    );
    await conferirBloqueio("depois de adicionar produto");

    releitura = esperarReleitura();
    await pagina
      .locator("tr", { has: pagina.getByLabel(`Quantidade de ${codigoB}`) })
      .getByRole("button", { name: "Remover" })
      .click();
    await releitura;
    await pagina.getByLabel(`Quantidade de ${codigoB}`).waitFor({ state: "detached", timeout: 25000 });
    await assentar();
    await conferirBloqueio("depois de remover produto");

    // ── 7. Salvar libera o envio ────────────────────────────────────────
    console.log(`\n[7] Salvar libera o envio, sem recarregar a página`);

    releitura = esperarReleitura();
    await botaoSalvar().click();
    await releitura;
    await assentar();
    afirmar("salvo, o formulário diz Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());
    afirmar('salvo, "Enviar ao cliente" volta a ficar disponível', await botaoEnviar().isEnabled());
    afirmar("salvo, o aviso sai da tela", (await aviso().count()) === 0);
    afirmar("salvar não enviou nada", envios.length === 0, `${envios.length}`);

    // ── 8. Enviar ───────────────────────────────────────────────────────
    console.log(`\n[8] Enviar ao cliente`);

    releitura = esperarReleitura();
    await botaoEnviar().click();
    const confirmacao = pagina.getByRole("alertdialog");
    await confirmacao.waitFor({ timeout: 25000 });
    await confirmacao.getByRole("button", { name: "Enviar ao cliente", exact: true }).click();
    await releitura;
    await assentar();
    afirmar("uma requisição de envio, e só uma", envios.length === 1, `${envios.length}`);
    const depois = await celulasDaV1();
    afirmar("a V1 passou a Enviado", /Enviado/.test(depois[5] ?? ""), depois[5]);

    // ── 9. O documento congelou a validade NOVA ─────────────────────────
    console.log(`\n[9] O que foi congelado é o que foi salvo`);

    afirmar(
      "na lista de versões, a validade é a nova",
      (depois[4] ?? "").includes(VALIDADE_NOVA_BR) && !(depois[4] ?? "").includes(VALIDADE_SALVA_BR),
      depois[4],
    );

    await pagina.goto(urlDoProjeto);
    await pagina.locator("#quote-valid-until").first().waitFor({ timeout: 25000 });
    afirmar(
      "reaberta, a versão enviada mostra a validade nova",
      (await valorDe("#quote-valid-until")) === VALIDADE_NOVA,
      await valorDe("#quote-valid-until"),
    );
    afirmar(
      "e somente leitura",
      await pagina.locator("#quote-valid-until").first().isDisabled(),
    );

    const [impresso] = await Promise.all([
      contexto.waitForEvent("page", { timeout: 25000 }),
      pagina.getByRole("button", { name: "Imprimir", exact: true }).first().click(),
    ]);
    impresso.on("pageerror", (e) => erros.push(`pageerror (impresso): ${String(e).slice(0, 200)}`));
    impresso.on("console", (m) => m.type() === "error" && erros.push(`console.error (impresso): ${m.text().slice(0, 200)}`));
    await impresso.waitForLoadState("networkidle");
    await impresso.waitForFunction((alvo) => document.body.innerText.includes(alvo), VALIDADE_NOVA_BR, {
      timeout: 25000,
    }).catch(() => {});
    const textoImpresso = await impresso.locator("body").innerText();
    await impresso.close();
    afirmar("o impresso traz a validade nova", textoImpresso.includes(VALIDADE_NOVA_BR));
    afirmar("o impresso não traz a validade anterior", !textoImpresso.includes(VALIDADE_SALVA_BR));

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
  console.log("OK — com condição por salvar não se envia; o que se envia é o que foi salvo.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
