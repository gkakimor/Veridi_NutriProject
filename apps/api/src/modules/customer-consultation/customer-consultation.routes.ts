import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { CustomerNotFoundError } from "../customers/customers.errors.js";
import { NotInThisCustomerError } from "./customer-consultation.errors.js";
import {
  billingScopeParamsSchema,
  customerScopeParamsSchema,
  orderScopeParamsSchema,
  projectScopeParamsSchema,
} from "./customer-consultation.schemas.js";
import {
  getConsultationSummary,
  getScopedBilling,
  getScopedCustomerOrder,
  getScopedProject,
} from "./customer-consultation.service.js";

/**
 * Cliente inexistente e entidade de OUTRO Cliente terminam no mesmo 404.
 *
 * A tela só precisa saber que não há nada para mostrar sob este cabeçalho.
 * Responder "existe, mas é de outro cliente" vazaria exatamente aquilo que
 * o escopo existe para proteger.
 */
async function sendScoped<T>(reply: FastifyReply, load: () => Promise<T>) {
  try {
    return reply.send(await load());
  } catch (error) {
    if (error instanceof CustomerNotFoundError || error instanceof NotInThisCustomerError) {
      return reply.status(404).send({ error: "not_found" });
    }
    throw error;
  }
}

/**
 * `GET /customers/:customerId/consultation/...` — somente leitura.
 *
 * As LISTAS da Consulta não estão aqui de propósito: `GET /projects`,
 * `GET /customer-orders`, `GET /billings` e
 * `GET /inventory/customer-materials` já aceitam `customerId` e já paginam.
 * Duplicá-las criaria um segundo motor de busca para os mesmos dados.
 *
 * O que existe aqui é o que ainda não existia: o resumo e o ESCOPO dos
 * detalhes, onde o id da rota poderia apontar para outro Cliente.
 */
export const customerConsultationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/customers/:customerId/consultation/summary", async (request, reply) => {
    const parsed = customerScopeParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error" });
    return sendScoped(reply, () => getConsultationSummary(parsed.data.customerId));
  });

  app.get(
    "/customers/:customerId/consultation/projects/:projectId",
    async (request, reply) => {
      const parsed = projectScopeParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ error: "validation_error" });
      return sendScoped(reply, () =>
        getScopedProject(parsed.data.customerId, parsed.data.projectId),
      );
    },
  );

  app.get("/customers/:customerId/consultation/orders/:orderId", async (request, reply) => {
    const parsed = orderScopeParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error" });
    return sendScoped(reply, () =>
      getScopedCustomerOrder(parsed.data.customerId, parsed.data.orderId),
    );
  });

  app.get(
    "/customers/:customerId/consultation/billings/:billingId",
    async (request, reply) => {
      const parsed = billingScopeParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ error: "validation_error" });
      return sendScoped(reply, () =>
        getScopedBilling(parsed.data.customerId, parsed.data.billingId),
      );
    },
  );
};
