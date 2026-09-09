/**
 * Item × Fornecedor.
 *
 * A relação é estável (existe, tem código no fornecedor, está homologada,
 * é preferencial); preço e MOQ mudam no tempo e vivem em ofertas
 * imutáveis. Oferta é REFERÊNCIA COMERCIAL — nunca custo real de
 * aquisição, que continua vindo do recebimento.
 */

import type { IndustrialMaterialCostSource } from "./industrial-cost-calculation.js";

export type SupplierItemQualificationStatus = "PENDING" | "APPROVED" | "BLOCKED";

export const SUPPLIER_ITEM_QUALIFICATION_STATUSES: readonly SupplierItemQualificationStatus[] = [
  "PENDING",
  "APPROVED",
  "BLOCKED",
];

export const SUPPLIER_ITEM_QUALIFICATION_LABELS: Record<
  SupplierItemQualificationStatus,
  string
> = {
  // "Pendente" é só ausência de homologação aprovada — não é reprovação.
  PENDING: "Pendente",
  APPROVED: "Homologado",
  BLOCKED: "Bloqueado",
};

export type SupplierItemOfferSource = "MANUAL" | "LEGACY_IMPORT";

export const SUPPLIER_ITEM_OFFER_SOURCE_LABELS: Record<SupplierItemOfferSource, string> = {
  MANUAL: "Cadastrada no sistema",
  LEGACY_IMPORT: "Planilha (histórico)",
};

/** Moeda default de oferta nova. Não existe tabela de moedas nesta fase. */
export const DEFAULT_OFFER_CURRENCY = "BRL";

/** Aceita apenas o formato ISO de 3 letras; não valida contra uma lista fechada. */
export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Za-z]{3}$/.test(value.trim());
}

export function normalizeCurrencyCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Por que uma oferta pode — ou não pode — servir de referência de custo.
 *
 * O motor canônico (`selectItemCostSource`) já decide isso a cada cálculo,
 * mas a decisão morria dentro dele: quem cadastrava via cinco ofertas na
 * tela e um CMV que dizia "sem custo conhecido", sem nada ligando as duas
 * coisas. Este vocabulário é o mesmo conjunto de condições, dito uma vez,
 * para a tela poder explicar em português o que o motor faz em silêncio.
 *
 * É diagnóstico da OFERTA, não do item: `ELIGIBLE` significa "esta oferta
 * atende a todas as condições", nunca "esta oferta está sendo usada". Uma
 * compra real recente tem prioridade maior e continua vencendo — quem
 * responde "qual fonte está valendo" é `costSourceToday` no detalhe.
 */
export type SupplierOfferEligibility =
  | "ELIGIBLE"
  | "NO_VALIDITY"
  | "NOT_YET_EFFECTIVE"
  | "EXPIRED"
  | "FOREIGN_CURRENCY"
  | "SUPPLIER_NOT_APPROVED"
  | "INCOMPATIBLE_UOM";

/** Rótulo curto — o estado, para badge. */
export const SUPPLIER_OFFER_ELIGIBILITY_LABELS: Record<SupplierOfferEligibility, string> = {
  ELIGIBLE: "Serve de referência",
  NO_VALIDITY: "Sem vigência",
  NOT_YET_EFFECTIVE: "Ainda não vigente",
  EXPIRED: "Vencida",
  FOREIGN_CURRENCY: "Moeda estrangeira",
  SUPPLIER_NOT_APPROVED: "Fornecedor não homologado",
  INCOMPATIBLE_UOM: "Unidade incompatível",
};

/** A frase inteira — o porquê, para quem precisa agir. */
export const SUPPLIER_OFFER_ELIGIBILITY_HINTS: Record<SupplierOfferEligibility, string> = {
  ELIGIBLE:
    "Esta oferta atende às condições para servir de referência de custo. Uma compra real recente continua tendo prioridade sobre ela.",
  NO_VALIDITY:
    "Importada sem vigência — fica no histórico e não é usada automaticamente no custo. Registre uma oferta nova com a data a partir da qual o preço vale.",
  NOT_YET_EFFECTIVE:
    "A vigência começa numa data futura. A partir dela esta oferta passa a servir de referência.",
  EXPIRED: "A vigência terminou. Registre uma oferta nova para voltar a ter preço de referência.",
  FOREIGN_CURRENCY:
    "O sistema não converte moeda. Só preço em reais entra no custo; esta oferta continua valendo como referência comercial.",
  SUPPLIER_NOT_APPROVED:
    "A relação com o fornecedor precisa estar ativa e homologada, e o fornecedor precisa estar ativo.",
  INCOMPATIBLE_UOM:
    "A unidade do preço não se converte para a unidade de estoque do item, e inventar equivalência daria um custo errado.",
};

/**
 * A frase da AMBIGUIDADE — condição do ITEM, não de uma oferta.
 *
 * Várias ofertas que servem de referência e nenhum preferencial não é erro
 * de cadastro nem oferta inválida: é uma escolha que ainda não foi feita, e
 * escolher a mais barata no lugar de gente seria decidir a compra.
 */
export const SUPPLIER_OFFER_AMBIGUITY_MESSAGE =
  "Este item tem mais de um fornecedor homologado com oferta válida. Defina o fornecedor preferencial para o sistema saber qual referência usar no CMV.";

