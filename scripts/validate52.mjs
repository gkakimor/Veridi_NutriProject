import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação da capacidade 52 — criação de entidade a partir do campo de
 * busca, largura de coluna e empilhamento de modal.
 *
 * Três mudanças chegaram juntas nesta rodada e nenhuma delas é provável de
 * ser pega por teste unitário, porque as três só existem no navegador de
 * verdade:
 *
 *  1. "+ Novo X" virou o PRIMEIRO item da lista do `SearchableEntitySelect`,
 *     sempre — e a promessa que acompanha isso é que o teclado NÃO cria por
 *     acidente: quem digita e aperta Enter escolhe o resultado. Uma coisa é
 *     a ordem no DOM (jsdom vê), outra é o índice ativo depois de filtrar
 *     (só o comportamento real conta);
 *  2. o cadastro no contexto abre um `FullWorkspaceModal` POR CIMA do
 *     formulário de origem, e o rascunho tem que sobreviver aos dois
 *     desfechos — salvou e desistiu. Isso é montagem/desmontagem de árvore
 *     React sob rota real, não render isolado;
 *  3. `col-tight` / `col-flex` e o teto da coluna de ações são efeito do
 *     algoritmo `table-layout: auto` do navegador. Largura de coluna não
 *     existe fora de um motor de layout: jsdom devolve 0 para tudo.
 *
 * O que este script NÃO tenta ser: um teste de regressão de conteúdo. Ele
 * não confere textos de ajuda nem colunas específicas — confere o mecanismo.
 *
 * Registros criados (Cliente em C, Fornecedor em E) nascem com um carimbo de
 * tempo no nome e são INATIVADOS no fim pelo fluxo oficial da tela. O que
 * sobrar é dito no relatório final, com nome e id.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate52.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

fs.mkdirSync(OUT, { recursive: true });

const credentials = (() => {
  for (const rel of ["../.local-data/dev-admin.json", "../../.local-data/dev-admin.json"]) {
    const file = new URL(rel, import.meta.url);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  throw new Error("Credencial de desenvolvimento não encontrada em .local-data/dev-admin.json");
})();

let cookie = "";

async function api(method, url, body) {
  const r = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

const failures = [];
function check(label, condition, detail = "") {
  if (condition) console.log("ok", label);
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log("FALHOU", label, detail);
  }
}

/** Observação registrada no relatório sem reprovar — medida, não veredito. */
const observacoes = [];
function anotar(texto) {
  observacoes.push(texto);
  console.log("  ·", texto);
}

/**
 * Carimbo único da execução, em base36 do epoch em ms.
 *
 * Precisa ser curto o bastante para caber no campo de busca da listagem
 * (é por ele que a limpeza acha o que criou) e único o bastante para que
 * duas execuções no mesmo dia não se confundam.
 */
const TOKEN = `V52${Date.now().toString(36).toUpperCase()}`;
const NOME_CLIENTE = `ZZ TEMP CLIENTE ${TOKEN}`;
const NOME_FORNECEDOR = `ZZ TEMP FORNECEDOR ${TOKEN}`;
const inicio = new Date().toISOString();

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
];

/**
 * Listagens principais do ERP. A regra de "página não rola de lado" só vale
 * alguma coisa se for medida no conjunto: uma tela isolada passando não diz
 * nada sobre o algoritmo de largura, que é global.
 */
const LISTAGENS = [
  { rotulo: "Clientes", rota: "/cadastros/clientes" },
  { rotulo: "Produtos", rota: "/cadastros/produtos" },
  { rotulo: "Itens", rota: "/cadastros/itens" },
  { rotulo: "Fornecedores", rota: "/cadastros/fornecedores" },
  { rotulo: "Projetos", rota: "/comercial/projetos" },
  { rotulo: "Pedidos", rota: "/comercial/pedidos" },
  { rotulo: "Ordens de Compra", rota: "/compras/ordens" },
  { rotulo: "Recebimentos", rota: "/compras/recebimentos" },
  { rotulo: "Ordens de Produção", rota: "/producao/ordens" },
  { rotulo: "Expedições", rota: "/comercial/expedicoes" },
  { rotulo: "Faturamento", rota: "/comercial/faturamento" },
  { rotulo: "Lotes", rota: "/estoque/lotes" },
  { rotulo: "Posição de Estoque", rota: "/estoque" },
  { rotulo: "Movimentações", rota: "/estoque/movimentacoes" },
];

/**
 * Medição feita DENTRO da página — vira string via `page.evaluate`, então
 * não pode tocar em nada do escopo do Node.
 *
 * Mede as duas rolagens separadamente porque elas são defeitos diferentes:
 * a da PÁGINA leva junto o cabeçalho, o menu e a paginação (sempre errado);
 * a do `.table-container` é a moldura fazendo o trabalho dela (legítima numa
 * tabela de catorze colunas de negócio).
 */
