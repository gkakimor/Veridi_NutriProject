import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação da capacidade 56 — os dois defeitos de integridade corrigidos:
 * "Ativar formulação descartava o rascunho" e "catálogo truncado no seletor".
 *
 * O que mudou no produto:
 *
 *  1. `FormulationVersionPage.handleActivate` grava o rascunho ANTES de
 *     chamar a ativação, e a gravação é CONDIÇÃO — falhou, não ativa;
 *  2. `SearchableEntitySelect` ganhou `onSearch`, e seis telas passaram a
 *     buscar no SERVIDOR em vez de filtrar no navegador uma primeira página
 *     que agora é de 50 registros.
 *
 * ## Por que isto precisa de navegador de verdade e não de teste unitário
 *
 *  1. "ativar sem salvar não perde a edição" é uma afirmação sobre a ORDEM
 *     de duas chamadas de rede disparadas por UM clique, e sobre o que o
 *     banco guarda no fim. Um `render()` com fetch dublado prova o dublê:
 *     quem regride aqui é a sequência real PATCH → POST, e ela só existe no
 *     navegador falando com a API de verdade;
 *  2. "o item estava fora da primeira página" é uma afirmação sobre o
 *     catálogo INTEIRO servido pela API, com a ordenação da API
 *     (`orderBy code asc`) e a paginação da API. `options` montado à mão num
 *     teste de componente não tem primeira página — logo não pode ter um
 *     "fora dela";
 *  3. o campo de busca tem espera de 200ms, geração de requisição e três
 *     estados de lista (procurando / erro / vazio). Só o tempo real do
 *     navegador percorre essa máquina;
 *  4. "o item inativo não aparece" precisa ser verificado no que a LISTA
 *     mostra depois de uma busca que o servidor respondeu — um filtro
 *     aplicado sobre props já filtradas prova o teste, não o produto;
 *  5. rolagem horizontal de página é resultado do motor de layout; jsdom
 *     devolve 0 para toda medida de caixa.
 *
 * ## Por que as fixtures são criadas aqui
 *
 * O corpus real tem 2.798 itens ativos e nenhum produto com rascunho de
 * formulação em estado conhecido. Ativar uma versão é IRREVERSÍVEL (versão
 * ativa é documento histórico: não se desativa, só se substitui), então o
 * FLUXO 1 não pode usar nenhum rascunho real da base — ele seria consumido.
 * Tudo nasce carimbado com o token da execução e é REMOVIDO no fim, na ordem
 * que as FKs impõem.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate56.mjs handoff/screens
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
 * Curto o bastante para caber no nome dos registros e único o bastante para
 * que duas execuções no mesmo dia não se confundam — e, principalmente, para
 * que a limpeza saiba exatamente o que é dela.
 */
const TOKEN = `V56${Date.now().toString(36).toUpperCase()}`;
const inicio = new Date().toISOString();

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
];

/** Quantos itens de ruído o cenário semeia antes do alvo. Ver `semearRuido`. */
const RUIDO = 60;
/** A primeira página que as telas corrigidas carregam. Tem de bater com o produto. */
const PRIMEIRA_PAGINA = 50;

const screenshots = [];

/** Ids do cenário sintético, na granularidade que a limpeza precisa. */
const criados = {
  customerIds: [],
  productIds: [],
  itemIds: [],
};

/** Resumo textual do que nasceu, para o relatório final. */
const nascidos = [];

/**
 * Remoção na ordem que as FKs impõem, e não na ordem em que as coisas
 * nasceram.
 *
 * `formulation_components.itemId` é RESTRICT: apagar a matéria-prima antes
 * da versão que a usa aborta a transação inteira e deixa metade do cenário
 * para trás. `products.finishedProductItemId` é a mesma história com o item
 * de produto acabado. A ordem abaixo é filho → pai, sempre:
 * movimentos → versões (levam os componentes por Cascade) → produtos →
 * itens (inclusive os de produto acabado) → clientes.
 */
async function limpar() {
  const prisma = new PrismaClient();
  const removidos = [];
  try {
    if (criados.itemIds.length > 0) {
      // O ajuste de estoque do alvo é o único movimento do cenário; sai
      // antes do item porque é dele que fala.
      removidos.push(
        `movimentos: ${
          (await prisma.inventoryMovement.deleteMany({
            where: { itemId: { in: criados.itemIds } },
          })).count
        }`,
      );
    }
    if (criados.productIds.length > 0) {
      removidos.push(
        `versões de formulação: ${
          (await prisma.formulationVersion.deleteMany({
            where: { productId: { in: criados.productIds } },
          })).count
        }`,
      );
      const produtos = await prisma.product.findMany({
        where: { id: { in: criados.productIds } },
        select: { finishedProductItemId: true },
      });
      removidos.push(
        `produtos: ${
          (await prisma.product.deleteMany({ where: { id: { in: criados.productIds } } })).count
        }`,
      );
      // O item de produto acabado nasce junto com o produto e só pode sair
      // depois dele.
      criados.itemIds.push(
        ...produtos.map((p) => p.finishedProductItemId).filter((id) => id !== null),
      );
    }
    if (criados.itemIds.length > 0) {
      await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: criados.itemIds } } });
      await prisma.lot.deleteMany({ where: { itemId: { in: criados.itemIds } } });
      removidos.push(
        `itens: ${(await prisma.item.deleteMany({ where: { id: { in: criados.itemIds } } })).count}`,
      );
    }
    if (criados.customerIds.length > 0) {
      removidos.push(
        `clientes: ${
          (await prisma.customer.deleteMany({ where: { id: { in: criados.customerIds } } })).count
        }`,
      );
    }
    console.log(`limpeza: ${removidos.join(", ")}`);
    return { ok: true, removidos };
  } catch (erro) {
    console.log(`limpeza FALHOU: ${String(erro).slice(0, 400)}`);
    return { ok: false, removidos, erro: String(erro).slice(0, 400) };
  } finally {
    await prisma.$disconnect();
  }
}

let browser;
let resultadoDaLimpeza = { ok: false, removidos: [], erro: "limpeza não chegou a rodar" };

