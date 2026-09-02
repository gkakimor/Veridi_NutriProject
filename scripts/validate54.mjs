import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Validação da capacidade 54 — Recurso industrial ganha tela de criação.
 *
 * O que mudou: recurso industrial foi a ÚLTIMA das cinco entidades de
 * cadastro a sair do modal. Agora tem endereço próprio
 * (`/gestao/recursos-industriais/novo`), o formulário mora num módulo
 * compartilhado (`industrial-resource-form.tsx`), o "+ Novo recurso" da
 * listagem virou link e o campo "Recurso" da estrutura de custos NAVEGA
 * para a rota em vez de abrir modal, guardando o rascunho da linha.
 *
 * Por que isto precisa de navegador de verdade e não de teste unitário:
 *
 *  1. A promessa central é "sobrevive a um F5". Refresh não existe em jsdom:
 *     lá o módulo nunca é descarregado, o `sessionStorage` é um objeto na
 *     memória do mesmo processo e a árvore React não é remontada do zero.
 *     Só o navegador recarrega de fato;
 *  2. "virou URL, não modal" é afirmação sobre `location` e sobre a árvore
 *     montada. `render()` com `MemoryRouter` não tem `location` de verdade,
 *     e "zero `.modal-fullscreen`" só quer dizer alguma coisa na página
 *     inteira, com layout, cabeçalho e portais montados;
 *  3. a origem aqui é uma tela PESADA — a estrutura de custos do produto,
 *     que puxa versões, premissas, recursos e pendências do servidor. O
 *     rascunho da linha em edição atravessa desmontagem, serialização,
 *     navegação, remontagem e uma nova rodada de fetch. Nada disso é
 *     exercitado por um render isolado que nunca desmonta;
 *  4. rolagem horizontal de página é resultado do motor de layout. jsdom
 *     devolve 0 para toda medida de caixa.
 *
 * O que este script NÃO tenta ser: teste do caminho NÃO-ADMIN. O usuário de
 * desenvolvimento é ADMIN e criar usuário novo só para isto seria sujeira
 * permanente na base — esse caminho fica coberto pelo teste de unidade
 * `industrial-resource-create-page.test.tsx` ("quem não é ADMIN não fica no
 * formulário"), e o relatório diz isso em voz alta.
 *
 * Registros criados nascem com carimbo de tempo no nome e são INATIVADOS no
 * fim. Atenção: recurso industrial NÃO tem inativação pela listagem como
 * cliente e fornecedor — a listagem é só leitura, sem menu de linha. O
 * caminho oficial é o botão "Inativar recurso" do DETALHE, e é por ele que a
 * limpeza passa. Não existe exclusão: o que foi criado permanece na base
 * como inativo, e o relatório final lista código e id de cada um.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate54.mjs handoff/screens/validate54
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
 * Curto o bastante para caber no campo de busca da listagem e do combobox (é
 * por ele que a limpeza e a leitura do id selecionado acham o que criaram) e
 * único o bastante para que duas execuções no mesmo dia não se confundam.
 */
const TOKEN = `V54${Date.now().toString(36).toUpperCase()}`;

/**
 * Os dois recursos do FLOW 1 nascem com o MESMO nome, de propósito.
 *
 * Sem homônimo, "o campo mostra o recurso novo" não distingue seleção por id
 * de seleção por nome: qualquer implementação que casasse texto passaria.
 * Com dois recursos de nome idêntico na base, só quem guarda o id acerta.
 */
const NOME_RECURSO_F1 = `ZZ TEMP RECURSO ${TOKEN}`;
const NOME_RECURSO_DIRETO = `ZZ TEMP RECURSO DIRETO ${TOKEN}`;

const inicio = new Date().toISOString();

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
];

/** Marcação da tela nova, num lugar só — se mudar, muda aqui. */
const ROTA_CRIACAO = "/gestao/recursos-industriais/novo";
const ROTA_LISTA = "/gestao/recursos-industriais";
const FORM_RECURSO = "#industrial-resource-form";
const VOLTAR_CUSTOS = "← Voltar para Estrutura de custos";

const screenshots = [];
/** Recursos criados durante a validação, para a limpeza e o relatório. */
const criados = [];

let browser;
/** A limpeza pelo detalhe chegou ao fim? Decide a rede de segurança. */
let limpezaPelaTela = false;

