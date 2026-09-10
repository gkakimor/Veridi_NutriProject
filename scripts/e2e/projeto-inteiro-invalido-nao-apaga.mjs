import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Doses e vida útil inválidas não apagam o que o Projeto tem — PROJECT-INT-FIELDS-01.
 *
 * "Doses por embalagem" e "Vida útil (meses)" saíam do formulário do Projeto
 * por `Number(texto)`: `abc` virava `NaN`, o JSON escreve `NaN` como `null`, e
 * salvar apagava o valor gravado. O erro de digitação virava a decisão de
 * limpar o campo — o mesmo defeito que QUOTE-INT-FIELDS-01 fechou no Orçamento.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. o Projeto nasce com doses 60 e vida útil 24, e a edição reaberta mostra
 *      os dois;
 *   2. doses trocadas por `abc`: o erro aparece no próprio campo, "Salvar
 *      alterações" fica indisponível, e insistir no clique não manda nenhuma
 *      gravação do Projeto;
 *   3. uma segunda aba prova que as doses gravadas continuam 60;
 *   4. corrigidas para 90, as doses salvam como inteiro, e a edição reaberta
 *      mostra 90;
 *   5. a mesma prova para a vida útil: `30abc` recusado, a segunda aba ainda
 *      com 24, e 36 salvo e reaberto.
 *
 * Toda mutação é de interface. A rede é só observada.
 *
 *   node scripts/e2e/projeto-inteiro-invalido-nao-apaga.mjs
 */

const run = obterRun({ novo: true, dono: "comercial" });
const P = `E2E${run.runId}`;

const RAZAO_SOCIAL = `Cliente Doses ${P} LTDA`;
const NOME_DO_PROJETO = `Projeto Doses ${P}`;

