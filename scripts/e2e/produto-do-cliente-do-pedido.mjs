import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * O Pedido só oferece produtos DO CLIENTE do Pedido.
 *
 * O defeito que esta suíte impede de voltar: a tela do Pedido pedia o catálogo
 * inteiro (`listProducts` sem `customerId`) e oferecia produto de qualquer
 * cliente. Um Pedido do Cliente A com produto do Cliente B era salvo,
 * confirmado, e só na Ordem de Produção alguém descobria — com o compromisso
 * comercial já assumido.
 *
 * O que esta suíte prova, clicando:
 *
 * 1. sem cliente não há produto a escolher, e a tela diz por quê;
 * 2. escolhido o cliente, TODA consulta de produto leva `customerId` — é o
 *    banco que filtra, e por isso o resultado não depende de o produto caber
 *    na primeira página carregada;
 * 3. procurar o produto de OUTRO cliente pelo código não o encontra;
 * 4. o produto do próprio cliente é encontrado e entra no Pedido;
 * 5. com produto no Pedido, trocar o cliente está bloqueado — sem apagar linha;
 * 6. o Pedido válido confirma, e reabrir mostra o produto certo.
 *
 * Massa própria, carimbada pelo `runId`: dois clientes e dois produtos criados
 * pela interface nesta execução. Nada é fabricado por API ou SQL — a API entra
 * só para observar as requisições que a tela fez.
 *
 *   node scripts/e2e/produto-do-cliente-do-pedido.mjs
 */

const run = obterRun({ novo: true, dono: "order-customer-product-01" });
const P = `E2E${run.runId}`;

const CLIENTE_A = `${P} Cliente Alfa`;
const CLIENTE_B = `${P} Cliente Beta`;
const PRODUTO_A = `${P} Produto Alfa`;
const PRODUTO_B = `${P} Produto Beta`;

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

const { pagina, erros, fechar } = await abrirNavegador();

/** Toda consulta de catálogo de produto que a TELA disparou. */
const consultasDeProduto = [];
pagina.on("request", (r) => {
  const url = r.url();
  if (/\/products\?/.test(url)) consultasDeProduto.push(new URL(url));
});

async function clicar(nome, { exact = true } = {}) {
  await pagina.getByRole("button", { name: nome, exact }).first().click();
}

/**
 * Escolhe no campo de busca de entidade digitando, como a pessoa faz.
 *
 * `+ Cadastrar novo` também é `role="option"` e repete o texto digitado — a
 * suíte precisa do REGISTRO, nunca do convite a criar outro igual.
 */
const OPCAO_DE_REGISTRO = '[role="option"]:not(.entity-select__create)';

async function escolherNoCampo(seletor, termo, textoDaOpcao) {
  const campo = pagina.locator(seletor);
  await campo.click();
  await campo.fill("");
  await campo.type(termo, { delay: 20 });
  const opcao = pagina.locator(OPCAO_DE_REGISTRO, { hasText: textoDaOpcao }).first();
  await opcao.waitFor({ state: "visible", timeout: 15000 });
  await opcao.click();
}

/** As opções de REGISTRO visíveis no popover aberto, como texto. */
async function opcoesVisiveis() {
  return pagina.evaluate(
    (seletor) => [...document.querySelectorAll(seletor)].map((li) => li.textContent.trim()),
    OPCAO_DE_REGISTRO,
  );
}

async function criarCliente(nome) {
  await pagina.goto(`${WEB}/cadastros/clientes/novo`, { waitUntil: "networkidle" });
  await pagina.fill("#customer-legal-name", nome);
  await clicar("Criar cliente");
  await pagina.waitForFunction(
    () => /\/cadastros\/clientes(\/[0-9a-f-]{10,})?$/.test(location.pathname),
    { timeout: 20000 },
  );
}

/** Produto novo pertence ao cliente escolhido — o cadastro exige o vínculo. */
async function criarProduto(nome, cliente) {
  await pagina.goto(`${WEB}/cadastros/produtos/novo`, { waitUntil: "networkidle" });
  await pagina.waitForSelector("#product-customer");
  await escolherNoCampo("#product-customer", cliente, cliente);
  await pagina.fill("#product-name", nome);
  await pagina.selectOption("#product-finished-unit", "un");
  await clicar("Criar produto");
  await pagina.waitForFunction(
    () => /\/cadastros\/produtos(\/[0-9a-f-]{10,})?$/.test(location.pathname),
    { timeout: 25000 },
  );
}

