import { z } from "zod";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

export const confirmPickingSchema = z.object({
  lotCode: z.string().trim().min(1).optional(),
});

export const substituteReservationLineSchema = z.object({
  lotCode: z.string().trim().min(1, "Informe o código do lote alternativo"),
});

const consumptionEntrySchema = z.object({
  reservationLineId: z.string().trim().min(1, "Linha de reserva é obrigatória"),
  quantity: decimalStringSchema(),
});

/**
 * Ampliacao explicita da reserva. `lotCode` ausente significa "no mesmo
 * lote desta linha" — nunca "escolha um por mim". Motivo e obrigatorio no
 * schema, nao so no servico: ampliar reserva sem justificativa nao e um
 * pedido incompleto, e um pedido diferente.
 */
export const addExtraReservationSchema = z.object({
  quantity: decimalStringSchema(),
  reason: z.string().trim().min(1, "Informe o motivo do consumo adicional"),
  lotCode: z.string().trim().min(1).optional(),
});

export const recordConsumptionSchema = z.object({
  entries: z.array(consumptionEntrySchema).min(1, "Informe ao menos uma linha de consumo"),
});

export type ConfirmPickingInput = z.infer<typeof confirmPickingSchema>;
export type SubstituteReservationLineInput = z.infer<typeof substituteReservationLineSchema>;
export type AddExtraReservationInput = z.infer<typeof addExtraReservationSchema>;
export type RecordConsumptionInput = z.infer<typeof recordConsumptionSchema>;
