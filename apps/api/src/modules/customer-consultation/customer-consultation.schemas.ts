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
