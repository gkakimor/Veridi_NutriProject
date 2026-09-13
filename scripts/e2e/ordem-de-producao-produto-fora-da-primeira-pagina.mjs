import { abrirNavegador, WEB } from "./lib/browser.mjs";
import { aplicarRoteiroNaOrdem } from "./lib/roteiro.mjs";
import { obterRun } from "./lib/run-id.mjs";

/**
 * Uma Ordem de Produção não depende da primeira página da lista de produtos.
 *
 * O defeito que esta suíte impede de voltar: a tela da OP carregava UMA página
 * de 50 produtos para alimentar o campo de escolha e depois procurava o produto
 * da própria ordem dentro dessa página. Com 214 produtos aprovados no cadastro,
 * 164 deles — 77% — ficam fora da primeira página sob a ordenação por código.
 * Abrir a OP de qualquer um desses produtos deixava o campo Produto em branco e
 * a tela concluía "Produto sem item de produto acabado válido" para uma ordem
 * perfeitamente válida.
 *
 * Massa: `PROD-000214` — o ÚLTIMO produto da ordenação atual, posição 214 de
 * 214, escolhido justamente por estar o mais longe possível da primeira página.
 * O produto é dado real do cadastro; a suíte não o fabrica. A OP desta execução
 * é criada CLICANDO, carimbada com o `runId` nas observações.
 *
 * **Por que esta suíte nomeia massa fixa**, contra a regra 1 do `README.md`
 * desta pasta: a regra existe para impedir que uma suíte reencontre resíduo da
 * execução anterior e o conte como seu. Aqui a OP é sempre nova; o que é fixo é
 * o produto, e ele precisa ser fixo porque a afirmação da suíte É a posição
 * dele na listagem. Um produto criado do zero nasceria em `PROD-000215` — fora
 * da primeira página também, mas provando por acidente o que aqui é escolhido.
 * Se a base for recarregada e `PROD-000214` deixar de existir ou entrar na
 * primeira página, esta suíte REPROVA dizendo o que leu, em vez de passar sem
 * medir nada.
 *
 * Nada é verificado por API nem por SQL: o que a suíte lê é o que a pessoa lê.
 *
 *   node scripts/e2e/ordem-de-producao-produto-fora-da-primeira-pagina.mjs
 */

const PRODUTO_CODIGO = "PROD-000214";
const PRODUTO_NOME = "CREATINA SENIOR FRUTAS VERMELHAS SC 1KG + ATIVO";
const UNIDADE_DO_PA = "un";
const MENSAGEM_FALSA = "Produto sem item de produto acabado válido.";
const PAGINA_DA_TELA = 50;

const run = obterRun({ novo: true, dono: "fix-03" });