export interface SupplierItemOfferDTO {
  id: string;
  supplierItemId: string;
  unitPrice: string;
  currencyCode: string;
  priceUomCode: string;
  minimumOrderQuantity: string | null;
  minimumOrderUomCode: string | null;
  /** `null` = observação histórica de preço, nunca preço vigente. */
  effectiveAt: string | null;
  validUntil: string | null;
  source: SupplierItemOfferSource;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  /** Vigente agora segundo `effectiveAt`/`validUntil`, em dia civil. */
  isCurrent: boolean;
  /**
   * Por que esta oferta serve — ou não serve — de referência de custo.
   *
   * `ELIGIBLE` diz que as condições estão atendidas, nunca que o custo de
   * hoje vem daqui: compra real tem prioridade maior, e a ambiguidade entre
   * fornecedores é condição do item.
   */
  eligibility: SupplierOfferEligibility;
}

export interface SupplierItemQualificationEventDTO {
  id: string;
  fromStatus: SupplierItemQualificationStatus | null;
  toStatus: SupplierItemQualificationStatus;
  note: string | null;
  changedAt: string;
  changedByName: string | null;
}

export interface SupplierItemDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemExternalCode: string | null;
  itemUnitCode: string;
  itemType: string;
  itemFamily: string | null;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierActive: boolean;
  supplierItemCode: string | null;
  qualificationStatus: SupplierItemQualificationStatus;
  preferred: boolean;
  active: boolean;
  commercialNotes: string | null;
  /** Oferta vigente; `null` quando só existem referências históricas. */
  currentOffer: SupplierItemOfferDTO | null;
  /** Última oferta sem vigência confiável — mostrada como referência, nunca como preço atual. */
  latestLegacyOffer: SupplierItemOfferDTO | null;
  offerCount: number;
  /**
   * O ITEM tem mais de um fornecedor com oferta elegível e nenhum
   * preferencial — o estado em que o motor devolve custo desconhecido.
   *
   * Vive na linha porque é ali que a pessoa decide: a grade lista relações,
   * e a ação que resolve (definir preferencial) é de uma relação. Resolvido
   * numa consulta agregada por item, nunca uma por linha.
   */
  costSourceAmbiguous: boolean;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

/**
 * Qual fonte o motor canônico escolheria para este item HOJE.
 *
 * Existe porque "oferta elegível" e "oferta usada" são coisas diferentes, e
 * confundir as duas é a leitura errada mais provável desta tela: uma compra
 * real dos últimos 30 dias vence qualquer oferta, e a pessoa que acabou de
 * cadastrar uma oferta válida precisa entender por que o custo não é o dela.
 *
 * Sai de `selectItemCostSource` — a mesma função do CMV, do cálculo
 * industrial e da estimativa de formulação. Não é um segundo motor, e por
 * isso só aparece no DETALHE: uma resolução por item na grade seria N+1.
 */
export interface SupplierItemCostSourceDTO {
  source: IndustrialMaterialCostSource;
  /** `null` quando a fonte é desconhecida ou ambígua — nunca zero. */
  unitCost: string | null;
  /** Unidade de estoque do item — é nela que o custo é expresso. */
  unitCode: string;
  details: string | null;
  /** Dia civil da pergunta. O domínio nunca decide a data sozinho. */
  referenceDate: string;
}

export interface SupplierItemDetailDTO extends SupplierItemDTO {
  offers: SupplierItemOfferDTO[];
  qualificationHistory: SupplierItemQualificationEventDTO[];
  /** A fonte que o motor usaria hoje para este item — não para esta relação. */
  costSourceToday: SupplierItemCostSourceDTO;
}

export interface SupplierItemListResponse {
  supplierItems: SupplierItemDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateSupplierItemInput {
  itemId: string;
  supplierId: string;
  supplierItemCode?: string | null;
  commercialNotes?: string | null;
  /**
   * Homologação, preferência e primeira oferta no mesmo cadastro.
   *
   * Todos opcionais: relação sem oferta continua sendo registro legítimo.
   * A oferta permanece entidade própria e imutável — o que mudou é apenas
   * quando ela pode ser informada, não como é guardada.
   */
  qualificationStatus?: "PENDING" | "APPROVED" | "BLOCKED";
  qualificationNote?: string | null;
  preferred?: boolean;
  initialOffer?: CreateSupplierItemOfferInput;
}

export interface UpdateSupplierItemInput {
  supplierItemCode?: string | null;
  commercialNotes?: string | null;
  active?: boolean;
}

export interface ChangeSupplierItemQualificationInput {
  status: SupplierItemQualificationStatus;
  note?: string | null;
}

export interface CreateSupplierItemOfferInput {
  unitPrice: string;
  currencyCode?: string;
  priceUomCode: string;
  minimumOrderQuantity?: string | null;
  minimumOrderUomCode?: string | null;
  /**
   * OBRIGATÓRIA numa oferta nova — a data a partir da qual o preço vale.
   *
   * A coluna continua aceitando nulo porque a planilha legada não tem data
   * de cotação, e inventar uma para ela seria escrever uma condição
   * comercial que ninguém negociou. O que muda é a porta de entrada: o que
   * nasce agora nasce com vigência, e a tela pré-preenche a data de hoje de
   * forma visível e editável em vez de o servidor supor "agora".
   */
  effectiveAt: string;
  validUntil?: string | null;
  notes?: string | null;
}
