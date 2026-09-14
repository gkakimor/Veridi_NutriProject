import { z } from "zod";
import { booleanoDeConsultaSchema } from "../../lib/boolean-schema.js";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";
import { INVENTORY_MOVEMENT_TYPES } from "@veridi/shared";
import { quantityDecimalSchema } from "../../lib/decimal-schema.js";

/**
 * Filtro de tipo de movimento: a lista canônica do domínio, nunca uma cópia.
 *
 * Enquanto este schema listava quatro tipos à mão, a tela de Movimentações
 * oferecia os nove de `INVENTORY_MOVEMENT_TYPE_LABELS` e cinco deles
 * devolviam `400` — `PRODUCTION_CONSUMPTION`, `SAMPLE_CONSUMPTION`,
 * `OPENING_BALANCE`, `FINISHED_GOOD_PRODUCTION` e `SHIPMENT_OUT`. São
 * exatamente os eventos que se consulta numa auditoria de estoque, e a tela
 * mantinha a tabela anterior com o contador intacto, então o operador lia um
 * resultado que não correspondia ao filtro escolhido.
 *
 * Derivar da lista compartilhada faz um tipo novo do domínio nascer
 * consultável em vez de nascer quebrando o filtro.
 */
const inventoryMovementTypeSchema = z.enum(
  INVENTORY_MOVEMENT_TYPES as unknown as [string, ...string[]],
);

export const listInventoryQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_PRODUCT"]).optional(),
  onlyWithStock: booleanoDeConsultaSchema().optional(),
  page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
  pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
});

export const listInventoryMovementsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  lotId: z.string().trim().min(1).optional(),
  type: inventoryMovementTypeSchema.optional(),
  page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
  pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
});

export const createInventoryAdjustmentSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  lotId: z.string().trim().min(1).optional(),
  /**
   * Restrição deliberada, e por isso NÃO deriva da lista canônica: ajuste
   * cria apenas ajuste e perda. `PRODUCTION_CONSUMPTION`, `SHIPMENT_OUT` e
   * os demais nascem do documento que os origina — permitir criá-los por
   * aqui seria fabricar um movimento sem operação por trás. Consultar todos
   * os tipos é auditoria; criar qualquer tipo é falsificação.
   */
  type: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "LOSS"]),
  quantity: quantityDecimalSchema(),
  reason: z.string().trim().min(3, "Motivo é obrigatório"),
});

export const stockCountSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  lotId: z.string().trim().min(1).optional(),
  countedQuantity: quantityDecimalSchema({ allowZero: true }),
  reason: z.string().trim().min(3).optional(),
});

export const allocationSuggestionQuerySchema = z.object({
  quantity: quantityDecimalSchema(),
});

export const listCustomerMaterialsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  status: z.enum(["AWAITING_RELEASE", "AVAILABLE", "BLOCKED", "EXPIRED"]).optional(),
  /**
   * `"true"`/`"false"` exatos; ausente é `false` — todos os lotes, como a
   * lista e o CSV sempre leram. A leitura antiga tomava todo texto fora de
   * `"true"` por `false`, calada: `?onlyWithBalance=1` listava o lote zerado
   * (CUSTOMER-MATERIALS-ONLY-WITH-BALANCE-PERMISSIVE-01).
   */
  onlyWithBalance: booleanoDeConsultaSchema().default(false),
  page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
  pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
});

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;
export type ListCustomerMaterialsQuery = z.infer<typeof listCustomerMaterialsQuerySchema>;
export type ListInventoryMovementsQuery = z.infer<typeof listInventoryMovementsQuerySchema>;
export type CreateInventoryAdjustmentInput = z.infer<typeof createInventoryAdjustmentSchema>;
export type StockCountInput = z.infer<typeof stockCountSchema>;
export type AllocationSuggestionQuery = z.infer<typeof allocationSuggestionQuerySchema>;
