import { z } from "zod";
import { requiredDateSchema } from "../../lib/date-schema.js";

export const listFinishedGoodsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: z.enum(["AWAITING_RELEASE", "AVAILABLE", "BLOCKED", "EXPIRED"]).optional(),
  productId: z.string().trim().min(1).optional(),
  productionOrderId: z.string().trim().min(1).optional(),
  dateFrom: requiredDateSchema.optional(),
  dateTo: requiredDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListFinishedGoodsQuery = z.infer<typeof listFinishedGoodsQuerySchema>;
