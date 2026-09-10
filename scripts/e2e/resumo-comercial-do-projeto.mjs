import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * O resumo comercial na ficha do Projeto — PROJECT-COMMERCIAL-SUMMARY-01.
 *
 * A coluna direita do bloco Resumo responde, sem rolar a página até as
 * versões: em que pé está a negociação, quanto vale a proposta, o que ela
 * cobre e quando foi comunicada.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. um Projeto sem orçamento já mostra a coluna Comercial, vazia e sem
 *      parecer quebrada;
 *   2. criada a V1 com produto, quantidade e preço, o resumo mostra o
 *      rascunho — com valor e itens, e SEM data de envio;
 *   3. enviada a V1, aparece a situação Enviado e a data do envio;
 *   4. criada a V2 em rascunho, o último orçamento passa a ser a V2 e a
 *      última proposta ENVIADA continua sendo a V1 — as duas em linhas
 *      separadas, e "Enviado em" volta a ser travessão;
 *   5. o bloco cabe em 390px, empilhado, sem rolagem própria.
 *
 * O passo 4 é o motivo da suíte existir. Misturar as duas versões — o rótulo
 * da V2 com a data da V1 — anuncia um envio que não aconteceu.
 *
 * Toda mutação é de interface. Nenhuma chamada de API faz parte do caminho de
 * negócio; massa própria, carimbada pelo `runId`.
 *
 *   node scripts/e2e/resumo-comercial-do-projeto.mjs
 */