function medirTabelasNaPagina() {
  const doc = document.documentElement;
  const px = (n) => Math.round(n * 10) / 10;

  const containers = [...document.querySelectorAll(".table-container")]
    .filter((c) => c.getBoundingClientRect().width > 0)
    .map((c) => ({
      largura: px(c.clientWidth),
      conteudo: px(c.scrollWidth),
      overflow: px(c.scrollWidth - c.clientWidth),
    }));

  const tabelas = [];
  for (const table of document.querySelectorAll("table")) {
    const rect = table.getBoundingClientRect();
    if (rect.width === 0) continue;

    // Cabeçalho com mais células: tabela com header agrupado tem dois <tr>.
    const linhasHead = [...table.querySelectorAll("thead tr")];
    const head =
      linhasHead.sort((a, b) => b.children.length - a.children.length)[0] ??
      table.querySelector("tr");
    if (!head) continue;

    const ths = [...head.children];
    const corpo = [...table.querySelectorAll("tbody tr")].filter(
      (tr) => !tr.querySelector("td.table__empty"),
    );

    const colunas = ths.map((th, i) => ({
      indice: i,
      titulo: (th.textContent ?? "").trim() || "(vazio)",
      largura: px(th.getBoundingClientRect().width),
      classe: th.getAttribute("class") ?? "",
    }));

    /*
     * A coluna de ações se identifica pela ESTRUTURA da célula, não pelo
     * título: na maioria das telas o `<th>` é vazio (`aria-hidden`). Ordem de
     * confiança: célula com `.row-actions`/botão → título "Ações" → última
     * coluna vazia numa tabela com `sticky-actions`.
     */
    let idxAcoes = -1;
    if (corpo.length > 0) {
      const tds = [...corpo[0].children];
      for (let i = tds.length - 1; i >= 0; i--) {
        if (tds[i].querySelector(".row-actions, .table__actions, button, a.btn")) {
          idxAcoes = i;
          break;
        }
      }
    }
    if (idxAcoes < 0) {
      idxAcoes = colunas.findIndex(
        (c) => /^(a[çc][õo]es|editar|a[çc][ãa]o)$/i.test(c.titulo) || /col-actions/.test(c.classe),
      );
    }
    if (idxAcoes < 0 && table.classList.contains("table--sticky-actions")) {
      const ultima = colunas[colunas.length - 1];
      if (ultima && ultima.titulo === "(vazio)") idxAcoes = ultima.indice;
    }

    const acoes = idxAcoes >= 0 ? colunas[idxAcoes] : null;
    /*
     * Posição por "quantas colunas são ESTRITAMENTE mais largas".
     *
     * Empate não pode inflar o ranking: se três colunas medem o mesmo que a
     * de ações, ordenar por largura colocaria a de ações em qualquer posição
     * dependendo da ordem do DOM. Contar só quem é maior de verdade responde
     * exatamente à pergunta feita — "ela está entre as três mais largas?".
     */
    const posicao = acoes
      ? 1 + colunas.filter((c) => c.largura > acoes.largura).length
      : null;

    tabelas.push({
      classe: table.getAttribute("class") ?? "",
      largura: px(rect.width),
      linhas: corpo.length,
      colunas,
      acoes: acoes
        ? {
            titulo: acoes.titulo,
            largura: acoes.largura,
            posicao,
            totalColunas: colunas.length,
            // Ranking legível para o relatório, da mais larga para a menor.
            ranking: [...colunas]
              .sort((a, b) => b.largura - a.largura)
              .slice(0, 6)
              .map((c) => `${c.titulo}=${c.largura}px`),
          }
        : null,
    });
  }

  return {
    viewport: { largura: doc.clientWidth, altura: doc.clientHeight },
    // A rolagem que NÃO pode existir: a página inteira andando de lado.
    overflowGlobal: px(doc.scrollWidth - doc.clientWidth),
    containers,
    tabelas,
    titulo: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 60),
  };
}

const screenshots = [];
const rankings = [];
/** Registros criados durante a validação, para a limpeza e o relatório. */
const criados = { customers: [], suppliers: [], items: [] };

let browser;
/** A limpeza pelo fluxo oficial chegou ao fim? Decide a rede de segurança. */
let limpezaPelaTela = false;

