import { z } from "zod";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

export const registerWeighingSchema = z.object({
  requirementId: z.string().trim().min(1, "Material é obrigatório"),
  /** Aceita `LT-...` ou o payload do QR (`LOT:LT-...`) — mesma normalização do Picking. */
  lotCode: z.string().trim().min(1, "Informe o lote pesado"),
  actualQuantity: decimalStringSchema(),
  notes: z.string().trim().max(500).optional(),
});

export type RegisterWeighingInput = z.infer<typeof registerWeighingSchema>;
