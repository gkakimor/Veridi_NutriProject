import { exigir } from "./fixtures/api.mjs";
import { criarCliente } from "./fixtures/cadastros.mjs";
import { criarProdutoDoProjeto, criarProjeto } from "./fixtures/comercial.mjs";
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
 * O mesmo Projeto vende duas vezes — COM-CORE, pelo fluxo da página própria da
 * versão (E2E-BASELINE-REDESIGN-WAVE-03).
 *
 * A regra antiga travava versão nova em Projeto aprovado e mandava criar outro
 * Projeto para o mesmo cliente. Hoje o aceite mora na página da versão, a
 * aprovação na ficha do Projeto, e o Pedido nasce no Fechamento da versão
 * aceita quando o Projeto já está aprovado.
 *
 * Esta suíte percorre, clicando:
 *
 *   1. ficha → V1 → produto, preço e validade → enviar → aceitar (na versão) →
 *      o Fechamento explica que falta aprovar → ficha → aprovar → V1 →
 *      Fechamento → PEDIDO 1;
 *   2. MESMO Projeto, já aprovado → "Novo orçamento" → V2 com preço renegociado
 *      → enviar → aceitar → a ficha lista a V1 ainda aceita, com o Pedido 1, e a
 *      V2 aceita → V2 → Fechamento → PEDIDO 2, que aponta para a V2;
 *   3. a proposta vencida: V3 enviada com validade passada diz "Vencido", explica
 *      que a janela de aceite fechou e não deixa aceitar.
 *
 * Cliente, Projeto e Produto nascem por API — a suíte procurava um cliente pelo
 * código fixo da carga antiga, que a base não tem. Versões, envio, aceite,
 * aprovação e Pedido, pela tela; a origem de cada Pedido é conferida por GET.
 *
 *   pnpm e2e:run --suites=projeto-aprovado-vende-de-novo
 */

const run = criarRun();