try {
  await api("POST", "/auth/login", credentials);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORTS[1] });
  // Sessão por cookie: refazer o login pela UI a cada troca de viewport
  // gastaria minutos e ainda daria uma origem de instabilidade a mais.
  const [nomeCookie, valorCookie] = cookie.split("=");
  await context.addCookies([
    {
      name: nomeCookie,
      value: valorCookie,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();

  /*
   * Navegações do quadro principal.
   *
   * Um cadastro em contexto NÃO pode recarregar a página: recarregar é
   * perder o rascunho inteiro, que é justamente o que o desenho promete
   * preservar. Sem esta lista, um `submit` nativo escapando aparece só como
   * "elemento não encontrado" trinta segundos depois.
   */
  const navegacoes = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navegacoes.push(frame.url());
  });

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));

  /*
   * Captura da resposta da API para cada cadastro feito pela TELA.
   *
   * É daqui que sai "o id que a API devolveu" — comparar com o que o campo
   * selecionou é a única forma de provar que a escolha foi por id e não por
   * nome. Ler o registro depois por busca não serviria: com homônimo na
   * base, a busca devolve os dois.
   */
  page.on("response", async (res) => {
    if (res.request().method() !== "POST" || !res.ok()) return;
    const rota = new URL(res.url()).pathname;
    if (!/^\/(customers|suppliers|items)$/.test(rota)) return;
    try {
      const json = await res.json();
      if (json?.id) criados[rota.slice(1)].push({ ...json, origem: "criado pela tela" });
    } catch {
      /* corpo não-JSON: não é o cadastro que interessa */
    }
  });

  const shot = async (nome) => {
    await page.waitForTimeout(300);
    const destino = path.join(OUT, `${nome}.png`);
    await page.screenshot({ path: destino });
    const absoluto = path.resolve(destino);
    screenshots.push(absoluto);
    return absoluto;
  };

  /*
   * Espera pela ÂNCORA da tela, não por tempo: as listagens do Veridi puxam
   * catálogos grandes junto, e `networkidle` chega muito depois do momento em
   * que o cabeçalho e a tabela já estão pintados.
   */
  const abrir = async (rota, ancora = ".page__title") => {
    await page.goto(`${WEB}${rota}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(ancora, { timeout: 30000 });
    await page.waitForTimeout(900);
  };

  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  if (await page.locator("#login-email").count()) {
    await page.fill("#login-email", credentials.email);
    await page.fill("#login-password", credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1800);
  }
  check("sessão autenticada no navegador", (await page.locator("#login-email").count()) === 0);

  // ── Ferramentas do combobox ─────────────────────────────────────────────

  /** Tira o foco do campo atual: `focus()` num campo já focado não dispara. */
  const desfocar = async () => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(120);
  };

  /** Abre a lista pelo FOCO — sem clique, para servir também à prova B. */
  async function abrirLista(seletor) {
    await desfocar();
    await page.locator(seletor).focus();
    await page.waitForSelector(".entity-select__list", { timeout: 8000 });
    await page.waitForTimeout(250);
  }

  /**
   * Retrato da lista aberta. Tudo o que a prova A e a prova B perguntam sai
   * daqui, numa leitura só, para não haver deriva entre uma medição e outra.
   */
  async function retratoDaLista() {
    return page.evaluate(() => {
      const ul = document.querySelector(".entity-select__list");
      if (!ul) return { faltou: true };
      const opcoes = [...ul.querySelectorAll('[role="option"]')];
      const criar = ul.querySelector(".entity-select__create");
      const resultados = opcoes.filter((o) => !o.classList.contains("entity-select__create"));
      const ativa = ul.querySelector(".entity-select__option.is-active");
      const input = document.querySelector(`[aria-controls="${CSS.escape(ul.id)}"]`);
      const limpo = (t) => (t ?? "").replace(/\s+/g, " ").trim();
      return {
        listId: ul.id,
        opcoes: opcoes.length,
        resultados: resultados.length,
        // O que a prova A persegue: a ação de criar é a opção de índice 0.
        primeiroEhCriar: opcoes[0] === criar && criar !== null,
        textoDoCriar: limpo(criar?.textContent),
        ativaEhCriar: Boolean(ativa && ativa === criar),
        ativaEhPrimeiroResultado: Boolean(ativa && resultados[0] && ativa === resultados[0]),
        // `aria-activedescendant` é o que o leitor de tela anuncia: se ele
        // apontar para outro lugar, a lista mente para quem não vê.
        activedescendant: input?.getAttribute("aria-activedescendant") ?? null,
        idDoCriar: criar?.id ?? null,
        idDoPrimeiroResultado: resultados[0]?.id ?? null,
        codigoDoPrimeiroResultado: limpo(resultados[0]?.querySelector(".code")?.textContent),
        nomeDoPrimeiroResultado: limpo(
          resultados[0]?.querySelector(".entity-select__name")?.textContent,
        ),
      };
    });
  }

  /** Fecha a lista sem escolher — Escape do combobox não fecha o modal. */
  const fecharLista = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  };

  /**
   * Id da entidade escolhida, lido do DOM.
   *
   * O `<li>` de cada opção tem `id = "<listId>-<id da entidade>"` e a
   * escolhida carrega `aria-selected="true"`. É o único ponto em que o
   * estado interno do componente aflora no HTML — e é exatamente o que as
   * provas C e E precisam comparar com a resposta da API.
   */
  async function idSelecionado(seletor) {
    await abrirLista(seletor);
    const id = await page.evaluate(() => {
      const ul = document.querySelector(".entity-select__list");
      if (!ul) return null;
      const op = ul.querySelector(
        '[role="option"][aria-selected="true"]:not(.entity-select__create)',
      );
      if (!op) return null;
      return op.id.startsWith(`${ul.id}-`) ? op.id.slice(ul.id.length + 1) : null;
    });
    await fecharLista();
    return id;
  }

  /** Texto visível do campo — placeholder quando vazio, valor quando cheio. */
  const textoDoCampo = async (seletor) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      return { valor: el?.value ?? null, placeholder: el?.getAttribute("placeholder") ?? null };
    }, seletor);

  /** Rótulo do botão de criar, sem o "+" e sem o eco do que foi digitado. */
  const rotuloLimpo = (texto) =>
    (texto ?? "")
      .replace(/^\+\s*/, "")
      .split(":")[0]
      .replace(/\s+/g, " ")
      .trim();

  // ══ Rótulos oficiais, lidos das telas de listagem ══════════════════════
  // A prova A compara o rótulo da lista com O QUE A TELA DE LISTAGEM diz.
  // Fixar o texto esperado no script provaria só que o script e a tela
  // combinaram entre si; ler dos dois lugares prova que eles combinam.
  const rotulosDaListagem = {};
  for (const [chave, rota] of Object.entries({
    cliente: "/cadastros/clientes",
    produto: "/cadastros/produtos",
    fornecedor: "/cadastros/fornecedores",
    item: "/cadastros/itens",
  })) {
    await abrir(rota);
    const texto = await page
      .locator(".page__header button.btn--primary")
      .first()
      .textContent();
    rotulosDaListagem[chave] = rotuloLimpo(texto);
  }
  console.log("rótulos das listagens:", JSON.stringify(rotulosDaListagem));

  // ═══════════════════════════════════════════════════════════════════════
  // A — a ação de criar encabeça a lista, em quatro telas diferentes
  // ═══════════════════════════════════════════════════════════════════════
  // Quatro campos, quatro TELAS, e os quatro rótulos que existem hoje. Uma
  // amostra concentrada num formulário provaria só que aquele formulário
  // passa a prop — não que o componente coloca a ação no topo.
  const CONTEXTOS = [
    {
      nome: "Produto › Cliente",
      rota: "/cadastros/produtos",
      preparar: async () => {
        await page.locator(".page__header button.btn--primary").first().click();
        await page.waitForSelector("#product-form", { timeout: 15000 });
        await page.waitForTimeout(700);
      },
      campo: "#product-customer",
      esperado: () => rotulosDaListagem.cliente,
    },
    {
      nome: "Pedido › Cliente",
      rota: "/comercial/pedidos/novo",
      ancora: ".doc-title",
      preparar: async () => {
        await page.waitForSelector("#co-customer", { timeout: 15000 });
        await page.waitForTimeout(700);
      },
      campo: "#co-customer",
      esperado: () => rotulosDaListagem.cliente,
    },
    {
      nome: "Pedido › Produto da linha",
      rota: "/comercial/pedidos/novo",
      ancora: ".doc-title",
      preparar: async () => {
        await page.locator('button:has-text("Adicionar produto")').first().click();
        await page.waitForSelector('input[id^="pedido-produto-"]', { timeout: 15000 });
        await page.waitForTimeout(500);
      },
      campo: 'input[id^="pedido-produto-"]',
      esperado: () => rotulosDaListagem.produto,
    },
    {
      nome: "Ordem de Compra › Fornecedor",
      rota: "/compras/ordens/nova",
      ancora: ".doc-title",
      preparar: async () => {
        await page.waitForSelector("#po-supplier", { timeout: 15000 });
        await page.waitForTimeout(700);
      },
      campo: "#po-supplier",
      esperado: () => rotulosDaListagem.fornecedor,
    },
    {
      nome: "Item × Fornecedor › Item",
      rota: "/compras/item-fornecedor",
      preparar: async () => {
        await page.locator(".page__header button.btn--primary").first().click();
        await page.waitForSelector("#supplier-item-form", { timeout: 15000 });
        await page.waitForTimeout(700);
      },
      campo: "#supplier-item-item",
      esperado: () => rotulosDaListagem.item,
    },
  ];

  const telasVistas = new Set();
  for (const ctx of CONTEXTOS) {
    await abrir(ctx.rota, ctx.ancora ?? ".page__title");
    await ctx.preparar();
    telasVistas.add(ctx.rota);

    // 1. Lista cheia — antes de digitar qualquer coisa.
    await abrirLista(ctx.campo);
    const cheia = await retratoDaLista();
    check(
      `A · ${ctx.nome} · lista cheia começa pela ação de criar`,
      cheia.primeiroEhCriar === true,
      JSON.stringify({ opcoes: cheia.opcoes, primeiro: cheia.textoDoCriar }),
    );
    check(
      `A · ${ctx.nome} · rótulo bate com o botão da listagem ("${ctx.esperado()}")`,
      rotuloLimpo(cheia.textoDoCriar) === ctx.esperado(),
      `lista="${rotuloLimpo(cheia.textoDoCriar)}" listagem="${ctx.esperado()}"`,
    );
    check(
      `A · ${ctx.nome} · a lista cheia tem resultados de verdade`,
      cheia.resultados > 0,
      `${cheia.resultados} resultado(s)`,
    );
    await shot(`52-a-${ctx.nome.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-cheia`);

    // 2. Depois de digitar um termo que CASA — a situação em que a ação de
    //    criar poderia ser empurrada para baixo dos resultados.
    const termo = cheia.codigoDoPrimeiroResultado || cheia.nomeDoPrimeiroResultado.slice(0, 6);
    await page.keyboard.type(termo, { delay: 25 });
    await page.waitForTimeout(400);
    const filtrada = await retratoDaLista();
    check(
      `A · ${ctx.nome} · com "${termo}" digitado, criar continua em primeiro`,
      filtrada.primeiroEhCriar === true && filtrada.resultados > 0,
      JSON.stringify({ resultados: filtrada.resultados, primeiro: filtrada.textoDoCriar }),
    );
    await shot(`52-a-${ctx.nome.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-filtrada`);
    await fecharLista();
  }
  check(
    "A · pelo menos quatro telas diferentes cobertas",
    telasVistas.size >= 4,
    `${telasVistas.size} tela(s): ${[...telasVistas].join(", ")}`,
  );
  check(
    "A · os quatro rótulos oficiais foram exercitados",
    new Set(CONTEXTOS.map((c) => c.esperado())).size === 4,
    JSON.stringify([...new Set(CONTEXTOS.map((c) => c.esperado()))]),
  );

  // ═══════════════════════════════════════════════════════════════════════
  // B — teclado: criar no topo NÃO pode virar criar por acidente
  // ═══════════════════════════════════════════════════════════════════════
  // Este é o preço da mudança 1 e a razão de a prova existir. Com a ação de
  // criar no índice 0, o risco é o Enter de quem digitou o nome de um
  // cliente que EXISTE cair na criação de um duplicado. Nada aqui usa mouse.
  await abrir("/cadastros/produtos");
  await page.locator(".page__header button.btn--primary").first().click();
  await page.waitForSelector("#product-form", { timeout: 15000 });
  await page.waitForTimeout(700);

  await abrirLista("#product-customer");
  const antesDeDigitar = await retratoDaLista();
  const termoB = antesDeDigitar.codigoDoPrimeiroResultado;
  await page.keyboard.type(termoB, { delay: 30 });
  await page.waitForTimeout(450);

  const aposDigitar = await retratoDaLista();
  check(
    "B · (i) o item ativo é o primeiro RESULTADO, não a ação de criar",
    aposDigitar.ativaEhPrimeiroResultado === true && aposDigitar.ativaEhCriar === false,
    JSON.stringify({
      ativaEhCriar: aposDigitar.ativaEhCriar,
      ativaEhPrimeiroResultado: aposDigitar.ativaEhPrimeiroResultado,
      resultados: aposDigitar.resultados,
    }),
  );
  check(
    "B · (i) aria-activedescendant aponta para o primeiro resultado",
    aposDigitar.activedescendant === aposDigitar.idDoPrimeiroResultado,
    JSON.stringify({
      activedescendant: aposDigitar.activedescendant,
      primeiroResultado: aposDigitar.idDoPrimeiroResultado,
    }),
  );
  await shot("52-b-ativo-no-primeiro-resultado");

  const modaisAntesDoEnter = await page.locator(".modal-fullscreen").count();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const modaisDepoisDoEnter = await page.locator(".modal-fullscreen").count();
  const campoAposEnter = await textoDoCampo("#product-customer");
  check(
    "B · (ii) Enter escolhe o resultado e NÃO abre o cadastro",
    modaisDepoisDoEnter === modaisAntesDoEnter &&
      (campoAposEnter.valor ?? "").includes(termoB),
    JSON.stringify({ modaisAntesDoEnter, modaisDepoisDoEnter, campo: campoAposEnter }),
  );
  check(
    "B · (ii) a lista fechou depois da escolha",
    (await page.locator(".entity-select__list").count()) === 0,
  );

  // (iii) e (iv) — o caminho deliberado até a criação: uma seta para cima.
  await abrirLista("#product-customer");
  await page.keyboard.type(termoB, { delay: 30 });
  await page.waitForTimeout(450);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(300);
  const aposSeta = await retratoDaLista();
  check(
    "B · (iii) seta para cima a partir do primeiro resultado chega na ação de criar",
    aposSeta.ativaEhCriar === true,
    JSON.stringify({
      ativaEhCriar: aposSeta.ativaEhCriar,
      activedescendant: aposSeta.activedescendant,
      idDoCriar: aposSeta.idDoCriar,
    }),
  );
  check(
    "B · (iii) aria-activedescendant acompanha a ação de criar",
    aposSeta.activedescendant === aposSeta.idDoCriar,
    JSON.stringify({ activedescendant: aposSeta.activedescendant, criar: aposSeta.idDoCriar }),
  );
  await shot("52-b-seta-para-cima-alcanca-criar");

  await page.keyboard.press("Enter");
  await page.waitForSelector(".modal-fullscreen #customer-form", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const empilhados = await page.locator(".modal-fullscreen").count();
  check(
    "B · (iv) Enter na ação de criar abre o cadastro de Cliente por cima",
    empilhados === 2 && (await page.locator("#customer-form").count()) === 1,
    `${empilhados} modal(is) abertos`,
  );
  await shot("52-b-enter-abre-cadastro");
  // Sai sem salvar: esta prova é sobre teclado, não sobre criar registro.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ═══════════════════════════════════════════════════════════════════════
  // C — cadastro no contexto com SALVAMENTO (Produto → Cliente)
  // ═══════════════════════════════════════════════════════════════════════
  // As três coisas que o desenho promete e que só o navegador comprova: o
  // formulário de origem não é desmontado (o nome digitado continua lá), o
  // campo passa a mostrar o registro criado, e a escolha é por ID — com um
  // homônimo na base para que "por nome" não passe por engano.
  /*
   * O homônimo é semeado aqui, e não no começo da execução, para que uma
   * parada em A ou B não deixe registro órfão na base.
   *
   * Sem ele, "o campo mostra o cliente novo" não distingue seleção por id de
   * seleção por nome — qualquer implementação que casasse texto passaria. Com
   * dois clientes de razão social IDÊNTICA na lista, só quem guarda o id
   * acerta. Ele é inativado junto com o resto no fim.
   */
  const homonimo = await api("POST", "/customers", { legalName: NOME_CLIENTE });
  criados.customers.push({ ...homonimo, origem: "homônimo semeado pela API" });
  console.log(`homônimo semeado: ${homonimo.code} ${homonimo.id}`);

  await abrir("/cadastros/produtos");
  await page.locator(".page__header button.btn--primary").first().click();
  await page.waitForSelector("#product-form", { timeout: 15000 });
  await page.waitForTimeout(700);

  const NOME_PRODUTO = `ZZ TEMP PRODUTO ${TOKEN}`;
  await page.fill("#product-name", NOME_PRODUTO);

  await abrirLista("#product-customer");
  await page.locator(".entity-select__create").first().click();
  await page.waitForSelector("#customer-form", { timeout: 10000 });
  await page.waitForTimeout(600);
  check(
    "C · clicar em criar abre o cadastro oficial de Cliente por cima",
    (await page.locator(".modal-fullscreen").count()) === 2,
  );
  await shot("52-c-cadastro-cliente-sobre-produto");

  await page.fill("#customer-legal-name", NOME_CLIENTE);
  const antesDoPost = criados.customers.length;
  const urlAntesDeSalvar = page.url();
  const navegacoesAntes = navegacoes.length;
  await page.locator('.modal-fullscreen__foot button:has-text("Criar cliente")').last().click();
  /*
   * Espera por TEMPO, não por `detached`.
   *
   * Esperar o cadastro sumir presume que ele sai pelo caminho previsto. Se
   * ele sumir junto com a tela inteira — o caso que este script existe para
   * flagrar —, a espera "acerta" e a asserção seguinte estoura longe da
   * causa. Um retrato do que sobrou diz mais e não derruba o resto.
   */
  await page.waitForTimeout(3000);

  const estadoC = await page.evaluate(() => ({
    url: location.href,
    modais: document.querySelectorAll(".modal-fullscreen").length,
    formularioDoProduto: Boolean(document.querySelector("#product-form")),
    cadastroDeCliente: Boolean(document.querySelector("#customer-form")),
    nomeDoProduto: document.querySelector("#product-name")?.value ?? null,
    campoCliente: document.querySelector("#product-customer")?.value ?? null,
    alerta: document.querySelector(".form-alert")?.textContent?.trim() ?? null,
  }));
  await shot("52-c-depois-de-salvar-o-cliente");

  const recarregou = navegacoes.length > navegacoesAntes || estadoC.url !== urlAntesDeSalvar;
  check(
    "C · salvar o cliente NÃO recarrega a página",
    !recarregou,
    `antes="${urlAntesDeSalvar}" depois="${estadoC.url}" navegações=${JSON.stringify(navegacoes.slice(navegacoesAntes))}`,
  );
  check(
    "C · o POST /customers respondeu e o cadastro fechou",
    criados.customers.length > antesDoPost,
    `${criados.customers.length - antesDoPost} resposta(s) capturada(s) · estado=${JSON.stringify(estadoC)}`,
  );
  const clienteCriado =
    criados.customers.length > antesDoPost ? criados.customers[criados.customers.length - 1] : null;

  check(
    "C · (i) o nome do produto continua preenchido depois de salvar o cliente",
    estadoC.nomeDoProduto === NOME_PRODUTO,
    `campo=${JSON.stringify(estadoC.nomeDoProduto)} esperado="${NOME_PRODUTO}"`,
  );
  check(
    "C · (ii) o campo Cliente mostra o cliente recém-criado",
    Boolean(clienteCriado) &&
      (estadoC.campoCliente ?? "").includes(clienteCriado.code) &&
      (estadoC.campoCliente ?? "").includes(NOME_CLIENTE),
    JSON.stringify({ campo: estadoC.campoCliente, codigoDaApi: clienteCriado?.code ?? null }),
  );

  // (iii) só tem o que medir se o formulário de origem sobreviveu.
  if (estadoC.formularioDoProduto && clienteCriado) {
    const idNoCampo = await idSelecionado("#product-customer");
    check(
      "C · (iii) o id selecionado é o que a API devolveu, não o do homônimo",
      idNoCampo === clienteCriado.id && idNoCampo !== homonimo.id,
      JSON.stringify({ noCampo: idNoCampo, daApi: clienteCriado.id, homonimo: homonimo.id }),
    );
    anotar(
      `C · homônimo "${NOME_CLIENTE}" estava na lista com id ${homonimo.id} (${homonimo.code}); ` +
        `o campo escolheu ${idNoCampo}`,
    );
    await shot("52-c-produto-com-cliente-novo");
  } else {
    check(
      "C · (iii) o id selecionado é o que a API devolveu, não o do homônimo",
      false,
      "não há campo para medir — o formulário de origem não sobreviveu ao salvamento",
    );
  }

  // Sai sem salvar o produto: a prova é sobre o cadastro no contexto, e um
  // produto de teste puxaria item de estoque, código e histórico atrás.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ═══════════════════════════════════════════════════════════════════════
  // D — cadastro no contexto com DESISTÊNCIA
  // ═══════════════════════════════════════════════════════════════════════
  // O outro desfecho. O rascunho tem que sobreviver igual, e o campo tem que
  // ficar VAZIO: texto digitado sem seleção confirmada parado no campo lê
  // como escolha feita, que é a mentira que este caminho evita.
  await abrir("/cadastros/produtos");
  await page.locator(".page__header button.btn--primary").first().click();
  await page.waitForSelector("#product-form", { timeout: 15000 });
  await page.waitForTimeout(700);

  const NOME_PRODUTO_D = `ZZ TEMP PRODUTO CANCELADO ${TOKEN}`;
  await page.fill("#product-name", NOME_PRODUTO_D);

  await abrirLista("#product-customer");
  // Digita antes de criar: é o texto que ficaria no campo se a desistência
  // não limpasse nada — o pior caso para esta prova.
  await page.keyboard.type("ZZ CLIENTE QUE NAO EXISTE", { delay: 20 });
  await page.waitForTimeout(400);
  await page.locator(".entity-select__create").first().click();
  await page.waitForSelector("#customer-form", { timeout: 10000 });
  await page.waitForTimeout(600);
  await shot("52-d-cadastro-cliente-antes-de-desistir");

  const clientesAntesDeDesistir = criados.customers.length;
  await page
    .locator('.modal-fullscreen__head button.modal-fullscreen__close')
    .last()
    .click();
  await page
    .waitForSelector("#customer-form", { state: "detached", timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(800);

  const nomeSobreviveuD = await page.evaluate(
    () => document.querySelector("#product-name")?.value ?? null,
  );
  check(
    "D · o nome do produto continua preenchido depois de desistir do cliente",
    nomeSobreviveuD === NOME_PRODUTO_D,
    `campo="${nomeSobreviveuD}"`,
  );
  const campoClienteD = await page.evaluate(() => {
    const el = document.querySelector("#product-customer");
    return {
      valor: el?.value ?? null,
      placeholder: el?.getAttribute("placeholder") ?? null,
      temBotaoLimpar: Boolean(document.querySelector(".entity-select__clear")),
      listaAberta: Boolean(document.querySelector(".entity-select__list")),
    };
  });
  check(
    "D · o campo Cliente ficou vazio — nada selecionado",
    campoClienteD.valor === "" && campoClienteD.temBotaoLimpar === false,
    JSON.stringify(campoClienteD),
  );
  check(
    "D · desistir não criou nenhum cliente",
    criados.customers.length === clientesAntesDeDesistir,
    `${criados.customers.length - clientesAntesDeDesistir} criado(s)`,
  );
  await shot("52-d-produto-com-cliente-vazio");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ═══════════════════════════════════════════════════════════════════════
  // E — o mesmo mecanismo noutro contexto real: Item × Fornecedor
  // ═══════════════════════════════════════════════════════════════════════
  // Contexto escolhido porque a relação tem os DOIS campos com criação, e
  // porque um Fornecedor criado aqui é inativável pelo fluxo oficial da
  // listagem — o mesmo não vale para uma Ordem de Compra rascunho.
  await abrir("/compras/item-fornecedor");
  await page.locator(".page__header button.btn--primary").first().click();
  await page.waitForSelector("#supplier-item-form", { timeout: 15000 });
  await page.waitForTimeout(800);

  const CODIGO_RASCUNHO = `RASCUNHO-${TOKEN}`;
  await page.fill("#supplier-item-code", CODIGO_RASCUNHO);

  // Escolhe um item real pelo teclado: além de compor o rascunho, é mais
  // uma passagem pelo caminho "Enter escolhe, não cria".
  await abrirLista("#supplier-item-item");
  const listaItens = await retratoDaLista();
  await page.keyboard.type(listaItens.codigoDoPrimeiroResultado, { delay: 25 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const itemEscolhido = await idSelecionado("#supplier-item-item");

  await abrirLista("#supplier-item-supplier");
  const listaFornecedores = await retratoDaLista();
  check(
    "E · o campo Fornecedor também abre pela ação de criar",
    listaFornecedores.primeiroEhCriar === true &&
      rotuloLimpo(listaFornecedores.textoDoCriar) === rotulosDaListagem.fornecedor,
    JSON.stringify({ primeiro: listaFornecedores.textoDoCriar }),
  );
  await page.locator(".entity-select__create").first().click();
  await page.waitForSelector("#supplier-form", { timeout: 10000 });
  await page.waitForTimeout(600);
  await shot("52-e-cadastro-fornecedor-sobre-relacao");

  await page.fill("#supplier-legal-name", NOME_FORNECEDOR);
  const antesDoPostFornecedor = criados.suppliers.length;
  const urlAntesDoFornecedor = page.url();
  const navegacoesAntesDoFornecedor = navegacoes.length;
  await page.locator('.modal-fullscreen__foot button:has-text("Criar fornecedor")').last().click();
  await page
    .waitForSelector("#supplier-form", { state: "detached", timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  check(
    "E · salvar o fornecedor NÃO recarrega a página",
    navegacoes.length === navegacoesAntesDoFornecedor && page.url() === urlAntesDoFornecedor,
    `antes="${urlAntesDoFornecedor}" depois="${page.url()}"`,
  );
  check(
    "E · o POST /suppliers respondeu e o cadastro fechou",
    criados.suppliers.length > antesDoPostFornecedor,
  );
  const fornecedorCriado = criados.suppliers[criados.suppliers.length - 1];

  const relacaoSobreviveu = (await page.locator("#supplier-item-form").count()) === 1;
  check("E · o formulário da relação sobreviveu ao cadastro", relacaoSobreviveu);
  const rascunhoSobreviveu = await page.evaluate(
    () => document.querySelector("#supplier-item-code")?.value ?? null,
  );
  const itemContinua = relacaoSobreviveu ? await idSelecionado("#supplier-item-item") : null;
  check(
    "E · o rascunho da relação sobreviveu ao cadastro de Fornecedor",
    rascunhoSobreviveu === CODIGO_RASCUNHO && itemContinua === itemEscolhido,
    JSON.stringify({ codigo: rascunhoSobreviveu, item: itemContinua, itemAntes: itemEscolhido }),
  );
  const campoFornecedor = await textoDoCampo("#supplier-item-supplier");
  check(
    "E · o campo Fornecedor mostra o fornecedor recém-criado",
    (campoFornecedor.valor ?? "").includes(fornecedorCriado?.code ?? " "),
    JSON.stringify({ campo: campoFornecedor, codigoDaApi: fornecedorCriado?.code }),
  );
  const idFornecedorNoCampo = await idSelecionado("#supplier-item-supplier");
  check(
    "E · o id selecionado é o que a API devolveu",
    idFornecedorNoCampo === fornecedorCriado?.id,
    JSON.stringify({ noCampo: idFornecedorNoCampo, daApi: fornecedorCriado?.id }),
  );
  await shot("52-e-relacao-com-fornecedor-novo");

  // A relação em si NÃO é salva: o que estava sendo provado é o mecanismo de
  // criação no contexto, e uma relação de teste ficaria pendurada no item.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ═══════════════════════════════════════════════════════════════════════
  // F — modal sobre modal: um Escape fecha UMA camada
  // ═══════════════════════════════════════════════════════════════════════
  // Antes, o listener no `document` fazia os dois fecharem juntos: quem
  // desistia do item perdia a relação inteira sem ter pedido.
  await abrir("/compras/item-fornecedor");
  await page.locator(".page__header button.btn--primary").first().click();
  await page.waitForSelector("#supplier-item-form", { timeout: 15000 });
  await page.waitForTimeout(800);
  const MARCA_F = `MARCA-${TOKEN}`;
  await page.fill("#supplier-item-code", MARCA_F);

  await abrirLista("#supplier-item-item");
  await page.locator(".entity-select__create").first().click();
  await page.waitForSelector("#item-form", { timeout: 10000 });
  await page.waitForTimeout(700);
  const doisAbertos = await page.evaluate(() => ({
    modais: document.querySelectorAll(".modal-fullscreen").length,
    /*
     * Cada modal precisa rotular o PRÓPRIO título. Com `id` fixo no
     * componente, dois modais abertos publicavam o mesmo `id` e o
     * `aria-labelledby` do de cima resolvia para o título do de baixo — quem
     * abria "Novo item de estoque" ouvia "Nova relação". Só empilhado o
     * problema existe, por isso a medição é aqui.
     */
    rotulos: [...document.querySelectorAll(".modal-fullscreen")].map((modal) => {
      const alvo = modal.getAttribute("aria-labelledby");
      return document.getElementById(alvo ?? "")?.textContent?.trim() ?? null;
    }),
    tituloDeCima:
      document.querySelectorAll(".modal-fullscreen")[1]
        ?.querySelector(".modal-fullscreen__title h2")
        ?.textContent?.trim() ?? null,
  }));
  check("F · os dois modais estão abertos", doisAbertos.modais === 2, JSON.stringify(doisAbertos));
  await shot("52-f-dois-modais-abertos");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const aposEscape = await page.evaluate(() => {
    const modais = [...document.querySelectorAll(".modal-fullscreen")];
    return {
      modais: modais.length,
      crumb: modais[0]?.querySelector(".modal-fullscreen__crumb")?.textContent?.trim() ?? null,
      titulo: modais[0]?.querySelector(".modal-fullscreen__title h2")?.textContent?.trim() ?? null,
      cadastroDeItemAberto: Boolean(document.querySelector("#item-form")),
      relacaoAberta: Boolean(document.querySelector("#supplier-item-form")),
      codigoDoRascunho: document.querySelector("#supplier-item-code")?.value ?? null,
    };
  });
  check(
    "F · um Escape fecha só o cadastro de Item",
    aposEscape.modais === 1 && aposEscape.cadastroDeItemAberto === false,
    JSON.stringify(aposEscape),
  );
  check(
    "F · a relação Item × Fornecedor continua aberta, com o rascunho intacto",
    aposEscape.relacaoAberta === true && aposEscape.codigoDoRascunho === MARCA_F,
    JSON.stringify(aposEscape),
  );
  await shot("52-f-so-o-de-dentro-fechou");

  // Rótulo acessível de modal empilhado: cada camada anuncia o próprio
  // título. Dois rótulos iguais significam `id` colidindo no componente.
  check(
    "F · cada modal empilhado anuncia o próprio título",
    doisAbertos.rotulos.length === 2 &&
      doisAbertos.rotulos.every(Boolean) &&
      doisAbertos.rotulos[0] !== doisAbertos.rotulos[1],
    JSON.stringify(doisAbertos.rotulos),
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  check(
    "F · o segundo Escape fecha a relação",
    (await page.locator(".modal-fullscreen").count()) === 0,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // I — ajuda: papel do modal e bolha do ⓘ de coluna
  // ═══════════════════════════════════════════════════════════════════════
  // `alertdialog` interrompe e manda ler AGORA; ajuda pedida por clique não
  // é interrupção. Anunciar ajuda com urgência de alerta ensina a ignorar o
  // alerta seguinte, que pode ser de verdade.
  await abrir("/cadastros/produtos");
  await page.locator("button.context-help__trigger").first().click();
  await page.waitForSelector(".help-modal", { timeout: 8000 });
  await page.waitForTimeout(400);
  const papeis = await page.evaluate(() => ({
    dialog: document.querySelectorAll('[role="dialog"]').length,
    alertdialog: document.querySelectorAll('[role="alertdialog"]').length,
    casca: document.querySelector(".confirm-dialog")?.getAttribute("role") ?? null,
    rotuladoPor: document.querySelector(".confirm-dialog")?.getAttribute("aria-labelledby") ?? null,
    tituloExiste: Boolean(
      document.querySelector(
        `#${CSS.escape(document.querySelector(".confirm-dialog")?.getAttribute("aria-labelledby") ?? "x")}`,
      ),
    ),
  }));
  check(
    "I · a ajuda contextual abre como role=dialog",
    papeis.casca === "dialog" && papeis.dialog >= 1,
    JSON.stringify(papeis),
  );
  check(
    "I · nenhum role=alertdialog na página com a ajuda aberta",
    papeis.alertdialog === 0,
    `${papeis.alertdialog} encontrado(s)`,
  );
  check("I · o diálogo tem rótulo acessível existente", papeis.tituloExiste === true);
  await shot("52-i-ajuda-role-dialog");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  /*
   * Bolha do ⓘ de cabeçalho de coluna.
   *
   * Ela é `position: fixed` com coordenada medida em JS justamente porque
   * `.table-container { overflow-x: auto }` recorta o eixo vertical junto.
   * Aqui se confere o que o usuário vê: a bolha inteira dentro da janela.
   */
  await abrir("/compras/ordens/nova", ".doc-title");
  await page.locator('button:has-text("Adicionar item")').first().click();
  await page.waitForTimeout(600);
  const gatilhos = page.locator(".table-container thead .info-hint__trigger");
  const quantosGatilhos = await gatilhos.count();
  check(
    "I · a tela tem ⓘ de cabeçalho de coluna para provar",
    quantosGatilhos > 0,
    `${quantosGatilhos} ícone(s)`,
  );
  for (let i = 0; i < quantosGatilhos; i += 1) {
    const rotulo = await gatilhos.nth(i).getAttribute("aria-label");
    await gatilhos.nth(i).click();
    await page.waitForSelector(".info-hint__bubble", { timeout: 5000 });
    await page.waitForTimeout(300);
    const bolha = await page.evaluate(() => {
      const b = document.querySelector(".info-hint__bubble");
      if (!b) return { faltou: true };
      const r = b.getBoundingClientRect();
      const estilo = getComputedStyle(b);
      return {
        rect: {
          top: Math.round(r.top),
          left: Math.round(r.left),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
        },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        posicao: estilo.position,
        dentroDoViewport:
          r.top >= 0 &&
          r.left >= 0 &&
          r.right <= window.innerWidth &&
          r.bottom <= window.innerHeight,
      };
    });
    check(
      `I · bolha do ⓘ "${rotulo}" aparece inteira dentro do viewport`,
      bolha.dentroDoViewport === true && bolha.posicao === "fixed",
      JSON.stringify(bolha),
    );
    if (i === 0) await shot("52-i-bolha-do-cabecalho");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // G e H — largura de tabela nos três viewports de desktop
  // ═══════════════════════════════════════════════════════════════════════
  // G: a PÁGINA não pode rolar de lado — quando ela rola, o cabeçalho, o
  //    menu e a paginação saem do lugar junto. A rolagem do `.table-container`
  //    é registrada, não reprovada: numa tabela de catorze colunas de
  //    negócio, rolar dentro da moldura é o comportamento correto.
  // H: a coluna de ações é a única cuja largura não carrega informação. Dois
  //    botões dizem o mesmo em 88px ou em 211px.
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    const largura = vp.width;

    for (const tela of LISTAGENS) {
      await page.goto(`${WEB}${tela.rota}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".page__title", { timeout: 30000 });
      await page
        .waitForSelector("table tbody tr, .table__empty, .empty-state", { timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(800);

      const m = await page.evaluate(medirTabelasNaPagina);
      const rolagemLocal = Math.max(0, ...m.containers.map((c) => c.overflow), 0);

      check(
        `G · ${largura} · ${tela.rotulo} — a página não rola na horizontal`,
        m.overflowGlobal <= 1,
        `sobra ${m.overflowGlobal}px além de ${m.viewport.largura}px`,
      );
      anotar(
        `G · ${largura} · ${tela.rotulo}: rolagem local do .table-container = ${rolagemLocal}px` +
          ` (permitida)`,
      );

      const comAcoes = m.tabelas.filter((t) => t.acoes && t.linhas > 0);
      if (comAcoes.length === 0) {
        anotar(`H · ${largura} · ${tela.rotulo}: nenhuma tabela com coluna de ações e linhas`);
      }
      for (const t of comAcoes) {
        const { posicao, totalColunas, largura: larguraAcoes, ranking } = t.acoes;
        rankings.push({
          viewport: largura,
          tela: tela.rotulo,
          larguraAcoes,
          posicao,
          totalColunas,
          ranking,
        });
        if (totalColunas < 4) {
          // Com três colunas ou menos a pergunta não tem resposta possível:
          // qualquer coluna está entre as três mais largas.
          anotar(
            `H · ${largura} · ${tela.rotulo}: tabela com ${totalColunas} colunas — regra não aplicável`,
          );
          continue;
        }
        check(
          `H · ${largura} · ${tela.rotulo} — ações fora das três colunas mais largas`,
          posicao > 3,
          `ações=${larguraAcoes}px na posição ${posicao} de ${totalColunas} · top: ${ranking.join(", ")}`,
        );
      }

      await shot(
        `52-g-${largura}-${tela.rotulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      );
    }
  }
  await page.setViewportSize(VIEWPORTS[1]);

  // ═══════════════════════════════════════════════════════════════════════
  // Limpeza — pelo fluxo oficial da tela, não por chamada direta à API
  // ═══════════════════════════════════════════════════════════════════════
  // Inativar pela listagem é o caminho que o usuário tem, e usá-lo aqui
  // ainda confere de graça que o menu "⋯" e a confirmação funcionam.
  async function inativarTemporarios(rota, campoBusca, rotulo) {
    await abrir(rota);
    await page.fill(campoBusca, TOKEN);
    await page.waitForTimeout(1800);
    let ativos = await page.locator("tbody tr .badge--active").count();
    const encontrados = await page.locator("tbody tr").count();
    let voltas = 0;
    while (ativos > 0 && voltas < 8) {
      voltas += 1;
      const linha = page
        .locator("tbody tr")
        .filter({ has: page.locator(".badge--active") })
        .first();
      await linha.locator('button[aria-label="Mais ações"]').first().click();
      await page.waitForTimeout(350);
      await page.locator('.row-actions__menu button:has-text("Inativar")').first().click();
      await page.waitForSelector(".confirm-dialog", { timeout: 8000 });
      await page.locator(".confirm-dialog button.btn--danger").first().click();
      await page.waitForTimeout(1800);
      ativos = await page.locator("tbody tr .badge--active").count();
    }
    check(
      `limpeza · ${rotulo} temporário(s) inativado(s) pelo fluxo da tela`,
      ativos === 0,
      `${encontrados} linha(s) com o carimbo ${TOKEN}; ${ativos} ainda ativo(s)`,
    );
    await shot(`52-limpeza-${rotulo.toLowerCase()}`);
  }

  await inativarTemporarios("/cadastros/clientes", "#customers-search", "Clientes");
  await inativarTemporarios("/cadastros/fornecedores", "#suppliers-search", "Fornecedores");
  limpezaPelaTela = true;

  // Console sujo não reprova aqui — não é o que esta rodada mudou —, mas
  // some do relatório se não for anotado.
  if (consoleErrors.length > 0) {
    anotar(`console do navegador: ${consoleErrors.length} erro(s) — ${consoleErrors.slice(0, 3).join(" | ")}`);
  } else {
    anotar("console do navegador limpo durante toda a execução");
  }
} finally {
  if (browser) await browser.close();

  /*
   * Rede de segurança.
   *
   * Uma parada no meio (asserção que estoura, servidor que cai) deixaria o
   * cliente e o fornecedor de teste ATIVOS na base — aparecendo nas listas de
   * escolha de quem usar o ambiente depois. Aqui eles são inativados pela API
   * e o relatório diz que foi por este caminho, não pelo da tela.
   */
  if (!limpezaPelaTela) {
    for (const [tipo, lista] of Object.entries(criados)) {
      for (const r of lista) {
        try {
          await api("POST", `/${tipo}/${r.id}/deactivate`);
          console.log(`rede de segurança: ${tipo} ${r.code ?? r.id} inativado pela API`);
        } catch (e) {
          console.log(`rede de segurança FALHOU para ${tipo} ${r.code ?? r.id}: ${String(e).slice(0, 160)}`);
        }
      }
    }
  }
}

// ── Relatório ─────────────────────────────────────────────────────────────
console.log("\n── Ranking de largura da coluna de ações ──");
for (const r of rankings) {
  console.log(
    `${String(r.viewport).padStart(4)}  ${r.tela.padEnd(20)} ${String(r.larguraAcoes).padStart(6)}px` +
      `  posição ${r.posicao}/${r.totalColunas}  [${r.ranking.join(" | ")}]`,
  );
}

console.log("\n── Registros criados nesta execução ──");
for (const [tipo, lista] of Object.entries(criados)) {
  for (const r of lista) {
    console.log(` ${tipo}: ${r.code ?? "?"} ${r.id} "${r.legalName ?? r.name ?? "?"}" (${r.origem})`);
  }
}
console.log(` carimbo: ${TOKEN} · início: ${inicio}`);

console.log("\n── Observações (medidas, não vereditos) ──");
for (const o of observacoes) console.log(" ·", o);

console.log("\nscreenshots:");
for (const s of screenshots) console.log(" -", s);

if (failures.length > 0) {
  console.log(`\n${failures.length} verificação(ões) falharam:`);
  for (const f of failures) console.log(" -", f);
  process.exitCode = 1;
} else {
  console.log("\nvalidate52: todas as verificações passaram.");
}
