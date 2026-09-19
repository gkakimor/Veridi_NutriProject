import type { MasterDataEntityType } from "@veridi/shared";
import type { Internos, Linha } from "./filhos-tecnicos.js";
import { REGRAS_DA_V1 } from "./filhos-tecnicos.js";

/**
 * O retrato que o rastro guarda — D3 do MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.
 *
 * LISTA BRANCA por cadastro: só o necessário para provar o que saiu — código,
 * nome, identificador fiscal, situação, a V1 técnica e o que saiu junto. Campo
 * que não está aqui não entra, nem que a linha o tenha: contato, endereço,
 * observação, descrição e qualquer segredo ficam de fora por construção.
 */

export const FORMATO_DO_RETRATO = 1;

export const CAMPOS_DA_RAIZ: Record<MasterDataEntityType, readonly string[]> = {
  SUPPLIER: ["code", "legalName", "tradeName", "cnpj", "active", "createdAt"],
  CUSTOMER: [
    "code",
    "legalName",
    "tradeName",
    "cnpj",
    "taxProfile",
    "active",
    "blocked",
    "externalCode",
    "createdAt",
    "createdByNameSnapshot",
  ],
  FORMULATION_TEMPLATE: ["code", "name", "archivedAt", "archivedBy", "createdAt", "createdBy"],
  INDUSTRIAL_COST_TEMPLATE: ["code", "name", "archivedAt", "archivedBy", "createdAt", "createdBy"],
  PRICING_POLICY_TEMPLATE: ["code", "name", "archivedAt", "archivedBy", "createdAt", "createdBy"],
  PRODUCTION_PROFILE: ["code", "name", "archivedAt", "archivedBy", "createdAt", "createdBy"],
  ITEM: ["code", "name", "type", "unitCode", "family", "active", "externalCode", "createdAt"],
  PRODUCT: ["code", "name", "lifecycle", "active", "externalCode", "createdAt"],
  INDUSTRIAL_RESOURCE: ["code", "name", "type", "active", "createdAt", "createdByNameSnapshot"],
};

/** Da V1 técnica: a identidade e o que a criação preencheu. */
export const CAMPOS_DA_V1: Partial<Record<MasterDataEntityType, readonly string[]>> = {
  FORMULATION_TEMPLATE: [
    "versionNumber",
    "status",
    "basisQuantity",
    "calculationMode",
    "dosesPerPackage",
    "outputUnitCode",
    "createdAt",
    "createdBy",
  ],
  INDUSTRIAL_COST_TEMPLATE: [
    "versionNumber",
    "status",
    "referenceOutputQuantity",
    "referenceOutputUomCode",
    "createdAt",
    "createdBy",
  ],
  PRICING_POLICY_TEMPLATE: ["versionNumber", "status", "createdAt", "createdBy"],
  PRODUCTION_PROFILE: ["versionNumber", "status", "referenceQuantity", "referenceUomCode", "createdAt", "createdBy"],
};

function escolher(linha: Linha, campos: readonly string[]): Linha {
  return Object.fromEntries(campos.map((campo) => [campo, linha[campo] ?? null]));
}

/** Cadastro que saiu junto como vinculado da raiz (o PA do Produto). */
export interface VinculadoNoRetrato {
  tipo: MasterDataEntityType;
  /** A tabela da raiz dele (`items`), para "saiu junto". */
  tabela: string;
  raiz: Linha;
  internos: Internos;
}

export interface RetratoDaExclusao {
  formato: number;
  cadastro: Linha;
  /** Só nos agregados versionados. */
  versaoTecnica?: Linha;
  /**
   * Só quando saiu cadastro vinculado (o Item de produto acabado do Produto):
   * a identidade dele, pela lista branca do tipo dele.
   */
  vinculados?: { tipo: MasterDataEntityType; cadastro: Linha }[];
  /** Linhas que saíram junto, por tabela — nunca o conteúdo delas. */
  removidosJunto: { tabela: string; linhas: number }[];
}

export function retratoDaExclusao(
  tipo: MasterDataEntityType,
  raiz: Linha,
  internos: Internos,
  vinculados: readonly VinculadoNoRetrato[] = [],
): RetratoDaExclusao {
  const regra = REGRAS_DA_V1[tipo];
  const camposDaV1 = CAMPOS_DA_V1[tipo];
  const v1 = regra ? internos.get(regra.tabelaDeVersoes)?.[0] : undefined;
  const removidos = new Map<string, number>();
  const conta = (tabela: string, linhas: number) => removidos.set(tabela, (removidos.get(tabela) ?? 0) + linhas);
  for (const [tabela, linhas] of internos) if (linhas.length > 0) conta(tabela, linhas.length);
  for (const vinculado of vinculados) {
    conta(vinculado.tabela, 1);
    for (const [tabela, linhas] of vinculado.internos) if (linhas.length > 0) conta(tabela, linhas.length);
  }
  return {
    formato: FORMATO_DO_RETRATO,
    cadastro: escolher(raiz, CAMPOS_DA_RAIZ[tipo]),
    ...(v1 && camposDaV1 ? { versaoTecnica: escolher(v1, camposDaV1) } : {}),
    ...(vinculados.length > 0
      ? {
          vinculados: vinculados.map((vinculado) => ({
            tipo: vinculado.tipo,
            cadastro: escolher(vinculado.raiz, CAMPOS_DA_RAIZ[vinculado.tipo]),
          })),
        }
      : {}),
    removidosJunto: [...removidos].map(([tabela, linhas]) => ({ tabela, linhas })),
  };
}
