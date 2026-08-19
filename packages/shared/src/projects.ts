/**
 * Projetos private label e orçamentos versionados.
 *
 * `Project` é o funil comercial ANTES do produto existir; `Product` é o
 * produto aprovado e operacional. A aprovação do projeto é exatamente o
 * momento em que um vira o outro — nunca uma conversão automática no
 * cadastro inicial.
 */

import type {
  DosageForm,
  PresentationType,
  ProductLifecycle,
  TargetAgeGroup,
} from "./products.js";
import type { IndustrialCostQuality } from "./industrial-cost-calculation.js";

export const PROJECT_CODE_PREFIX = "PROJ";
export const QUOTE_CODE_PREFIX = "ORC";

export type ProjectStatus = "WAITING" | "SAMPLE" | "APPROVED" | "CANCELLED" | "STAND_BY";

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "WAITING",
  "SAMPLE",
  "APPROVED",
  "CANCELLED",
  "STAND_BY",
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  WAITING: "Aguardando",
  SAMPLE: "Amostra",
  APPROVED: "Aprovado",
  CANCELLED: "Cancelado",
  STAND_BY: "Stand-by",
};

export type ProjectCancelReason =
  | "PRICE"
  | "COMPETITOR"
  | "PROJECT_CHANGED"
  | "NOT_MET"
  | "OTHER";

export const PROJECT_CANCEL_REASONS: readonly ProjectCancelReason[] = [
  "PRICE",
  "COMPETITOR",
  "PROJECT_CHANGED",
  "NOT_MET",
  "OTHER",
];

export const PROJECT_CANCEL_REASON_LABELS: Record<ProjectCancelReason, string> = {
  PRICE: "Preço",
  COMPETITOR: "Concorrente",
  PROJECT_CHANGED: "Mudou o projeto",
  NOT_MET: "Não atendeu",
  OTHER: "Outro",
};

/** `LEGACY_IMPORT` explica estados históricos incompletos sem afrouxar o fluxo novo. */
export type ProjectSource = "MANUAL" | "LEGACY_IMPORT";

export const PROJECT_SOURCE_LABELS: Record<ProjectSource, string> = {
  MANUAL: "Cadastrado no sistema",
  LEGACY_IMPORT: "Importado da planilha",
};

export type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "ARCHIVED";

export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
  "ARCHIVED",
];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviado",
  ACCEPTED: "Aceito",
  REJECTED: "Recusado",
  SUPERSEDED: "Substituído",
  ARCHIVED: "Histórico",
};

export interface ProjectStatusHistoryDTO {
  id: string;
  fromStatus: ProjectStatus | null;
  toStatus: ProjectStatus;
  reason: string | null;
  changedAt: string;
  changedByName: string | null;
}

/**
 * De onde veio o preço do orçamento.
 *
 * `MANUAL` continua legítimo: o sistema aceita exceção comercial. Quando o
 * preço vem de uma faixa de precificação, ele carrega junto toda a cadeia
 * PREC → CALC → EC → Formulação, e é isso que torna a proposta auditável.
 */
export type QuotePriceSource = "MANUAL" | "PRICING_TIER";

export const QUOTE_PRICE_SOURCE_LABELS: Record<QuotePriceSource, string> = {
  MANUAL: "Preço manual",
  PRICING_TIER: "Faixa de precificação",
};

/** Proveniência econômica do preço — informação interna, nunca do cliente. */
export interface QuotePricingProvenanceDTO {
  pricingVersionId: string | null;
  pricingCode: string | null;
  pricingVersionNumber: number | null;
  pricingTierId: string | null;
  tierQuantity: string | null;
  tierUomCode: string | null;
  selectedUnitPrice: string | null;
  calculationCode: string | null;
  costReferenceDate: string | null;
  costStructureLabel: string | null;
  formulationVersionNumber: number | null;
  industrialCostPerUnit: string | null;
  costQuality: IndustrialCostQuality | null;
  commissionPercent: string | null;
  contributionPerUnit: string | null;
  contributionMarginPercent: string | null;
  markupPercent: string | null;
  warnings: { code: string; message: string }[];
  /** Congelado no envio; antes disso é a leitura viva da faixa vinculada. */
  frozen: boolean;
}

/**
 * Linha de orçamento: um produto, sua quantidade e seu preço.
 *
 * A proveniência é POR LINHA — uma pode vir de faixa de precificação e outra
 * ser exceção comercial manual na mesma proposta, e as duas são legítimas.
 */
