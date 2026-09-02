import { z } from "zod";

/**
 * O `customerId` da rota é o CONTEXTO, não um filtro opcional: ele decide o
 * que pode ser lido. Por isso é sempre obrigatório e sempre validado antes
 * de qualquer busca.
 */
export const customerScopeParamsSchema = z.object({
  customerId: z.string().trim().min(1),
});

export const projectScopeParamsSchema = customerScopeParamsSchema.extend({
  projectId: z.string().trim().min(1),
});

export const orderScopeParamsSchema = customerScopeParamsSchema.extend({
  orderId: z.string().trim().min(1),
});

export const billingScopeParamsSchema = customerScopeParamsSchema.extend({
  billingId: z.string().trim().min(1),
});

export const productScopeParamsSchema = customerScopeParamsSchema.extend({
  productId: z.string().trim().min(1),
});

/** Mesma paginação das demais listas da Consulta. */
export const finishedGoodsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
