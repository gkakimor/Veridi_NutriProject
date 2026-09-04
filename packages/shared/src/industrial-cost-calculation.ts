/**
 * Cálculo do custo industrial (capacidade 45).
 *
 * Aqui a estrutura vira número. Duas visões que NUNCA se misturam:
 *
 * 1. **custo padrão/prospectivo** — "quanto custa produzir a base de
 *    referência desta EC, pelas informações conhecidas numa data";
 * 2. **custo da produção realizada** — materiais realmente consumidos numa
 *    OP mais os custos industriais PADRÃO aplicados (horas reais não são
 *    medidas nesta fase, e chamá-las de reais seria mentira).
 *
 * Custo não é preço, e preço não é valor pago: oferta de fornecedor é
 * estimativa prospectiva, `Receipt.actualUnitCost` é custo real de
 * aquisição, e o que foi efetivamente pago é domínio financeiro futuro.
 */

/**
 * Cálculo de custo industrial congelado.
 *
 * Mora aqui, com os demais, para que uma duplicata fique visível lado a
 * lado. Cravado dentro do serviço foi assim que `REC` acabou nomeando
 * Recebimento e Recurso Industrial ao mesmo tempo, por meses.
 */
export const INDUSTRIAL_COST_CALCULATION_CODE_PREFIX = "CALC";

import type { IndustrialCostBasis, IndustrialCostCategory } from "./industrial-costs.js";
import type { EnergyCalculationMode, IndustrialResourceType } from "./industrial-resources.js";

/**
 * De onde veio o custo unitário de um material no cálculo PROSPECTIVO.
 *
 * Deliberadamente separado de `CostSource` da Foundation: lá `REAL`
 * significa "custo do lote efetivamente consumido", que só existe quando há
 * consumo. Um custo padrão nunca é "real" nesse sentido.
 */
export type IndustrialMaterialCostSource =
  | "WEIGHTED_AVG_30D"
  | "WEIGHTED_AVG_90D"
  | "LAST_REAL"
  | "SUPPLIER_OFFER_PREFERRED"
  | "SUPPLIER_OFFER_SINGLE_APPROVED"
  | "AMBIGUOUS_SUPPLIER_REFERENCE"
  | "MANUAL_REFERENCE"
  | "MANUAL_REFERENCE_FORCED"
  | "NO_COST"
  | "EXCLUDED_CUSTOMER_SUPPLIED";

/**
 * Como cada fonte é lida na tela — o mesmo texto no cálculo, no CMV e na
 * impressão. Diz o que a fonte É ("compra real", "oferta", "referência
 * manual"), porque é isso que decide o quanto o número sustenta uma decisão.
 */
export const INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS: Record<
  IndustrialMaterialCostSource,
  string
> = {
  WEIGHTED_AVG_30D: "Compra real · média 30 dias",
  WEIGHTED_AVG_90D: "Compra real · média 90 dias",
  LAST_REAL: "Última compra real",
  SUPPLIER_OFFER_PREFERRED: "Oferta válida do fornecedor preferencial",
  SUPPLIER_OFFER_SINGLE_APPROVED: "Oferta válida do único fornecedor homologado",
  AMBIGUOUS_SUPPLIER_REFERENCE: "Várias ofertas válidas, sem fornecedor preferencial",
  MANUAL_REFERENCE: "Referência manual de custo",
  MANUAL_REFERENCE_FORCED: "Referência manual forçada",
  NO_COST: "Sem referência de custo",
  EXCLUDED_CUSTOMER_SUPPLIED: "Material do cliente · não aplicável",
};

/**
 * Ordem CANÔNICA da seleção automática da fonte de custo — regra durável
 * (PRODUCT_RULES §53). A implementação vive em
 * `apps/api/src/lib/cost-source-selection.ts`; esta lista existe para a tela
 * mostrar a ordem sem redigitá-la. "Desconhecido" fica de fora de propósito:
 * não é uma opção, é a ausência de todas.
 */
export const COST_SOURCE_PRIORITY_LABELS: readonly string[] = [
  "Compra real · média 30 dias",
  "Compra real · média 90 dias",
  "Última compra real",
  "Oferta válida de fornecedor",
  "Referência manual de custo",
];

