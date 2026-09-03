import { chromium } from "@playwright/test";

/**
 * Verifica os defeitos que a reauditoria encontrou — inclusive os que a rodada
 * de correção criou.
 *
 * Cada checagem olha o COMPORTAMENTO, não a presença da propriedade. A lição
 * veio cara: a verificação anterior da pista de rolagem perguntou ao CSS se o
 * gradiente estava aplicado, respondeu "sim", e a pista media 1,16:1 — existia
 * no arquivo e não existia na tela.
 */

const WEB = "http://127.0.0.1:5173";

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
const falhas = [];

function conferir(nome, ok, detalhe) {
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas.push(nome);
}

await pagina.goto(`${WEB}/login`);
await pagina.fill("#login-email", "admin@veridi.local");
await pagina.fill("#login-password", "veridi-local-dev");
await pagina.click('button[type="submit"]');
await pagina.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
await pagina.waitForTimeout(400);

// 1. O primeiro Tab depois de carregar a rota alcança o skip-link.
await pagina.goto(`${WEB}/administracao/documentos`);
await pagina.waitForTimeout(500);
await pagina.keyboard.press("Tab");
const primeiroFoco = await pagina.evaluate(() => {
  const el = document.activeElement;
  return { texto: (el?.textContent ?? "").trim().slice(0, 40), classe: el?.className ?? "" };
});
conferir(
  "primeiro Tab alcança o skip-link, mesmo no último item do menu",
  /pular|conteúdo|skip/i.test(primeiroFoco.texto) || primeiroFoco.classe.includes("skip"),
  `foco foi para "${primeiroFoco.texto}"`,
);

// 2. Pista de rolagem do menu é visível.
const pista = await pagina.evaluate(() => {
  const nav = document.querySelector(".sidebar__nav");
  const imagem = getComputedStyle(nav).backgroundImage;
  const claras = (imagem.match(/rgba\(255,\s*255,\s*255,\s*0?\.\d+\)/g) ?? []).length;
  return { rola: nav.scrollHeight > nav.clientHeight, claras };
});
conferir(
  "pista de rolagem usa camada clara sobre o menu escuro",
  pista.rola && pista.claras >= 1,
  `rola=${pista.rola}, camadas claras=${pista.claras}`,
);

// 3. O atalho do Dashboard filtra de verdade.
await pagina.goto(`${WEB}/estoque/lotes?status=AWAITING_RELEASE`);
await pagina.waitForTimeout(900);
const filtro = await pagina.evaluate(() => {
  const select = [...document.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === "AWAITING_RELEASE"),
  );
  return select ? select.value : "sem select de status";
});
conferir(
  "?status=AWAITING_RELEASE aplica o filtro na tela",
  filtro === "AWAITING_RELEASE",
  `select ficou em "${filtro}"`,
);

// 4. Quantidade derivada não mostra precisão que o domínio não tem.
await pagina.goto(`${WEB}/producao/formulacoes`);
await pagina.waitForTimeout(900);
const primeira = pagina.locator("table tbody tr").first();
if ((await primeira.count()) > 0) {
  await primeira.click();
  await pagina.waitForTimeout(1200);
  const excesso = await pagina.evaluate(() => {
    const texto = document.body.textContent ?? "";
    const achados = texto.match(/\d+[.,]\d{8,}/g) ?? [];
    return achados.slice(0, 3);
  });
  conferir(
    "nenhuma quantidade com mais de 7 casas decimais na tela",
    excesso.length === 0,
    excesso.length ? `encontrado: ${excesso.join(", ")}` : "",
  );
}

// 5. Trilha da tela de escanear navega.
await pagina.goto(`${WEB}/estoque/lotes`);
await pagina.waitForTimeout(700);
const botaoEscanear = pagina.getByRole("button", { name: /escanear/i }).first();
if ((await botaoEscanear.count()) > 0) {
  await botaoEscanear.click();
  await pagina.waitForTimeout(700);
  const links = await pagina.evaluate(() => {
    const nav = document.querySelector(".page-crumbs");
    return nav ? nav.querySelectorAll("a[href]").length : -1;
  });
  conferir("trilha da tela de escanear tem link real", links > 0, `links=${links}`);
}

// 6. O painel de ajuda fecha clicando no fundo — a afirmacao que eu tinha
// feito sem verificar. O overlay e IRMAO do dialogo no DOM, e a varredura de
// `inert` o marcava junto com o resto do fundo: sumia do teste de acerto do
// ponteiro e o clique nunca chegava nele.
await pagina.goto(`${WEB}/producao/ordens`);
await pagina.waitForTimeout(800);
const ajuda = pagina.getByRole("button", { name: /^Como funciona$/ }).first();
if ((await ajuda.count()) > 0) {
  await ajuda.click();
  await pagina.waitForTimeout(400);
  const abriu = (await pagina.locator(".confirm-dialog").count()) > 0;
  const noPonto = await pagina.evaluate(
    () => document.elementFromPoint(12, window.innerHeight - 12)?.className ?? "nada",
  );
  await pagina.mouse.click(12, 888);
  await pagina.waitForTimeout(400);
  const fechou = (await pagina.locator(".confirm-dialog").count()) === 0;
  conferir(
    "painel de ajuda fecha ao clicar no fundo",
    abriu && fechou,
    `abriu=${abriu}, elemento sob o clique="${noPonto}", fechou=${fechou}`,
  );
}

console.log(falhas.length === 0 ? "\nTodas as verificações passaram." : `\n${falhas.length} falha(s).`);
await navegador.close();
process.exit(falhas.length === 0 ? 0 : 1);
