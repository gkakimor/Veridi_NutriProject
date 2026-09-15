import { abrirNavegador, API, WEB } from "./lib/browser.mjs";
import { criarCliente } from "./fixtures/cadastros.mjs";
import { adicionarLinha, criarProdutoDoProjeto, criarProjeto, criarVersao } from "./fixtures/comercial.mjs";
import { abrirVersao, aguardarReleitura, rotaDaVersao, rotaDoProjeto } from "./fixtures/comercial-ui.mjs";
import { carimbar, criarRun } from "./fixtures/run.mjs";

/**
 * Prazo inválido não apaga o prazo gravado — QUOTE-INT-FIELDS-01, na página da
 * versão (E2E-BASELINE-REDESIGN-WAVE-03).
 *
 * Prazo, parcelas e intervalo eram convertidos com `Number(texto)`: `abc` virava
 * `NaN`, o JSON escrevia `null`, e "Salvar condições" apagava o valor gravado.
 * Desde PTBR-NUMERIC-INPUT-ROLLOUT-01 o campo inteiro nem deixa a letra entrar;
 * o que entra e é inválido — o zero, as 121 parcelas — fica na tela, com o erro,
 * e não sai do navegador.
 *
 * O que esta suíte prova, clicando na página própria da versão (`/comercial/
 * orcamentos/:id`), sem voltar à ficha do Projeto:
 *
 *   1. condições gravadas pela tela com prazo, parcelas e intervalo inteiros;
 *   2. letra no prazo não entra: o campo continua com o gravado, sem erro e sem
 *      nada a salvar;
 *   3. prazo 0: erro no próprio campo, ligado por `aria-describedby`, texto
 *      mantido, "Salvar condições" e "Enviar ao cliente" presos, e nenhuma
 *      gravação das condições sai do navegador;
 *   4. uma segunda aba prova que o prazo gravado continua 30;
 *   5. parcelas: vírgula não entra, 121 é recusado no campo;
 *   6. corrigidos, prazo e parcelas salvam como inteiros e a versão reaberta
 *      mostra 45 e 4.
 *
 * Cliente, Projeto, Produto e a V1 com a linha precificada nascem por API: não
 * são o que se prova. Condições e erros, pela tela.
 *
 *   pnpm e2e:run --suites=prazo-invalido-nao-apaga
 */

