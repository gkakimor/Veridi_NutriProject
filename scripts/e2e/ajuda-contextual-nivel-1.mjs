import { abrirNavegador, WEB } from "./lib/browser.mjs";

/**
 * A ajuda contextual no modelo V2, lida como a pessoa lê — pela interface.
 *
 * A auditoria UX-HELP-01 mediu o defeito principal: o painel abria por
 * glossário e a resposta de "o que eu faço aqui?" chegava depois de nove
 * termos. UX-HELP-02 reescreveu doze telas em três níveis e reordenou o modal.
 * O que teste de componente não prova é o efeito disso no navegador de
 * verdade: se o nível 1 cabe na primeira tela do modal, se o próximo passo
 * está visível sem rolar, e se a consulta realmente nasce recolhida.
 *
 * O que esta suíte afirma, clicando:
 *
 * 1. cinco telas P0 abrem o painel e mostram "Quando usar" e "Próximo passo"
 *    antes do passo a passo;
 * 2. o nível 1 inteiro cabe na primeira dobra do modal — sem rolagem;
 * 3. termos, situações, atenção e exemplo nascem recolhidos e abrem no clique;
 * 4. um link interno do painel navega para a tela que ele promete;
 * 5. em tela de celular o painel continua legível e a página não ganha
 *    rolagem horizontal.
 *
 * Nada é criado e nada é alterado: a suíte só lê e abre painel. A navegação
 * usa as listas reais e clica na primeira linha — nenhuma chamada de API é
 * usada como caminho, só o cookie de sessão que a biblioteca já injeta.
 *
 *   node scripts/e2e/ajuda-contextual-nivel-1.mjs
 */

/** As cinco telas que o handoff pede, e como chegar em cada uma clicando. */
const TELAS = [
  {
    nome: "Orçamento",
    lista: "/comercial/projetos",
    /** Abre o primeiro documento da lista; ausente, a tela já é o destino. */
    abrirPrimeiro: true,
    gatilho: "Como funciona o Orçamento",
    titulo: "Orçamento: a proposta de preço e o que o aceite autoriza",
  },
  {
    nome: "Formulação",
    lista: "/producao/formulacoes",
    abrirPrimeiro: true,
    gatilho: "Como funciona",
    titulo: "Formulação: a receita em versões, e o que cada número significa",
  },
  {
    nome: "Pedido",
    lista: "/comercial/pedidos",
    abrirPrimeiro: true,
    gatilho: "Como funciona",
    titulo: "Pedido do Cliente: da confirmação à expedição",
  },
  {
    nome: "Ordem de Produção",
    lista: "/producao/ordens",
    abrirPrimeiro: true,
    gatilho: "Como funciona",
    titulo: "Ordem de Produção: do planejamento ao lote acabado",
  },
  {
    nome: "Faturamento",
    lista: "/comercial/faturamento",
    abrirPrimeiro: true,
    gatilho: "Como funciona",
    titulo: "O que o Faturamento faz — e o que ele não faz",
  },
];

const falhas = [];

function afirmar(descricao, condicao, detalhe = "") {
  const linha = `${descricao}${detalhe ? ` — ${detalhe}` : ""}`;
  if (condicao) {
    console.log(`  ok   ${linha}`);
    return true;
  }
  falhas.push(linha);
  console.log(`  FALHA ${linha}`);
  return false;
}

/**
 * A célula neutra da primeira linha da lista — a que abre o documento.
 *
 * Não serve clicar no meio do `<tr>`: as listas do ERP levam link para OUTRA
 * entidade dentro da linha (o cliente no faturamento, o produto na
 * formulação), e o clique cai neles. A linha inteira já navega para o próprio
 * documento pelo `onClick`; o que a suíte precisa é de um pedaço da linha sem
 * link e sem botão em cima.
 */
async function primeiraLinha(pagina) {
  const linha = pagina.locator("table.table--clickable-rows tbody tr").first();
  await linha.waitFor({ state: "visible", timeout: 20000 });

  const celulas = linha.locator("td");
  const total = await celulas.count();
  for (let indice = 0; indice < total; indice += 1) {
    const celula = celulas.nth(indice);
    const temControle = await celula.locator("a, button, input").count();
    if (temControle === 0 && (await celula.innerText()).trim() !== "") return celula;
  }
  throw new Error("nenhuma célula neutra na primeira linha da lista");
}