try {
  await api("POST", "/auth/login", credentials);

  // ═══════════════════════════════════════════════════════════════════════
  // ORDENAÇÃO REAL DA API — descoberta ANTES de montar o cenário
  // ═══════════════════════════════════════════════════════════════════════
  // Sem isto o cenário do FLUXO 2 é chute. `GET /items` ordena por `code`
  // ascendente (items.service.ts: `orderBy: { code: "asc" }`) e o código vem
  // de uma sequence por tipo, zero-padded (ME-000001, MP-000001, PA-000001).
  // Duas consequências que decidem o cenário inteiro:
  //
  //   a) cadastro NOVO recebe o MAIOR código do seu tipo, logo cai no FIM da
  //      ordenação — nunca na primeira página;
  //   b) o ruído tem de nascer ANTES do alvo, não depois: criado depois, ele
  //      ficaria atrás do alvo e não empurraria nada.
  //
  // A verificação abaixo mede as duas coisas em vez de acreditar no código.
  const pagina1Antes = await api(
    "GET",
    `/items?active=true&page=1&pageSize=${PRIMEIRA_PAGINA}`,
  );
  const codigosPagina1Antes = pagina1Antes.items.map((i) => i.code);
  const ordenada = codigosPagina1Antes.every(
    (codigo, i) => i === 0 || codigosPagina1Antes[i - 1] <= codigo,
  );
  check(
    "ORDENAÇÃO · a primeira página de /items volta ordenada por código ascendente",
    ordenada && pagina1Antes.items.length === PRIMEIRA_PAGINA,
    `n=${pagina1Antes.items.length} primeiro=${codigosPagina1Antes[0]} último=${
      codigosPagina1Antes[codigosPagina1Antes.length - 1]
    }`,
  );
  anotar(
    `ORDENAÇÃO · ${pagina1Antes.total} itens ativos no catálogo; a primeira página de ` +
      `${PRIMEIRA_PAGINA} vai de ${codigosPagina1Antes[0]} a ${
        codigosPagina1Antes[codigosPagina1Antes.length - 1]
      }`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // FIXTURES
  // ═══════════════════════════════════════════════════════════════════════
  const cliente = await api("POST", "/customers", {
    legalName: `ZZ ${TOKEN} INTEGRIDADE LTDA`,
    tradeName: `Integridade ${TOKEN}`,
  });
  criados.customerIds.push(cliente.id);
  nascidos.push(`cliente ${cliente.code} ${cliente.id}`);

  /** Matéria-prima usada como componente das três formulações do cenário. */
  const materiaPrima = await api("POST", "/items", {
    type: "RAW_MATERIAL",
    name: `ZZ${TOKEN} MATERIA PRIMA DE COMPONENTE`,
    unitCode: "kg",
  });
  criados.itemIds.push(materiaPrima.id);
  nascidos.push(`matéria-prima ${materiaPrima.code} ${materiaPrima.id}`);

  /**
   * Um produto com rascunho de formulação e um componente, pronto para
   * editar. Três deles, porque as três provas do FLUXO 1/2 CONSOMEM estados
   * diferentes e incompatíveis entre si: ativar é irreversível, então o
   * produto do caminho feliz não serve para o caminho recusado, e nenhum dos
   * dois serve para a busca no catálogo (que exige um rascunho intacto).
   */
  async function criarProdutoComRascunho(rotulo, base) {
    const produto = await api("POST", "/products", {
      customerId: cliente.id,
      name: `ZZ${TOKEN} ${rotulo}`,
      finishedUnitCode: "un",
    });
    criados.productIds.push(produto.id);
    const criada = await api("POST", `/products/${produto.id}/formulation-versions`, {
      notes: `ZZ VALIDACAO ${TOKEN}`,
    });
    // A base e o componente entram pelo endpoint oficial: começar de um
    // rascunho que o próprio produto aceitou é o que torna a edição da tela
    // comparável com o que o servidor já tinha.
    const versao = await api("PATCH", `/formulation-versions/${criada.id}`, {
      basisQuantity: base,
      calculationMode: "FIXED_BASIS",
      components: [
        {
          itemId: materiaPrima.id,
          quantity: "10",
          unitCode: "kg",
          basis: "FIXED_BASIS",
          supplyResponsibility: "VERIDI",
        },
      ],
    });
    nascidos.push(`produto ${produto.code} ${produto.id} · versão ${versao.id} (${rotulo})`);
    return { produto, versao };
  }

  const sujo = await criarProdutoComRascunho("PRODUTO ATIVAR SUJO", "1000");
  const recusado = await criarProdutoComRascunho("PRODUTO ATIVAR RECUSADO", "500");
  const catalogo = await criarProdutoComRascunho("PRODUTO BUSCA CATALOGO", "250");

  check(
    "FIXTURE · os três rascunhos nasceram DRAFT, com base gravada e um componente",
    [sujo, recusado, catalogo].every(
      (c) => c.versao.status === "DRAFT" && c.versao.components.length === 1,
    ),
    JSON.stringify(
      [sujo, recusado, catalogo].map((c) => ({
        status: c.versao.status,
        base: c.versao.basisQuantity,
        comps: c.versao.components.length,
      })),
    ),
  );

  /*
   * RUÍDO — semeado ANTES do alvo, porque a ordenação é por código.
   *
   * Sessenta itens de embalagem nascem primeiro; o alvo nasce depois e
   * recebe um código maior que todos eles. Com isto o alvo fica fora da
   * primeira página de 50 POR CONSTRUÇÃO DA FIXTURE, sem depender de quantos
   * itens o banco já tinha — a prova continuaria de pé num catálogo vazio.
   * No banco real ele fica ainda mais longe, e o quanto é medido adiante.
   */
  const ruido = [];
  for (let i = 0; i < RUIDO; i += 1) {
    const item = await api("POST", "/items", {
      type: "PACKAGING",
      name: `ZZ${TOKEN} RUIDO ${String(i + 1).padStart(2, "0")}`,
      unitCode: "un",
      controlsLot: false,
    });
    ruido.push(item);
    criados.itemIds.push(item.id);
  }
  nascidos.push(`ruído: ${RUIDO} embalagens de ${ruido[0].code} a ${ruido[ruido.length - 1].code}`);

  /**
   * O ALVO. `controlsLot: false` de propósito: sem lote, a Contagem Física
   * mostra o saldo do item direto — e é esse número que prova qual id a tela
   * usou depois da escolha.
   */
  const alvo = await api("POST", "/items", {
    type: "PACKAGING",
    name: `ZZ${TOKEN} CAFEINA ANIDRA ALVO`,
    unitCode: "un",
    controlsLot: false,
  });
  criados.itemIds.push(alvo.id);
  nascidos.push(`ALVO ${alvo.code} ${alvo.id}`);

  /**
   * O SÓSIA INATIVO — nome quase igual ao do alvo, e desativado.
   *
   * A correção mudou QUEM CONSEGUE SER ENCONTRADO. Se ela tivesse mudado
   * também QUEM É ELEGÍVEL, este item apareceria na busca da Contagem Física
   * e daria para contar estoque de um item fora de uso. É a regressão que
   * esta fixture guarda.
   */
  const sosia = await api("POST", "/items", {
    type: "PACKAGING",
    name: `ZZ${TOKEN} CAFEINA ANIDRA SOSIA`,
    unitCode: "un",
    controlsLot: false,
  });
  criados.itemIds.push(sosia.id);
  await api("POST", `/items/${sosia.id}/deactivate`, {});
  const sosiaDepois = await api("GET", `/items/${sosia.id}`);
  check(
    "FIXTURE · o sósia ficou mesmo inativo",
    sosiaDepois.active === false,
    JSON.stringify({ code: sosia.code, active: sosiaDepois.active }),
  );
  nascidos.push(`sósia inativo ${sosia.code} ${sosia.id}`);

  /*
   * Saldo distintivo para o alvo.
   *
   * "4242 un" não existe em nenhum outro item do banco; ler esse número na
   * tela depois da escolha é a prova de que a Contagem Física carregou o
   * ITEM CERTO, e não um homônimo que a busca tenha devolvido junto.
   */
  await api("POST", "/inventory-adjustments", {
    itemId: alvo.id,
    type: "ADJUSTMENT_IN",
    quantity: "4242",
    reason: `ZZ VALIDACAO ${TOKEN} saldo distintivo do alvo`,
  });

  // ── A ordenação, agora medida com o cenário montado ─────────────────────
  const prismaMedida = new PrismaClient();
  const anteriores = await prismaMedida.item.count({
    where: { active: true, code: { lt: alvo.code } },
  });
  const totalAtivos = await prismaMedida.item.count({ where: { active: true } });
  await prismaMedida.$disconnect();
  const posicaoDoAlvo = anteriores + 1;

  check(
    "ORDENAÇÃO · o ruído nasceu ANTES do alvo, como a ordem por código exige",
    ruido.every((item) => item.code < alvo.code),
    `último ruído=${ruido[ruido.length - 1].code} alvo=${alvo.code}`,
  );
  check(
    "FORA DA PÁGINA · na ordenação da API (código asc) o alvo é o registro nº " +
      `${posicaoDoAlvo}, muito além dos ${PRIMEIRA_PAGINA} da primeira página`,
    posicaoDoAlvo > PRIMEIRA_PAGINA,
    `posição=${posicaoDoAlvo} de ${totalAtivos} ativos`,
  );

  /*
   * A prova pelo MESMO pedido que a tela faz.
   *
   * A contagem acima é aritmética sobre o banco; esta é a resposta literal
   * de `listItems({ active: true, pageSize: 50 })` — a chamada que a
   * Contagem Física dispara ao abrir. O alvo não está nela.
   */
  const pagina1 = await api("GET", `/items?active=true&page=1&pageSize=${PRIMEIRA_PAGINA}`);
  const codigosPagina1 = pagina1.items.map((i) => i.code);
  check(
    "FORA DA PÁGINA · a resposta literal de /items?active=true&pageSize=50 não traz o alvo",
    !pagina1.items.some((i) => i.id === alvo.id) && !codigosPagina1.includes(alvo.code),
    `${codigosPagina1[0]} … ${codigosPagina1[codigosPagina1.length - 1]}`,
  );
  // E, do outro lado: buscando pelo código, o servidor acha. Sem isto a
  // prova de ausência poderia estar escondendo um item que não existe.
  const buscaNoServidor = await api(
    "GET",
    `/items?active=true&search=${encodeURIComponent(alvo.code)}&page=1&pageSize=${PRIMEIRA_PAGINA}`,
  );
  check(
    "FORA DA PÁGINA · o mesmo endpoint acha o alvo quando recebe o termo de busca",
    buscaNoServidor.items.some((i) => i.id === alvo.id),
    `total=${buscaNoServidor.total}`,
  );

  console.log(
    `fixture pronta · alvo=${alvo.code} (posição ${posicaoDoAlvo}/${totalAtivos}) · ` +
      `sósia inativo=${sosia.code} · ruído=${RUIDO} · rascunhos=${sujo.versao.id.slice(0, 8)}/` +
      `${recusado.versao.id.slice(0, 8)}/${catalogo.versao.id.slice(0, 8)}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Navegador
  // ═══════════════════════════════════════════════════════════════════════
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORTS[1] });
  // Sessão por cookie: refazer o login pela UI a cada troca de viewport
  // gastaria minutos e ainda daria uma origem de instabilidade a mais.
  const corte = cookie.indexOf("=");
  await context.addCookies([
    {
      name: cookie.slice(0, corte),
      value: cookie.slice(corte + 1),
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
   * As duas correções mexem em estado derivado (`selectedItem` deixou de ser
   * `useState`) e em efeito com dependência omitida de propósito (a busca
   * ignora `onSearch`). É exatamente o tipo de mudança que produz atualização
   * depois do desmonte, `key` duplicada e leitura de campo em objeto que
   * ainda não chegou — nada disso muda um pixel, e tudo isso aparece no
   * console.
   */
  const consoleErrors = [];
  /**
   * Avisos do NAVEGADOR sobre recurso que não carregou — outra coisa.
   *
   * O Chromium registra toda resposta >= 400 como `console.error`, sem que
   * nenhuma linha da aplicação tenha chamado `console.error`. É o relato da
   * rede, não um erro de JavaScript. E este teste PROVOCA um 400 de
   * propósito (a base recusada do FLUXO 1): sem separar os dois, a prova de
   * console limpo reprovaria o produto exatamente por ele dar a resposta que
   * deve dar. Estes ficam numa lista própria e são julgados pelo que a rede
   * respondeu, no fim.
   */
  const avisosDeRede = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const texto = m.text();
    if (/^Failed to load resource/.test(texto)) {
      avisosDeRede.push(`${texto.slice(0, 160)} @ ${page.url()}`);
      return;
    }
    consoleErrors.push(`console.error @ ${page.url()} :: ${texto.slice(0, 220)}`);
  });
  page.on("pageerror", (e) => {
    consoleErrors.push(`pageerror @ ${page.url()} :: ${e.message.slice(0, 220)}`);
  });

  /*
   * Toda chamada à API, com método e caminho.
   *
   * É o instrumento central do FLUXO 1: "gravar antes de ativar" e "não
   * ativar quando a gravação falha" são afirmações sobre QUAIS chamadas
   * saíram e em QUE ORDEM. O estado final do banco confirma; a sequência
   * explica.
   */
  const chamadas = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.port !== "3333") return;
    chamadas.push({ method: req.method(), pathname: u.pathname });
  });

  /** Toda resposta de erro da execução inteira, com o endereço. */
  const respostasComErro = [];
  page.on("response", (res) => {
    if (res.status() >= 400) {
      respostasComErro.push({ pathname: new URL(res.url()).pathname, status: res.status() });
    }
  });

  const shot = async (nome) => {
    await page.waitForTimeout(250);
    const destino = path.join(OUT, `${nome}.png`);
    await page.screenshot({ path: destino });
    const absoluto = path.resolve(destino);
    screenshots.push(absoluto);
    return absoluto;
  };

  // ── Ferramentas ─────────────────────────────────────────────────────────

  const abrir = async (rota) => {
    await page.goto(`${WEB}${rota}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".page__title, .doc-title h1", { timeout: 30000 });
    await page.waitForTimeout(500);
  };

  /** Situação e base como a TELA mostra — badge e campo, não a rede. */
  const estadoDaVersao = () =>
    page.evaluate(() => ({
      badge: (document.querySelector(".doc-title .badge")?.textContent ?? "").trim(),
      baseEditavel: document.querySelector("#version-basis")?.value ?? null,
      baseSomenteLeitura: (
        document.querySelector("#version-basis")
          ? null
          : (document.querySelector(".field--narrow .field-readonly-value")?.textContent ?? "")
      )?.trim() ?? null,
      alerta: (document.querySelector(".doc-body .form-alert")?.textContent ?? "").trim(),
      erroDaBase: (document.querySelector(".field--narrow .field__error")?.textContent ?? "").trim(),
    }));

  /**
   * O conteúdo da lista flutuante do `SearchableEntitySelect`.
   *
   * A lista sai por portal em `document.body`, então não adianta procurá-la
   * dentro do campo. Opções e avisos são separados porque "+ Novo item" usa
   * a mesma classe de opção — contá-lo como resultado faria a prova de
   * "50 registros na primeira página" mentir por um.
   */
  const conteudoDaLista = () =>
    page.evaluate(() => {
      const ul = document.querySelector(".entity-select__list");
      if (!ul) return null;
      const lis = [...ul.children];
      const opcoes = lis
        .filter((li) => li.classList.contains("entity-select__option"))
        .map((li) => ({
          criar: li.classList.contains("entity-select__create"),
          code: (li.querySelector(".code")?.textContent ?? "").trim(),
          name: (li.querySelector(".entity-select__name")?.textContent ?? "").trim(),
          hint: (li.querySelector(".entity-select__hint")?.textContent ?? "").trim(),
        }));
      return {
        resultados: opcoes.filter((o) => !o.criar),
        criar: opcoes.filter((o) => o.criar),
        avisos: lis
          .filter((li) => li.classList.contains("entity-select__empty"))
          .map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim()),
        primeiroEhCriar: lis[0]?.classList.contains("entity-select__create") ?? false,
        primeiroTexto: (lis[0]?.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    });

  /**
   * Digita no campo e espera a lista PARAR de procurar.
   *
   * A busca tem espera de 200ms e a resposta vem da rede: ler a lista logo
   * depois de digitar leria "Procurando…" e reprovaria o produto por causa
   * do relógio. A espera aqui é pelo fim do estado de busca, não por tempo
   * fixo.
   */
  async function buscarNoCampo(seletor, termo) {
    const campo = page.locator(seletor);
    await campo.click();
    await campo.press("ControlOrMeta+a");
    await campo.pressSequentially(termo, { delay: 25 });
    await page.waitForFunction(
      () => {
        const ul = document.querySelector(".entity-select__list");
        if (!ul) return false;
        return ![...ul.children].some((li) => (li.textContent ?? "").includes("Procurando"));
      },
      undefined,
      { timeout: 20000 },
    );
    await page.waitForTimeout(250);
  }

  /** Rolagem horizontal da PÁGINA — a medida que decide o veredito. */
  const medirLargura = () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  if (await page.locator("#login-email").count()) {
    await page.fill("#login-email", credentials.email);
    await page.fill("#login-password", credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1800);
  }
  check("sessão autenticada no navegador", (await page.locator("#login-email").count()) === 0);

  // ═══════════════════════════════════════════════════════════════════════
  // FLUXO 1 — formulação suja: ativar sem salvar NÃO perde a edição
  // ═══════════════════════════════════════════════════════════════════════
  // A regressão histórica: quem editava a receita e clicava em "Ativar
  // versão" sem passar por "Salvar rascunho" ativava a versão SEM a
  // alteração, em silêncio. Versão ativa é documento histórico — não se
  // desativa, só se substitui —, então o estrago não tinha conserto.
  //
  // Aqui a base vai a 7777 (número que não existe em lugar nenhum da base),
  // "Salvar rascunho" NUNCA é clicado, e o que se cobra no fim é o registro
  // gravado: ACTIVE **e** 7777.
  const rotaSuja = `/producao/formulacoes/${sujo.produto.id}/versoes/${sujo.versao.id}`;
  await abrir(rotaSuja);
  await page.waitForSelector("#version-basis", { timeout: 30000 });

  const antesDaEdicao = await estadoDaVersao();
  check(
    "FLUXO 1 · a versão abre em Rascunho, com a base que o servidor gravou",
    antesDaEdicao.badge === "Rascunho" && antesDaEdicao.baseEditavel === "1000",
    JSON.stringify(antesDaEdicao),
  );

  const marcaEdicao = chamadas.length;
  await page.fill("#version-basis", "7777");
  check(
    "FLUXO 1 · a base na tela é 7777 e o campo continua editável (ainda é rascunho)",
    (await page.locator("#version-basis").inputValue()) === "7777",
    await page.locator("#version-basis").inputValue(),
  );
  // O ponto do teste: entre digitar e ativar não há gravação nenhuma. Se
  // houvesse, o cenário deixaria de ser "rascunho sujo".
  const durantaEdicao = chamadas.slice(marcaEdicao);
  check(
    "FLUXO 1 · nada foi gravado ao digitar — 'Salvar rascunho' não foi clicado",
    !durantaEdicao.some((c) => c.method === "PATCH"),
    JSON.stringify(durantaEdicao),
  );
  await shot("56-01-fluxo1-rascunho-sujo-base-7777-sem-salvar");

  const marcaAtivacao = chamadas.length;
  await page.locator('button:has-text("Ativar versão")').first().click();
  await page.waitForSelector(".confirm-dialog", { timeout: 20000 });
  await shot("56-02-fluxo1-dialogo-de-ativacao");
  await page.locator('.confirm-dialog__actions button:has-text("Ativar")').first().click();
  await page.waitForFunction(
    () => (document.querySelector(".doc-title .badge")?.textContent ?? "").trim() === "Ativa",
    undefined,
    { timeout: 30000 },
  );
  await page.waitForTimeout(600);

  /*
   * A sequência das chamadas é a explicação do mecanismo.
   *
   * Um clique, duas chamadas, nesta ordem: PATCH (gravar o que está na tela)
   * e só então POST /activate. Antes da correção havia só a segunda — e é
   * por isso que a alteração sumia.
   */
  const naAtivacao = chamadas
    .slice(marcaAtivacao)
    .filter((c) => c.pathname.startsWith("/formulation-versions/"));
  const iPatch = naAtivacao.findIndex(
    (c) => c.method === "PATCH" && c.pathname === `/formulation-versions/${sujo.versao.id}`,
  );
  const iActivate = naAtivacao.findIndex(
    (c) =>
      c.method === "POST" && c.pathname === `/formulation-versions/${sujo.versao.id}/activate`,
  );
  check(
    "FLUXO 1 · um clique disparou GRAVAÇÃO e depois ativação, nesta ordem",
    iPatch >= 0 && iActivate >= 0 && iPatch < iActivate,
    JSON.stringify(naAtivacao),
  );

  // Releitura pela URL: o que a tela mostra depois de montar de novo, sem
  // nenhum estado de React sobrevivente.
  await abrir(rotaSuja);
  await page.waitForTimeout(700);
  const depoisDoReload = await estadoDaVersao();
  check(
    "FLUXO 1 · recarregada, a versão está Ativa e a base é 7777",
    depoisDoReload.badge === "Ativa" &&
      (depoisDoReload.baseSomenteLeitura ?? "").startsWith("7777"),
    JSON.stringify(depoisDoReload),
  );

  /*
   * E a prova que não depende da tela.
   *
   * A regressão original devolvia ACTIVE com a base ANTIGA — 1000. Ler o
   * registro pela API é o que separa "a tela mostra 7777" de "o sistema
   * gravou 7777"; só a segunda é a promessa.
   */
  const sujaNoServidor = await api("GET", `/formulation-versions/${sujo.versao.id}`);
  check(
    "FLUXO 1 · na API a versão está ACTIVE e basisQuantity é 7777 — a edição não se perdeu",
    sujaNoServidor.status === "ACTIVE" && Number(sujaNoServidor.basisQuantity) === 7777,
    JSON.stringify({ status: sujaNoServidor.status, base: sujaNoServidor.basisQuantity }),
  );
  check(
    "FLUXO 1 · a base gravada NÃO é a antiga (1000) — a regressão histórica não voltou",
    Number(sujaNoServidor.basisQuantity) !== 1000,
    `base=${sujaNoServidor.basisQuantity}`,
  );
  await shot("56-03-fluxo1-ativa-com-a-base-7777-apos-recarregar");

  // ── O outro lado: gravação recusada NÃO pode ativar ─────────────────────
  // Gravar antes de ativar só é correção se a gravação for CONDIÇÃO. Se ela
  // fosse efeito colateral, um payload recusado deixaria a versão ativa com
  // o conteúdo velho — que é o defeito original com outra roupa. Base `0` é
  // recusada pelo servidor em `decimalStringSchema()` ("Valor deve ser maior
  // que zero"), e é isso que o teste explora.
  const rotaRecusada = `/producao/formulacoes/${recusado.produto.id}/versoes/${recusado.versao.id}`;
  await abrir(rotaRecusada);
  await page.waitForSelector("#version-basis", { timeout: 30000 });
  await page.fill("#version-basis", "0");

  const marcaRecusa = chamadas.length;
  await page.locator('button:has-text("Ativar versão")').first().click();
  await page.waitForSelector(".confirm-dialog", { timeout: 20000 });
  await page.locator('.confirm-dialog__actions button:has-text("Ativar")').first().click();
  await page.waitForSelector(".doc-body .form-alert", { timeout: 20000 });
  await page.waitForTimeout(600);

  const naRecusa = chamadas
    .slice(marcaRecusa)
    .filter((c) => c.pathname.startsWith("/formulation-versions/"));
  const estadoRecusado = await estadoDaVersao();
  check(
    "FLUXO 1 (recusa) · a tela mostra o erro do servidor, no alerta e no campo",
    estadoRecusado.alerta.includes("Corrija os campos destacados") &&
      estadoRecusado.erroDaBase.length > 0,
    JSON.stringify(estadoRecusado),
  );
  check(
    "FLUXO 1 (recusa) · a tela continua marcada como Rascunho",
    estadoRecusado.badge === "Rascunho",
    estadoRecusado.badge,
  );
  check(
    "FLUXO 1 (recusa) · a ativação NÃO foi chamada — a gravação é condição, não efeito colateral",
    naRecusa.some((c) => c.method === "PATCH") &&
      !naRecusa.some((c) => c.pathname.endsWith("/activate") && c.method === "POST"),
    JSON.stringify(naRecusa),
  );
  /* O diálogo devolveu o foco ao botão "Ativar versão", no rodapé, e a
     rolagem foi junto. A evidência desta prova — badge "Rascunho", alerta e
     erro do campo — está toda no topo; sem voltar, a foto mostraria o lugar
     errado. `scrollIntoViewIfNeeded` porque quem rola é um contêiner do
     shell, não a janela: `window.scrollTo` aqui não move nada. */
  await page.locator(".doc-title h1").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot("56-04-fluxo1-recusa-erro-na-tela-e-continua-rascunho");

  /*
   * A conferência que a tela não pode dar.
   *
   * "Continua rascunho" precisa ser lido no servidor: um estado de React que
   * não avançou pareceria idêntico a um registro que não mudou, e só um dos
   * dois é a promessa. A base também é conferida — ela tem de continuar a
   * gravada (500), não o 0 recusado.
   */
  const recusadaNoServidor = await api("GET", `/formulation-versions/${recusado.versao.id}`);
  check(
    "FLUXO 1 (recusa) · na API a versão continua DRAFT, com a base anterior intacta",
    recusadaNoServidor.status === "DRAFT" && Number(recusadaNoServidor.basisQuantity) === 500,
    JSON.stringify({
      status: recusadaNoServidor.status,
      base: recusadaNoServidor.basisQuantity,
    }),
  );

  // ═══════════════════════════════════════════════════════════════════════
  // FLUXO 2 — catálogo além da primeira página, na Contagem Física
  // ═══════════════════════════════════════════════════════════════════════
  // A prova só vale com as duas metades: primeiro que o alvo NÃO está na
  // lista aberta sem digitar (senão o teste não demonstra nada — acharia um
  // item que já estava ali), depois que digitar o traz.
  await abrir("/estoque/inventario");
  await page.waitForSelector("#count-item", { timeout: 30000 });
  await page.locator("#count-item").click();
  await page.waitForSelector(".entity-select__list", { timeout: 20000 });
  await page.waitForTimeout(400);

  const semDigitar = await conteudoDaLista();
  check(
    "FLUXO 2 · sem digitar, a lista mostra exatamente os 50 da primeira página",
    semDigitar !== null && semDigitar.resultados.length === PRIMEIRA_PAGINA,
    `n=${semDigitar?.resultados.length}`,
  );
  check(
    "FLUXO 2 · e os 50 são LITERALMENTE a primeira página que a API serviu",
    semDigitar !== null &&
      JSON.stringify(semDigitar.resultados.map((o) => o.code)) ===
        JSON.stringify(codigosPagina1),
    `tela=${semDigitar?.resultados[0]?.code}…${
      semDigitar?.resultados[semDigitar.resultados.length - 1]?.code
    } api=${codigosPagina1[0]}…${codigosPagina1[codigosPagina1.length - 1]}`,
  );
  /*
   * A PROVA DE AUSÊNCIA — o coração do FLUXO 2.
   *
   * Sem ela, "digitei e apareceu" seria compatível com o item já estar na
   * lista desde o início, e o teste não diria nada sobre catálogo truncado.
   */
  check(
    `FORA DA PRIMEIRA PÁGINA · o alvo ${alvo.code} NÃO está na lista aberta sem digitar`,
    semDigitar !== null && !semDigitar.resultados.some((o) => o.code === alvo.code),
    JSON.stringify(semDigitar?.resultados.slice(-3)),
  );
  check(
    "FLUXO 2 · a lista avisa que existe catálogo além do que ela mostra",
    semDigitar !== null &&
      semDigitar.avisos.some((a) => a.includes("Digite para buscar em todo o catálogo")),
    JSON.stringify(semDigitar?.avisos),
  );
  await shot("56-05-fluxo2-lista-sem-digitar-alvo-ausente");

  // ── Digitar o código do alvo ────────────────────────────────────────────
  const marcaBusca = chamadas.length;
  await buscarNoCampo("#count-item", alvo.code);
  const comBusca = await conteudoDaLista();
  check(
    `FLUXO 2 · digitado o código, o alvo ${alvo.code} aparece na lista`,
    comBusca !== null && comBusca.resultados.some((o) => o.code === alvo.code),
    JSON.stringify(comBusca?.resultados.slice(0, 3)),
  );
  const buscasNaRede = chamadas
    .slice(marcaBusca)
    .filter((c) => c.method === "GET" && c.pathname === "/items");
  check(
    "FLUXO 2 · a busca foi ao SERVIDOR — não é filtro do navegador sobre o que já tinha",
    buscasNaRede.length > 0,
    `chamadas GET /items durante a digitação: ${buscasNaRede.length}`,
  );
  await shot("56-06-fluxo2-alvo-encontrado-apos-buscar");

  // ── Selecionar, e provar que o id escolhido é o certo ───────────────────
  const marcaSelecao = chamadas.length;
  await page
    .locator(`.entity-select__list li.entity-select__option:has(.code:text-is("${alvo.code}"))`)
    .first()
    .click();
  await page.waitForTimeout(1200);

  const campoDepois = await page.locator("#count-item").getAttribute("placeholder");
  check(
    "FLUXO 2 · a opção é selecionável e o campo passa a exibir o item escolhido",
    (campoDepois ?? "").includes(alvo.code) && (campoDepois ?? "").includes(alvo.name),
    `campo="${campoDepois}"`,
  );

  /*
   * QUAL id a tela usou — duas leituras independentes.
   *
   * A chamada: a Contagem Física carrega o escopo por `GET /inventory/:id`,
   * e o `:id` é o do alvo. O saldo: "4242 un" é único no banco, semeado nesta
   * execução. Uma prova é sobre o que a tela PEDIU, a outra sobre o que ela
   * ENTENDEU — mesclar o achado no catálogo é justamente o que faz a segunda
   * funcionar (sem isso a tela não saberia a unidade nem o controle de lote).
   */
  const naSelecao = chamadas.slice(marcaSelecao);
  check(
    "FLUXO 2 · a seleção usou o id certo: a tela pediu GET /inventory/<id do alvo>",
    naSelecao.some((c) => c.method === "GET" && c.pathname === `/inventory/${alvo.id}`),
    JSON.stringify(naSelecao),
  );
  const saldoNaTela = await page.evaluate(() =>
    [...document.querySelectorAll(".field")]
      .filter((f) => (f.querySelector("label")?.textContent ?? "").includes("Saldo sistema"))
      .map((f) => (f.querySelector(".field-readonly-value")?.textContent ?? "").trim())[0],
  );
  check(
    "FLUXO 2 · o saldo carregado é o do alvo (4242 un), na unidade que veio da busca",
    saldoNaTela === "4242 un",
    `saldo="${saldoNaTela}"`,
  );
  check(
    "FLUXO 2 · item sem controle de lote não pede lote — a tela entendeu o cadastro do alvo",
    (await page.locator("#count-lot").count()) === 0,
  );
  await shot("56-07-fluxo2-alvo-selecionado-saldo-4242");

  // ── Elegibilidade: achar não muda quem pode ser escolhido ───────────────
  // O sósia tem nome quase igual e está INATIVO. A busca no servidor leva o
  // mesmo `active: true` da carga inicial; se ele aparecesse, a correção
  // teria alargado o conjunto elegível em vez de só torná-lo alcançável.
  const fragmento = `ZZ${TOKEN} CAFEINA ANIDRA`;
  await buscarNoCampo("#count-item", fragmento);
  const porNome = await conteudoDaLista();
  check(
    "ELEGIBILIDADE · buscando pelo nome comum, o ALVO ativo aparece",
    porNome !== null && porNome.resultados.some((o) => o.code === alvo.code),
    JSON.stringify(porNome?.resultados),
  );
  check(
    `ELEGIBILIDADE · o sósia INATIVO ${sosia.code} não aparece — busca não muda elegibilidade`,
    porNome !== null && !porNome.resultados.some((o) => o.code === sosia.code),
    JSON.stringify(porNome?.resultados),
  );
  // E o servidor confirma que os dois existem e casam com o termo: sem isto,
  // a ausência do sósia poderia ser só uma busca que não achou nada.
  const ambos = await api(
    "GET",
    `/items?search=${encodeURIComponent(fragmento)}&page=1&pageSize=20`,
  );
  check(
    "ELEGIBILIDADE · o termo casa com os DOIS itens no servidor; o filtro de ativo é que exclui o sósia",
    ambos.items.some((i) => i.id === alvo.id) && ambos.items.some((i) => i.id === sosia.id),
    JSON.stringify(ambos.items.map((i) => `${i.code}:${i.active}`)),
  );
  await shot("56-08-fluxo2-elegibilidade-sosia-inativo-fora");

  // ═══════════════════════════════════════════════════════════════════════
  // FLUXO 2 (segunda tela) — Formulação
  // ═══════════════════════════════════════════════════════════════════════
  // Escolhida por ser a que se monta sem cadeia: o rascunho já existe do
  // FLUXO 1. E é a única das seis que oferece criação no contexto, então é
  // aqui que "+ Novo item de estoque" pode ser cobrado no topo da lista.
  const rotaCatalogo = `/producao/formulacoes/${catalogo.produto.id}/versoes/${catalogo.versao.id}`;
  await abrir(rotaCatalogo);
  await page.waitForSelector('button:has-text("Adicionar componente")', { timeout: 30000 });
  // Linha nova, vazia: buscar na linha que já tem item escolhido testaria o
  // mesmo mecanismo com um estado a mais no caminho.
  await page.locator('button:has-text("+ Adicionar componente")').first().click();
  await page.waitForTimeout(400);

  const comboNovaLinha = 'table tbody tr:last-child input[role="combobox"]';
  await page.locator(comboNovaLinha).click();
  await page.waitForSelector(".entity-select__list", { timeout: 20000 });
  await page.waitForTimeout(400);

  const formSemDigitar = await conteudoDaLista();
  check(
    `FORMULAÇÃO · sem digitar, o alvo ${alvo.code} também não está na lista desta tela`,
    formSemDigitar !== null && !formSemDigitar.resultados.some((o) => o.code === alvo.code),
    `n=${formSemDigitar?.resultados.length}`,
  );
  /*
   * "+ Novo item de estoque" continua sendo a PRIMEIRA parada da lista.
   *
   * A correção mexeu na montagem da lista (resultado remoto substituindo
   * `options`); o item de criação é renderizado fora desse caminho e é
   * exatamente o tipo de coisa que se perde numa mudança dessas.
   */
  check(
    "FORMULAÇÃO · '+ Novo item de estoque' é o primeiro item da lista, sem digitar",
    formSemDigitar !== null &&
      formSemDigitar.primeiroEhCriar &&
      formSemDigitar.primeiroTexto.startsWith("+ Novo item de estoque"),
    JSON.stringify({
      primeiro: formSemDigitar?.primeiroTexto,
      ehCriar: formSemDigitar?.primeiroEhCriar,
    }),
  );
  await shot("56-09-formulacao-lista-sem-digitar-novo-item-no-topo");

  await buscarNoCampo(comboNovaLinha, alvo.code);
  const formComBusca = await conteudoDaLista();
  check(
    `FORMULAÇÃO · digitado o código, o alvo ${alvo.code} aparece — a segunda tela também busca no servidor`,
    formComBusca !== null && formComBusca.resultados.some((o) => o.code === alvo.code),
    JSON.stringify(formComBusca?.resultados.slice(0, 3)),
  );
  check(
    "FORMULAÇÃO · com resultado na tela, '+ Novo item de estoque' continua no topo",
    formComBusca !== null && formComBusca.primeiroEhCriar,
    formComBusca?.primeiroTexto ?? "",
  );
  await shot("56-10-formulacao-alvo-encontrado-apos-buscar");

  // Escolher de verdade: encontrar sem conseguir usar não resolveria nada.
  await page
    .locator(`.entity-select__list li.entity-select__option:has(.code:text-is("${alvo.code}"))`)
    .first()
    .click();
  await page.waitForTimeout(600);
  /*
   * A linha é localizada pelo COMBOBOX que ela contém, não por "última linha
   * de tabela": a tela tem mais de uma tabela (componentes e o resumo de
   * custo logo abaixo), e a última linha do documento é do resumo — que não
   * tem campo de item nenhum.
   */
  const linhaNova = await page.evaluate(() => {
    const linhas = [...document.querySelectorAll("tr")].filter((tr) =>
      tr.querySelector('input[role="combobox"]'),
    );
    const tr = linhas[linhas.length - 1];
    if (!tr) return null;
    const combo = tr.querySelector('input[role="combobox"]');
    return {
      campo: combo?.getAttribute("placeholder") ?? "",
      unidadeDeEstoque: (tr.querySelectorAll("td")[1]?.textContent ?? "").trim(),
    };
  });
  check(
    "FORMULAÇÃO · o item de fora da primeira página é selecionável e a linha herda a unidade de estoque dele",
    linhaNova !== null &&
      linhaNova.campo.includes(alvo.code) &&
      linhaNova.unidadeDeEstoque === alvo.unitCode,
    JSON.stringify(linhaNova),
  );
  await shot("56-11-formulacao-alvo-selecionado-na-linha");

  // ═══════════════════════════════════════════════════════════════════════
  // TRÊS VIEWPORTS — a PÁGINA não rola na horizontal
  // ═══════════════════════════════════════════════════════════════════════
  // Rolagem horizontal de página leva junto o cabeçalho do documento e a
  // barra de ações — some do lugar exatamente o que dá contexto e o que
  // confirma. A tela de formulação é a mais larga do par (tabela de
  // componentes com dez colunas), por isso entra nas três medidas.
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    for (const tela of [
      { rotulo: "inventario", rota: "/estoque/inventario", esperar: "#count-item" },
      { rotulo: "formulacao", rota: rotaCatalogo, esperar: ".doc-title h1" },
    ]) {
      await abrir(tela.rota);
      await page.waitForSelector(tela.esperar, { timeout: 30000 });
      await page.waitForTimeout(500);
      const medida = await medirLargura();
      check(
        `VP · ${vp.width}×${vp.height} · ${tela.rotulo} — a página não rola na horizontal`,
        medida.scrollWidth <= medida.clientWidth,
        `scrollWidth=${medida.scrollWidth} clientWidth=${medida.clientWidth} ` +
          `sobra=${medida.scrollWidth - medida.clientWidth}px`,
      );
      await shot(`56-vp-${vp.width}-${tela.rotulo}`);
    }
  }
  await page.setViewportSize(VIEWPORTS[1]);

  // ═══════════════════════════════════════════════════════════════════════
  // Console — zero erro na execução inteira
  // ═══════════════════════════════════════════════════════════════════════
  check(
    "CONSOLE · zero console.error de aplicação e zero pageerror na execução inteira",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 6).join(" | "),
  );
  if (consoleErrors.length > 0) {
    anotar(`console: ${consoleErrors.length} ocorrência(s) — lista completa abaixo`);
    for (const e of consoleErrors) anotar(`  console → ${e}`);
  }

  /*
   * O outro lado da separação feita no topo.
   *
   * O aviso "Failed to load resource" deixou de reprovar; a RESPOSTA que o
   * causou não. A única resposta de erro aceita nesta execução é o 400 da
   * gravação recusada (base `0`) — que o teste provoca de propósito para
   * provar que a ativação não acontece sem gravação. Qualquer outra coisa
   * (asset faltando, 500 de endpoint, 401 de sessão) reprova aqui.
   */
  const esperado400 = `/formulation-versions/${recusado.versao.id}`;
  const inesperadas = respostasComErro.filter(
    (r) => !(r.status === 400 && r.pathname === esperado400),
  );
  check(
    "REDE · a única resposta de erro da execução é o 400 deliberado da base recusada",
    inesperadas.length === 0,
    JSON.stringify(inesperadas.slice(0, 6)),
  );
  anotar(
    `rede · ${respostasComErro.length} resposta(s) >= 400 na execução, ` +
      `${respostasComErro.length - inesperadas.length} delas o 400 escopado provocado pelo teste; ` +
      `${avisosDeRede.length} aviso(s) "Failed to load resource" do navegador ` +
      `(não são console.error da aplicação)`,
  );
  anotar(
    `FORA DA PRIMEIRA PÁGINA · como foi provado: (1) ordenação real medida — ` +
      `/items ordena por código ascendente e o código vem de sequence por tipo, ` +
      `então cadastro novo cai no fim; (2) ${RUIDO} itens de ruído nasceram ANTES do alvo; ` +
      `(3) o alvo ${alvo.code} é o registro nº ${posicaoDoAlvo} de ${totalAtivos} ativos; ` +
      `(4) a resposta literal de /items?active=true&pageSize=50 não o traz; ` +
      `(5) a lista aberta sem digitar mostra exatamente esses 50 códigos e ele não está entre eles`,
  );
} finally {
  if (browser) await browser.close();
  /*
   * A limpeza roda SEMPRE.
   *
   * Uma parada no meio deixaria um cliente, três produtos, 63 itens e um
   * ajuste de estoque sintéticos na base — aparecendo nas buscas de quem
   * usar o ambiente depois e, pior, deslocando a contagem de itens ativos
   * que a próxima medição de catálogo vai usar. O que sobrar, se sobrar, é
   * dito no relatório.
   */
  resultadoDaLimpeza = await limpar();
}

// ── Relatório ─────────────────────────────────────────────────────────────
console.log("\n── Cenário criado nesta execução ──");
for (const n of nascidos) console.log(" ·", n);
console.log(
  ` limpeza: ${
    resultadoDaLimpeza.ok
      ? `concluída (${resultadoDaLimpeza.removidos.join(", ")})`
      : `FALHOU — ${resultadoDaLimpeza.erro}; ids acima continuam na base`
  }`,
);
/* As sequences de código (item_code_*_seq) não voltam atrás — os códigos
   consumidos por esta execução ficam vagos para sempre. É o preço de usar o
   endpoint oficial em vez de escrever no banco, e é barato. */
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
  console.log("\nvalidate56: todas as verificações passaram.");
}
