import { z } from "zod";

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
  /** Padrão da tela: só o que exige ação da Qualidade. */
  onlyPending: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (typeof value === "string" ? value === "true" : (value ?? false))),
  onlyWithBalance: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (typeof value === "string" ? value === "true" : (value ?? false))),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ApproveCoaInput = z.infer<typeof approveCoaSchema>;
export type RejectCoaInput = z.infer<typeof rejectCoaSchema>;
export type ListQualityQueueQuery = z.infer<typeof listQualityQueueQuerySchema>;
