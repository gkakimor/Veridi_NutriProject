import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação da capacidade 51 — camada de ajuda contextual do ERP.
 *
 * O que nenhum teste unitário alcança e por isso é provado aqui, no
 * navegador de verdade:
 *
 *  1. a ajuda EXISTE e é ALCANÇÁVEL em telas de módulos diferentes — não
 *     escondida atrás de rolagem lateral, aba ou acordeão;
 *  2. ela continua visível na tela SEM DADO, que é o defeito original: a
 *     listagem vazia era exatamente onde a ajuda sumia, e é quem não tem
 *     dado que mais precisa dela;
 *  3. o modal abre com o vocabulário ANTES do caminho;
 *  4. o número da caixa do fluxo casa com o número do passo a passo, e o
 *     clique liga um ao outro de verdade;
 *  5. a bolha do ⓘ de cabeçalho de coluna NÃO é recortada por
 *     `.table-container { overflow-x: auto }` — o motivo de ela ser
 *     `position: fixed` com coordenadas medidas em JS;
 *  6. nada disso quebra nas três larguras de desktop suportadas;
 *  7. o campo novo do Produto está lá e os três controles padrão da casa
 *     continuam SEM interruptor na tela de produto.
 *
 * Só LÊ o corpus local: nenhum registro é criado, logo não há cenário
 * sintético para remover no final.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate51.mjs handoff/screens
 */

const OUT = process.argv[2] ?? ".";
const API = "http://127.0.0.1:3333";
const WEB = "http://127.0.0.1:5173";

