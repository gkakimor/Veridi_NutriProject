/** Contratos do módulo de Formulações/Versionamento, consumidos por `apps/api` e `apps/web`. */

import type { ItemFamily, ItemType, PackagingSubtype } from "./items.js";
import type { SupplyResponsibility } from "./ownership.js";
import type { DosageForm, PresentationType, TargetAgeGroup } from "./products.js";

/**
 * As formas que a bancada da Formulação oferece.
 *
 * A Veridi produz Produto Acabado em PÓ ou em CÁPSULA, e são essas as duas
 * formas cujas premissas a bancada sabe calcular por dose. O enum
 * `DosageForm` continua inteiro — comprimido, líquido e "outro" seguem
 * cadastráveis no Produto e continuam legíveis numa versão histórica que já
 * os tenha. O que esta lista restringe é a ESCOLHA da tela: oferecer forma
 * que a bancada não calcula é convidar a premissa que não fecha.
 */
export const FORMAS_DA_BANCADA: readonly DosageForm[] = ["CAPSULE", "POWDER"];

/**
 * Apresentações comerciais coerentes com cada forma da bancada.
 *
 * A Veridi entrega Produto Acabado em PÓ ou em CÁPSULA, e a apresentação não é
 * necessariamente pote: o mesmo pó sai em sachê, em cartucho ou a granel. O que
 * esta tabela faz é impedir o par que não descreve produto nenhum — pó em
 * frasco, que na linguagem do cadastro é a embalagem de cápsula e de líquido.
 *
 * Ela restringe a ESCOLHA da tela, nunca o enum nem o que já está gravado:
 * `apresentacoesDaForma` devolve junto a apresentação atual da versão mesmo
 * quando ela está fora da lista, para que uma versão histórica continue
 * legível e para que nenhuma gravação antiga seja reescrita.
 */
export const APRESENTACOES_POR_FORMA: Partial<Record<DosageForm, readonly PresentationType[]>> = {
  CAPSULE: ["POT", "BOTTLE", "POUCH", "CARTON", "BULK", "OTHER"],
  POWDER: ["POT", "POUCH", "CARTON", "BULK", "OTHER"],
};

/**
 * As apresentações que a tela oferece para uma forma, preservando a atual.
 *
 * Forma em branco ou fora da bancada devolve a lista inteira: restringir o que
 * não se sabe classificar esconderia opção legítima.
 */
export function apresentacoesDaForma(
  forma: DosageForm | null | undefined,
  atual: PresentationType | null | undefined,
  todas: readonly PresentationType[],
): readonly PresentationType[] {
  const coerentes = forma ? APRESENTACOES_POR_FORMA[forma] : undefined;
  if (!coerentes) return todas;
  if (atual && !coerentes.includes(atual)) {
    // A ordem da lista canônica manda, para a opção histórica não brotar no fim.
    return todas.filter((tipo) => coerentes.includes(tipo) || tipo === atual);
  }
  return coerentes;
}

export type FormulationVersionStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

export const FORMULATION_VERSION_STATUSES: readonly FormulationVersionStatus[] = [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
];

export const FORMULATION_VERSION_STATUS_LABELS: Record<FormulationVersionStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  INACTIVE: "Inativa",
};

/**
 * Modo de cálculo da versão. `FIXED_BASIS` é o modelo original ("estas
 * quantidades produzem esta base"); `PER_DOSE` declara a fórmula por dose
 * do produto acabado, como a indústria trabalha.
 */
export type FormulationCalculationMode = "FIXED_BASIS" | "PER_DOSE";

export const FORMULATION_CALCULATION_MODES: readonly FormulationCalculationMode[] = [
  "FIXED_BASIS",
  "PER_DOSE",
];

export const FORMULATION_CALCULATION_MODE_LABELS: Record<FormulationCalculationMode, string> = {
  FIXED_BASIS: "Base fixa",
  PER_DOSE: "Por dose",
};

/** Base de cálculo do COMPONENTE — declarada linha a linha. */
export type FormulationComponentBasis = "FIXED_BASIS" | "PER_DOSE" | "PER_FINISHED_UNIT";

