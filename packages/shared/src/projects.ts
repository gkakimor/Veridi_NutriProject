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
import type { PricingVersionDTO } from "./pricing.js";

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

/**
 * Qual DECISÃO COMERCIAL formou o preço desta linha — §74.
 *
 * Pergunta diferente de `QuotePriceSource`, que responde "tecnicamente veio de
 * faixa ou foi digitado?". Preço herdado de um acordo é tecnicamente manual e
 * comercialmente não é: ele é a condição que o cliente já aceitou.
 */
export type QuotePriceOrigin =
  | "INHERITED_AGREEMENT"
  | "ADJUSTED_AGREEMENT"
  | "CURRENT_PRICING"
  | "MANUAL";

export const QUOTE_PRICE_ORIGIN_LABELS: Record<QuotePriceOrigin, string> = {
  INHERITED_AGREEMENT: "Condição acordada",
  ADJUSTED_AGREEMENT: "Condição reajustada",
  CURRENT_PRICING: "Precificação atual",
  MANUAL: "Preço manual",
};

/** `null` é linha legada, gravada antes da regra — não se classifica por chute. */
export const QUOTE_PRICE_ORIGIN_LEGACY_LABEL = "Origem anterior";

/**
 * Duplicar uma versão do Orçamento como a próxima — QUOTE-DUPLICATE-01, §85.
 *
 * O preço é decisão EXPLÍCITA de quem duplica, e não existe padrão: um default
 * seria a herança silenciosa de volta, com um passo a mais. Manter copia
 * `unitPrice` exatamente; revisar deixa a linha sem preço, aguardando decisão.
 * Nenhuma das duas recalcula, rebaseia ou consulta a precificação atual.
 */
export const QUOTE_DUPLICATE_PRICE_STRATEGIES = ["KEEP_PRICES", "REVIEW_PRICES"] as const;

export type QuoteDuplicatePriceStrategy = (typeof QUOTE_DUPLICATE_PRICE_STRATEGIES)[number];

export const QUOTE_DUPLICATE_PRICE_STRATEGY_LABELS: Record<QuoteDuplicatePriceStrategy, string> = {
  KEEP_PRICES: "Manter os preços desta versão",
  REVIEW_PRICES: "Revisar os preços",
};

export interface DuplicateQuoteVersionInput {
  priceStrategy: QuoteDuplicatePriceStrategy;
}

/**
 * A condição comercial anterior que pode embasar esta linha.
 *
 * Sai da QuoteLine de uma proposta ACEITA do mesmo Projeto e Produto, a mais
 * recente por `acceptedAt`. Ela não deixa de ser história por já ter virado
 * Pedido; o que decide se pode ser SUGERIDA é a validade da proposta que a
 * registrou, e se a quantidade negociada é a mesma.
 */
export interface QuoteLineAgreementDTO {
  /** A QuoteLine real usada como base — é este id que o backend aceita. */
  sourceQuoteLineId: string;
  quoteVersionId: string;
  quoteCode: string;
  quoteVersionNumber: number;
  acceptedAt: string;
  /** `validUntil` da proposta que registrou o acordo. */
  validUntil: string | null;
  /** A condição está vencida para embasar uma negociação NOVA? */
  expired: boolean;
  unitPrice: string;
  quotedQuantity: string | null;
  uomCode: string | null;
  /**
   * A quantidade desta linha é fisicamente a mesma da condição, na unidade
   * canônica do produto (§68)? `false` quando a linha ainda não tem
   * quantidade — sem quantidade não há como afirmar equivalência.
   */
  sameQuantity: boolean;
  /**
   * Reutilizar exatamente esta condição exige motivo? Verdadeiro quando a
   * quantidade difere ou quando a condição está vencida.
   */
  requiresReason: boolean;
  /** Pode vir marcada como padrão: vigente e mesma quantidade física. */
  safeDefault: boolean;
}



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
   * A decisão comercial que formou este preço. `null` é linha legada — a UI
   * mostra "Origem anterior" e não inventa classificação.
   */
  priceOrigin: QuotePriceOrigin | null;
  /** A QuoteLine reutilizada como condição, quando o preço foi herdado. */
  inheritedFromQuoteLineId: string | null;
  /** Percentual aplicado sobre a condição anterior (`"8.0000"`). */
  adjustmentPercent: string | null;
  /** Por que a exceção foi aceita — quantidade diferente ou condição vencida. */
  priceOriginReason: string | null;
  /**
   * Só chega para quem pode ver custo e margem (comercial/administração).
   * O documento do cliente nunca expõe isso.
   */
  pricing: QuotePricingProvenanceDTO | null;
}

/**
 * Precificação ativa disponível para embasar uma linha da proposta.
 *
 * `pricing: null` é resposta NORMAL, não erro: um produto sem precificação
 * vigente é estado esperado do negócio, e a tela oferece preço manual. Por
 * isso a ausência vem em 200 com o envelope, e não em 404 — 404 aqui
 * significa que a LINHA não existe.
 */
export interface QuoteLinePricingOptionsResponse {
  pricing: PricingVersionDTO | null;
  /**
   * A condição comercial anterior desta linha. `null` é resposta NORMAL —
   * primeira compra do produto naquele projeto não tem condição, e a tela
   * não deve oferecer uma opção falsa de "manter".
   */
  agreement: QuoteLineAgreementDTO | null;
}

export type QuotePaymentMethod = "CASH" | "INSTALLMENTS";

export const QUOTE_PAYMENT_METHOD_LABELS: Record<QuotePaymentMethod, string> = {
  CASH: "À vista",
  INSTALLMENTS: "Parcelado",
};

/**
 * Os três inteiros das condições comerciais e os limites que a API aplica —
 * uma fonte só, para a tela recusar exatamente o que o servidor recusaria
 * (QUOTE-INT-FIELDS-01). `maximo: null` é sem teto; vazio continua sendo "não
 * informado".
 */
export const LIMITES_INTEIROS_DAS_CONDICOES = {
  leadTimeDays: { minimo: 1, maximo: null },
  installmentCount: { minimo: 1, maximo: 120 },
  installmentIntervalDays: { minimo: 1, maximo: 365 },
} as const satisfies Record<string, { minimo: number; maximo: number | null }>;

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

/** O pedido que nasceu de uma proposta aceita. */
export interface QuoteSourcedOrderDTO {
  id: string;
  code: string;
  status: string;
  createdAt: string;
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
  /**
   * A janela de aceite fechou — derivado, nunca gravado.
   *
   * Só é `true` em proposta ENVIADA cuja validade já passou: o dia inteiro da
   * validade conta, e proposta aceita não vence retroativamente. O servidor é
   * a autoridade; a tela desenha, não decide.
   */
  expired: boolean;
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
  /**
   * Pedido gerado a partir desta proposta aceita. `null` enquanto não houver.
   *
   * Existe para a navegação não ser de mão única: quem abre a proposta chega
   * ao pedido, e quem abre o pedido chega à proposta.
   */
  sourcedOrder: QuoteSourcedOrderDTO | null;
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
  /**
   * Contato do Cliente, PROJETADO do cadastro atual — nunca copiado nem
   * congelado no Projeto.
   *
   * Quem trabalha dentro de um Projeto precisa ligar para o cliente, e saía
   * da tela para descobrir o número. O valor é sempre o que está em
   * `Customer` agora: mudar o telefone no cadastro muda o que o Projeto
   * mostra na próxima leitura, sem sincronização e sem job. `null` é campo
   * não preenchido no cadastro, e a tela diz isso — nunca esconde o rótulo.
   */
  customerPhone: string | null;
  customerEmail: string | null;
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
