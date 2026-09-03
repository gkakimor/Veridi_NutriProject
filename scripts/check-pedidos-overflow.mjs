import { chromium } from "@playwright/test";

/**
 * A tabela de Pedidos cabe na tela?
 *
 * A auditoria mediu `scrollWidth 1296` contra `clientWidth 1138` a 1440px:
 * ~158px cortados, e a coluna Status entre eles. Perguntar ao CSS se a regra
 * foi aplicada não responde nada — a pergunta é se o Status está dentro da
 * área visível, e isso só se sabe medindo a caixa dele contra a do container.
 */

const WEB = "http://127.0.0.1:5173";

const API = "http://127.0.0.1:3333";

// O formulário de login não redireciona sob headless neste ambiente; as
// suítes adversariais já resolvem assim, autenticando pela API e injetando o
// cookie no contexto. O que se mede aqui é a tabela, não o login.
const resposta = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@veridi.local", password: "veridi-local-dev" }),
});
if (!resposta.ok) throw new Error(`login → ${resposta.status}`);
const cookie = resposta.headers.get("set-cookie")?.split(";")[0] ?? "";
const corte = cookie.indexOf("=");

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
await contexto.addCookies([
  {
    name: cookie.slice(0, corte),
    value: cookie.slice(corte + 1),
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  },
]);
const pagina = await contexto.newPage();

await pagina.goto(`${WEB}/comercial/pedidos`);
await pagina.waitForSelector("table tbody tr", { timeout: 20000 });

const medida = await pagina.evaluate(() => {
  const container = document.querySelector(".table-container");
  const tabela = container?.querySelector("table");
  if (!container || !tabela) return null;

  const cabecalhos = [...tabela.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
  const indiceStatus = cabecalhos.indexOf("Status");
  const primeiraLinha = tabela.querySelector("tbody tr");
  const celulaStatus = primeiraLinha?.querySelectorAll("td")[indiceStatus] ?? null;

  const caixaContainer = container.getBoundingClientRect();
  const caixaStatus = celulaStatus?.getBoundingClientRect() ?? null;

  return {
    scrollWidth: container.scrollWidth,
    clientWidth: container.clientWidth,
    cortado: container.scrollWidth - container.clientWidth,
    statusVisivel: caixaStatus ? caixaStatus.right <= caixaContainer.right + 1 : null,
    statusTexto: celulaStatus?.textContent?.trim() ?? null,
  };
});

if (!medida) {
  console.log("tabela de Pedidos não encontrada");
  await navegador.close();
  process.exit(1);
}

console.log(`container: scrollWidth ${medida.scrollWidth} · clientWidth ${medida.clientWidth}`);
console.log(`cortado: ${medida.cortado}px`);
console.log(`coluna Status ("${medida.statusTexto}") dentro da área visível: ${medida.statusVisivel}`);

await navegador.close();
process.exit(medida.cortado <= 0 && medida.statusVisivel ? 0 : 1);