/**
 * O que a quantidade declarada do componente significa.
 *
 * A distinção existe porque as duas semânticas convivem no dado real e são
 * indistinguíveis pelo valor: 224,4898 mg já corrigidos por pureza e 220 mg
 * teóricos são o mesmo número para o banco, e a diferença entre eles é 2% de
 * material.
 */
export type FormulationComponentQuantityMode = "PHYSICAL_DIRECT" | "THEORETICAL_WITH_ADJUSTMENTS";

/**
 * Rótulos das duas leituras, na linguagem de quem monta a receita.
 *
 * Decisão de PO (2026-09-04): "já ajustada" e "automaticamente" sugeriam uma
 * correção ativa mesmo sem nenhuma caixa marcada. Os nomes dizem só o que a
 * quantidade digitada É — informada ou a calcular.
 */
export const FORMULATION_QUANTITY_MODE_LABELS: Record<FormulationComponentQuantityMode, string> = {
  PHYSICAL_DIRECT: "Quantidade física informada",
  THEORETICAL_WITH_ADJUSTMENTS: "Calcular quantidade física",
};

/** A frase de apoio de cada modo — a mesma na tela e na ajuda. */
export const FORMULATION_QUANTITY_MODE_DESCRIPTIONS: Record<FormulationComponentQuantityMode, string> = {
  PHYSICAL_DIRECT:
    "A quantidade digitada já representa o material que será usado. Pureza e overage podem ser registrados, mas não alteram automaticamente a quantidade.",
  THEORETICAL_WITH_ADJUSTMENTS:
    "A quantidade digitada é teórica: os ajustes selecionados serão aplicados para chegar à quantidade física.",
};

export const FORMULATION_COMPONENT_BASES: readonly FormulationComponentBasis[] = [
  "FIXED_BASIS",
  "PER_DOSE",
  "PER_FINISHED_UNIT",
];

export const FORMULATION_COMPONENT_BASIS_LABELS: Record<FormulationComponentBasis, string> = {
  FIXED_BASIS: "Base da fórmula",
  PER_DOSE: "Por dose",
  PER_FINISHED_UNIT: "Por unidade acabada",
};

export interface FormulationComponentDTO {
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
   * Quem deve fornecer este componente. Intenção declarada na fórmula e
   * congelada na versão — nunca é o dono do lote físico.
   */
  supplyResponsibility: SupplyResponsibility;
  /**
   * SNAPSHOT da pureza aplicada (0 < x <= 100). `null` significa
   * DESCONHECIDA: nenhuma correção é aplicada — nunca se assume 100%.
   * Alterar `Item.defaultPurityPercent` depois não muda esta versão.
   */
  purityPercentApplied: string | null;
  /** Perda/excesso de processo em %; `null` = não informado. */
  overagePercent: string | null;
  /**
   * O que `quantity` SIGNIFICA neste componente.
   *
   * `PHYSICAL_DIRECT`: já é a quantidade física; pureza e overage, quando
   * preenchidos, ficam como documentação e não disparam recálculo.
   * `THEORETICAL_WITH_ADJUSTMENTS`: é a quantidade teórica, e o sistema
   * calcula a física aplicando SOMENTE os ajustes marcados.
   *
   * Registrar um ajuste deixou de ser o mesmo que autorizá-lo: o dado real tem
   * componentes cuja quantidade já vem corrigida de fora, e neles preencher a
   * pureza aplicava a correção uma segunda vez, em silêncio.
   */
  quantityMode: FormulationComponentQuantityMode;
  applyPurityAdjustment: boolean;
  applyOverageAdjustment: boolean;
  /** Referência histórica da planilha — nunca entra no cálculo. */
  legacyTotalQuantity: string | null;
  legacyTotalUnitCode: string | null;
  legacyBatchUnits: string | null;
  stockUnitCode: string;
  /**
   * Necessidade teórica para uma unidade acabada, na unidade de estoque, antes
   * de pureza/overage. `null` quando a versão ainda não tem premissa para
   * quantificar. Nunca zero.
   *
   * É este o "equivalente estoque" que a tela mostra. Existia ao lado dele um
   * `stockEquivalentQuantity` que era a quantidade declarada apenas convertida
   * de unidade, sem o fator da base: num componente de 60 doses os dois campos
   * diferiam por 60, e a mesma célula da mesma tela mostrava um ou outro
   * conforme a versão estivesse em rascunho ou ativa. Um campo só, do motor.
   */
  theoreticalPerUnit: string | null;
  /** Necessidade física para uma unidade acabada, já com pureza/overage. */
  /** `null` quando a versão ainda não tem premissa para quantificar. Nunca zero. */
  physicalPerUnit: string | null;
  /**
   * Dados técnicos do cadastro ATUAL do Item (FORMULATION-WORKBENCH-01): leitura
   * para quem monta a receita, nunca entrada de cálculo. O que a conta usa e a
   * versão congela continua sendo `purityPercentApplied`.
   */
  itemSourceName: string | null;
  itemDeclaredNutrient: string | null;
  itemFamily: ItemFamily | null;
  itemPackagingSubtype: PackagingSubtype | null;
  /** Pureza padrão do cadastro HOJE — pode diferir da aplicada nesta versão. */
  itemDefaultPurityPercent: string | null;
  /**
   * Alvo e física de UMA dose, na unidade declarada (`unitCode`), pelo motor
   * canônico. `null` quando a base não é por dose ou a conta não é possível.
   * Nunca zero.
   */
  theoreticalPerDose: string | null;
  physicalPerDose: string | null;
  /** Física por cápsula, na unidade declarada; `null` fora da forma cápsula. */
  physicalPerCapsule: string | null;
  notes: string | null;
  position: number;
}

