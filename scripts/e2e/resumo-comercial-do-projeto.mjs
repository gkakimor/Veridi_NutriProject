import { criarCliente } from "./fixtures/cadastros.mjs";
import { criarProdutoDoProjeto, criarProjeto } from "./fixtures/comercial.mjs";
import {
  aguardarReleitura,
  criarNovaVersao,
  enviarAoCliente,
  esperarProjetoNaTela,
  esperarVersaoNaTela,
  rotaDoProjeto,
  voltarAoProjeto,
} from "./fixtures/comercial-ui.mjs";
import { carimbar, criarRun } from "./fixtures/run.mjs";
import { abrirNavegador, WEB } from "./lib/browser.mjs";

/**
 * O resumo comercial na ficha do Projeto — PROJECT-COMMERCIAL-SUMMARY-01, com o
 * orçamento editado e enviado na página própria da versão
 * (E2E-BASELINE-REDESIGN-WAVE-03).
 *
 * A coluna Comercial do bloco Resumo responde, sem abrir as versões: em que pé
 * está a negociação, quanto vale a proposta, o que ela cobre e quando foi
 * comunicada. Ela é LEITURA: as condições se editam na página da versão, e a
 * suíte nunca procura campo de condição na ficha.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. um Projeto sem orçamento já mostra a coluna Comercial, vazia e legível;
 *   2. a V1 criada pela ficha, com produto, quantidade, preço e validade na
 *      página dela: a ficha mostra o rascunho, com valor e itens e SEM data de
 *      envio;
 *   3. enviada a V1 na página dela, a ficha mostra Enviado e a data;
 *   4. criada a V2 em rascunho, o último orçamento é a V2 e a última proposta
 *      ENVIADA continua a V1, em linha própria — o rótulo de uma versão nunca
 *      leva a data da outra;
 *   5. a condição parcelada mais longa, gravada na V2, aparece por extenso;
 *   6. o bloco cabe em 390px, empilhado, sem rolagem própria.
 *
 * Cliente, Projeto e Produto nascem por API; versões, linhas, condições e envio,
 * pela tela.
 *
 *   pnpm e2e:run --suites=resumo-comercial-do-projeto
 */

const run = criarRun();

