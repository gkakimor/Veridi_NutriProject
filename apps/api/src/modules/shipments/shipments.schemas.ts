import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

const shipmentLineInputSchema = z.object({
  customerOrderReservationLineId: z.string().trim().min(1, "Linha de reserva é obrigatória"),
  quantity: decimalStringSchema({ allowZero: true }),
});

export const updateShipmentSchema = z.object({
  notes: optionalNullableText(1000),
  lines: z.array(shipmentLineInputSchema).optional(),
});

export const cancelShipmentSchema = z.object({
  reason: z.string().trim().min(3, "Motivo do cancelamento é obrigatório").max(500),
});

export const listShipmentsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerOrderId: z.string().trim().min(1).optional(),
  status: z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const reserveAvailableLineSchema = z.object({
  customerOrderLineId: z.string().trim().min(1, "Linha do pedido é obrigatória"),
  quantity: decimalStringSchema({ allowZero: true }),
});

export const reserveAvailableSchema = z.object({
  lines: z.array(reserveAvailableLineSchema).min(1, "Informe ao menos uma linha"),
});

export const reallocateReservationLineSchema = z.object({
  customerOrderReservationLineId: z.string().trim().min(1, "Linha de reserva é obrigatória"),
});

export type ShipmentLineInput = z.infer<typeof shipmentLineInputSchema>;
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;
export type CancelShipmentInput = z.infer<typeof cancelShipmentSchema>;
export type ListShipmentsQuery = z.infer<typeof listShipmentsQuerySchema>;
export type ReserveAvailableInput = z.infer<typeof reserveAvailableSchema>;
export type ReallocateReservationLineInput = z.infer<typeof reallocateReservationLineSchema>;
