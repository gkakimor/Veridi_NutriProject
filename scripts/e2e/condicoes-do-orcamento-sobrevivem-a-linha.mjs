import { criarCliente } from "./fixtures/cadastros.mjs";
import { criarProdutoDoProjeto, criarProjeto, criarVersao, lerVersaoDoServidor } from "./fixtures/comercial.mjs";
import {
  abrirVersao,
  aguardarReleitura,
  criarNovaVersao,
  enviarAoCliente,
  esperarVersaoNaTela,
  idDaRota,
  ROTA_DA_VERSAO,
  rotaDaVersao,
  rotaDoProjeto,
  voltarAoProjeto,
} from "./fixtures/comercial-ui.mjs";
import { carimbar, criarRun } from "./fixtures/run.mjs";
import { abrirNavegador, API, WEB } from "./lib/browser.mjs";

/**
 * Condição comercial digitada e não salva sobrevive à mutação da linha —
 * QUOTE-DRAFT-STATE-01, na página própria da versão
 * (E2E-BASELINE-REDESIGN-WAVE-03).
 *
 * O defeito: na proposta em rascunho, digitar a validade e o desconto sem clicar
 * em "Salvar condições" e em seguida adicionar um produto fazia o formulário
 * voltar ao gravado — sem aviso, e com o botão de salvar desabilitado.
 *
 * O que esta suíte prova, clicando em `/comercial/orcamentos/:id`:
 *
 *   1. as condições digitadas continuam nos campos depois de ADICIONAR produto,
 *      EDITAR quantidade e preço, REMOVER uma linha e de uma edição de linha
 *      RECUSADA — com "Alterações não salvas" e "Salvar condições" habilitado;
 *   2. nada foi gravado às escondidas: a mesma versão numa segunda aba mostra as
 *      condições antigas;
 *   3. salvar grava, e reabrir a versão mostra o gravado;
 *   4. com a V2 criada pela ficha e condição suja nela, trocar para a V1 passa
 *      pela guarda de saída (decisão E do PO): "Continuar editando" fica na V2
 *      com o digitado e sem gravar; "Sair sem salvar" abre a V1, que mostra as
 *      condições DELA, em leitura; de volta à V2, o gravado — o rascunho foi
 *      descartado, como a guarda avisou.
 *
 * Cliente, Projeto, os dois produtos e a V1 vazia nascem por API; a V2 nasce
 * pela ficha. Condições, linhas, envio e troca de versão, pela tela.
 *
 *   pnpm e2e:run --suites=condicoes-do-orcamento-sobrevivem-a-linha
 */

const run = criarRun();

const VALIDADE = "2099-09-20";
const VALIDADE_BR = "20/09/2099";
const DESCONTO = "7,5";
const DESCONTO_LIDO = "7,5%";
const OBSERVACAO = `Frete por conta do cliente ${run.carimbo}`;
const PARCELAS = "3";