const run = criarRun();

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
  const { contexto, pagina, api, erros, fechar } = await abrirNavegador();

  /** Toda gravação de condições que sair do navegador — observada, nunca feita pela suíte. */
  const gravacoes = [];
  pagina.on("request", (requisicao) => {
    const url = requisicao.url();
    if (
      requisicao.method() === "PATCH" &&
      url.startsWith(`${API}/`) &&
      /^\/quote-versions\/[0-9a-f-]{36}$/.test(new URL(url).pathname)
    ) {
      gravacoes.push(requisicao.postData() ?? "");
    }
  });

  const assentar = () => pagina.waitForTimeout(400);
  const prazo = () => pagina.locator("#quote-lead-time");
  const parcelas = () => pagina.locator("#quote-installments");
  const intervalo = () => pagina.locator("#quote-interval");
  const botaoSalvar = () => pagina.getByRole("button", { name: "Salvar condições", exact: true });
  const botaoEnviar = () =>
    pagina.locator(".quote-workspace").getByRole("button", { name: "Enviar ao cliente", exact: true });
  const situacao = async () => (await pagina.locator(".quote-conditions .form-status").innerText()).trim();
  const textoDe = async (seletor) =>
    (await pagina.locator(seletor).count()) ? (await pagina.locator(seletor).innerText()).trim() : null;

  try {
    // ── 1. Massa e a página da versão ───────────────────────────────────
    console.log(`\n[1] Cliente, Projeto, Produto e V1 com linha precificada, por API (${run.runId})`);

    const cliente = await criarCliente(api, run, { nome: carimbar(run, "Cliente Prazo") });
    const projeto = await criarProjeto(api, run, { cliente, nome: carimbar(run, "Projeto Prazo") });
    const produto = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto Prazo") });
    const v1 = await criarVersao(api, { projeto });
    await adicionarLinha(api, { versao: v1, produto, quantidade: "1000", preco: "12.5" });

    const urlDaV1 = `${WEB}${rotaDaVersao(v1.id, { voltar: rotaDoProjeto(projeto.id) })}`;
    const aberta = await abrirVersao(pagina, urlDaV1);
    afirmar(
      "a página da versão abre a V1 pelo id, com o rótulo do servidor",
      aberta.id === v1.id && aberta.rotulo === v1.rotulo,
      aberta.rotulo,
    );

    // ── 2. Condições gravadas, com inteiros ─────────────────────────────
    console.log(`\n[2] Condições gravadas pela tela: prazo 30, 3 parcelas a cada 30 dias`);

    await pagina.locator("#quote-valid-until").fill("2099-09-20");
    await prazo().fill("30");
    await pagina.locator("#quote-payment-method").selectOption("INSTALLMENTS");
    await parcelas().fill("3");
    await intervalo().fill("30");
    let releitura = aguardarReleitura(pagina);
    await botaoSalvar().click();
    await releitura;
    await assentar();
    afirmar("condições salvas", (await situacao()) === "Tudo salvo", await situacao());

    await abrirVersao(pagina, urlDaV1);
    afirmar("reaberta, o prazo gravado é 30", (await prazo().inputValue()) === "30", await prazo().inputValue());
    afirmar("e as parcelas, 3", (await parcelas().inputValue()) === "3", await parcelas().inputValue());
    afirmar('"Enviar ao cliente" disponível com tudo salvo', await botaoEnviar().isEnabled());

    // ── 3. Letra no prazo ───────────────────────────────────────────────
    console.log(`\n[3] Letra no prazo: não entra, e o gravado fica`);

    const antesDaLetra = gravacoes.length;
    await prazo().fill("abc");
    afirmar("a letra não entrou: o campo continua com 30", (await prazo().inputValue()) === "30", await prazo().inputValue());
    afirmar("sem erro no campo", (await textoDe("#quote-lead-time-error")) === null);
    afirmar("o formulário continua Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());
    afirmar('"Salvar condições" indisponível: nada a salvar', await botaoSalvar().isDisabled());
    // `force` ignora a espera por botão habilitado: é o clique de quem insiste.
    await botaoSalvar()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await pagina.waitForTimeout(800);
    afirmar(
      "nenhuma gravação das condições saiu do navegador",
      gravacoes.length === antesDaLetra,
      gravacoes.slice(antesDaLetra).join(" | ") || "0",
    );

    // ── 4. Prazo 0 ──────────────────────────────────────────────────────
    console.log(`\n[4] Prazo 0: entra, e é recusado no próprio campo`);

    const antesDoZero = gravacoes.length;
    await prazo().fill("0");
    afirmar(
      "o erro aparece no próprio campo",
      (await textoDe("#quote-lead-time-error")) === ERRO_PRAZO,
      (await textoDe("#quote-lead-time-error")) ?? "(sem erro)",
    );
    afirmar("o campo se diz inválido", (await prazo().getAttribute("aria-invalid")) === "true");
    afirmar("e aponta para o erro", (await prazo().getAttribute("aria-describedby")) === "quote-lead-time-error");
    afirmar("o texto digitado fica no campo", (await prazo().inputValue()) === "0", await prazo().inputValue());
    afirmar("o formulário diz que há alteração pendente", (await situacao()) === "Alterações não salvas", await situacao());
    afirmar('"Salvar condições" indisponível', await botaoSalvar().isDisabled());
    await botaoSalvar()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await pagina.waitForTimeout(1000);
    afirmar(
      "nenhuma gravação das condições saiu do navegador",
      gravacoes.length === antesDoZero,
      gravacoes.slice(antesDoZero).join(" | ") || "0",
    );
    afirmar('"Enviar ao cliente" preso pela condição por salvar', await botaoEnviar().isDisabled());

    // ── 5. Segunda aba ──────────────────────────────────────────────────
    console.log(`\n[5] Segunda aba: o prazo gravado continua lá`);

    const segunda = await contexto.newPage();
    await abrirVersao(segunda, urlDaV1);
    const prazoNaOutraAba = await segunda.locator("#quote-lead-time").inputValue();
    await segunda.close();
    afirmar("o prazo gravado não foi apagado", prazoNaOutraAba === "30", prazoNaOutraAba);

    // ── 6. Parcelas ─────────────────────────────────────────────────────
    console.log(`\n[6] Parcelas: vírgula não entra, 121 é recusado no campo`);

    await parcelas().fill("3,5");
    afirmar("a vírgula não entrou: as parcelas continuam 3", (await parcelas().inputValue()) === "3", await parcelas().inputValue());
    await parcelas().fill("121");
    afirmar(
      "121 parcelas: o erro aparece no campo",
      (await textoDe("#quote-installments-error")) === ERRO_PARCELAS,
      (await textoDe("#quote-installments-error")) ?? "(sem erro)",
    );
    afirmar('"Salvar condições" continua indisponível', await botaoSalvar().isDisabled());

    // ── 7. Corrigir e salvar ────────────────────────────────────────────
    console.log(`\n[7] Corrigidos, prazo e parcelas salvam como inteiros`);

    await prazo().fill("45");
    await parcelas().fill("4");
    afirmar(
      "os erros saem",
      (await textoDe("#quote-lead-time-error")) === null && (await textoDe("#quote-installments-error")) === null,
    );
    afirmar('"Salvar condições" volta', await botaoSalvar().isEnabled());
    const antesDeSalvar = gravacoes.length;
    releitura = aguardarReleitura(pagina);
    await botaoSalvar().click();
    await releitura;
    await assentar();
    const pedido = JSON.parse(gravacoes[antesDeSalvar] ?? "{}");
    afirmar(
      "uma gravação, com os inteiros",
      gravacoes.length === antesDeSalvar + 1 && pedido.leadTimeDays === 45 && pedido.installmentCount === 4,
      gravacoes[antesDeSalvar],
    );
    afirmar("salvo, Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());

    await abrirVersao(pagina, urlDaV1);
    afirmar("reaberta, o prazo é 45", (await prazo().inputValue()) === "45", await prazo().inputValue());
    afirmar("e as parcelas, 4", (await parcelas().inputValue()) === "4", await parcelas().inputValue());

    afirmar("console e rede limpos", erros.length === 0, erros.slice(0, 3).join(" | "));
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
  console.log("OK — inteiro inválido não entra ou fica inválido na tela, e o gravado não é apagado.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
