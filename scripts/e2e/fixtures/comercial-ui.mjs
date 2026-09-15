import { esperarRota } from "./ui.mjs";

/**
 * Gestos da negociação pela tela — E2E-BASELINE-REDESIGN-WAVE-03.
 *
 * Desde QUOTE-WORKSPACE-NAVIGATION-01 a versão de orçamento mora em
 * `/comercial/orcamentos/:id`: linhas, condições, PDF, envio, aceite, recusa e
 * Fechamento. A ficha do Projeto lista as versões, cria a próxima e aprova o
 * Projeto. Cada gesto espera a tela terminar e devolve o que ELA mostrou — id da
 * rota, URL alcançada, rótulo do título, status da resposta. Nenhum afirma regra:
 * quem confere é a suíte.
 */

export const ROTA_DA_VERSAO = /^\/comercial\/orcamentos\/([0-9a-f-]{36})$/;
export const ROTA_DO_PROJETO = /^\/comercial\/projetos\/([0-9a-f-]{36})$/;

/** O título de documento da página da versão é o rótulo do servidor: `ORC-000123 · V2`. */
const TITULO_DE_VERSAO = /^ORC-\d+ · V\d+$/;

/** `/comercial/orcamentos/:id`, com `?voltar=` quando há origem — o endereço que a lista e a ficha montam. */
export function rotaDaVersao(id, { voltar } = {}) {
  const destino = `/comercial/orcamentos/${id}`;
  return voltar ? `${destino}?voltar=${encodeURIComponent(voltar)}` : destino;
}

export function rotaDoProjeto(id) {
  return `/comercial/projetos/${id}`;
}

/** O id que a rota carrega, ou `null` se a URL não é daquela rota. */
export function idDaRota(url, rota) {
  const alvo = url instanceof URL ? url : new URL(url);
  return rota.exec(alvo.pathname)?.[1] ?? null;
}

async function tituloDoDocumento(pagina) {
  const titulo = pagina.locator(".doc-title h1");
  return (await titulo.count()) > 0 ? (await titulo.first().innerText()).trim() : null;
}

/**
 * A página da versão depois de um gesto que leva a ela: a rota da versão E o
 * título do documento carregado, diferente do que estava antes — trocar de V2
 * para V1 remonta a página, e o título velho não serve de sinal.
 */
export async function esperarVersaoNaTela(pagina, { tituloAnterior = null, timeout = 25000 } = {}) {
  await esperarRota(pagina, ROTA_DA_VERSAO, { timeout });
  await pagina.waitForFunction(
    ({ padrao, anterior }) => {
      const texto = document.querySelector(".doc-title h1")?.textContent?.trim() ?? "";
      return new RegExp(padrao).test(texto) && texto !== anterior;
    },
    { padrao: TITULO_DE_VERSAO.source, anterior: tituloAnterior },
    { timeout },
  );
  const alcancada = new URL(pagina.url());
  return {
    id: idDaRota(alcancada, ROTA_DA_VERSAO),
    url: alcancada.href,
    rotulo: await tituloDoDocumento(pagina),
  };
}

/** Abre a versão pelo endereço — link direto, recarga, ou o `voltar` que outra tela montou. */
export async function abrirVersao(pagina, url, { timeout = 25000 } = {}) {
  await pagina.goto(url);
  return esperarVersaoNaTela(pagina, { timeout });
}

/** A ficha do Projeto carregada — pelo endereço ou depois de um gesto que leva a ela. */
export async function esperarProjetoNaTela(pagina, { timeout = 25000 } = {}) {
  const url = await esperarRota(pagina, ROTA_DO_PROJETO, { timeout });
  await pagina.locator(".project-commercial").first().waitFor({ timeout });
  return { id: idDaRota(url, ROTA_DO_PROJETO), url: new URL(pagina.url()).href };
}

/** "← Voltar ao Projeto PROJ-…" da página da versão. Com condição por salvar a guarda segura — quem testa a guarda não usa isto. */
export async function voltarAoProjeto(pagina, { timeout = 25000 } = {}) {
  await pagina.getByRole("link", { name: /^← Voltar ao Projeto / }).click();
  return esperarProjetoNaTela(pagina, { timeout });
}

function respostaDaApi(pagina, metodo, caminho, { timeout, status } = {}) {
  const resposta = pagina.waitForResponse(
    (r) =>
      r.request().method() === metodo &&
      caminho.test(new URL(r.url()).pathname) &&
      (status === undefined || r.status() === status),
    { timeout },
  );
  // Tempo esgotado não pode virar rejeição sem dono antes de a suíte esperar.
  resposta.catch(() => {});
  return resposta;
}