/** O código oficial de um produto, lido da LISTAGEM — nunca inventado. */
async function codigoDoProduto(nome) {
  await pagina.goto(`${WEB}/cadastros/produtos`, { waitUntil: "networkidle" });
  await pagina.fill("#products-search", nome);
  const linha = pagina.locator("tbody tr", { hasText: nome }).first();
  await linha.waitFor({ timeout: 20000 });
  return (await linha.locator("td").first().textContent())?.trim() ?? "";
}

const campoProduto = () => pagina.locator('input[id^="pedido-produto-"]').first();

try {
  console.log(`\nORDER-CUSTOMER-PRODUCT-01 — o produto vem do cliente do Pedido (run ${run.runId})\n`);

  console.log("0. massa desta execução, pela interface");
  await criarCliente(CLIENTE_A);
  await criarCliente(CLIENTE_B);
  await criarProduto(PRODUTO_A, CLIENTE_A);
  await criarProduto(PRODUTO_B, CLIENTE_B);
  const codigoA = await codigoDoProduto(PRODUTO_A);
  const codigoB = await codigoDoProduto(PRODUTO_B);
  afirmar("produto do cliente A criado", /^PROD-\d+$/.test(codigoA), codigoA);
  afirmar("produto do cliente B criado", /^PROD-\d+$/.test(codigoB), codigoB);

  /*
    1. Novo Pedido. Sem cliente não existe campo de produto para preencher, e
    a tela diz a ordem em vez de deixar um campo mudo.
  */
  console.log("\n1. novo Pedido: sem cliente, não há produto a escolher");
  await pagina.goto(`${WEB}/comercial/pedidos/novo`, { waitUntil: "networkidle" });
  await pagina.waitForSelector("#co-customer");
  consultasDeProduto.length = 0;

  const botaoAdicionar = pagina.getByRole("button", { name: "+ Adicionar produto" }).first();
  afirmar("“+ Adicionar produto” desabilitado sem cliente", await botaoAdicionar.isDisabled());
  afirmar(
    "a tela explica a ordem obrigatória",
    await pagina
      .getByText(/Selecione o cliente primeiro — o sistema mostra apenas os produtos vinculados a ele/i)
      .isVisible(),
  );
  afirmar(
    "nenhum catálogo de produto foi consultado antes do cliente",
    consultasDeProduto.length === 0,
    consultasDeProduto.map((u) => u.search).join(" | "),
  );

  /*
    2. Escolhido o cliente A, a tela consulta o catálogo DELE. O filtro é do
    servidor: é isso que torna o resultado independente do tamanho da página
    carregada, e não uma filtragem no navegador.
  */
  console.log("\n2. escolhido o cliente A, a consulta leva customerId");
  await escolherNoCampo("#co-customer", CLIENTE_A, CLIENTE_A);
  // A ação de adicionar linha se solta quando o cliente entra: é o sinal de
  // que a tela já sabe de qual catálogo falar.
  await pagina
    .getByRole("button", { name: "+ Adicionar produto" })
    .first()
    .waitFor({ state: "visible", timeout: 10000 });
  await pagina.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "+ Adicionar produto" && !b.disabled,
      ),
    { timeout: 10000 },
  );
  await pagina.waitForTimeout(500);

  afirmar("a tela consultou o catálogo do cliente", consultasDeProduto.length > 0);
  const semCliente = consultasDeProduto.filter((u) => !u.searchParams.get("customerId"));
  afirmar(
    "TODA consulta de produto leva customerId",
    semCliente.length === 0,
    semCliente.map((u) => u.search).join(" | "),
  );
  afirmar(
    "e nenhuma pede o catálogo inteiro com página gigante",
    consultasDeProduto.every((u) => Number(u.searchParams.get("pageSize") ?? "0") <= 50),
    consultasDeProduto.map((u) => u.searchParams.get("pageSize")).join(","),
  );

  /*
    3. Procurar o produto do OUTRO cliente pelo código oficial. A busca vai ao
    servidor com o customerId do Pedido — e não acha.
  */
  console.log("\n3. o produto do cliente B não aparece no Pedido do cliente A");
  await clicar("+ Adicionar produto");
  await campoProduto().click();
  await campoProduto().type(codigoB, { delay: 20 });
  await pagina.waitForTimeout(1200);

  const buscaDeB = consultasDeProduto.filter((u) => u.searchParams.get("search") === codigoB);
  afirmar(
    `a busca por ${codigoB} foi ao servidor com o cliente do Pedido`,
    buscaDeB.length > 0 && buscaDeB.every((u) => Boolean(u.searchParams.get("customerId"))),
    buscaDeB.map((u) => u.search).join(" | "),
  );
  const opcoesComB = await opcoesVisiveis();
  afirmar(
    "o produto de outro cliente NÃO está entre as opções",
    !opcoesComB.some((texto) => texto.includes(codigoB)),
    opcoesComB.join(" | "),
  );

  /*
    4. O produto do próprio cliente é encontrado pela mesma busca e entra no
    Pedido.
  */
  console.log("\n4. o produto do cliente A é encontrado e entra no Pedido");
  await campoProduto().fill("");
  await campoProduto().type(codigoA, { delay: 20 });
  const opcaoA = pagina.locator(OPCAO_DE_REGISTRO, { hasText: codigoA }).first();
  await opcaoA.waitFor({ state: "visible", timeout: 15000 });
  await opcaoA.click();
  afirmar(
    "o produto escolhido é o do cliente A",
    (await campoProduto().inputValue()).includes(codigoA),
    await campoProduto().inputValue(),
  );

  await pagina.locator('input[aria-label^="Quantidade de"]').first().fill("7");

  /*
    5. Com produto no Pedido, o cliente trava. Nem apaga linha em cascata, nem
    deixa a mistura passar: quem decide é quem opera.
  */
  console.log("\n5. com produto no Pedido, trocar o cliente está bloqueado");
  afirmar("o campo Cliente está desabilitado", await pagina.locator("#co-customer").isDisabled());
  afirmar(
    "e a tela diz o que fazer",
    await pagina.getByText(/Remova os produtos do pedido antes de alterar o cliente/i).isVisible(),
  );
  afirmar(
    "a linha continua na tela — nada foi apagado",
    (await campoProduto().inputValue()).includes(codigoA),
  );

  /*
    6. O Pedido válido salva e confirma pela interface.
  */
  console.log("\n6. o Pedido válido salva e confirma");
  await clicar("Salvar rascunho");
  await pagina.waitForFunction(() => /\/comercial\/pedidos\/[0-9a-f-]{10,}$/.test(location.pathname), {
    timeout: 25000,
  });
  const urlDoPedido = pagina.url();
  await pagina.waitForFunction(() => /PED-\d{6}/.test(document.body.innerText), { timeout: 20000 });
  const codigoDoPedido = await pagina.evaluate(
    () => document.body.innerText.match(/PED-\d{6}/)?.[0] ?? "",
  );
  afirmar("Pedido gravado", /^PED-\d{6}$/.test(codigoDoPedido), codigoDoPedido);

  await clicar("Confirmar pedido");
  await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Confirmar" }).click();
  await pagina.waitForFunction(() => document.body.innerText.includes("Confirmado"), {
    timeout: 25000,
  });
  afirmar("Pedido confirmado pela interface", true);

  /*
    7. Reabrir e conferir a integridade: cliente A, produto de A, e nenhum
    aviso de inconsistência.
  */
  console.log("\n7. reabrir o Pedido e conferir a integridade");
  await pagina.goto(urlDoPedido, { waitUntil: "networkidle" });
  await pagina.waitForFunction(() => document.body.innerText.includes("Confirmado"), {
    timeout: 20000,
  });
  const texto = await pagina.evaluate(() => document.body.innerText);
  afirmar("o Pedido é do cliente A", texto.includes(CLIENTE_A), CLIENTE_A);
  afirmar("com o produto de A", texto.includes(codigoA), codigoA);
  afirmar("e sem o produto de B", !texto.includes(codigoB));
  afirmar(
    "nenhum aviso de produto de outro cliente",
    !/pertence[m]? a outro cliente/i.test(texto),
  );

  console.log("\n8. console");
  afirmar("console limpo", erros.length === 0, erros.slice(0, 5).join(" | "));
} finally {
  await fechar();
}

console.log("");
if (falhas.length > 0) {
  console.log(`REPROVADO — ${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exitCode = 1;
} else {
  console.log("APROVADO");
}
