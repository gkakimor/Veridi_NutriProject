import type { CnpjLookupCompany, CnpjLookupProvider } from "@veridi/shared";
import { CnpjLookupUnavailableError } from "./cnpj-lookup.errors.js";
import { openCnpjProvider } from "./open-cnpj.provider.js";

/**
 * A abstração de provedor da consulta de CNPJ — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * Um adaptador conhece UMA fonte: como chamá-la, o que ela devolve e como
 * isso vira `CnpjLookupCompany`. Nada acima dele conhece payload cru,
 * endpoint, cabeçalho ou credencial de fonte nenhuma.
 *
 * É pequena de propósito. Acrescentar o SERPRO é escrever um segundo
 * adaptador e registrá-lo no mapa abaixo — sem tocar no serviço, no endpoint,
 * no contrato normalizado, na tela de comparação nem na aplicação dos campos.
 * Nenhum código morto de SERPRO nasce antes disso: a lista de provedores
 * (`CNPJ_LOOKUP_PROVIDERS`) é a mesma que a tela oferece, e oferecer uma
 * fonte que não responde é pior do que não oferecer.
 */
export interface CnpjLookupProviderAdapter {
  readonly provider: CnpjLookupProvider;
  /**
   * Consulta o CNPJ já normalizado e validado (14 posições, sem máscara).
   *
   * Lança `CnpjNotFoundError` quando a fonte respondeu que não conhece o
   * número, e `CnpjLookupUnavailableError` em qualquer outra falha. Nunca
   * deixa escapar erro cru de rede nem de parsing.
   */
  fetchCompany(cnpj: string): Promise<CnpjLookupCompany>;
}

/**
 * O registro de provedores conhecidos.
 *
 * A Web nunca escolhe URL nem provedor arbitrário: ela manda um valor do
 * enum, o Zod recusa o que não estiver nele e este mapa é a única tradução de
 * nome para adaptador. Não existe proxy genérico.
 */
const REGISTRY: Partial<Record<CnpjLookupProvider, CnpjLookupProviderAdapter>> = {
  OPEN_CNPJ: openCnpjProvider,
};

/**
 * O adaptador do provedor pedido.
 *
 * Falha fechado: provedor que entrou no enum e ainda não tem adaptador vira
 * indisponibilidade tratada, nunca 500 — é exatamente o estado transitório em
 * que o SERPRO vai estar entre declarar o valor e ligar a implementação.
 */
export function resolveCnpjLookupProvider(
  provider: CnpjLookupProvider,
): CnpjLookupProviderAdapter {
  const adapter = REGISTRY[provider];
  if (!adapter) throw new CnpjLookupUnavailableError(`provedor sem adaptador: ${provider}`);
  return adapter;
}
