import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { requireCurrentUser } from "../../lib/current-user.js";
import { CustomerMismatchError } from "../production-orders/production-orders.errors.js";
import { CustomerOrderNotFoundError } from "./customer-orders.errors.js";
import {
  applyFulfillmentPlan,
  createRemainderProductionOrder,
  getFulfillmentPlan,
} from "./fulfillment-plan.service.js";
import {
  CustomerOrderNotConfirmedError,
  ExcessiveReserveError,
  IncompletePlanCoverageError,
  MissingPlanLineError,
  NoPendingProductionError,
  ProductNoLongerValidForProductionError,
  RemainderExceedsPendingError,
  UnknownPlanLineError,
} from "./fulfillment-plan.errors.js";
import {
  applyFulfillmentPlanSchema,
  createRemainderOrderSchema,
} from "./fulfillment-plan.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof CustomerOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof CustomerOrderNotConfirmedError) {
    return { status: 400, body: { error: "order_not_confirmed", message: error.message } };
  }
  if (error instanceof MissingPlanLineError) {
    return { status: 400, body: { error: "missing_plan_line", message: error.message } };
  }
  if (error instanceof UnknownPlanLineError) {
    return { status: 400, body: { error: "unknown_plan_line", message: error.message } };
  }
  if (error instanceof IncompletePlanCoverageError) {
    return { status: 400, body: { error: "incomplete_plan_coverage", message: error.message } };
  }
  if (error instanceof ExcessiveReserveError) {
    return { status: 400, body: { error: "excessive_reserve", message: error.message } };
  }
  if (error instanceof NoPendingProductionError) {
    return { status: 400, body: { error: "no_pending_production", message: error.message } };
  }
  if (error instanceof RemainderExceedsPendingError) {
    return { status: 400, body: { error: "remainder_exceeds_pending", message: error.message } };
  }
  if (error instanceof ProductNoLongerValidForProductionError) {
    return { status: 400, body: { error: "product_no_longer_valid", message: error.message } };
  }
  /*
   * Nasce em `resolveOrderCustomerId`, dentro do `createDraftProductionOrderInTx`
   * que este endpoint chama: o Produto pertence a um cliente e o Pedido a outro.
   * É recusa de regra de negócio causada pelo que foi pedido — a mensagem chegava
   * certa à tela e o status dizia "erro do servidor", o que sujava o console e
   * reprovava suíte E2E. Mesmo status e mesmo código do irmão do módulo de
   * Projetos (`ProjectProductCustomerMismatchError`), que já respondia
   * `400 customer_mismatch`.
   */
  if (error instanceof CustomerMismatchError) {
    return { status: 400, body: { error: "customer_mismatch", message: error.message } };
  }
  return null;
}

/**
 * `GET /customer-orders/:id/fulfillment-plan` (análise, nunca persiste),
 * `POST /customer-orders/:id/apply-fulfillment-plan` (reserva Produto
 * Acabado + gera OPs DRAFT para o déficit, transacional).
 */
export const fulfillmentPlanRoutes: FastifyPluginAsync = async (app) => {
  app.get("/customer-orders/:id/fulfillment-plan", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await getFulfillmentPlan(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/:id/apply-fulfillment-plan", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = applyFulfillmentPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await applyFulfillmentPlan(id, parsed.data, requireCurrentUser(request)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/:id/remainder-production-order", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createRemainderOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await createRemainderProductionOrder(id, parsed.data, requireCurrentUser(request));
      return reply.status(201).send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
