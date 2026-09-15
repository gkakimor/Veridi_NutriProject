import { chromium } from "@playwright/test";
import { API, autenticar, clienteApi, exigirOrigemLocal } from "../fixtures/api.mjs";
import { FUSO_OPERACIONAL } from "../fixtures/datas.mjs";

/**
 * Navegador autenticado, sem digitar senha em formulário.
 *
 * A sessão nasce de `POST /auth/login` e o cookie é injetado no contexto. Isso
 * evita depender da tela de login em toda suíte — se ela quebrar, o teste que
 * falha deve ser o da tela de login, não os vinte que só precisavam estar
 * autenticados para chegar ao que medem.
 *
 * O navegador é o da operação: `timezoneId` America/Sao_Paulo (§72), `locale`
 * pt-BR e o Chromium em `--lang=pt-BR` — a máquina do laboratório não está em
 * São Paulo.
 *
 * `erros` acumula, de TODAS as abas do contexto:
 * - `console.error` e `pageerror` — console sujo é resultado, não ruído;
 * - resposta 4xx/5xx da API (reconhecida pela origem de `E2E_API`, não por uma
 *   porta fixa) que a suíte não declarou. Recusa provocada pelo próprio teste
 *   se declara antes de provocar:
 *
 *     const { esperarErroHttp } = await abrirNavegador();
 *     esperarErroHttp({ status: 409, metodo: "POST", caminho: /\/from-template$/ });
 *
 *   A linha "Failed to load resource" que o Chromium escreve para a mesma
 *   resposta não conta de novo: a resposta já foi julgada.
 *
 *   const { pagina, erros, fechar } = await abrirNavegador();
 *   await pagina.goto(`${WEB}/producao/formulacoes`);
 *   ...
 *   await fechar();
 */

export { API, autenticar, clienteApi };
export const WEB = process.env.E2E_WEB ?? "http://127.0.0.1:5173";

const FALHA_DE_RECURSO = /^Failed to load resource: the server responded with a status of (\d{3})/;

export async function abrirNavegador({
  largura = 1440,
  altura = 900,
  fuso = FUSO_OPERACIONAL,
  idioma = "pt-BR",
  errosHttpEsperados = [],
} = {}) {
  const origemApi = exigirOrigemLocal(API, "E2E_API");
  const origemWeb = exigirOrigemLocal(WEB, "E2E_WEB");
  const cookie = await autenticar();
  const corte = cookie.indexOf("=");
  const navegador = await chromium.launch({ args: [`--lang=${idioma}`] });
  const contexto = await navegador.newContext({
    viewport: { width: largura, height: altura },
    timezoneId: fuso,
    locale: idioma,
  });
  await contexto.addCookies([
    {
      name: cookie.slice(0, corte),
      value: cookie.slice(corte + 1),
      domain: new URL(origemWeb).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const erros = [];
  const esperados = [...errosHttpEsperados];
  /** Toda resposta ≥ 400 da API, esperada ou não — para o relatório da suíte. */
  const errosHttp = [];
  const foiDeclarado = ({ status, metodo, caminho }) =>
    esperados.some(
      (esperado) =>
        esperado.status === status &&
        (!esperado.metodo || esperado.metodo === metodo) &&
        (!esperado.caminho ||
          (typeof esperado.caminho === "string" ? esperado.caminho === caminho : esperado.caminho.test(caminho))),
    );

  contexto.on("response", (resposta) => {
    const url = new URL(resposta.url());
    if (url.origin !== origemApi || resposta.status() < 400) return;
    const registro = { status: resposta.status(), metodo: resposta.request().method(), caminho: url.pathname };
    const esperado = foiDeclarado(registro);
    errosHttp.push({ ...registro, esperado });
    if (!esperado) {
      erros.push(`http ${registro.status}${registro.status >= 500 ? " (5xx)" : ""} ${registro.metodo} ${registro.caminho}`);
    }
  });
  contexto.on("weberror", (erro) => erros.push(`pageerror: ${String(erro.error()).slice(0, 200)}`));
  contexto.on("console", (mensagem) => {
    if (mensagem.type() !== "error") return;
    const texto = mensagem.text();
    const recurso = mensagem.location()?.url ?? "";
    if (FALHA_DE_RECURSO.test(texto) && recurso.startsWith(`${origemApi}/`)) return;
    erros.push(`console.error: ${texto.slice(0, 200)}`);
  });

  const pagina = await contexto.newPage();

  return {
    navegador,
    contexto,
    pagina,
    cookie,
    api: clienteApi(cookie),
    erros,
    errosHttp,
    esperarErroHttp: (esperado) => esperados.push(esperado),
    fechar: () => navegador.close(),
  };
}
