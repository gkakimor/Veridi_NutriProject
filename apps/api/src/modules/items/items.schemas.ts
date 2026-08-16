import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { optionalEnum, optionalPurityPercent } from "../../lib/industrial-schema.js";

export const itemTypeSchema = z.enum([
  "RAW_MATERIAL",
  "PACKAGING",
  "FINISHED_PRODUCT",
]);

export const itemFamilySchema = optionalEnum([
  "VITAMIN",
  "MINERAL",
  "AMINO_ACID",
  "EXCIPIENT",
  "BOTANICAL",
  "OTHER_RAW_MATERIAL",
  "PACKAGING",
  "OTHER",
]);

export const packagingSubtypeSchema = optionalEnum([
  "POT",
  "CAP",
  "SCOOP",
  "SEAL",
  "LABEL",
  "BOX",
  "POUCH",
  "CARTON",
  "BOTTLE",
  "OTHER",
]);

/** Taxonomia industrial (capacidade 33) — toda opcional. */
const industrialItemFields = {
  sourceName: optionalNullableText(200),
  declaredNutrient: optionalNullableText(200),
  family: itemFamilySchema,
  defaultPurityPercent: optionalPurityPercent,
  packagingSubtype: packagingSubtypeSchema,
};

export const createItemSchema = z.object({
  type: itemTypeSchema,
  name: z.string().trim().min(1, "Nome é obrigatório").max(200),
  unitCode: z.string().trim().min(1, "Unidade é obrigatória"),
  controlsLot: z.boolean().optional(),
  controlsExpiry: z.boolean().optional(),
  requiresQualityRelease: z.boolean().optional(),
  requiresCoa: z.boolean().optional(),
  ...industrialItemFields,
  externalBarcode: z.string().trim().max(64).optional(),
});

export const updateItemSchema = z.object({
  type: itemTypeSchema.optional(),
  name: z.string().trim().min(1, "Nome é obrigatório").max(200).optional(),
  unitCode: z.string().trim().min(1, "Unidade é obrigatória").optional(),
  controlsLot: z.boolean().optional(),
  controlsExpiry: z.boolean().optional(),
  requiresQualityRelease: z.boolean().optional(),
  requiresCoa: z.boolean().optional(),
  ...industrialItemFields,
  externalBarcode: z.string().trim().max(64).optional(),
});

export const listItemsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  type: itemTypeSchema.optional(),
  family: z
    .enum([
      "VITAMIN",
      "MINERAL",
      "AMINO_ACID",
      "EXCIPIENT",
      "BOTANICAL",
      "OTHER_RAW_MATERIAL",
      "PACKAGING",
      "OTHER",
    ])
    .optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;
