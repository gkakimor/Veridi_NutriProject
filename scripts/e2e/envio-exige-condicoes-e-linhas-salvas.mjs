import { criarCliente } from "./fixtures/cadastros.mjs";
import {
  adicionarLinha,
  criarProdutoDoProjeto,
  criarProjeto,
  criarVersao,
  gravarCondicoes,
  lerVersaoDoServidor,
  linhaDoProduto,
} from "./fixtures/comercial.mjs";
import {
  abrirVersao,
  aguardarReleitura,
  enviarAoCliente,
  rotaDaVersao,
  rotaDoProjeto,
  voltarAoProjeto,
} from "./fixtures/comercial-ui.mjs";
import { carimbar, criarRun } from "./fixtures/run.mjs";
import { abrirNavegador, API, WEB } from "./lib/browser.mjs";
import { textoDoPdfDaTela } from "./lib/pdf.mjs";

/**
 * Enviar exige condições E linhas salvas — QUOTE-SEND-DIRTY-01 e
 * QUOTE-SEND-LINE-DRAFT-01 numa suíte só (decisão D do PO,
 * E2E-BASELINE-REDESIGN-WAVE-03), na página própria da versão.
 *
 * O envio congela o que está GRAVADO. Com uma condição alterada e não salva, ou
 * com uma linha mostrando um preço que o servidor não tem, a tela mostraria uma
 * coisa e o cliente receberia outra. A tela segura o envio nos dois casos, com o
 * motivo de cada um, sem auto-salvar e sem "enviar mesmo assim".
 *
 * Cenários, na mesma V1 e em sequência:
 *
 *   A. condição suja: validade alterada e não salva — envio indisponível, a
 *      mensagem das condições ligada ao botão, insistir não abre confirmação nem
 *      manda envio; adicionar e remover produto não liberam; salvar libera;
 *   B. linha suja: preço novo digitado segura o envio antes de sair do campo; o
 *      salvamento dele cai (503 provocado na própria requisição da tela, uma
 *      vez) — o campo fica com o preço novo, o erro aparece, o servidor segue
 *      com o antigo, a mensagem dos produtos está ligada ao botão e insistir não
 *      envia; a nova tentativa grava, sem recarregar;
 *   C. salvo tudo, o envio pede confirmação e vai uma vez só;
 *   E. enviada, a versão reaberta mostra as condições como leitura — sem campo —
 *      e a linha com o preço novo; a ficha lista a validade nova;
 *   D. o PDF nasce da versão da página: com a V2 já existindo, o da V1 traz a V1
 *      com a validade e o preço congelados, e o da V2 traz a V2.
 *
 * Cliente, Projeto, os dois produtos e a V1 com linha e validade nascem por API;
 * a V2 do cenário D também. Toda mutação sob teste é da tela; a rede é observada
 * e só a atualização de linha do cenário B é derrubada.
 *
 *   pnpm e2e:run --suites=envio-exige-condicoes-e-linhas-salvas
 */

const run = criarRun();

const VALIDADE_SALVA = "2099-09-20";
const VALIDADE_SALVA_BR = "20/09/2099";
const VALIDADE_NOVA = "2099-10-31";
const VALIDADE_NOVA_BR = "31/10/2099";
const VALIDADE_DA_V2 = "2099-11-30";
const VALIDADE_DA_V2_BR = "30/11/2099";
const PRECO_ANTIGO = "10,00";
const PRECO_NOVO = "12,50";
/** 1.000 × R$ 12,50 e 1.000 × R$ 10,00. */
const TOTAL_NOVO = "12.500,00";
const TOTAL_ANTIGO = "10.000,00";

