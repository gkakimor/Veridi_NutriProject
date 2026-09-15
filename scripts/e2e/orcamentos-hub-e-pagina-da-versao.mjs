import { randomUUID } from "node:crypto";
import { exigir } from "./fixtures/api.mjs";
import { criarCliente } from "./fixtures/cadastros.mjs";
import {
  adicionarLinha,
  criarProdutoDoProjeto,
  criarProjeto,
  criarVersao,
  enviarVersao,
  gravarCondicoes,
  linhaDoProduto,
  precificarLinha,
  recusarVersao,
} from "./fixtures/comercial.mjs";
import { esperarVersaoNaTela } from "./fixtures/comercial-ui.mjs";
import { diaComercial } from "./fixtures/datas.mjs";
import { carimbar, criarRun } from "./fixtures/run.mjs";
import { abrirPeloMenu, escolherOpcao, esperarRota } from "./fixtures/ui.mjs";
import { abrirNavegador, API, WEB } from "./lib/browser.mjs";

/**
 * Comercial → Orçamentos e a página da versão — QUOTES-HUB-01 e
 * QUOTE-WORKSPACE-NAVIGATION-01 pelo navegador (E2E-BASELINE-REDESIGN-WAVE-03).
 *
 * A lista geral só ENCONTRA e abre: cada linha leva à página da versão
 * (`/comercial/orcamentos/:id`) com a volta para o recorte na URL. A matriz de
 * filtros do servidor mora em `api projects/lista-geral-de-orcamentos`, e a da
 * tela em `web quotes/orcamentos-lista-geral`; aqui se prova o que só o
 * navegador real prova — menu, URL, sessão, pausa da busca, seletores com busca
 * no servidor, paginação, a volta, teclado, 390px, falha e 404 —, sobre massa
 * própria:
 *
 *   A1 (Cliente A): 21 versões recusadas e 1 enviada, com data de 40 dias atrás;
 *   A2 (Cliente A): 1 rascunho de hoje;
 *   B1 (Cliente B): 1 enviada de 10 dias atrás.
 *
 * A massa nasce por API (decisão do PO): criar orçamento não é o que se prova.
 * Todo nome carrega o carimbo da execução, e a busca por ele isola a massa
 * numa base que já tem orçamentos de outras execuções.
 *
 *   pnpm e2e:run --suites=orcamentos-hub-e-pagina-da-versao
 */

const run = criarRun();

const TITULO_DO_SISTEMA = "Veridi Nutrition";
const DIA_ANTIGO = diaComercial(-40);
const DIA_RECENTE = diaComercial(-10);
const PERIODO = { de: diaComercial(-45), ate: diaComercial(-35) };
const RECUSADAS_DO_A1 = 21;

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

/** Dois conjuntos de rótulos iguais, sem repetição de nenhum lado. */
function mesmoConjunto(vistos, esperados) {
  return (
    vistos.length === esperados.length &&
    new Set(vistos).size === vistos.length &&
    esperados.every((rotulo) => vistos.includes(rotulo))
  );
}

function versoesDeOrcamento(total) {
  return `${total.toLocaleString("pt-BR")} ${total === 1 ? "versão de orçamento" : "versões de orçamento"}`;
}

/**
 * Uma versão com linha precificada, no destino pedido. A versão nova copia a
 * linha da anterior sem preço (não há acordo aceito), e a linha é achada pelo
 * produto.
 */
async function montarVersao(api, { projeto, produto, dia, destino }) {
  const criada = await criarVersao(api, { projeto });
  const precificada = criada.linhas.some((linha) => linha.produtoId === produto.id)
    ? await precificarLinha(api, { linha: linhaDoProduto(criada, produto), preco: "10" })
    : await adicionarLinha(api, { versao: criada, produto, quantidade: "100", preco: "10" });
  const condicoes = { validUntil: diaComercial(90) };
  if (dia) condicoes.quoteDate = dia;
  await gravarCondicoes(api, { versao: precificada, condicoes });
  if (destino === "DRAFT") return { ...precificada, status: "DRAFT" };
  await enviarVersao(api, { versao: precificada });
  if (destino === "SENT") return { ...precificada, status: "SENT" };
  await recusarVersao(api, { versao: precificada });
  return { ...precificada, status: "REJECTED" };
}

