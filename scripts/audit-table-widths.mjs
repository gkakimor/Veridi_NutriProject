import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * INVENTÁRIO DE LARGURA DE TABELAS — mede, não corrige.
 *
 * Por que este script existe: o diagnóstico de "tabela estourando" costuma ser
 * feito de olho, e olho não distingue os dois defeitos que se parecem na tela
 * mas têm causas diferentes:
 *
 *   1. ESTOURO GLOBAL  — a PÁGINA inteira rola na horizontal. Isto é sempre
 *      defeito: o cabeçalho, o menu e a paginação saem do lugar junto.
 *   2. ESTOURO LOCAL   — só a `.table-container` rola. Pode ser legítimo:
 *      uma tabela de 14 colunas de negócio não cabe em 1280px e rolar dentro
 *      da moldura é o comportamento correto.
 *
 * O script separa os dois, mede cada `<th>` em px e identifica a coluna de
 * Ações — o sintoma caçado aqui é "Nome 180px, Editar 220px", ou seja, a
 * coluna que não carrega informação ocupando mais espaço que a que carrega.
 *
 * Reexecutável: grava um JSON por rodada e aceita `--baseline` para comparar
 * antes/depois de uma correção.
 *
 * USO
 *   node scripts/audit-table-widths.mjs
 *   node scripts/audit-table-widths.mjs --out handoff/table-audit
 *   node scripts/audit-table-widths.mjs --baseline handoff/table-audit/antes.json
 *   node scripts/audit-table-widths.mjs --only /cadastros/clientes,/estoque/lotes
 *   node scripts/audit-table-widths.mjs --viewports 1280x720
 *
 * Requer API em 127.0.0.1:3333 e web em 127.0.0.1:5173 já no ar.
 */

const API = process.env.VERIDI_API ?? "http://127.0.0.1:3333";
const WEB = process.env.VERIDI_WEB ?? "http://127.0.0.1:5173";

// ── Argumentos ──────────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const OUT_DIR = arg("out", "handoff/table-audit");
const BASELINE = arg("baseline");
const ONLY = arg("only")?.split(",").map((s) => s.trim());
const VIEWPORTS = (arg("viewports") ?? "1280x720,1366x768,1600x900")
  .split(",")
  .map((v) => {
    const [width, height] = v.trim().split("x").map(Number);
    return { width, height, label: `${width}x${height}` };
  });

// ── Credencial de desenvolvimento ───────────────────────────────────────────
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
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Telas medidas. Os paths foram conferidos contra `apps/web/src/App.tsx` e
 * `apps/web/src/pages/customer-consultation/routes.tsx` — nenhum é inventado.
 *
 * `ready` é o seletor que prova que a listagem terminou de carregar; sem ele
 * mediríamos o esqueleto de loading, que tem largura de coluna diferente.
 */
const SCREENS = [
  { path: "/cadastros/clientes", label: "Cadastros › Clientes" },
  { path: "/cadastros/produtos", label: "Cadastros › Produtos" },
  { path: "/cadastros/itens", label: "Cadastros › Itens de estoque" },
  { path: "/cadastros/fornecedores", label: "Cadastros › Fornecedores" },
  // Pedido como `/cadastros/item-fornecedor`; a rota real é em Compras.
  { path: "/compras/item-fornecedor", label: "Compras › Item × Fornecedor" },
  { path: "/comercial/projetos", label: "Comercial › Projetos" },
  { path: "/comercial/pedidos", label: "Comercial › Pedidos" },
  { path: "/comercial/amostras", label: "Comercial › Amostras" },
  { path: "/comercial/expedicoes", label: "Comercial › Expedições" },
  { path: "/comercial/faturamento", label: "Comercial › Faturamento" },
  { path: "/compras/ordens", label: "Compras › Ordens de Compra" },
  { path: "/compras/recebimentos", label: "Compras › Recebimentos" },
  { path: "/producao/ordens", label: "Produção › Ordens" },
  { path: "/producao/picking", label: "Produção › Picking / Consumo" },
  { path: "/estoque", label: "Estoque › Posição" },
  { path: "/estoque/lotes", label: "Estoque › Lotes" },
  { path: "/estoque/movimentacoes", label: "Estoque › Movimentações" },
  { path: "/estoque/materiais-de-clientes", label: "Estoque › Materiais de Clientes" },
  { path: "/gestao/recursos-industriais", label: "Gestão › Recursos Industriais" },
  { path: "/administracao/usuarios", label: "Administração › Usuários" },
  { path: "/qualidade/documentos", label: "Qualidade › Documentos / CoA" },
  // Consulta do Cliente — `:customerId` resolvido em runtime (ver escolherCliente).
  { path: "/consultas/clientes/:id/resumo", label: "Consulta do Cliente › Resumo" },
  { path: "/consultas/clientes/:id/produtos", label: "Consulta do Cliente › Produtos" },
  { path: "/consultas/clientes/:id/pedidos", label: "Consulta do Cliente › Pedidos" },
];

