/**
 * Biblioteca técnica de Formulações — matrizes reutilizáveis entre clientes.
 *
 * Um template não é a formulação de ninguém. Usar um template COPIA os dados
 * para uma `FormulationVersion` própria do Produto, e a partir daí as duas
 * vidas seguem separadas: o template pode ganhar V4 e a formulação copiada da
 * V3 continua sendo o que era.
 *
 * A alternativa — vários produtos apontando para a mesma formulação viva —
 * foi recusada de propósito: mexer na receita de um cliente reescreveria a de
 * outro, e ninguém descobriria antes da produção.
 */

import type {
  FormulationCalculationMode,
  FormulationComponentBasis,
} from "./formulations.js";
import type { SupplyResponsibility } from "./ownership.js";
import type { ItemType } from "./items.js";

export const FORMULATION_TEMPLATE_CODE_PREFIX = "FT";

export type FormulationTemplateVersionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export const FORMULATION_TEMPLATE_VERSION_STATUS_LABELS: Record<
  FormulationTemplateVersionStatus,
  string
> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  ARCHIVED: "Arquivada",
};

export interface FormulationTemplateComponentDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  itemActive: boolean;
  /** Decimal como string — nunca float JS. */
  quantity: string;
  unitCode: string;
  basis: FormulationComponentBasis;
  /**
   * SUGESTÃO de quem fornece, não imposição. Quem fornece cada material muda
   * de cliente para cliente: a cópia leva este valor como ponto de partida e
   * o usuário ajusta no produto sem tocar no template.
   */
  supplyResponsibility: SupplyResponsibility;
  /** `null` = pureza desconhecida; nenhuma correção é aplicada. */
  purityPercentApplied: string | null;
  /** `null` = não informado; nunca inferido. */
  overagePercent: string | null;
  notes: string | null;
  position: number;
}

export interface FormulationTemplateVersionDTO {
  id: string;
  formulationTemplateId: string;
  templateCode: string;
  templateName: string;
  versionNumber: number;
  /** Rótulo de apresentação — "V1", "V2"... */
  versionLabel: string;
  status: FormulationTemplateVersionStatus;
  basisQuantity: string;
  calculationMode: FormulationCalculationMode;
  /** Obrigatório no modo `PER_DOSE`; `null` no `FIXED_BASIS`. */
  dosesPerPackage: number | null;
  /** Unidade do produto acabado a que a base se refere. */
  outputUnitCode: string;
  notes: string | null;
  components: FormulationTemplateComponentDTO[];
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  archivedAt: string | null;
  /** Versão que serviu de molde, dentro do próprio template. */
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  /** Quantas formulações de produto nasceram desta versão. */
  usageCount: number;
}

export interface FormulationTemplateDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** Arquivado sai da biblioteca sem apagar história. */
  archived: boolean;
  archivedAt: string | null;
  /** Versão vigente para uso. `null` enquanto só houver rascunho. */
  activeVersion: FormulationTemplateVersionDTO | null;
  /** Rascunho aberto, quando houver — no máximo um por template. */
  draftVersion: FormulationTemplateVersionDTO | null;
  versions: FormulationTemplateVersionDTO[];
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

/** Linha da biblioteca — o suficiente para escolher sem abrir. */
export interface FormulationTemplateSummaryDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archived: boolean;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  /** Base da versão ativa, para reconhecer a matriz na lista. */
  basisQuantity: string | null;
  outputUnitCode: string | null;
  calculationMode: FormulationCalculationMode | null;
  componentCount: number;
  /** Códigos dos itens da versão ativa — permite buscar por componente. */
  componentItemCodes: string[];
  hasDraft: boolean;
  updatedAt: string;
}

export interface FormulationTemplateListResponse {
  templates: FormulationTemplateSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateFormulationTemplateInput {
  name: string;
  description?: string | null;
  basisQuantity?: string;
  outputUnitCode?: string;
  calculationMode?: FormulationCalculationMode;
  dosesPerPackage?: number | null;
}

export interface UpdateFormulationTemplateInput {
  name?: string;
  description?: string | null;
}

export interface FormulationTemplateComponentInput {
  itemId: string;
  quantity: string;
  unitCode: string;
  basis?: FormulationComponentBasis;
  supplyResponsibility?: SupplyResponsibility;
  purityPercentApplied?: string | null;
  overagePercent?: string | null;
  notes?: string | null;
}

export interface UpdateFormulationTemplateVersionInput {
  basisQuantity?: string;
  outputUnitCode?: string;
  calculationMode?: FormulationCalculationMode;
  dosesPerPackage?: number | null;
  notes?: string | null;
  components?: FormulationTemplateComponentInput[];
}

/** Aplicar um template ao produto — sempre cópia, nunca vínculo. */
export interface ApplyFormulationTemplateInput {
  formulationTemplateVersionId: string;
}

export interface CreateTemplateFromFormulationInput {
  name: string;
  description?: string | null;
}

/**
 * Uma diferença entre duas versões de template, ou entre a formulação e a
 * versão de template mais recente.
 *
 * Diff específico e pequeno de propósito: um framework genérico de comparação
 * custaria mais do que as sete coisas que realmente mudam numa fórmula.
 */
export type FormulationTemplateDiffKind =
  | "BASIS"
  | "MODE"
  | "DOSES"
  | "OUTPUT_UOM"
  | "COMPONENT_ADDED"
  | "COMPONENT_REMOVED"
  | "COMPONENT_CHANGED";

export interface FormulationTemplateDiffEntryDTO {
  kind: FormulationTemplateDiffKind;
  /** Rótulo pronto para leitura: "Vitamina C (MP-000001)" ou "Base". */
  label: string;
  /** Campo alterado, quando `COMPONENT_CHANGED`. */
  field: string | null;
  from: string | null;
  to: string | null;
}

export interface FormulationTemplateDiffDTO {
  fromLabel: string;
  toLabel: string;
  entries: FormulationTemplateDiffEntryDTO[];
}

/**
 * Existe versão de template mais recente que a que originou esta formulação.
 *
 * Só informa. Não existe "atualizar para a V4" que sobrescreva a formulação —
 * o caminho é criar uma versão nova, e a atual continua histórica.
 */
export interface FormulationTemplateUpdateAvailableDTO {
  templateId: string;
  templateCode: string;
  templateName: string;
  originVersionId: string;
  originVersionNumber: number;
  latestVersionId: string;
  latestVersionNumber: number;
}
