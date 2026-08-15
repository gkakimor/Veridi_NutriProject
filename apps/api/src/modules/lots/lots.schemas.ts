import { z } from "zod";

export const blockLotSchema = z.object({
  reason: z.string().trim().min(3, "Motivo do bloqueio é obrigatório").max(500),
});

export const listLotsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  status: z.enum(["AWAITING_RELEASE", "AVAILABLE", "BLOCKED", "EXPIRED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const lookupLotQuerySchema = z.object({
  code: z.string().trim().min(1, "Informe o código do lote"),
});

export type BlockLotInput = z.infer<typeof blockLotSchema>;
export type ListLotsQuery = z.infer<typeof listLotsQuerySchema>;
export type LookupLotQuery = z.infer<typeof lookupLotQuerySchema>;