/**
 * Espera a tela parar de se mexer.
 *
 * Documento com doze seções carrega em várias respostas, e cada uma remonta
 * um pedaço. Sem esperar o "Carregando…" sumir, o clique acontece no meio de
 * um render e erra o alvo por motivo que não é defeito de produto.
 */
async function assentar(pagina) {
  await pagina.waitForLoadState("networkidle");
  await pagina
    .getByText("Carregando…", { exact: true })
    .first()
    .waitFor({ state: "detached", timeout: 15000 })
    .catch(() => {});
}

/**
 * Chega na tela, abre o painel e devolve o que ele mostra.
 *
 * As medidas saem do DOM depois de o modal montar: posição de cada título
 * dentro do container que rola, e o estado de cada `<details>`.
 */
async function abrirPainel(pagina, tela) {
  await pagina.goto(`${WEB}${tela.lista}`, { waitUntil: "networkidle" });

  if (tela.abrirPrimeiro) {
    const linha = await primeiraLinha(pagina);
    await linha.click();
    await pagina.waitForLoadState("networkidle");
  }

  await assentar(pagina);

  /*
   * O gatilho pode ser remontado enquanto a tela ainda está carregando as
   * suas seções — o clique cai num nó que acabou de sair do DOM. Repetir é
   * a resposta certa aqui: o defeito seria a ajuda não abrir, não a corrida
   * entre o clique e o segundo render.
   */
  const gatilho = pagina.getByRole("button", { name: tela.gatilho, exact: true }).first();
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      await gatilho.waitFor({ state: "visible", timeout: 20000 });
      await gatilho.click({ timeout: 5000 });
      break;
    } catch (erro) {
      if (tentativa >= 5) throw erro;
      await assentar(pagina);
    }
  }

  await pagina.locator(".help-modal").waitFor({ state: "visible", timeout: 10000 });

  return pagina.evaluate(() => {
    const modal = document.querySelector(".help-modal");
    if (!modal) return null;
    const topoDoModal = modal.getBoundingClientRect().top;
    const posicao = (elemento) =>
      elemento ? Math.round(elemento.getBoundingClientRect().top - topoDoModal) : null;

    const titulos = [...modal.querySelectorAll("h3")];
    const acharTitulo = (texto) => titulos.find((h3) => h3.textContent.trim() === texto) ?? null;

    const detalhes = [...modal.querySelectorAll("details")].map((details) => ({
      titulo: details.querySelector("summary")?.textContent.trim() ?? "",
      aberto: details.open,
    }));

    return {
      titulo: modal.querySelector(".help-modal__title")?.textContent.trim() ?? "",
      resumo: modal.querySelector(".help-modal__summary")?.textContent.trim() ?? "",
      rolagem: modal.scrollTop,
      alturaVisivel: modal.clientHeight,
      posicaoQuandoUsar: posicao(acharTitulo("Quando usar")),
      posicaoProximoPasso: posicao(acharTitulo("Próximo passo")),
      posicaoPassoAPasso: posicao(acharTitulo("Passo a passo")),
      detalhes,
      links: [...modal.querySelectorAll("a[href]")].map((a) => ({
        texto: a.textContent.trim(),
        href: a.getAttribute("href"),
      })),
    };
  });
}

async function fecharPainel(pagina) {
  await pagina.getByRole("button", { name: "Fechar", exact: true }).click();
  await pagina.locator(".help-modal").waitFor({ state: "detached", timeout: 10000 });
}