const QUANTIDADE = "100";
const PRECO_CICLO_1 = "12,50";
const PRECO_CICLO_2 = "13,90";
const VALIDADE_FUTURA = "2099-12-31";
const VALIDADE_VENCIDA = "2020-01-31";

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

  const assentar = () => pagina.waitForTimeout(400);
  const statusNoTitulo = async () => (await pagina.locator(".doc-title > span").first().innerText()).trim();
  const esperarStatus = (status) =>
    pagina.waitForFunction(
      (esperado) => document.querySelector(".doc-title > span")?.textContent?.trim() === esperado,
      status,
      { timeout: 25000 },
    );

  /** Um campo que grava ao sair, e a releitura que ele dispara. */
  const gravarCampoDaLinha = async (campo, valor) => {
    const releitura = aguardarReleitura(pagina);
    await campo.fill(valor);
    await campo.blur();
    await releitura;
    await assentar();
  };

  /**
   * Validade gravada. "Salvar condições" fica desabilitado quando não há o que
   * gravar — a versão da recompra já nasce com a validade da condição vigente
   * sugerida (§74) —, e aí não se clica.
   */
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

  /** A tabela de versões da ficha, como a pessoa a lê. */
  const versoesDaFicha = () =>
    pagina.evaluate(() => {
      const tabela = [...document.querySelectorAll("table")].find((t) =>
        /Versão/.test(t.querySelector("thead")?.textContent ?? ""),
      );
      return [...(tabela?.querySelectorAll("tbody tr") ?? [])]
        .filter((tr) => tr.querySelector("td.is-code"))
        .map((tr) => {
          const celulas = [...tr.children].map((td) => td.textContent.trim().replace(/\s+/g, " "));
          return { versao: celulas[0] ?? "", validade: celulas[4] ?? "", status: celulas[5] ?? "" };
        });
    });

  const abrirPelaFicha = async (rotulo) => {
    await pagina.getByRole("link", { name: `Abrir ${rotulo}`, exact: true }).click();
    return esperarVersaoNaTela(pagina);
  };

  const origemDoPedido = async (pedido) =>
    (await exigir(api, "GET", `/customer-orders/${pedido.id}`)).commercialOrigin?.quoteVersionId ?? null;

  try {
    // ── 0. Massa ────────────────────────────────────────────────────────
    console.log(`\n[0] Cliente, Projeto e Produto desta execução, por API (${run.runId})`);

    const cliente = await criarCliente(api, run, { nome: carimbar(run, "Cliente Recompra") });
    const projeto = await criarProjeto(api, run, { cliente, nome: carimbar(run, "Projeto Recompra") });
    const produto = await criarProdutoDoProjeto(api, run, { projeto, nome: carimbar(run, "Produto Recompra") });
    const urlDoProjeto = `${WEB}${rotaDoProjeto(projeto.id)}`;
    const campoPreco = () => pagina.getByLabel(`Preço unitário de ${produto.codigo}`);

    // ── 1. Ciclo 1 ──────────────────────────────────────────────────────
    console.log(`\n== ciclo 1 — Projeto novo`);

    await pagina.goto(urlDoProjeto);
    await esperarProjetoNaTela(pagina);
    const v1 = await criarNovaVersao(pagina, { botao: "Criar nova versão" });
    afirmar("a ficha cria a V1", v1.id === v1.resposta.id && / · V1$/.test(v1.rotulo ?? ""), v1.rotulo);

    const releituraDaLinha = aguardarReleitura(pagina);
    await pagina.locator("#quote-add-product").selectOption({ label: `${produto.codigo} · ${produto.nome}` });
    await pagina.getByRole("button", { name: "Adicionar", exact: true }).click();
    await releituraDaLinha;
    await pagina.getByLabel(`Quantidade de ${produto.codigo}`).waitFor({ timeout: 25000 });
    await gravarCampoDaLinha(pagina.getByLabel(`Quantidade de ${produto.codigo}`), QUANTIDADE);
    await gravarCampoDaLinha(campoPreco(), PRECO_CICLO_1);
    await definirValidade(VALIDADE_FUTURA);

    afirmar("V1 enviada", (await enviarAoCliente(pagina)).status === 200);
    await esperarStatus("Enviado");
    afirmar("V1 aceita na página da versão", (await registrarAceite(pagina)).status === 200);
    await esperarStatus("Aceito");

    const fechamentoAntes = (await pagina.locator(".quote-closing").innerText()).replace(/\s+/g, " ");
    afirmar("aceita, o Fechamento diz que o Projeto ainda precisa de aprovação", fechamentoAntes.includes("Ainda precisa de aprovação"));
    afirmar(
      "e não oferece gerar Pedido antes da aprovação",
      (await pagina.getByRole("button", { name: "Gerar pedido a partir do orçamento aceito" }).count()) === 0,
    );

    await voltarAoProjeto(pagina);
    const aprovacao = await aprovarProjeto(pagina);
    afirmar("a aprovação mora na ficha e pergunta antes", aprovacao.pergunta === "Aprovar o projeto?", aprovacao.pergunta);
    afirmar("o Projeto é aprovado", aprovacao.status === 200 && aprovacao.projeto?.status === "APPROVED", `${aprovacao.status}`);
    await esperarStatus("Aprovado");
    afirmar("a ficha diz Aprovado", (await statusNoTitulo()) === "Aprovado");
    afirmar(
      "a ficha lista a V1 aceita",
      (await versoesDaFicha()).some((linha) => linha.versao === v1.rotulo && linha.status.includes("Aceito")),
      JSON.stringify(await versoesDaFicha()),
    );

    const v1Aberta = await abrirPelaFicha(v1.rotulo);
    afirmar("de volta à V1 pela ficha", v1Aberta.id === v1.id, v1Aberta.rotulo);
    afirmar(
      "com o Projeto aprovado, o Fechamento diz Aprovado",
      (await pagina.locator(".quote-closing").innerText()).includes("Aprovado"),
    );
    const pedido1 = await gerarPedido(pagina);
    afirmar("ciclo 1 gerou um Pedido pelo Fechamento", pedido1.status === 201 && pedido1.pedido !== null, pedido1.pedido?.codigo ?? "");
    await pagina.waitForFunction((codigo) => document.body.innerText.includes(codigo), pedido1.pedido.codigo, { timeout: 25000 });
    afirmar("a tela do Pedido 1 abre", true, pedido1.pedido.codigo);
    afirmar("o Pedido 1 aponta para a V1", (await origemDoPedido(pedido1.pedido)) === v1.id);

    // ── 2. Ciclo 2 ──────────────────────────────────────────────────────
    console.log(`\n== ciclo 2 — o MESMO Projeto, já aprovado`);

    await pagina.goto(urlDoProjeto);
    await esperarProjetoNaTela(pagina);
    afirmar("a ficha continua Aprovado", (await statusNoTitulo()) === "Aprovado");
    afirmar(
      "Projeto aprovado oferece “Novo orçamento”",
      await pagina.getByRole("button", { name: "Novo orçamento", exact: true }).isVisible(),
    );
    afirmar(
      "e não manda criar outro Projeto",
      !(await pagina.evaluate(() => document.body.innerText.includes("crie um projeto novo"))),
    );

    const v2 = await criarNovaVersao(pagina, { botao: "Novo orçamento" });
    afirmar("“Novo orçamento” cria a V2 no mesmo Projeto", v2.id === v2.resposta.id && / · V2$/.test(v2.rotulo ?? ""), v2.rotulo);
    await campoPreco().waitFor({ timeout: 25000 });
    await gravarCampoDaLinha(campoPreco(), PRECO_CICLO_2);
    afirmar("a V2 renegocia o preço", (await campoPreco().inputValue()) === PRECO_CICLO_2, await campoPreco().inputValue());
    await definirValidade(VALIDADE_FUTURA);

    afirmar("V2 enviada", (await enviarAoCliente(pagina)).status === 200);
    await esperarStatus("Enviado");
    afirmar("V2 aceita", (await registrarAceite(pagina)).status === 200);
    await esperarStatus("Aceito");

    await voltarAoProjeto(pagina);
    const versoes = await versoesDaFicha();
    const linhaV1 = versoes.find((linha) => linha.versao === v1.rotulo);
    const linhaV2 = versoes.find((linha) => linha.versao === v2.rotulo);
    afirmar("a ficha lista as duas versões", versoes.length >= 2 && linhaV1 && linhaV2, JSON.stringify(versoes));
    afirmar("a V1 continua ACEITA — ela é a origem do Pedido 1", (linhaV1?.status ?? "").includes("Aceito"), linhaV1?.status);
    afirmar("e diz qual Pedido originou", (linhaV1?.status ?? "").includes(pedido1.pedido.codigo), linhaV1?.status);
    afirmar("a V2 está aceita", (linhaV2?.status ?? "").includes("Aceito"), linhaV2?.status);

    const v2Aberta = await abrirPelaFicha(v2.rotulo);
    afirmar("de volta à V2 pela ficha", v2Aberta.id === v2.id, v2Aberta.rotulo);
    const pedido2 = await gerarPedido(pagina);
    afirmar("ciclo 2 gerou um Pedido próprio", pedido2.status === 201 && pedido2.pedido !== null, pedido2.pedido?.codigo ?? "");
    await pagina.waitForFunction((codigo) => document.body.innerText.includes(codigo), pedido2.pedido.codigo, { timeout: 25000 });
    afirmar(
      "os dois Pedidos são diferentes",
      pedido1.pedido.id !== pedido2.pedido.id && pedido1.pedido.codigo !== pedido2.pedido.codigo,
      `${pedido1.pedido.codigo} × ${pedido2.pedido.codigo}`,
    );
    afirmar(
      "e cada Pedido aponta para a SUA proposta",
      (await origemDoPedido(pedido1.pedido)) === v1.id && (await origemDoPedido(pedido2.pedido)) === v2.id,
    );

    // ── 3. Vencida ──────────────────────────────────────────────────────
    console.log(`\n== cenário 3 — proposta vencida não é aceita`);

    await pagina.goto(urlDoProjeto);
    await esperarProjetoNaTela(pagina);
    const v3 = await criarNovaVersao(pagina, { botao: "Novo orçamento" });
    afirmar("a V3 nasce no mesmo Projeto", / · V3$/.test(v3.rotulo ?? ""), v3.rotulo);
    await definirValidade(VALIDADE_VENCIDA);
    afirmar("V3 enviada com validade passada", (await enviarAoCliente(pagina)).status === 200);
    await esperarStatus("Enviado");

    afirmar("a proposta vencida se identifica no título", (await pagina.locator(".doc-title .badge--warn", { hasText: "Vencido" }).count()) === 1);
    const aviso = pagina.locator('.quote-workspace p[role="alert"]');
    afirmar(
      "com a explicação do que fazer",
      (await aviso.count()) === 1 && (await aviso.innerText()).includes("a janela de aceite fechou"),
      (await aviso.count()) ? (await aviso.innerText()).trim() : "(sem aviso)",
    );
    const aceite = pagina.getByRole("button", { name: "Registrar aceite", exact: true });
    afirmar("e o aceite fica bloqueado", await aceite.isDisabled());
    afirmar(
      "dizendo por quê",
      ((await aceite.getAttribute("title")) ?? "").includes("Proposta vencida em 31/01/2020"),
      await aceite.getAttribute("title"),
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
  console.log("OK — o mesmo Projeto vendeu duas vezes, e a proposta vencida não foi aceita.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
