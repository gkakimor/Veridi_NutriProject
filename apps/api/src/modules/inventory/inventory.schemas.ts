import { z } from "zod";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

export const listInventoryQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_PRODUCT"]).optional(),
  onlyWithStock: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listInventoryMovementsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  lotId: z.string().trim().min(1).optional(),
  type: z.enum(["RECEIPT_IN", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "LOSS"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createInventoryAdjustmentSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  lotId: z.string().trim().min(1).optional(),
  type: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "LOSS"]),
  quantity: decimalStringSchema(),
  reason: z.string().trim().min(3, "Motivo é obrigatório"),
});

export const stockCountSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  lotId: z.string().trim().min(1).optional(),
  countedQuantity: decimalStringSchema({ allowZero: true }),
  reason: z.string().trim().min(3).optional(),
});

export const allocationSuggestionQuerySchema = z.object({
  quantity: decimalStringSchema(),
});

export const listCustomerMaterialsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  status: z.enum(["AWAITING_RELEASE", "AVAILABLE", "BLOCKED", "EXPIRED"]).optional(),
  onlyWithBalance: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (typeof value === "string" ? value === "true" : (value ?? false))),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;
export type ListCustomerMaterialsQuery = z.infer<typeof listCustomerMaterialsQuerySchema>;
export type ListInventoryMovementsQuery = z.infer<typeof listInventoryMovementsQuerySchema>;
export type CreateInventoryAdjustmentInput = z.infer<typeof createInventoryAdjustmentSchema>;
export type StockCountInput = z.infer<typeof stockCountSchema>;
export type AllocationSuggestionQuery = z.infer<typeof allocationSuggestionQuerySchema>;