/** Frase única da UI sobre a seleção — reusada em custo, CMV e item. */
export const COST_SOURCE_AUTO_SELECTION_TEXT =
  "O sistema seleciona automaticamente a melhor fonte disponível: " +
  COST_SOURCE_PRIORITY_LABELS.join(" → ") +
  ".";

/** Fontes que representam custo real de aquisição já ocorrido. */
export const REAL_REFERENCE_SOURCES: readonly IndustrialMaterialCostSource[] = [
  "WEIGHTED_AVG_30D",
  "WEIGHTED_AVG_90D",
  "LAST_REAL",
];

export type IndustrialCostQuality =
  | "COMPLETE_REAL_REFERENCE"
  | "COMPLETE_WITH_ESTIMATES"
  | "PARTIAL"
  | "NO_COST";

export const INDUSTRIAL_COST_QUALITY_LABELS: Record<IndustrialCostQuality, string> = {
  COMPLETE_REAL_REFERENCE: "Completo — referências reais de compra",
  COMPLETE_WITH_ESTIMATES: "Completo — com estimativas",
  PARTIAL: "Parcial — há custos não informados",
  NO_COST: "Sem custo conhecido",
};

export const INDUSTRIAL_COST_QUALITY_HINTS: Record<IndustrialCostQuality, string> = {
  COMPLETE_REAL_REFERENCE:
    "Todos os materiais Veridi vieram de compras reais e todas as premissas estão informadas. Isso é referência completa, não o custo realizado de uma produção.",
  COMPLETE_WITH_ESTIMATES:
    "Tudo está calculado, mas pelo menos um material usou estimativa — oferta de fornecedor ou referência manual de custo — em vez de compra real.",
  PARTIAL:
    "Existe custo ou premissa não informada. O total completo não existe; o que aparece é o subtotal conhecido.",
  NO_COST: "Nenhum custo Veridi conhecido para esta estrutura.",
};

/** Materiais reais + recursos padrão: a produção só fecha depois de concluída. */
export type RealizedCostStatus = "PROVISIONAL" | "FINAL";

export const REALIZED_COST_STATUS_LABELS: Record<RealizedCostStatus, string> = {
  PROVISIONAL: "Provisório — produção em andamento",
  FINAL: "Final — produção concluída",
};

export interface IndustrialCostWarningDTO {
  code: string;
  message: string;
  /**
   * Onde a observação se resolve DE FATO.
   *
   * Mandar para o cadastro do item era beco: lá não existe campo de custo, e
   * de propósito — custo de matéria-prima é consequência de compra, não algo
   * que se digita. Por isso o alvo de um material sem custo depende do que
   * já existe no histórico dele, e quem sabe isso é o servidor.
   *
   * `RECEIPT` = há recebimento com custo em branco; é ali que se informa.
   * `PURCHASE` = nunca foi comprado; o caminho é uma ordem de compra.
   * `STALE_BASIS` = o custo existe HOJE, mas o cálculo congelado é anterior
   *   a ele — resolve-se salvando um cálculo novo, não mexendo no item.
   * `RESOURCE` = recurso industrial, que é onde mora a tarifa.
   * `ENERGY` = a seção de energia da própria estrutura de custos.
   * `ACTIVATE` = nada está errado; o rascunho só precisa ser ativado.
   * `FORMULATION` = a receita não tem premissa para quantificar material;
   *   é na formulação que se informa, não no custo.
   */
  target?:
    | "RECEIPT"
    | "PURCHASE"
    | "STALE_BASIS"
    | "RESOURCE"
    | "ENERGY"
    | "ACTIVATE"
    | "FORMULATION";
  itemId?: string;
  itemCode?: string;
  resourceId?: string;
  /** Recebimento com custo em branco, quando `target = "RECEIPT"`. */
  receiptId?: string;
  receiptCode?: string;
}

/**
 * Referência manual vigente para o material na data do cálculo — o que
 * "Forçar referência manual" usaria. Já convertida para a unidade do item;
 * o valor como foi declarado vem junto para a tela dizer "R$ 1.200,00/kg".
 */
export interface IndustrialMaterialManualReferenceDTO {
  referenceId: string;
  /** Na unidade do item. */
  unitCost: string;
  /** Como foi declarado (valor e unidade). */
  declaredUnitCost: string;
  declaredUomCode: string;
  effectiveFrom: string;
  note: string | null;
}

