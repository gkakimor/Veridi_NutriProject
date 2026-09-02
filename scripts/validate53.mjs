import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação da capacidade 53 — criação canônica com URL própria e retorno.
 *
 * O que mudou: quatro entidades (Cliente, Produto, Item de estoque e
 * Fornecedor) ganharam TELA de criação com endereço próprio, e o "+ Novo X"
 * dos campos de busca deixou de abrir modal para NAVEGAR até ela. O rascunho
 * do formulário de origem viaja num registro de `sessionStorage` endereçado
 * por token, e o token viaja na URL.
 *
 * Por que isto precisa de navegador de verdade e não de teste unitário:
 *
 *  1. A promessa central é "sobrevive a um F5". Refresh não existe em jsdom:
 *     lá o módulo nunca é descarregado, o `sessionStorage` é um objeto na
 *     memória do mesmo processo e a árvore React não é remontada do zero.
 *     Só o navegador recarrega de fato;
 *  2. "virou URL, não modal" é uma afirmação sobre `location` e sobre a
 *     pilha de histórico. `render()` de biblioteca de teste com
 *     `MemoryRouter` não tem nem uma coisa nem outra — e é exatamente por
 *     isso que o botão VOLTAR do navegador é um caminho que só aqui se
 *     percorre;
 *  3. "o item volta para a LINHA que pediu" depende de o contexto atravessar
 *     serialização, navegação e remontagem carregando a chave da linha. Um
 *     render isolado que nunca desmonta a origem não exercita nada disso;
 *  4. rolagem horizontal de página é resultado do motor de layout. jsdom
 *     devolve 0 para toda medida de caixa.
 *
 * O que este script NÃO tenta ser: teste de regressão de conteúdo. Ele não
 * confere textos de ajuda nem a lista de campos de cada cadastro — confere o
 * mecanismo de sair, voltar e restaurar.
 *
 * Registros criados nascem com um carimbo de tempo no nome e são INATIVADOS
 * no fim pelo fluxo oficial das listagens, com rede de segurança pela API no
 * `finally`. O que sobrar é dito no relatório final, com nome e id.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate53.mjs handoff/screens
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
 * Curto o bastante para caber no campo de busca das listagens (é por ele que
 * a limpeza acha o que criou) e único o bastante para que duas execuções no
 * mesmo dia não se confundam.
 */
const TOKEN = `V53${Date.now().toString(36).toUpperCase()}`;

/** Registros que vão nascer nesta execução — todos carimbados. */
const NOME_CLIENTE_F1 = `ZZ TEMP CLIENTE ${TOKEN}`;
const NOME_CLIENTE_DIRETO = `ZZ TEMP CLIENTE DIRETO ${TOKEN}`;
const NOME_FORNECEDOR = `ZZ TEMP FORNECEDOR ${TOKEN}`;
const NOME_ITEM = `ZZ TEMP ITEM ${TOKEN}`;
const NOME_PRODUTO_F5 = `ZZ TEMP PRODUTO ${TOKEN}`;

const inicio = new Date().toISOString();

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
];

/** As quatro telas oficiais de criação que esta rodada trouxe. */
const PAGINAS_DE_CRIACAO = [
  { rotulo: "Cliente", rota: "/cadastros/clientes/novo", form: "#customer-form" },
  { rotulo: "Produto", rota: "/cadastros/produtos/novo", form: "#product-form" },
  {
    rotulo: "Item de estoque",
    rota: "/cadastros/itens/novo?tipo=RAW_MATERIAL",
    form: "#item-form",
  },
  { rotulo: "Fornecedor", rota: "/cadastros/fornecedores/novo", form: "#supplier-form" },
];

