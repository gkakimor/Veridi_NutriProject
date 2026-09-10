import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Prazo inválido não apaga o prazo gravado — QUOTE-INT-FIELDS-01.
 *
 * Prazo, parcelas e intervalo eram convertidos com `Number(texto)`: `abc` virava
 * `NaN`, o JSON escreve `NaN` como `null`, e "Salvar condições" apagava o valor
 * gravado. O erro de digitação virava a decisão de limpar o campo.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. condições gravadas com prazo, parcelas e intervalo inteiros;
 *   2. prazo trocado por `abc`: o erro aparece no próprio campo, "Salvar
 *      condições" fica indisponível, insistir no clique não manda nenhuma
 *      atualização das condições, e o envio fica preso;
 *   3. uma segunda aba prova que o prazo gravado continua lá;
 *   4. parcelas com vírgula também são recusadas no campo;
 *   5. corrigidos, prazo e parcelas salvam como inteiros, e a ficha reaberta
 *      mostra os valores novos, escritos como inteiros.
 *
 * Toda mutação é de interface. A rede é só observada.
 *
 *   node scripts/e2e/prazo-invalido-nao-apaga.mjs
 */

const run = obterRun({ novo: true, dono: "comercial" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Prazo ${P} LTDA`;
const NOME_DO_PROJETO = `Projeto Prazo ${P}`;
const NOME_DO_PRODUTO = `Produto Prazo ${P}`;

const ERRO_PRAZO = "Prazo de entrega (dias): informe um número inteiro maior que zero.";
const ERRO_PARCELAS = "Parcelas: informe um número inteiro de 1 a 120.";

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

  /** Toda gravação de condições que sair do navegador — observada, nunca feita pela suíte. */
  const gravacoes = [];
  pagina.on("request", (requisicao) => {
    if (
      requisicao.method() === "PATCH" &&
      /\/quote-versions\/[0-9a-f-]{36}$/.test(new URL(requisicao.url()).pathname)
    ) {
      gravacoes.push(requisicao.postData() ?? "");
    }
  });

  const ehLeituraDoProjeto = (r) =>
    r.request().method() === "GET" &&
    r.status() === 200 &&
    /\/projects\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname);
  const esperarReleitura = () => {
    const resposta = pagina.waitForResponse(ehLeituraDoProjeto, { timeout: 25000 });
    resposta.catch(() => {});
    return resposta;
  };
  const assentar = () => pagina.waitForTimeout(400);

  const prazo = () => pagina.locator("#quote-lead-time").first();
  const parcelas = () => pagina.locator("#quote-installments").first();
  const intervalo = () => pagina.locator("#quote-interval").first();
  const botaoSalvar = () =>
    pagina.getByRole("button", { name: "Salvar condições", exact: true }).first();
  const botaoEnviar = () =>
    pagina
      .locator(".quote-workspace")
      .getByRole("button", { name: "Enviar ao cliente", exact: true })
      .first();
  const situacao = async () =>
    (await pagina.locator(".quote-conditions .form-status").first().innerText()).trim();
  const textoDe = async (seletor) =>
    (await pagina.locator(seletor).count()) ? (await pagina.locator(seletor).innerText()).trim() : null;

  let urlDoProjeto = "";

  try {
    // ── 1. Cliente, Projeto, Produto e V1 com linha ─────────────────────
    console.log(`\n[1] Cliente, Projeto, Produto e V1 com linha`);

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

    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    const seletorDeProduto = pagina.locator("#quote-add-product").first();
    await seletorDeProduto.waitFor({ timeout: 25000 });
    const rotulo = await seletorDeProduto.locator("option", { hasText: P }).first().innerText();
    const codigo = rotulo.split(" · ")[0].trim();

    let releitura = esperarReleitura();
    await seletorDeProduto.selectOption({ label: rotulo });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).first().click();
    await releitura;
    const campoQuantidade = pagina.getByLabel(`Quantidade de ${codigo}`);
    await campoQuantidade.waitFor({ timeout: 25000 });
    releitura = esperarReleitura();
    await campoQuantidade.fill("1000");
    await campoQuantidade.blur();
    await releitura;
    await assentar();
    releitura = esperarReleitura();
    await pagina.getByLabel(`Preço unitário de ${codigo}`).fill("12,50");
    await pagina.getByLabel(`Preço unitário de ${codigo}`).blur();
    await releitura;
    await assentar();
    afirmar("V1 com linha precificada", true, codigo);

    // ── 2. Condições gravadas, com inteiros ─────────────────────────────
    console.log(`\n[2] Condições gravadas: prazo 30, 3 parcelas a cada 30 dias`);

    await pagina.locator("#quote-valid-until").fill("2099-09-20");
    await prazo().fill("30");
    await pagina.locator("#quote-payment-method").selectOption("INSTALLMENTS");
    await parcelas().fill("3");
    await intervalo().fill("30");
    releitura = esperarReleitura();
    await botaoSalvar().click();
    await releitura;
    await assentar();
    afirmar("condições salvas", (await situacao()) === "Tudo salvo", await situacao());

    await pagina.goto(urlDoProjeto);
    await prazo().waitFor({ timeout: 25000 });
    afirmar("reaberta, o prazo gravado é 30", (await prazo().inputValue()) === "30", await prazo().inputValue());
    afirmar("e as parcelas, 3", (await parcelas().inputValue()) === "3", await parcelas().inputValue());
    afirmar(
      '"Enviar ao cliente" disponível com tudo salvo',
      await botaoEnviar().isEnabled(),
    );

    // ── 3. Prazo inválido ───────────────────────────────────────────────
    console.log(`\n[3] Prazo trocado por "abc"`);

    const gravacoesAntes = gravacoes.length;
    await prazo().fill("abc");
    afirmar(
      "o erro aparece no próprio campo",
      (await textoDe("#quote-lead-time-error")) === ERRO_PRAZO,
      (await textoDe("#quote-lead-time-error")) ?? "(sem erro)",
    );
    afirmar("o campo se diz inválido", (await prazo().getAttribute("aria-invalid")) === "true");
    afirmar(
      "e aponta para o erro",
      (await prazo().getAttribute("aria-describedby")) === "quote-lead-time-error",
    );
    afirmar("o texto digitado fica no campo", (await prazo().inputValue()) === "abc");
    afirmar("o formulário diz que há alteração pendente", (await situacao()) === "Alterações não salvas");
    afirmar('"Salvar condições" indisponível', await botaoSalvar().isDisabled());

    // `force` ignora a espera por botão habilitado: é o clique de quem insiste.
    await botaoSalvar()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await pagina.waitForTimeout(1000);
    afirmar(
      "nenhuma gravação das condições saiu do navegador",
      gravacoes.length === gravacoesAntes,
      gravacoes.slice(gravacoesAntes).join(" | ") || "0",
    );
    afirmar('"Enviar ao cliente" preso pela condição por salvar', await botaoEnviar().isDisabled());

    // ── 4. Segunda aba ──────────────────────────────────────────────────
    console.log(`\n[4] Segunda aba: o prazo gravado continua lá`);

    const segunda = await contexto.newPage();
    segunda.on("pageerror", (e) => erros.push(`pageerror (2ª aba): ${String(e).slice(0, 200)}`));
    segunda.on("console", (m) => m.type() === "error" && erros.push(`console.error (2ª aba): ${m.text().slice(0, 200)}`));
    await segunda.goto(urlDoProjeto);
    await segunda.locator("#quote-lead-time").first().waitFor({ timeout: 25000 });
    const prazoNaOutraAba = await segunda.locator("#quote-lead-time").first().inputValue();
    await segunda.close();
    afirmar("o prazo gravado não foi apagado", prazoNaOutraAba === "30", prazoNaOutraAba);

    // ── 5. Parcelas com vírgula ─────────────────────────────────────────
    console.log(`\n[5] Parcelas com vírgula`);

    await parcelas().fill("3,5");
    afirmar(
      "o erro aparece nas parcelas",
      (await textoDe("#quote-installments-error")) === ERRO_PARCELAS,
      (await textoDe("#quote-installments-error")) ?? "(sem erro)",
    );
    afirmar('"Salvar condições" continua indisponível', await botaoSalvar().isDisabled());

    // ── 6. Corrigir e salvar ────────────────────────────────────────────
    console.log(`\n[6] Corrigidos, prazo e parcelas salvam como inteiros`);

    await prazo().fill("45");
    await parcelas().fill("4");
    afirmar("os erros saem", (await textoDe("#quote-lead-time-error")) === null && (await textoDe("#quote-installments-error")) === null);
    afirmar('"Salvar condições" volta', await botaoSalvar().isEnabled());
    const antesDeSalvar = gravacoes.length;
    releitura = esperarReleitura();
    await botaoSalvar().click();
    await releitura;
    await assentar();
    const pedido = JSON.parse(gravacoes[antesDeSalvar] ?? "{}");
    afirmar(
      "o pedido leva os inteiros",
      pedido.leadTimeDays === 45 && pedido.installmentCount === 4,
      gravacoes[antesDeSalvar],
    );
    afirmar("salvo, Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());

    await pagina.goto(urlDoProjeto);
    await prazo().waitFor({ timeout: 25000 });
    afirmar("reaberta, o prazo é 45", (await prazo().inputValue()) === "45", await prazo().inputValue());
    afirmar("e as parcelas, 4", (await parcelas().inputValue()) === "4", await parcelas().inputValue());

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
  console.log("OK — inteiro inválido fica inválido na tela, e o gravado não é apagado.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
