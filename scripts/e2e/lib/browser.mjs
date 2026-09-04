import { chromium } from "@playwright/test";

/**
 * Navegador autenticado, sem digitar senha em formulário.
 *
 * A sessão nasce de `POST /auth/login` e o cookie é injetado no contexto. Isso
 * evita depender da tela de login em toda suíte — se ela quebrar, o teste que
 * falha deve ser o da tela de login, não os vinte que só precisavam estar
 * autenticados para chegar ao que medem.
 *
 * `erros` acumula `console.error` e `pageerror`: console sujo é resultado, não
 * ruído, e uma suíte que não olha para ele aprova página quebrada.
 *
 *   const { pagina, erros, fechar } = await abrirNavegador();
 *   await pagina.goto(`${WEB}/producao/formulacoes`);
 *   ...
 *   await fechar();
 */

export const API = process.env.E2E_API ?? "http://127.0.0.1:3333";
export const WEB = process.env.E2E_WEB ?? "http://127.0.0.1:5173";

const CREDENCIAL = {
  email: process.env.E2E_EMAIL ?? "admin@veridi.local",
  password: process.env.E2E_PASSWORD ?? "veridi-local-dev",
};

/** Cookie de sessão a partir da API — serve para `fetch` e para o navegador. */
export async function autenticar() {
  const resposta = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CREDENCIAL),
  });
  if (!resposta.ok) throw new Error(`login → ${resposta.status}`);
  const cookie = resposta.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login não devolveu cookie de sessão");
  return cookie;
}

/**
 * Cliente HTTP autenticado.
 *
 * Corpo vazio com `Content-Type: application/json` o Fastify recusa: rotas que
 * não recebem payload ainda precisam de um objeto.
 */
export function clienteApi(cookie) {
  return async (caminho, init = {}) => {
    const resposta = await fetch(`${API}${caminho}`, {
      ...init,
      body: init.body ?? (init.method === "POST" ? "{}" : undefined),
      headers: { cookie, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    return { status: resposta.status, corpo: resposta.status < 400 ? await resposta.json() : null };
  };
}

export async function abrirNavegador({ largura = 1440, altura = 900 } = {}) {
  const cookie = await autenticar();
  const corte = cookie.indexOf("=");
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: largura, height: altura } });
  await contexto.addCookies([
    {
      name: cookie.slice(0, corte),
      value: cookie.slice(corte + 1),
      domain: new URL(WEB).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(`pageerror: ${String(e).slice(0, 200)}`));
  pagina.on("console", (m) => m.type() === "error" && erros.push(`console.error: ${m.text().slice(0, 200)}`));

  return {
    navegador,
    contexto,
    pagina,
    cookie,
    api: clienteApi(cookie),
    erros,
    fechar: () => navegador.close(),
  };
}