/**
 * Problema num componente que impede ativar a versão.
 *
 * Existe porque uma versão pode ser criada a partir de outra criada meses
 * antes: o item pode ter sido inativado, mudado de tipo ou trocado de
 * unidade nesse intervalo. A cópia mantém a receita — alterar uma fórmula
 * em silêncio seria pior que copiá-la quebrada — e diz o que vai barrar a
 * ativação, em vez de deixar a descoberta para o clique final.
 */
export interface FormulationComponentIssueDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  code: "ITEM_INACTIVE" | "ITEM_IS_FINISHED_PRODUCT" | "UOM_INCOMPATIBLE" | "INVALID_QUANTITY";
  description: string;
}

export interface FormulationVersionDTO {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  versionNumber: number;
  /** Rótulo de apresentação — "V1", "V2"... nunca persistido separadamente. */
  versionLabel: string;
  status: FormulationVersionStatus;
  basisQuantity: string;
  calculationMode: FormulationCalculationMode;
  /** Obrigatório no modo `PER_DOSE`; `null` no `FIXED_BASIS`. */
  dosesPerPackage: number | null;
  /**
   * Premissas da apresentação — SNAPSHOT da versão (FORMULATION-WORKBENCH-01).
   * `null` nas versões gravadas antes da bancada. Nas formas cápsula e pó,
   * `dosesPerPackage` é derivado delas.
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
   * PERDA PREVISTA DE PRODUÇÃO (%) — premissa GLOBAL desta versão, snapshot.
   *
   * Perda normal esperada do processo. Não altera a composição da dose nem da
   * cápsula, e nunca altera quantidade comercial: o que ela muda é a
   * quantidade BRUTA planejada e, por ela, o custo estimado interno por
   * unidade vendável. `null` = não informada (nunca 0% presumido).
   */
  expectedLossPercent: string | null;
  /**
   * Perfil industrial do Produto HOJE — referência para conferir a versão,
   * nunca premissa dela: mudar o cadastro não reescreve versão nenhuma.
   */
  productProfile: FormulationProductProfileDTO;
  outputItemId: string;
  outputItemCode: string;
  outputItemName: string;
  outputUnitCode: string;
  notes: string | null;
  components: FormulationComponentDTO[];
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  inactivatedAt: string | null;
  inactivatedBy: string | null;
  /**
   * Versão que serviu de molde. `null` na V1 e nas versões criadas antes de
   * o campo existir.
   */
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  /**
   * Template da biblioteca que serviu de molde. `null` quando a versão nasceu
   * em branco, copiada de outra versão do mesmo produto, ou antes desta
   * capacidade existir.
   *
   * É PROVENIÊNCIA, não vínculo: o template pode evoluir sem tocar nesta
   * versão, e editar esta versão nunca volta para o template.
   */
  originTemplateVersionId: string | null;
  originTemplateCode: string | null;
  originTemplateVersionNumber: number | null;
  /** Nome atual do template de origem, para o rótulo. */
  originTemplateName: string | null;
  /**
   * Só para versões em RASCUNHO: uma versão ativa ou histórica é um
   * documento fechado, e apontar problema nela seria sugerir edição onde
   * não há edição possível.
   */
  componentIssues: FormulationComponentIssueDTO[];
}

