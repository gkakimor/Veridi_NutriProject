import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Condição comercial digitada e não salva sobrevive à mutação da linha —
 * QUOTE-DRAFT-STATE-01.
 *
 * O defeito: na proposta em rascunho, digitar a validade e o desconto sem
 * clicar em "Salvar condições" e em seguida adicionar um produto fazia o
 * formulário voltar ao que estava gravado — sem aviso, e com o botão de salvar
 * desabilitado por "nada a salvar".
 *
 * O que esta suíte prova, clicando:
 *
 *   1. as condições digitadas continuam nos campos depois de ADICIONAR produto,
 *      EDITAR quantidade e preço, REMOVER uma linha e de uma edição de linha
 *      RECUSADA — e o formulário continua dizendo que há alteração pendente,
 *      com "Salvar condições" habilitado;
 *   2. nada foi gravado às escondidas: a mesma ficha aberta numa segunda aba
 *      mostra as condições antigas enquanto o rascunho está na primeira;
 *   3. salvar grava o que foi digitado, o formulário fica limpo, e reabrir a
 *      ficha mostra os valores gravados;
 *   4. abrir OUTRA versão mostra as condições dela — nunca o rascunho da versão
 *      de onde se saiu.
 *
 * Toda mutação é de interface. Massa própria, carimbada pelo `runId`.
 *
 *   node scripts/e2e/condicoes-do-orcamento-sobrevivem-a-linha.mjs
 */

