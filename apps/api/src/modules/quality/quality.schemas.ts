import { z } from "zod";
import { booleanoDeConsultaSchema } from "../../lib/boolean-schema.js";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";

export const approveCoaSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export const rejectCoaSchema = z.object({
  // Rejeição sem motivo não é auditável.
  reason: z.string().trim().min(3, "Informe o motivo da rejeição").max(1000),
});

export const listQualityQueueQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  ownerCustomerId: z.string().trim().min(1).optional(),
  coaStatus: z.enum(["NOT_REQUIRED", "PENDING", "RECEIVED", "APPROVED", "REJECTED"]).optional(),
  lotStatus: z.enum(["AWAITING_RELEASE", "AVAILABLE", "BLOCKED", "EXPIRED"]).optional(),
  /**
   * `"true"`/`"false"` exatos, o resto é 400 (QUERY-BOOLEAN-PERMISSIVE-REMAINING-01):
   * todo texto fora de `"true"` era `false` calado — `?onlyPending=1` mostrava
   * a fila inteira e `?onlyWithBalance=1` trazia o lote zerado. Ausente: sem
   * recorte, o "Todos". O padrão da tela (só o que exige ação da Qualidade)
   * chega como `onlyPending=true`.
   */
  onlyPending: booleanoDeConsultaSchema().default(false),
  onlyWithBalance: booleanoDeConsultaSchema().default(false),
  page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
  pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
});

export type ApproveCoaInput = z.infer<typeof approveCoaSchema>;
export type RejectCoaInput = z.infer<typeof rejectCoaSchema>;
export type ListQualityQueueQuery = z.infer<typeof listQualityQueueQuerySchema>;
