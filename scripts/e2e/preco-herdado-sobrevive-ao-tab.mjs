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
  criarNovaVersao,
  enviarAoCliente,
  registrarAceite,
  rotaDaVersao,
  rotaDoProjeto,
  voltarAoProjeto,
} from "./fixtures/comercial-ui.mjs";
import { carimbar, criarRun } from "./fixtures/run.mjs";
import { abrirNavegador, API, WEB } from "./lib/browser.mjs";

/**
 * O preço herdado sobrevive a um Tab — QUOTE-LINE-NOOP-BLUR-01, pelo fluxo da
 * página própria da versão (E2E-BASELINE-REDESIGN-WAVE-03).
 *
 * Na recompra, a linha da versão nova nasce com o preço da condição acordada,
 * de origem herdada (§74). A tela gravava a linha a cada saída de campo, mesmo
 * sem alteração, e o servidor tratava a presença da quantidade ou da unidade no
 * pedido como mudança: passar pelo campo com Tab apagava o preço, a origem e o
 * vínculo com o acordo.
 *
 * O que esta suíte prova, clicando:
 *
 *   1. pelo fluxo real — V1 enviada e aceita na página dela, ficha, "Criar nova
 *      versão", V2 — a linha nasce com o preço herdado e a origem ligada ao
 *      acordo (não é "Duplicar como nova versão", que é outro contrato);
 *   2. passar com Tab pela quantidade, pela unidade e pelo preço, sem mudar
 *      nada, não manda nenhuma atualização de linha;
 *   3. reaberta a V2, preço, origem e vínculo continuam, e o envio segue
 *      disponível;
 *   4. mudar a quantidade DE VERDADE solta o preço herdado — a regra de §74.
 *
 * Cliente, Projeto, Produto e a V1 com linha e validade nascem por API. Envio,
 * aceite, a V2 e os campos, pela tela. Preço e origem são lidos por GET da
 * versão; as atualizações de linha são contadas na rede.
 *
 *   pnpm e2e:run --suites=preco-herdado-sobrevive-ao-tab
 */

const run = criarRun();