const credentials = (() => {
  for (const rel of ["../.local-data/dev-admin.json", "../../.local-data/dev-admin.json"]) {
    const file = new URL(rel, import.meta.url);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  throw new Error("Credencial de desenvolvimento não encontrada");
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
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text}`);
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return text ? JSON.parse(text) : null;
}

/** Igual a `api`, mas devolve `null` em vez de estourar — para sondar alvos. */
async function apiTenta(url) {
  try {
    return await api("GET", url);
  } catch {
    return null;
  }
}

const failures = [];
function check(label, condition, detail = "") {
  if (condition) console.log("ok", label);
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log("FALHOU", label, detail);
  }
}

/**
 * Um módulo por linha, de propósito: a ajuda foi escrita por módulo, e uma
 * amostra concentrada em Estoque provaria só que aquele arquivo de conteúdo
 * está ligado — não que a camada chegou ao ERP inteiro.
 */
const TELAS = [
  { modulo: "cadastros", rota: "/cadastros/itens" },
  { modulo: "comercial", rota: "/comercial/pedidos" },
  { modulo: "producao", rota: "/producao/ordens" },
  { modulo: "compras", rota: "/compras/ordens" },
  { modulo: "estoque", rota: "/estoque/lotes" },
  { modulo: "qualidade", rota: "/qualidade/documentos" },
  { modulo: "administracao", rota: "/administracao/usuarios" },
];

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
];

let browser;

try {
  await api("POST", "/auth/login", credentials);

  // ── Alvos reais do corpus local ──────────────────────────────────────
  // Nada é criado: a ajuda é conteúdo estático de tela, e inventar registro
  // só para lê-la acrescentaria risco de sujeira sem acrescentar prova.
  const prisma = new PrismaClient();
  const candidatasFormulacao = await prisma.formulationVersion.findMany({
    where: { status: "ACTIVE", components: { some: {} } },
    select: { id: true, productId: true },
    // `id` como desempate: `createdAt` empata em massa importada, e sem
    // ordem estável o alvo mudaria de execução para execução.
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 15,
  });
  // Um recebimento de UMA linha: a tabela baixa é a condição que reproduzia
  // o corte da bolha. Com muitas linhas o container fica alto e a bolha cabe
  // dentro dele por acidente — o defeito passaria despercebido.
  const candidatosRecebimento = await prisma.receipt.findMany({
    where: { lines: { some: {} } },
    select: { id: true, code: true, _count: { select: { lines: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 30,
  });
  await prisma.$disconnect();

  // A tela só desenha o que a API entrega: confirmar aqui evita gastar o
  // diagnóstico num "elemento não encontrado" que era registro inválido.
  let versaoFormulacao = null;
  for (const c of candidatasFormulacao) {
    if (await apiTenta(`/formulation-versions/${c.id}`)) {
      versaoFormulacao = c;
      break;
    }
  }
  let recebimento = null;
  for (const c of candidatosRecebimento.filter((r) => r._count.lines <= 2)) {
    if (await apiTenta(`/receipts/${c.id}`)) {
      recebimento = c;
      break;
    }
  }

  if (!versaoFormulacao) throw new Error("Nenhuma versão de formulação ativa legível no ambiente local");
  if (!recebimento) throw new Error("Nenhum recebimento de poucas linhas no ambiente local");

  const ROTA_FORMULACAO = `/producao/formulacoes/${versaoFormulacao.productId}/versoes/${versaoFormulacao.id}`;
  const ROTA_RECEBIMENTO = `/compras/recebimentos/${recebimento.id}`;
  console.log("alvos:", ROTA_FORMULACAO, "|", ROTA_RECEBIMENTO, recebimento.code);

  // ── Navegador ────────────────────────────────────────────────────────
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORTS[1] });
  const page = await context.newPage();

  // Console sujo é regressão silenciosa: erro de React em modal aberto não
  // aparece na tela, só no console de quem estiver olhando.
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    return path.resolve(OUT, `${name}.png`);
  };
  const screenshots = [];
  const evidencia = async (name) => screenshots.push(await shot(name));

  /**
   * A espera é pela ÂNCORA da tela, não por tempo: a listagem grande de
   * itens que algumas telas carregam junto atrasa `networkidle` muito além
   * do momento em que o cabeçalho — e a ajuda com ele — já está pintado.
   */
  const abrir = async (rota, ancora = ".page__title") => {
    await page.goto(`${WEB}${rota}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(ancora, { timeout: 30000 });
    // Folga para a tabela terminar de assentar antes de qualquer medição.
    await page.waitForTimeout(900);
  };

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.fill("#login-email", credentials.email);
  await page.fill("#login-password", credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1800);

  const GATILHO = "button.context-help__trigger";

  /**
   * Alcance da ajuda numa tela, medido como quem chega nela: sem clicar em
   * nada antes. "Existe no DOM" não bastaria — o defeito de descoberta é
   * justamente o botão que existe mas exige rolar de lado ou abrir uma aba
   * para ser visto.
   */
  async function medirAlcance() {
    return page.evaluate((sel) => {
      const botao = document.querySelector(sel);
      if (!botao) return { existe: false };
      const r = botao.getBoundingClientRect();
      const style = getComputedStyle(botao);
      // Um `<details>` fechado ou um painel de aba escondido acima do botão
      // significaria "a ajuda está atrás de um clique que ninguém adivinha".
      let dentroDeDobravel = false;
      for (let n = botao.parentElement; n; n = n.parentElement) {
        if (n.tagName === "DETAILS" && !n.open) dentroDeDobravel = true;
        if (n.hasAttribute("hidden")) dentroDeDobravel = true;
        if (n.getAttribute("role") === "tabpanel" && n.getAttribute("aria-hidden") === "true") {
          dentroDeDobravel = true;
        }
      }
      return {
        existe: true,
        expandido: botao.getAttribute("aria-expanded"),
        texto: (botao.textContent ?? "").trim(),
        pintado: style.visibility === "visible" && style.display !== "none" && r.width > 0,
        // Sem rolagem lateral: a caixa inteira do botão cabe na largura útil.
        dentroNaHorizontal: r.left >= 0 && r.right <= window.innerWidth,
        // Sem rolagem vertical também: a ajuda é a primeira coisa que quem
        // não conhece a tela procura, e procura na primeira dobra.
        dentroNaVertical: r.top >= 0 && r.bottom <= window.innerHeight,
        dentroDeDobravel,
        pagRolaLado:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    }, GATILHO);
  }

  /**
   * Abre um ⓘ de CABEÇALHO DE COLUNA e mede a bolha.
   *
   * A prova de que ela não é recortada não pode ser só geométrica: o
   * retângulo de um elemento `fixed` ignora o recorte do ancestral e
   * pareceria correto mesmo cortado. Por isso o teste de ACERTO — pedir ao
   * navegador quem está pintado num ponto da bolha que cai FORA do
   * `.table-container`. Se o recorte voltasse, ali estaria a página, não a
   * bolha.
   */
  async function medirBolha(gatilho) {
    const rotulo = await gatilho.getAttribute("aria-label");
    await gatilho.click();
    await page.waitForSelector(".info-hint__bubble", { timeout: 5000 });
    // A bolha nasce invisível e só ganha `top`/`left` depois de medida.
    await page.waitForTimeout(250);

    const medida = await page.evaluate(() => {
      const bolha = document.querySelector(".info-hint__bubble");
      const container = bolha?.closest(".table-container");
      if (!bolha || !container) return { faltou: true };
      const b = bolha.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      const style = getComputedStyle(bolha);

      // Ponto de teste: dentro da bolha e além da borda inferior do
      // container — o lado que o `overflow-x: auto` recorta junto.
      const x = Math.round(b.left + b.width / 2);
      const yFora = Math.round(Math.max(b.top + 4, c.bottom + 4));
      const podeTestar = b.bottom > c.bottom && yFora < b.bottom - 2;
      const emCima = podeTestar ? document.elementFromPoint(x, yFora) : null;

      return {
        rect: { top: b.top, left: b.left, right: b.right, bottom: b.bottom },
        container: { top: c.top, bottom: c.bottom, left: c.left, right: c.right },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        posicao: style.position,
        visivel: style.visibility === "visible",
        temCoordenada: bolha.style.top !== "" && bolha.style.left !== "",
        dentroDoViewport:
          b.top >= 0 &&
          b.left >= 0 &&
          b.right <= window.innerWidth &&
          b.bottom <= window.innerHeight,
        // O caso interessante: a bolha ULTRAPASSA o container. É a situação
        // em que o `overflow` do container a apagava.
        ultrapassaContainer: b.bottom > c.bottom || b.right > c.right || b.top < c.top,
        podeTestar,
        pintadaForaDoContainer: podeTestar && (emCima === bolha || bolha.contains(emCima)),
      };
    });
    return { rotulo, ...medida };
  }

  const fecharBolha = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  };

  /**
   * Percorre TODOS os ⓘ de cabeçalho da primeira tabela da tela.
   *
   * Nem todo ⓘ transborda o container — bolha curta em coluna do meio cabe
   * dentro por acaso. Por isso a prova é feita sobre os que transbordam, e
   * exige-se que exista pelo menos um: sem transbordo a verificação de
   * recorte não teria o que provar.
   */
  async function provarBolhas(largura) {
    const tabela = page.locator(".table-container").first();
    const gatilhos = tabela.locator("thead .info-hint__trigger");
    const total = await gatilhos.count();
    check(`${largura} · tabela tem ⓘ de cabeçalho de coluna`, total > 0, `${total} ícone(s)`);
    if (total === 0) return;

    const linhas = await tabela.locator("tbody tr").count();
    check(`${largura} · tabela usada tem poucas linhas`, linhas <= 3, `${linhas} linha(s)`);

    let transbordaram = 0;
    let pintadasFora = 0;
    const foraDoViewport = [];
    for (let i = 0; i < total; i += 1) {
      const m = await medirBolha(gatilhos.nth(i));
      if (m.faltou) {
        check(`${largura} · bolha do ⓘ ${i} existe dentro de .table-container`, false);
        continue;
      }
      check(
        `${largura} · ⓘ "${m.rotulo}" — bolha fixed e posicionada em JS`,
        m.posicao === "fixed" && m.temCoordenada && m.visivel,
        JSON.stringify({ posicao: m.posicao, coord: m.temCoordenada, visivel: m.visivel }),
      );
      check(
        `${largura} · ⓘ "${m.rotulo}" — bolha inteira dentro do viewport`,
        m.dentroDoViewport,
        JSON.stringify({ rect: m.rect, viewport: m.viewport }),
      );
      if (!m.dentroDoViewport) foraDoViewport.push(m.rotulo);
      if (m.ultrapassaContainer) transbordaram += 1;
      if (m.podeTestar) {
        check(
          `${largura} · ⓘ "${m.rotulo}" — bolha continua pintada fora do .table-container`,
          m.pintadaForaDoContainer,
          JSON.stringify({ bolha: m.rect, container: m.container }),
        );
        if (m.pintadaForaDoContainer) pintadasFora += 1;
      }
      if (i === 0) await evidencia(`51-info-hint-${largura}`);
      await fecharBolha();
    }

    check(
      `${largura} · pelo menos uma bolha ultrapassa o .table-container`,
      transbordaram > 0,
      `${transbordaram} de ${total}`,
    );
    check(
      `${largura} · o recorte do overflow não apaga a bolha que transborda`,
      pintadasFora > 0 && foraDoViewport.length === 0,
      `${pintadasFora} provada(s) fora do container; fora do viewport: ${foraDoViewport.join(", ") || "nenhuma"}`,
    );
  }

  // ══ 1, 5 e 6 — alcance e bolha nas três larguras de desktop ══════════
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    const largura = vp.width;

    let alcancadas = 0;
    for (const tela of TELAS) {
      await page.evaluate(() => sessionStorage.clear());
      await abrir(tela.rota);
      const m = await medirAlcance();
      const ok =
        m.existe &&
        m.pintado &&
        m.dentroNaHorizontal &&
        m.dentroNaVertical &&
        !m.dentroDeDobravel &&
        m.expandido === "false" &&
        m.texto.includes("Como funciona");
      if (ok) alcancadas += 1;
      check(
        `${largura} · ${tela.modulo} · ajuda alcançável em ${tela.rota}`,
        ok,
        JSON.stringify(m),
      );
      check(`${largura} · ${tela.rota} sem rolagem horizontal`, m.existe && !m.pagRolaLado);
    }
    check(
      `${largura} · ajuda presente em pelo menos 6 módulos diferentes`,
      alcancadas >= 6,
      `${alcancadas} de ${TELAS.length}`,
    );

    // Recebimento de uma linha: container BAIXO, que é a condição em que a
    // bolha do cabeçalho precisa transbordar para ser lida por inteiro.
    await abrir(ROTA_RECEBIMENTO, ".table-container");
    const rolaLadoRecebimento = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check(`${largura} · ${ROTA_RECEBIMENTO} sem rolagem horizontal`, !rolaLadoRecebimento);
    await provarBolhas(largura);

    await evidencia(`51-viewport-${largura}`);
  }

  await page.setViewportSize(VIEWPORTS[1]);

  // ══ 2 — a tela SEM DADO é a que mais precisa da ajuda ════════════════
  // Foi o defeito original: com a listagem vazia a ajuda saía junto com a
  // tabela, e quem chegava sem nenhum registro ficava sem explicação alguma.
  await page.evaluate(() => sessionStorage.clear());
  await abrir("/cadastros/itens");
  await page.fill("#items-search", "zzz-nenhum-item-com-esse-nome-zzz");
  await page.waitForSelector(".table__empty", { timeout: 10000 });
  const vazia = await page.evaluate((sel) => {
    const botao = document.querySelector(sel);
    const r = botao?.getBoundingClientRect();
    return {
      linhasDeDado: document.querySelectorAll(".table-container tbody tr:not(:has(.table__empty))")
        .length,
      temVazio: Boolean(document.querySelector(".table__empty")),
      ajudaExiste: Boolean(botao),
      ajudaVisivel: Boolean(
        r && r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0,
      ),
      expandido: botao?.getAttribute("aria-expanded"),
    };
  }, GATILHO);
  check("listagem realmente vazia", vazia.temVazio && vazia.linhasDeDado === 0, JSON.stringify(vazia));
  check(
    "ajuda continua visível na tela sem nenhum resultado",
    vazia.ajudaExiste && vazia.ajudaVisivel && vazia.expandido === "false",
    JSON.stringify(vazia),
  );
  await evidencia("51-tela-vazia");
  await page.fill("#items-search", "");
  await page.evaluate(() => sessionStorage.clear());

  // ══ 3 e 4 — conteúdo do modal na tela de Formulação ══════════════════
  await abrir(ROTA_FORMULACAO, ".doc-title h1");
  const gatilhoFormulacao = page.locator(GATILHO).first();
  check("tela de Formulação tem o botão Como funciona", (await gatilhoFormulacao.count()) > 0);
  await gatilhoFormulacao.click();
  await page.waitForSelector(".help-modal", { timeout: 5000 });
  await page.waitForTimeout(300);

  const conteudo = await page.evaluate(() => {
    const modal = document.querySelector(".help-modal");
    if (!modal) return { faltou: true };
    const subtitulos = [...modal.querySelectorAll(".help-modal__subtitle")];
    const nestaTela = subtitulos.find((h) => h.textContent?.trim() === "Nesta tela");
    const glossario = modal.querySelector(".help-modal__concepts");
    const primeiroFluxo = modal.querySelector(".help-modal__flow");
    return {
      titulo: modal.querySelector(".help-modal__title")?.textContent?.trim() ?? "",
      temResumo: (modal.querySelector(".help-modal__summary")?.textContent ?? "").length > 40,
      temNestaTela: Boolean(nestaTela),
      termos: glossario ? glossario.querySelectorAll("dt").length : 0,
      // Ordem no DOM é ordem de leitura: o vocabulário vem antes do caminho
      // porque quem não sabe o que é "versão ativa" não aproveita um fluxo
      // que começa por ela.
      glossarioAntesDoFluxo: Boolean(
        nestaTela &&
          primeiroFluxo &&
          nestaTela.compareDocumentPosition(primeiroFluxo) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      fluxos: modal.querySelectorAll(".help-modal__flow").length,
      temPegadinhas: subtitulos.some((h) => h.textContent?.trim() === "O que costuma pegar"),
      temFechar: [...modal.querySelectorAll("button")].some(
        (b) => b.textContent?.trim() === "Fechar",
      ),
    };
  });
  check("modal da Formulação abriu com título e resumo", !conteudo.faltou && conteudo.temResumo, conteudo.titulo);
  check("modal traz o glossário 'Nesta tela'", conteudo.temNestaTela);
  check("glossário tem pelo menos 4 termos", conteudo.termos >= 4, `${conteudo.termos} termo(s)`);
  check("glossário aparece ANTES do primeiro fluxo no DOM", conteudo.glossarioAntesDoFluxo);
  check("modal tem 'O que costuma pegar' e 'Fechar'", conteudo.temPegadinhas && conteudo.temFechar);
  await evidencia("51-modal-formulacao");

  // Numeração: a caixa é o índice do texto. Se o número da caixa não bater
  // com a posição do item no passo a passo, o clique liga coisas erradas e
  // a correspondência que o desenho promete deixa de existir.
  const numeracao = await page.evaluate(() => {
    const fluxo = document.querySelector(".help-modal__flow");
    if (!fluxo) return { faltou: true };
    const caixas = [...fluxo.querySelectorAll(".help-flow__box")];
    const passos = [...fluxo.querySelectorAll(".help-modal__steps > li")];
    return {
      caixas: caixas.length,
      passos: passos.length,
      numerosEmOrdem: caixas.every(
        (c, i) => c.querySelector(".help-flow__number")?.textContent?.trim() === String(i + 1),
      ),
      rotulosCasam: caixas.every(
        (c, i) =>
          c.querySelector(".help-flow__label")?.textContent?.trim() ===
          passos[i]?.querySelector("b")?.textContent?.trim(),
      ),
      saoBotoes: caixas.every((c) => c.tagName === "BUTTON" && c.hasAttribute("aria-pressed")),
    };
  });
  check("primeiro fluxo tem caixas e passo a passo", !numeracao.faltou && numeracao.caixas >= 3);
  check(
    "caixas e passos têm a mesma quantidade",
    numeracao.caixas === numeracao.passos,
    JSON.stringify(numeracao),
  );
  check("cada caixa mostra o número da sua posição (1, 2, 3…)", numeracao.numerosEmOrdem);
  check("o rótulo da caixa N é o rótulo do passo N", numeracao.rotulosCasam);
  check("as caixas são botões com estado", numeracao.saoBotoes);

  const caixa3 = page.locator(".help-modal__flow").first().locator(".help-flow__box").nth(2);
  await caixa3.click();
  await page.waitForTimeout(300);
  const aposClique = await page.evaluate(() => {
    const fluxo = document.querySelector(".help-modal__flow");
    const caixas = [...fluxo.querySelectorAll(".help-flow__box")];
    const passos = [...fluxo.querySelectorAll(".help-modal__steps > li")];
    return {
      pressionadas: caixas.map((c) => c.getAttribute("aria-pressed")),
      selecionados: passos.map((p) => p.classList.contains("is-selected")),
    };
  });
  check(
    "clicar na caixa 3 marca aria-pressed=true só nela",
    aposClique.pressionadas[2] === "true" &&
      aposClique.pressionadas.filter((v) => v === "true").length === 1,
    JSON.stringify(aposClique.pressionadas),
  );
  check(
    "clicar na caixa 3 põe is-selected só no passo 3",
    aposClique.selecionados[2] === true &&
      aposClique.selecionados.filter(Boolean).length === 1,
    JSON.stringify(aposClique.selecionados),
  );
  await evidencia("51-fluxo-caixa-3");

  // Clicar de novo tira o destaque: sem isso a pessoa fica presa com um
  // trecho em peso e não consegue voltar a ler o fluxo inteiro.
  await caixa3.click();
  await page.waitForTimeout(300);
  const aposSegundoClique = await page.evaluate(() => {
    const fluxo = document.querySelector(".help-modal__flow");
    return {
      pressionadas: [...fluxo.querySelectorAll(".help-flow__box")].map((c) =>
        c.getAttribute("aria-pressed"),
      ),
      selecionados: [...fluxo.querySelectorAll(".help-modal__steps > li")].filter((p) =>
        p.classList.contains("is-selected"),
      ).length,
    };
  });
  check(
    "clicar de novo na caixa 3 desfaz a seleção",
    !aposSegundoClique.pressionadas.includes("true") && aposSegundoClique.selecionados === 0,
    JSON.stringify(aposSegundoClique),
  );

  // Fechar pelo botão, não por Escape: é o caminho que a tela oferece.
  await page.locator('.help-modal__actions button:has-text("Fechar")').click();
  await page.waitForTimeout(300);
  check(
    "modal fecha e o gatilho volta a aria-expanded=false",
    (await page.locator(".help-modal").count()) === 0 &&
      (await gatilhoFormulacao.getAttribute("aria-expanded")) === "false",
  );

  // ══ 8 — o único controle de estoque que o Produto pergunta ═══════════
  // Lote, validade e liberação da Qualidade são padrão da casa: mostrar
  // interruptor para eles daria a impressão de que dá para produzir um
  // acabado sem lote, o que não é verdade.
  await abrir("/cadastros/produtos");
  await page.locator('button:has-text("Novo produto")').first().click();
  await page.waitForSelector("#product-form", { timeout: 8000 });
  await page.waitForTimeout(500);
  const toggles = await page.evaluate(() =>
    [...document.querySelectorAll("#product-form .toggle-card")].map((t) =>
      (t.querySelector("b")?.textContent ?? "").trim(),
    ),
  );
  check(
    "criação de Produto tem o toggle 'Exige CoA / Laudo'",
    toggles.includes("Exige CoA / Laudo") &&
      (await page.locator("#product-requires-coa").count()) === 1,
    JSON.stringify(toggles),
  );
  for (const ausente of ["Controla lote", "Controla validade", "Requer liberação da Qualidade"]) {
    check(
      `criação de Produto NÃO tem o toggle '${ausente}'`,
      !toggles.some((t) => t.toLowerCase() === ausente.toLowerCase()),
      JSON.stringify(toggles),
    );
  }
  await evidencia("51-produto-novo");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ══ 7 — console limpo do começo ao fim ═══════════════════════════════
  check(
    "console do navegador limpo em toda a execução",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 5).join(" | "),
  );

  console.log("\nscreenshots:");
  for (const s of screenshots) console.log(" -", s);
} finally {
  if (browser) await browser.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} verificação(ões) falharam:`);
  for (const f of failures) console.log(" -", f);
  process.exit(1);
}
console.log("\nvalidate51: todas as verificações passaram.");