/**
 * Auditoria de uma referência manual FORÇADA num cálculo.
 *
 * Congela tudo o que é preciso para reproduzir a decisão sem consultar o
 * item de novo: o que foi usado, o que a seleção automática teria usado, o
 * motivo, quem e quando. O cálculo salvo carrega isto dentro do próprio
 * documento.
 */
export interface IndustrialMaterialCostOverrideDTO {
  reason: string;
  automaticSource: IndustrialMaterialCostSource;
  automaticUnitCost: string | null;
  automaticDetails: string | null;
  automaticSubtotal: string | null;
  /** `subtotal forçado − subtotal automático`; `null` quando o automático não tem custo. */
  impact: string | null;
  referenceId: string;
  referenceEffectiveFrom: string;
  forcedByName: string | null;
  forcedAt: string;
}

export interface IndustrialMaterialCostLineDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Quantidade física necessária para a base de referência, já com pureza/overage. */
  requiredQuantity: string;
  unitCode: string;
  customerSupplied: boolean;
  /** `null` quando desconhecido ou material do cliente — nunca zero. */
  unitCost: string | null;
  costSource: IndustrialMaterialCostSource;
  costSourceDetails: string | null;
  subtotal: string | null;
  /**
   * Opcionais porque cálculos salvos antes desta capacidade não os têm:
   * ler `undefined` como "sem referência" e "sem substituição" é correto.
   */
  manualReference?: IndustrialMaterialManualReferenceDTO | null;
  override?: IndustrialMaterialCostOverrideDTO | null;
}

/** Substituição pedida pelo usuário: por material, por cálculo. */
export interface MaterialCostOverrideInput {
  itemId: string;
  /** Obrigatório ao salvar; na prévia pode vir vazio. */
  reason?: string | undefined;
}

export interface IndustrialResourceCostLineDTO {
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceType: IndustrialResourceType;
  /** Consumo já escalado para a base de referência (horas ou kWh). */
  quantity: string;
  quantityUom: "HOUR" | "KWH";
  rateValue: string | null;
  /** Tarifa congelada da versão ativa ou referência atual do rascunho. */
  rateIsDraftReference: boolean;
  subtotal: string | null;
}

export interface IndustrialManualCostLineDTO {
  lineId: string;
  category: IndustrialCostCategory;
  description: string;
  calculationBasis: IndustrialCostBasis;
  rateValue: string | null;
  /** Caixas de expedição inteiras, quando a base for por caixa. */
  computedUnits: string | null;
  subtotal: string | null;
}

export interface CustomerSuppliedMaterialDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  requiredQuantity: string;
  unitCode: string;
}

/**
 * Resultado do cálculo padrão. Todo campo de dinheiro que pode ser
 * desconhecido é `string | null` — `knownSubtotal` existe sempre, mas nunca
 * pode ser apresentado como total.
 */
export interface IndustrialCostCalculationDTO {
  industrialCostVersionId: string;
  industrialCostVersionLabel: string;
  structureStatus: "DRAFT" | "ACTIVE" | "INACTIVE";
  /** Rascunho usa a referência de hoje: o número ainda pode mudar. */
  draftReference: boolean;

  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  formulationVersionNumber: number;

  referenceOutputQuantity: string;
  referenceOutputUomCode: string;
  unitsPerShippingBox: number | null;
  costReferenceDate: string;
  calculatedAt: string;

  materials: IndustrialMaterialCostLineDTO[];
  resources: IndustrialResourceCostLineDTO[];
  manualLines: IndustrialManualCostLineDTO[];
  customerSuppliedMaterials: CustomerSuppliedMaterialDTO[];
  hasCustomerSuppliedMaterials: boolean;

  energyCalculationMode: EnergyCalculationMode;
  derivedEnergyKwh: string | null;
  /** Tarifa usada para valorizar a energia — congelada junto com o resto. */
  energyRate: string | null;

  materialsSubtotalKnown: string;
  laborSubtotalKnown: string;
  equipmentSubtotalKnown: string;
  /** `null` quando a energia deveria compor o custo e não é conhecida. */
  energySubtotal: string | null;
  secondaryPackagingSubtotalKnown: string;
  thirdPartySubtotalKnown: string;
  otherSubtotalKnown: string;
  overheadSubtotalKnown: string;

