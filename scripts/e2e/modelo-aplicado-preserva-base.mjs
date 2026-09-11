import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Aplicar um Modelo preserva a grandeza física da base — TEMPLATE-APPLY-BASE-UOM-01.
 *
 * A Formulação lê a base na unidade do Item acabado do Produto. Aplicar copiava
 * só o número: "1 kg" do Modelo virava "1 g" num Produto em g, e "1 un" num
 * Produto em un — a mesma receita para mil vezes menos produto, ou para uma
 * grandeza que ela nunca descreveu. O que esta suíte prova, clicando:
 *
 *   1. um Modelo com base 1 kg e 100 g de insumo, ativado pela interface;
 *   2. aplicado a um Produto em g, a Formulação nasce com base 1000 e o
 *      componente intacto — 100 g, a mesma proporção física;
 *   3. aplicado a um Produto em un, a tela diz que as unidades não são
 *      compatíveis, e o Produto continua sem formulação nenhuma;
 *   4. o console só tem a recusa provocada.
 *
 * Toda mutação é de interface. A rede é só observada.
 *
 *   node scripts/e2e/modelo-aplicado-preserva-base.mjs
 */

const run = obterRun({ novo: true, dono: "producao" });
const P = `E2E${run.runId}`;

const CLIENTE = `Cliente Base ${P} LTDA`;
const INSUMO = `Insumo Base ${P}`;
const MODELO = `Modelo Base ${P}`;
const PRODUTO_EM_G = `Produto em g ${P}`;
const PRODUTO_EM_UN = `Produto em un ${P}`;