const ESPERA_CONDICOES = {
  titulo: "Salve as alterações das condições antes de enviar o orçamento.",
  complemento: "O envio usa somente as condições já salvas.",
};
const ESPERA_PRODUTOS = {
  titulo: "Salve as alterações dos produtos antes de enviar o orçamento.",
  complemento: "O envio usa somente os valores já salvos.",
};
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
  const { contexto, pagina, api, erros, errosHttp, esperarErroHttp, fechar } = await abrirNavegador();

  /** Toda requisição de ENVIO que sair do navegador — observada, nunca feita pela suíte. */
  const envios = [];
  pagina.on("request", (requisicao) => {
    const url = requisicao.url();
    if (
      requisicao.method() === "POST" &&
      url.startsWith(`${API}/`) &&
      /^\/quote-versions\/[0-9a-f-]{36}\/send$/.test(new URL(url).pathname)
    ) {
      envios.push(url);
    }
  });

  /*
   * A falha do cenário B: enquanto ligada, a PRÓXIMA atualização de linha que a
   * tela fizer recebe 503, uma vez, sem chegar ao servidor. A resposta leva o
   * CORS da Web — sem ele o navegador bloquearia e a tela veria erro de rede.
   */
  let falharProximaAtualizacao = false;
  let falhasProvocadas = 0;
  esperarErroHttp({ status: 503, metodo: "PATCH", caminho: /^\/quote-lines\/[0-9a-f-]{36}$/ });
  await pagina.route(
    (url) => url.href.startsWith(`${API}/quote-lines/`),
    async (rota) => {
      if (falharProximaAtualizacao && rota.request().method() === "PATCH") {
        falharProximaAtualizacao = false;
        falhasProvocadas += 1;
        await rota.fulfill({
          status: 503,
          contentType: "application/json",
          headers: { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" },
          body: JSON.stringify({ error: "service_unavailable", message: FALHA_PROVOCADA }),
        });
        return;
      }
      await rota.continue();
    },
  );

  const assentar = () => pagina.waitForTimeout(400);
  const botaoEnviar = () =>
    pagina.locator(".quote-workspace").getByRole("button", { name: "Enviar ao cliente", exact: true });
  const botaoSalvar = () => pagina.getByRole("button", { name: "Salvar condições", exact: true });
  const aviso = () => pagina.locator("#quote-send-pending");
  const textoDoAviso = async () => ((await aviso().count()) ? (await aviso().innerText()).trim() : null);
  const situacao = async () => (await pagina.locator(".quote-conditions .form-status").innerText()).trim();
  const statusNoTitulo = async () => (await pagina.locator(".doc-title > span").first().innerText()).trim();
  const erroNaTela = () => pagina.locator(".form-alert", { hasText: FALHA_PROVOCADA });

  /** Envio indisponível, com o motivo certo ligado ao botão. */
  const conferirBloqueio = async (momento, motivo) => {
    afirmar(`${momento}: "Enviar ao cliente" indisponível`, await botaoEnviar().isDisabled());
    afirmar(
      `${momento}: a mensagem diz o que fazer`,
      (await textoDoAviso()) === `${motivo.titulo} ${motivo.complemento}`,
      (await textoDoAviso()) ?? "(sem mensagem)",
    );
    afirmar(
      `${momento}: a mensagem está ligada ao botão`,
      (await botaoEnviar().getAttribute("aria-describedby")) === "quote-send-pending",
    );
    afirmar(`${momento}: o botão diz o motivo`, (await botaoEnviar().getAttribute("title")) === motivo.titulo);
  };

  /** O clique de quem insiste: `force` ignora a espera por botão habilitado. */
  const insistirNoEnvio = async (momento) => {
    await botaoEnviar()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await pagina.waitForTimeout(800);
    afirmar(`${momento}: nenhuma confirmação de envio se abriu`, (await pagina.getByRole("alertdialog").count()) === 0);
    afirmar(`${momento}: nenhuma requisição de envio saiu do navegador`, envios.length === 0, `${envios.length}`);
  };

  try {
    // ── 0. Massa e a página da V1 ───────────────────────────────────────
    console.log(`\n[0] Cliente, Projeto, dois produtos e V1 com linha e validade, por API (${run.runId})`);

    const cliente = await criarCliente(api, run, { nome: carimbar(run, "Cliente Envio") });
    const projeto = await criarProjeto(api, run, { cliente, nome: carimbar(run, "Projeto Envio") });
    const produtoA = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto A Envio") });
    const produtoB = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto B Envio") });
    const v1 = await criarVersao(api, { projeto });
    const comLinha = await adicionarLinha(api, { versao: v1, produto: produtoA, quantidade: "1000", preco: "10" });
    await gravarCondicoes(api, { versao: v1, condicoes: { validUntil: VALIDADE_SALVA } });
    const linhaA = linhaDoProduto(comLinha, produtoA);

    const urlDaV1 = `${WEB}${rotaDaVersao(v1.id, { voltar: rotaDoProjeto(projeto.id) })}`;
    const aberta = await abrirVersao(pagina, urlDaV1);
    afirmar("a página abre a V1 pelo id", aberta.id === v1.id && aberta.rotulo === v1.rotulo, aberta.rotulo);
    afirmar("com tudo salvo, o formulário diz Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());
    afirmar('com tudo salvo, "Enviar ao cliente" está disponível', await botaoEnviar().isEnabled());
    afirmar("com tudo salvo, não há aviso de envio", (await aviso().count()) === 0);

    const campoPreco = () => pagina.getByLabel(`Preço unitário de ${produtoA.codigo}`);
    afirmar("a linha mostra o preço gravado", (await campoPreco().inputValue()) === PRECO_ANTIGO, await campoPreco().inputValue());

    // ── A. Condição suja ────────────────────────────────────────────────
    console.log(`\n[A] Condição suja: validade alterada e NÃO salva`);

    await pagina.locator("#quote-valid-until").fill(VALIDADE_NOVA);
    afirmar("o formulário diz que há alteração pendente", (await situacao()) === "Alterações não salvas", await situacao());
    await conferirBloqueio("com a validade por salvar", ESPERA_CONDICOES);
    await insistirNoEnvio("com a validade por salvar");
    afirmar("a V1 continua em rascunho", (await statusNoTitulo()) === "Rascunho", await statusNoTitulo());

    const seletorDeProduto = pagina.locator("#quote-add-product");
    let releitura = aguardarReleitura(pagina);
    await seletorDeProduto.selectOption({ label: `${produtoB.codigo} · ${produtoB.nome}` });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).click();
    await releitura;
    await pagina.getByLabel(`Quantidade de ${produtoB.codigo}`).waitFor({ timeout: 25000 });
    await assentar();
    afirmar(
      "depois de adicionar produto, a validade digitada continua",
      (await pagina.locator("#quote-valid-until").inputValue()) === VALIDADE_NOVA,
    );
    await conferirBloqueio("depois de adicionar produto", ESPERA_CONDICOES);

    releitura = aguardarReleitura(pagina);
    await pagina
      .locator("tr", { has: pagina.getByLabel(`Quantidade de ${produtoB.codigo}`) })
      .getByRole("button", { name: "Remover", exact: true })
      .click();
    await releitura;
    await pagina.getByLabel(`Quantidade de ${produtoB.codigo}`).waitFor({ state: "detached", timeout: 25000 });
    await assentar();
    await conferirBloqueio("depois de remover produto", ESPERA_CONDICOES);

    releitura = aguardarReleitura(pagina);
    await botaoSalvar().click();
    await releitura;
    await assentar();
    afirmar("salvo, o formulário diz Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());
    afirmar('salvo, "Enviar ao cliente" volta a ficar disponível', await botaoEnviar().isEnabled());
    afirmar("salvo, o aviso sai da tela", (await aviso().count()) === 0);
    afirmar("salvar não enviou nada", envios.length === 0, `${envios.length}`);
    afirmar(
      "o servidor tem a validade nova",
      ((await lerVersaoDoServidor(api, { versao: v1 })).validade ?? "").startsWith(VALIDADE_NOVA),
    );

    // ── B. Linha suja ───────────────────────────────────────────────────
    console.log(`\n[B] Linha suja: o preço novo não foi gravado`);

    await campoPreco().fill(PRECO_NOVO);
    afirmar("antes de sair do campo, o envio já está indisponível", await botaoEnviar().isDisabled());

    falharProximaAtualizacao = true;
    const resposta503 = pagina.waitForResponse((r) => r.status() === 503, { timeout: 25000 });
    resposta503.catch(() => {});
    await campoPreco().blur();
    await resposta503;
    await erroNaTela().first().waitFor({ timeout: 25000 });
    afirmar("a falha foi provocada uma vez", falhasProvocadas === 1, `${falhasProvocadas}`);
    afirmar("o erro aparece na tela", true, FALHA_PROVOCADA);
    afirmar("o campo continua com o preço novo", (await campoPreco().inputValue()) === PRECO_NOVO, await campoPreco().inputValue());
    await conferirBloqueio("com o preço que não foi gravado", ESPERA_PRODUTOS);
    await insistirNoEnvio("com o preço que não foi gravado");
    const noServidor = linhaDoProduto(await lerVersaoDoServidor(api, { versao: v1 }), produtoA);
    afirmar("o servidor segue com o preço antigo", Number(noServidor.preco) === 10, noServidor.preco);

    releitura = aguardarReleitura(pagina);
    await campoPreco().focus();
    await campoPreco().blur();
    await releitura;
    await assentar();
    afirmar('gravado, "Enviar ao cliente" volta a ficar disponível', await botaoEnviar().isEnabled());
    afirmar("gravado, o aviso sai da tela", (await aviso().count()) === 0);
    afirmar("gravado, o erro sai da tela", (await erroNaTela().count()) === 0);
    afirmar("gravar a linha não enviou nada", envios.length === 0, `${envios.length}`);
    const gravada = linhaDoProduto(await lerVersaoDoServidor(api, { versao: v1 }), produtoA);
    afirmar("a nova tentativa gravou o preço novo, sem recarregar", Number(gravada.preco) === 12.5, gravada.preco);

    // ── C. Envio ────────────────────────────────────────────────────────
    console.log(`\n[C] Tudo salvo: o envio pede confirmação e vai uma vez`);

    const envio = await enviarAoCliente(pagina);
    afirmar("a confirmação pergunta antes de enviar", envio.pergunta === "Enviar esta proposta ao cliente?", envio.pergunta);
    afirmar("o envio é aceito", envio.status === 200, `${envio.status}`);
    afirmar("uma requisição de envio, e só uma", envios.length === 1, `${envios.length}`);
    await pagina.waitForFunction(() => document.querySelector(".doc-title > span")?.textContent?.trim() === "Enviado", null, {
      timeout: 25000,
    });
    afirmar("a V1 passou a Enviado", (await statusNoTitulo()) === "Enviado", await statusNoTitulo());

    // ── E. Versão enviada em leitura ────────────────────────────────────
    console.log(`\n[E] Enviada, a versão reaberta é leitura`);

    await abrirVersao(pagina, urlDaV1);
    afirmar("sem campo de validade", (await pagina.locator("#quote-valid-until").count()) === 0);
    afirmar('sem "Salvar condições"', (await botaoSalvar().count()) === 0);
    const validadeLida = await pagina.evaluate(() => {
      const leitura = document.querySelector("dl.quote-conditions__read");
      const rotulo = [...(leitura?.querySelectorAll("dt") ?? [])].find((dt) => dt.textContent.trim() === "Validade da proposta");
      return rotulo?.nextElementSibling?.textContent?.trim() ?? null;
    });
    afirmar("as condições são texto, com a validade nova", validadeLida === VALIDADE_NOVA_BR, validadeLida ?? "(sem leitura)");
    afirmar("a linha não tem campo de preço", (await campoPreco().count()) === 0);
    const celulas = (await pagina.locator(`tr#quote-line-${linhaA.id} td`).allInnerTexts()).map((texto) =>
      texto.replace(/\s+/g, " ").trim(),
    );
    afirmar("a linha mostra o preço novo", (celulas[4] ?? "").includes(PRECO_NOVO), celulas[4]);
    afirmar("e o total do preço novo", (celulas[5] ?? "").includes(TOTAL_NOVO), celulas[5]);

    await voltarAoProjeto(pagina);
    const naFicha = (
      await pagina
        .locator("tbody tr", { has: pagina.locator("td.is-code", { hasText: v1.rotulo }) })
        .locator("td")
        .allInnerTexts()
    ).map((texto) => texto.replace(/\s+/g, " ").trim());
    afirmar(
      "na lista de versões da ficha, a validade é a nova",
      (naFicha[4] ?? "").includes(VALIDADE_NOVA_BR) && !(naFicha[4] ?? "").includes(VALIDADE_SALVA_BR),
      naFicha[4],
    );
    afirmar("e a V1 está Enviado", (naFicha[5] ?? "").includes("Enviado"), naFicha[5]);

    // ── D. PDF da versão certa ──────────────────────────────────────────
    console.log(`\n[D] O PDF nasce da versão da página`);

    const v2 = await criarVersao(api, { projeto });
    await gravarCondicoes(api, { versao: v2, condicoes: { validUntil: VALIDADE_DA_V2 } });

    const pdfDaPagina = async (url) => {
      const versao = await abrirVersao(pagina, url);
      const [impresso] = await Promise.all([
        contexto.waitForEvent("page", { timeout: 25000 }),
        pagina.getByRole("button", { name: "PDF", exact: true }).click(),
      ]);
      const texto = await textoDoPdfDaTela(impresso);
      const caminho = new URL(impresso.url()).pathname;
      await impresso.close();
      return { versao, texto, caminho };
    };

    const daV1 = await pdfDaPagina(urlDaV1);
    afirmar("o PDF da V1 é a rota de impressão da V1", daV1.caminho === `/comercial/orcamentos/${v1.id}/imprimir`, daV1.caminho);
    afirmar("traz a V1", daV1.texto.includes(v1.rotulo), v1.rotulo);
    afirmar("e não a V2", !daV1.texto.includes(v2.rotulo), v2.rotulo);
    afirmar("com a validade congelada no envio", daV1.texto.includes(VALIDADE_NOVA_BR));
    afirmar(
      "sem a validade anterior nem a da V2",
      !daV1.texto.includes(VALIDADE_SALVA_BR) && !daV1.texto.includes(VALIDADE_DA_V2_BR),
    );
    afirmar("com o preço e o total novos", daV1.texto.includes(PRECO_NOVO) && daV1.texto.includes(TOTAL_NOVO));
    afirmar("sem o total do preço antigo", !daV1.texto.includes(TOTAL_ANTIGO));

    const daV2 = await pdfDaPagina(`${WEB}${rotaDaVersao(v2.id, { voltar: rotaDoProjeto(projeto.id) })}`);
    afirmar("o PDF da V2 é a rota de impressão da V2", daV2.caminho === `/comercial/orcamentos/${v2.id}/imprimir`, daV2.caminho);
    afirmar(
      "traz a V2 com a validade dela, não a da V1",
      daV2.texto.includes(v2.rotulo) && daV2.texto.includes(VALIDADE_DA_V2_BR) && !daV2.texto.includes(VALIDADE_NOVA_BR),
    );

    const provocados = errosHttp.filter((erro) => erro.status === 503);
    afirmar(
      "console e rede limpos — só o 503 provocado, declarado",
      erros.length === 0 && provocados.length === falhasProvocadas,
      [...erros.slice(0, 3), `503 × ${provocados.length}`].join(" | "),
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
  console.log("OK — condição ou linha por salvar seguram o envio; o que se envia e se imprime é o salvo.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
