import type { MasterDataDeletionReferenceDTO, MasterDataEntityType } from "@veridi/shared";

/**
 * Filhos técnicos — a exceção da D2 (MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01).
 *
 * Linha que nasceu OBRIGATORIAMENTE no mesmo ato do cadastro e nunca foi usada
 * não conta como uso: a V1 em rascunho dos Modelos e do Roteiro, e o registro
 * dos dados do CNPJ que a criação do Cliente gravou. Ela sai junto, por
 * CASCADE. Sem prova de que está como a criação a deixou, ela bloqueia.
 *
 * Funções puras sobre as linhas lidas (`to_jsonb`) — o serviço lê, trava e
 * decide; aqui só se julga.
 */

export type Linha = Record<string, unknown>;

/** As linhas internas lidas, por tabela, na ordem do catálogo. */
export type Internos = ReadonlyMap<string, readonly Linha[]>;

/**
 * Como a V1 técnica de um agregado versionado nasce. TODA coluna da tabela de
 * versões está em `livres` ou em `padroes`: coluna nova, que ninguém
 * classificou, bloqueia — a exclusão não presume que ela é vazia.
 */
export interface RegraDaV1 {
  tabelaDeVersoes: string;
  /** Escrituração, identidade e o que a criação pode preencher: qualquer valor. */
  livres: readonly string[];
  /** O que a criação deixa no padrão, e o padrão — valor de `to_jsonb`. Diferente = conteúdo lançado. */
  padroes: Readonly<Record<string, unknown>>;
  /** Como cada coluna de `padroes` aparece na frase. */
  rotulos: Readonly<Record<string, string>>;
  /** Tabelas abaixo da versão: têm de estar vazias. */
  filhos: readonly { tabela: string; rotulo: string }[];
  /** "o modelo", "o roteiro" — na frase. */
  artigo: string;
}

const ESCRITURACAO = ["id", "versionNumber", "status", "createdAt", "createdBy"] as const;

const NUNCA_USADA: Readonly<Record<string, unknown>> = {
  activatedAt: null,
  activatedBy: null,
  archivedAt: null,
  archivedBy: null,
  sourceVersionId: null,
  sourceVersionNumber: null,
  notes: null,
};

const ROTULOS_COMUNS: Readonly<Record<string, string>> = {
  activatedAt: "ativação",
  activatedBy: "ativação",
  archivedAt: "arquivamento da versão",
  archivedBy: "arquivamento da versão",
  sourceVersionId: "versão de origem",
  sourceVersionNumber: "versão de origem",
  notes: "observações",
};