try {
  await api("POST", "/auth/login", credentials);

  // ═══════════════════════════════════════════════════════════════════════
  // Descoberta do palco: um produto com estrutura de custos EDITÁVEL
  // ═══════════════════════════════════════════════════════════════════════
  /*
   * A tela `/produtos/:id/custos` só mostra os campos da linha quando a
   * versão exibida é RASCUNHO. Fixar um id no script o deixaria refém do
   * estado da base, então o produto é procurado pela API a cada execução.
   *
   * São procurados DOIS palcos diferentes, porque a tela se comporta de
   * forma diferente em cada um:
   *
   *  - `ideal`: produto com rascunho e SEM versão ativa. A tela abre já no
   *    rascunho, sem abas — é o palco dos FLOWs 1 e 2;
   *  - `comAtiva`: produto com rascunho E versão ativa. A tela abre na aba
   *    "Ativa" e só mostra os campos depois de trocar para "Rascunho". É o
   *    palco do cenário ABA, no fim.
   */
  const primeiraPagina = await api("GET", "/products?pageSize=1");
  const totalProdutos = primeiraPagina.total ?? 0;
  const produtos = [];
  for (let p = 1; p <= Math.ceil(totalProdutos / 100); p += 1) {
    const pagina = await api("GET", `/products?pageSize=100&page=${p}`);
    produtos.push(...(pagina.products ?? []));
  }

  let palcoIdeal = null;
  let palcoComAtiva = null;
  let examinados = 0;
  const fila = [...produtos];
  // Em paralelo e com parada antecipada: são centenas de produtos, e varrer
  // um a um custaria mais tempo que a validação inteira.
  async function varrer() {
    while (fila.length > 0 && !(palcoIdeal && palcoComAtiva)) {
      const produto = fila.shift();
      examinados += 1;
      try {
        const estrutura = await api("GET", `/products/${produto.id}/industrial-costs`);
        if (estrutura.draft?.status !== "DRAFT") continue;
        const palco = {
          id: produto.id,
          code: produto.code,
          name: produto.name,
          rascunho: estrutura.draft.label,
          ativa: estrutura.current?.label ?? null,
        };
        if (estrutura.current) palcoComAtiva ??= palco;
        else palcoIdeal ??= palco;
      } catch {
        /* produto sem estrutura acessível: não serve de palco */
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, varrer));

  check(
    "PALCO · há produto com estrutura de custos em rascunho editável",
    Boolean(palcoIdeal ?? palcoComAtiva),
    `${examinados} produto(s) examinados de ${produtos.length}`,
  );
  if (!palcoIdeal && !palcoComAtiva) {
    throw new Error(
      "Nenhum produto com estrutura de custos em RASCUNHO na base: sem palco não há o que provar.",
    );
  }
  // Sem produto "sem versão ativa" os FLOWs rodam no outro, trocando de aba.
  const palco = palcoIdeal ?? palcoComAtiva;
  const ROTA_CUSTOS = `/produtos/${palco.id}/custos`;
  anotar(
    `palco dos FLOWs: ${palco.code} "${palco.name}" — rascunho ${palco.rascunho}` +
      `${palco.ativa ? `, ativa ${palco.ativa}` : ", sem versão ativa"} (${ROTA_CUSTOS})`,
  );
  if (palcoComAtiva) {
    anotar(
      `palco do cenário ABA: ${palcoComAtiva.code} — rascunho ${palcoComAtiva.rascunho} ` +
        `e ativa ${palcoComAtiva.ativa}`,
    );
  }

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
   * Console e erros de página REPROVAM.
   *
   * Sair de uma tela pesada no meio de um formulário, remontá-la e
   * restaurar estado é exatamente o tipo de mudança que produz aviso de
   * atualização de estado fora de tempo, leitura de propriedade em objeto
   * que ainda não chegou e `key` duplicada — tudo isso aparece no console e
   * em nenhum outro lugar.
   */
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console.error: ${m.text().slice(0, 220)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 220)}`));

  /*
   * Captura da resposta da API para cada recurso criado PELA TELA.
   *
   * É daqui que sai "o id que a API devolveu". Comparar esse id com o que o
   * campo selecionou é a única forma de provar que a escolha foi por id e
   * não por nome — com homônimo na base, casar por nome acertaria o registro
   * errado sem que nada na tela denunciasse.
   */
  page.on("response", async (res) => {
    if (res.request().method() !== "POST" || !res.ok()) return;
    if (new URL(res.url()).pathname !== "/industrial-resources") return;
    try {
      const json = await res.json();
      if (json?.id) criados.push({ ...json, origem: "criado pela tela" });
    } catch {
      /* corpo não-JSON: não é o cadastro que interessa */
    }
  });

  /**
   * Captura a tela. Com `ancora`, rola até o elemento antes de capturar.
   *
   * A estrutura de custos é uma página longa: o topo mostra resumo e
   * pendências, e a linha de recurso fica bem abaixo da dobra. Sem rolar,
   * o PNG registraria um cabeçalho que não prova nada — a evidência é o
   * campo, não a página.
   */
  const shot = async (nome, ancora = null) => {
    if (ancora) {
      await page
        .locator(ancora)
        .first()
        .scrollIntoViewIfNeeded({ timeout: 5000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(300);
    const destino = path.join(OUT, `${nome}.png`);
    await page.screenshot({ path: destino });
    const absoluto = path.resolve(destino);
    screenshots.push(absoluto);
    return absoluto;
  };

  /*
   * Espera pela ÂNCORA da tela, não por tempo: a estrutura de custos puxa
   * versões, premissas e o catálogo inteiro de recursos, e `networkidle`
   * chega muito depois do momento em que o formulário já está pintado.
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
  async function esperarTelaDeCriacao() {
    const chegou = await esperarUrl((u) => new URL(u).pathname === ROTA_CRIACAO);
    await page.waitForSelector(FORM_RECURSO, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(900);
    return chegou;
  }

  /** O mesmo para a volta: a origem também remonta depois da URL mudar. */
  async function esperarRetornoPara(pathname, seletorAncora, timeout = 30000) {
    const chegou = await esperarUrl((u) => new URL(u).pathname === pathname, timeout);
    await page.waitForSelector(seletorAncora, { timeout: 25000 }).catch(() => {});
    // A limpeza do `?retomar=` é um `navigate(replace)` disparado logo depois
    // da restauração, e a estrutura de custos ainda refaz duas leituras no
    // servidor; dar tempo a isso evita medir o instante errado.
    await page.waitForTimeout(3000);
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

  /**
   * Id da entidade escolhida num campo, lido do DOM.
   *
   * O `<li>` de cada opção tem `id = "<listId>-<id da entidade>"` e a
   * escolhida carrega `aria-selected="true"`. É o único ponto em que o
   * estado interno do componente aflora no HTML — e é exatamente o que a
   * prova "selecionado pelo id" precisa comparar com a resposta da API.
   *
   * O `filtro` existe porque a lista renderiza no máximo 50 resultados: com
   * 135 recursos ativos na base, o escolhido pode simplesmente não estar no
   * DOM. Digitar o carimbo o traz para a lista antes da leitura, e o Escape
   * seguinte descarta a busca sem tocar na seleção.
   */
  async function idSelecionadoDe(locator, filtro = "") {
    await abrirListaDe(locator);
    let id = await lerSelecionado();
    if (!id && filtro) {
      await page.keyboard.type(filtro, { delay: 15 });
      await page.waitForTimeout(500);
      id = await lerSelecionado();
    }
    await fecharLista();
    return id;
  }

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
        temBotaoLimpar: Boolean(
          el.closest(".entity-select")?.querySelector(".entity-select__clear"),
        ),
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
  const retratoDaTelaDeCriacao = () =>
    page.evaluate((formId) => {
      const voltar = [...document.querySelectorAll(".page__header button")].find((b) =>
        (b.textContent ?? "").includes("← Voltar para"),
      );
      return {
        formularioPresente: Boolean(document.querySelector(formId)),
        titulo: (document.querySelector("h1.page__title")?.textContent ?? "").trim(),
        // A prova de que NÃO é modal: nenhuma camada de modal na página.
        // O `IndustrialResourceFormModal.tsx` foi apagado nesta rodada, e
        // esta contagem é o que garante que ninguém o ressuscitou por baixo.
        modais: document.querySelectorAll(".modal-fullscreen").length,
        textoDoVoltar: voltar ? (voltar.textContent ?? "").replace(/\s+/g, " ").trim() : null,
        // Cancelar e "← Voltar para" chamam a MESMA função `cancelar()` na
        // página; registrar os dois deixa isso explícito no relatório.
        temCancelar: [...document.querySelectorAll(".doc-actions button")].some(
          (b) => (b.textContent ?? "").trim() === "Cancelar",
        ),
      };
    }, FORM_RECURSO);

  /** Clica no "+ Novo recurso" da lista aberta. */
  const clicarNovo = async () => {
    await page.locator(".entity-select__create").first().click();
  };

  /** Quantos recursos com o carimbo existem na base, pela API. */
  const contarNaBase = async (termo) => {
    const r = await api("GET", `/industrial-resources?search=${encodeURIComponent(termo)}&pageSize=100`);
    return Array.isArray(r?.resources) ? r.resources.length : 0;
  };

  /**
   * Abre a estrutura de custos já na versão EDITÁVEL.
   *
   * A tela abre por padrão na versão ATIVA; quando o produto tem as duas,
   * os campos da linha só existem depois de trocar para "Rascunho". Esta
   * função é do teste, não do produto — ela existe para que o FLOW meça a
   * criação contextual e não a escolha de aba.
   */
  async function abrirCustosEditavel(rota) {
    await abrir(rota, ".doc-title");
    await page.waitForTimeout(900);
    if ((await page.locator("#usage-resource").count()) === 0) {
      const aba = page.locator('.toolbar__scope button:has-text("Rascunho")');
      if (await aba.count()) {
        await aba.first().click();
        await page.waitForTimeout(1200);
      }
    }
    await page.waitForSelector("#usage-resource", { timeout: 20000 });
    await page.waitForTimeout(400);
  }

  /** Preenche a linha de recurso em edição e devolve o que foi digitado. */
  async function preencherLinha(sufixo) {
    const rascunho = {
      categoria: "OVERHEAD",
      descricao: `ZZ RASCUNHO ${sufixo} ${TOKEN}`,
      base: "PER_OUTPUT_UNIT",
      valor: "12,34",
      consumo: "7,5",
    };
    // Categoria e base saem dos valores PADRÃO de propósito: restaurar um
    // campo para o valor que ele já teria por omissão não prova nada.
    await page.selectOption("#cost-category", rascunho.categoria);
    await page.fill("#cost-description", rascunho.descricao);
    await page.selectOption("#cost-basis", rascunho.base);
    await page.fill("#cost-rate", rascunho.valor);
    await page.fill("#usage-quantity", rascunho.consumo);
    await page.waitForTimeout(300);
    return rascunho;
  }

  /** Lê de volta o que `preencherLinha` escreveu. */
  const lerLinha = () =>
    page.evaluate(() => ({
      categoria: document.querySelector("#cost-category")?.value ?? null,
      descricao: document.querySelector("#cost-description")?.value ?? null,
      base: document.querySelector("#cost-basis")?.value ?? null,
      valor: document.querySelector("#cost-rate")?.value ?? null,
      consumo: document.querySelector("#usage-quantity")?.value ?? null,
    }));

  const mesmaLinha = (lido, esperado) =>
    lido.categoria === esperado.categoria &&
    lido.descricao === esperado.descricao &&
    lido.base === esperado.base &&
    lido.valor === esperado.valor &&
    lido.consumo === esperado.consumo;

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 1 — contextual, com REFRESH. O requisito principal.
  // ═══════════════════════════════════════════════════════════════════════
  // O caso que justifica a mudança inteira: alguém está montando a estrutura
  // de custos, descobre no meio da linha que o recurso não existe, sai para
  // cadastrá-lo — e no caminho a página é recarregada. Com modal, tudo se
  // perdia; com URL e contexto em `sessionStorage`, nada se perde. O F5 é o
  // teste, não um detalhe do teste.

  /*
   * O homônimo é semeado ANTES de a tela abrir, para já estar no catálogo
   * que a estrutura de custos carrega no `useEffect` de montagem.
   */
  const homonimo = await api("POST", "/industrial-resources", {
    name: NOME_RECURSO_F1,
    type: "LABOR",
  });
  criados.push({ ...homonimo, origem: "homônimo semeado pela API" });
  console.log(`homônimo semeado: ${homonimo.code} ${homonimo.id}`);

  await abrirCustosEditavel(ROTA_CUSTOS);
  check(
    "F1 · a estrutura de custos abre com a linha de recurso editável",
    (await page.locator("#usage-resource").count()) === 1 &&
      urlAtual().pathname === ROTA_CUSTOS,
    JSON.stringify(urlAtual()),
  );
  const rascunhoF1 = await preencherLinha("F1");
  await shot("54-f1-01-linha-de-recurso-preenchida", "#usage-resource");

  await abrirListaDe(page.locator("#usage-resource"));
  // O rótulo real do item é medido, não afirmado: o enunciado da entrega
  // fala em "+ Novo recurso industrial" e o código passa `createLabel="Novo
  // recurso"`. A divergência é de texto, não de mecanismo — vira observação.
  const rotuloCriar = await page.evaluate(
    () => document.querySelector(".entity-select__create")?.textContent?.trim() ?? null,
  );
  check(
    "F1 · o campo Recurso oferece o caminho de cadastro na própria lista",
    Boolean(rotuloCriar) && /novo recurso/i.test(rotuloCriar),
    `rótulo="${rotuloCriar}"`,
  );
  anotar(`F1 · o item de cadastro do campo Recurso se chama "${rotuloCriar}"`);
  await clicarNovo();

  const chegouNaCriacao = await esperarTelaDeCriacao();
  const urlF1 = urlAtual();
  check(
    "F1 · (i) o + Novo recurso NAVEGA para /gestao/recursos-industriais/novo",
    chegouNaCriacao && urlF1.pathname === ROTA_CRIACAO,
    JSON.stringify(urlF1),
  );
  check(
    "F1 · (i) a URL leva o token de origem (?origem=…)",
    Boolean(urlF1.origem) && urlF1.origem.length > 0,
    JSON.stringify(urlF1),
  );
  const telaF1 = await retratoDaTelaDeCriacao();
  check(
    "F1 · (i) é PÁGINA, não modal — zero .modal-fullscreen na tela",
    telaF1.modais === 0 && telaF1.formularioPresente === true,
    JSON.stringify(telaF1),
  );
  check(
    "F1 · a página contextual oferece a volta rotulada para a origem",
    telaF1.textoDoVoltar === VOLTAR_CUSTOS,
    JSON.stringify(telaF1),
  );
  await shot("54-f1-02-url-virou-cadastro-de-recurso");

  // ── O F5 ────────────────────────────────────────────────────────────────
  // Aqui a árvore React inteira é jogada fora e remontada do zero. O que
  // sobreviver daqui para a frente sobreviveu porque está em
  // `sessionStorage` e endereçado pela URL, não porque um componente
  // continuou montado.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(FORM_RECURSO, { timeout: 30000 });
  await page.waitForTimeout(1200);

  const urlDepoisDoF5 = urlAtual();
  const telaDepoisDoF5 = await retratoDaTelaDeCriacao();
  check(
    "F1 · (ii) depois do F5 a URL continua a mesma, com o mesmo token",
    urlDepoisDoF5.pathname === ROTA_CRIACAO && urlDepoisDoF5.origem === urlF1.origem,
    JSON.stringify({ antes: urlF1, depois: urlDepoisDoF5 }),
  );
  check(
    "F1 · (ii) depois do F5 a página ainda sabe para onde voltar",
    telaDepoisDoF5.textoDoVoltar === VOLTAR_CUSTOS,
    JSON.stringify(telaDepoisDoF5),
  );
  check(
    "F1 · (ii) depois do F5 continua sendo página, sem modal",
    telaDepoisDoF5.modais === 0 && telaDepoisDoF5.formularioPresente === true,
    JSON.stringify(telaDepoisDoF5),
  );
  await shot("54-f1-03-depois-do-f5");

  // ── Preenche e salva o recurso ─────────────────────────────────────────
  await page.fill("#resource-name", NOME_RECURSO_F1);
  await page.fill("#resource-description", `criado por validate54 ${TOKEN}`);
  const criadosAntesF1 = criados.length;
  await page.locator(`button[form="${FORM_RECURSO.slice(1)}"]`).first().click();

  const voltouAosCustos = await esperarRetornoPara(ROTA_CUSTOS, "#usage-resource");
  const urlDeVolta = urlAtual();
  check(
    "F1 · (iv) salvar o recurso devolve para /produtos/<id>/custos",
    voltouAosCustos && urlDeVolta.pathname === ROTA_CUSTOS,
    JSON.stringify(urlDeVolta),
  );
  check(
    "F1 · (iv) o token de retomada sai da URL depois de consumido",
    // Deixá-lo ali faria um F5 seguinte tentar retomar um contexto já
    // consumido, e um link compartilhado carregaria um token morto.
    urlDeVolta.retomar === null,
    JSON.stringify(urlDeVolta),
  );
  check(
    "F1 · (iii) o POST /industrial-resources respondeu",
    criados.length > criadosAntesF1,
    `${criados.length - criadosAntesF1} resposta(s) capturada(s)`,
  );
  const recursoF1 = criados.length > criadosAntesF1 ? criados[criados.length - 1] : null;

  const linhaDepoisF1 = await lerLinha();
  check(
    "F1 · (v) o rascunho da linha atravessou saída, F5, salvamento e volta",
    mesmaLinha(linhaDepoisF1, rascunhoF1),
    JSON.stringify({ lido: linhaDepoisF1, esperado: rascunhoF1 }),
  );

  const campoRecursoF1 = await retratoDoCampo("#usage-resource");
  check(
    "F1 · (vi) o campo Recurso mostra o recém-criado",
    (campoRecursoF1.valor ?? "").includes(recursoF1?.code ?? " ") ||
      (campoRecursoF1.placeholder ?? "").includes(recursoF1?.code ?? " "),
    JSON.stringify({ campo: campoRecursoF1, code: recursoF1?.code ?? null }),
  );
  await shot("54-f1-04-custos-restaurado-com-recurso-novo", "#usage-resource");

  const idNoCampoF1 = await idSelecionadoDe(page.locator("#usage-resource"), TOKEN);
  check(
    "F1 · (vi) o id selecionado é o que a API devolveu, não o do homônimo",
    Boolean(recursoF1) && idNoCampoF1 === recursoF1.id && idNoCampoF1 !== homonimo.id,
    JSON.stringify({
      noCampo: idNoCampoF1,
      daApi: recursoF1?.id ?? null,
      homonimo: homonimo.id,
    }),
  );
  anotar(
    `F1 · havia um homônimo "${NOME_RECURSO_F1}" na base (${homonimo.code}, id ${homonimo.id}); ` +
      `o campo escolheu ${idNoCampoF1}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // FLOW 2 — cancelar
  // ═══════════════════════════════════════════════════════════════════════
  // O outro desfecho. O rascunho tem que voltar igual, o campo tem que ficar
  // VAZIO — texto parado no campo sem seleção confirmada lê como escolha
  // feita — e nada pode ter sido gravado.
  //
  // Basta exercitar UM dos dois botões: em `IndustrialResourceCreatePage` o
  // "Cancelar" do rodapé e o "← Voltar para …" do cabeçalho apontam para a
  // mesma função `cancelar()`. O rodapé é o caminho mais usado.
  await abrirCustosEditavel(ROTA_CUSTOS);
  const rascunhoF2 = await preencherLinha("F2");

  const recursosAntesF2 = await contarNaBase(TOKEN);

  await abrirListaDe(page.locator("#usage-resource"));
  // Digita antes de sair: é o texto que ficaria no campo se a desistência
  // não limpasse nada — o pior caso para esta prova.
  await page.keyboard.type("ZZ RECURSO QUE NAO EXISTE", { delay: 20 });
  await page.waitForTimeout(400);
  await clicarNovo();
  await esperarTelaDeCriacao();
  const urlF2 = urlAtual();
  const telaF2 = await retratoDaTelaDeCriacao();
  check(
    "F2 · sair para criar também aqui é navegação com token na URL, sem modal",
    urlF2.pathname === ROTA_CRIACAO && Boolean(urlF2.origem) && telaF2.modais === 0,
    JSON.stringify({ url: urlF2, tela: telaF2 }),
  );
  check(
    "F2 · a tela oferece os dois caminhos de desistência (Cancelar e ← Voltar para)",
    telaF2.temCancelar === true && telaF2.textoDoVoltar === VOLTAR_CUSTOS,
    JSON.stringify(telaF2),
  );
  await shot("54-f2-01-cadastro-de-recurso-antes-de-cancelar");

  await page.locator('.doc-actions button:has-text("Cancelar")').first().click();
  const voltouCancelando = await esperarRetornoPara(ROTA_CUSTOS, "#usage-resource");
  const urlF2Volta = urlAtual();
  check(
    "F2 · Cancelar devolve para /produtos/<id>/custos",
    voltouCancelando && urlF2Volta.pathname === ROTA_CUSTOS,
    JSON.stringify(urlF2Volta),
  );
  const linhaDepoisF2 = await lerLinha();
  check(
    "F2 · o rascunho da linha sobreviveu à desistência",
    mesmaLinha(linhaDepoisF2, rascunhoF2),
    JSON.stringify({ lido: linhaDepoisF2, esperado: rascunhoF2 }),
  );
  const campoRecursoF2 = await retratoDoCampo("#usage-resource");
  check(
    "F2 · o campo Recurso ficou vazio — nada selecionado, nem o texto digitado",
    campoRecursoF2.valor === "" && campoRecursoF2.temBotaoLimpar === false,
    JSON.stringify(campoRecursoF2),
  );
  const recursosDepoisF2 = await contarNaBase(TOKEN);
  check(
    "F2 · cancelar não criou nenhum recurso",
    recursosDepoisF2 === recursosAntesF2,
    `antes=${recursosAntesF2} depois=${recursosDepoisF2} (busca por "${TOKEN}")`,
  );
  await shot("54-f2-02-custos-restaurado-sem-recurso", "#usage-resource");

  // ═══════════════════════════════════════════════════════════════════════
  // ACESSO DIRETO — a mesma tela sem contexto nenhum
  // ═══════════════════════════════════════════════════════════════════════
  // A URL própria só vale se a tela for uma tela de verdade: aberta pela
  // listagem, sem token, ela não pode oferecer uma volta que não existe nem
  // inventar hierarquia a partir de por onde a pessoa passou. E o destino do
  // salvamento muda: recurso sem tarifa não serve a estrutura de custo
  // nenhuma, e a tarifa entra no DETALHE — parar na listagem deixaria a
  // pessoa a um passo do fim sem dizer qual é o passo.
  await abrir(ROTA_LISTA);
  await page.locator(".page__header a.btn--primary").first().click();
  await esperarTelaDeCriacao();

  const urlDireto = urlAtual();
  const telaDireta = await retratoDaTelaDeCriacao();
  check(
    "DIRETO · o botão da listagem leva a /gestao/recursos-industriais/novo, sem ?origem=",
    urlDireto.pathname === ROTA_CRIACAO && urlDireto.origem === null,
    JSON.stringify(urlDireto),
  );
  check(
    "DIRETO · a página funciona: formulário montado, título próprio e nenhum modal",
    telaDireta.formularioPresente === true &&
      telaDireta.titulo === "Novo recurso industrial" &&
      telaDireta.modais === 0,
    JSON.stringify(telaDireta),
  );
  check(
    "DIRETO · a trilha é Gestão › Recursos industriais › Novo recurso",
    (await trilha()) === "Gestão › Recursos industriais › Novo recurso",
    `trilha="${await trilha()}"`,
  );
  check(
    "DIRETO · NÃO aparece '← Voltar para …' — não há origem para onde voltar",
    telaDireta.textoDoVoltar === null,
    JSON.stringify(telaDireta),
  );
  await shot("54-direto-01-cadastro-sem-contexto");

  await page.fill("#resource-name", NOME_RECURSO_DIRETO);
  const criadosAntesDireto = criados.length;
  await page.locator(`button[form="${FORM_RECURSO.slice(1)}"]`).first().click();
  const foiParaAlgumLugar = await esperarUrl(
    (u) => new URL(u).pathname !== ROTA_CRIACAO,
    30000,
  );
  await page.waitForSelector(".doc-title", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2000);

  check(
    "DIRETO · o POST /industrial-resources respondeu",
    criados.length > criadosAntesDireto,
    `${criados.length - criadosAntesDireto} resposta(s)`,
  );
  const recursoDireto = criados.length > criadosAntesDireto ? criados[criados.length - 1] : null;
  const urlDepoisDeSalvar = urlAtual();
  check(
    "DIRETO · salvar leva ao DETALHE do recurso criado, não à listagem",
    foiParaAlgumLugar &&
      Boolean(recursoDireto) &&
      urlDepoisDeSalvar.pathname === `${ROTA_LISTA}/${recursoDireto.id}`,
    JSON.stringify({ url: urlDepoisDeSalvar, esperado: `${ROTA_LISTA}/${recursoDireto?.id}` }),
  );
  // É no detalhe que a tarifa entra — se o destino não oferecesse esse
  // caminho, chegar lá não valeria de nada.
  const detalheOfereceTarifa = await page.evaluate(() =>
    [...document.querySelectorAll("button, h3, h2")].some((el) =>
      /tarifa/i.test(el.textContent ?? ""),
    ),
  );
  check(
    "DIRETO · o detalhe em que se chega é onde a tarifa entra",
    detalheOfereceTarifa,
    `título="${await page.evaluate(() => document.querySelector(".doc-title h1")?.textContent?.trim() ?? "")}"`,
  );
  await shot("54-direto-02-detalhe-do-recurso-criado");

  // ═══════════════════════════════════════════════════════════════════════
  // ABA — voltar para um produto que tem rascunho E versão ativa
  // ═══════════════════════════════════════════════════════════════════════
  // A tela de custos abre por padrão na versão ATIVA e a escolha da aba é
  // estado do componente, não da URL nem do rascunho contextual. Quem sai
  // para cadastrar a partir do RASCUNHO volta, portanto, para a aba ATIVA —
  // onde os campos da linha nem existem. Este cenário mede exatamente isso.
  // Ele desiste (Cancelar) de propósito: expõe o retorno sem criar registro.
  if (palcoComAtiva) {
    const ROTA_ABA = `/produtos/${palcoComAtiva.id}/custos`;
    await abrirCustosEditavel(ROTA_ABA);
    const rascunhoAba = await preencherLinha("ABA");
    await abrirListaDe(page.locator("#usage-resource"));
    await clicarNovo();
    await esperarTelaDeCriacao();
    await page.locator('.doc-actions button:has-text("Cancelar")').first().click();
    await esperarRetornoPara(ROTA_ABA, ".doc-title");

    const estadoAba = await page.evaluate(() => ({
      abas: [...document.querySelectorAll(".toolbar__scope button")].map((b) => ({
        rotulo: (b.textContent ?? "").trim(),
        // `btn--secondary` é como a aba selecionada se apresenta; a outra
        // fica `btn--ghost`.
        selecionada: b.className.includes("btn--secondary"),
      })),
      camposDaLinhaVisiveis: Boolean(document.querySelector("#usage-resource")),
    }));
    check(
      "ABA · voltando da criação, a tela reabre na aba em que se estava (Rascunho)",
      estadoAba.camposDaLinhaVisiveis === true,
      JSON.stringify(estadoAba),
    );
    await shot("54-aba-01-volta-com-rascunho-e-versao-ativa", ".toolbar__scope");

    // Mesmo quando a aba errada esconde tudo, o estado foi restaurado por
    // baixo. Medir isso separa "o rascunho se perdeu" de "o rascunho está
    // lá, mas fora da vista" — que são defeitos de gravidade bem diferente.
    if (!estadoAba.camposDaLinhaVisiveis) {
      const aba = page.locator('.toolbar__scope button:has-text("Rascunho")');
      if (await aba.count()) {
        await aba.first().click();
        await page.waitForTimeout(1200);
      }
      const linhaAba = await lerLinha();
      anotar(
        `ABA · trocando manualmente para a aba Rascunho, o rascunho aparece intacto: ` +
          `${mesmaLinha(linhaAba, rascunhoAba) ? "sim" : `não — ${JSON.stringify(linhaAba)}`}`,
      );
      await shot("54-aba-02-rascunho-intacto-apos-trocar-de-aba-na-mao", "#usage-resource");
    }
  } else {
    anotar(
      "ABA · não há produto com rascunho E versão ativa na base; o cenário de aba não foi exercitado",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRÊS VIEWPORTS — a tela de criação sem rolagem lateral
  // ═══════════════════════════════════════════════════════════════════════
  // A rolagem horizontal da PÁGINA leva junto o cabeçalho, o menu e o rodapé
  // de ações — o botão de salvar sai do lugar. Numa tela de formulário não
  // há tabela larga que justifique: se sobra largura, é defeito de layout.
  //
  // Cada largura é medida duas vezes: com o tipo padrão e com EQUIPAMENTO,
  // que é o único tipo que acrescenta um campo (Potência) à grade. Medir só
  // o estado inicial deixaria a variante mais larga sem prova.
  const medirSobra = () =>
    page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        sobra: doc.scrollWidth - doc.clientWidth,
      };
    });

  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await abrir(ROTA_CRIACAO);
    await page.waitForSelector(FORM_RECURSO, { timeout: 20000 });
    await page.waitForTimeout(600);

    const medidaPadrao = await medirSobra();
    check(
      `VP · ${vp.width}×${vp.height} · a página de criação não rola na horizontal`,
      medidaPadrao.scrollWidth <= medidaPadrao.clientWidth,
      `scrollWidth=${medidaPadrao.scrollWidth} clientWidth=${medidaPadrao.clientWidth} sobra=${medidaPadrao.sobra}px`,
    );
    await shot(`54-vp-${vp.width}-criacao-padrao`);

    await page.selectOption("#resource-type", "EQUIPMENT");
    await page.waitForSelector("#resource-power", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    const medidaEquipamento = await medirSobra();
    check(
      `VP · ${vp.width}×${vp.height} · com o campo Potência (equipamento) também não rola`,
      medidaEquipamento.scrollWidth <= medidaEquipamento.clientWidth &&
        (await page.locator("#resource-power").count()) === 1,
      `scrollWidth=${medidaEquipamento.scrollWidth} clientWidth=${medidaEquipamento.clientWidth} sobra=${medidaEquipamento.sobra}px`,
    );
    await shot(`54-vp-${vp.width}-criacao-equipamento`);
  }
  await page.setViewportSize(VIEWPORTS[1]);

  // ═══════════════════════════════════════════════════════════════════════
  // Limpeza — pelo DETALHE, que é o único caminho oficial que existe
  // ═══════════════════════════════════════════════════════════════════════
  // Cliente, fornecedor, item e produto se inativam pelo menu "⋯" da
  // listagem. Recurso industrial NÃO: a listagem é só leitura (linha clicável
  // e nada mais). O botão "Inativar recurso" mora no detalhe, com
  // confirmação — e é por ele que a limpeza passa, o que de graça ainda
  // confere que o botão e o diálogo funcionam.
  //
  // Não existe exclusão de recurso em lugar nenhum do produto: o que foi
  // criado FICA na base, inativo. O relatório lista o que ficou.
  let inativados = 0;
  for (const recurso of criados) {
    await abrir(`${ROTA_LISTA}/${recurso.id}`, ".doc-title");
    const botao = page.locator('.doc-header button:has-text("Inativar recurso")');
    if ((await botao.count()) === 0) {
      anotar(`limpeza · ${recurso.code} já estava inativo ou sem botão de inativar`);
      continue;
    }
    await botao.first().click();
    await page.waitForSelector(".confirm-dialog", { timeout: 8000 });
    await page.locator(".confirm-dialog button.btn--danger").first().click();
    await page.waitForTimeout(1800);
    const inativo = await page.evaluate(
      () => document.querySelectorAll(".doc-title .badge--inactive").length > 0,
    );
    if (inativo) inativados += 1;
    recurso.inativadoPelaTela = inativo;
  }
  check(
    "limpeza · todos os recursos criados foram inativados pelo detalhe",
    inativados === criados.length,
    `${inativados} de ${criados.length}`,
  );
  await shot("54-limpeza-detalhe-do-ultimo-recurso-inativado", ".doc-title");
  limpezaPelaTela = inativados === criados.length;

  // ═══════════════════════════════════════════════════════════════════════
  // Console — zero erro na execução inteira
  // ═══════════════════════════════════════════════════════════════════════
  // Medido no fim de propósito: a promessa é sobre a execução toda, e
  // navegação que remonta uma tela pesada no meio de um formulário é
  // exatamente o tipo de mudança que só se manifesta no console.
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
   * recursos de teste ATIVOS na base — aparecendo na lista de escolha da
   * estrutura de custos de quem usar o ambiente depois. Aqui eles são
   * inativados pela API (`PATCH /industrial-resources/:id`, que é o mesmo
   * que o botão do detalhe chama) e o relatório diz que foi por este
   * caminho, não pelo da tela.
   */
  if (!limpezaPelaTela) {
    for (const recurso of criados) {
      if (recurso.inativadoPelaTela) continue;
      try {
        await api("PATCH", `/industrial-resources/${recurso.id}`, { active: false });
        recurso.inativadoPelaApi = true;
        console.log(`rede de segurança: ${recurso.code} inativado pela API`);
      } catch (e) {
        console.log(
          `rede de segurança FALHOU para ${recurso.code}: ${String(e).slice(0, 160)}`,
        );
      }
    }
  }
}

// ── Relatório ─────────────────────────────────────────────────────────────
console.log("\n── Recursos industriais criados nesta execução ──");
for (const r of criados) {
  const destino = r.inativadoPelaTela
    ? "inativado pelo detalhe"
    : r.inativadoPelaApi
      ? "inativado pela API (rede de segurança)"
      : "ATIVO — não foi possível inativar";
  console.log(` ${r.code} ${r.id} "${r.name}" (${r.origem}) — ${destino}`);
}
console.log(
  " recurso industrial não tem exclusão: os registros acima PERMANECEM na base, inativos.",
);
console.log(` carimbo: ${TOKEN} · início: ${inicio}`);

console.log("\n── Observações (medidas, não vereditos) ──");
for (const o of observacoes) console.log(" ·", o);
console.log(
  " · caminho NÃO-ADMIN: o usuário de desenvolvimento é ADMIN, então o desvio de quem não pode",
);
console.log(
  "   criar recurso NÃO foi exercitado por navegador. Ele fica coberto só pelo teste de unidade",
);
console.log(
  "   apps/web/src/pages/industrial-resources/industrial-resource-create-page.test.tsx",
);

console.log("\nscreenshots:");
for (const s of screenshots) console.log(" -", s);

if (failures.length > 0) {
  console.log(`\n${failures.length} verificação(ões) falharam:`);
  for (const f of failures) console.log(" -", f);
  process.exitCode = 1;
} else {
  console.log("\nvalidate54: todas as verificações passaram.");
}