/** O rascunho da V2, que NÃO pode aparecer na V1 nem sobreviver ao "Sair sem salvar". */
const VALIDADE_V2 = "2099-10-15";
const VALIDADE_V2_BR = "15/10/2099";
const DESCONTO_V2 = "3";

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

  const assentar = () => pagina.waitForTimeout(400);
  const valorDe = (seletor) => pagina.locator(seletor).inputValue();
  const situacao = async () => (await pagina.locator(".quote-conditions .form-status").innerText()).trim();
  const salvarHabilitado = () => pagina.getByRole("button", { name: "Salvar condições", exact: true }).isEnabled();

  /** As cinco condições digitadas, lidas da tela. */
  const condicoesNaTela = async () => ({
    validade: await valorDe("#quote-valid-until"),
    desconto: await valorDe("#quote-discount"),
    observacao: await valorDe("#quote-notes"),
    forma: await valorDe("#quote-payment-method"),
    parcelas: (await pagina.locator("#quote-installments").count()) ? await valorDe("#quote-installments") : null,
  });

  /** O rascunho continua inteiro, pendente, e salvável. */
  const conferirRascunho = async (momento) => {
    const tela = await condicoesNaTela();
    afirmar(`${momento}: validade digitada continua`, tela.validade === VALIDADE, tela.validade);
    afirmar(`${momento}: desconto digitado continua`, tela.desconto === DESCONTO, tela.desconto);
    afirmar(`${momento}: observação digitada continua`, tela.observacao === OBSERVACAO);
    afirmar(`${momento}: forma de pagamento continua Parcelado`, tela.forma === "INSTALLMENTS", tela.forma);
    afirmar(`${momento}: parcelas continuam`, tela.parcelas === PARCELAS, String(tela.parcelas));
    const aviso = await situacao();
    afirmar(`${momento}: formulário diz que há alteração pendente`, aviso === "Alterações não salvas", aviso);
    afirmar(`${momento}: "Salvar condições" continua habilitado`, await salvarHabilitado());
  };

  /** Uma condição da versão em leitura (`dl.quote-conditions__read`). */
  const condicaoLida = (rotulo) =>
    pagina.evaluate((alvo) => {
      const leitura = document.querySelector("dl.quote-conditions__read");
      const dt = [...(leitura?.querySelectorAll("dt") ?? [])].find((n) => n.textContent.trim() === alvo);
      return dt?.nextElementSibling?.textContent?.trim() ?? null;
    }, rotulo);

  /** Toda atualização de linha que sair do navegador. */
  const atualizacoesDeLinha = [];
  pagina.on("request", (requisicao) => {
    const url = requisicao.url();
    if (requisicao.method() === "PATCH" && url.startsWith(`${API}/quote-lines/`)) atualizacoesDeLinha.push(url);
  });

  try {
    // ── 0. Massa e a V1 ─────────────────────────────────────────────────
    console.log(`\n[0] Cliente, Projeto, dois produtos e V1 vazia, por API (${run.runId})`);

    const cliente = await criarCliente(api, run, { nome: carimbar(run, "Cliente Condicoes") });
    const projeto = await criarProjeto(api, run, { cliente, nome: carimbar(run, "Projeto Condicoes") });
    const produtoA = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto A Condicoes") });
    const produtoB = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto B Condicoes") });
    const v1 = await criarVersao(api, { projeto });

    const urlDaV1 = `${WEB}${rotaDaVersao(v1.id, { voltar: rotaDoProjeto(projeto.id) })}`;
    const aberta = await abrirVersao(pagina, urlDaV1);
    afirmar("a página abre a V1 pelo id", aberta.id === v1.id && aberta.rotulo === v1.rotulo, aberta.rotulo);

    // ── 1. Condições digitadas SEM salvar ───────────────────────────────
    console.log(`\n[1] Condições digitadas, sem salvar`);

    afirmar("a V1 nasce sem validade", (await valorDe("#quote-valid-until")) === "");
    await pagina.locator("#quote-valid-until").fill(VALIDADE);
    await pagina.locator("#quote-discount").fill(DESCONTO);
    await pagina.locator("#quote-notes").fill(OBSERVACAO);
    await pagina.locator("#quote-payment-method").selectOption("INSTALLMENTS");
    await pagina.locator("#quote-installments").fill(PARCELAS);
    afirmar("antes da linha, o formulário se diz pendente", (await situacao()) === "Alterações não salvas");

    const seletorDeProduto = pagina.locator("#quote-add-product");
    const quantidadeDe = (produto) => pagina.getByLabel(`Quantidade de ${produto.codigo}`);

    // ── 2. Adicionar produto ────────────────────────────────────────────
    console.log(`\n[2] Adicionar produto`);

    let releitura = aguardarReleitura(pagina);
    await seletorDeProduto.selectOption({ label: `${produtoA.codigo} · ${produtoA.nome}` });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).click();
    await releitura;
    await quantidadeDe(produtoA).waitFor({ timeout: 25000 });
    await assentar();
    await conferirRascunho("depois de adicionar produto");

    // ── 3. Editar quantidade e preço ────────────────────────────────────
    console.log(`\n[3] Editar quantidade e preço da linha`);

    releitura = aguardarReleitura(pagina);
    await quantidadeDe(produtoA).fill("1000");
    await quantidadeDe(produtoA).blur();
    await releitura;
    await assentar();
    await conferirRascunho("depois de editar a quantidade");

    releitura = aguardarReleitura(pagina);
    await pagina.getByLabel(`Preço unitário de ${produtoA.codigo}`).fill("12,50");
    await pagina.getByLabel(`Preço unitário de ${produtoA.codigo}`).blur();
    await releitura;
    await assentar();
    await conferirRascunho("depois de editar o preço");

    // ── 4. Adicionar e remover outra linha ──────────────────────────────
    console.log(`\n[4] Adicionar e remover uma segunda linha`);

    releitura = aguardarReleitura(pagina);
    await seletorDeProduto.selectOption({ label: `${produtoB.codigo} · ${produtoB.nome}` });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).click();
    await releitura;
    await quantidadeDe(produtoB).waitFor({ timeout: 25000 });
    await assentar();

    releitura = aguardarReleitura(pagina);
    await pagina
      .locator("tr", { has: quantidadeDe(produtoB) })
      .getByRole("button", { name: "Remover", exact: true })
      .click();
    await releitura;
    await quantidadeDe(produtoB).waitFor({ state: "detached", timeout: 25000 });
    await assentar();
    await conferirRascunho("depois de remover a linha");

    // ── 5. Edição de linha recusada ─────────────────────────────────────
    console.log(`\n[5] Edição de linha recusada`);

    // `1.234` entra no campo e não se lê: milhar ou decimal? A tela recusa sem gravar.
    const antesDaRecusa = atualizacoesDeLinha.length;
    await quantidadeDe(produtoA).fill("1.234");
    await quantidadeDe(produtoA).blur();
    const recusa = pagina.locator(".quote-workspace > .form-alert");
    await recusa.waitFor({ timeout: 25000 });
    afirmar("a linha recusada diz por quê", (await recusa.innerText()).includes(produtoA.codigo), (await recusa.innerText()).trim());
    afirmar("e nada foi gravado", atualizacoesDeLinha.length === antesDaRecusa, `${atualizacoesDeLinha.length - antesDaRecusa} PATCH`);
    await conferirRascunho("depois da linha recusada");

    // Voltar ao valor que o servidor já tem não é mudança: nenhuma atualização sai.
    const antesDaCorrecao = atualizacoesDeLinha.length;
    await quantidadeDe(produtoA).fill("1000");
    await quantidadeDe(produtoA).blur();
    await pagina.waitForTimeout(1500);
    afirmar(
      "devolver a quantidade gravada não manda atualização de linha",
      atualizacoesDeLinha.length === antesDaCorrecao,
      `${atualizacoesDeLinha.length - antesDaCorrecao} PATCH`,
    );
    await conferirRascunho("depois de corrigir a linha");

    // ── 6. Nada foi gravado às escondidas ───────────────────────────────
    console.log(`\n[6] Segunda aba: o servidor ainda tem as condições antigas`);

    const segunda = await contexto.newPage();
    await abrirVersao(segunda, urlDaV1);
    const naOutraAba = {
      validade: await segunda.locator("#quote-valid-until").inputValue(),
      desconto: await segunda.locator("#quote-discount").inputValue(),
      forma: await segunda.locator("#quote-payment-method").inputValue(),
    };
    await segunda.close();
    afirmar("a linha não gravou a validade", naOutraAba.validade === "", naOutraAba.validade);
    afirmar("a linha não gravou o desconto", naOutraAba.desconto === "", naOutraAba.desconto);
    afirmar("a linha não gravou a forma de pagamento", naOutraAba.forma === "CASH", naOutraAba.forma);
    await conferirRascunho("a primeira aba, depois da segunda");

    // ── 7. Salvar ───────────────────────────────────────────────────────
    console.log(`\n[7] Salvar condições`);

    releitura = aguardarReleitura(pagina);
    await pagina.getByRole("button", { name: "Salvar condições", exact: true }).click();
    await releitura;
    await assentar();
    afirmar("salvo, o formulário diz Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());
    afirmar('salvo, "Salvar condições" fica desabilitado', !(await salvarHabilitado()));
    const alertas = await pagina.locator(".form-alert").allInnerTexts();
    afirmar("salvar não produziu recusa", alertas.length === 0, alertas.join(" | "));

    // ── 8. Reabrir ──────────────────────────────────────────────────────
    console.log(`\n[8] Reabrir a versão`);

    await abrirVersao(pagina, urlDaV1);
    const reaberta = await condicoesNaTela();
    afirmar("reaberta: validade gravada", reaberta.validade === VALIDADE, reaberta.validade);
    afirmar("reaberta: desconto gravado", reaberta.desconto === DESCONTO, reaberta.desconto);
    afirmar("reaberta: observação gravada", reaberta.observacao === OBSERVACAO);
    afirmar("reaberta: forma de pagamento gravada", reaberta.forma === "INSTALLMENTS", reaberta.forma);
    afirmar("reaberta: parcelas gravadas", reaberta.parcelas === PARCELAS, String(reaberta.parcelas));
    afirmar("reaberta: Tudo salvo", (await situacao()) === "Tudo salvo");
    afirmar("reaberta: a linha continua uma só", (await pagina.getByLabel(/^Quantidade de /).count()) === 1);

    // ── 9. Troca de versão com a guarda ─────────────────────────────────
    console.log(`\n[9] V2 pela ficha, condição suja e troca para a V1`);

    const envio = await enviarAoCliente(pagina);
    afirmar("a V1 é enviada", envio.status === 200, `${envio.status}`);
    await voltarAoProjeto(pagina);
    const v2 = await criarNovaVersao(pagina, { botao: "Criar nova versão" });
    afirmar(
      "a ficha cria a V2 e abre a página dela",
      v2.id === v2.resposta.id && v2.id !== v1.id && / · V2$/.test(v2.rotulo ?? ""),
      v2.rotulo,
    );

    await pagina.locator("#quote-valid-until").fill(VALIDADE_V2);
    await pagina.locator("#quote-discount").fill(DESCONTO_V2);
    afirmar("V2 com rascunho pendente", (await situacao()) === "Alterações não salvas", await situacao());

    const linkDaVersao = (rotulo) => pagina.locator("nav.quote-versions-nav a", { hasText: rotulo });
    const guarda = pagina.getByRole("alertdialog");

    await linkDaVersao(v1.rotulo).click();
    await guarda.waitFor({ timeout: 25000 });
    afirmar("trocar de versão com condição suja passa pela guarda", (await guarda.locator("#confirm-dialog-title").innerText()).trim() === "Sair sem salvar?");
    afirmar("a guarda diz o que se perde", (await guarda.innerText()).includes("alterações não salvas neste orçamento"));
    afirmar("enquanto pergunta, a página continua na V2", idDaRota(pagina.url(), ROTA_DA_VERSAO) === v2.id, pagina.url());

    await guarda.getByRole("button", { name: "Continuar editando", exact: true }).click();
    await guarda.waitFor({ state: "detached", timeout: 25000 });
    afirmar('"Continuar editando" fica na V2', idDaRota(pagina.url(), ROTA_DA_VERSAO) === v2.id, pagina.url());
    afirmar(
      "com o digitado intacto",
      (await valorDe("#quote-valid-until")) === VALIDADE_V2 && (await valorDe("#quote-discount")) === DESCONTO_V2,
    );
    afirmar("e ainda pendente", (await situacao()) === "Alterações não salvas", await situacao());
    afirmar(
      "continuar editando não gravou nada",
      (await lerVersaoDoServidor(api, { versao: v2 })).validade === null,
    );

    await linkDaVersao(v1.rotulo).click();
    await guarda.waitFor({ timeout: 25000 });
    await guarda.getByRole("button", { name: "Sair sem salvar", exact: true }).click();
    const deVoltaNaV1 = await esperarVersaoNaTela(pagina, { tituloAnterior: v2.rotulo });
    afirmar('"Sair sem salvar" abre a V1', deVoltaNaV1.id === v1.id, deVoltaNaV1.rotulo);
    afirmar("a V1 enviada é leitura, sem campo", (await pagina.locator("#quote-valid-until").count()) === 0);
    const validadeDaV1 = await condicaoLida("Validade da proposta");
    const descontoDaV1 = await condicaoLida("Desconto");
    afirmar("a V1 mostra a validade DELA", validadeDaV1 === VALIDADE_BR, validadeDaV1);
    afirmar("a V1 mostra o desconto DELA", descontoDaV1 === DESCONTO_LIDO, descontoDaV1);
    afirmar(
      "o rascunho da V2 não aparece na V1",
      validadeDaV1 !== VALIDADE_V2_BR && !(descontoDaV1 ?? "").startsWith(`${DESCONTO_V2}%`),
    );

    await linkDaVersao(v2.rotulo).click();
    const deVoltaNaV2 = await esperarVersaoNaTela(pagina, { tituloAnterior: v1.rotulo });
    afirmar("de volta à V2 pela lista de versões, sem guarda", deVoltaNaV2.id === v2.id, deVoltaNaV2.rotulo);
    afirmar(
      "a V2 mostra o gravado: o rascunho foi descartado, como a guarda avisou",
      (await valorDe("#quote-valid-until")) === "" && (await valorDe("#quote-discount")) === DESCONTO,
      `validade "${await valorDe("#quote-valid-until")}", desconto "${await valorDe("#quote-discount")}"`,
    );
    afirmar("e Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());

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
  console.log("OK — o digitado nas condições sobrevive às linhas, só o Salvar grava, e trocar de versão passa pela guarda.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