/**
 * Tabela vazia não mede largura de coluna — o navegador distribui o espaço
 * pelo texto do cabeçalho e o número não diz nada sobre a tela real. Por isso
 * escolhemos o cliente COM MAIS DADOS em vez do primeiro da lista.
 */
async function escolherCliente() {
  const { customers } = await api("GET", "/customers?pageSize=25");
  let melhor = null;
  for (const c of customers ?? []) {
    let pontos = 0;
    for (const [rota, chave] of [
      ["/products", "products"],
      ["/customer-orders", "customerOrders"],
    ]) {
      try {
        const r = await api("GET", `${rota}?customerId=${c.id}&pageSize=5`);
        pontos += (r?.[chave] ?? []).length;
      } catch {
        /* rota sem esse filtro: ignora */
      }
    }
    if (!melhor || pontos > melhor.pontos) melhor = { id: c.id, code: c.code, nome: c.legalName, pontos };
    if (melhor.pontos >= 10) break;
  }
  return melhor;
}

// ── Medição, executada DENTRO da página ─────────────────────────────────────
/*
 * Tudo abaixo roda no browser. Vira string via page.evaluate, então não pode
 * referenciar nada do escopo do Node.
 */
function medirNaPagina() {
  const doc = document.documentElement;
  const larguraViewport = doc.clientWidth;

  /** Seletor legível para apontar o culpado num relatório. */
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return "?";
    if (el === document.body) return "body";
    if (el === doc) return "html";
    const cls = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((c) => `.${c}`)
      .join("");
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}`;
  };

  const px = (n) => Math.round(n * 10) / 10;

  // 1. ESTOURO GLOBAL — o defeito que não pode existir.
  const overflowGlobal = px(doc.scrollWidth - doc.clientWidth);

  // 2. ESTOURO LOCAL — rolagem dentro da moldura da tabela; pode ser legítima.
  const containers = [...document.querySelectorAll(".table-container")]
    .filter((c) => c.getBoundingClientRect().width > 0)
    .map((c) => ({
      seletor: sel(c),
      largura: px(c.clientWidth),
      conteudo: px(c.scrollWidth),
      overflow: px(c.scrollWidth - c.clientWidth),
      overflowX: getComputedStyle(c).overflowX,
    }));

  // 3 e 4. LARGURA DE CADA COLUNA e identificação da coluna de Ações.
  const tabelas = [];
  for (const table of document.querySelectorAll("table")) {
    const rect = table.getBoundingClientRect();
    if (rect.width === 0) continue;

    // Cabeçalho com mais células: tabelas com header agrupado têm 2 <tr>.
    const linhasHead = [...table.querySelectorAll("thead tr")];
    const head =
      linhasHead.sort((a, b) => b.children.length - a.children.length)[0] ??
      table.querySelector("tr");
    if (!head) continue;

    const ths = [...head.children];
    const corpo = [...table.querySelectorAll("tbody tr")].filter(
      (tr) => !tr.querySelector("td.table__empty"),
    );
    const vazia = corpo.length === 0;

    const colunas = ths.map((th, i) => {
      const r = th.getBoundingClientRect();
      const cs = getComputedStyle(th);
      return {
        indice: i,
        titulo: (th.textContent ?? "").trim() || (th.hasAttribute("aria-hidden") ? "(vazio)" : ""),
        largura: px(r.width),
        minWidth: cs.minWidth,
        width: cs.width,
        whiteSpace: cs.whiteSpace,
        classe: th.getAttribute("class") ?? "",
        styleInline: th.getAttribute("style") ?? "",
      };
    });

    /*
     * A coluna de Ações se identifica pela ESTRUTURA da célula, não pelo
     * título: na maioria das telas o <th> é vazio (`aria-hidden`). Ordem de
     * confiança: célula que contém .row-actions / botão → título "Ações" →
     * <th> vazio no fim de uma tabela com sticky-actions.
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
        (c) => /^(a[çc][õo]es|editar|a[çc][ãa]o)$/i.test(c.titulo) || /action/i.test(c.classe),
      );
    }
    if (idxAcoes < 0 && table.classList.contains("table--sticky-actions")) {
      const ultima = colunas[colunas.length - 1];
      if (ultima && (ultima.titulo === "" || ultima.titulo === "(vazio)")) idxAcoes = ultima.indice;
    }

    // Ranking: 1 = coluna mais larga da tabela. Prova o "Editar > Nome".
    const ordenadas = [...colunas].sort((a, b) => b.largura - a.largura);
    const acoes = idxAcoes >= 0 ? colunas[idxAcoes] : null;
    const posicao = acoes ? ordenadas.findIndex((c) => c.indice === acoes.indice) + 1 : null;
    const negocio = colunas.filter((c) => !acoes || c.indice !== acoes.indice);
    const maiorNegocio = negocio.sort((a, b) => b.largura - a.largura)[0] ?? null;

    /*
     * Quanto da coluna de Ações é BOTÃO e quanto é FOLGA.
     *
     * `table-layout: auto` + `width: 100%` distribui o espaço que sobra por
     * todas as colunas. Como a de Ações não tem teto, ela engorda junto — e é
     * por isso que o "Editar" fica maior justo nas telas que CABEM na tela.
     * Sem separar conteúdo de folga, o número da coluna não diz se o defeito
     * é o botão (conteúdo demais) ou o algoritmo (folga distribuída).
     */
    let folgaDasAcoes = null;
    if (acoes && corpo.length > 0) {
      const td = corpo[0].children[acoes.indice];
      if (td) {
        const cs = getComputedStyle(td);
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        /*
         * Range em vez do `.table__actions`: nem toda tela envolve os botões
         * num wrapper. Medir só o wrapper daria conteúdo 0 justamente nas
         * telas sem ele, e a folga sairia inflada.
         */
        const range = document.createRange();
        range.selectNodeContents(td);
        const conteudo = range.getBoundingClientRect().width;
        range.detach?.();
        folgaDasAcoes = {
          conteudo: px(conteudo),
          padding: px(pad),
          folga: px(acoes.largura - conteudo - pad),
          rotulos: [...td.querySelectorAll("button, a")]
            .map((b) => (b.textContent ?? "").trim())
            .filter(Boolean),
        };
      }
    }

    /*
     * `.table--sticky-actions` congela `:last-child`. Se a última coluna não
     * for a de Ações, a classe congela uma coluna de NEGÓCIO — e a tela perde
     * a ação de vista justamente quando a tabela rola.
     */
    const stickyErrada =
      table.classList.contains("table--sticky-actions") &&
      acoes !== null &&
      acoes.indice !== colunas.length - 1;
    const stickySemAcoes =
      table.classList.contains("table--sticky-actions") && acoes === null && !vazia;

    tabelas.push({
      seletor: sel(table),
      classe: table.getAttribute("class") ?? "",
      tableLayout: getComputedStyle(table).tableLayout,
      largura: px(rect.width),
      larguraContainer: px(table.parentElement?.clientWidth ?? 0),
      linhas: corpo.length,
      vazia,
      temColgroup: !!table.querySelector("colgroup"),
      colunas,
      stickyErrada,
      stickySemAcoes,
      acoes: acoes
        ? {
            titulo: acoes.titulo || "(vazio)",
            largura: acoes.largura,
            rankingLargura: posicao,
            totalColunas: colunas.length,
            maiorQueMaiorColunaDeNegocio: maiorNegocio ? acoes.largura > maiorNegocio.largura : null,
            // Quantas colunas de negócio são MENORES que a de Ações.
            colunasDeNegocioMenores: negocio.filter((c) => c.largura < acoes.largura).length,
            ...(folgaDasAcoes ?? {}),
          }
        : null,
      maiorColunaDeNegocio: maiorNegocio
        ? { titulo: maiorNegocio.titulo, largura: maiorNegocio.largura }
        : null,
    });
  }

  // 5. QUEM CAUSA O ESTOURO — só faz sentido perguntar quando há estouro global.
  let culpados = null;
  if (overflowGlobal > 1) {
    /*
     * Todo elemento cuja borda direita passa do viewport é suspeito. O que
     * interessa é o mais externo da cadeia: corrigir o filho mais profundo
     * só empurra o problema um nível acima.
     */
    const suspeitos = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > larguraViewport + 1 || r.width > larguraViewport + 1) {
        suspeitos.push({ el, right: r.right, width: r.width });
      }
    }
    suspeitos.sort((a, b) => b.right - a.right || b.width - a.width);
    const alvo = suspeitos[0];

    if (alvo) {
      // Sobe a cadeia registrando onde o filho passa da caixa do pai.
      const cadeia = [];
      let node = alvo.el;
      while (node && node !== document.body.parentElement) {
        const r = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        const pai = node.parentElement;
        const csPai = pai ? getComputedStyle(pai) : null;
        const displayPai = csPai?.display ?? "";
        const paiEhFlexOuGrid = /flex|grid/.test(displayPai);
        cadeia.push({
          seletor: sel(node),
          largura: px(r.width),
          scrollWidth: px(node.scrollWidth),
          larguraDoPai: pai ? px(pai.clientWidth) : null,
          // "Estoura o pai": é aqui que a largura nasce ou é propagada.
          estouraOPai: pai ? r.width > pai.clientWidth + 1 : false,
          minWidth: cs.minWidth,
          width: cs.width,
          overflowX: cs.overflowX,
          whiteSpace: cs.whiteSpace,
          flex: cs.flex,
          displayDoPai: displayPai,
          /*
           * A causa raiz clássica: item de flex/grid tem `min-width: auto`, que
           * o impede de encolher abaixo do próprio conteúdo. Sem `min-width: 0`
           * ele empurra o container e a página inteira rola.
           */
          filhoDeFlexSemMinWidthZero:
            paiEhFlexOuGrid && cs.minWidth !== "0px" && cs.minWidth !== "0%",
        });
        node = node.parentElement;
      }

      // O ancestral mais externo que ainda estoura o pai — onde a correção mora.
      const externo = [...cadeia].reverse().find((n) => n.estouraOPai) ?? cadeia[0];
      culpados = { origem: sel(alvo.el), larguraOrigem: px(alvo.width), principal: externo, cadeia };
    }
  }

  return {
    viewport: { largura: larguraViewport, altura: doc.clientHeight },
    overflowGlobal,
    conteudoDaPagina: px(doc.scrollWidth),
    containers,
    tabelas,
    culpados,
    tituloDaPagina: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 80),
  };
}

// ── Execução ────────────────────────────────────────────────────────────────
const resultados = [];
let browser;

try {
  await api("POST", "/auth/login", credentials);
  const cliente = await escolherCliente();
  console.log(`cliente da Consulta: ${cliente?.code} — ${cliente?.nome} (${cliente?.pontos} registros amostrados)\n`);

  const telas = SCREENS.map((s) => ({
    ...s,
    url: s.path.replace(":id", cliente?.id ?? ""),
  })).filter((s) => !ONLY || ONLY.some((p) => s.path.startsWith(p)));

  browser = await chromium.launch();
  const [nome, valor] = cookie.split("=");

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    // Sessão por cookie: mais rápido e mais estável que refazer o login na UI
    // 24 vezes. O cookie é de host (127.0.0.1), então vale para a porta do web.
    await context.addCookies([
      { name: nome, value: valor, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await context.newPage();

    // Se o cookie não pegou, cai para o login pela UI — o script não pode
    // medir a tela de login achando que mediu a listagem.
    await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    if (await page.locator("#login-email").count()) {
      await page.fill("#login-email", credentials.email);
      await page.fill("#login-password", credentials.password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(1500);
    }

    for (const tela of telas) {
      const url = `${WEB}${tela.url}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        // Espera a listagem: linha de dados OU estado vazio declarado.
        await page
          .waitForSelector("table tbody tr, .table__empty, .empty-state", { timeout: 12000 })
          .catch(() => {});
        await page.waitForTimeout(700); // assenta fontes e badges

        const m = await page.evaluate(medirNaPagina);
        const caiuNoLogin = (await page.locator("#login-email").count()) > 0;
        resultados.push({
          ...m,
          // Depois do spread: `viewport` do medidor é o objeto medido, e o
          // rótulo é a chave da comparação antes/depois. Não pode ser
          // sobrescrito, ou toda linha vira a mesma chave.
          tela: tela.label,
          path: tela.path,
          url: page.url().replace(WEB, ""),
          viewport: viewport.label,
          viewportMedido: m.viewport,
          autenticada: !caiuNoLogin,
        });

        const t = m.tabelas[0];
        const flagLocal = m.containers.find((c) => c.overflow > 1);
        console.log(
          [
            `${viewport.label}  ${tela.label.padEnd(38)}`,
            `global=${String(m.overflowGlobal).padStart(5)}px`,
            `local=${String(flagLocal?.overflow ?? 0).padStart(5)}px`,
            t
              ? `cols=${t.colunas.length} linhas=${t.linhas} acoes=${t.acoes?.largura ?? "-"}px(#${t.acoes?.rankingLargura ?? "-"})`
              : "sem tabela",
          ].join("  "),
        );
      } catch (e) {
        resultados.push({ tela: tela.label, path: tela.path, viewport: viewport.label, erro: String(e).slice(0, 200) });
        console.log(`${viewport.label}  ${tela.label.padEnd(38)}  ERRO  ${String(e).slice(0, 120)}`);
      }
    }
    await context.close();
  }
} finally {
  await browser?.close();
}

