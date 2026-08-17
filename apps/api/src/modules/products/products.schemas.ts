import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import {
  optionalEnum,
  optionalPositiveDecimal,
  optionalPositiveInt,
} from "../../lib/industrial-schema.js";

/** Relacao opcional por id: "" vira null (desvincula), valor seta, chave ausente nao mexe. */
const optionalRelationId = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value.length === 0 ? null : value;
  });

/** Perfil industrial do Product (capacidade 33) — cadastro, sem cálculo. */
const industrialProductFields = {
  dosageForm: optionalEnum(["CAPSULE", "POWDER", "TABLET", "LIQUID", "OTHER"]),
  presentationType: optionalEnum(["POT", "POUCH", "CARTON", "BULK", "BOTTLE", "OTHER"]),
  capsulesPerDose: optionalPositiveInt("Cápsulas por dose deve ser maior que zero"),
  doseAmount: optionalPositiveDecimal("Dose deve ser maior que zero"),
  doseUomCode: optionalNullableText(20),
  dosesPerPackage: optionalPositiveInt("Doses por embalagem deve ser maior que zero"),
  unitsPerShippingBox: optionalPositiveInt("Unidades por caixa deve ser maior que zero"),
  targetAgeGroup: optionalEnum(["ADULT", "CHILD", "PREGNANT", "LACTATING", "OTHER"]),
  shelfLifeMonths: optionalPositiveInt("Vida útil deve ser maior que zero"),
  businessLotCode: optionalNullableText(20),
  minimumBatchQuantity: optionalPositiveDecimal("Lote mínimo deve ser maior que zero"),
};

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(200),
  customerId: optionalRelationId,
  finishedProductItemId: optionalRelationId,
  ...industrialProductFields,
  externalCode: optionalNullableText(100),
  notes: optionalNullableText(1000),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(200).optional(),
  customerId: optionalRelationId,
  finishedProductItemId: optionalRelationId,
  ...industrialProductFields,
  externalCode: optionalNullableText(100),
  notes: optionalNullableText(1000),
});

export const listProductsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  customerId: z.string().trim().min(1).optional(),
  /** Seletor operacional pede APPROVED; gestão de custo aceita os dois. */
  lifecycle: z.enum(["DEVELOPMENT", "APPROVED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  /* Seletor de tela carrega o catálogo inteiro num <select>; com teto de
   100 o cadastro 101 em diante ficava impossível de escolher. */
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