/**
 * A releitura que toda ação da página da versão dispara: a versão e depois o
 * Projeto dela (`GET /projects/:id`, a última das duas). Registrar ANTES da ação.
 */
export function aguardarReleitura(pagina, { timeout = 25000 } = {}) {
  return respostaDaApi(pagina, "GET", /^\/projects\/[0-9a-f-]{36}$/, { timeout, status: 200 });
}

/**
 * Na ficha, o botão da próxima proposta — "Criar nova versão", "Novo orçamento"
 * ou "Abrir rascunho", dito pela suíte — e a página da versão que ele abre.
 */
export async function criarNovaVersao(pagina, { botao, timeout = 25000 } = {}) {
  if (!botao) throw new Error("criarNovaVersao exige o rótulo do botão que a ficha oferece");
  const tituloAnterior = await tituloDoDocumento(pagina);
  const criada = respostaDaApi(pagina, "POST", /^\/projects\/[0-9a-f-]{36}\/quote-versions$/, { timeout });
  await pagina.getByRole("button", { name: botao, exact: true }).click();
  const resposta = await criada;
  const corpo = resposta.ok() ? await resposta.json() : null;
  const aberta = await esperarVersaoNaTela(pagina, { tituloAnterior, timeout });
  return { ...aberta, resposta: { status: resposta.status(), id: corpo?.id ?? null } };
}

/** "Aprovar projeto" na ficha, confirmado em "Aprovar"; devolve a resposta e a ficha relida. */
export async function aprovarProjeto(pagina, { timeout = 25000 } = {}) {
  const aprovacao = respostaDaApi(pagina, "POST", /^\/projects\/[0-9a-f-]{36}\/approve$/, { timeout });
  const releitura = aguardarReleitura(pagina, { timeout });
  await pagina.getByRole("button", { name: "Aprovar projeto", exact: true }).click();
  const dialogo = pagina.getByRole("alertdialog");
  await dialogo.waitFor({ timeout });
  const pergunta = (await dialogo.locator("#confirm-dialog-title").innerText()).trim();
  await dialogo.getByRole("button", { name: "Aprovar", exact: true }).click();
  const resposta = await aprovacao;
  if (resposta.ok()) await releitura;
  const corpo = resposta.ok() ? await resposta.json() : null;
  return { pergunta, status: resposta.status(), projeto: corpo ? { id: corpo.id, status: corpo.status } : null };
}

/** "Enviar ao cliente" na página da versão, confirmado no diálogo; devolve a resposta e espera a releitura. */
export async function enviarAoCliente(pagina, { timeout = 25000 } = {}) {
  const envio = respostaDaApi(pagina, "POST", /^\/quote-versions\/[0-9a-f-]{36}\/send$/, { timeout });
  const releitura = aguardarReleitura(pagina, { timeout });
  await pagina.locator(".quote-workspace").getByRole("button", { name: "Enviar ao cliente", exact: true }).click();
  const dialogo = pagina.getByRole("alertdialog");
  await dialogo.waitFor({ timeout });
  const pergunta = (await dialogo.locator("#confirm-dialog-title").innerText()).trim();
  await dialogo.getByRole("button", { name: "Enviar ao cliente", exact: true }).click();
  const resposta = await envio;
  if (resposta.ok()) await releitura;
  return { pergunta, status: resposta.status() };
}

/** "Registrar aceite" na página da versão enviada; devolve a resposta e espera a releitura. */
export async function registrarAceite(pagina, { timeout = 25000 } = {}) {
  const aceite = respostaDaApi(pagina, "POST", /^\/quote-versions\/[0-9a-f-]{36}\/accept$/, { timeout });
  const releitura = aguardarReleitura(pagina, { timeout });
  await pagina.getByRole("button", { name: "Registrar aceite", exact: true }).click();
  const resposta = await aceite;
  if (resposta.ok()) await releitura;
  return { status: resposta.status() };
}

/**
 * "Gerar pedido a partir do orçamento aceito", no Fechamento da versão aceita
 * com o Projeto aprovado; devolve a resposta e a tela do Pedido alcançada.
 */
export async function gerarPedido(pagina, { timeout = 25000 } = {}) {
  const geracao = respostaDaApi(pagina, "POST", /^\/quote-versions\/[0-9a-f-]{36}\/create-order$/, { timeout });
  await pagina.getByRole("button", { name: "Gerar pedido a partir do orçamento aceito", exact: true }).click();
  const resposta = await geracao;
  const corpo = resposta.ok() ? await resposta.json() : null;
  const url = await esperarRota(pagina, /^\/comercial\/pedidos\/[0-9a-f-]{36}$/, { timeout });
  return { status: resposta.status(), pedido: corpo ? { id: corpo.id, codigo: corpo.code } : null, url: url.href };
}