const VALIDADE = "2099-12-31";
const PRECO_NA_TELA = "12,50";

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

  /** Toda atualização de linha que sair do navegador — observada, nunca feita pela suíte. */
  const atualizacoes = [];
  pagina.on("request", (requisicao) => {
    const url = requisicao.url();
    if (
      requisicao.method() === "PATCH" &&
      url.startsWith(`${API}/`) &&
      /^\/quote-lines\/[0-9a-f-]{36}$/.test(new URL(url).pathname)
    ) {
      atualizacoes.push(requisicao.postData() ?? "");
    }
  });

  const assentar = () => pagina.waitForTimeout(400);
  const esperarStatus = (status) =>
    pagina.waitForFunction(
      (esperado) => document.querySelector(".doc-title > span")?.textContent?.trim() === esperado,
      status,
      { timeout: 25000 },
    );

  try {
    // ── 0. Massa ────────────────────────────────────────────────────────
    console.log(`\n[0] Cliente, Projeto, Produto e V1 com linha e validade, por API (${run.runId})`);

    const cliente = await criarCliente(api, run, { nome: carimbar(run, "Cliente Tab") });
    const projeto = await criarProjeto(api, run, { cliente, nome: carimbar(run, "Projeto Tab") });
    const produto = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto Tab") });
    const v1 = await criarVersao(api, { projeto });
    await adicionarLinha(api, { versao: v1, produto, quantidade: "1000", preco: "12.5" });
    await gravarCondicoes(api, { versao: v1, condicoes: { validUntil: VALIDADE } });

    const campoQuantidade = () => pagina.getByLabel(`Quantidade de ${produto.codigo}`);
    const campoUnidade = () => pagina.getByLabel(`Unidade de ${produto.codigo}`);
    const campoPreco = () => pagina.getByLabel(`Preço unitário de ${produto.codigo}`);

    // ── 1. V1 enviada e aceita, na página dela ──────────────────────────
    console.log(`\n[1] V1 enviada e aceita na página da versão`);

    const aberta = await abrirVersao(pagina, `${WEB}${rotaDaVersao(v1.id, { voltar: rotaDoProjeto(projeto.id) })}`);
    afirmar("a página abre a V1", aberta.id === v1.id, aberta.rotulo);
    afirmar("V1 enviada", (await enviarAoCliente(pagina)).status === 200);
    await esperarStatus("Enviado");
    afirmar("V1 aceita", (await registrarAceite(pagina)).status === 200);
    await esperarStatus("Aceito");

    // ── 2. Ficha → Criar nova versão ────────────────────────────────────
    console.log(`\n[2] Ficha → "Criar nova versão": a V2 nasce com o preço acordado`);

    await voltarAoProjeto(pagina);
    const v2 = await criarNovaVersao(pagina, { botao: "Criar nova versão" });
    afirmar("a ficha cria a V2 e abre a página dela", v2.id === v2.resposta.id && / · V2$/.test(v2.rotulo ?? ""), v2.rotulo);
    await campoPreco().waitFor({ timeout: 25000 });
    await assentar();

    const herdada = linhaDoProduto(await lerVersaoDoServidor(api, { versao: v2 }), produto);
    afirmar("a linha nasce com o preço acordado", Number(herdada.preco) === 12.5, herdada.preco);
    afirmar(
      "e com a origem herdada, ligada à linha do acordo",
      herdada.origem === "INHERITED_AGREEMENT" && herdada.herdadaDe !== null,
      `${herdada.origem} · ${herdada.herdadaDe}`,
    );
    afirmar("a tela mostra o preço herdado", (await campoPreco().inputValue()) === PRECO_NA_TELA, await campoPreco().inputValue());

    // ── 3. Tab pelos campos, sem mudar nada ─────────────────────────────
    console.log(`\n[3] Tab pela quantidade, pela unidade e pelo preço, sem mudar nada`);

    const antes = atualizacoes.length;
    for (const [nome, campo] of [
      ["quantidade", campoQuantidade],
      ["unidade", campoUnidade],
      ["preço", campoPreco],
    ]) {
      await campo().focus();
      await pagina.keyboard.press("Tab");
      await pagina.waitForTimeout(1000);
      afirmar(
        `passar pela ${nome} não manda atualização de linha`,
        atualizacoes.length === antes,
        `${atualizacoes.length - antes} pedido(s) ${atualizacoes.slice(antes).join(" ")}`,
      );
    }
    afirmar("o preço continua na tela", (await campoPreco().inputValue()) === PRECO_NA_TELA, await campoPreco().inputValue());

    // ── 4. Reaberta ─────────────────────────────────────────────────────
    console.log(`\n[4] Reaberta a V2, a decisão de preço continua a mesma`);

    await abrirVersao(pagina, v2.url);
    await campoPreco().waitFor({ timeout: 25000 });
    await assentar();
    const reaberta = linhaDoProduto(await lerVersaoDoServidor(api, { versao: v2 }), produto);
    afirmar("o preço gravado é o herdado", Number(reaberta.preco) === 12.5, reaberta.preco);
    afirmar("a origem continua herdada", reaberta.origem === "INHERITED_AGREEMENT", reaberta.origem);
    afirmar("o vínculo com a linha do acordo continua", reaberta.herdadaDe === herdada.herdadaDe, reaberta.herdadaDe);
    afirmar(
      '"Enviar ao cliente" continua disponível',
      await pagina.locator(".quote-workspace").getByRole("button", { name: "Enviar ao cliente", exact: true }).isEnabled(),
    );
    afirmar("sem aviso de envio", (await pagina.locator("#quote-send-pending").count()) === 0);

    // ── 5. Mudança REAL de quantidade ───────────────────────────────────
    console.log(`\n[5] Mudança real de quantidade — a regra de §74 continua`);

    const antesDaMudanca = atualizacoes.length;
    const releitura = aguardarReleitura(pagina);
    await campoQuantidade().fill("1200");
    await campoQuantidade().blur();
    await releitura;
    await assentar();
    afirmar(
      "a mudança real manda uma atualização",
      atualizacoes.length === antesDaMudanca + 1,
      `${atualizacoes.length - antesDaMudanca}`,
    );
    const mudada = linhaDoProduto(await lerVersaoDoServidor(api, { versao: v2 }), produto);
    afirmar("a quantidade nova foi gravada", Number(mudada.quantidade) === 1200, mudada.quantidade);
    afirmar(
      "o preço herdado foi solto, como a regra manda",
      mudada.preco === null && mudada.origem === null && mudada.herdadaDe === null,
      `${mudada.preco} · ${mudada.origem} · ${mudada.herdadaDe}`,
    );
    afirmar("a tela mostra a linha sem preço", (await campoPreco().inputValue()) === "", await campoPreco().inputValue());

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
  console.log("OK — passar pelo campo não apaga decisão de preço; mudar de verdade continua valendo.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