// ── Saída ───────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const arquivo = path.join(OUT_DIR, `table-widths-${carimbo}.json`);
fs.writeFileSync(arquivo, JSON.stringify({ geradoEm: new Date().toISOString(), viewports: VIEWPORTS, resultados }, null, 2));
console.log(`\nJSON: ${arquivo}`);

// Ranking do estouro global: a fila de correção, do pior para o melhor.
console.log("\n── Estouro global, do maior para o menor ──");
const piores = resultados
  .filter((r) => (r.overflowGlobal ?? 0) > 1)
  .sort((a, b) => b.overflowGlobal - a.overflowGlobal);
if (piores.length === 0) console.log("nenhum estouro global — a página não rola na horizontal em nenhum viewport");
for (const r of piores) {
  console.log(
    `${String(r.overflowGlobal).padStart(5)}px  ${r.viewport}  ${r.tela}  →  ${r.culpados?.principal?.seletor ?? "?"}`,
  );
}

// A coluna de Ações contra as colunas de negócio: o sintoma caçado.
console.log("\n── Coluna de Ações: quanto é botão, quanto é folga ──");
for (const r of resultados) {
  const t = r.tabelas?.[0];
  if (!t?.acoes || t.vazia) continue;
  console.log(
    `${r.viewport}  ${r.tela.padEnd(36)} ${String(t.acoes.largura).padStart(6)}px  #${t.acoes.rankingLargura}/${t.acoes.totalColunas}  ` +
      `botões=${t.acoes.conteudo ?? "?"}px folga=${t.acoes.folga ?? "?"}px  ` +
      `${t.acoes.colunasDeNegocioMenores} colunas de negócio menores  [${(t.acoes.rotulos ?? []).join(" | ")}]`,
  );
}

