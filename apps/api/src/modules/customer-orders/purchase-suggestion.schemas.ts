import { z } from "zod";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

const generatePurchaseDraftLineSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  supplierId: z.string().trim().min(1, "Fornecedor é obrigatório"),
  quantity: decimalStringSchema({ allowZero: true }),
});

export const generatePurchaseDraftsSchema = z.object({
  lines: z.array(generatePurchaseDraftLineSchema).min(1, "Informe ao menos um material"),
});

export type GeneratePurchaseDraftLineInput = z.infer<typeof generatePurchaseDraftLineSchema>;
export type GeneratePurchaseDraftsInput = z.infer<typeof generatePurchaseDraftsSchema>;