export interface QuoteLineDTO {
  id: string;
  quoteVersionId: string;
  projectProductId: string | null;
  productId: string;
  productCode: string;
  productName: string;
  sortOrder: number;
  /** Decimal como string — nunca float. */
  quotedQuantity: string | null;
  uomCode: string | null;
  /** `null` = ainda não precificado; `"0"` é preço zero explícito. */
  unitPrice: string | null;
  /** `quotedQuantity × unitPrice`, derivado — nunca persistido. */
  total: string | null;
  priceSource: QuotePriceSource;
  /**
   * Só chega para quem pode ver custo e margem (comercial/administração).
   * O documento do cliente nunca expõe isso.
   */
  pricing: QuotePricingProvenanceDTO | null;
}

export type QuotePaymentMethod = "CASH" | "INSTALLMENTS";

export const QUOTE_PAYMENT_METHOD_LABELS: Record<QuotePaymentMethod, string> = {
  CASH: "À vista",
  INSTALLMENTS: "Parcelado",
};

/** Uma parcela do plano — valor e vencimento em dias a partir do aceite. */
export interface QuoteInstallmentDTO {
  number: number;
  amount: string;
  dueInDays: number;
}

/**
 * O plano de pagamento da proposta, derivado inteiramente no backend.
 *
 * Valor de parcela não se digita: se a proposta impressa e a conta do sistema
 * saíssem de fontes diferentes, elas divergiriam sem ninguém perceber. Tudo
 * aqui é consequência de subtotal, desconto, entrada, prazo e juros.
 */
export interface QuotePaymentScheduleDTO {
  /** Soma das linhas, antes do desconto. */
  subtotal: string;
  discountPercent: string | null;
  discountAmount: string;
  /** Subtotal menos desconto — o preço à vista da proposta. */
  total: string;
  method: QuotePaymentMethod;
  downPaymentPercent: string | null;
  downPayment: string | null;
  /** Total menos entrada: o que efetivamente é financiado. */
  financedAmount: string | null;
  monthlyInterestPercent: string | null;
  installmentIntervalDays: number | null;
  installments: QuoteInstallmentDTO[];
  /** Entrada mais a soma das parcelas. Igual a `total` quando não há juros. */
  totalPayable: string;
  /** `totalPayable − total`. `"0.00"` quando o parcelamento é sem juros. */
  interestAmount: string;
}

export interface QuoteVersionDTO {
  id: string;
  code: string;
  projectId: string;
  versionNumber: number;
  /** Rótulo de apresentação: "ORC-000123 · V2". */
  versionLabel: string;
  externalCode: string | null;
  status: QuoteStatus;
  source: ProjectSource;
  quoteDate: string;
  validUntil: string | null;
  currencyCode: string;
  /** Uma linha por produto. O cabeçalho não guarda quantidade nem preço. */
  lines: QuoteLineDTO[];
  /**
   * Soma das linhas, JÁ COM O DESCONTO aplicado — é o que a proposta vale.
   * `null` enquanto alguma linha essencial não tem preço: total parcial não
   * existe, existe subtotal conhecido.
   */
  total: string | null;
  /** Soma das linhas ANTES do desconto. `null` pelo mesmo motivo de `total`. */
  subtotal: string | null;
  discountPercent: string | null;
  paymentMethod: QuotePaymentMethod;
  downPaymentPercent: string | null;
  installmentCount: number | null;
  installmentIntervalDays: number | null;
  monthlyInterestPercent: string | null;
  /** Derivado. `null` quando ainda não há total (linha sem preço). */
  paymentSchedule: QuotePaymentScheduleDTO | null;
  commercialNotes: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  sentAt: string | null;
  sentByName: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  /** Snapshot congelado no envio — a impressão não depende do cadastro atual. */
  customerCode: string | null;
  customerName: string | null;
  customerTradeName: string | null;
  customerCnpj: string | null;
  customerZipCode: string | null;
  customerStreet: string | null;
  customerNumber: string | null;
  customerComplement: string | null;
  customerDistrict: string | null;
  customerCity: string | null;
  customerState: string | null;
  projectCode: string | null;
  projectName: string | null;
  projectConcept: string | null;
  projectChannel: string | null;
  createdAt: string;
  createdByName: string | null;
}

/** Situação comercial do produto dentro do projeto. */
export type ProjectProductStatus = "ACTIVE" | "APPROVED" | "OUT_OF_SCOPE";

export const PROJECT_PRODUCT_STATUS_LABELS: Record<ProjectProductStatus, string> = {
  ACTIVE: "Em desenvolvimento",
  APPROVED: "Aprovado",
  OUT_OF_SCOPE: "Fora do escopo",
};

/**
 * Produto dentro de um projeto.
 *
 * `status` é a situação COMERCIAL nesta negociação; `productLifecycle` é a
 * situação TÉCNICA do produto, que vale fora dela. Um produto pode estar
 * aprovado tecnicamente e fora do escopo comercial desta aprovação.
 */