const run = obterRun({ novo: true, dono: "comercial" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Resumo ${P} LTDA`;
const NOME_DO_PROJETO = `Projeto Resumo ${P}`;
const NOME_DO_PRODUTO = `Produto Resumo ${P}`;

const QUANTIDADE = "1000";
const PRECO = "12,50";
/** 1.000 × R$ 12,50 — o total que o servidor deve devolver. */
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
  const { pagina, erros, fechar } = await abrirNavegador();

  /** O valor de um rótulo DENTRO da coluna Comercial. */
  const comercial = async (rotulo) =>
    pagina.evaluate((texto) => {
      const bloco = document.querySelector(".project-commercial");
      if (!bloco) return null;
      const dt = [...bloco.querySelectorAll("dt")].find((n) => n.textContent.trim() === texto);
      // O espaço do "R$ 1.234,56" é não separável: normalizar deixa a
      // comparação legível sem esconder o que a tela mostra.
      return dt?.nextElementSibling?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    }, rotulo);

  const temRotulo = async (rotulo) =>
    pagina.evaluate((texto) => {
      const bloco = document.querySelector(".project-commercial");
      return [...(bloco?.querySelectorAll("dt") ?? [])].some(
        (n) => n.textContent.trim() === texto,
      );
    }, rotulo);

  let urlDoProjeto = "";

  try {
    // ── 1. Cliente e Projeto ────────────────────────────────────────────
    console.log(`\n[1] Cliente e Projeto`);

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
    await pagina.locator(".project-commercial").first().waitFor({ timeout: 25000 });
    afirmar("projeto criado", true, NOME_DO_PROJETO);

    // ── 2. Coluna Comercial sem nenhum orçamento ────────────────────────
    console.log(`\n[2] Coluna Comercial sem orçamento`);

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
    afirmar(
      "sem envio, não existe linha de última proposta enviada",
      (await temRotulo("Última proposta enviada")) === false,
    );

    // ── 3. Produto do projeto e V1 em rascunho ──────────────────────────
    console.log(`\n[3] Produto e V1 em rascunho`);

    // A seção nasce fechada: o formulário só aparece depois de "+ Adicionar
    // produto", e é ele que oferece "Criar novo produto".
    await pagina.getByRole("button", { name: "+ Adicionar produto" }).first().click();
    await pagina.getByRole("button", { name: "Criar novo produto" }).first().click();
    await pagina.locator("#new-product-name").first().fill(NOME_DO_PRODUTO);
    await pagina.getByRole("button", { name: "Criar produto" }).first().click();
    await pagina.getByText(NOME_DO_PRODUTO).first().waitFor({ timeout: 25000 });

    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    // "Adicionar produto à proposta" é um `<select>` nativo com os produtos
    // do projeto — escolher pelo rótulo carimbado desta execução.
    const seletorDeProduto = pagina.locator("#quote-add-product").first();
    await seletorDeProduto.waitFor({ timeout: 25000 });
    const rotuloDoProduto = await seletorDeProduto
      .locator("option", { hasText: P })
      .first()
      .innerText();
    await seletorDeProduto.selectOption({ label: rotuloDoProduto });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).first().click();

    const quantidade = pagina.getByLabel(/^Quantidade de /).first();
    await quantidade.waitFor({ timeout: 25000 });
    await quantidade.fill(QUANTIDADE);
    await quantidade.blur();
    const preco = pagina.getByLabel(/^Preço unitário de /).first();
    await preco.fill(PRECO);
    await preco.blur();

    // Cada campo da linha grava ao sair do campo; enquanto grava, a seção
    // inteira fica desabilitada. Esperar o botão voltar a aceitar clique é
    // esperar o salvamento terminar — e um alerta na tela é resultado, não
    // ruído: sem isto o teste falharia por "botão desabilitado" sem dizer
    // que o servidor recusou alguma coisa.
    /*
     * Cada campo da linha grava ao sair do campo, e o projeto inteiro é
     * recarregado depois — o que RESETA o formulário de condições. Digitar a
     * validade antes disso perderia o valor em silêncio, e o botão de salvar
     * ficaria desabilitado por "nada a salvar". Só depois que a gravação da
     * linha assenta é que a validade é digitada.
     */
    await pagina.waitForTimeout(2000);
    await pagina.locator("#quote-valid-until").first().fill(VALIDADE);
    const salvarCondicoes = pagina.getByRole("button", { name: "Salvar condições" }).first();
    await salvarCondicoes.waitFor({ state: "visible", timeout: 25000 });
    await salvarCondicoes.click({ timeout: 25000 });
    await pagina.waitForTimeout(1500);
    const alertas = await pagina.locator(".form-alert").allInnerTexts();
    if (alertas.length > 0) console.log(`  aviso na tela: ${alertas.join(" | ")}`);

    await pagina.goto(urlDoProjeto);
    await pagina.locator(".project-commercial").first().waitFor({ timeout: 25000 });

    afirmar(
      "o último orçamento é a V1 em rascunho",
      /· V1 · Rascunho$/.test((await comercial("Último orçamento")) ?? ""),
      await comercial("Último orçamento"),
    );
    afirmar(
      "o valor vem do total da versão",
      (await comercial("Valor da proposta")) === TOTAL_ESPERADO,
      await comercial("Valor da proposta"),
    );
    afirmar(
      "itens orçados conta o produto",
      (await comercial("Itens orçados")) === "1 produto",
      await comercial("Itens orçados"),
    );
    afirmar("rascunho não tem data de envio", (await comercial("Enviado em")) === "—");
    afirmar(
      "rascunho não cria linha de última proposta enviada",
      (await temRotulo("Última proposta enviada")) === false,
    );

    // ── 4. Enviar a V1 ──────────────────────────────────────────────────
    console.log(`\n[4] V1 enviada`);

    await pagina.getByRole("button", { name: "Enviar ao cliente" }).first().click();
    // O diálogo confirma com o mesmo rótulo; o segundo é o do diálogo.
    await pagina.getByRole("button", { name: "Enviar ao cliente" }).last().click();
    await pagina.waitForTimeout(1500);

    await pagina.goto(urlDoProjeto);
    await pagina.locator(".project-commercial").first().waitFor({ timeout: 25000 });

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
    afirmar(
      "a versão corrente É a enviada: não se repete a informação",
      (await temRotulo("Última proposta enviada")) === false,
    );
    afirmar(
      "a última atividade é o envio da V1",
      (await comercial("Última atividade comercial")) === `Orçamento V1 enviado em ${enviadoEm}`,
      await comercial("Última atividade comercial"),
    );

    // ── 5. V2 em rascunho — o caso que não pode misturar ────────────────
    console.log(`\n[5] V2 em rascunho, V1 enviada`);

    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    await pagina.waitForTimeout(1500);
    await pagina.goto(urlDoProjeto);
    await pagina.locator(".project-commercial").first().waitFor({ timeout: 25000 });

    const ultimo = await comercial("Último orçamento");
    const ultimaEnviada = await comercial("Última proposta enviada");
    afirmar("o último orçamento passou a ser a V2 em rascunho", /· V2 · Rascunho$/.test(ultimo ?? ""), ultimo);
    afirmar(
      "a V2 NÃO herda a data de envio da V1",
      (await comercial("Enviado em")) === "—",
      await comercial("Enviado em"),
    );
    afirmar(
      "a última proposta enviada continua sendo a V1, em linha própria",
      (ultimaEnviada ?? "").includes("V1") && (ultimaEnviada ?? "").includes(enviadoEm),
      ultimaEnviada,
    );
    afirmar(
      "a linha do último orçamento não carrega a data da V1",
      !(ultimo ?? "").includes(enviadoEm),
      ultimo,
    );

    // ---- 6. A condicao de pagamento mais longa que a ficha produz ------
    console.log(`
[6] Condicao de pagamento parcelada`);

    /*
     * A versão nova pode já nascer com a linha da anterior — é a formação de
     * preço por decisão de §74. Só se ela vier vazia é que o produto é
     * adicionado aqui; o que importa para este passo é a V2 ter total, sem o
     * qual não existe plano de pagamento para descrever.
     */
    await pagina.getByLabel(/^Quantidade de /).first().waitFor({ timeout: 25000 }).catch(() => {});
    if ((await pagina.getByLabel(/^Quantidade de /).count()) === 0) {
      const seletorV2 = pagina.locator("#quote-add-product").first();
      await seletorV2.waitFor({ timeout: 25000 });
      await seletorV2.selectOption({ label: rotuloDoProduto });
      await pagina.getByRole("button", { name: "Adicionar", exact: true }).first().click();
    }
    const quantidadeV2 = pagina.getByLabel(/^Quantidade de /).first();
    await quantidadeV2.waitFor({ timeout: 25000 });
    await quantidadeV2.fill(QUANTIDADE);
    await quantidadeV2.blur();
    const precoV2 = pagina.getByLabel(/^Preço unitário de /).first();
    await precoV2.fill(PRECO);
    await precoV2.blur();
    await pagina.waitForTimeout(2000);

    // Entrada, tres parcelas e juros: a frase mais comprida que o bloco monta.
    await pagina.locator("#quote-payment-method").first().selectOption("INSTALLMENTS");
    await pagina.locator("#quote-down-payment").first().fill("25");
    await pagina.locator("#quote-installments").first().fill("3");
    await pagina.locator("#quote-interval").first().fill("30");
    await pagina.locator("#quote-interest").first().fill("2");
    await pagina
      .getByRole("button", { name: "Salvar condições" })
      .first()
      .click({ timeout: 25000 });
    await pagina.waitForTimeout(1500);

    await pagina.goto(urlDoProjeto);
    await pagina.locator(".project-commercial").first().waitFor({ timeout: 25000 });
    const condicao = await comercial("Condição de pagamento");
    afirmar(
      "a condição de pagamento é a frase completa, com entrada, parcelas e juros",
      /^Parcelado — entrada de R\$ .+ e 3× de R\$ .+, juros de .+ ao mês$/.test(
        condicao ?? "",
      ),
      condicao,
    );

    // ---- 7. Viewport estreito ------------------------------------------
    console.log(`
[7] Viewport estreito (390px)`);

    await pagina.setViewportSize({ width: 390, height: 844 });
    await pagina.reload();
    await pagina.locator(".project-commercial").first().waitFor({ timeout: 25000 });

    const estreito = await pagina.evaluate(() => {
      const grade = document.querySelector(".field-grid-2");
      const bloco = document.querySelector(".project-commercial");
      const lista = bloco.querySelector("dl");
      const colunas = getComputedStyle(grade).gridTemplateColumns.split(" ").length;
      return {
        colunas,
        largura: Math.round(bloco.getBoundingClientRect().width),
        viewport: document.documentElement.clientWidth,
        scrollW: lista.scrollWidth,
        clientW: lista.clientWidth,
      };
    });
    afirmar("em 390px a grade vira uma coluna só", estreito.colunas === 1, `${estreito.colunas} coluna(s)`);
    afirmar(
      "o bloco Comercial cabe na largura",
      estreito.largura <= estreito.viewport,
      `${estreito.largura}px em ${estreito.viewport}px`,
    );
    afirmar(
      "o bloco Comercial não ganhou rolagem própria",
      estreito.scrollW <= estreito.clientW + 1,
      `scrollWidth ${estreito.scrollW} / clientWidth ${estreito.clientW}`,
    );
    const condicaoEstreita = await pagina.evaluate(() => {
      const bloco = document.querySelector(".project-commercial");
      const dt = [...bloco.querySelectorAll("dt")].find(
        (n) => n.textContent.trim() === "Condição de pagamento",
      );
      const dd = dt.nextElementSibling;
      const faixa = new Range();
      faixa.selectNodeContents(dd);
      return {
        altura: Math.round(dd.getBoundingClientRect().height),
        larguraDoTexto: Math.round(faixa.getBoundingClientRect().width),
        larguraDoCampo: Math.round(dd.getBoundingClientRect().width),
      };
    });
    // A frase parcelada é longa demais para uma linha em 390px: ela precisa
    // QUEBRAR, não alargar o bloco.
    afirmar(
      "a condição de pagamento longa quebra em mais de uma linha",
      condicaoEstreita.altura > 30,
      `${condicaoEstreita.altura}px de altura`,
    );
    afirmar(
      "a condição de pagamento longa não estoura a largura do campo",
      condicaoEstreita.larguraDoTexto <= condicaoEstreita.larguraDoCampo + 1,
      `texto ${condicaoEstreita.larguraDoTexto}px em campo ${condicaoEstreita.larguraDoCampo}px`,
    );

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
  console.log("OK — o resumo comercial diz a verdade sobre cada versão.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