async function main() {
  const { pagina, erros, fechar } = await abrirNavegador();

  try {
    for (const tela of TELAS) {
      console.log(`\n${tela.nome}`);
      const painel = await abrirPainel(pagina, tela);

      if (!afirmar("o painel abriu", painel !== null)) continue;

      afirmar("o título é o da tela", painel.titulo === tela.titulo, painel.titulo);
      afirmar("a primeira frase aparece", painel.resumo.length > 40);

      /*
       * A ordem é a entrega desta rodada. O nível 1 vem antes do passo a
       * passo; era o contrário, e o glossário vinha antes de tudo.
       */
      const ordemCerta =
        painel.posicaoQuandoUsar !== null &&
        painel.posicaoProximoPasso !== null &&
        painel.posicaoPassoAPasso !== null &&
        painel.posicaoQuandoUsar < painel.posicaoProximoPasso &&
        painel.posicaoProximoPasso < painel.posicaoPassoAPasso;
      afirmar(
        "nível 1 antes do passo a passo",
        ordemCerta,
        `quando usar ${painel.posicaoQuandoUsar}px · próximo passo ${painel.posicaoProximoPasso}px · passo a passo ${painel.posicaoPassoAPasso}px`,
      );

      // Sem rolagem: o painel abre no topo e o próximo passo já está dentro
      // da área visível do modal.
      afirmar("o painel abre no topo", painel.rolagem === 0, `scrollTop ${painel.rolagem}`);
      afirmar(
        "o próximo passo está visível sem rolar",
        painel.posicaoProximoPasso !== null &&
          painel.posicaoProximoPasso < painel.alturaVisivel,
        `${painel.posicaoProximoPasso}px de ${painel.alturaVisivel}px visíveis`,
      );

      afirmar(
        "a consulta nasce recolhida",
        painel.detalhes.length >= 3 && painel.detalhes.every((secao) => !secao.aberto),
        painel.detalhes.map((secao) => secao.titulo).join(" · "),
      );

      // Abrir e fechar uma seção: o `<details>` nativo tem de responder.
      const primeiroDetalhe = pagina.locator(".help-modal details summary").first();
      await primeiroDetalhe.click();
      const abriu = await pagina.locator(".help-modal details").first().evaluate((el) => el.open);
      await primeiroDetalhe.click();
      const fechou = await pagina
        .locator(".help-modal details")
        .first()
        .evaluate((el) => !el.open);
      afirmar("a seção recolhida abre e fecha no clique", abriu && fechou);

      afirmar("o painel oferece pelo menos um link", painel.links.length > 0);
      await fecharPainel(pagina);
    }

    /*
     * O link interno leva mesmo à tela prometida. Uma vez basta: o teste
     * editorial já confere TODAS as rotas contra o `App.tsx`; o que falta
     * provar no navegador é que clicar navega e o painel sai da frente.
     */
    console.log("\nLink do painel");
    const painelDoPedido = await abrirPainel(pagina, TELAS[2]);
    const destino = painelDoPedido.links.find((link) => link.href?.startsWith("/"));
    if (afirmar("há link interno no painel do Pedido", Boolean(destino), destino?.href ?? "")) {
      await pagina.getByRole("link", { name: destino.texto, exact: true }).first().click();
      await pagina.waitForLoadState("networkidle");
      afirmar(
        "clicar no link navega para a tela prometida",
        new URL(pagina.url()).pathname === destino.href,
        `${new URL(pagina.url()).pathname} (esperado ${destino.href})`,
      );
      afirmar(
        "o painel fecha ao navegar",
        (await pagina.locator(".help-modal").count()) === 0,
      );
    }

    /*
     * Celular: o painel continua legível e a página não ganha rolagem
     * horizontal. É a checagem básica que o handoff pede — a rodada de
     * responsivo é outra.
     */
    console.log("\nCelular (390 × 844)");
    await pagina.setViewportSize({ width: 390, height: 844 });

    /*
     * A casca do ERP já transborda 67px nesta largura, com ou sem ajuda: o
     * `masthead` e o `workspace` têm largura mínima maior que a tela. É
     * defeito conhecido e de outra rodada (o endurecimento responsivo), e não
     * cabe a esta suíte reprovar por ele.
     *
     * O que ela mede é o que esta capability controla: abrir o painel não
     * pode PIORAR a rolagem horizontal da página.
     */
    const excessoHorizontal = () =>
      pagina.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

    await pagina.goto(`${WEB}${TELAS[4].lista}`, { waitUntil: "networkidle" });
    const excessoAntes = await excessoHorizontal();

    const painelNoCelular = await abrirPainel(pagina, TELAS[4]);
    afirmar("o painel abre no celular", painelNoCelular !== null);
    afirmar(
      "o nível 1 continua antes do passo a passo",
      painelNoCelular.posicaoQuandoUsar < painelNoCelular.posicaoPassoAPasso,
    );

    const excessoDepois = await excessoHorizontal();
    afirmar(
      "o painel não piora a rolagem horizontal da página",
      excessoDepois <= excessoAntes,
      `antes ${excessoAntes}px · com o painel ${excessoDepois}px`,
    );

    const errosDeConsole = erros.filter(
      (erro) => !/favicon|ResizeObserver/i.test(String(erro)),
    );
    afirmar("console limpo", errosDeConsole.length === 0, errosDeConsole.slice(0, 3).join(" | "));
  } finally {
    await fechar();
  }

  console.log(`\n${falhas.length === 0 ? "VERDE" : `VERMELHO — ${falhas.length} falha(s)`}`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
