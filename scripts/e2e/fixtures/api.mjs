/**
 * API das suítes E2E: sessão, cliente HTTP e a chamada que não aceita falha.
 *
 * Preparar massa por API é decisão do PO (E2E-BASELINE-REDESIGN-WAVE-01-02),
 * aceita quando TODAS valem: não é o comportamento sob teste; economiza muito
 * tempo; o contrato da rota já é coberto em teste de API; e não pula a
 * pré-condição que o cenário pretende provar. GET de conferência é livre.
 * Prisma e SQL direto continuam proibidos numa suíte.
 */

export const API = process.env.E2E_API ?? "http://127.0.0.1:3333";

/**
 * Origem de E2E só na própria máquina, em http e com porta: nenhuma suíte fala
 * com PROD, nem com outro host que por acaso responda. Devolve a origem.
 */
export function exigirOrigemLocal(valor, rotulo = "origem") {
  let url;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`RECUSADO: ${rotulo} "${valor}" não é URL.`);
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error(`RECUSADO: ${rotulo} ${url.origin} — E2E só roda em http://127.0.0.1.`);
  }
  if (url.username || url.password) throw new Error(`RECUSADO: ${rotulo} com credencial na URL.`);
  if (!/^\d+$/.test(url.port)) throw new Error(`RECUSADO: ${rotulo} ${url.origin} sem porta explícita.`);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`RECUSADO: ${rotulo} deve ser só a origem (${url.origin}), sem caminho.`);
  }
  return url.origin;
}

const SENSIVEL = /pass(word)?|senha|token|secret|cookie|authorization|hash/i;

/** Corpo de erro para mensagem: chave sensível redigida, tamanho contido. */
export function corpoSeguro(corpo, limite = 600) {
  if (corpo === null || corpo === undefined || corpo === "") return "(sem corpo)";
  const texto =
    typeof corpo === "string"
      ? corpo
      : JSON.stringify(corpo, (chave, valor) => (chave && SENSIVEL.test(chave) ? "[redigido]" : valor));
  return texto.length > limite ? `${texto.slice(0, limite)}…` : texto;
}

/** Rota para mensagem: valor de parâmetro sensível na consulta sai redigido. */
export function rotaSegura(caminho) {
  return caminho.replace(/([?&])([^=&]+)=([^&]*)/g, (inteiro, separador, chave) =>
    SENSIVEL.test(chave) ? `${separador}${chave}=[redigido]` : inteiro,
  );
}

function lerCorpo(texto) {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/**
 * Cliente HTTP autenticado. `corpo` só existe em sucesso; em 4xx/5xx o que o
 * servidor respondeu vem em `erro`.
 *
 * Corpo vazio com `Content-Type: application/json` o Fastify recusa: POST sem
 * payload ainda leva um objeto.
 */
export function clienteApi(cookie, { base = API } = {}) {
  const origem = exigirOrigemLocal(base, "E2E_API");
  return async (caminho, init = {}) => {
    const metodo = (init.method ?? "GET").toUpperCase();
    const resposta = await fetch(`${origem}${caminho}`, {
      ...init,
      method: metodo,
      body: init.body ?? (metodo === "POST" ? "{}" : undefined),
      headers: { cookie, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const corpo = lerCorpo(await resposta.text());
    return resposta.status < 400
      ? { status: resposta.status, corpo, erro: null }
      : { status: resposta.status, corpo: null, erro: corpo };
  };
}

/** Falha de API com o que diagnostica — método, rota, status e corpo — e nada que seja segredo. */
export class ErroDeApi extends Error {
  constructor({ metodo, caminho, status, corpo }) {
    super(`${metodo} ${rotaSegura(caminho)} → ${status}: ${corpoSeguro(corpo)}`);
    this.name = "ErroDeApi";
    this.metodo = metodo;
    this.caminho = caminho;
    this.status = status;
  }
}

/**
 * A chamada de preparação que não aceita falha: devolve o corpo, ou lança
 * `ErroDeApi`.
 *
 *   const cliente = await exigir(api, "POST", "/customers", { legalName });
 */
export async function exigir(api, metodo, caminho, corpo) {
  const init = { method: metodo };
  if (corpo !== undefined) init.body = JSON.stringify(corpo);
  const resposta = await api(caminho, init);
  if (resposta.status >= 400) {
    throw new ErroDeApi({ metodo, caminho, status: resposta.status, corpo: resposta.erro });
  }
  return resposta.corpo;
}

/**
 * Cookie de sessão pela API — serve para `fetch` e para o navegador. Sem
 * `E2E_EMAIL`/`E2E_PASSWORD` vale o ADMIN local do `seed-infra`; o runner
 * (`pnpm e2e:run`) sempre passa o ADMIN próprio da execução.
 */
export async function autenticar({
  base = API,
  email = process.env.E2E_EMAIL ?? "admin@veridi.local",
  password = process.env.E2E_PASSWORD ?? "veridi-local-dev",
} = {}) {
  const origem = exigirOrigemLocal(base, "E2E_API");
  const resposta = await fetch(`${origem}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resposta.ok) throw new Error(`login de ${email} → ${resposta.status}`);
  const cookie = resposta.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login não devolveu cookie de sessão");
  return cookie;
}