/** Perfil industrial do Produto como está no cadastro, lido junto da versão. */
export interface FormulationProductProfileDTO {
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  capsulesPerDose: number | null;
  doseAmount: string | null;
  doseUomCode: string | null;
  dosesPerPackage: number | null;
  /**
   * Premissas de embarque e público que o resumo da bancada mostra.
   *
   * São do CADASTRO do Produto e continuam sendo: a Formulação as exibe para
   * conferência e nunca as edita — nenhum cadastro novo foi criado para
   * preencher o topo da tela. `null` quando o Produto não as informa, e aí o
   * resumo omite a linha em vez de inventar um valor.
   */
  targetAgeGroup: TargetAgeGroup | null;
  /** Na unidade do Produto Acabado — a mesma de `outputUnitCode`. */
  minimumBatchQuantity: string | null;
  unitsPerShippingBox: number | null;
}

export interface FormulationSummaryDTO {
  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  finishedProductItemId: string | null;
  finishedProductItemCode: string | null;
  activeVersionId: string | null;
  activeVersionLabel: string | null;
  /** `true` se existe ao menos uma versão (DRAFT/ACTIVE/INACTIVE) para o produto. */
  hasFormulation: boolean;
  updatedAt: string | null;
}

/**
 * O que fica defasado se esta versão virar a ativa.
 *
 * Ativar não muda documento nenhum — é justamente por isso que a lista
 * existe. O raio de impacto só é útil ANTES do clique, quando ainda dá para
 * cancelar; depois, viraria constatação.
 *
 * Estrutura de custos ATIVA aparece para ser lida, não consertada: a receita
 * dela é o que o custo já significa. Rascunho de estrutura e OP em rascunho
 * aparecem porque têm saída — um clique e uma troca de versão.
 */
export interface FormulationActivationImpactDTO {
  costStructures: {
    id: string;
    code: string;
    label: string;
    status: "DRAFT" | "ACTIVE";
    formulationVersionNumber: number;
  }[];
  /**
   * Só ordens em RASCUNHO: uma OP planejada já congelou seus requisitos, e
   * trocar a formulação ativa não a alcança.
   */
  productionOrders: {
    id: string;
    code: string;
    formulationVersionNumber: number;
  }[];
}

export interface FormulationListResponse {
  formulations: FormulationSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FormulationVersionListResponse {
  versions: FormulationVersionDTO[];
}

export interface FormulationComponentInput {
  itemId: string;
  quantity: string;
  unitCode: string;
  basis?: FormulationComponentBasis;
  supplyResponsibility?: SupplyResponsibility;
  purityPercentApplied?: string | null;
  overagePercent?: string | null;
  quantityMode?: FormulationComponentQuantityMode;
  applyPurityAdjustment?: boolean;
  applyOverageAdjustment?: boolean;
  legacyTotalQuantity?: string | null;
  legacyTotalUnitCode?: string | null;
  legacyBatchUnits?: string | null;
  notes?: string;
}

export interface CreateFormulationVersionInput {
  notes?: string;
}

export interface UpdateFormulationVersionInput {
  basisQuantity?: string;
  calculationMode?: FormulationCalculationMode;
  dosesPerPackage?: number | string | null;
  /**
   * Premissas da apresentação. Nas formas cápsula e pó o servidor deriva
   * `dosesPerPackage` delas, e divisão que não fecha é recusada.
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
   * Perda prevista de produção (%) — premissa da VERSÃO. `null` limpa a
   * premissa (volta a "não informada"); ausente deixa como está.
   */
  expectedLossPercent?: string | null;
  notes?: string;
  components?: FormulationComponentInput[];
}
