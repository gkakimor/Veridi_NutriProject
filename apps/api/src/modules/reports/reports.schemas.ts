import { z } from "zod";
import { requiredDateSchema } from "../../lib/date-schema.js";

/**
 * Flag booleana vinda da query string. `z.coerce.boolean()` nao serve aqui:
 * a string "false" seria coagida para `true`.
 */
function booleanFlag(defaultValue: boolean) {
  return z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) =>
      typeof value === "boolean" ? value : !["false", "0", "no", ""].includes(value.trim().toLowerCase()),
    );
}

/**
 * Filtros e paginação dos relatórios ficam SEPARADOS de propósito: o filtro
 * define o resultado, a paginação define só a fatia devolvida. A exportação
 * (capacidade 32) vai reutilizar exatamente os mesmos filtros pedindo o
 * resultado completo — nunca reconstruindo CSV a partir da página.
 */
export const paginationFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  /**
   * Caminho explícito para o resultado FILTRADO COMPLETO — usado pela
   * impressão, que precisa do relatório inteiro e não da página aberta. O
   * teto de `pageSize` continua valendo só para a navegação da tela.
   */
  all: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((value) =>
      typeof value === "boolean" ? value : !["false", "0", "no", ""].includes(value.trim().toLowerCase()),
    ),
};

/**
 * Intervalo temporal explícito. O frontend resolve os limites e envia em
 * ISO — mesma estratégia do Dashboard, sem segunda interpretação de datas
 * nem dependência silenciosa do fuso do servidor.
 */
export const periodFields = {
  from: requiredDateSchema.optional(),
  to: requiredDateSchema.optional(),
};

/* ── Estoque ── */

export const inventoryPositionQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  itemType: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_PRODUCT"]).optional(),
  status: z.enum(["AWAITING_RELEASE", "AVAILABLE", "BLOCKED", "EXPIRED"]).optional(),
  location: z.string().trim().min(1).optional(),
  ownerType: z.enum(["VERIDI", "CUSTOMER"]).optional(),
  ownerCustomerId: z.string().trim().min(1).optional(),
  /** Padrão do relatório: fotografia do que existe fisicamente hoje. */
  onlyWithBalance: booleanFlag(true),
  ...paginationFields,
});

export const expiryQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  itemType: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_PRODUCT"]).optional(),
  /** Janelas prontas; `CUSTOM` usa `from`/`to`. */
  window: z.enum(["EXPIRED", "D7", "D30", "D60", "CUSTOM"]).default("D30"),
  onlyWithBalance: booleanFlag(true),
  ...periodFields,
  ...paginationFields,
});

export const movementsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  lotId: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  sourceType: z.string().trim().min(1).optional(),
  ...periodFields,
  ...paginationFields,
});

/* ── Produção ── */

export const requirementsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  productionOrderId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  status: z.enum(["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION"]).optional(),
  onlyShortage: booleanFlag(false),
  ...paginationFields,
});

export const plannedActualQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  productionOrderId: z.string().trim().min(1).optional(),
  /**
   * Padrão `COMPLETED`: o período usa `completedAt`. Com outro status o
   * período passa a usar `createdAt` — nunca misturado em silêncio.
   */
  status: z.enum(["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION", "COMPLETED", "CANCELLED"]).optional(),
  includeCost: booleanFlag(false),
  ...periodFields,
  ...paginationFields,
});

export const productionTraceabilityQuerySchema = z.object({
  productionOrderId: z.string().trim().min(1, "Informe a Ordem de Produção"),
});

export const consumptionQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  productionOrderId: z.string().trim().min(1).optional(),
  ...periodFields,
  ...paginationFields,
});

/* ── Compras ── */

export const purchaseOrdersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  status: z.enum(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]).optional(),
  origin: z.enum(["MANUAL", "CUSTOMER_ORDER"]).optional(),
  ...periodFields,
  ...paginationFields,
});

export const receiptsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  purchaseOrderId: z.string().trim().min(1).optional(),
  ...periodFields,
  ...paginationFields,
});

export const onOrderQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  ...paginationFields,
});

/* ── Comercial ── */

export const customerOrdersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  status: z
    .enum(["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED", "SHIPPED", "CANCELLED"])
    .optional(),
  ...periodFields,
  ...paginationFields,
});

export const fulfillmentQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  customerOrderId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  status: z
    .enum(["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED", "SHIPPED", "CANCELLED"])
    .optional(),
  ...periodFields,
  ...paginationFields,
});

export const orderOperationQuerySchema = z.object({
  customerOrderId: z.string().trim().min(1, "Informe o Pedido"),
});

/* ── Faturamento ── */

export const billingPeriodQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  customerOrderId: z.string().trim().min(1).optional(),
  ...periodFields,
  ...paginationFields,
});

export const awaitingBillingQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  ...paginationFields,
});

export type InventoryPositionQuery = z.infer<typeof inventoryPositionQuerySchema>;
export type ExpiryQuery = z.infer<typeof expiryQuerySchema>;
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;
export type RequirementsQuery = z.infer<typeof requirementsQuerySchema>;
export type PlannedActualQuery = z.infer<typeof plannedActualQuerySchema>;
export type ProductionTraceabilityQuery = z.infer<typeof productionTraceabilityQuerySchema>;
export type ConsumptionQuery = z.infer<typeof consumptionQuerySchema>;
export type PurchaseOrdersQuery = z.infer<typeof purchaseOrdersQuerySchema>;
export type ReceiptsQuery = z.infer<typeof receiptsQuerySchema>;
export type OnOrderQuery = z.infer<typeof onOrderQuerySchema>;
export const industrialCostByProductQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  ...paginationFields,
});

export type IndustrialCostByProductQuery = z.infer<typeof industrialCostByProductQuerySchema>;
export type CustomerOrdersQuery = z.infer<typeof customerOrdersQuerySchema>;
export type FulfillmentQuery = z.infer<typeof fulfillmentQuerySchema>;
export type OrderOperationQuery = z.infer<typeof orderOperationQuerySchema>;
export type BillingPeriodQuery = z.infer<typeof billingPeriodQuerySchema>;
export type AwaitingBillingQuery = z.infer<typeof awaitingBillingQuerySchema>;
