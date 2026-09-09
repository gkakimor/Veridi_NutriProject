import { z } from "zod";
import { quantityDecimalSchema } from "../../lib/decimal-schema.js";

/**
 * Data civil `YYYY-MM-DD` — o negócio promete um DIA.
 *
 * Não é `z.coerce.date()` sobre texto livre: aceitar um instante deixaria a
 * promessa carregar uma hora que ninguém escolheu, e a comparação de atraso
 * passaria a depender do relógio (§72). O service materializa o marcador do
 * dia a partir desta string.
 */
const civilDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data no formato AAAA-MM-DD")
  .refine((valor) => !Number.isNaN(new Date(`${valor}T00:00:00.000Z`).getTime()), "Data inválida");

const deliveryLineSchema = z.object({
  customerOrderLineId: z.string().trim().min(1, "Linha do pedido é obrigatória"),
  quantity: quantityDecimalSchema({ allowZero: true }),
});

export const createDeliveryScheduleSchema = z.object({
  scheduledDate: civilDateSchema,
  notes: z.string().trim().max(500).optional(),
  lines: z.array(deliveryLineSchema).min(1, "Informe ao menos um produto"),
});

/**
 * Cancelar exige motivo: uma promessa desfeita sem explicação apaga a única
 * informação que torna o cancelamento auditável depois.
 */
export const cancelDeliveryScheduleSchema = z.object({
  reason: z.string().trim().min(3, "Informe o motivo do cancelamento"),
});

/**
 * Reprogramar não recebe quantidade: ela É o saldo ainda pendente da entrega
 * original. Deixar alguém digitá-la abriria a porta para a substituta nascer
 * com os 400 originais quando 250 já saíram.
 */
export const rescheduleDeliverySchema = z.object({
  scheduledDate: civilDateSchema,
  reason: z.string().trim().min(3, "Informe o motivo da reprogramação"),
  notes: z.string().trim().max(500).optional(),
});

export type CreateDeliveryScheduleBody = z.infer<typeof createDeliveryScheduleSchema>;
export type CancelDeliveryScheduleBody = z.infer<typeof cancelDeliveryScheduleSchema>;
export type RescheduleDeliveryBody = z.infer<typeof rescheduleDeliverySchema>;