export const REGRAS_DA_V1: Partial<Record<MasterDataEntityType, RegraDaV1>> = {
  FORMULATION_TEMPLATE: {
    tabelaDeVersoes: "formulation_template_versions",
    livres: [
      ...ESCRITURACAO,
      "formulationTemplateId",
      // A criação recebe base, modo, doses e unidade — o estado de nascimento.
      "basisQuantity",
      "calculationMode",
      "dosesPerPackage",
      "outputUnitCode",
    ],
    padroes: {
      ...NUNCA_USADA,
      dosageForm: null,
      presentationType: null,
      capsulesPerDose: null,
      doseAmount: null,
      doseUomCode: null,
      packageContentAmount: null,
      packageContentUomCode: null,
      expectedLossPercent: null,
    },
    rotulos: {
      ...ROTULOS_COMUNS,
      dosageForm: "forma farmacêutica",
      presentationType: "apresentação",
      capsulesPerDose: "cápsulas por dose",
      doseAmount: "dose",
      doseUomCode: "dose",
      packageContentAmount: "conteúdo da embalagem",
      packageContentUomCode: "conteúdo da embalagem",
      expectedLossPercent: "perda prevista",
    },
    filhos: [{ tabela: "formulation_template_components", rotulo: "componente(s)" }],
    artigo: "o modelo",
  },
  INDUSTRIAL_COST_TEMPLATE: {
    tabelaDeVersoes: "industrial_cost_template_versions",
    livres: [...ESCRITURACAO, "industrialCostTemplateId", "referenceOutputQuantity", "referenceOutputUomCode"],
    padroes: { ...NUNCA_USADA, energyCalculationMode: "NONE", energyResourceId: null },
    rotulos: { ...ROTULOS_COMUNS, energyCalculationMode: "energia", energyResourceId: "energia" },
    filhos: [
      { tabela: "industrial_cost_template_resource_usages", rotulo: "recurso(s)" },
      { tabela: "industrial_cost_template_additional_costs", rotulo: "custo(s) adicional(is)" },
    ],
    artigo: "o modelo",
  },
  PRICING_POLICY_TEMPLATE: {
    tabelaDeVersoes: "pricing_policy_template_versions",
    livres: [...ESCRITURACAO, "pricingPolicyTemplateId"],
    padroes: {
      ...NUNCA_USADA,
      industrialCostMode: "CALCULATED",
      industrialCostPercentOfMaterials: null,
      industrialCostAmountPerUnit: null,
      industrialCostAmountTotal: null,
      estimatedTaxMode: "IGNORE",
      estimatedTaxPercentOfSalePrice: null,
      estimatedTaxAmountPerUnit: null,
      estimatedTaxAmountTotal: null,
      externalAdditionalCosts: false,
      applicableTaxProfiles: [],
    },
    rotulos: {
      ...ROTULOS_COMUNS,
      industrialCostMode: "custo industrial do modelo de precificação",
      industrialCostPercentOfMaterials: "custo industrial do modelo de precificação",
      industrialCostAmountPerUnit: "custo industrial do modelo de precificação",
      industrialCostAmountTotal: "custo industrial do modelo de precificação",
      estimatedTaxMode: "impostos estimados",
      estimatedTaxPercentOfSalePrice: "impostos estimados",
      estimatedTaxAmountPerUnit: "impostos estimados",
      estimatedTaxAmountTotal: "impostos estimados",
      externalAdditionalCosts: "custos adicionais externos",
      applicableTaxProfiles: "perfis tributários indicados",
    },
    filhos: [{ tabela: "pricing_policy_template_tiers", rotulo: "faixa(s)" }],
    artigo: "a política",
  },
  PRODUCTION_PROFILE: {
    tabelaDeVersoes: "production_profile_versions",
    livres: [...ESCRITURACAO, "productionProfileId", "referenceQuantity", "referenceUomCode"],
    padroes: { ...NUNCA_USADA },
    rotulos: { ...ROTULOS_COMUNS },
    filhos: [
      { tabela: "production_profile_steps", rotulo: "etapa(s)" },
      { tabela: "production_profile_step_resources", rotulo: "recurso(s) de etapa" },
    ],
    artigo: "o roteiro",
  },
};

const bloqueio = (source: string, reason: string, count = 1): MasterDataDeletionReferenceDTO => ({
  source,
  count,
  reason,
});

const mesmoValor = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A V1 está como a criação a deixou? Só a V1, em rascunho, nunca ativada nem
 * derivada, sem conteúdo lançado e sem filho nenhum.
 */