const screenshots = [];
/** Registros criados durante a validação, para a limpeza e o relatório. */
const criados = { customers: [], suppliers: [], items: [], products: [] };

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
   * Console e erros de página.
   *
   * Aqui isto REPROVA, ao contrário da rodada anterior. Uma navegação que
   * remonta a árvore inteira no meio de um formulário é o tipo de mudança
   * que produz aviso de estado atualizado fora de tempo, `key` duplicada de
   * linha restaurada e leitura de propriedade em objeto que ainda não
   * chegou — tudo isso aparece no console e em nenhum outro lugar.
   */
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console.error: ${m.text().slice(0, 220)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 220)}`));

  /*
   * Captura da resposta da API para cada cadastro feito pela TELA.
   *
   * É daqui que sai "o id que a API devolveu". Comparar esse id com o que o
   * campo selecionou é a única forma de provar que a escolha foi por id e
   * não por nome — com homônimo na base, casar por nome acertaria o registro
   * errado sem que nada na tela denunciasse.
   */
  page.on("response", async (res) => {
    if (res.request().method() !== "POST" || !res.ok()) return;
    const rota = new URL(res.url()).pathname;
    if (!/^\/(customers|suppliers|items|products)$/.test(rota)) return;
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
   * Espera pela ÂNCORA da tela, não por tempo: as telas do Veridi puxam
   * catálogos grandes junto, e `networkidle` chega muito depois do momento em
   * que o cabeçalho e o formulário já estão pintados.
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

  // ── Ferramentas ─────────────────────────────────────────────────────────

  /** Espera a URL satisfazer um teste. Navegação é assíncrona; asserção não. */
  async function esperarUrl(testar, timeout = 20000) {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      if (testar(page.url())) return true;
      await page.waitForTimeout(120);
    }
    return false;
  }

  /**
   * Espera a navegação chegar À TELA, não só à URL.
   *
   * `location` muda no instante em que o roteador aceita a rota; a árvore
   * nova só aparece um tique depois. Medir entre as duas coisas leria o
   * título e a trilha da tela ANTERIOR e reprovaria o produto por um defeito
   * que é do relógio do teste.
   */
  async function esperarPaginaDeCriacao(pathname, seletorForm) {
    const chegou = await esperarUrl((u) => new URL(u).pathname === pathname);
    await page.waitForSelector(seletorForm, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(900);
    return chegou;
  }

  /** O mesmo para a volta: a origem também remonta depois da URL mudar. */
  async function esperarRetornoPara(pathname, seletorAncora, timeout = 30000) {
    const chegou = await esperarUrl((u) => new URL(u).pathname === pathname, timeout);
    await page.waitForSelector(seletorAncora, { timeout: 25000 }).catch(() => {});
    // A limpeza do `?retomar=` é um `navigate(replace)` disparado logo depois
    // da restauração; dar tempo a ela evita medir o instante errado.
    await page.waitForTimeout(2500);
    return chegou;
  }

  /** `pathname` + parâmetros da URL corrente, já separados para asserção. */
  function urlAtual() {
    const u = new URL(page.url());
    return {
      href: page.url(),
      pathname: u.pathname,
      origem: u.searchParams.get("origem"),
      retomar: u.searchParams.get("retomar"),
      busca: u.search,
    };
  }

  /** Tira o foco do campo atual: `focus()` num campo já focado não dispara. */
  const desfocar = async () => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(120);
  };

  /** Abre a lista de um combobox pelo foco. */
  async function abrirListaDe(locator) {
    await desfocar();
    await locator.focus();
    await page.waitForSelector(".entity-select__list", { timeout: 10000 });
    await page.waitForTimeout(300);
  }

  /** Fecha a lista sem escolher — Escape descarta a busca digitada. */
  const fecharLista = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  };

  /**
   * Id da entidade escolhida num campo, lido do DOM.
   *
   * O `<li>` de cada opção tem `id = "<listId>-<id da entidade>"` e a
   * escolhida carrega `aria-selected="true"`. É o único ponto em que o
   * estado interno do componente aflora no HTML — e é exatamente o que as
   * provas "selecionado pelo id" precisam comparar com a resposta da API.
   *
   * O `filtro` existe porque a lista renderiza no máximo 50 resultados: num
   * catálogo de centenas, a opção selecionada pode simplesmente não estar no
   * DOM. Digitar o código/nome dela a traz para a lista antes da leitura, e
   * o Escape seguinte descarta a busca sem tocar na seleção.
   */
  async function idSelecionadoDe(locator, filtro = "") {
    await abrirListaDe(locator);
    let id = await lerSelecionado();
    if (!id && filtro) {
      await page.keyboard.type(filtro, { delay: 15 });
      await page.waitForTimeout(450);
      id = await lerSelecionado();
    }
    await fecharLista();
    return id;
  }

  const lerSelecionado = () =>
    page.evaluate(() => {
      const ul = document.querySelector(".entity-select__list");
      if (!ul) return null;
      const op = ul.querySelector(
        '[role="option"][aria-selected="true"]:not(.entity-select__create)',
      );
      if (!op) return null;
      return op.id.startsWith(`${ul.id}-`) ? op.id.slice(ul.id.length + 1) : null;
    });

  /** Retrato do campo: valor, placeholder e se há seleção confirmada. */
  const retratoDoCampo = (seletor) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return { faltou: true };
      return {
        valor: el.value ?? null,
        placeholder: el.getAttribute("placeholder") ?? null,
        // O ✕ só existe quando há entidade escolhida — é o sinal mais
        // honesto de "tem seleção", porque o texto do campo pode ser
        // placeholder, busca digitada ou rótulo do escolhido.
        temBotaoLimpar: Boolean(el.closest(".entity-select")?.querySelector(".entity-select__clear")),
      };
    }, seletor);

  /** Trilha da página, com o separador que o leitor humano usa. */
  const trilha = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".page-crumbs ol li")]
        .map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim())
        .join(" › "),
    );

  /** Estado da tela de criação: é contextual (tem volta) ou é direta? */
  const retratoDaTelaDeCriacao = (seletorForm) =>
    page.evaluate((s) => {
      const voltar = [...document.querySelectorAll(".page__header button")].find((b) =>
        (b.textContent ?? "").includes("← Voltar para"),
      );
      return {
        formularioPresente: Boolean(document.querySelector(s)),
        titulo: (document.querySelector("h1.page__title")?.textContent ?? "").trim(),
        // A prova de que NÃO é modal: nenhuma camada de modal na página.
        modais: document.querySelectorAll(".modal-fullscreen").length,
        textoDoVoltar: voltar ? (voltar.textContent ?? "").replace(/\s+/g, " ").trim() : null,
      };
    }, seletorForm);

  /** Clica no "+ Novo X" da lista aberta. */
  const clicarNovo = async () => {
    await page.locator(".entity-select__create").first().click();
  };

  /** Quantos registros com o carimbo existem na base, pela API. */
  const contarNaBase = async (colecao, termo) => {
    const r = await api("GET", `/${colecao}?search=${encodeURIComponent(termo)}&pageSize=100`);
    const lista = r?.[colecao] ?? r?.data ?? [];
    return Array.isArray(lista) ? lista.length : 0;
  };

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 1 — Cliente, com REFRESH. O requisito principal.
  // ═══════════════════════════════════════════════════════════════════════
  // O caso que justifica a mudança inteira: alguém digitou meio produto,
  // descobriu que o cliente não existe, saiu para cadastrá-lo — e no meio do
  // caminho a página foi recarregada. Com modal, tudo se perdia; com URL e
  // contexto em `sessionStorage`, nada se perde. O F5 é o teste, não um
  // detalhe do teste.
  /*
   * O homônimo é semeado ANTES da tela abrir, para estar na lista de
   * clientes que o formulário carrega.
   *
   * Sem ele, "o campo mostra o cliente novo" não distingue seleção por id de
   * seleção por nome: qualquer implementação que casasse texto passaria. Com
   * dois clientes de razão social IDÊNTICA na base, só quem guarda o id
   * acerta. Ele é inativado junto com o resto no fim.
   */
  const homonimo = await api("POST", "/customers", { legalName: NOME_CLIENTE_F1 });
  criados.customers.push({ ...homonimo, origem: "homônimo semeado pela API" });
  console.log(`homônimo semeado: ${homonimo.code} ${homonimo.id}`);

  await abrir("/cadastros/produtos/novo");
  check(
    "F1 · a tela oficial de criação de produto abre por URL própria",
    (await page.locator("#product-form").count()) === 1 &&
      urlAtual().pathname === "/cadastros/produtos/novo",
    JSON.stringify(urlAtual()),
  );

  const NOME_RASCUNHO_F1 = `ZZ RASCUNHO PRODUTO ${TOKEN}`;
  const REF_RASCUNHO_F1 = `REF-${TOKEN}`;
  await page.fill("#product-name", NOME_RASCUNHO_F1);
  // "pelo menos mais um campo": a referência externa é texto livre, então o
  // que voltar tem que ser exatamente o que foi digitado — sem máscara nem
  // normalização no meio para explicar uma diferença.
  await page.fill("#product-external-code", REF_RASCUNHO_F1);
  await shot("53-f1-01-rascunho-do-produto");

  await abrirListaDe(page.locator("#product-customer"));
  await clicarNovo();

  const chegouNaCriacaoDeCliente = await esperarPaginaDeCriacao(
    "/cadastros/clientes/novo",
    "#customer-form",
  );
  const urlF1 = urlAtual();
  check(
    "F1 · o + Novo cliente NAVEGA para /cadastros/clientes/novo",
    chegouNaCriacaoDeCliente && urlF1.pathname === "/cadastros/clientes/novo",
    JSON.stringify(urlF1),
  );
  check(
    "F1 · a URL leva o token de origem (?origem=…)",
    Boolean(urlF1.origem) && urlF1.origem.length > 0,
    JSON.stringify(urlF1),
  );
  const telaClienteF1 = await retratoDaTelaDeCriacao("#customer-form");
  check(
    "F1 · é PÁGINA, não modal — zero camadas de modal na tela",
    telaClienteF1.modais === 0 && telaClienteF1.formularioPresente === true,
    JSON.stringify(telaClienteF1),
  );
  check(
    "F1 · a página contextual oferece a volta rotulada para a origem",
    telaClienteF1.textoDoVoltar === "← Voltar para Produto",
    JSON.stringify(telaClienteF1),
  );
  await shot("53-f1-02-url-virou-cadastro-de-cliente");

  // ── O F5 ────────────────────────────────────────────────────────────────
  // Aqui a árvore React inteira é jogada fora e remontada do zero. O que
  // sobreviver daqui para a frente sobreviveu porque está em
  // `sessionStorage` e endereçado pela URL, não porque um componente
  // continuou montado.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#customer-form", { timeout: 30000 });
  await page.waitForTimeout(1200);

  const urlDepoisDoF5 = urlAtual();
  const telaDepoisDoF5 = await retratoDaTelaDeCriacao("#customer-form");
  check(
    "F1 · depois do F5 a URL continua a mesma, com o token",
    urlDepoisDoF5.pathname === "/cadastros/clientes/novo" &&
      urlDepoisDoF5.origem === urlF1.origem,
    JSON.stringify({ antes: urlF1, depois: urlDepoisDoF5 }),
  );
  check(
    "F1 · depois do F5 a página ainda sabe para onde voltar",
    telaDepoisDoF5.textoDoVoltar === "← Voltar para Produto",
    JSON.stringify(telaDepoisDoF5),
  );
  await shot("53-f1-03-depois-do-f5");

  await page.fill("#customer-legal-name", NOME_CLIENTE_F1);
  const clientesAntesF1 = criados.customers.length;
  await page.locator('button[form="customer-form"]').first().click();

  const voltouAoProduto = await esperarRetornoPara(
    "/cadastros/produtos/novo",
    "#product-form",
  );

  const urlDeVolta = urlAtual();
  check(
    "F1 · (i) salvar o cliente devolve para /cadastros/produtos/novo",
    voltouAoProduto && urlDeVolta.pathname === "/cadastros/produtos/novo",
    JSON.stringify(urlDeVolta),
  );
  check(
    "F1 · (i) o token de retomada sai da URL depois de consumido",
    urlDeVolta.retomar === null,
    // Deixá-lo ali faria um F5 seguinte tentar retomar um contexto já
    // consumido, e um link compartilhado carregaria um token morto.
    JSON.stringify(urlDeVolta),
  );
  check(
    "F1 · o POST /customers respondeu",
    criados.customers.length > clientesAntesF1,
    `${criados.customers.length - clientesAntesF1} resposta(s) capturada(s)`,
  );
  const clienteF1 =
    criados.customers.length > clientesAntesF1
      ? criados.customers[criados.customers.length - 1]
      : null;

  const rascunhoF1 = await page.evaluate(() => ({
    nome: document.querySelector("#product-name")?.value ?? null,
    referencia: document.querySelector("#product-external-code")?.value ?? null,
  }));
  check(
    "F1 · (ii) o nome do produto atravessou saída, F5, salvamento e volta",
    rascunhoF1.nome === NOME_RASCUNHO_F1,
    JSON.stringify(rascunhoF1),
  );
  check(
    "F1 · (ii) o segundo campo do rascunho também voltou",
    rascunhoF1.referencia === REF_RASCUNHO_F1,
    JSON.stringify(rascunhoF1),
  );

  const campoClienteF1 = await retratoDoCampo("#product-customer");
  check(
    "F1 · (iii) o campo Cliente mostra o cliente recém-criado",
    (campoClienteF1.valor ?? "").includes(NOME_CLIENTE_F1) ||
      (campoClienteF1.placeholder ?? "").includes(NOME_CLIENTE_F1),
    JSON.stringify(campoClienteF1),
  );
  await shot("53-f1-04-produto-restaurado-com-cliente-novo");

  const idNoCampoF1 = await idSelecionadoDe(page.locator("#product-customer"), TOKEN);
  check(
    "F1 · (iv) o id selecionado é o que a API devolveu, não o do homônimo",
    Boolean(clienteF1) && idNoCampoF1 === clienteF1.id && idNoCampoF1 !== homonimo.id,
    JSON.stringify({
      noCampo: idNoCampoF1,
      daApi: clienteF1?.id ?? null,
      homonimo: homonimo.id,
    }),
  );
  anotar(
    `F1 · havia um homônimo "${NOME_CLIENTE_F1}" na base (${homonimo.code}, id ${homonimo.id}); ` +
      `o campo escolheu ${idNoCampoF1}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 2 — cancelar
  // ═══════════════════════════════════════════════════════════════════════
  // O outro desfecho. O rascunho tem que voltar igual, o campo tem que ficar
  // VAZIO — texto parado no campo sem seleção confirmada lê como escolha
  // feita — e nada pode ter sido gravado.
  await abrir("/cadastros/produtos/novo");
  const NOME_RASCUNHO_F2 = `ZZ RASCUNHO CANCELADO ${TOKEN}`;
  const REF_RASCUNHO_F2 = `REFCANC-${TOKEN}`;
  await page.fill("#product-name", NOME_RASCUNHO_F2);
  await page.fill("#product-external-code", REF_RASCUNHO_F2);

  const clientesNaBaseAntesF2 = await contarNaBase("customers", TOKEN);

  await abrirListaDe(page.locator("#product-customer"));
  // Digita antes de sair: é o texto que ficaria no campo se a desistência
  // não limpasse nada — o pior caso para esta prova.
  await page.keyboard.type("ZZ CLIENTE QUE NAO EXISTE", { delay: 20 });
  await page.waitForTimeout(400);
  await clicarNovo();
  await esperarPaginaDeCriacao("/cadastros/clientes/novo", "#customer-form");
  const urlF2 = urlAtual();
  check(
    "F2 · sair para criar também aqui é navegação com token na URL",
    urlF2.pathname === "/cadastros/clientes/novo" && Boolean(urlF2.origem),
    JSON.stringify(urlF2),
  );
  await shot("53-f2-01-cadastro-de-cliente-antes-de-cancelar");

  await page.locator('.doc-actions button:has-text("Cancelar")').first().click();
  const voltouCancelando = await esperarRetornoPara(
    "/cadastros/produtos/novo",
    "#product-form",
  );

  const urlF2Volta = urlAtual();
  check(
    "F2 · Cancelar devolve para /cadastros/produtos/novo",
    voltouCancelando && urlF2Volta.pathname === "/cadastros/produtos/novo",
    JSON.stringify(urlF2Volta),
  );
  const rascunhoF2 = await page.evaluate(() => ({
    nome: document.querySelector("#product-name")?.value ?? null,
    referencia: document.querySelector("#product-external-code")?.value ?? null,
  }));
  check(
    "F2 · o rascunho sobreviveu à desistência",
    rascunhoF2.nome === NOME_RASCUNHO_F2 && rascunhoF2.referencia === REF_RASCUNHO_F2,
    JSON.stringify(rascunhoF2),
  );
  const campoClienteF2 = await retratoDoCampo("#product-customer");
  check(
    "F2 · o campo Cliente ficou vazio — nada selecionado",
    campoClienteF2.valor === "" && campoClienteF2.temBotaoLimpar === false,
    JSON.stringify(campoClienteF2),
  );
  const clientesNaBaseDepoisF2 = await contarNaBase("customers", TOKEN);
  check(
    "F2 · cancelar não criou nenhum cliente",
    clientesNaBaseDepoisF2 === clientesNaBaseAntesF2,
    `antes=${clientesNaBaseAntesF2} depois=${clientesNaBaseDepoisF2} (busca por "${TOKEN}")`,
  );
  await shot("53-f2-02-produto-restaurado-sem-cliente");

  // ═══════════════════════════════════════════════════════════════════════
  // VOLTAR DO NAVEGADOR — sair para criar e voltar sem usar Cancelar
  // ═══════════════════════════════════════════════════════════════════════
  // Este é o caminho que nenhum botão da tela controla. Quem volta pelo
  // navegador chega à origem SEM o parâmetro de retomada; se o rascunho
  // dependesse só da URL, o formulário apareceria vazio e o trabalho estaria
  // perdido — justamente na tecla que todo mundo aperta por reflexo.
  await abrir("/cadastros/produtos/novo");
  const NOME_RASCUNHO_BACK = `ZZ RASCUNHO VOLTAR ${TOKEN}`;
  const REF_RASCUNHO_BACK = `REFVOLTAR-${TOKEN}`;
  await page.fill("#product-name", NOME_RASCUNHO_BACK);
  await page.fill("#product-external-code", REF_RASCUNHO_BACK);

  await abrirListaDe(page.locator("#product-customer"));
  await clicarNovo();
  await esperarPaginaDeCriacao("/cadastros/clientes/novo", "#customer-form");
  await shot("53-back-01-saiu-para-criar");

  await page.goBack();
  await page.waitForSelector("#product-form", { timeout: 20000 });
  await page.waitForTimeout(2000);

  const urlBack = urlAtual();
  const rascunhoBack = await page.evaluate(() => ({
    nome: document.querySelector("#product-name")?.value ?? null,
    referencia: document.querySelector("#product-external-code")?.value ?? null,
  }));
  check(
    "VOLTAR · o botão do navegador leva de volta à tela de origem",
    urlBack.pathname === "/cadastros/produtos/novo",
    JSON.stringify(urlBack),
  );
  check(
    "VOLTAR · o rascunho foi restaurado, não veio vazio",
    rascunhoBack.nome === NOME_RASCUNHO_BACK &&
      rascunhoBack.referencia === REF_RASCUNHO_BACK,
    JSON.stringify(rascunhoBack),
  );
  const campoClienteBack = await retratoDoCampo("#product-customer");
  check(
    "VOLTAR · sem salvar, o campo Cliente continua vazio",
    campoClienteBack.valor === "" && campoClienteBack.temBotaoLimpar === false,
    JSON.stringify(campoClienteBack),
  );
  await shot("53-back-02-rascunho-restaurado-pelo-voltar");

  // O Avançar do navegador é registrado como medida, não como veredito: o
  // contexto já foi consumido pela restauração, então a tela de criação
  // reaparece como cadastro normal — comportamento defensável, mas que o
  // enunciado não fixa.
  await page.goForward();
  await page.waitForSelector("#customer-form", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const telaAvancar = await retratoDaTelaDeCriacao("#customer-form");
  anotar(
    `VOLTAR · depois do Avançar do navegador a tela de cliente reabre como ` +
      `${telaAvancar.textoDoVoltar ? "contextual" : "cadastro direto"} ` +
      `(url ${urlAtual().pathname}${urlAtual().busca})`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 3 — Fornecedor a partir de uma Ordem de Compra
  // ═══════════════════════════════════════════════════════════════════════
  // Contexto real: a OC exige fornecedor, e o fornecedor novo é justamente o
  // motivo pelo qual a compra está sendo aberta. Aqui a origem não é uma
  // tela de cadastro — é um documento, com data, notas e linhas.
  await abrir("/compras/ordens/nova", ".doc-title");
  await page.waitForSelector("#po-supplier", { timeout: 20000 });
  await page.waitForTimeout(600);

  const DATA_OC = "2026-09-15";
  const NOTAS_OC = `ZZ NOTA OC ${TOKEN}`;
  await page.fill("#po-order-date", DATA_OC);
  await page.fill("#po-notes", NOTAS_OC);

  await abrirListaDe(page.locator("#po-supplier"));
  await clicarNovo();
  await esperarPaginaDeCriacao("/cadastros/fornecedores/novo", "#supplier-form");
  const urlF3 = urlAtual();
  const telaF3 = await retratoDaTelaDeCriacao("#supplier-form");
  check(
    "F3 · o + Novo fornecedor NAVEGA para /cadastros/fornecedores/novo?origem=…",
    urlF3.pathname === "/cadastros/fornecedores/novo" && Boolean(urlF3.origem),
    JSON.stringify(urlF3),
  );
  check(
    "F3 · é página, não modal, e diz que volta para a Ordem de compra",
    telaF3.modais === 0 && telaF3.textoDoVoltar === "← Voltar para Ordem de compra",
    JSON.stringify(telaF3),
  );
  check(
    "F3 · a trilha é canônica, não o caminho percorrido",
    (await trilha()) === "Cadastros › Fornecedores › Novo fornecedor",
    `trilha="${await trilha()}"`,
  );
  await shot("53-f3-01-cadastro-de-fornecedor-vindo-da-oc");

  await page.fill("#supplier-legal-name", NOME_FORNECEDOR);
  const fornecedoresAntes = criados.suppliers.length;
  await page.locator('button[form="supplier-form"]').first().click();
  await esperarRetornoPara("/compras/ordens/nova", "#po-supplier");

  const urlF3Volta = urlAtual();
  check(
    "F3 · salvar devolve para a Ordem de Compra em que se estava",
    urlF3Volta.pathname === "/compras/ordens/nova" && urlF3Volta.retomar === null,
    JSON.stringify(urlF3Volta),
  );
  check(
    "F3 · o POST /suppliers respondeu",
    criados.suppliers.length > fornecedoresAntes,
    `${criados.suppliers.length - fornecedoresAntes} resposta(s)`,
  );
  const fornecedorCriado = criados.suppliers[criados.suppliers.length - 1] ?? null;
  const rascunhoF3 = await page.evaluate(() => ({
    data: document.querySelector("#po-order-date")?.value ?? null,
    notas: document.querySelector("#po-notes")?.value ?? null,
  }));
  check(
    "F3 · o rascunho da Ordem de Compra sobreviveu",
    rascunhoF3.data === DATA_OC && rascunhoF3.notas === NOTAS_OC,
    JSON.stringify(rascunhoF3),
  );
  const idFornecedorNoCampo = await idSelecionadoDe(page.locator("#po-supplier"), TOKEN);
  check(
    "F3 · o fornecedor voltou selecionado, pelo id que a API devolveu",
    Boolean(fornecedorCriado) && idFornecedorNoCampo === fornecedorCriado.id,
    JSON.stringify({ noCampo: idFornecedorNoCampo, daApi: fornecedorCriado?.id ?? null }),
  );
  await shot("53-f3-02-oc-com-fornecedor-novo");

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 4 — Item de estoque, e na LINHA que pediu
  // ═══════════════════════════════════════════════════════════════════════
  // Item não é campo único: ele é COLUNA de tabela. Se o contexto não
  // carregasse qual linha pediu a criação, o item novo cairia sempre na
  // primeira — e numa OC de dez linhas isso é pior que não voltar nada,
  // porque troca silenciosamente o que já estava escolhido.
  //
  // A prova é montada com DUAS linhas, e a criação sai da SEGUNDA. Uma linha
  // só não distingue "voltou na linha certa" de "voltou na primeira".
  await page.locator('button:has-text("Adicionar item")').first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Adicionar item")').first().click();
  await page.waitForTimeout(700);

  const linhas = page.locator('input[id^="po-line-item-"]');
  check(
    "F4 · a Ordem de Compra tem duas linhas de item para distinguir",
    (await linhas.count()) === 2,
    `${await linhas.count()} linha(s)`,
  );

  // Linha 1 recebe um item REAL: é o valor que não pode ser atropelado.
  await abrirListaDe(linhas.nth(0));
  const primeiraOpcao = await page.evaluate(() => {
    const ul = document.querySelector(".entity-select__list");
    const op = ul?.querySelector('[role="option"]:not(.entity-select__create)');
    return {
      codigo: (op?.querySelector(".code")?.textContent ?? "").trim(),
      id: op && ul && op.id.startsWith(`${ul.id}-`) ? op.id.slice(ul.id.length + 1) : null,
    };
  });
  await page.keyboard.type(primeiraOpcao.codigo, { delay: 25 });
  await page.waitForTimeout(450);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const idLinha1Antes = await idSelecionadoDe(linhas.nth(0), primeiraOpcao.codigo);
  check(
    "F4 · a linha 1 tem um item escolhido antes da saída",
    Boolean(idLinha1Antes),
    JSON.stringify({ idLinha1Antes, primeiraOpcao }),
  );

  // A quantidade da linha 2 marca a linha: se o retorno recriasse a tabela,
  // este número sumiria junto.
  const QTD_LINHA2 = "77";
  await page
    .locator("table tbody tr")
    .nth(1)
    .locator('input[inputmode="decimal"]')
    .first()
    .fill(QTD_LINHA2);
  await page.waitForTimeout(300);
  await shot("53-f4-01-oc-com-duas-linhas");

  await abrirListaDe(linhas.nth(1));
  await clicarNovo();
  await esperarPaginaDeCriacao("/cadastros/itens/novo", "#item-form");
  const urlF4 = urlAtual();
  const telaF4 = await retratoDaTelaDeCriacao("#item-form");
  check(
    "F4 · o + Novo item de estoque NAVEGA para /cadastros/itens/novo?origem=…",
    urlF4.pathname === "/cadastros/itens/novo" && Boolean(urlF4.origem),
    JSON.stringify(urlF4),
  );
  check(
    "F4 · é página, não modal, e diz que volta para a Ordem de compra",
    telaF4.modais === 0 && telaF4.textoDoVoltar === "← Voltar para Ordem de compra",
    JSON.stringify(telaF4),
  );
  await shot("53-f4-02-cadastro-de-item-vindo-da-linha-2");

  await page.selectOption("#item-type", "RAW_MATERIAL");
  await page.waitForTimeout(300);
  const unidade = await page.evaluate(() => {
    const select = document.querySelector("#item-unit");
    const opcao = [...(select?.options ?? [])].find((o) => o.value);
    return opcao?.value ?? "";
  });
  await page.selectOption("#item-unit", unidade);
  await page.fill("#item-name", NOME_ITEM);
  const itensAntes = criados.items.length;
  await page.locator('button[form="item-form"]').first().click();
  await esperarRetornoPara("/compras/ordens/nova", "#po-supplier");
  // A linha recém-preenchida ainda busca código e unidade do item pelo id;
  // esperar é o que separa "voltou incompleta" de "voltou errada".
  await page.waitForTimeout(1500);

  check(
    "F4 · salvar devolve para a Ordem de Compra",
    urlAtual().pathname === "/compras/ordens/nova" && urlAtual().retomar === null,
    JSON.stringify(urlAtual()),
  );
  check(
    "F4 · o POST /items respondeu",
    criados.items.length > itensAntes,
    `${criados.items.length - itensAntes} resposta(s)`,
  );
  const itemCriado = criados.items[criados.items.length - 1] ?? null;

  const linhasDepois = page.locator('input[id^="po-line-item-"]');
  check(
    "F4 · a Ordem de Compra voltou com as duas linhas",
    (await linhasDepois.count()) === 2,
    `${await linhasDepois.count()} linha(s)`,
  );
  const idLinha2Depois = await idSelecionadoDe(linhasDepois.nth(1), TOKEN);
  const idLinha1Depois = await idSelecionadoDe(linhasDepois.nth(0), primeiraOpcao.codigo);
  check(
    "F4 · o item novo voltou NA LINHA 2, que foi quem pediu",
    Boolean(itemCriado) && idLinha2Depois === itemCriado.id,
    JSON.stringify({ linha2: idLinha2Depois, daApi: itemCriado?.id ?? null }),
  );
  check(
    "F4 · a linha 1 continua com o item que já estava — nada foi atropelado",
    idLinha1Depois === idLinha1Antes && idLinha1Depois !== (itemCriado?.id ?? null),
    JSON.stringify({ antes: idLinha1Antes, depois: idLinha1Depois }),
  );
  const qtdLinha2Depois = await page
    .locator("table tbody tr")
    .nth(1)
    .locator('input[inputmode="decimal"]')
    .first()
    .inputValue();
  check(
    "F4 · a quantidade digitada na linha 2 sobreviveu",
    qtdLinha2Depois === QTD_LINHA2,
    `quantidade="${qtdLinha2Depois}"`,
  );
  await shot("53-f4-03-item-voltou-na-linha-2");

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 5 — Produto a partir da linha de um Pedido
  // ═══════════════════════════════════════════════════════════════════════
  // Produto é a única entidade que é os DOIS lados do mecanismo: alvo aqui,
  // origem no FLOW 1. E o contexto que o Pedido manda junto trava o cliente
  // do produto — produto de um cliente dentro do documento de outro é
  // divergência que a tela não deve nem oferecer.
  await abrir("/comercial/pedidos/novo", ".doc-title");
  await page.waitForSelector("#co-customer", { timeout: 20000 });
  await page.waitForTimeout(600);

  await abrirListaDe(page.locator("#co-customer"));
  const clienteDoPedido = await page.evaluate(() => {
    const ul = document.querySelector(".entity-select__list");
    const op = ul?.querySelector('[role="option"]:not(.entity-select__create)');
    return {
      codigo: (op?.querySelector(".code")?.textContent ?? "").trim(),
      id: op && ul && op.id.startsWith(`${ul.id}-`) ? op.id.slice(ul.id.length + 1) : null,
    };
  });
  await page.keyboard.type(clienteDoPedido.codigo, { delay: 25 });
  await page.waitForTimeout(450);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  const ENTREGA_PEDIDO = "2026-10-20";
  await page.fill("#co-delivery-date", ENTREGA_PEDIDO);
  await page.locator('button:has-text("Adicionar produto")').first().click();
  await page.waitForSelector('input[id^="pedido-produto-"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  await abrirListaDe(page.locator('input[id^="pedido-produto-"]').first());
  await clicarNovo();
  await esperarPaginaDeCriacao("/cadastros/produtos/novo", "#product-form");
  const urlF5 = urlAtual();
  const telaF5 = await retratoDaTelaDeCriacao("#product-form");
  check(
    "F5 · o + Novo produto NAVEGA para /cadastros/produtos/novo?origem=…",
    urlF5.pathname === "/cadastros/produtos/novo" && Boolean(urlF5.origem),
    JSON.stringify(urlF5),
  );
  check(
    "F5 · é página, não modal, e diz que volta para o Pedido",
    telaF5.modais === 0 && telaF5.textoDoVoltar === "← Voltar para Pedido",
    JSON.stringify(telaF5),
  );
  /*
   * Cliente travado é FATO, não campo: a tela o publica como `<dt>/<dd>`, e
   * é assim que ele tem que ser lido. Procurar um `<input>` aqui provaria só
   * que o input não existe — o que não é a mesma coisa que "o cliente certo
   * chegou".
   */
  const clienteTravado = await page.evaluate(() => {
    const dt = [...document.querySelectorAll(".definition-list dt")].find(
      (el) => (el.textContent ?? "").trim() === "Cliente",
    );
    return {
      campoDeBusca: Boolean(document.querySelector("#product-customer")),
      valorFixo: (dt?.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim(),
      avisoDaOrigem: [...document.querySelectorAll(".field__hint")].some((p) =>
        (p.textContent ?? "").includes("Definido pela tela de origem"),
      ),
    };
  });
  check(
    "F5 · o cliente do Pedido chega travado no produto novo",
    clienteTravado.campoDeBusca === false &&
      clienteTravado.valorFixo.length > 0 &&
      clienteTravado.avisoDaOrigem === true,
    JSON.stringify(clienteTravado),
  );
  await shot("53-f5-01-cadastro-de-produto-vindo-do-pedido");

  await page.fill("#product-name", NOME_PRODUTO_F5);
  const produtosAntes = criados.products.length;
  await page.locator('button[form="product-form"]').first().click();
  await esperarRetornoPara("/comercial/pedidos/novo", "#co-customer");
  await page.waitForTimeout(1500);

  check(
    "F5 · salvar devolve para o Pedido em que se estava",
    urlAtual().pathname === "/comercial/pedidos/novo" && urlAtual().retomar === null,
    JSON.stringify(urlAtual()),
  );
  check(
    "F5 · o POST /products respondeu",
    criados.products.length > produtosAntes,
    `${criados.products.length - produtosAntes} resposta(s)`,
  );
  const produtoCriado = criados.products[criados.products.length - 1] ?? null;
  const entregaDepois = await page.evaluate(
    () => document.querySelector("#co-delivery-date")?.value ?? null,
  );
  check(
    "F5 · o rascunho do Pedido sobreviveu",
    entregaDepois === ENTREGA_PEDIDO,
    `entrega="${entregaDepois}"`,
  );
  const idProdutoNaLinha = await idSelecionadoDe(
    page.locator('input[id^="pedido-produto-"]').first(),
    TOKEN,
  );
  check(
    "F5 · o produto voltou selecionado na linha, pelo id que a API devolveu",
    Boolean(produtoCriado) && idProdutoNaLinha === produtoCriado.id,
    JSON.stringify({ naLinha: idProdutoNaLinha, daApi: produtoCriado?.id ?? null }),
  );
  await shot("53-f5-02-pedido-com-produto-novo");

  // ═══════════════════════════════════════════════════════════════════════
  // ACESSO DIRETO — a mesma tela sem contexto nenhum
  // ═══════════════════════════════════════════════════════════════════════
  // A URL própria só vale se a tela for uma tela de verdade: aberta pelo
  // menu, sem token, ela não pode oferecer uma volta que não existe nem
  // inventar hierarquia a partir de por onde a pessoa passou.
  await abrir("/cadastros/clientes");
  await page.locator('.page__header a.btn--primary').first().click();
  await esperarPaginaDeCriacao("/cadastros/clientes/novo", "#customer-form");

  const urlDireto = urlAtual();
  const telaDireta = await retratoDaTelaDeCriacao("#customer-form");
  check(
    "DIRETO · o botão da listagem leva a /cadastros/clientes/novo, sem token",
    urlDireto.pathname === "/cadastros/clientes/novo" && urlDireto.origem === null,
    JSON.stringify(urlDireto),
  );
  check(
    "DIRETO · a página funciona: formulário montado e título próprio",
    telaDireta.formularioPresente === true && telaDireta.titulo === "Novo cliente",
    JSON.stringify(telaDireta),
  );
  check(
    "DIRETO · a trilha é Cadastros › Clientes › Novo cliente",
    (await trilha()) === "Cadastros › Clientes › Novo cliente",
    `trilha="${await trilha()}"`,
  );
  check(
    "DIRETO · NÃO aparece '← Voltar para …' — não há origem para onde voltar",
    telaDireta.textoDoVoltar === null,
    JSON.stringify(telaDireta),
  );
  await shot("53-direto-01-cadastro-de-cliente-sem-contexto");

  await page.fill("#customer-legal-name", NOME_CLIENTE_DIRETO);
  const clientesAntesDireto = criados.customers.length;
  await page.locator('button[form="customer-form"]').first().click();
  const foiParaListagem = await esperarRetornoPara(
    "/cadastros/clientes",
    "#customers-search",
  );
  check(
    "DIRETO · salvar leva para a listagem de Clientes",
    foiParaListagem && urlAtual().pathname === "/cadastros/clientes",
    JSON.stringify(urlAtual()),
  );
  check(
    "DIRETO · o POST /customers respondeu",
    criados.customers.length > clientesAntesDireto,
    `${criados.customers.length - clientesAntesDireto} resposta(s)`,
  );
  await shot("53-direto-02-listagem-depois-de-salvar");

  // ═══════════════════════════════════════════════════════════════════════
  // TRÊS VIEWPORTS — as quatro telas de criação sem rolagem lateral
  // ═══════════════════════════════════════════════════════════════════════
  // A rolagem horizontal da PÁGINA leva junto o cabeçalho, o menu e o rodapé
  // de ações — o botão de salvar sai do lugar. Numa tela de formulário não
  // há tabela larga que justifique: se sobra largura, é defeito de layout.
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    for (const tela of PAGINAS_DE_CRIACAO) {
      await abrir(tela.rota);
      await page.waitForSelector(tela.form, { timeout: 20000 });
      await page.waitForTimeout(600);
      const medida = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          sobra: doc.scrollWidth - doc.clientWidth,
        };
      });
      check(
        `VP · ${vp.width}×${vp.height} · ${tela.rotulo} — a página não rola na horizontal`,
        medida.scrollWidth <= medida.clientWidth,
        `scrollWidth=${medida.scrollWidth} clientWidth=${medida.clientWidth} sobra=${medida.sobra}px`,
      );
      await shot(
        `53-vp-${vp.width}-${tela.rotulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      );
    }
  }
  await page.setViewportSize(VIEWPORTS[1]);

  // Prova de que o `?tipo=` da URL é lido — é a única forma de a tela de
  // item nascer já classificada, e ela só existe porque a criação tem URL.
  await abrir("/cadastros/itens/novo?tipo=RAW_MATERIAL");
  const tipoPreSelecionado = await page.evaluate(
    () => document.querySelector("#item-type")?.value ?? null,
  );
  check(
    "URL · /cadastros/itens/novo?tipo=RAW_MATERIAL abre com o tipo escolhido",
    tipoPreSelecionado === "RAW_MATERIAL",
    `tipo="${tipoPreSelecionado}"`,
  );
  await shot("53-url-item-com-tipo-na-query");

  // ═══════════════════════════════════════════════════════════════════════
  // Limpeza — pelo fluxo oficial das listagens, não por chamada à API
  // ═══════════════════════════════════════════════════════════════════════
  // Inativar pela listagem é o caminho que o usuário tem, e usá-lo aqui
  // ainda confere de graça que o menu "⋯" e a confirmação funcionam.
  //
  // Produtos vêm primeiro: o item de produto acabado nasce junto com o
  // produto e some da lista de "ativos" na ordem certa se o dono for
  // inativado antes.
  async function inativarTemporarios(rota, campoBusca, rotulo) {
    await abrir(rota);
    await page.fill(campoBusca, TOKEN);
    await page.waitForTimeout(1800);
    const encontrados = await page.locator("tbody tr").count();
    let ativos = await page.locator("tbody tr .badge--active").count();
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
    await shot(`53-limpeza-${rotulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
  }

  await inativarTemporarios("/cadastros/produtos", "#products-search", "Produtos");
  await inativarTemporarios("/cadastros/itens", "#items-search", "Itens");
  await inativarTemporarios("/cadastros/clientes", "#customers-search", "Clientes");
  await inativarTemporarios("/cadastros/fornecedores", "#suppliers-search", "Fornecedores");
  limpezaPelaTela = true;

  // ═══════════════════════════════════════════════════════════════════════
  // Console — zero erro na execução inteira
  // ═══════════════════════════════════════════════════════════════════════
  // Medido no fim de propósito: a promessa é sobre a execução toda, e
  // navegação que remonta a árvore no meio de um formulário é exatamente o
  // tipo de mudança que só se manifesta no console.
  check(
    "CONSOLE · zero console.error e zero pageerror na execução inteira",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 6).join(" | "),
  );
  if (consoleErrors.length > 0) {
    anotar(`console: ${consoleErrors.length} ocorrência(s) — lista completa abaixo`);
    for (const e of consoleErrors) anotar(`  console → ${e}`);
  }
} finally {
  if (browser) await browser.close();

  /*
   * Rede de segurança.
   *
   * Uma parada no meio (asserção que estoura, servidor que cai) deixaria os
   * registros de teste ATIVOS na base — aparecendo nas listas de escolha de
   * quem usar o ambiente depois. Aqui eles são inativados pela API e o
   * relatório diz que foi por este caminho, não pelo da tela.
   */
  if (!limpezaPelaTela) {
    for (const [tipo, lista] of Object.entries(criados)) {
      for (const r of lista) {
        try {
          await api("POST", `/${tipo}/${r.id}/deactivate`);
          console.log(`rede de segurança: ${tipo} ${r.code ?? r.id} inativado pela API`);
        } catch (e) {
          console.log(
            `rede de segurança FALHOU para ${tipo} ${r.code ?? r.id}: ${String(e).slice(0, 160)}`,
          );
        }
      }
    }
  }
}

// ── Relatório ─────────────────────────────────────────────────────────────
console.log("\n── Registros criados nesta execução ──");
for (const [tipo, lista] of Object.entries(criados)) {
  for (const r of lista) {
    console.log(
      ` ${tipo}: ${r.code ?? "?"} ${r.id} "${r.legalName ?? r.name ?? "?"}" (${r.origem})`,
    );
  }
}
console.log(
  ` limpeza pelo fluxo da tela: ${limpezaPelaTela ? "sim" : "não — rede de segurança pela API"}`,
);
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
  console.log("\nvalidate53: todas as verificações passaram.");
}
