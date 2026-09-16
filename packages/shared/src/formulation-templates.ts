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
  FormulationComponentIssueDTO,
  FormulationComponentQuantityMode,
} from "./formulations.js";
import type { SupplyResponsibility } from "./ownership.js";
import type { ItemFamily, ItemType, PackagingSubtype } from "./items.js";
import type { DosageForm, PresentationType } from "./products.js";

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
  /**
   * O que a quantidade significa e quais ajustes ela autoriza — a mesma
   * configuração do componente da Formulação real (§52), copiada ao aplicar.
   */
  quantityMode: FormulationComponentQuantityMode;
  applyPurityAdjustment: boolean;
  applyOverageAdjustment: boolean;
  notes: string | null;
  position: number;
  /**
   * Dados técnicos do cadastro ATUAL do Item — leitura para quem monta a
   * matriz, nunca entrada de cálculo. O que a conta usa e a versão congela
   * continua sendo `purityPercentApplied`. Os MESMOS nomes do componente da
   * Formulação: a bancada compartilhada lê um contrato só.
   */
  stockUnitCode: string;
  itemSourceName: string | null;
  itemDeclaredNutrient: string | null;
  itemFamily: ItemFamily | null;
  itemPackagingSubtype: PackagingSubtype | null;
  /** Pureza padrão do cadastro HOJE — pode diferir da aplicada nesta versão. */
  itemDefaultPurityPercent: string | null;
  /** Código legado do Item (planilhas). `null` quando não há legado. */
  itemExternalCode: string | null;
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
  /**
   * PREMISSAS TÉCNICAS DA MATRIZ — os MESMOS nomes da Formulação.
   *
   * `null` em todo Modelo gravado antes da bancada: ausência é NÃO INFORMADA,
   * nunca pó nem cápsula presumidos. Nas formas cápsula e pó, `dosesPerPackage`
   * é derivado delas pelo mesmo motor da Formulação.
   */
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  capsulesPerDose: number | null;
  /** Derivado: cápsulas por dose × doses por embalagem. Não é coluna. */
  capsulesPerPackage: number | null;
  doseAmount: string | null;
  doseUomCode: string | null;
  packageContentAmount: string | null;
  packageContentUomCode: string | null;
  /**
   * PERDA PREVISTA DE PRODUÇÃO (%) — premissa da matriz, copiada como DEFAULT
   * para a Formulação que nascer dela. `null` = não informada (nunca 0%
   * presumido).
   */
  expectedLossPercent: string | null;
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
  /**
   * O que, nos componentes desta versão, o cadastro do Item mudou desde a
   * gravação — item inativado, que virou produto acabado, unidade que deixou
   * de ser compatível, quantidade inválida (FORMULATION-TEMPLATE-WORKBENCH-01,
   * fatia 3).
   *
   * O MESMO contrato de `FormulationVersionDTO.componentIssues`, e MENOR que os
   * motivos de ativação da Formulação: nada aqui depende de Produto nem de
   * Cliente, que o Modelo não tem.
   *
   * No RASCUNHO, é o que barra a ativação do Modelo. Na versão ATIVA, é o aviso
   * de quem vai aplicá-la: a Formulação nasce em rascunho com a receita como
   * está, e só ativa depois da correção. Versão arquivada não é aplicada nem
   * editada, e volta vazia.
   */
  componentIssues: FormulationComponentIssueDTO[];
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
  /** Ausente = física informada, sem ajuste — o comportamento de todo Modelo antigo. */
  quantityMode?: FormulationComponentQuantityMode;
  applyPurityAdjustment?: boolean;
  applyOverageAdjustment?: boolean;
  notes?: string | null;
}

export interface UpdateFormulationTemplateVersionInput {
  basisQuantity?: string;
  outputUnitCode?: string;
  calculationMode?: FormulationCalculationMode;
  dosesPerPackage?: number | string | null;
  /**
   * Premissas técnicas da matriz. Nas formas cápsula e pó o servidor DERIVA
   * `dosesPerPackage` delas, pela mesma função da Formulação, e divisão que
   * não fecha é recusada com o campo junto.
   */
  dosageForm?: DosageForm | null;
  presentationType?: PresentationType | null;
  capsulesPerDose?: number | string | null;
  /** Entrada, não coluna: com cápsulas por dose, fecha as doses por embalagem. */
  capsulesPerPackage?: number | string | null;
  doseAmount?: string | null;
  doseUomCode?: string | null;
  packageContentAmount?: string | null;
  packageContentUomCode?: string | null;
  /**
   * Perda prevista de produção (%) — premissa da matriz. `null` limpa (volta a
   * "não informada"); ausente deixa como está.
   */
  expectedLossPercent?: string | null;
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
 * Uma diferença entre duas versões do Modelo, ou entre a formulação e a
 * versão do Modelo mais recente.
 *
 * Diff específico e pequeno de propósito: um framework genérico de comparação
 * custaria mais do que as poucas coisas que realmente mudam numa fórmula.
 *
 * As PREMISSAS TÉCNICAS entram desde FORMULATION-TEMPLATE-WORKBENCH-01 (fatia
 * 3): forma, apresentação comercial, cápsulas por dose, dose, conteúdo da
 * embalagem e perda prevista mudam a leitura da receita tanto quanto um
 * componente. Quantidade e unidade da dose (e do conteúdo) andam juntas numa
 * entrada só — "5 g → 10 g" —, porque o número sem a unidade não diz nada.
 */
export type FormulationTemplateDiffKind =
  | "BASIS"
  | "MODE"
  | "DOSES"
  | "OUTPUT_UOM"
  | "DOSAGE_FORM"
  | "PRESENTATION"
  | "CAPSULES_PER_DOSE"
  | "DOSE"
  | "PACKAGE_CONTENT"
  | "EXPECTED_LOSS"
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