async function main() {
  const { pagina, api, erros, errosHttp, esperarErroHttp, fechar } = await abrirNavegador();

  /** Toda consulta da lista que sai do navegador — pela origem da API, não pelos módulos do Vite. */
  const consultas = [];
  pagina.on("request", (requisicao) => {
    if (requisicao.method() === "GET" && requisicao.url().startsWith(`${API}/quote-versions?`)) {
      consultas.push(new URL(requisicao.url()).searchParams);
    }
  });

  const respostaDaLista = (predicado = () => true) => {
    const resposta = pagina.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.url().startsWith(`${API}/quote-versions?`) &&
        predicado(new URL(r.url()).searchParams),
      { timeout: 25000 },
    );
    resposta.catch(() => {});
    return resposta;
  };
  /** O gesto que muda o recorte, a resposta que ele pediu e a tabela desenhada com ela. */
  const consultar = async (predicado, gesto) => {
    const resposta = respostaDaLista(predicado);
    await gesto();
    const respondida = await resposta;
    await pagina.locator(".table-container:not([aria-busy])").first().waitFor({ timeout: 25000 });
    await pagina.waitForTimeout(300);
    return respondida;
  };

  const parametros = () => new URL(pagina.url()).searchParams;
  const enderecoAtual = () => {
    const url = new URL(pagina.url());
    return `${url.pathname}${url.search}`;
  };
  const linhasDaLista = () =>
    pagina.locator("tbody tr").evaluateAll((linhas) =>
      linhas
        .filter((linha) => linha.querySelector("td.is-code"))
        .map((linha) => ({
          rotulo: linha.querySelector("td.is-code").textContent.trim(),
          status: linha.querySelector("td.col-label span")?.textContent.trim() ?? "",
        })),
    );
  const textoDe = async (seletor) =>
    (await pagina.locator(seletor).count()) ? (await pagina.locator(seletor).first().innerText()).trim() : null;
  const rodape = () => textoDe(".table-foot");
  const paginacao = () => textoDe(".pagination > span");
  const itensAtivosDoMenu = async () =>
    (await pagina.locator('nav#sidebar a[aria-current="page"]').allInnerTexts()).map((texto) => texto.trim());
  const tituloDaAba = async (esperado) => {
    await pagina.waitForFunction((titulo) => document.title === titulo, esperado, { timeout: 10000 }).catch(() => {});
    return pagina.title();
  };
  const botaoProxima = () => pagina.getByRole("button", { name: "Próxima", exact: true });
  const voltarParaOrcamentos = () => pagina.getByRole("link", { name: "← Voltar para Orçamentos", exact: true });

  try {
    // ── 0. Massa ────────────────────────────────────────────────────────
    console.log(`\n[0] Massa por API: 2 clientes, 3 projetos, 24 versões (${run.runId})`);

    const clienteA = await criarCliente(api, run, { nome: carimbar(run, "Cliente Hub A") });
    const clienteB = await criarCliente(api, run, { nome: carimbar(run, "Cliente Hub B") });
    const projetoA1 = await criarProjeto(api, run, { cliente: clienteA, nome: carimbar(run, "Projeto Hub A1") });
    const projetoA2 = await criarProjeto(api, run, { cliente: clienteA, nome: carimbar(run, "Projeto Hub A2") });
    const projetoB1 = await criarProjeto(api, run, { cliente: clienteB, nome: carimbar(run, "Projeto Hub B1") });
    const produtoA1 = await criarProdutoDoProjeto(api, run, { projeto: projetoA1, nome: carimbar(run, "Produto Hub A1") });
    const produtoA2 = await criarProdutoDoProjeto(api, run, { projeto: projetoA2, nome: carimbar(run, "Produto Hub A2") });
    const produtoB1 = await criarProdutoDoProjeto(api, run, { projeto: projetoB1, nome: carimbar(run, "Produto Hub B1") });

    const doA1 = [];
    for (let numero = 1; numero <= RECUSADAS_DO_A1 + 1; numero += 1) {
      doA1.push(
        await montarVersao(api, {
          projeto: projetoA1,
          produto: produtoA1,
          dia: DIA_ANTIGO,
          destino: numero <= RECUSADAS_DO_A1 ? "REJECTED" : "SENT",
        }),
      );
    }
    const rascunhoDoA2 = await montarVersao(api, { projeto: projetoA2, produto: produtoA2, destino: "DRAFT" });
    const enviadaDoB1 = await montarVersao(api, {
      projeto: projetoB1,
      produto: produtoB1,
      dia: DIA_RECENTE,
      destino: "SENT",
    });

    const todas = [...doA1, rascunhoDoA2, enviadaDoB1];
    const emAberto = todas.filter((versao) => versao.status === "DRAFT" || versao.status === "SENT");
    const recusadasDoA1 = doA1.filter((versao) => versao.status === "REJECTED");
    // Ordem da lista: data desc, código desc — a recusada de código mais baixo é a única da página 2.
    const ultimaDaPagina2 = [...recusadasDoA1].sort((a, b) => a.codigo.localeCompare(b.codigo))[0];

    const conferida = await exigir(
      api,
      "GET",
      `/quote-versions?search=${encodeURIComponent(run.carimbo)}&page=1&pageSize=100`,
    );
    if (conferida.total !== todas.length) {
      console.log(`SEM MASSA — a busca pela execução devolve ${conferida.total} versões; a massa criou ${todas.length}`);
      falhas.push("massa não conferida no servidor");
      return;
    }
    afirmar("massa conferida no servidor pela busca do carimbo", true, `${conferida.total} versões`);

    // ── 1. Menu → Orçamentos ────────────────────────────────────────────
    console.log(`\n[1] Menu → Orçamentos: padrão Em aberto, menu ativo e título da aba`);

    await pagina.goto(`${WEB}/`);
    await pagina.locator("nav#sidebar").waitFor({ timeout: 25000 });
    // A preferência de navegação chega depois da primeira pintura e redesenha o menu.
    await pagina.waitForTimeout(1500);
    const primeira = await consultar(
      () => true,
      async () => {
        await abrirPeloMenu(pagina, { grupo: "commercial", item: "Orçamentos" });
        await esperarRota(pagina, "/comercial/orcamentos");
      },
    );
    await pagina.getByRole("heading", { level: 1, name: "Orçamentos" }).waitFor({ timeout: 25000 });
    afirmar("o menu leva a Comercial → Orçamentos", new URL(pagina.url()).pathname === "/comercial/orcamentos");
    afirmar(
      "na lista, o item ativo do menu é Orçamentos",
      (await itensAtivosDoMenu()).join("|") === "Orçamentos",
      (await itensAtivosDoMenu()).join("|"),
    );
    afirmar(
      "a aba diz Orçamentos",
      (await tituloDaAba(`Orçamentos · ${TITULO_DO_SISTEMA}`)) === `Orçamentos · ${TITULO_DO_SISTEMA}`,
      await pagina.title(),
    );

    // ── 2. Padrão Em aberto ─────────────────────────────────────────────
    const consultaInicial = new URL(primeira.url()).searchParams;
    afirmar(
      "abre em Em aberto: a consulta pede Rascunho e Enviado",
      consultaInicial.get("status") === "DRAFT,SENT",
      consultaInicial.toString(),
    );
    afirmar("o padrão não vai para a URL", !parametros().has("status"), enderecoAtual());
    afirmar(
      "o filtro de status mostra Em aberto",
      (await pagina.locator("#quotes-status-filter").inputValue()) === "em-aberto",
    );
    const fila = await linhasDaLista();
    afirmar(
      "a fila só traz Rascunho e Enviado",
      fila.length > 0 && fila.every((linha) => linha.status === "Rascunho" || linha.status === "Enviado"),
      [...new Set(fila.map((linha) => linha.status))].join(", "),
    );
    const totalDaFila = (await exigir(api, "GET", "/quote-versions?status=DRAFT,SENT&page=1&pageSize=1")).total;
    afirmar(
      "o total da fila é o do servidor",
      (await rodape()) === versoesDeOrcamento(totalDaFila),
      `${await rodape()} × ${totalDaFila}`,
    );

    // ── 4. Busca ────────────────────────────────────────────────────────
    console.log(`\n[2] Busca: uma consulta depois da pausa`);

    const consultasAntesDaBusca = consultas.length;
    await consultar(
      (p) => p.get("search") === run.carimbo,
      () => pagina.locator("#quotes-search").pressSequentially(run.carimbo, { delay: 40 }),
    );
    const daBusca = consultas.slice(consultasAntesDaBusca).map((p) => p.get("search"));
    afirmar(
      "digitar consulta uma vez, com o termo inteiro",
      daBusca.length === 1 && daBusca[0] === run.carimbo,
      JSON.stringify(daBusca),
    );
    afirmar("a busca vai para a URL", parametros().get("search") === run.carimbo, enderecoAtual());
    afirmar(
      "Em aberto com a busca: as três versões abertas da execução",
      mesmoConjunto((await linhasDaLista()).map((linha) => linha.rotulo), emAberto.map((versao) => versao.rotulo)),
      (await linhasDaLista()).map((linha) => linha.rotulo).join(", "),
    );
    afirmar("o rodapé conta 3", (await rodape()) === versoesDeOrcamento(3), await rodape());

    // ── 3. Status Todos ─────────────────────────────────────────────────
    console.log(`\n[3] Todos os status`);

    const todosOsStatus = await consultar(
      (p) => !p.has("status") && p.get("search") === run.carimbo,
      () => pagina.locator("#quotes-status-filter").selectOption("todos"),
    );
    afirmar("Todos os status vai para a URL", parametros().get("status") === "todos", enderecoAtual());
    afirmar("e tira o status da consulta", !new URL(todosOsStatus.url()).searchParams.has("status"));
    afirmar("24 versões da execução", (await rodape()) === versoesDeOrcamento(todas.length), await rodape());
    afirmar("em duas páginas", (await paginacao()) === "Página 1 de 2", await paginacao());
    const pagina1 = await linhasDaLista();
    afirmar("a página 1 tem 20", pagina1.length === 20, `${pagina1.length}`);

    // ── 8. Paginação ────────────────────────────────────────────────────
    console.log(`\n[4] Paginação`);

    await consultar((p) => p.get("page") === "2", () => botaoProxima().click());
    afirmar("a página vai para a URL", parametros().get("page") === "2", enderecoAtual());
    afirmar("Página 2 de 2", (await paginacao()) === "Página 2 de 2", await paginacao());
    const pagina2 = await linhasDaLista();
    afirmar("a página 2 tem as 4 restantes", pagina2.length === 4, `${pagina2.length}`);
    afirmar(
      "as duas páginas juntas são as 24 versões da execução, sem repetir",
      mesmoConjunto(
        [...pagina1, ...pagina2].map((linha) => linha.rotulo),
        todas.map((versao) => versao.rotulo),
      ),
    );
    afirmar('"Próxima" indisponível na última página', await botaoProxima().isDisabled());
    await consultar(
      (p) => p.get("page") === "1",
      () => pagina.getByRole("button", { name: "Anterior", exact: true }).click(),
    );
    afirmar(
      "Anterior volta à página 1, que sai da URL",
      !parametros().has("page") && (await paginacao()) === "Página 1 de 2",
      enderecoAtual(),
    );

    // ── 5. Cliente ──────────────────────────────────────────────────────
    console.log(`\n[5] Cliente`);

    await consultar(
      (p) => p.get("customerId") === clienteB.id,
      () => escolherOpcao(pagina, "#quotes-customer-filter", clienteB.nome),
    );
    afirmar("o cliente vai para a URL pelo id", parametros().get("customerId") === clienteB.id, enderecoAtual());
    afirmar(
      "só a versão do cliente B",
      mesmoConjunto((await linhasDaLista()).map((linha) => linha.rotulo), [enviadaDoB1.rotulo]),
      (await linhasDaLista()).map((linha) => linha.rotulo).join(", "),
    );
    afirmar(
      "o chip diz qual cliente",
      (await pagina.locator(".filter-chip", { hasText: "Cliente:" }).innerText()).includes(clienteB.nome),
    );
    await consultar(
      (p) => !p.has("customerId") && p.get("search") === run.carimbo,
      () => pagina.getByRole("button", { name: "Remover filtro Cliente", exact: true }).click(),
    );
    afirmar("remover o chip tira o cliente", !parametros().has("customerId"), enderecoAtual());

    // ── 6. Projeto ──────────────────────────────────────────────────────
    console.log(`\n[6] Projeto`);

    await consultar(
      (p) => p.get("projectId") === projetoA2.id,
      () => escolherOpcao(pagina, "#quotes-project-filter", projetoA2.nome),
    );
    afirmar("o projeto vai para a URL pelo id", parametros().get("projectId") === projetoA2.id, enderecoAtual());
    afirmar(
      "só a versão do projeto A2",
      mesmoConjunto((await linhasDaLista()).map((linha) => linha.rotulo), [rascunhoDoA2.rotulo]),
      (await linhasDaLista()).map((linha) => linha.rotulo).join(", "),
    );
    await consultar(
      (p) => !p.has("projectId") && p.get("search") === run.carimbo,
      () => pagina.getByRole("button", { name: "Remover filtro Projeto", exact: true }).click(),
    );

    // ── 7. Período personalizado ────────────────────────────────────────
    console.log(`\n[7] Período personalizado`);

    await pagina.getByRole("button", { name: "Personalizado", exact: true }).click();
    await pagina.locator("#quotes-date-from").waitFor({ timeout: 25000 });
    await consultar(
      (p) => p.get("dateFrom") === PERIODO.de && p.get("dateTo") === PERIODO.ate,
      async () => {
        await pagina.locator("#quotes-date-from").fill(PERIODO.de);
        await pagina.locator("#quotes-date-to").fill(PERIODO.ate);
      },
    );
    afirmar(
      "o período vai para a URL em dia civil",
      parametros().get("period") === "custom" &&
        parametros().get("dateFrom") === PERIODO.de &&
        parametros().get("dateTo") === PERIODO.ate,
      enderecoAtual(),
    );
    const doPeriodo = await linhasDaLista();
    afirmar(
      "só as versões do A1, as de 40 dias atrás",
      (await rodape()) === versoesDeOrcamento(doA1.length) &&
        doPeriodo.every((linha) => doA1.some((versao) => versao.rotulo === linha.rotulo)),
      await rodape(),
    );

    // ── Recorte completo ────────────────────────────────────────────────
    console.log(`\n[8] Recorte com os seis: busca, status, cliente, projeto, período e página`);

    await consultar(
      (p) => p.get("status") === "REJECTED",
      () => pagina.locator("#quotes-status-filter").selectOption("REJECTED"),
    );
    await consultar(
      (p) => p.get("customerId") === clienteA.id,
      () => escolherOpcao(pagina, "#quotes-customer-filter", clienteA.nome),
    );
    await consultar(
      (p) => p.get("projectId") === projetoA1.id,
      () => escolherOpcao(pagina, "#quotes-project-filter", projetoA1.nome),
    );
    afirmar(
      "21 recusadas do A1, em duas páginas",
      (await rodape()) === versoesDeOrcamento(RECUSADAS_DO_A1) && (await paginacao()) === "Página 1 de 2",
      `${await rodape()} · ${await paginacao()}`,
    );
    await consultar((p) => p.get("page") === "2", () => botaoProxima().click());

    const esperados = {
      search: run.carimbo,
      status: "REJECTED",
      customerId: clienteA.id,
      projectId: projetoA1.id,
      period: "custom",
      dateFrom: PERIODO.de,
      dateTo: PERIODO.ate,
      page: "2",
    };
    const recorte = enderecoAtual();
    afirmar(
      "a URL carrega os seis",
      Object.entries(esperados).every(([chave, valor]) => parametros().get(chave) === valor) &&
        [...parametros().keys()].length === Object.keys(esperados).length,
      recorte,
    );
    const esperarChipsResolvidos = () =>
      pagina.waitForFunction(
        (codigos) => {
          const texto = document.querySelector(".filter-chips")?.textContent ?? "";
          return codigos.every((codigo) => texto.includes(codigo));
        },
        [clienteA.codigo, projetoA1.codigo],
        { timeout: 25000 },
      );
    const telaDoRecorte = async () => {
      await esperarChipsResolvidos();
      return JSON.stringify({
        endereco: enderecoAtual(),
        busca: await pagina.locator("#quotes-search").inputValue(),
        status: await pagina.locator("#quotes-status-filter").inputValue(),
        de: await pagina.locator("#quotes-date-from").inputValue(),
        ate: await pagina.locator("#quotes-date-to").inputValue(),
        chips: (await pagina.locator(".filter-chip").allInnerTexts()).map((texto) =>
          texto.replace(/×/g, "").replace(/\s+/g, " ").trim(),
        ),
        paginacao: await paginacao(),
        linhas: (await linhasDaLista()).map((linha) => linha.rotulo),
      });
    };
    const antesDeAbrir = await telaDoRecorte();
    const naPagina2 = await linhasDaLista();
    afirmar(
      "a página 2 do recorte tem a recusada mais antiga",
      mesmoConjunto(
        naPagina2.map((linha) => linha.rotulo),
        [ultimaDaPagina2.rotulo],
      ),
      naPagina2.map((linha) => linha.rotulo).join(", "),
    );
    const linhaAlvo = () =>
      pagina.locator("tbody tr", { has: pagina.locator("td.is-code", { hasText: ultimaDaPagina2.rotulo }) });

    /** Da página da versão, "← Voltar para Orçamentos" — e a lista exatamente como estava. */
    const voltarEConferir = async (gesto) => {
      await consultar(
        (p) => Object.entries(esperados).every(([chave, valor]) => chave === "period" || p.get(chave) === valor),
        async () => {
          await voltarParaOrcamentos().click();
          await esperarRota(pagina, "/comercial/orcamentos");
        },
      );
      afirmar(`${gesto}: voltar devolve exatamente a URL do recorte`, enderecoAtual() === recorte, enderecoAtual());
      const depois = await telaDoRecorte();
      afirmar(
        `${gesto}: e a tela do recorte — busca, status, cliente, projeto, período e página`,
        depois === antesDeAbrir,
        depois === antesDeAbrir ? "" : `${antesDeAbrir} × ${depois}`,
      );
    };

    /** A versão aberta a partir do recorte: a da linha, com a volta para ele. */
    const conferirVersaoAberta = async (gesto, aberta) => {
      afirmar(
        `${gesto} abre a página da versão da linha`,
        aberta.id === ultimaDaPagina2.id && aberta.rotulo === ultimaDaPagina2.rotulo,
        aberta.rotulo,
      );
      afirmar(
        `${gesto}: a página recebe a volta para o recorte e a página`,
        new URL(aberta.url).searchParams.get("voltar") === recorte,
        new URL(aberta.url).searchParams.get("voltar"),
      );
    };

    // ── 9. Clique na linha ──────────────────────────────────────────────
    console.log(`\n[9] Clique na linha, menu e título na página da versão, e a volta`);

    await linhaAlvo().locator("td.is-code").click();
    const pelaLinha = await esperarVersaoNaTela(pagina);
    await conferirVersaoAberta("o clique na linha", pelaLinha);
    afirmar(
      "na página da versão, o item ativo do menu continua Orçamentos",
      (await itensAtivosDoMenu()).join("|") === "Orçamentos",
      (await itensAtivosDoMenu()).join("|"),
    );
    const tituloDaVersao = `${ultimaDaPagina2.rotulo} · ${TITULO_DO_SISTEMA}`;
    afirmar(
      "a aba diz qual versão está aberta",
      (await tituloDaAba(tituloDaVersao)) === tituloDaVersao,
      await pagina.title(),
    );
    await voltarEConferir("clique na linha");

    // ── 10. Enter ───────────────────────────────────────────────────────
    console.log(`\n[10] Enter na linha`);

    await linhaAlvo().focus();
    await pagina.keyboard.press("Enter");
    await conferirVersaoAberta("Enter na linha", await esperarVersaoNaTela(pagina));
    await voltarEConferir("Enter");

    // ── 11. Abrir ───────────────────────────────────────────────────────
    console.log(`\n[11] Ação "Abrir"`);

    await pagina.getByRole("link", { name: `Abrir ${ultimaDaPagina2.rotulo}`, exact: true }).click();
    await conferirVersaoAberta("Abrir", await esperarVersaoNaTela(pagina));
    await voltarEConferir("Abrir");

    // ── 15. Vazio ───────────────────────────────────────────────────────
    console.log(`\n[12] Recorte sem resultado`);

    const semResultado = `${run.carimbo}-NENHUM`;
    await consultar(
      (p) => p.get("search") === semResultado,
      () => pagina.locator("#quotes-search").fill(semResultado),
    );
    const vazio = await textoDe("tbody td[colspan]");
    afirmar(
      "a tabela diz que nada casou com os filtros",
      (vazio ?? "").startsWith("Nenhum orçamento encontrado para os filtros atuais."),
      vazio ?? "(sem linha de vazio)",
    );
    afirmar("nenhuma linha de versão", (await linhasDaLista()).length === 0);
    afirmar("o rodapé conta zero", (await rodape()) === versoesDeOrcamento(0), await rodape());
    await consultar(
      (p) => p.get("status") === "DRAFT,SENT" && !p.has("search"),
      () => pagina.locator("tbody").getByRole("button", { name: "Limpar filtros", exact: true }).click(),
    );
    afirmar("Limpar filtros devolve a fila padrão, sem filtro na URL", parametros().toString() === "", enderecoAtual());

    // ── 16. Erro e Tentar novamente ─────────────────────────────────────
    console.log(`\n[13] Falha da consulta e Tentar novamente`);

    let derrubar = true;
    let derrubadas = 0;
    esperarErroHttp({ status: 500, metodo: "GET", caminho: "/quote-versions" });
    const derrubarConsulta = async (rota) => {
      if (!derrubar) {
        await rota.continue();
        return;
      }
      derrubadas += 1;
      // A resposta real dá os cabeçalhos de CORS; o status e o corpo são da falha.
      const real = await rota.fetch();
      await rota.fulfill({
        response: real,
        status: 500,
        json: { error: "internal_error", message: `Falha simulada ${run.runId}` },
      });
    };
    const ehConsultaDaLista = (url) => url.href.startsWith(`${API}/quote-versions?`);
    await pagina.route(ehConsultaDaLista, derrubarConsulta);
    await pagina.locator("#quotes-search").fill(run.carimbo);
    const alerta = pagina.locator('p.form-alert[role="alert"]');
    await alerta.waitFor({ timeout: 25000 });
    afirmar("a falha foi provocada", derrubadas >= 1, `${derrubadas}`);
    afirmar(
      "a falha aparece como aviso, com Tentar novamente",
      await alerta.getByRole("button", { name: "Tentar novamente", exact: true }).isVisible(),
      (await alerta.innerText()).trim(),
    );
    afirmar(
      'e a tabela não responde "Nenhum orçamento" por uma consulta que não voltou',
      !(await pagina.locator("tbody").innerText()).includes("Nenhum orçamento"),
    );
    derrubar = false;
    const recuperada = await consultar(
      (p) => p.get("search") === run.carimbo,
      () => alerta.getByRole("button", { name: "Tentar novamente", exact: true }).click(),
    );
    await pagina.unroute(ehConsultaDaLista, derrubarConsulta);
    afirmar("Tentar novamente consulta o mesmo recorte", recuperada.status() === 200, `${recuperada.status()}`);
    afirmar(
      "e a lista volta, sem o aviso",
      (await rodape()) === versoesDeOrcamento(emAberto.length) && (await alerta.count()) === 0,
      await rodape(),
    );

    // ── 17. 404 ─────────────────────────────────────────────────────────
    console.log(`\n[14] Versão que não existe`);

    const inexistente = randomUUID();
    esperarErroHttp({ status: 404, metodo: "GET", caminho: `/quote-versions/${inexistente}` });
    await pagina.goto(`${WEB}/comercial/orcamentos/${inexistente}`);
    await pagina.getByRole("heading", { level: 1, name: "Orçamento não encontrado" }).waitFor({ timeout: 25000 });
    afirmar("a página diz que o orçamento não existe", true);
    afirmar(
      "a aba também",
      (await tituloDaAba(`Orçamento não encontrado · ${TITULO_DO_SISTEMA}`)) ===
        `Orçamento não encontrado · ${TITULO_DO_SISTEMA}`,
      await pagina.title(),
    );
    afirmar("sem origem na URL, a volta é a lista de Orçamentos", await voltarParaOrcamentos().isVisible());
    await voltarParaOrcamentos().click();
    await esperarRota(pagina, "/comercial/orcamentos");
    afirmar("e leva à lista", true);

    // ── 18. 390px ───────────────────────────────────────────────────────
    console.log(`\n[15] 390px`);

    await pagina.setViewportSize({ width: 390, height: 844 });
    await consultar(
      (p) => p.get("search") === run.carimbo && !p.has("status"),
      () => pagina.goto(`${WEB}/comercial/orcamentos?search=${encodeURIComponent(run.carimbo)}&status=todos`),
    );
    const larguraDaLista = await pagina.evaluate(() => ({
      documento: document.documentElement.scrollWidth,
      janela: document.documentElement.clientWidth,
    }));
    afirmar(
      "a lista não rola a página para o lado",
      larguraDaLista.documento <= larguraDaLista.janela,
      `${larguraDaLista.documento}px em ${larguraDaLista.janela}px`,
    );
    const abrirB1 = pagina.getByRole("link", { name: `Abrir ${enviadaDoB1.rotulo}`, exact: true });
    await abrirB1.scrollIntoViewIfNeeded();
    const caixa = await abrirB1.boundingBox();
    afirmar(
      '"Abrir" inteiro na coluna fixa, dentro da tela',
      caixa !== null && caixa.width > 0 && caixa.x >= 0 && caixa.x + caixa.width <= 390,
      caixa ? `x ${Math.round(caixa.x)}, largura ${Math.round(caixa.width)}` : "(sem caixa)",
    );
    const noCentro = await abrirB1.evaluate((link) => {
      const retangulo = link.getBoundingClientRect();
      const alvo = document.elementFromPoint(retangulo.left + retangulo.width / 2, retangulo.top + retangulo.height / 2);
      return alvo === link || link.contains(alvo);
    });
    afirmar('nada cobre o "Abrir"', noCentro);
    if (caixa) {
      await pagina.mouse.click(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
      const em390 = await esperarVersaoNaTela(pagina);
      afirmar("o clique em 390px abre a versão da linha", em390.id === enviadaDoB1.id, em390.rotulo);
      const larguraDaVersao = await pagina.evaluate(() => ({
        documento: document.documentElement.scrollWidth,
        janela: document.documentElement.clientWidth,
      }));
      afirmar(
        "a página da versão também não rola a página para o lado",
        larguraDaVersao.documento <= larguraDaVersao.janela,
        `${larguraDaVersao.documento}px em ${larguraDaVersao.janela}px`,
      );
    }

    const declaradas = errosHttp.filter((erro) => erro.esperado);
    console.log(
      `  obs  recusas provocadas e declaradas: ${declaradas.map((erro) => `${erro.status} ${erro.metodo}`).join(", ") || "nenhuma"}`,
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
  console.log("OK — a lista geral encontra, abre e devolve o recorte; a página da versão é endereço próprio.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
