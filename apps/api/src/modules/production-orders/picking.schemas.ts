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

export const recordConsumptionSchema = z.object({
  entries: z.array(consumptionEntrySchema).min(1, "Informe ao menos uma linha de consumo"),
});

export type ConfirmPickingInput = z.infer<typeof confirmPickingSchema>;
export type SubstituteReservationLineInput = z.infer<typeof substituteReservationLineSchema>;
export type RecordConsumptionInput = z.infer<typeof recordConsumptionSchema>;
