import { z } from "zod";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

const applyFulfillmentPlanLineSchema = z.object({
  customerOrderLineId: z.string().trim().min(1, "Linha do pedido é obrigatória"),
  reserveQuantity: decimalStringSchema({ allowZero: true }),
  produceQuantity: decimalStringSchema({ allowZero: true }),
});

export const applyFulfillmentPlanSchema = z.object({
  lines: z.array(applyFulfillmentPlanLineSchema).min(1, "Informe ao menos uma linha do plano"),
});

export type ApplyFulfillmentPlanLineInput = z.infer<typeof applyFulfillmentPlanLineSchema>;
export type ApplyFulfillmentPlanInput = z.infer<typeof applyFulfillmentPlanSchema>;
