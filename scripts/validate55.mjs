import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * Validação da capacidade 55 — a aba PRODUÇÃO da Consulta do Cliente.
 *
 * O que mudou: a Consulta do Cliente ganhou uma aba entre Pedidos e Estoque,
 * com lista (`/consultas/clientes/:id/producao`) e detalhe consultivo
 * (`.../producao/:productionOrderId`), servidos por um read model próprio
 * (`GET /customers/:id/consultation/production-orders`). O Resumo ganhou dois
 * contadores: `productionOrders` e `openProductionOrders`.
 *
 * Por que isto precisa de navegador de verdade e não de teste unitário:
 *
 *  1. "o Cliente continua sendo a raiz" é uma afirmação sobre a árvore de
 *     rotas MONTADA: o shell fica de pé, o Outlet troca, e o cabeçalho do
 *     Cliente sobrevive à navegação. `render()` de uma aba isolada nunca tem
 *     shell, então nunca pode perdê-lo;
 *  2. "o link vai para dentro da Consulta, não para o módulo operacional" é
 *     uma afirmação sobre `location.pathname` depois de um clique real. Com
 *     `MemoryRouter` não existe `location` de verdade para comparar;
 *  3. "OP do outro cliente não aparece" só vale se for verificado no HTML
 *     SERVIDO — um componente montado com props filtradas prova o filtro do
 *     teste, não o do servidor;
 *  4. "404 contextual" é o encontro de três coisas — a resposta da API, o
 *     estado do hook e o shell que continua em pé. Só a página inteira tem
 *     as três ao mesmo tempo;
 *  5. rolagem horizontal de página é resultado do motor de layout. jsdom
 *     devolve 0 para toda medida de caixa.
 *
 * ## Por que as fixtures são criadas aqui, e não reaproveitadas
 *
 * 78 das 108 ordens do banco de desenvolvimento NÃO têm cliente — a produção
 * que a Veridi faz para o próprio estoque não tem a quem apontar. Abrir a aba
 * num cliente qualquer da base mostra, quase sempre, o estado vazio; e isso é
 * o comportamento correto, não defeito. Para provar o fluxo principal é
 * preciso um cenário sintético com vínculo garantido.
 *
 * Tudo é carimbado com o token da execução e REMOVIDO no fim, na ordem que as
 * FKs impõem. O corpus real não é tocado.
 *
 *   pnpm exec dotenv -e .env -- node scripts/validate55.mjs handoff/screens
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
const TOKEN = `V55${Date.now().toString(36).toUpperCase()}`;
const inicio = new Date().toISOString();

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
];

const screenshots = [];

/** Ids do cenário sintético, na granularidade que a limpeza precisa. */
const criados = {
  customerIds: [],
  productIds: [],
  itemIds: [],
  customerOrderIds: [],
  productionOrderIds: [],
  productionOutputIds: [],
};

/** Resumo textual do que nasceu, para o relatório final. */
const nascidos = [];

/**
 * Remoção na ordem que as FKs impõem, e não na ordem em que as coisas
 * nasceram.
 *
 * `production_outputs.productionOrderId` e `customer_order_lines.productId`
 * são RESTRICT no banco: apagar a OP antes do apontamento, ou o produto antes
 * da linha do pedido, aborta a transação inteira e deixa metade do cenário
 * para trás. A ordem abaixo é filho → pai, sempre.
 */