export interface ProjectProductDTO {
  id: string;
  projectId: string;
  productId: string;
  productCode: string;
  productName: string;
  productLifecycle: string;
  productActive: boolean;
  sequence: number;
  status: ProjectProductStatus;
  /** Cadeia técnica/econômica deste produto — read model puro. */
  costing: ProjectCostingSummaryDTO | null;
  /** Última amostra deste produto, quando houver. */
  latestSampleCode: string | null;
  latestSampleLabel: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface ProjectProductListResponse {
  products: ProjectProductDTO[];
}

export interface ProjectDTO {
  id: string;
  code: string;
  externalCode: string | null;
  customerId: string;
  customerCode: string;
  customerName: string;
  name: string;
  concept: string | null;
  channel: string | null;
  status: ProjectStatus;
  source: ProjectSource;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  entryDate: string;
  notes: string | null;
  cancelReason: ProjectCancelReason | null;
  cancelReasonDetails: string | null;
  cancelledAt: string | null;
  approvedAt: string | null;
  /** Perfil técnico pretendido — brief, ainda não é Product. */
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  doseAmount: string | null;
  doseUomCode: string | null;
  dosesPerPackage: number | null;
  targetAgeGroup: TargetAgeGroup | null;
  minimumBatchQuantity: string | null;
  shelfLifeMonths: number | null;
  productId: string | null;
  productCode: string | null;
  /** Cadeia técnica/econômica do produto do projeto — read model puro. */
  costing: ProjectCostingSummaryDTO | null;
  productName: string | null;
  /** Última versão de orçamento (qualquer status). */
  latestQuoteLabel: string | null;
  latestQuoteStatus: QuoteStatus | null;
  /** Versão aceita vigente, quando existir. */
  acceptedQuoteLabel: string | null;
  /**
   * Produtos do projeto. `productId` acima continua sendo o produto
   * principal/legado — a associação real está aqui, e um projeto pode ter
   * vários.
   */
  products: ProjectProductDTO[];
  quoteVersions: QuoteVersionDTO[];
  statusHistory: ProjectStatusHistoryDTO[];
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
}

export interface ProjectListResponse {
  projects: ProjectDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/** Vocabulário já usado na base — sugestão, nunca lista fechada. */
export interface ProjectVocabularyResponse {
  concepts: string[];
  channels: string[];
}

export interface CreateProjectInput {
  customerId: string;
  name: string;
  concept?: string | null;
  channel?: string | null;
  externalCode?: string | null;
  responsibleUserId?: string | null;
  entryDate?: string;
  notes?: string | null;
  dosageForm?: DosageForm | null;
  presentationType?: PresentationType | null;
  doseAmount?: string | null;
  doseUomCode?: string | null;
  dosesPerPackage?: number | null;
  targetAgeGroup?: TargetAgeGroup | null;
  minimumBatchQuantity?: string | null;
  shelfLifeMonths?: number | null;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

export interface ChangeProjectStatusInput {
  status: ProjectStatus;
  reason?: string;
}

export interface CancelProjectInput {
  cancelReason: ProjectCancelReason;
  cancelReasonDetails?: string;
}

/** UOM do produto acabado quando o projeto ainda não tem Product. */
export interface ApproveProjectInput {
  finishedUnitCode?: string;
}

export interface UpdateQuoteVersionInput {
  quoteDate?: string;
  validUntil?: string | null;
  quotedQuantity?: string | null;
  uomCode?: string | null;
  unitPrice?: string | null;
  currencyCode?: string;
  commercialNotes?: string | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | null;
  discountPercent?: string | null;
  paymentMethod?: QuotePaymentMethod;
  downPaymentPercent?: string | null;
  installmentCount?: number | null;
  installmentIntervalDays?: number | null;
  monthlyInterestPercent?: string | null;
}

export interface RejectQuoteInput {
  reason?: string;
}

/** Resumo da cadeia Produto → Formulação → Custo → Preço de um projeto. */
export interface ProjectCostingSummaryDTO {
  productId: string;
  productCode: string;
  productName: string;
  lifecycle: ProductLifecycle;
  productActive: boolean;

  formulationVersionId: string | null;
  formulationVersionNumber: number | null;
  formulationStatus: string | null;

  industrialCostVersionId: string | null;
  industrialCostVersionLabel: string | null;
  industrialCostVersionStatus: string | null;

  calculationId: string | null;
  calculationCode: string | null;
  calculationQuality: IndustrialCostQuality | null;
  costReferenceDate: string | null;

  pricingVersionId: string | null;
  pricingLabel: string | null;
  pricingTierCount: number;
}

export interface PrepareTechnicalProductInput {
  /** Unidade do produto acabado; obrigatória quando o brief não a define. */
  finishedUnitCode?: string;
}

export interface ApplyQuotePricingInput {
  pricingTierId: string;
}

export interface SendQuoteVersionInput {
  /** Enviar proposta com custo industrial incompleto é decisão explícita. */
  confirmIncompleteCost?: boolean;
}