const RECUSA = "A unidade da base do Modelo (kg) não é compatível com a unidade do Produto (un).";

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

  async function criarProduto(nome, unidade) {
    await pagina.goto(`${WEB}/cadastros/produtos/novo`);
    await pagina.locator("#product-customer").first().fill(CLIENTE);
    await pagina.waitForTimeout(900);
    await pagina.getByRole("option", { name: new RegExp(P) }).first().click();
    await preencher("product-name", nome);
    await escolher("product-finished-unit", unidade);
    await preencher("product-units-per-box", "12");
    await clicar("Criar produto");
    await pagina.waitForURL(/\/cadastros\/produtos$/, { timeout: 25000 });
    await pagina.locator("#products-search").fill(nome);
    await pagina.waitForTimeout(1500);
    const linha = pagina.getByRole("row", { name: new RegExp(nome) }).first();
    await linha.waitFor({ timeout: 25000 });
    await linha.locator("button").last().click();
    await pagina.getByText("Custos industriais", { exact: true }).first().click();
    await pagina.waitForURL(/\/produtos\/[0-9a-f-]{36}\/custos/, { timeout: 25000 });
    return pagina.url().match(/\/produtos\/([0-9a-f-]{36})\/custos/)?.[1];
  }

  /** "Usar template da biblioteca", como quem está no Produto. Devolve o status observado. */
  async function aplicarModelo(produtoId) {
    await pagina.goto(`${WEB}/producao/formulacoes/${produtoId}`);
    await clicar("Usar template da biblioteca");
    await pagina.locator("#template-busca").fill(MODELO);
    const linha = pagina.getByRole("row", { name: new RegExp(MODELO) }).first();
    await linha.waitFor({ timeout: 25000 });
    await linha.getByRole("button", { name: "Revisar" }).click();
    const resposta = pagina.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/formulation-versions\/from-template$/.test(new URL(r.url()).pathname),
      { timeout: 25000 },
    );
    resposta.catch(() => {});
    await clicar("Usar este template");
    return (await resposta).status();
  }

  try {
    // ── 0. Massa própria ────────────────────────────────────────────────
    console.log(`\n[0] Cliente e insumo em kg — ${P}`);

    await pagina.goto(`${WEB}/cadastros/clientes/novo`);
    await preencher("customer-legal-name", CLIENTE);
    await clicar("Criar cliente");
    await pagina.waitForURL(/\/cadastros\/clientes/, { timeout: 25000 });

    await pagina.goto(`${WEB}/cadastros/itens/novo`);
    await escolher("item-type", "RAW_MATERIAL");
    await escolher("item-unit", "kg");
    await preencher("item-name", INSUMO);
    await clicar("Criar item");
    await pagina.waitForURL(/\/cadastros\/itens$/, { timeout: 25000 });
    afirmar("insumo criado pela interface", true, INSUMO);

    // ── 1. Modelo com base 1 kg ─────────────────────────────────────────
    console.log(`\n[1] Modelo: base 1 kg, 100 g de insumo`);

    await pagina.goto(`${WEB}/producao/templates-formulacao`);
    await clicar("Novo template");
    await preencher("template-name", MODELO);
    await clicar("Criar");
    await pagina.waitForURL(/\/producao\/templates-formulacao\/[0-9a-f-]{36}$/, { timeout: 25000 });
    await pagina.locator("#template-unidade").first().waitFor({ timeout: 25000 });
    await assentar();

    await preencher("template-base", "1");
    await escolher("template-unidade", "kg");
    await clicar("+ Adicionar componente");
    const campoDoItem = pagina.locator('input[id^="template-item-"]').first();
    await campoDoItem.click();
    await campoDoItem.fill(INSUMO);
    await pagina.waitForTimeout(900);
    await pagina.getByRole("option", { name: new RegExp(INSUMO) }).first().click();
    await assentar();
    await pagina.locator('tbody select[aria-label^="Unidade"]').first().selectOption("g");
    await pagina.locator("tbody tr").first().locator('input[inputmode="decimal"]').fill("100");
    const leitura = leituraDoModelo();
    await clicar("Salvar rascunho");
    await leitura;
    await assentar();
    await clicar("Ativar versão");
    await pagina.getByText(/Versão ativa — V1/).first().waitFor({ timeout: 25000 });
    afirmar("Modelo ativo", true, MODELO);

    // ── 2. Produto em g ─────────────────────────────────────────────────
    console.log(`\n[2] Aplicado a um Produto em g: base convertida, componente intacto`);

    const produtoEmG = await criarProduto(PRODUTO_EM_G, "g");
    const statusEmG = await aplicarModelo(produtoEmG);
    afirmar("a aplicação passou", statusEmG === 201, String(statusEmG));
    await pagina.waitForURL(/\/producao\/formulacoes\/[0-9a-f-]{36}\/versoes\/[0-9a-f-]{36}/, {
      timeout: 25000,
    });
    await pagina.locator("#version-basis").first().waitFor({ timeout: 25000 });
    await assentar();
    const base = await pagina.locator("#version-basis").first().inputValue();
    afirmar("a base nasce 1000 g — 1 kg na unidade do Produto", base === "1000", base);
    const quantidade = await pagina.locator('input[aria-label^="Quantidade de "]').first().inputValue();
    const unidade = await pagina.locator('select[aria-label^="Unidade de "]').first().inputValue();
    afirmar(
      "o componente chega intacto: 100 g, a mesma proporção por base",
      Number(quantidade.replace(",", ".")) === 100 && unidade === "g",
      `${quantidade} ${unidade}`,
    );

    // ── 3. Produto em un ────────────────────────────────────────────────
    console.log(`\n[3] Aplicado a um Produto em un: recusado, e nada nasce`);

    const produtoEmUn = await criarProduto(PRODUTO_EM_UN, "un");
    const statusEmUn = await aplicarModelo(produtoEmUn);
    afirmar("a aplicação é recusada", statusEmUn === 409, String(statusEmUn));
    const alerta = pagina.locator(".form-alert").first();
    await alerta.waitFor({ timeout: 25000 });
    afirmar("a tela diz por quê, em português", (await alerta.innerText()).trim() === RECUSA, (await alerta.innerText()).trim());
    afirmar(
      "a tela continua no Produto, sem abrir versão",
      !/\/versoes\//.test(pagina.url()),
      pagina.url(),
    );
    await pagina.goto(`${WEB}/producao/formulacoes/${produtoEmUn}`);
    await pagina.getByText("Nenhuma versão de formulação ainda.").first().waitFor({ timeout: 25000 });
    afirmar("reaberto, o Produto continua sem formulação nenhuma", true);

    // ── 4. Console ──────────────────────────────────────────────────────
    const inesperados = erros.filter((erro) => !/status of 409/.test(erro));
    afirmar("console só com a recusa provocada", inesperados.length === 0, inesperados.slice(0, 3).join(" | "));
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
  console.log("OK — aplicar o Modelo preserva a grandeza física da base, e o que não converte não nasce.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