async function limpar() {
  const prisma = new PrismaClient();
  const removidos = [];
  try {
    if (criados.productionOrderIds.length > 0) {
      const ops = { productionOrderId: { in: criados.productionOrderIds } };
      removidos.push(`apontamentos: ${(await prisma.productionOutput.deleteMany({ where: ops })).count}`);
      // Cascade no schema, mas explícito aqui: contagem que some sozinha
      // esconde o que a limpeza de fato fez.
      removidos.push(
        `necessidades: ${(await prisma.productionOrderRequirement.deleteMany({ where: ops })).count}`,
      );
      removidos.push(
        `ordens: ${
          (await prisma.productionOrder.deleteMany({ where: { id: { in: criados.productionOrderIds } } }))
            .count
        }`,
      );
    }
    if (criados.customerOrderIds.length > 0) {
      // As linhas do pedido são Cascade de verdade — e precisam sair antes
      // do produto, que elas referenciam.
      removidos.push(
        `pedidos: ${
          (await prisma.customerOrder.deleteMany({ where: { id: { in: criados.customerOrderIds } } }))
            .count
        }`,
      );
    }
    if (criados.productIds.length > 0) {
      await prisma.formulationVersion.deleteMany({
        where: { productId: { in: criados.productIds } },
      });
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
  // FIXTURES — o cenário mínimo que torna cada prova possível
  // ═══════════════════════════════════════════════════════════════════════
  // Dois clientes, e não um: "a lista mostra as ordens do cliente" e "a lista
  // NÃO mostra as ordens de outro" são afirmações diferentes, e a segunda é a
  // que o escopo existe para garantir. Um terceiro cliente, sem nada, cobre o
  // estado vazio — que aqui é o caso COMUM, não a exceção.
  const prisma = new PrismaClient();

  const clienteA = await api("POST", "/customers", {
    legalName: `ZZ CONSULTA PRODUCAO A ${TOKEN}`,
    tradeName: `Aurora ${TOKEN}`,
  });
  const clienteB = await api("POST", "/customers", {
    legalName: `ZZ CONSULTA PRODUCAO B ${TOKEN}`,
    tradeName: `Boreal ${TOKEN}`,
  });
  const clienteVazio = await api("POST", "/customers", {
    legalName: `ZZ CONSULTA PRODUCAO VAZIO ${TOKEN}`,
    tradeName: `Cinza ${TOKEN}`,
  });
  criados.customerIds.push(clienteA.id, clienteB.id, clienteVazio.id);
  nascidos.push(
    `cliente A ${clienteA.code} ${clienteA.id}`,
    `cliente B ${clienteB.code} ${clienteB.id}`,
    `cliente vazio ${clienteVazio.code} ${clienteVazio.id}`,
  );

  // Produto cria o item de produto acabado junto — é dele que sai o
  // `outputUnitCode` da ordem.
  const produtoA = await api("POST", "/products", {
    customerId: clienteA.id,
    name: `ZZ Coenzima Q10 ${TOKEN}`,
    finishedUnitCode: "un",
  });
  const produtoB = await api("POST", "/products", {
    customerId: clienteB.id,
    name: `ZZ Creatina ${TOKEN}`,
    finishedUnitCode: "un",
  });
  criados.productIds.push(produtoA.id, produtoB.id);
  nascidos.push(`produto A ${produtoA.code} ${produtoA.id}`, `produto B ${produtoB.code} ${produtoB.id}`);

  /*
   * O Pedido do Cliente A existe por uma razão só: provar o LINK DE PEDIDO
   * da lista e do detalhe. Ele nasce DRAFT pelo endpoint oficial — confirmar
   * exigiria snapshot, plano de atendimento e reserva, cadeia que não muda
   * nada do que esta validação mede.
   */
  const pedidoA = await api("POST", "/customer-orders", {
    customerId: clienteA.id,
    lines: [{ productId: produtoA.id, orderedQuantity: "10" }],
  });
  criados.customerOrderIds.push(pedidoA.id);
  const linhaPedidoA = pedidoA.lines?.[0]?.id ?? null;
  nascidos.push(`pedido A ${pedidoA.code} ${pedidoA.id}`);

  /*
   * As ordens nascem pelo endpoint oficial (`POST /production-orders`), que é
   * quem gera o código pela sequence e quem resolve o `customerId` a partir
   * do Produto — exatamente o vínculo que a aba filtra. Criar a linha à mão
   * no banco pularia justamente a regra que se quer provar.
   */
  const opA1 = await api("POST", "/production-orders", {
    productId: produtoA.id,
    plannedQuantity: "100",
    notes: `ZZ VALIDACAO ${TOKEN}`,
  });
  const opA2 = await api("POST", "/production-orders", {
    productId: produtoA.id,
    plannedQuantity: "60",
    notes: `ZZ VALIDACAO ${TOKEN}`,
  });
  const opB1 = await api("POST", "/production-orders", {
    productId: produtoB.id,
    plannedQuantity: "40",
    notes: `ZZ VALIDACAO ${TOKEN}`,
  });
  criados.productionOrderIds.push(opA1.id, opA2.id, opB1.id);
  nascidos.push(
    `OP-A1 ${opA1.code} ${opA1.id}`,
    `OP-A2 ${opA2.code} ${opA2.id}`,
    `OP-B1 ${opB1.code} ${opB1.id}`,
  );

  check(
    "FIXTURE · o endpoint oficial resolveu o cliente das três ordens pelo Produto",
    opA1.customerId === clienteA.id && opA2.customerId === clienteA.id && opB1.customerId === clienteB.id,
    JSON.stringify({ a1: opA1.customerId, a2: opA2.customerId, b1: opB1.customerId }),
  );

  /*
   * Situação e snapshot vão direto ao banco.
   *
   * O caminho oficial para chegar a IN_PRODUCTION/COMPLETED passa por
   * PLAN → RELEASE → picking → consumo → apontamento, e cada etapa exige
   * formulação ACTIVE, lote de matéria-prima com saldo e reserva. Montar essa
   * cadeia inteira mudaria o assunto do teste: nada do que a aba mostra
   * depende dela — ela lê situação, snapshot, soma de apontamentos e lote de
   * acabado, e é isso que é semeado abaixo.
   *
   * O snapshot (`productCode`/`productName`) é o que uma OP planejada
   * congela. Sem ele a linha ficaria com "—" no lugar do produto e o LINK DE
   * PRODUTO não teria o que provar.
   */
  const agora = new Date();
  const snapshotDoProduto = {
    productCode: produtoA.code,
    productName: produtoA.name,
    finishedItemId: produtoA.finishedProductItem?.id ?? null,
    finishedItemCode: produtoA.finishedProductItem?.code ?? null,
    finishedItemName: produtoA.finishedProductItem?.name ?? null,
  };

  // OP-A1 — em produção, com apontamento: prova quantidade produzida e saldo.
  await prisma.productionOrder.update({
    where: { id: opA1.id },
    data: {
      ...snapshotDoProduto,
      status: "IN_PRODUCTION",
      origin: "CUSTOMER_ORDER",
      customerOrderId: pedidoA.id,
      ...(linhaPedidoA ? { customerOrderLineId: linhaPedidoA } : {}),
      plannedAt: new Date(agora.getTime() - 3 * 86400000),
      releasedAt: new Date(agora.getTime() - 2 * 86400000),
      startedAt: new Date(agora.getTime() - 86400000),
    },
  });
  const apontamento = await prisma.productionOutput.create({
    data: {
      productionOrderId: opA1.id,
      quantity: "40",
      producedAt: new Date(agora.getTime() - 3600000),
      producedBy: "validate55",
      notes: `ZZ VALIDACAO ${TOKEN}`,
    },
  });
  criados.productionOutputIds.push(apontamento.id);

  // OP-A2 — concluída: a segunda situação, para a lista não ter uma só cor.
  await prisma.productionOrder.update({
    where: { id: opA2.id },
    data: {
      ...snapshotDoProduto,
      status: "COMPLETED",
      plannedAt: new Date(agora.getTime() - 6 * 86400000),
      releasedAt: new Date(agora.getTime() - 5 * 86400000),
      startedAt: new Date(agora.getTime() - 4 * 86400000),
      completedAt: new Date(agora.getTime() - 3 * 86400000),
    },
  });

  // OP-B1 — planejada, do OUTRO cliente. É a linha que não pode vazar.
  await prisma.productionOrder.update({
    where: { id: opB1.id },
    data: {
      productCode: produtoB.code,
      productName: produtoB.name,
      finishedItemId: produtoB.finishedProductItem?.id ?? null,
      finishedItemCode: produtoB.finishedProductItem?.code ?? null,
      finishedItemName: produtoB.finishedProductItem?.name ?? null,
      status: "PLANNED",
      plannedAt: new Date(agora.getTime() - 86400000),
    },
  });
  await prisma.$disconnect();

  console.log(
    `fixture pronta · A=${clienteA.code} (${opA1.code} IN_PRODUCTION +40, ${opA2.code} COMPLETED) · ` +
      `B=${clienteB.code} (${opB1.code} PLANNED) · vazio=${clienteVazio.code}`,
  );
  /*
   * O atalho, dito por extenso — quem lê a evidência precisa saber onde ela
   * é sintética.
   *
   * A OP-A2 fica COMPLETED com zero apontado, combinação que o fluxo real
   * não produz sem `completionReason` (variância). Aqui isso é irrelevante:
   * a aba lê situação e soma de apontamentos, e nenhuma das duas passa por
   * essa regra. O que ela existe para provar — que a lista mostra mais de uma
   * situação e que "em aberto" exclui a concluída — não depende disso.
   */
  anotar(
    `FIXTURE · situação e snapshot das ordens foram semeados no banco; ` +
      `${opA2.code} fica COMPLETED com 0 apontado, combinação que o fluxo oficial ` +
      `(PLAN → RELEASE → consumo → apontamento → complete) não geraria sem motivo de variância`,
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
   * Uma aba nova dentro de um shell existente é exatamente o tipo de mudança
   * que produz `key` duplicada, leitura de campo em objeto que ainda não
   * chegou e atualização de estado depois do desmonte — nada disso muda um
   * pixel na tela, e tudo isso aparece no console.
   */
  const consoleErrors = [];
  /**
   * Avisos do NAVEGADOR sobre recurso que não carregou — outra coisa.
   *
   * O Chromium registra toda resposta >= 400 como `console.error`, sem que
   * nenhuma linha da aplicação tenha chamado `console.error`. É o relato da
   * rede, não um erro de JavaScript. E o teste cruzado PROVOCA um 404 de
   * propósito: sem separar os dois, a prova de console limpo reprovaria o
   * produto exatamente por dar a resposta que ele deve dar. Estes ficam numa
   * lista própria e são julgados pelo que a rede respondeu, logo abaixo.
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
   * Toda resposta de erro da execução inteira, com o endereço.
   *
   * É o contraponto honesto do parágrafo acima: o aviso de rede deixa de
   * reprovar, mas a RESPOSTA que o gerou continua sendo conferida uma a uma.
   * Um 404 de asset, um 500 de endpoint ou um 401 de sessão expirada aparecem
   * aqui e reprovam — só o 404 que o teste cruzado pede é aceito.
   */
  const respostasComErro = [];
  page.on("response", (res) => {
    if (res.status() >= 400) {
      respostasComErro.push({ pathname: new URL(res.url()).pathname, status: res.status() });
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

  // ── Ferramentas ─────────────────────────────────────────────────────────

  /** Espera a URL satisfazer um teste. Navegação é assíncrona; asserção não. */
  async function esperarUrl(testar, timeout = 20000) {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      if (testar(new URL(page.url()))) return true;
      await page.waitForTimeout(120);
    }
    return false;
  }

  const caminhoAtual = () => new URL(page.url()).pathname;

  /**
   * Espera a LISTA da aba, não a URL.
   *
   * A rota muda no instante em que o roteador aceita o endereço; as linhas
   * chegam uma volta de rede depois. Medir entre as duas coisas leria a
   * tabela anterior — e reprovaria o produto por um defeito do relógio.
   */
  async function esperarLista() {
    await page.waitForSelector(".consult-body table tbody tr", { timeout: 30000 });
    await page.waitForTimeout(400);
  }

  /** Espera o DETALHE da ordem: título do documento montado. */
  async function esperarDetalhe() {
    await page.waitForSelector(".consult-body .doc-title h1", { timeout: 30000 });
    await page.waitForTimeout(400);
  }

  const abrir = async (rota) => {
    await page.goto(`${WEB}${rota}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".consult-body, .page__title", { timeout: 30000 });
    await page.waitForTimeout(500);
  };

  /** Trilha da Consulta, com o separador que o leitor humano usa. */
  const trilha = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".consult-trail ol li")]
        .map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim())
        .join(" › "),
    );

  /** Cabeçalho do shell: quem é o Cliente que está na tela agora. */
  const clienteNaTela = () =>
    page.evaluate(() => ({
      presente: Boolean(document.querySelector(".consult-head")),
      titulo: (document.querySelector(".consult-head h1")?.textContent ?? "").trim(),
      codigo: (document.querySelector(".consult-head .is-code")?.textContent ?? "").trim(),
    }));

  /** Códigos de OP visíveis na tabela da aba. */
  const codigosNaLista = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".consult-body table tbody tr td:first-child")]
        .map((td) => (td.textContent ?? "").trim())
        .filter((texto) => /^OP-/.test(texto)),
    );

  /** Uma linha inteira da tabela, célula a célula. */
  const linhaDaLista = (codigo) =>
    page.evaluate((cod) => {
      const tr = [...document.querySelectorAll(".consult-body table tbody tr")].find(
        (linha) => (linha.querySelector("td")?.textContent ?? "").trim() === cod,
      );
      if (!tr) return null;
      return [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim());
    }, codigo);

  /** Valor de um `<dt>` da lista de definições do detalhe. */
  const fato = (rotulo) =>
    page.evaluate((r) => {
      const dt = [...document.querySelectorAll(".consult-body .definition-list dt")].find(
        (el) => (el.textContent ?? "").trim() === r,
      );
      return dt ? (dt.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim() : null;
    }, rotulo);

  /** O texto e o HTML servidos, para as provas de ausência. */
  const textoEHtml = () =>
    page.evaluate(() => ({
      texto: document.body.innerText,
      html: document.documentElement.outerHTML,
    }));

  /**
   * Tudo que é clicável DENTRO do corpo da consulta.
   *
   * O corpo, e não a página: as abas, o "Trocar cliente" e o menu lateral são
   * do shell e da aplicação, e contá-los como ação da tela transformaria a
   * prova em ruído.
   */
  const interativosDoCorpo = () =>
    page.evaluate(() => {
      const corpo = document.querySelector(".consult-body");
      if (!corpo) return null;
      return [...corpo.querySelectorAll('button, a, input, select, textarea, [role="button"]')].map(
        (el) => ({
          tag: el.tagName.toLowerCase(),
          texto: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          href: el.getAttribute("href"),
        }),
      );
    });

  /** Rolagem horizontal da PÁGINA e da tabela, medidas separadamente. */
  const medirLargura = () =>
    page.evaluate(() => {
      const doc = document.documentElement;
      const caixa = document.querySelector(".consult-body .table-container");
      return {
        pagina: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth },
        tabela: caixa
          ? { scrollWidth: caixa.scrollWidth, clientWidth: caixa.clientWidth }
          : null,
      };
    });

  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  if (await page.locator("#login-email").count()) {
    await page.fill("#login-email", credentials.email);
    await page.fill("#login-password", credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1800);
  }
  check("sessão autenticada no navegador", (await page.locator("#login-email").count()) === 0);

  const rotaLista = `/consultas/clientes/${clienteA.id}/producao`;
  const rotaDetalheA1 = `${rotaLista}/${opA1.id}`;

  // ═══════════════════════════════════════════════════════════════════════
  // FLUXO PRINCIPAL — a aba mostra as ordens DESTE cliente, e só elas
  // ═══════════════════════════════════════════════════════════════════════
  // O recorte é a razão de a aba existir. Uma lista que mostrasse a produção
  // inteira sob o cabeçalho de um Cliente seria pior que não ter aba nenhuma:
  // quem olha confia no cabeçalho.
  await abrir(rotaLista);
  await esperarLista();

  const codigos = await codigosNaLista();
  check(
    "FLUXO · a aba lista as duas ordens do Cliente A",
    codigos.includes(opA1.code) && codigos.includes(opA2.code) && codigos.length === 2,
    `códigos=${JSON.stringify(codigos)}`,
  );

  /*
   * A ausência é verificada no TEXTO e no HTML.
   *
   * No texto porque é o que a pessoa lê; no HTML porque um filtro feito só no
   * CSS — linha renderizada e escondida — passaria na primeira prova e
   * continuaria vazando o dado para qualquer um que abrisse o inspetor ou
   * lesse a resposta da rede.
   */
  const listaServida = await textoEHtml();
  check(
    "FLUXO · a OP do Cliente B não aparece no texto da página",
    !listaServida.texto.includes(opB1.code),
    opB1.code,
  );
  check(
    "FLUXO · a OP do Cliente B também não está no HTML servido",
    !listaServida.html.includes(opB1.code) && !listaServida.html.includes(opB1.id),
    `${opB1.code} / ${opB1.id}`,
  );
  check(
    "FLUXO · o produto do Cliente B não vaza junto",
    !listaServida.html.includes(produtoB.code),
    produtoB.code,
  );

  const linhaA1 = await linhaDaLista(opA1.code);
  check(
    "FLUXO · a linha da OP-A1 mostra planejado e produzido, e o produzido é a soma do apontamento",
    Boolean(linhaA1) &&
      linhaA1[3].startsWith("100") &&
      linhaA1[4].startsWith("40"),
    JSON.stringify(linhaA1),
  );
  check(
    "FLUXO · a linha da OP-A1 traz o Pedido de origem",
    Boolean(linhaA1) && linhaA1[2] === pedidoA.code,
    JSON.stringify(linhaA1),
  );
  const linhaA2 = await linhaDaLista(opA2.code);
  check(
    "FLUXO · a linha da OP-A2 mostra a situação Concluída",
    Boolean(linhaA2) && linhaA2[5].toLowerCase().includes("conclu"),
    JSON.stringify(linhaA2),
  );
  check(
    "FLUXO · o rodapé da tabela conta 2 ordens",
    (await page.locator(".consult-body .table-foot").innerText()).trim() === "2 ordens",
    (await page.locator(".consult-body .table-foot").innerText()).trim(),
  );
  await shot("55-01-fluxo-lista-de-producao-do-cliente-a");

  // ═══════════════════════════════════════════════════════════════════════
  // POSIÇÃO DA ABA — entre Pedidos e Estoque
  // ═══════════════════════════════════════════════════════════════════════
  // A ordem das abas é a ordem em que se pergunta: o que foi pedido, o que
  // está sendo feito, o que existe. Produção depois de Estoque contaria a
  // história ao contrário — e a posição é a única coisa da navegação que um
  // teste unitário de rota não observa.
  const abas = await page.evaluate(() =>
    [...document.querySelectorAll(".consult-tabs__link")].map((a) => ({
      rotulo: (a.textContent ?? "").trim(),
      href: a.getAttribute("href"),
      ativa: a.className.includes("is-active"),
    })),
  );
  const rotulos = abas.map((a) => a.rotulo);
  const iPedidos = rotulos.indexOf("Pedidos");
  const iProducao = rotulos.indexOf("Produção");
  const iEstoque = rotulos.indexOf("Estoque");
  check(
    "ABA · Produção fica entre Pedidos e Estoque na navegação do shell",
    iPedidos >= 0 && iProducao === iPedidos + 1 && iEstoque === iProducao + 1,
    `abas=${JSON.stringify(rotulos)}`,
  );
  check(
    "ABA · estando na lista, a aba Produção é a marcada como ativa",
    abas[iProducao]?.ativa === true && abas[iProducao]?.href?.endsWith("/producao") === true,
    JSON.stringify(abas[iProducao] ?? null),
  );
  await shot("55-02-posicao-da-aba-entre-pedidos-e-estoque");

  // ═══════════════════════════════════════════════════════════════════════
  // DETALHE — consultivo, dentro do cliente, sem ação operacional
  // ═══════════════════════════════════════════════════════════════════════
  // A promessa é dupla: o assunto não troca (o Cliente continua no
  // cabeçalho) e a tela não OPERA. Abrir a ordem pela linha, e não pela URL,
  // é de propósito: é o caminho que a pessoa percorre.
  await page.locator(`.consult-body table tbody tr:has(td:text-is("${opA1.code}"))`).first().click();
  check(
    "DETALHE · clicar na linha leva ao detalhe DENTRO da consulta",
    await esperarUrl((u) => u.pathname === rotaDetalheA1),
    caminhoAtual(),
  );
  await esperarDetalhe();

  const cabecalhoNoDetalhe = await clienteNaTela();
  check(
    "DETALHE · o shell continua no Cliente A — o assunto não trocou",
    cabecalhoNoDetalhe.presente &&
      cabecalhoNoDetalhe.titulo === clienteA.legalName &&
      cabecalhoNoDetalhe.codigo === clienteA.code,
    JSON.stringify(cabecalhoNoDetalhe),
  );

  const trilhaDetalhe = await trilha();
  check(
    "DETALHE · a trilha mostra Cliente › Produção › código da OP",
    trilhaDetalhe.includes(clienteA.tradeName) &&
      trilhaDetalhe.includes("Produção") &&
      trilhaDetalhe.endsWith(opA1.code),
    `trilha="${trilhaDetalhe}"`,
  );

  const planejada = await fato("Planejada");
  const produzida = await fato("Produzida");
  const saldo = await fato("Saldo");
  check(
    "DETALHE · os fatos aparecem: planejado 100, produzido 40, saldo 60",
    planejada?.startsWith("100") && produzida?.startsWith("40") && saldo?.startsWith("60"),
    JSON.stringify({ planejada, produzida, saldo }),
  );
  check(
    "DETALHE · o saldo é derivado, não recalculado na tela: 100 − 40 = 60 na unidade do item",
    saldo === `60 ${opA1.outputUnitCode}`,
    `saldo="${saldo}" unidade="${opA1.outputUnitCode}"`,
  );

  /*
   * A prova de que a tela não OPERA.
   *
   * Duas leituras, porque uma sozinha é frágil: nenhum `<button>` no corpo
   * (ação operacional no Veridi é sempre botão — liberar, apontar, consumir,
   * cancelar, editar), e nenhum texto clicável com verbo de operação. A
   * segunda pega o caso em que a ação viesse disfarçada de link.
   */
  const interativos = await interativosDoCorpo();
  const botoes = interativos.filter((el) => el.tag === "button" || el.tag === "input");
  const VERBOS = /\b(liberar|libera|apontar|apontamento|consumir|consumo|cancelar|editar|excluir|planejar|salvar|estornar|reservar|iniciar|concluir)\b/i;
  const comVerbo = interativos.filter((el) => VERBOS.test(el.texto));
  check(
    "DETALHE · nenhum botão de ação no corpo consultivo",
    botoes.length === 0,
    JSON.stringify(botoes),
  );
  check(
    "DETALHE · nenhum clicável com verbo operacional (liberar, apontar, consumir, cancelar, editar)",
    comVerbo.length === 0,
    JSON.stringify(comVerbo),
  );

  /*
   * A saída para fora da Consulta é UMA, e é explícita.
   *
   * Todo link do corpo tem que apontar para dentro de `/consultas/clientes`
   * — a raiz da busca inclusive, que é a trilha —, com uma única exceção
   * nomeada. É essa contagem que impede que um clique comum troque de assunto
   * sem avisar.
   */
  const dentroDaConsulta = (href) =>
    href === "/consultas/clientes" || href.startsWith(`/consultas/clientes/${clienteA.id}/`);
  const externos = interativos
    .filter((el) => el.href && el.href.startsWith("/"))
    .filter((el) => !dentroDaConsulta(el.href));
  check(
    "DETALHE · existe exatamente UMA saída para fora da Consulta, e é a OP completa",
    externos.length === 1 &&
      externos[0].href === `/producao/ordens/${opA1.id}` &&
      externos[0].texto.includes("Abrir OP completa"),
    JSON.stringify(externos),
  );
  anotar(
    `DETALHE · clicáveis no corpo: ${interativos
      .map((el) => `${el.tag}"${el.texto || "—"}"`)
      .join(", ")}`,
  );
  await shot("55-03-detalhe-consultivo-da-op-a1");

  // ═══════════════════════════════════════════════════════════════════════
  // LINK DE PRODUTO — para dentro da Consulta, não para o cadastro
  // ═══════════════════════════════════════════════════════════════════════
  // O produto desta ordem é, por construção, deste Cliente. Mandar o clique
  // para `/cadastros/produtos/:id` trocaria o assunto e perderia o
  // cabeçalho — que é exatamente o que a Consulta existe para não fazer.
  await page.locator(`.consult-body .definition-list a:has-text("${produtoA.code}")`).first().click();
  const chegouNoProduto = await esperarUrl(
    (u) => u.pathname === `/consultas/clientes/${clienteA.id}/produtos/${produtoA.id}`,
  );
  await page.waitForTimeout(900);
  check(
    "PRODUTO · o link do produto vai para /consultas/clientes/<A>/produtos/<id>",
    chegouNoProduto,
    caminhoAtual(),
  );
  check(
    "PRODUTO · não foi para o módulo operacional (/cadastros/produtos/…)",
    !caminhoAtual().startsWith("/cadastros/"),
    caminhoAtual(),
  );
  const cabecalhoNoProduto = await clienteNaTela();
  check(
    "PRODUTO · o cabeçalho do Cliente A continua na tela",
    cabecalhoNoProduto.titulo === clienteA.legalName,
    JSON.stringify(cabecalhoNoProduto),
  );
  await shot("55-04-link-de-produto-dentro-da-consulta");

  // ═══════════════════════════════════════════════════════════════════════
  // LINK DE PEDIDO — mesmo mecanismo, outro destino
  // ═══════════════════════════════════════════════════════════════════════
  await abrir(rotaDetalheA1);
  await esperarDetalhe();
  await page.locator(`.consult-body .definition-list a:has-text("${pedidoA.code}")`).first().click();
  const chegouNoPedido = await esperarUrl(
    (u) => u.pathname === `/consultas/clientes/${clienteA.id}/pedidos/${pedidoA.id}`,
  );
  await page.waitForTimeout(900);
  check(
    "PEDIDO · o link do pedido de origem vai para /consultas/clientes/<A>/pedidos/<id>",
    chegouNoPedido,
    caminhoAtual(),
  );
  check(
    "PEDIDO · não foi para o módulo operacional (/comercial/pedidos/…)",
    !caminhoAtual().startsWith("/comercial/"),
    caminhoAtual(),
  );
  await shot("55-05-link-de-pedido-dentro-da-consulta");

  // ═══════════════════════════════════════════════════════════════════════
  // VOLTA PELA TRILHA — "Produção" volta para as ordens DESTE cliente
  // ═══════════════════════════════════════════════════════════════════════
  // A trilha da Consulta não é a hierarquia canônica da tela: ela é
  // contextual. "Produção" aqui tem que devolver a lista do Cliente A, e não
  // a lista global de ordens de produção.
  await abrir(rotaDetalheA1);
  await esperarDetalhe();
  await page.locator('.consult-trail a:has-text("Produção")').first().click();
  const voltouParaLista = await esperarUrl((u) => u.pathname === rotaLista);
  await esperarLista();
  const codigosDepoisDaVolta = await codigosNaLista();
  check(
    "TRILHA · clicar em Produção volta para a lista das ordens do Cliente A",
    voltouParaLista &&
      codigosDepoisDaVolta.includes(opA1.code) &&
      codigosDepoisDaVolta.includes(opA2.code) &&
      codigosDepoisDaVolta.length === 2,
    `${caminhoAtual()} · ${JSON.stringify(codigosDepoisDaVolta)}`,
  );
  await shot("55-06-volta-pela-trilha-para-a-lista");

  // ═══════════════════════════════════════════════════════════════════════
  // ABRIR OP COMPLETA — a saída explícita, para fora do shell
  // ═══════════════════════════════════════════════════════════════════════
  // Consultar e operar são lugares diferentes de propósito. A saída existe
  // porque quem precisa liberar a ordem precisa ir a algum lugar — e o que
  // prova que ela é SAÍDA é o shell da Consulta desaparecer do outro lado.
  await abrir(rotaDetalheA1);
  await esperarDetalhe();
  await page.locator('.consult-body a:has-text("Abrir OP completa")').first().click();
  const chegouNaOpCompleta = await esperarUrl(
    (u) => u.pathname === `/producao/ordens/${opA1.id}`,
    30000,
  );
  await page.waitForTimeout(2500);
  check(
    "OP COMPLETA · o link leva a /producao/ordens/<id>",
    chegouNaOpCompleta,
    caminhoAtual(),
  );
  const foraDoShell = await page.evaluate(() => ({
    shell: document.querySelectorAll(".consult-head").length,
    abas: document.querySelectorAll(".consult-tabs").length,
  }));
  check(
    "OP COMPLETA · do outro lado não há mais shell de Consulta — é o módulo operacional",
    foraDoShell.shell === 0 && foraDoShell.abas === 0,
    JSON.stringify(foraDoShell),
  );
  const textoDaOpCompleta = (await textoEHtml()).texto;
  check(
    "OP COMPLETA · a tela operacional é a da MESMA ordem",
    textoDaOpCompleta.includes(opA1.code),
    opA1.code,
  );
  await shot("55-07-abrir-op-completa-fora-do-shell");

  // ═══════════════════════════════════════════════════════════════════════
  // CRUZADO — a OP do outro cliente sob o cabeçalho deste
  // ═══════════════════════════════════════════════════════════════════════
  // O endereço é bem formado e a ordem existe: só não é deste Cliente. A
  // resposta certa é 404 CONTEXTUAL — dentro do shell, com a volta para a
  // lista a um clique. Um erro genérico perderia o contexto justamente onde
  // ele mais importa; mostrar os dados vazaria o que o escopo protege.
  // Marca no registro global de respostas com erro: o que vier depois desta
  // linha e antes da próxima leitura foi produzido POR esta navegação.
  const marcaCruzado = respostasComErro.length;
  await abrir(`/consultas/clientes/${clienteA.id}/producao/${opB1.id}`);
  await page.waitForSelector(".consult-body .page__title", { timeout: 30000 });
  await page.waitForTimeout(700);
  const respostasCruzadas = respostasComErro.slice(marcaCruzado);

  const tituloCruzado = (
    await page.locator(".consult-body .page__title").first().innerText()
  ).trim();
  check(
    "CRUZADO · a mensagem é a da Consulta: 'Ordem de produção não encontrada neste cliente'",
    tituloCruzado === "Ordem de produção não encontrada neste cliente",
    `título="${tituloCruzado}"`,
  );
  const cabecalhoCruzado = await clienteNaTela();
  check(
    "CRUZADO · o 404 é contextual — o shell do Cliente A continua de pé",
    cabecalhoCruzado.presente && cabecalhoCruzado.titulo === clienteA.legalName,
    JSON.stringify(cabecalhoCruzado),
  );
  const trilhaCruzada = await trilha();
  check(
    "CRUZADO · a trilha continua oferecendo a volta para Produção",
    trilhaCruzada.includes("Produção") &&
      (await page.locator('.consult-body a:has-text("Voltar para Produção")').count()) === 1,
    `trilha="${trilhaCruzada}"`,
  );
  const cruzadoServido = await textoEHtml();
  /*
   * Nem código, nem produto, nem quantidade.
   *
   * A quantidade é conferida como "40 un" — o par número+unidade que a tela
   * imprimiria — e não como "40" solto: o código do cliente, o CNPJ e as
   * datas do cabeçalho carregam dígitos que fariam a prova acusar vazamento
   * onde não há nenhum.
   */
  check(
    "CRUZADO · nenhum dado da OP-B1 chega à tela",
    !cruzadoServido.html.includes(opB1.code) &&
      !cruzadoServido.html.includes(produtoB.code) &&
      !cruzadoServido.texto.includes(`40 ${opB1.outputUnitCode}`),
    `${opB1.code} / ${produtoB.code} / "40 ${opB1.outputUnitCode}"`,
  );
  // Lista vazia aqui significaria que a API respondeu 200 — ou seja, entregou
  // a ordem do outro Cliente. Por isso a prova exige que HAJA 404, e que só
  // haja 404 no endereço escopado.
  check(
    "CRUZADO · a API respondeu 404, e não 200 com o registro do outro cliente",
    respostasCruzadas.length > 0 &&
      respostasCruzadas.every(
        (r) =>
          r.status === 404 &&
          r.pathname ===
            `/customers/${clienteA.id}/consultation/production-orders/${opB1.id}`,
      ),
    JSON.stringify(respostasCruzadas),
  );
  await shot("55-08-cruzado-404-contextual");

  // ═══════════════════════════════════════════════════════════════════════
  // RESUMO — o contador e o caminho de volta para a aba
  // ═══════════════════════════════════════════════════════════════════════
  // Contador que não bate com a lista é pior que contador nenhum: quem lê
  // "3" e encontra 2 passa a desconfiar da tela inteira. E o cartão só serve
  // se levar a algum lugar.
  await abrir(`/consultas/clientes/${clienteA.id}/resumo`);
  await page.waitForSelector(".consult-counter", { timeout: 30000 });
  await page.waitForTimeout(500);

  const cartoes = await page.evaluate(() =>
    [...document.querySelectorAll(".consult-counter")].map((a) => ({
      rotulo: (a.querySelector(".consult-counter__label")?.textContent ?? "").trim(),
      valor: (a.querySelector(".consult-counter__value")?.textContent ?? "").trim(),
      href: a.getAttribute("href"),
      aria: a.getAttribute("aria-label"),
    })),
  );
  const cartaoProducao = cartoes.find((c) => c.rotulo === "Produção");
  const cartaoAberto = cartoes.find((c) => c.rotulo === "Produção em aberto");
  check(
    "RESUMO · o cartão de Produção existe e conta as 2 ordens do cliente",
    cartaoProducao?.valor === "2",
    JSON.stringify(cartaoProducao ?? cartoes.map((c) => c.rotulo)),
  );
  check(
    "RESUMO · o cartão de Produção em aberto conta 1 — a concluída não é aberta",
    cartaoAberto?.valor === "1",
    JSON.stringify(cartaoAberto ?? null),
  );
  check(
    "RESUMO · o nome acessível do cartão diz rótulo e número juntos",
    cartaoProducao?.aria === "Produção: 2",
    `aria-label="${cartaoProducao?.aria ?? ""}"`,
  );
  await shot("55-09-resumo-com-os-contadores-de-producao");

  // Clique pelo ÍNDICE do cartão, e não por texto: "Produção" também é o
  // começo de "Produção em aberto", e um seletor por texto acertaria o cartão
  // errado — que leva ao mesmo lugar e faria a prova passar sem provar nada.
  await page.locator(".consult-counter").nth(cartoes.indexOf(cartaoProducao)).click();
  const cartaoLevouParaAba = await esperarUrl((u) => u.pathname === rotaLista);
  await esperarLista();
  check(
    "RESUMO · o cartão é clicável e leva para a aba Produção",
    cartaoLevouParaAba && (await codigosNaLista()).length === 2,
    caminhoAtual(),
  );
  await shot("55-10-resumo-cartao-leva-para-a-aba");

  // ═══════════════════════════════════════════════════════════════════════
  // ESTADO VAZIO — o caso COMUM, não a exceção
  // ═══════════════════════════════════════════════════════════════════════
  // 78 das 108 ordens do banco não têm cliente. Para a maioria dos clientes
  // esta aba estará vazia ESTANDO CORRETA — e uma aba vazia sem explicação
  // parece defeito. Por isso o vazio é verificado com o mesmo rigor do
  // fluxo principal: sem alerta de erro e com o recorte explicado.
  await abrir(`/consultas/clientes/${clienteVazio.id}/producao`);
  await esperarLista();
  const vazio = await page.evaluate(() => ({
    celulaVazia: (document.querySelector(".consult-body .table__empty")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    linhas: document.querySelectorAll(".consult-body table tbody tr").length,
    alertas: document.querySelectorAll(".consult-body .form-alert").length,
    rodape: (document.querySelector(".consult-body .table-foot")?.textContent ?? "").trim(),
  }));
  check(
    "VAZIO · a aba mostra a mensagem de vazio, e ela explica o recorte",
    vazio.celulaVazia.includes("Nenhuma ordem de produção encontrada para este cliente") &&
      vazio.celulaVazia.includes("para o próprio estoque não tem cliente"),
    JSON.stringify(vazio),
  );
  check(
    "VAZIO · nenhum alerta de erro, e o rodapé conta 0",
    vazio.alertas === 0 && vazio.rodape === "0 ordens" && vazio.linhas === 1,
    JSON.stringify(vazio),
  );
  const cabecalhoVazio = await clienteNaTela();
  check(
    "VAZIO · o cartão do cliente continua inteiro — o vazio é da lista, não da tela",
    cabecalhoVazio.presente && cabecalhoVazio.titulo === clienteVazio.legalName,
    JSON.stringify(cabecalhoVazio),
  );
  await shot("55-11-estado-vazio-explicado");

  await abrir(`/consultas/clientes/${clienteVazio.id}/resumo`);
  await page.waitForSelector(".consult-counter", { timeout: 30000 });
  const vazioResumo = await page.evaluate(() => {
    const cartao = [...document.querySelectorAll(".consult-counter")].find(
      (a) => (a.querySelector(".consult-counter__label")?.textContent ?? "").trim() === "Produção",
    );
    return (cartao?.querySelector(".consult-counter__value")?.textContent ?? "").trim();
  });
  check(
    "VAZIO · o Resumo do cliente sem ordem nenhuma mostra 0, e não some com o cartão",
    vazioResumo === "0",
    `valor="${vazioResumo}"`,
  );
  await shot("55-12-estado-vazio-no-resumo");

  // ═══════════════════════════════════════════════════════════════════════
  // TRÊS VIEWPORTS — a PÁGINA não rola na horizontal
  // ═══════════════════════════════════════════════════════════════════════
  // A rolagem horizontal da página leva junto o cabeçalho do Cliente, as abas
  // e a trilha — some do lugar exatamente o que dá contexto. Rolagem LOCAL da
  // tabela é outra coisa: é o recurso desenhado para tabela larga, e fica
  // registrada como medida.
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    for (const tela of [
      { rotulo: "lista", rota: rotaLista, esperar: esperarLista },
      { rotulo: "detalhe", rota: rotaDetalheA1, esperar: esperarDetalhe },
    ]) {
      await abrir(tela.rota);
      await tela.esperar();
      const medida = await medirLargura();
      check(
        `VP · ${vp.width}×${vp.height} · ${tela.rotulo} — a página não rola na horizontal`,
        medida.pagina.scrollWidth <= medida.pagina.clientWidth,
        `scrollWidth=${medida.pagina.scrollWidth} clientWidth=${medida.pagina.clientWidth} ` +
          `sobra=${medida.pagina.scrollWidth - medida.pagina.clientWidth}px`,
      );
      anotar(
        `VP · ${vp.width}×${vp.height} · ${tela.rotulo} — rolagem local da tabela: ` +
          (medida.tabela
            ? `scrollWidth=${medida.tabela.scrollWidth} clientWidth=${medida.tabela.clientWidth} ` +
              `sobra=${medida.tabela.scrollWidth - medida.tabela.clientWidth}px`
            : "sem .table-container nesta tela"),
      );
      await shot(`55-vp-${vp.width}-${tela.rotulo}`);
    }
  }
  await page.setViewportSize(VIEWPORTS[1]);

  // ═══════════════════════════════════════════════════════════════════════
  // Console — zero erro na execução inteira
  // ═══════════════════════════════════════════════════════════════════════
  // Medido no fim de propósito: a promessa é sobre a execução toda, e uma aba
  // nova dentro de um shell existente falha primeiro no console.
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
   * causou não. Se aparecer aqui qualquer coisa que não seja o 404 escopado
   * do teste cruzado — asset que não existe, endpoint que quebrou, sessão
   * que caiu —, esta verificação reprova.
   */
  const esperado404 = `/customers/${clienteA.id}/consultation/production-orders/${opB1.id}`;
  const inesperadas = respostasComErro.filter(
    (r) => !(r.status === 404 && r.pathname === esperado404),
  );
  check(
    "REDE · a única resposta de erro da execução inteira é o 404 deliberado do teste cruzado",
    inesperadas.length === 0,
    JSON.stringify(inesperadas.slice(0, 6)),
  );
  anotar(
    `rede · ${respostasComErro.length} resposta(s) >= 400 na execução, ` +
      `${respostasComErro.length - inesperadas.length} delas o 404 escopado provocado pelo teste; ` +
      `${avisosDeRede.length} aviso(s) "Failed to load resource" do navegador (não são console.error da aplicação)`,
  );
} finally {
  if (browser) await browser.close();
  /*
   * A limpeza roda SEMPRE.
   *
   * Uma parada no meio deixaria três clientes, dois produtos, um pedido e
   * três ordens sintéticas na base — aparecendo nas buscas de quem usar o
   * ambiente depois, e contaminando a próxima medição de "quantas ordens têm
   * cliente". O que sobrar, se sobrar, é dito no relatório.
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
  console.log("\nvalidate55: todas as verificações passaram.");
}
