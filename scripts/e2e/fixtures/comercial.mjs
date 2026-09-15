import { exigir } from "./api.mjs";
import { nomeCarimbado } from "./cadastros.mjs";

/**
 * Massa comercial por API — Projeto, produto do Projeto e versões de
 * orçamento como PRÉ-CONDIÇÃO (E2E-BASELINE-REDESIGN-WAVE-03).
 *
 * A regra de `cadastros.mjs` vale igual: recebe a `api` autenticada e a
 * execução, carimba o nome, devolve id e código LIDOS da resposta, e não navega
 * nem afirma regra. Código de orçamento nunca é montado: `ORC-…` e o rótulo
 * `ORC-… · Vn` vêm do servidor. Quando o gesto comercial É o assunto da suíte —
 * criar a versão pela ficha, enviar, aceitar, aprovar —, ele acontece pela tela,
 * com os gestos de `comercial-ui.mjs`.
 */

export async function criarProjeto(api, run, { cliente, nome } = {}) {
  if (!cliente?.id) throw new Error("criarProjeto exige o cliente desta execução");
  const projeto = await exigir(api, "POST", "/projects", {
    customerId: cliente.id,
    name: nomeCarimbado(run, nome, "Projeto"),
  });
  return { id: projeto.id, codigo: projeto.code, nome: projeto.name };
}

/** Produto criado DENTRO do Projeto, em desenvolvimento — o "Criar novo produto" da ficha. */
export async function criarProdutoDoProjeto(api, run, { projeto, nome, unidade = "un" } = {}) {
  if (!projeto?.id) throw new Error("criarProdutoDoProjeto exige o projeto desta execução");
  const vinculo = await exigir(api, "POST", `/projects/${projeto.id}/products`, {
    operation: "create",
    name: nomeCarimbado(run, nome, "Produto"),
    finishedUnitCode: unidade,
  });
  return {
    vinculoId: vinculo.id,
    id: vinculo.productId,
    codigo: vinculo.productCode,
    nome: vinculo.productName,
    unidade,
  };
}

/** A versão como as suítes a usam: identidade e rótulo do servidor, e as linhas por produto. */
export function lerVersao(dto) {
  return {
    id: dto.id,
    codigo: dto.code,
    numero: dto.versionNumber,
    rotulo: dto.versionLabel,
    status: dto.status,
    validade: dto.validUntil,
    linhas: (dto.lines ?? []).map((linha) => ({
      id: linha.id,
      produtoId: linha.productId,
      quantidade: linha.quotedQuantity,
      preco: linha.unitPrice,
      origem: linha.priceOrigin,
      herdadaDe: linha.inheritedFromQuoteLineId,
      motivo: linha.priceOriginReason,
    })),
  };
}

/** A próxima versão do Projeto — com rascunho aberto, o servidor devolve o próprio rascunho. */
export async function criarVersao(api, { projeto } = {}) {
  if (!projeto?.id) throw new Error("criarVersao exige o projeto desta execução");
  return lerVersao(await exigir(api, "POST", `/projects/${projeto.id}/quote-versions`));
}

/** Quantidade e/ou preço de uma linha que já existe na versão. */
export async function precificarLinha(api, { linha, quantidade, preco } = {}) {
  if (!linha?.id) throw new Error("precificarLinha exige a linha da versão");
  const corpo = {};
  if (quantidade !== undefined) corpo.quotedQuantity = String(quantidade);
  if (preco !== undefined) corpo.unitPrice = String(preco);
  if (Object.keys(corpo).length === 0) throw new Error("precificarLinha sem quantidade nem preço");
  return lerVersao(await exigir(api, "PATCH", `/quote-lines/${linha.id}`, corpo));
}

/**
 * O produto do Projeto entra na proposta — a linha nasce sem quantidade nem
 * preço — e recebe o que foi pedido. A linha é achada pelo PRODUTO, não pela
 * posição.
 */
export async function adicionarLinha(api, { versao, produto, quantidade, preco } = {}) {
  if (!versao?.id || !produto?.vinculoId) throw new Error("adicionarLinha exige a versão e o produto do projeto");
  const comLinha = lerVersao(
    await exigir(api, "POST", `/quote-versions/${versao.id}/lines`, { projectProductId: produto.vinculoId }),
  );
  const linha = linhaDoProduto(comLinha, produto);
  if (quantidade === undefined && preco === undefined) return comLinha;
  return precificarLinha(api, { linha, quantidade, preco });
}

/** A linha do produto numa versão lida — lança se o produto não está nela. */
export function linhaDoProduto(versao, produto) {
  const linha = versao.linhas.find((candidata) => candidata.produtoId === produto.id);
  if (!linha) throw new Error(`${produto.codigo} não está na ${versao.rotulo}`);
  return linha;
}

/** Condições da versão em rascunho, com os nomes da API (`validUntil`, `quoteDate`…). */
export async function gravarCondicoes(api, { versao, condicoes } = {}) {
  if (!versao?.id || !condicoes) throw new Error("gravarCondicoes exige a versão e as condições");
  return lerVersao(await exigir(api, "PATCH", `/quote-versions/${versao.id}`, condicoes));
}

export async function enviarVersao(api, { versao } = {}) {
  if (!versao?.id) throw new Error("enviarVersao exige a versão");
  return lerVersao(await exigir(api, "POST", `/quote-versions/${versao.id}/send`));
}

export async function recusarVersao(api, { versao } = {}) {
  if (!versao?.id) throw new Error("recusarVersao exige a versão");
  return lerVersao(await exigir(api, "POST", `/quote-versions/${versao.id}/reject`));
}

/** GET de conferência: a versão como o servidor a tem agora. */
export async function lerVersaoDoServidor(api, { versao } = {}) {
  if (!versao?.id) throw new Error("lerVersaoDoServidor exige a versão");
  return lerVersao(await exigir(api, "GET", `/quote-versions/${versao.id}`));
}
