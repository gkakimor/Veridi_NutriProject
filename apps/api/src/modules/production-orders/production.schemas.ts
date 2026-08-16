import { z } from "zod";
import { decimalStringSchema } from "../../lib/decimal-schema.js";
import { requiredDateSchema } from "../../lib/date-schema.js";

export const registerProductionOutputSchema = z
  .object({
    quantity: decimalStringSchema(),
    destination: z.enum(["NEW_LOT", "EXISTING_LOT"]),
    lotId: z.string().trim().min(1).optional(),
    businessLotNumber: z.string().trim().min(1).optional(),
    expiryDate: requiredDateSchema.optional(),
    location: z.string().trim().min(1).optional(),
    notes: z.string().trim().min(1).optional(),
    producedAt: requiredDateSchema.optional(),
  })
  .refine((data) => data.destination !== "EXISTING_LOT" || !!data.lotId, {
    message: "Selecione o lote existente desta Ordem",
    path: ["lotId"],
  });

export const completeProductionOrderSchema = z.object({
  completionReason: z.string().trim().min(1).optional(),
});

export type RegisterProductionOutputSchema = z.infer<typeof registerProductionOutputSchema>;
export type CompleteProductionOrderSchema = z.infer<typeof completeProductionOrderSchema>;
