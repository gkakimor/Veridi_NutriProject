import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Unidade controlada no Modelo de Formulação — FORM-UOM-01.
 *
 * O Modelo deixava digitar a unidade à mão, na base e no componente; a
 * Formulação real já escolhia do catálogo, pela dimensão do Item. O que esta
 * suíte prova, clicando:
 *
 *   1. a unidade da base é escolha do catálogo — não caixa de texto —, salva
 *      e volta como escolhida;
 *   2. componente sem Item não tem unidade; escolhido o Item de massa, a
 *      unidade é a dele e a lista só tem massa; outra unidade de massa salva e
 *      volta;
 *   3. trocar para um Item de contagem não deixa a unidade de massa escondida:
 *      entra a unidade do Item novo, e é ela que se grava;
 *   4. em 390px, a unidade cabe na célula;
 *   5. ativado, o Modelo aplicado a um Produto pelo "Usar template da
 *      biblioteca" leva as unidades exatamente como estavam.
 *
 * Toda mutação é de interface. A rede é só observada.
 *
 *   node scripts/e2e/modelo-formulacao-unidade-controlada.mjs
 */

const run = obterRun({ novo: true, dono: "producao" });
const P = `E2E${run.runId}`;

const CLIENTE = `Cliente UOM ${P} LTDA`;
const INSUMO = `Insumo UOM ${P}`;
const FRASCO = `Frasco UOM ${P}`;
const MODELO = `Modelo UOM ${P}`;
const PRODUTO = `Produto UOM ${P}`;

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

  /** Toda gravação de versão de Modelo que sair do navegador — observada, nunca feita pela suíte. */
  const gravacoes = [];
  pagina.on("request", (requisicao) => {
    if (
      requisicao.method() === "PATCH" &&
      /\/formulation-template-versions\/[0-9a-f-]{36}$/.test(new URL(requisicao.url()).pathname)
    ) {
      gravacoes.push(requisicao.postData() ?? "");
    }
  });

  const clicar = (nome) => pagina.getByRole("button", { name: nome, exact: true }).first().click();
  const preencher = (id, valor) => pagina.locator(`#${id}`).first().fill(valor);
  const escolher = (id, valor) => pagina.locator(`#${id}`).first().selectOption(valor);
  const assentar = () => pagina.waitForTimeout(500);
  const leituraDoModelo = () => {
    const resposta = pagina.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.status() === 200 &&
        /\/formulation-templates\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname),
      { timeout: 25000 },
    );
    resposta.catch(() => {});
    return resposta;
  };

  /** Escolhe o Item num seletor de entidade: digita, espera a busca e clica na opção. */
  async function escolherItem(campo, termo) {
    await campo.click();
    await campo.fill(termo);
    await pagina.waitForTimeout(900);
    await pagina.getByRole("option", { name: new RegExp(termo) }).first().click();
  }

  const base = () => pagina.locator("#template-unidade").first();
  const unidadesDosComponentes = () => pagina.locator('tbody select[aria-label^="Unidade"]');
  const valoresDe = (select) =>
    select.locator("option").evaluateAll((opcoes) => opcoes.map((opcao) => opcao.value));

  let urlDoModelo = "";

  try {
    // ── 0. Massa própria ────────────────────────────────────────────────
    console.log(`\n[0] Cliente, insumo em kg, frasco em un — ${P}`);

    await pagina.goto(`${WEB}/cadastros/clientes/novo`);
    await preencher("customer-legal-name", CLIENTE);
    await clicar("Criar cliente");
    await pagina.waitForURL(/\/cadastros\/clientes/, { timeout: 25000 });

    for (const [tipo, unidade, nome] of [
      ["RAW_MATERIAL", "kg", INSUMO],
      ["PACKAGING", "un", FRASCO],
    ]) {
      await pagina.goto(`${WEB}/cadastros/itens/novo`);
      await escolher("item-type", tipo);
      await escolher("item-unit", unidade);
      await preencher("item-name", nome);
      await clicar("Criar item");
      await pagina.waitForURL(/\/cadastros\/itens$/, { timeout: 25000 });
    }
    afirmar("dois itens criados pela interface", true, `${INSUMO} (kg) · ${FRASCO} (un)`);

    // ── 1. Unidade da base ──────────────────────────────────────────────
    console.log(`\n[1] Unidade da base é escolha do catálogo`);

    await pagina.goto(`${WEB}/producao/templates-formulacao`);
    await clicar("Novo template");
    await preencher("template-name", MODELO);
    await clicar("Criar");
    await pagina.waitForURL(/\/producao\/templates-formulacao\/[0-9a-f-]{36}$/, { timeout: 25000 });
    urlDoModelo = pagina.url();
    await base().waitFor({ timeout: 25000 });

    afirmar(
      "a base é uma seleção, não uma caixa de texto",
      (await base().evaluate((el) => el.tagName)) === "SELECT",
    );
    const catalogo = await valoresDe(base());
    afirmar("a lista da base é o catálogo de unidades", catalogo.includes("kg") && catalogo.includes("un"), catalogo.join(", "));
    afirmar("nenhuma caixa de texto para unidade na ficha", (await pagina.locator('input[id^="template-unidade"]').count()) === 0);

    await escolher("template-unidade", "kg");
    let leitura = leituraDoModelo();
    await clicar("Salvar rascunho");
    await leitura;
    await pagina.goto(urlDoModelo);
    await base().waitFor({ timeout: 25000 });
    await assentar();
    afirmar("reaberta, a base é a escolhida", (await base().inputValue()) === "kg", await base().inputValue());
    await escolher("template-unidade", "un");

    // ── 2. Componente de massa ──────────────────────────────────────────
    console.log(`\n[2] Componente: sem Item não há unidade; o Item traz a dele`);

    await clicar("+ Adicionar componente");
    const semItem = unidadesDosComponentes().first();
    afirmar("sem Item, a unidade fica indisponível", await semItem.isDisabled());
    afirmar("e sem valor", (await semItem.inputValue()) === "", await semItem.inputValue());

    await escolherItem(pagina.locator('input[id^="template-item-"]').first(), INSUMO);
    await assentar();
    const unidadeDoInsumo = unidadesDosComponentes().first();
    afirmar("escolhido o Item, a unidade é a dele", (await unidadeDoInsumo.inputValue()) === "kg", await unidadeDoInsumo.inputValue());
    const opcoesDeMassa = (await valoresDe(unidadeDoInsumo)).filter(Boolean);
    afirmar(
      "a lista só tem unidades de massa",
      opcoesDeMassa.length > 0 && opcoesDeMassa.every((codigo) => ["mg", "g", "kg"].includes(codigo)),
      opcoesDeMassa.join(", "),
    );

    await unidadeDoInsumo.selectOption("g");
    await pagina.locator("tbody tr").first().locator('input[inputmode="decimal"]').fill("0,5");
    const antesDeSalvar = gravacoes.length;
    leitura = leituraDoModelo();
    await clicar("Salvar rascunho");
    await leitura;
    const pedido = JSON.parse(gravacoes[antesDeSalvar] ?? "{}");
    afirmar(
      "o pedido leva o código do catálogo",
      pedido.outputUnitCode === "un" && pedido.components?.[0]?.unitCode === "g",
      gravacoes[antesDeSalvar],
    );

    await pagina.goto(urlDoModelo);
    await unidadesDosComponentes().first().waitFor({ timeout: 25000 });
    await assentar();
    afirmar(
      "reaberta, a unidade do componente é a escolhida",
      (await unidadesDosComponentes().first().inputValue()) === "g",
      await unidadesDosComponentes().first().inputValue(),
    );

    // ── 3. Troca para Item de contagem ──────────────────────────────────
    console.log(`\n[3] Trocar para um Item de contagem`);

    await escolherItem(pagina.locator('input[id^="template-item-"]').first(), FRASCO);
    await assentar();
    const unidadeDoFrasco = unidadesDosComponentes().first();
    afirmar("a unidade de massa não fica", (await unidadeDoFrasco.inputValue()) === "un", await unidadeDoFrasco.inputValue());
    const opcoesDeContagem = (await valoresDe(unidadeDoFrasco)).filter(Boolean);
    afirmar("a lista passa a ser de contagem", opcoesDeContagem.includes("un") && !opcoesDeContagem.includes("g"), opcoesDeContagem.join(", "));
    await pagina.locator("tbody tr").first().locator('input[inputmode="decimal"]').fill("1");

    // O insumo volta numa segunda linha, para a cópia levar as duas dimensões.
    await clicar("+ Adicionar componente");
    await escolherItem(pagina.locator('input[id^="template-item-"]').nth(1), INSUMO);
    await assentar();
    await unidadesDosComponentes().nth(1).selectOption("g");
    await pagina.locator("tbody tr").nth(1).locator('input[inputmode="decimal"]').fill("0,5");

    leitura = leituraDoModelo();
    await clicar("Salvar rascunho");
    await leitura;
    await pagina.goto(urlDoModelo);
    await unidadesDosComponentes().nth(1).waitFor({ timeout: 25000 });
    await assentar();
    const gravadas = await unidadesDosComponentes().evaluateAll((selects) => selects.map((s) => s.value));
    afirmar("reaberta: frasco em un e insumo em g", gravadas.join(",") === "un,g", gravadas.join(","));

    // ── 4. 390px ────────────────────────────────────────────────────────
    console.log(`\n[4] Em 390px, a unidade cabe na célula`);

    await pagina.setViewportSize({ width: 390, height: 844 });
    await assentar();
    const medidas = await unidadesDosComponentes().evaluateAll((selects) =>
      selects.map((select) => {
        const celula = select.closest("td")?.getBoundingClientRect();
        const caixa = select.getBoundingClientRect();
        const rolagem = select.closest(".table-container");
        return {
          cabe: !!celula && caixa.left >= celula.left - 1 && caixa.right <= celula.right + 1,
          rolagemPropria: !!rolagem && ["auto", "scroll"].includes(getComputedStyle(rolagem).overflowX),
        };
      }),
    );
    afirmar("cada unidade cabe na sua célula", medidas.every((m) => m.cabe), JSON.stringify(medidas));
    afirmar("a tabela rola dentro do próprio cartão", medidas.every((m) => m.rolagemPropria));
    const larguraDaPagina = await pagina.evaluate(() => ({
      pagina: document.documentElement.scrollWidth,
      tela: document.documentElement.clientWidth,
    }));
    console.log(`  info largura da página em 390px: ${larguraDaPagina.pagina} para ${larguraDaPagina.tela}`);
    // A mesma medida numa tela que esta rodada não tocou: separa o shell do Modelo.
    await pagina.goto(`${WEB}/producao/templates-formulacao`);
    await pagina.getByRole("button", { name: "Novo template" }).first().waitFor({ timeout: 25000 });
    await assentar();
    const larguraDaLista = await pagina.evaluate(() => document.documentElement.scrollWidth);
    console.log(`  info largura da lista de Modelos em 390px (tela intocada): ${larguraDaLista}`);
    await pagina.setViewportSize({ width: 1440, height: 900 });
    await pagina.goto(urlDoModelo);
    await base().waitFor({ timeout: 25000 });

    // ── 5. Modelo ativo aplicado a um Produto ───────────────────────────
    console.log(`\n[5] Ativado e aplicado pelo fluxo real, as unidades chegam iguais`);

    await clicar("Ativar versão");
    await pagina.getByText(/Versão ativa — V1/).first().waitFor({ timeout: 25000 });
    afirmar("versão ativada", true);

    await pagina.goto(`${WEB}/cadastros/produtos/novo`);
    await pagina.locator("#product-customer").first().fill(CLIENTE);
    await pagina.waitForTimeout(900);
    await pagina.getByRole("option", { name: new RegExp(P) }).first().click();
    await preencher("product-name", PRODUTO);
    await escolher("product-finished-unit", "un");
    await preencher("product-units-per-box", "12");
    await clicar("Criar produto");
    await pagina.waitForURL(/\/cadastros\/produtos$/, { timeout: 25000 });
    await pagina.locator("#products-search").fill(PRODUTO);
    await pagina.waitForTimeout(1500);
    const linhaDoProduto = pagina.getByRole("row", { name: new RegExp(PRODUTO) }).first();
    await linhaDoProduto.waitFor({ timeout: 25000 });
    await linhaDoProduto.locator("button").last().click();
    await pagina.getByText("Custos industriais", { exact: true }).first().click();
    await pagina.waitForURL(/\/produtos\/[0-9a-f-]{36}\/custos/, { timeout: 25000 });
    const produtoId = pagina.url().match(/\/produtos\/([0-9a-f-]{36})\/custos/)?.[1];

    await pagina.goto(`${WEB}/producao/formulacoes/${produtoId}`);
    await clicar("Usar template da biblioteca");
    await pagina.locator("#template-busca").fill(MODELO);
    await pagina.getByRole("row", { name: new RegExp(MODELO) }).first().waitFor({ timeout: 25000 });
    await pagina
      .getByRole("row", { name: new RegExp(MODELO) })
      .first()
      .getByRole("button", { name: "Revisar" })
      .click();
    await clicar("Usar este template");
    await pagina.waitForURL(/\/producao\/formulacoes\/[0-9a-f-]{36}\/versoes\/[0-9a-f-]{36}/, {
      timeout: 25000,
    });
    const unidadesNaFormulacao = pagina.locator('select[aria-label^="Unidade de "]');
    await unidadesNaFormulacao.nth(1).waitFor({ timeout: 25000 });
    await assentar();
    const copiadas = await unidadesNaFormulacao.evaluateAll((selects) => selects.map((s) => s.value));
    afirmar("a formulação nasce com as unidades do Modelo", copiadas.join(",") === "un,g", copiadas.join(","));
    // TEMPLATE-APPLY-BASE-UOM-01: a base também chega na mesma grandeza — 1 un do Modelo, 1 un do Produto.
    const baseCopiada = await pagina.locator("#version-basis").first().inputValue();
    afirmar("e a base chega na mesma grandeza física", baseCopiada === "1", baseCopiada);

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
  console.log("OK — o Modelo escolhe unidade do catálogo, na dimensão do Item, e a cópia leva exatamente essa.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
