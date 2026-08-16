import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";
import { optionalNullableDateSchema } from "../../lib/date-schema.js";

export const createSupplierItemSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  supplierId: z.string().trim().min(1, "Fornecedor é obrigatório"),
  supplierItemCode: optionalNullableText(60),
  commercialNotes: optionalNullableText(1000),
});

export const updateSupplierItemSchema = z.object({
  supplierItemCode: optionalNullableText(60),
  commercialNotes: optionalNullableText(1000),
  active: z.boolean().optional(),
});

export const changeQualificationSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "BLOCKED"]),
  note: optionalNullableText(1000),
});

export const setPreferredSchema = z.object({
  preferred: z.boolean(),
});

export const createOfferSchema = z.object({
  // Zero é zero explícito (bonificação); preço desconhecido não vira oferta.
  unitPrice: decimalStringSchema({ allowZero: true }),
  currencyCode: z.string().trim().min(3).max(3).optional(),
  priceUomCode: z.string().trim().min(1, "Unidade do preço é obrigatória"),
  minimumOrderQuantity: decimalStringSchema().optional(),
  minimumOrderUomCode: z.string().trim().min(1).optional(),
  effectiveAt: optionalNullableDateSchema,
  validUntil: optionalNullableDateSchema,
  notes: optionalNullableText(1000),
});

export const listSupplierItemsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  qualificationStatus: z.enum(["PENDING", "APPROVED", "BLOCKED"]).optional(),
  preferred: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  itemFamily: z.string().trim().min(1).optional(),
  itemType: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_PRODUCT"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSupplierItemInput = z.infer<typeof createSupplierItemSchema>;
export type UpdateSupplierItemInput = z.infer<typeof updateSupplierItemSchema>;
export type ChangeQualificationInput = z.infer<typeof changeQualificationSchema>;
export type SetPreferredInput = z.infer<typeof setPreferredSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type ListSupplierItemsQuery = z.infer<typeof listSupplierItemsQuerySchema>;
