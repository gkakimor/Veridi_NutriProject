import type { CnpjLookupProvider, CnpjLookupResult } from "@veridi/shared";
import { DEFAULT_CNPJ_LOOKUP_PROVIDER } from "@veridi/shared";
import { resolveCnpjLookupProvider } from "./cnpj-lookup.provider.js";

/**
 * A consulta assistida de CNPJ — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * SOMENTE LEITURA do ponto de vista do domínio Veridi: não grava, não cria,
 * não atualiza e não registra nada. O que a fonte devolveu vira sugestão na
 * tela; quem decide é a pessoa, e quem persiste é o `PATCH`/`POST` do Cliente
 * depois do "Salvar".
 *
 * Também não guarda o payload cru em lugar nenhum — nem em tabela, nem em
 * cache, nem em log. Os dados cadastrais do CNPJ que o Cliente passou a
 * guardar (§119, CUSTOMER-CNPJ-PERSISTED-DATA-01) chegam ao banco pelo
 * POST/PATCH do cadastro, depois de "Aplicar" e "Salvar" — nunca por aqui, e
 * o `consultedAt` abaixo só vira "Última consulta CNPJ" nesse momento.
 *
 * O serviço não conhece provedor nenhum: ele resolve o adaptador pelo
 * registro e devolve o contrato normalizado com a proveniência junto.
 */
export async function lookupCnpj(
  cnpj: string,
  provider: CnpjLookupProvider = DEFAULT_CNPJ_LOOKUP_PROVIDER,
): Promise<CnpjLookupResult> {
  const adapter = resolveCnpjLookupProvider(provider);
  const company = await adapter.fetchCompany(cnpj);

  return {
    provider: adapter.provider,
    consultedAt: new Date().toISOString(),
    cnpj,
    company,
  };
}
