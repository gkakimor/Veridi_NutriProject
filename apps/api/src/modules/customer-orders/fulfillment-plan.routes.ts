import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { CustomerOrderNotFoundError } from "./customer-orders.errors.js";
import { applyFulfillmentPlan, getFulfillmentPlan } from "./fulfillment-plan.service.js";
import {
  CustomerOrderNotConfirmedError,
  ExcessiveReserveError,
  IncompletePlanCoverageError,
  MissingPlanLineError,
  ProductNoLongerValidForProductionError,
  UnknownPlanLineError,
} from "./fulfillment-plan.errors.js";
import { applyFulfillmentPlanSchema } from "./fulfillment-plan.schemas.js";

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
  if (error instanceof ProductNoLongerValidForProductionError) {
    return { status: 400, body: { error: "product_no_longer_valid", message: error.message } };
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
      return reply.send(await applyFulfillmentPlan(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