const falhas = [];
function afirmar(descricao, condicao, detalhe = "") {
  if (condicao) {
    console.log(`  ok   ${descricao}`);
    return true;
  }
  falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  console.log(`  FALHA ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  return false;
}

function conferir(descricao, obtido, esperado) {
  return afirmar(`${descricao}: ${obtido}`, obtido === esperado, `esperado "${esperado}"`);
}

/** Escolhe uma opção do campo de busca de entidade digitando, como a pessoa faz. */
async function escolherNoCampo(pagina, campoId, termo, codigoEsperado) {
  const campo = pagina.locator(`#${campoId}`);
  await campo.click();
  await campo.fill("");
  await campo.type(termo, { delay: 20 });
  const opcao = pagina.locator('[role="option"]', { hasText: codigoEsperado }).first();
  await opcao.waitFor({ state: "visible", timeout: 10000 });
  await opcao.click();
}

/** O valor do campo `Quantidade planejada` já formatado pela tela, ou o texto quando congelado. */
async function lerValorDoCampoProduto(pagina) {
  return pagina.locator("#op-product").inputValue();
}

async function main() {
  const { pagina, api, erros, fechar } = await abrirNavegador();

  try {
    console.log(`\nFIX-03 — OP com produto fora da primeira página (run ${run.runId})\n`);

    /*
      1. A premissa da suíte, medida PELA TELA: o produto alvo não está entre
      os 50 que a listagem entrega na primeira página. Sem isto o resto passa
      sem provar nada.
    */
    console.log("1. o produto alvo está fora da primeira página da listagem");
    await pagina.goto(`${WEB}/cadastros/produtos`, { waitUntil: "networkidle" });
    const codigosDaPrimeiraPagina = await pagina.evaluate(() =>
      [...document.querySelectorAll("table tbody tr td:first-child")]
        .map((td) => td.textContent.trim())
        .filter((texto) => /^PROD-\d+$/.test(texto)),
    );
    afirmar(
      `listagem entrega ${codigosDaPrimeiraPagina.length} produtos na primeira página`,
      codigosDaPrimeiraPagina.length > 0,
    );
    afirmar(
      `${PRODUTO_CODIGO} NÃO está entre os primeiros ${PAGINA_DA_TELA} produtos`,
      !codigosDaPrimeiraPagina.slice(0, PAGINA_DA_TELA).includes(PRODUTO_CODIGO),
      `primeiros códigos: ${codigosDaPrimeiraPagina.slice(0, 3).join(", ")}…`,
    );

    /*
      2. A OP nasce clicando. Escolher o produto aqui SEMPRE funcionou — a
      busca vai ao servidor. O defeito só aparece ao reabrir a ordem.
    */
    console.log("\n2. criar a OP pela interface");
    await pagina.goto(`${WEB}/producao/ordens/nova`, { waitUntil: "networkidle" });
    await escolherNoCampo(pagina, "op-product", PRODUTO_CODIGO, PRODUTO_CODIGO);
    await pagina.fill("#op-quantity", "2");
    await pagina.fill("#op-notes", `E2E ${run.runId} — FIX-03`);
    await pagina.getByRole("button", { name: "Salvar rascunho" }).click();
    await pagina.waitForURL(/\/producao\/ordens\/[0-9a-f-]{36}$/, { timeout: 15000 });
    const urlDaOrdem = pagina.url();
    // O título só troca quando a ordem gravada chega: `waitForURL` acerta a
    // rota antes de a tela ter o código.
    await pagina.waitForFunction(
      () => /^OP-\d+$/.test(document.querySelector("h1")?.textContent?.trim() ?? ""),
      { timeout: 15000 },
    );
    const codigoDaOrdem = (await pagina.locator("h1").first().textContent())?.trim();
    afirmar(`ordem criada: ${codigoDaOrdem}`, /^OP-\d+$/.test(codigoDaOrdem ?? ""));

    /*
      3. O cenário do defeito: carga FRIA da tela de detalhe. A página busca a
      OP por ID e a primeira página de produtos — e o produto da ordem não está
      nela.
    */
    console.log("\n3. reabrir a ordem em carga fria");
    await pagina.goto(urlDaOrdem, { waitUntil: "networkidle" });

    conferir(
      "campo Produto mostra o produto da ordem",
      await lerValorDoCampoProduto(pagina),
      `${PRODUTO_CODIGO} · ${PRODUTO_NOME}`,
    );
    afirmar(
      "a mensagem falsa não aparece",
      (await pagina.getByText(MENSAGEM_FALSA).count()) === 0,
    );
    afirmar(
      "a tela não acusa falta de formulação ativa",
      (await pagina.getByText("Produto sem formulação ativa.").count()) === 0,
    );

    // A unidade de saída da ordem vem do item de produto acabado — é o PA
    // aparecendo na tela.
    const unidade = await pagina
      .locator(".field", { has: pagina.locator("label", { hasText: /^Unidade$/ }) })
      .locator(".field-readonly-value")
      .first()
      .textContent();
    conferir("unidade de saída vem do item de produto acabado", unidade?.trim(), UNIDADE_DO_PA);

    /*
      4. A ação que a mensagem falsa mandava a pessoa não tentar. Planejar
      exige, no servidor, exatamente o que a tela dizia faltar.
    */
    console.log("\n4. planejar a OP — a ação que a mensagem falsa desaconselhava");
    // Desde PRODUCTION-ROUTE-ASSIGNMENT-01 a ordem sem roteiro não planeja; o
    // roteiro não é o assunto desta suíte.
    await aplicarRoteiroNaOrdem(api, urlDaOrdem.split("/").pop(), {
      unidade: UNIDADE_DO_PA,
      nome: `Roteiro FIX-03 ${run.runId}`,
    });
    await pagina.goto(urlDaOrdem, { waitUntil: "networkidle" });
    await pagina.getByRole("button", { name: "Planejar OP" }).click();
    await pagina.getByText("Planejada", { exact: true }).first().waitFor({ timeout: 30000 });
    afirmar("ordem chegou a Planejada", true);
    conferir(
      "produto congelado na ordem planejada",
      (
        await pagina
          .locator(".field", { has: pagina.locator("label", { hasText: /^Produto/ }) })
          .locator(".field-readonly-value")
          .first()
          .textContent()
      )?.trim(),
      `${PRODUTO_CODIGO} — ${PRODUTO_NOME}`,
    );

    /*
      5. O Produto e o seu item de produto acabado, na tela de cadastro. A tela
      da OP não oferece link para o produto; a navegação é pelo menu, como a
      pessoa faria.
    */
    console.log("\n5. o Produto e o PA no cadastro");
    await pagina.goto(`${WEB}/cadastros/produtos`, { waitUntil: "networkidle" });
    await pagina.fill("#products-search", PRODUTO_CODIGO);
    const linha = pagina.locator("tbody tr", { hasText: PRODUTO_CODIGO }).first();
    await linha.waitFor({ timeout: 15000 });
    await linha.click();
    await pagina.getByText(PRODUTO_NOME).first().waitFor({ timeout: 15000 });
    afirmar(
      "o produto não é acusado de estar sem item de produto acabado",
      (await pagina.getByText(/não tem item de produto acabado vinculado/i).count()) === 0,
    );

    /*
      6. A massa desta execução sai pelo caminho oficial. Uma suíte que deixa
      OP planejada para trás transforma a base de amanhã no laboratório sujo
      que o `README.md` desta pasta descreve.
    */
    console.log("\n6. cancelar a OP desta execução");
    await pagina.goto(urlDaOrdem, { waitUntil: "networkidle" });
    await pagina.getByRole("button", { name: "Cancelar OP" }).first().click();
    await pagina.fill("#op-cancel-reason", `Massa de E2E ${run.runId} — FIX-03`);
    await pagina.locator(".confirm-dialog__actions").getByRole("button", { name: "Cancelar OP" }).click();
    await pagina.getByText("Cancelada", { exact: true }).first().waitFor({ timeout: 20000 });
    afirmar("OP da execução cancelada pelo fluxo oficial", true);

    console.log("\n7. console");
    afirmar("console limpo", erros.length === 0, erros.slice(0, 5).join(" | "));
  } finally {
    await fechar();
  }

  console.log("");
  if (falhas.length > 0) {
    console.log(`REPROVADO — ${falhas.length} falha(s):`);
    for (const falha of falhas) console.log(`  - ${falha}`);
    process.exitCode = 1;
    return;
  }
  console.log("APROVADO");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
