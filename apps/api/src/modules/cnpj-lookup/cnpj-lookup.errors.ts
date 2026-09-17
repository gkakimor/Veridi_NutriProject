/**
 * As duas únicas falhas que a consulta de CNPJ sabe produzir.
 *
 * Qualquer coisa que impeça a resposta — timeout, 5xx do provedor, limite de
 * uso, rede caída, JSON ilegível, campo com tipo inesperado — é
 * `CnpjLookupUnavailableError`. Para quem está cadastrando a conduta é a
 * mesma, e distinguir dez causas na tela só entrega detalhe de infraestrutura
 * a quem não pode fazer nada com ele. O motivo técnico vai para o log da API.
 */

/** A fonte respondeu e não conhece este CNPJ. */
export class CnpjNotFoundError extends Error {
  constructor(readonly cnpj: string) {
    super(`CNPJ não encontrado na fonte consultada: ${cnpj}`);
    this.name = "CnpjNotFoundError";
  }
}

/** Não deu para perguntar, ou a resposta não serve. `reason` é só para log. */
export class CnpjLookupUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`Consulta de CNPJ indisponível: ${reason}`);
    this.name = "CnpjLookupUnavailableError";
  }
}