const ERRO_DOSES = "Doses por embalagem: informe um número inteiro maior que zero.";
const ERRO_VIDA_UTIL = "Vida útil (meses): informe um número inteiro maior que zero.";

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

  /** Toda gravação de Projeto que sair do navegador — observada, nunca feita pela suíte. */
  const gravacoes = [];
  pagina.on("request", (requisicao) => {
    const caminho = new URL(requisicao.url()).pathname;
    const metodo = requisicao.method();
    if (
      (metodo === "PATCH" && /\/projects\/[0-9a-f-]{36}$/.test(caminho)) ||
      (metodo === "POST" && /\/projects$/.test(caminho))
    ) {
      gravacoes.push({ metodo, corpo: requisicao.postData() ?? "" });
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

  const doses = () => pagina.locator("#project-doses").first();
  const vidaUtil = () => pagina.locator("#project-shelf-life").first();
  const botaoSalvar = () =>
    pagina.getByRole("button", { name: "Salvar alterações", exact: true }).first();
  const textoDe = async (seletor) =>
    (await pagina.locator(seletor).count())
      ? (await pagina.locator(seletor).first().innerText()).trim()
      : null;
  const corpoDe = (gravacao) => JSON.parse(gravacao?.corpo || "{}");

  /** A edição abre pela ficha, como quem clica em "Editar". */
  async function abrirEdicao(alvo = pagina) {
    await alvo.getByRole("button", { name: "Editar", exact: true }).first().click();
    await alvo.locator("#project-doses").first().waitFor({ timeout: 25000 });
  }

  /** O que a ficha tem gravado, lido numa segunda aba. */
  async function gravadoNaOutraAba(seletor) {
    const segunda = await contexto.newPage();
    segunda.on("pageerror", (e) => erros.push(`pageerror (2ª aba): ${String(e).slice(0, 200)}`));
    segunda.on(
      "console",
      (m) => m.type() === "error" && erros.push(`console.error (2ª aba): ${m.text().slice(0, 200)}`),
    );
    await segunda.goto(urlDoProjeto);
    await abrirEdicao(segunda);
    const valor = await segunda.locator(seletor).first().inputValue();
    await segunda.close();
    return valor;
  }

  let urlDoProjeto = "";

  try {
    // ── 1. Cliente e Projeto com doses e vida útil ──────────────────────
    console.log(`\n[1] Projeto criado com doses 60 e vida útil 24`);

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
    await doses().fill("60");
    await vidaUtil().fill("24");
    await pagina.getByRole("button", { name: "Criar projeto" }).first().click();
    await pagina.waitForURL(/\/comercial\/projetos\/[0-9a-f-]{36}/, { timeout: 25000 });
    urlDoProjeto = pagina.url();

    const criacao = gravacoes.find((gravacao) => gravacao.metodo === "POST");
    afirmar(
      "a criação leva os inteiros",
      corpoDe(criacao).dosesPerPackage === 60 && corpoDe(criacao).shelfLifeMonths === 24,
      criacao?.corpo,
    );

    await abrirEdicao();
    afirmar("reaberta, doses 60", (await doses().inputValue()) === "60", await doses().inputValue());
    afirmar("e vida útil 24", (await vidaUtil().inputValue()) === "24", await vidaUtil().inputValue());

    // ── 2. Doses inválidas ──────────────────────────────────────────────
    console.log(`\n[2] Doses trocadas por "abc"`);

    const antesDasDoses = gravacoes.length;
    await doses().fill("abc");
    afirmar(
      "o erro aparece no próprio campo",
      (await textoDe("#project-doses-error")) === ERRO_DOSES,
      (await textoDe("#project-doses-error")) ?? "(sem erro)",
    );
    afirmar("o campo se diz inválido", (await doses().getAttribute("aria-invalid")) === "true");
    afirmar(
      "e aponta para o erro",
      (await doses().getAttribute("aria-describedby")) === "project-doses-error",
    );
    afirmar("o texto digitado fica no campo", (await doses().inputValue()) === "abc");
    afirmar('"Salvar alterações" indisponível', await botaoSalvar().isDisabled());

    // `force` ignora a espera por botão habilitado: é o clique de quem insiste.
    await botaoSalvar()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await pagina.waitForTimeout(1000);
    afirmar(
      "nenhuma gravação do Projeto saiu do navegador",
      gravacoes.length === antesDasDoses,
      gravacoes
        .slice(antesDasDoses)
        .map((gravacao) => gravacao.corpo)
        .join(" | ") || "0",
    );

    // ── 3. Segunda aba ──────────────────────────────────────────────────
    console.log(`\n[3] Segunda aba: as doses gravadas continuam lá`);

    const dosesNaOutraAba = await gravadoNaOutraAba("#project-doses");
    afirmar("as doses gravadas não foram apagadas", dosesNaOutraAba === "60", dosesNaOutraAba || "(vazio)");

    // ── 4. Doses corrigidas ─────────────────────────────────────────────
    console.log(`\n[4] Doses corrigidas para 90`);

    // No código antigo o clique insistente gravava e fechava a edição.
    if ((await doses().count()) === 0) await abrirEdicao();
    await doses().fill("90");
    afirmar("o erro sai", (await textoDe("#project-doses-error")) === null);
    afirmar('"Salvar alterações" volta', await botaoSalvar().isEnabled());
    const antesDeSalvarDoses = gravacoes.length;
    let releitura = esperarReleitura();
    await botaoSalvar().click();
    await releitura;
    await assentar();
    const pedidoDoses = corpoDe(gravacoes[antesDeSalvarDoses]);
    afirmar(
      "o pedido leva doses 90, inteiro",
      pedidoDoses.dosesPerPackage === 90,
      gravacoes[antesDeSalvarDoses]?.corpo,
    );

    await pagina.goto(urlDoProjeto);
    await abrirEdicao();
    afirmar("reaberta, doses 90", (await doses().inputValue()) === "90", await doses().inputValue());

    // ── 5. Vida útil ────────────────────────────────────────────────────
    console.log(`\n[5] Vida útil trocada por "30abc", depois 36`);

    const antesDaVidaUtil = gravacoes.length;
    await vidaUtil().fill("30abc");
    afirmar(
      "o erro aparece na vida útil",
      (await textoDe("#project-shelf-life-error")) === ERRO_VIDA_UTIL,
      (await textoDe("#project-shelf-life-error")) ?? "(sem erro)",
    );
    afirmar(
      "o campo se diz inválido e aponta para o erro",
      (await vidaUtil().getAttribute("aria-invalid")) === "true" &&
        (await vidaUtil().getAttribute("aria-describedby")) === "project-shelf-life-error",
    );
    afirmar('"Salvar alterações" indisponível', await botaoSalvar().isDisabled());
    await botaoSalvar()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await pagina.waitForTimeout(1000);
    afirmar(
      "nenhuma gravação do Projeto saiu do navegador",
      gravacoes.length === antesDaVidaUtil,
      gravacoes
        .slice(antesDaVidaUtil)
        .map((gravacao) => gravacao.corpo)
        .join(" | ") || "0",
    );

    const vidaUtilNaOutraAba = await gravadoNaOutraAba("#project-shelf-life");
    afirmar(
      "a vida útil gravada não foi apagada",
      vidaUtilNaOutraAba === "24",
      vidaUtilNaOutraAba || "(vazio)",
    );

    if ((await vidaUtil().count()) === 0) await abrirEdicao();
    await vidaUtil().fill("36");
    afirmar("o erro sai", (await textoDe("#project-shelf-life-error")) === null);
    const antesDeSalvarVidaUtil = gravacoes.length;
    releitura = esperarReleitura();
    await botaoSalvar().click();
    await releitura;
    await assentar();
    const pedidoVidaUtil = corpoDe(gravacoes[antesDeSalvarVidaUtil]);
    afirmar(
      "o pedido leva vida útil 36 e doses 90",
      pedidoVidaUtil.shelfLifeMonths === 36 && pedidoVidaUtil.dosesPerPackage === 90,
      gravacoes[antesDeSalvarVidaUtil]?.corpo,
    );

    await pagina.goto(urlDoProjeto);
    await abrirEdicao();
    afirmar("reaberta, vida útil 36", (await vidaUtil().inputValue()) === "36", await vidaUtil().inputValue());
    afirmar("e doses 90", (await doses().inputValue()) === "90", await doses().inputValue());

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
  console.log("OK — inteiro inválido fica inválido no Projeto, e o gravado não é apagado.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