export function julgarV1(regra: RegraDaV1, internos: Internos): MasterDataDeletionReferenceDTO[] {
  const versoes = internos.get(regra.tabelaDeVersoes) ?? [];
  if (versoes.length !== 1) {
    return [
      bloqueio(
        "Versões",
        versoes.length === 0
          ? `${capitalizar(regra.artigo)} não tem a V1 técnica — a exclusão só reconhece o cadastro como a criação o deixou.`
          : `${capitalizar(regra.artigo)} tem ${versoes.length} versões; só a V1 em rascunho, nunca trabalhada, sai com o cadastro.`,
        versoes.length,
      ),
    ];
  }

  const v1 = versoes[0]!;
  const bloqueios: MasterDataDeletionReferenceDTO[] = [];
  if (v1["versionNumber"] !== 1) {
    bloqueios.push(bloqueio("Versão", `A única versão é a V${String(v1["versionNumber"])}, não a V1 da criação.`));
  }
  if (v1["status"] !== "DRAFT") {
    bloqueios.push(bloqueio("Versão V1", `A V1 está ${String(v1["status"])} — só a V1 em rascunho, nunca ativada, sai.`));
  }

  const semClassificacao = Object.keys(v1).filter(
    (coluna) => !regra.livres.includes(coluna) && !(coluna in regra.padroes),
  );
  for (const coluna of semClassificacao) {
    bloqueios.push(
      bloqueio(
        "Versão V1",
        `A versão tem um campo que a regra da exclusão ainda não conhece (${coluna}); sem prova de que está vazio, bloqueia.`,
      ),
    );
  }
  const ausentes = [...regra.livres, ...Object.keys(regra.padroes)].filter((coluna) => !(coluna in v1));
  for (const coluna of ausentes) {
    bloqueios.push(
      bloqueio("Catálogo da exclusão desatualizado", `A regra da V1 cita ${regra.tabelaDeVersoes}.${coluna}, que não existe mais.`),
    );
  }

  const lancados = new Set<string>();
  for (const [coluna, padrao] of Object.entries(regra.padroes)) {
    if (coluna in v1 && !mesmoValor(v1[coluna], padrao)) lancados.add(regra.rotulos[coluna] ?? coluna);
  }
  if (lancados.size > 0) {
    bloqueios.push(
      bloqueio(
        "Versão V1",
        `A V1 já foi trabalhada: ${[...lancados].join(", ")}. Rascunho trabalhado não é filho técnico.`,
        lancados.size,
      ),
    );
  }

  for (const filho of regra.filhos) {
    const linhas = internos.get(filho.tabela)?.length ?? 0;
    if (linhas > 0) {
      bloqueios.push(bloqueio("Versão V1", `A V1 tem ${linhas} ${filho.rotulo} lançado(s).`, linhas));
    }
  }
  return bloqueios;
}

/**
 * O registro dos dados do CNPJ que a CRIAÇÃO do Cliente gravou é filho técnico
 * — e só ele. Prova: um evento só, que não é troca de CNPJ, e o Cliente nunca
 * regravado depois de criado (`updatedAt` = `createdAt`): sem gravação
 * posterior, o evento só pode ter vindo da criação. Qualquer outro caso é
 * histórico real e bloqueia (§122).
 */
export function julgarEventoDoCnpj(cliente: Linha, eventos: readonly Linha[]): MasterDataDeletionReferenceDTO[] {
  if (eventos.length === 0) return [];
  const fonte = "Histórico dos dados cadastrais do CNPJ";
  if (eventos.length > 1) {
    return [bloqueio(fonte, `O cliente tem ${eventos.length} registros dos dados do CNPJ — o histórico é permanente.`, eventos.length)];
  }
  const evento = eventos[0]!;
  if (evento["kind"] === "CNPJ_CHANGED") {
    return [bloqueio(fonte, "O CNPJ do cliente já foi trocado — o histórico é permanente.")];
  }
  if (cliente["updatedAt"] !== cliente["createdAt"]) {
    return [
      bloqueio(
        fonte,
        "O cliente foi alterado depois de criado, e não há como provar que o registro dos dados do CNPJ é o da criação.",
      ),
    ];
  }
  return [];
}

/** Os filhos técnicos do agregado: o que bloqueia (vazio = todos provados). */
export function julgarFilhosTecnicos(
  tipo: MasterDataEntityType,
  raiz: Linha,
  internos: Internos,
): MasterDataDeletionReferenceDTO[] {
  const regra = REGRAS_DA_V1[tipo];
  if (regra) return julgarV1(regra, internos);
  if (tipo === "CUSTOMER") return julgarEventoDoCnpj(raiz, internos.get("customer_cnpj_registration_history") ?? []);
  return [];
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