  /** Só existe quando todos os componentes diretos são conhecidos. */
  directIndustrialCost: string | null;
  totalIndustrialCost: string | null;
  /** Sempre presente — é o que se conhece, jamais rotulado como total. */
  knownSubtotal: string;
  costPerUnit: string | null;
  costPer1000: string | null;

  quality: IndustrialCostQuality;
  warnings: IndustrialCostWarningDTO[];
}

export interface IndustrialCostCalculationSnapshotDTO extends IndustrialCostCalculationDTO {
  id: string;
  code: string;
  calculatedByName: string | null;
  structureStatusAtCalculation: "DRAFT" | "ACTIVE" | "INACTIVE";
  notes: string | null;
}

/** Linha da lista de cálculos salvos de um produto. */
export interface IndustrialCostCalculationSummaryDTO {
  id: string;
  code: string;
  industrialCostVersionId: string;
  industrialCostVersionLabel: string;
  structureStatusAtCalculation: "DRAFT" | "ACTIVE" | "INACTIVE";
  costReferenceDate: string;
  calculatedAt: string;
  calculatedByName: string | null;
  quality: IndustrialCostQuality;
  totalIndustrialCost: string | null;
  knownSubtotal: string;
  costPerUnit: string | null;
  costPer1000: string | null;
}

export interface SaveIndustrialCostCalculationInput {
  costReferenceDate?: string;
  notes?: string | null;
  /**
   * Materiais em que a referência manual é forçada NESTE cálculo. Exceção
   * por documento: nada disso muda o item nem a ordem global de seleção.
   */
  materialOverrides?: MaterialCostOverrideInput[];
}

/** Prévia com as mesmas opções de salvar — nada é persistido. */
export interface PreviewIndustrialCostCalculationInput {
  costReferenceDate?: string;
  materialOverrides?: MaterialCostOverrideInput[];
}

/** Consumo real avaliado de uma OP. */
export interface ProductionMaterialCostLineDTO {
  consumptionId: string;
  itemCode: string;
  itemName: string;
  lotCode: string | null;
  quantity: string;
  unitCode: string;
  consumedAt: string;
  customerSupplied: boolean;
  unitCost: string | null;
  /** Fonte da Foundation: REAL (lote consumido) ou fallback histórico. */
  costSource: string;
  subtotal: string | null;
}

/**
 * Custo industrial de uma produção. Materiais são REALIZADOS; recursos,
 * embalagem secundária, serviços e overhead são PADRÃO APLICADOS na
 * proporção do que foi realmente produzido — nunca "horas reais".
 */
export interface ProductionOrderCostDTO {
  productionOrderId: string;
  productionOrderCode: string;
  productCode: string;
  productName: string;
  formulationVersionNumber: number | null;
  industrialCostVersionId: string | null;
  industrialCostVersionLabel: string | null;

  producedQuantity: string;
  outputUnitCode: string;
  /** Produzido ÷ base da EC — proporção usada nos custos padrão aplicados. */
  allocationFactor: string | null;

  materials: ProductionMaterialCostLineDTO[];
  standardApplied: IndustrialResourceCostLineDTO[];
  standardAppliedManual: IndustrialManualCostLineDTO[];

  actualMaterialCostKnown: string;
  standardAppliedLaborKnown: string;
  standardAppliedEquipmentKnown: string;
  standardAppliedEnergy: string | null;
  standardAppliedSecondaryPackagingKnown: string;
  standardAppliedThirdPartyKnown: string;
  standardAppliedOtherKnown: string;
  standardAppliedOverheadKnown: string;
  standardAppliedCostKnown: string;

  totalIndustrialCost: string | null;
  knownSubtotal: string;
  costPerProducedUnit: string | null;

  quality: IndustrialCostQuality;
  status: RealizedCostStatus;
  /** Materiais reais + recursos padrão convivendo no mesmo número. */
  hybrid: boolean;
  hasCustomerSuppliedMaterials: boolean;
  warnings: IndustrialCostWarningDTO[];
  /** Congelado na conclusão — a partir daí o documento não recalcula. */
  snapshotId: string | null;
  snapshotCreatedAt: string | null;
}