// Congelamento apontado para a coluna errada.
console.log("\n── table--sticky-actions congelando a coluna errada ──");
const sticky = resultados.filter((r) => r.tabelas?.some((t) => t.stickyErrada || t.stickySemAcoes));
if (sticky.length === 0) console.log("nenhuma");
for (const r of sticky) {
  for (const t of r.tabelas ?? []) {
    if (t.stickyErrada || t.stickySemAcoes) {
      console.log(
        `${r.viewport}  ${r.tela}  ${t.stickySemAcoes ? "tem a classe mas NÃO tem coluna de ações" : `ações no índice ${t.acoes.rankingLargura}, congelada é a última`} → congela "${t.colunas[t.colunas.length - 1].titulo}"`,
      );
    }
  }
}

// ── Comparação antes/depois ─────────────────────────────────────────────────
/*
 * A correção só está provada quando o mesmo número cai. Comparar por
 * (tela, viewport) evita concluir melhora porque outra tela entrou na lista.
 */
if (BASELINE) {
  const antes = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const chave = (r) => `${r.path}|${r.viewport}`;
  const mapa = new Map(antes.resultados.map((r) => [chave(r), r]));
  console.log(`\n── Comparação com ${BASELINE} ──`);
  for (const r of resultados) {
    const a = mapa.get(chave(r));
    if (!a) continue;
    const dg = (r.overflowGlobal ?? 0) - (a.overflowGlobal ?? 0);
    const acA = a.tabelas?.[0]?.acoes?.largura ?? null;
    const acD = r.tabelas?.[0]?.acoes?.largura ?? null;
    if (dg !== 0 || acA !== acD) {
      console.log(
        `${r.viewport}  ${r.tela.padEnd(38)}  global ${a.overflowGlobal ?? 0}→${r.overflowGlobal ?? 0} (${dg > 0 ? "+" : ""}${dg})  ações ${acA ?? "-"}→${acD ?? "-"}`,
      );
    }
  }
}