const QUANTIDADE = "1000";
const PRECO = "12,50";
/** 1.000 × R$ 12,50 — o total que o servidor devolve. */
const TOTAL_ESPERADO = "R$ 12.500,00";
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
  const { pagina, api, erros, fechar } = await abrirNavegador();

  /** O valor de um rótulo DENTRO da coluna Comercial. */
  const comercial = (rotulo) =>
    pagina.evaluate((texto) => {
      const bloco = document.querySelector(".project-commercial");
      if (!bloco) return null;
      const dt = [...bloco.querySelectorAll("dt")].find((n) => n.textContent.trim() === texto);
      // O espaço do "R$ 1.234,56" é não separável: normalizar deixa a comparação legível.
      return dt?.nextElementSibling?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    }, rotulo);

  const temRotulo = (rotulo) =>
    pagina.evaluate((texto) => {
      const bloco = document.querySelector(".project-commercial");
      return [...(bloco?.querySelectorAll("dt") ?? [])].some((n) => n.textContent.trim() === texto);
    }, rotulo);

  const assentar = () => pagina.waitForTimeout(400);

  /** Um campo da linha que grava ao sair, e a releitura que ele dispara. */
  const gravarCampoDaLinha = async (campo, valor) => {
    const releitura = aguardarReleitura(pagina);
    await campo.fill(valor);
    await campo.blur();
    await releitura;
    await assentar();
  };

  const salvarCondicoes = async () => {
    const releitura = aguardarReleitura(pagina);
    await pagina.getByRole("button", { name: "Salvar condições", exact: true }).click();
    await releitura;
    await assentar();
  };

  const abrirPelaFicha = async (rotulo) => {
    await pagina.getByRole("link", { name: `Abrir ${rotulo}`, exact: true }).click();
    return esperarVersaoNaTela(pagina);
  };

  try {
    // ── 0. Massa ────────────────────────────────────────────────────────
    console.log(`\n[0] Cliente, Projeto e Produto, por API (${run.runId})`);

    const cliente = await criarCliente(api, run, { nome: carimbar(run, "Cliente Resumo") });
    const projeto = await criarProjeto(api, run, { cliente, nome: carimbar(run, "Projeto Resumo") });
    const produto = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto Resumo") });

    // ── 1. Coluna Comercial sem nenhum orçamento ────────────────────────
    console.log(`\n[1] Ficha sem orçamento`);

    await pagina.goto(`${WEB}${rotaDoProjeto(projeto.id)}`);
    await esperarProjetoNaTela(pagina);
    afirmar("a coluna Comercial existe mesmo sem proposta", await temRotulo("Último orçamento"));
    afirmar(
      "situação do projeto aparece",
      (await comercial("Situação do projeto")) === "Aguardando",
      await comercial("Situação do projeto"),
    );
    afirmar("último orçamento é Nenhum", (await comercial("Último orçamento")) === "Nenhum");
    afirmar("valor da proposta é travessão", (await comercial("Valor da proposta")) === "—");
    afirmar("itens orçados é zero", (await comercial("Itens orçados")) === "0 produtos");
    afirmar("enviado em é travessão", (await comercial("Enviado em")) === "—");
    afirmar(
      "última atividade diz que nada foi enviado",
      (await comercial("Última atividade comercial")) === "Nenhum orçamento enviado",
    );
    afirmar("sem envio, não existe linha de última proposta enviada", (await temRotulo("Última proposta enviada")) === false);

    // ── 2. V1 em rascunho, montada na página dela ───────────────────────
    console.log(`\n[2] V1 criada pela ficha e montada na página da versão`);

    const v1 = await criarNovaVersao(pagina, { botao: "Criar nova versão" });
    afirmar("a ficha cria a V1 e abre a página dela", v1.id === v1.resposta.id && / · V1$/.test(v1.rotulo ?? ""), v1.rotulo);

    const releituraDaLinha = aguardarReleitura(pagina);
    await pagina.locator("#quote-add-product").selectOption({ label: `${produto.codigo} · ${produto.nome}` });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).click();
    await releituraDaLinha;
    const quantidade = pagina.getByLabel(`Quantidade de ${produto.codigo}`);
    const preco = pagina.getByLabel(`Preço unitário de ${produto.codigo}`);
    await quantidade.waitFor({ timeout: 25000 });
    await gravarCampoDaLinha(quantidade, QUANTIDADE);
    await gravarCampoDaLinha(preco, PRECO);
    await pagina.locator("#quote-valid-until").fill(VALIDADE);
    await salvarCondicoes();
    const alertas = await pagina.locator(".form-alert").allInnerTexts();
    afirmar("a versão gravou sem recusa", alertas.length === 0, alertas.join(" | "));

    await voltarAoProjeto(pagina);
    afirmar(
      "o último orçamento é a V1 em rascunho",
      /· V1 · Rascunho$/.test((await comercial("Último orçamento")) ?? ""),
      await comercial("Último orçamento"),
    );
    afirmar("o valor vem do total da versão", (await comercial("Valor da proposta")) === TOTAL_ESPERADO, await comercial("Valor da proposta"));
    afirmar("itens orçados conta o produto", (await comercial("Itens orçados")) === "1 produto", await comercial("Itens orçados"));
    afirmar("rascunho não tem data de envio", (await comercial("Enviado em")) === "—");
    afirmar("rascunho não cria linha de última proposta enviada", (await temRotulo("Última proposta enviada")) === false);

    // ── 3. Enviar a V1 ──────────────────────────────────────────────────
    console.log(`\n[3] V1 enviada na página dela`);

    const deNovoV1 = await abrirPelaFicha(v1.rotulo);
    afirmar("a ficha abre a V1 pela linha dela", deNovoV1.id === v1.id, deNovoV1.rotulo);
    afirmar("V1 enviada", (await enviarAoCliente(pagina)).status === 200);
    await voltarAoProjeto(pagina);

    afirmar(
      "o último orçamento é a V1 enviada",
      /· V1 · Enviado$/.test((await comercial("Último orçamento")) ?? ""),
      await comercial("Último orçamento"),
    );
    const enviadoEm = await comercial("Enviado em");
    afirmar("a data de envio aparece", /^\d{2}\/\d{2}\/\d{4}$/.test(enviadoEm ?? ""), enviadoEm);
    afirmar(
      "o valor continua o mesmo depois do envio",
      (await comercial("Valor da proposta")) === TOTAL_ESPERADO,
      await comercial("Valor da proposta"),
    );
    afirmar("a versão corrente É a enviada: não se repete a informação", (await temRotulo("Última proposta enviada")) === false);
    afirmar(
      "a última atividade é o envio da V1",
      (await comercial("Última atividade comercial")) === `Orçamento V1 enviado em ${enviadoEm}`,
      await comercial("Última atividade comercial"),
    );

    // ── 4. V2 em rascunho ───────────────────────────────────────────────
    console.log(`\n[4] V2 em rascunho, V1 enviada`);

    const v2 = await criarNovaVersao(pagina, { botao: "Criar nova versão" });
    afirmar("a ficha cria a V2 e abre a página dela", v2.id === v2.resposta.id && / · V2$/.test(v2.rotulo ?? ""), v2.rotulo);
    await voltarAoProjeto(pagina);

    const ultimo = await comercial("Último orçamento");
    const ultimaEnviada = await comercial("Última proposta enviada");
    afirmar("o último orçamento passou a ser a V2 em rascunho", /· V2 · Rascunho$/.test(ultimo ?? ""), ultimo);
    afirmar("a V2 NÃO herda a data de envio da V1", (await comercial("Enviado em")) === "—", await comercial("Enviado em"));
    afirmar(
      "a última proposta enviada continua sendo a V1, em linha própria",
      (ultimaEnviada ?? "").includes(v1.rotulo) && (ultimaEnviada ?? "").includes(enviadoEm),
      ultimaEnviada,
    );
    afirmar("a linha do último orçamento não carrega a data da V1", !(ultimo ?? "").includes(enviadoEm), ultimo);

    // ── 5. Condição parcelada ───────────────────────────────────────────
    console.log(`\n[5] Condição de pagamento parcelada, gravada na V2`);

    const deNovoV2 = await abrirPelaFicha(v2.rotulo);
    afirmar("a ficha abre a V2 pela linha dela", deNovoV2.id === v2.id, deNovoV2.rotulo);
    // A V2 copia a linha da V1 sem preço: enviada não é acordo aceito.
    await preco.waitFor({ timeout: 25000 });
    afirmar("a V2 nasce com a linha, sem preço", (await preco.inputValue()) === "", await preco.inputValue());
    await gravarCampoDaLinha(preco, PRECO);

    // Entrada, três parcelas e juros: a frase mais comprida que o bloco monta.
    await pagina.locator("#quote-payment-method").selectOption("INSTALLMENTS");
    await pagina.locator("#quote-down-payment").fill("25");
    await pagina.locator("#quote-installments").fill("3");
    await pagina.locator("#quote-interval").fill("30");
    await pagina.locator("#quote-interest").fill("2");
    await salvarCondicoes();
    await voltarAoProjeto(pagina);

    const condicao = await comercial("Condição de pagamento");
    afirmar(
      "a condição de pagamento é a frase completa, com entrada, parcelas e juros",
      /^Parcelado — entrada de R\$ .+ e 3× de R\$ .+, juros de .+ ao mês$/.test(condicao ?? ""),
      condicao,
    );
    afirmar("a ficha não tem campo de condição: é leitura", (await pagina.locator("#quote-payment-method").count()) === 0);

    // ── 6. 390px ────────────────────────────────────────────────────────
    console.log(`\n[6] Viewport estreito (390px)`);

    await pagina.setViewportSize({ width: 390, height: 844 });
    await pagina.reload();
    await esperarProjetoNaTela(pagina);

    const estreito = await pagina.evaluate(() => {
      const grade = document.querySelector(".field-grid-2");
      const bloco = document.querySelector(".project-commercial");
      const lista = bloco.querySelector("dl");
      return {
        colunas: getComputedStyle(grade).gridTemplateColumns.split(" ").length,
        largura: Math.round(bloco.getBoundingClientRect().width),
        viewport: document.documentElement.clientWidth,
        scrollW: lista.scrollWidth,
        clientW: lista.clientWidth,
      };
    });
    afirmar("em 390px a grade vira uma coluna só", estreito.colunas === 1, `${estreito.colunas} coluna(s)`);
    afirmar("o bloco Comercial cabe na largura", estreito.largura <= estreito.viewport, `${estreito.largura}px em ${estreito.viewport}px`);
    afirmar(
      "o bloco Comercial não ganhou rolagem própria",
      estreito.scrollW <= estreito.clientW + 1,
      `scrollWidth ${estreito.scrollW} / clientWidth ${estreito.clientW}`,
    );
    const condicaoEstreita = await pagina.evaluate(() => {
      const bloco = document.querySelector(".project-commercial");
      const dt = [...bloco.querySelectorAll("dt")].find((n) => n.textContent.trim() === "Condição de pagamento");
      const dd = dt.nextElementSibling;
      const faixa = new Range();
      faixa.selectNodeContents(dd);
      return {
        altura: Math.round(dd.getBoundingClientRect().height),
        larguraDoTexto: Math.round(faixa.getBoundingClientRect().width),
        larguraDoCampo: Math.round(dd.getBoundingClientRect().width),
      };
    });
    // A frase parcelada é longa demais para uma linha em 390px: ela QUEBRA, não alarga o bloco.
    afirmar("a condição de pagamento longa quebra em mais de uma linha", condicaoEstreita.altura > 30, `${condicaoEstreita.altura}px de altura`);
    afirmar(
      "a condição de pagamento longa não estoura a largura do campo",
      condicaoEstreita.larguraDoTexto <= condicaoEstreita.larguraDoCampo + 1,
      `texto ${condicaoEstreita.larguraDoTexto}px em campo ${condicaoEstreita.larguraDoCampo}px`,
    );

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
  console.log("OK — o resumo comercial diz a verdade sobre cada versão.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
