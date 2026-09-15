import { exigir } from "./fixtures/api.mjs";
import { criarCliente } from "./fixtures/cadastros.mjs";
import { criarProdutoDoProjeto, criarProjeto, lerVersaoDoServidor, linhaDoProduto } from "./fixtures/comercial.mjs";
import {
  aguardarReleitura,
  aprovarProjeto,
  criarNovaVersao,
  enviarAoCliente,
  esperarProjetoNaTela,
  esperarVersaoNaTela,
  gerarPedido,
  registrarAceite,
  rotaDoProjeto,
  voltarAoProjeto,
} from "./fixtures/comercial-ui.mjs";
import { carimbar, criarRun } from "./fixtures/run.mjs";
import { abrirNavegador, WEB } from "./lib/browser.mjs";

/**
 * De onde vem o preço da recompra — COM-PRICE, §74, pelo fluxo da página própria
 * da versão (E2E-BASELINE-REDESIGN-WAVE-03).
 *
 * Um Projeto aprovado volta a comprar. A proposta nova diz de onde saiu o preço,
 * e quem decide é quem negocia — não o sistema, em silêncio.
 *
 * O acordo nasce clicando: versão → aceite → ficha → aprovar Projeto → de volta
 * à versão → Fechamento → Pedido. Então, três formações de preço:
 *
 *   1. CONDIÇÃO VIGENTE, mesma quantidade — a V2 nasce com o preço acordado e a
 *      origem visível; enviar, aceitar e gerar o Pedido leva aquele preço até o
 *      Pedido;
 *   2. QUANTIDADE DIFERENTE — a V3 solta o preço, a tela diz para qual quantidade
 *      a condição foi negociada, manter sem motivo é recusado (409 provocado e
 *      declarado) e, com motivo, o preço volta;
 *   3. REAJUSTE PERCENTUAL — 8% sobre a condição, com prévia na tela e o valor
 *      fechado pelo servidor.
 *
 * O Cliente é da própria execução — a suíte usava o código fixo de um cliente da
 * carga antiga.
 * Cliente, Projeto e Produto nascem por API; tudo o que forma preço, pela tela.
 * Origem e preço gravados são conferidos por GET.
 *
 *   pnpm e2e:run --suites=formacao-de-preco-do-novo-orcamento
 */

const run = criarRun();

