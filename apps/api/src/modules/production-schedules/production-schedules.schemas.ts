import { z } from "zod";
import { ehDiaCivil } from "@veridi/shared";
import { optionalNullableText } from "../../lib/cnpj-schema.js";

/**
 * Contrato de entrada da programação (PLANNING-CAPACITY-BOARD-01).
 *
 * O início entra como INSTANTE ISO, e não como dia civil: aqui a pergunta tem
 * hora — "segunda às 08:00" —, ao contrário do período do quadro, que é um
 * recorte de dias comerciais.
 */

const instanteSchema = z
  .string()
  .trim()
  .refine((valor) => Number.isFinite(Date.parse(valor)), "Informe uma data e hora válidas");

export const scheduleProductionOrderSchema = z.object({
  startAt: instanteSchema,
  notes: optionalNullableText(500),
  /*
   * Confirmação explícita para ordem já liberada. Nunca tem default `true`:
   * a confirmação existe para ser dada, não para ser presumida.
   */
  confirmReleased: z.boolean().optional(),
});

const diaCivilSchema = z
  .string()
  .trim()
  .refine(ehDiaCivil, "Informe uma data existente, no formato AAAA-MM-DD");

export const productionBoardQuerySchema = z.object({
  /** Recorte em DIAS COMERCIAIS. O fim é inclusivo, como a tela mostra. */
  from: diaCivilSchema,
  to: diaCivilSchema,
  view: z.enum(["DAY", "WEEK"]).default("WEEK"),
  status: z
    .enum(["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION", "COMPLETED", "BLOCKED", "CANCELLED"])
    .optional(),
  productId: z.string().uuid().optional(),
  industrialResourceId: z.string().uuid().optional(),
});

export type ScheduleProductionOrderInput = z.infer<typeof scheduleProductionOrderSchema>;
export type ProductionBoardQuery = z.infer<typeof productionBoardQuerySchema>;