const run = obterRun({ novo: true, dono: "comercial" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Condicoes ${P} LTDA`;
const NOME_DO_PROJETO = `Projeto Condicoes ${P}`;
const PRODUTO_A = `Produto A Condicoes ${P}`;
const PRODUTO_B = `Produto B Condicoes ${P}`;

const VALIDADE = "2099-09-20";
const DESCONTO = "7,5";
/** Como o servidor devolve 7,5% gravado com quatro casas: `7.5000` → "7.5". */
const DESCONTO_GRAVADO = "7.5";
const OBSERVACAO = `Frete por conta do cliente ${P}`;
const PARCELAS = "3";

/** O rascunho da V2, que NÃO pode aparecer na V1. */
const VALIDADE_V2 = "2099-10-15";
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
  const { contexto, pagina, erros, fechar } = await abrirNavegador();

  /**
   * A releitura do Projeto que toda mutação de linha dispara. Registrar ANTES
   * da ação: a resposta pode chegar antes de o `await` da ação voltar.
   */
  const esperarReleitura = () => {
    const resposta = pagina.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        /\/projects\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname),
      { timeout: 25000 },
    );
    // Se a ação falhar antes de esperar a resposta, o tempo esgotado não pode
    // virar rejeição sem dono: o processo cairia sem fechar o navegador.
    resposta.catch(() => {});
    return resposta;
  };
  /** Depois da resposta, o React ainda precisa desenhar. */
  const assentar = () => pagina.waitForTimeout(400);

  const valorDe = (seletor) => pagina.locator(seletor).first().inputValue();
  const situacao = async () =>
    (await pagina.locator(".quote-conditions .form-status").first().innerText()).trim();
  const salvarHabilitado = () =>
    pagina.getByRole("button", { name: "Salvar condições", exact: true }).first().isEnabled();

  /** As cinco condições digitadas, lidas da tela. */
  const condicoesNaTela = async () => ({
    validade: await valorDe("#quote-valid-until"),
    desconto: await valorDe("#quote-discount"),
    observacao: await valorDe("#quote-notes"),
    forma: await valorDe("#quote-payment-method"),
    parcelas: (await pagina.locator("#quote-installments").count())
      ? await valorDe("#quote-installments")
      : null,
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

    // ── 2. V1 em rascunho, condições digitadas SEM salvar ───────────────
    console.log(`\n[2] Condições digitadas, sem salvar`);

    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    await pagina.locator("#quote-valid-until").first().waitFor({ timeout: 25000 });
    afirmar("a V1 nasce sem validade", (await valorDe("#quote-valid-until")) === "");

    await pagina.locator("#quote-valid-until").fill(VALIDADE);
    await pagina.locator("#quote-discount").fill(DESCONTO);
    await pagina.locator("#quote-notes").fill(OBSERVACAO);
    await pagina.locator("#quote-payment-method").selectOption("INSTALLMENTS");
    await pagina.locator("#quote-installments").fill(PARCELAS);
    afirmar("antes da linha, o formulário se diz pendente", (await situacao()) === "Alterações não salvas");

    const seletorDeProduto = pagina.locator("#quote-add-product").first();
    const rotuloDe = async (nome) =>
      seletorDeProduto.locator("option", { hasText: nome }).first().innerText();
    const rotuloA = await rotuloDe(PRODUTO_A);
    const rotuloB = await rotuloDe(PRODUTO_B);
    /** `PROD-000123 · Nome` — o código nomeia os campos da linha. */
    const codigoA = rotuloA.split(" · ")[0].trim();
    const codigoB = rotuloB.split(" · ")[0].trim();

    // ── 3. Adicionar produto ────────────────────────────────────────────
    console.log(`\n[3] Adicionar produto`);

    let releitura = esperarReleitura();
    await seletorDeProduto.selectOption({ label: rotuloA });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).first().click();
    await releitura;
    await pagina.getByLabel(`Quantidade de ${codigoA}`).waitFor({ timeout: 25000 });
    await assentar();
    await conferirRascunho("depois de adicionar produto");

    // ── 4. Editar quantidade e preço ────────────────────────────────────
    console.log(`\n[4] Editar quantidade e preço da linha`);

    releitura = esperarReleitura();
    await pagina.getByLabel(`Quantidade de ${codigoA}`).fill("1000");
    await pagina.getByLabel(`Quantidade de ${codigoA}`).blur();
    await releitura;
    await assentar();
    await conferirRascunho("depois de editar a quantidade");

    releitura = esperarReleitura();
    await pagina.getByLabel(`Preço unitário de ${codigoA}`).fill("12,50");
    await pagina.getByLabel(`Preço unitário de ${codigoA}`).blur();
    await releitura;
    await assentar();
    await conferirRascunho("depois de editar o preço");

    // ── 5. Adicionar e remover outra linha ──────────────────────────────
    console.log(`\n[5] Adicionar e remover uma segunda linha`);

    releitura = esperarReleitura();
    await seletorDeProduto.selectOption({ label: rotuloB });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).first().click();
    await releitura;
    await pagina.getByLabel(`Quantidade de ${codigoB}`).waitFor({ timeout: 25000 });
    await assentar();

    releitura = esperarReleitura();
    await pagina
      .locator("tr", { has: pagina.getByLabel(`Quantidade de ${codigoB}`) })
      .getByRole("button", { name: "Remover" })
      .click();
    await releitura;
    await pagina.getByLabel(`Quantidade de ${codigoB}`).waitFor({ state: "detached", timeout: 25000 });
    await assentar();
    await conferirRascunho("depois de remover a linha");

    // ── 6. Edição de linha recusada ─────────────────────────────────────
    console.log(`\n[6] Edição de linha recusada`);

    await pagina.getByLabel(`Quantidade de ${codigoA}`).fill("1,2,3");
    await pagina.getByLabel(`Quantidade de ${codigoA}`).blur();
    await pagina.locator(".form-alert").first().waitFor({ timeout: 25000 });
    afirmar("a linha recusada diz por quê", true, await pagina.locator(".form-alert").first().innerText());
    await conferirRascunho("depois da linha recusada");

    // Devolver a quantidade válida — a linha precisa estar completa para o envio.
    releitura = esperarReleitura();
    await pagina.getByLabel(`Quantidade de ${codigoA}`).fill("1000");
    await pagina.getByLabel(`Quantidade de ${codigoA}`).blur();
    await releitura;
    await assentar();
    await conferirRascunho("depois de corrigir a linha");

    // ── 7. Nada foi gravado às escondidas ───────────────────────────────
    console.log(`\n[7] Segunda aba: o servidor ainda tem as condições antigas`);

    const segunda = await contexto.newPage();
    segunda.on("pageerror", (e) => erros.push(`pageerror (2ª aba): ${String(e).slice(0, 200)}`));
    segunda.on("console", (m) => m.type() === "error" && erros.push(`console.error (2ª aba): ${m.text().slice(0, 200)}`));
    await segunda.goto(urlDoProjeto);
    await segunda.locator("#quote-valid-until").first().waitFor({ timeout: 25000 });
    const naOutraAba = {
      validade: await segunda.locator("#quote-valid-until").first().inputValue(),
      desconto: await segunda.locator("#quote-discount").first().inputValue(),
      forma: await segunda.locator("#quote-payment-method").first().inputValue(),
    };
    await segunda.close();
    afirmar("adicionar produto não gravou a validade", naOutraAba.validade === "", naOutraAba.validade);
    afirmar("adicionar produto não gravou o desconto", naOutraAba.desconto === "", naOutraAba.desconto);
    afirmar("adicionar produto não gravou a forma de pagamento", naOutraAba.forma === "CASH", naOutraAba.forma);
    await conferirRascunho("a primeira aba, depois da segunda");

    // ── 8. Salvar ───────────────────────────────────────────────────────
    console.log(`\n[8] Salvar condições`);

    releitura = esperarReleitura();
    await pagina.getByRole("button", { name: "Salvar condições", exact: true }).first().click();
    await releitura;
    await assentar();
    afirmar("salvo, o formulário diz Tudo salvo", (await situacao()) === "Tudo salvo", await situacao());
    afirmar('salvo, "Salvar condições" fica desabilitado', !(await salvarHabilitado()));
    const alertas = await pagina.locator(".form-alert").allInnerTexts();
    afirmar("salvar não produziu recusa", alertas.length === 0, alertas.join(" | "));

    // ── 9. Reabrir ──────────────────────────────────────────────────────
    console.log(`\n[9] Reabrir a ficha`);

    await pagina.goto(urlDoProjeto);
    await pagina.locator("#quote-valid-until").first().waitFor({ timeout: 25000 });
    const reaberta = await condicoesNaTela();
    afirmar("reaberta: validade gravada", reaberta.validade === VALIDADE, reaberta.validade);
    afirmar("reaberta: desconto gravado", reaberta.desconto === DESCONTO_GRAVADO, reaberta.desconto);
    afirmar("reaberta: observação gravada", reaberta.observacao === OBSERVACAO);
    afirmar("reaberta: forma de pagamento gravada", reaberta.forma === "INSTALLMENTS", reaberta.forma);
    afirmar("reaberta: parcelas gravadas", reaberta.parcelas === PARCELAS, String(reaberta.parcelas));
    afirmar("reaberta: Tudo salvo", (await situacao()) === "Tudo salvo");
    afirmar(
      "reaberta: a linha continua uma só",
      (await pagina.getByLabel(/^Quantidade de /).count()) === 1,
    );

    // ── 10. Troca real de versão ────────────────────────────────────────
    console.log(`\n[10] Outra versão não herda o rascunho da anterior`);

    releitura = esperarReleitura();
    await pagina.getByRole("button", { name: "Enviar ao cliente" }).first().click();
    // O diálogo confirma com o mesmo rótulo; o segundo é o do diálogo.
    await pagina.getByRole("button", { name: "Enviar ao cliente" }).last().click();
    await releitura;
    await assentar();

    releitura = esperarReleitura();
    await pagina.getByRole("button", { name: "Criar nova versão" }).first().click();
    await releitura;
    await pagina
      .locator(".quote-workspace__head", { hasText: "· V2" })
      .first()
      .waitFor({ timeout: 25000 });
    await assentar();

    await pagina.locator("#quote-valid-until").fill(VALIDADE_V2);
    await pagina.locator("#quote-discount").fill(DESCONTO_V2);
    afirmar("V2 com rascunho pendente", (await situacao()) === "Alterações não salvas");

    const linhaDaVersao = (rotulo) =>
      pagina
        .locator("tbody tr", { has: pagina.locator("td.is-code", { hasText: rotulo }) })
        .first();

    await linhaDaVersao(/ · V1$/).click();
    await pagina
      .locator(".quote-workspace__head", { hasText: "· V1" })
      .first()
      .waitFor({ timeout: 25000 });
    const v1 = {
      validade: await valorDe("#quote-valid-until"),
      desconto: await valorDe("#quote-discount"),
      somenteLeitura: await pagina.locator("#quote-valid-until").first().isDisabled(),
    };
    afirmar("a V1 mostra a validade DELA", v1.validade === VALIDADE, v1.validade);
    afirmar("a V1 mostra o desconto DELA", v1.desconto === DESCONTO_GRAVADO, v1.desconto);
    afirmar(
      "o rascunho da V2 não aparece na V1",
      v1.validade !== VALIDADE_V2 && v1.desconto !== DESCONTO_V2,
    );
    afirmar("a V1 enviada é somente leitura", v1.somenteLeitura);

    // Observação, não veredito: trocar de versão descarta o rascunho da que
    // ficou para trás. É o comportamento atual e fica como finding — a decisão
    // entre avisar, salvar ou descartar é do PO, não desta suíte.
    await linhaDaVersao(/ · V2$/).click();
    await pagina
      .locator(".quote-workspace__head", { hasText: "· V2" })
      .first()
      .waitFor({ timeout: 25000 });
    const v2 = { validade: await valorDe("#quote-valid-until"), desconto: await valorDe("#quote-discount") };
    console.log(
      `  obs  de volta à V2, o formulário mostra o gravado (validade "${v2.validade}", desconto "${v2.desconto}") — o rascunho digitado antes da troca foi descartado`,
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
  console.log("OK — o que foi digitado nas condições sobrevive às linhas, e só o Salvar grava.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