const QUANTIDADE = "1000";
const QUANTIDADE_MENOR = "500";
const PRECO_ACORDADO = "12,50";
const PRECO_REAJUSTADO = "13,50";
const VALIDADE_FUTURA = "2099-12-31";
const REAJUSTE = "8";

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
  const { pagina, api, erros, errosHttp, esperarErroHttp, fechar } = await abrirNavegador();

  const assentar = () => pagina.waitForTimeout(400);
  const esperarStatus = (status) =>
    pagina.waitForFunction(
      (esperado) => document.querySelector(".doc-title > span")?.textContent?.trim() === esperado,
      status,
      { timeout: 25000 },
    );
  const textoDaPagina = () => pagina.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

  const gravarCampoDaLinha = async (campo, valor) => {
    const releitura = aguardarReleitura(pagina);
    await campo.fill(valor);
    await campo.blur();
    await releitura;
    await assentar();
  };

  /** Validade gravada — na recompra ela já nasce sugerida, e "Salvar condições" fica desabilitado. */
  const definirValidade = async (valor) => {
    await pagina.locator("#quote-valid-until").fill(valor);
    const salvar = pagina.getByRole("button", { name: "Salvar condições", exact: true });
    if (await salvar.isEnabled()) {
      const releitura = aguardarReleitura(pagina);
      await salvar.click();
      await releitura;
      await assentar();
    }
  };

  const abrirPelaFicha = async (rotulo) => {
    await pagina.getByRole("link", { name: `Abrir ${rotulo}`, exact: true }).click();
    return esperarVersaoNaTela(pagina);
  };

  try {
    // ── 0. Massa ────────────────────────────────────────────────────────
    console.log(`\n[0] Cliente, Projeto e Produto desta execução, por API (${run.runId})`);

    const cliente = await criarCliente(api, run, { nome: carimbar(run, "Cliente Formacao") });
    const projeto = await criarProjeto(api, run, { cliente, nome: carimbar(run, "Projeto Formacao") });
    const produto = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto Formacao") });
    const urlDoProjeto = `${WEB}${rotaDoProjeto(projeto.id)}`;
    const campoQuantidade = () => pagina.getByLabel(`Quantidade de ${produto.codigo}`);
    const campoPreco = () => pagina.getByLabel(`Preço unitário de ${produto.codigo}`);
    const sugestao = () => pagina.locator("tr.quote-suggestion");

    // ── 1. O acordo nasce ───────────────────────────────────────────────
    console.log(`\n== ciclo 1 — o acordo nasce`);

    await pagina.goto(urlDoProjeto);
    await esperarProjetoNaTela(pagina);
    const v1 = await criarNovaVersao(pagina, { botao: "Criar nova versão" });
    afirmar("a ficha cria a V1", v1.id === v1.resposta.id, v1.rotulo);

    const releituraDaLinha = aguardarReleitura(pagina);
    await pagina.locator("#quote-add-product").selectOption({ label: `${produto.codigo} · ${produto.nome}` });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).click();
    await releituraDaLinha;
    await campoQuantidade().waitFor({ timeout: 25000 });
    await gravarCampoDaLinha(campoQuantidade(), QUANTIDADE);
    await gravarCampoDaLinha(campoPreco(), PRECO_ACORDADO);
    await definirValidade(VALIDADE_FUTURA);
    afirmar("V1 enviada", (await enviarAoCliente(pagina)).status === 200);
    await esperarStatus("Enviado");
    afirmar("V1 aceita na página da versão", (await registrarAceite(pagina)).status === 200);
    await esperarStatus("Aceito");

    await voltarAoProjeto(pagina);
    const aprovacao = await aprovarProjeto(pagina);
    afirmar("Projeto aprovado na ficha", aprovacao.status === 200 && aprovacao.projeto?.status === "APPROVED", `${aprovacao.status}`);
    await esperarStatus("Aprovado");

    const deVoltaNaV1 = await abrirPelaFicha(v1.rotulo);
    afirmar("de volta à V1 pela ficha", deVoltaNaV1.id === v1.id, deVoltaNaV1.rotulo);
    const pedido1 = await gerarPedido(pagina);
    afirmar("Fechamento → Pedido 1: o acordo passa a ser história com Pedido", pedido1.status === 201, pedido1.pedido?.codigo ?? "");

    // ── Cenário 1 ───────────────────────────────────────────────────────
    console.log(`\n== cenário 1 — condição vigente e mesma quantidade`);

    await pagina.goto(urlDoProjeto);
    await esperarProjetoNaTela(pagina);
    const v2 = await criarNovaVersao(pagina, { botao: "Novo orçamento" });
    afirmar("“Novo orçamento” abre a V2", / · V2$/.test(v2.rotulo ?? ""), v2.rotulo);
    await sugestao().locator(".quote-suggestion__row", { hasText: "Condição acordada" }).waitFor({ timeout: 25000 });

    const comAcordo = (await sugestao().innerText()).replace(/\s+/g, " ");
    const [codigoDaV1] = v1.rotulo.split(" · ");
    afirmar("a tela pergunta como formar o preço", comAcordo.includes("Como formar o preço?"));
    afirmar(
      "e mostra a condição acordada, com o documento e a validade",
      comAcordo.includes("Condição acordada") && comAcordo.includes(codigoDaV1) && comAcordo.includes("válida até 31/12/2099"),
      comAcordo.slice(0, 160),
    );
    afirmar("a linha nasce com o preço do acordo", (await campoPreco().inputValue()) === PRECO_ACORDADO, await campoPreco().inputValue());
    afirmar("nenhum aviso de quantidade diferente — a quantidade é a mesma", !comAcordo.includes("foi negociada para"));
    const herdada = linhaDoProduto(await lerVersaoDoServidor(api, { versao: v2 }), produto);
    afirmar("a origem gravada é a condição acordada", herdada.origem === "INHERITED_AGREEMENT", herdada.origem);

    await definirValidade(VALIDADE_FUTURA);
    afirmar("V2 enviada", (await enviarAoCliente(pagina)).status === 200);
    await esperarStatus("Enviado");
    afirmar("V2 aceita", (await registrarAceite(pagina)).status === 200);
    await esperarStatus("Aceito");
    const pedido2 = await gerarPedido(pagina);
    afirmar("Fechamento da V2 → Pedido 2", pedido2.status === 201 && pedido2.pedido !== null, pedido2.pedido?.codigo ?? "");
    await pagina.waitForFunction((codigo) => document.body.innerText.includes(codigo), pedido2.pedido.codigo, { timeout: 25000 });
    const doPedido = await exigir(api, "GET", `/customer-orders/${pedido2.pedido.id}`);
    afirmar(
      "o Pedido novo carrega o preço da condição mantida",
      doPedido.lines.length === 1 && doPedido.lines.every((linha) => Number(linha.agreedPrice?.unitPrice) === 12.5),
      doPedido.lines.map((linha) => linha.agreedPrice?.unitPrice ?? "sem preço acordado").join(", "),
    );
    afirmar("e a tela do Pedido mostra esse preço", (await textoDaPagina()).includes(`R$ ${PRECO_ACORDADO}`));
    afirmar("e aponta para a V2", doPedido.commercialOrigin?.quoteVersionId === v2.id);

    // ── Cenário 2 ───────────────────────────────────────────────────────
    console.log(`\n== cenário 2 — quantidade diferente exige decisão explícita`);

    await pagina.goto(urlDoProjeto);
    await esperarProjetoNaTela(pagina);
    const v3 = await criarNovaVersao(pagina, { botao: "Novo orçamento" });
    afirmar("“Novo orçamento” abre a V3", / · V3$/.test(v3.rotulo ?? ""), v3.rotulo);
    await campoQuantidade().waitFor({ timeout: 25000 });
    await gravarCampoDaLinha(campoQuantidade(), QUANTIDADE_MENOR);
    await sugestao().locator(".field__hint", { hasText: "foi negociada para" }).waitFor({ timeout: 25000 });

    afirmar(
      "mudar a quantidade solta o preço herdado — ele era de outra negociação",
      (await campoPreco().inputValue()) === "",
      await campoPreco().inputValue(),
    );
    const comAviso = (await sugestao().innerText()).replace(/\s+/g, " ");
    afirmar(
      "a tela diz para qual quantidade a condição foi negociada",
      comAviso.includes("foi negociada para 1.000") && comAviso.includes("está em 500"),
      comAviso.match(/A condição anterior[^.]*\.[^.]*\./)?.[0] ?? comAviso.slice(0, 160),
    );

    esperarErroHttp({ status: 409, metodo: "POST", caminho: /^\/quote-lines\/[0-9a-f-]{36}\/inherit-price$/ });
    const recusa = pagina.waitForResponse((r) => r.status() === 409, { timeout: 25000 });
    recusa.catch(() => {});
    await sugestao().getByRole("button", { name: "Manter condição", exact: true }).click();
    await recusa;
    const campoMotivo = pagina.getByLabel(`Motivo para a condição de ${produto.codigo}`);
    await campoMotivo.waitFor({ timeout: 25000 });
    afirmar("manter a condição sem motivo é recusado e a tela pede o motivo", (await textoDaPagina()).includes("Informe o motivo"));

    const motivo = `Cliente estratégico — recompra menor ${run.runId}`;
    await campoMotivo.fill(motivo);
    const releituraDoMotivo = aguardarReleitura(pagina);
    await sugestao().getByRole("button", { name: "Confirmar", exact: true }).click();
    await releituraDoMotivo;
    await assentar();
    afirmar(
      "com o motivo, a decisão comercial passa e o preço volta",
      (await campoPreco().inputValue()) === PRECO_ACORDADO,
      await campoPreco().inputValue(),
    );
    const mantida = linhaDoProduto(await lerVersaoDoServidor(api, { versao: v3 }), produto);
    afirmar(
      "a exceção fica gravada com o motivo",
      mantida.origem === "INHERITED_AGREEMENT" && mantida.motivo === motivo,
      `${mantida.origem} · ${mantida.motivo}`,
    );

    // ── Cenário 3 ───────────────────────────────────────────────────────
    console.log(`\n== cenário 3 — reajuste percentual sobre a condição`);

    await pagina.getByLabel(`Percentual de reajuste de ${produto.codigo}`).fill(REAJUSTE);
    const comPrevia = (await sugestao().innerText()).replace(/\s+/g, " ");
    afirmar("a tela mostra a prévia do novo preço", comPrevia.includes(`Novo preço R$ ${PRECO_REAJUSTADO}`), comPrevia.match(/Novo preço R\$ [\d.,]+/)?.[0] ?? "");

    const releituraDoReajuste = aguardarReleitura(pagina);
    await sugestao().getByRole("button", { name: "Aplicar reajuste", exact: true }).click();
    await releituraDoReajuste;
    await assentar();
    afirmar("o servidor fecha 8% sobre 12,50 em 13,50", (await campoPreco().inputValue()) === PRECO_REAJUSTADO, await campoPreco().inputValue());
    const reajustada = linhaDoProduto(await lerVersaoDoServidor(api, { versao: v3 }), produto);
    afirmar(
      "com a origem de reajuste sobre o acordo",
      reajustada.origem === "ADJUSTED_AGREEMENT" && Number(reajustada.preco) === 13.5,
      `${reajustada.origem} · ${reajustada.preco}`,
    );

    const provocadas = errosHttp.filter((erro) => erro.status === 409);
    afirmar(
      "console e rede limpos — só o 409 provocado, declarado",
      erros.length === 0 && provocadas.length === 1,
      [...erros.slice(0, 3), `409 × ${provocadas.length}`].join(" | "),
    );
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
  console.log("OK — a recompra forma o preço às claras: acordo mantido, exceção com motivo e reajuste pelo servidor.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
