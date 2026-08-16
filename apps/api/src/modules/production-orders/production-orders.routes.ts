import type { FastifyPluginAsync } from "fastify";
import { requireCurrentUser } from "../../lib/current-user.js";
import type { ZodError } from "zod";
import {
  cancelProductionOrder,
  createProductionOrder,
  getProductionOrderById,
  listProductionOrders,
  planProductionOrder,
  releaseProductionOrder,
  updateProductionOrder,
} from "./production-orders.service.js";
import {
  FormulationVersionNotFoundError,
  FormulationVersionProductMismatchError,
  InactiveProductError,
  InvalidTransitionError,
  MissingFinishedItemError,
  OrderLockedError,
  PlanValidationError,
  ProductNotFoundError,
  ProductionOrderNotFoundError,
  ReleaseValidationError,
} from "./production-orders.errors.js";
import {
  cancelProductionOrderSchema,
  createProductionOrderSchema,
  listProductionOrdersQuerySchema,
  updateProductionOrderSchema,
} from "./production-orders.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ProductNotFoundError) {
    return { status: 400, body: { error: "product_not_found", message: error.message } };
  }
  if (error instanceof InactiveProductError) {
    return { status: 400, body: { error: "inactive_product", message: error.message } };
  }
  if (error instanceof MissingFinishedItemError) {
    return { status: 400, body: { error: "missing_finished_item", message: error.message } };
  }
  if (error instanceof FormulationVersionNotFoundError) {
    return { status: 400, body: { error: "version_not_found", message: error.message } };
  }
  if (error instanceof FormulationVersionProductMismatchError) {
    return { status: 400, body: { error: "version_product_mismatch", message: error.message } };
  }
  if (error instanceof ProductionOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof InvalidTransitionError) {
    return { status: 400, body: { error: "invalid_transition", message: error.message } };
  }
  if (error instanceof OrderLockedError) {
    return { status: 400, body: { error: "order_locked", message: error.message } };
  }
  if (error instanceof PlanValidationError) {
    return { status: 400, body: { error: "plan_validation_failed", message: error.message } };
  }
  if (error instanceof ReleaseValidationError) {
    return { status: 400, body: { error: "release_validation_failed", message: error.message } };
  }
  return null;
}

/**
 * `GET /production-orders`, `GET /production-orders/:id`, `POST /production-orders`,
 * `PATCH /production-orders/:id`, `POST /production-orders/:id/plan`,
 * `POST /production-orders/:id/release`, `POST /production-orders/:id/cancel`.
 *
 * Sem PATCH de status livre — so as transicoes DRAFT->PLANNED (via /plan),
 * PLANNED->RELEASED (via /release) e DRAFT|PLANNED|RELEASED->CANCELLED
 * (via /cancel) existem nesta entrega.
 */
export const productionOrdersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/production-orders", async (request, reply) => {
    const parsed = listProductionOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listProductionOrders(parsed.data);
    return reply.send(result);
  });

  app.get("/production-orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await getProductionOrderById(id);
    if (!order) return reply.status(404).send({ error: "not_found" });
    return reply.send(order);
  });

  app.post("/production-orders", async (request, reply) => {
    const parsed = createProductionOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await createProductionOrder(parsed.data);
      return reply.status(201).send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/production-orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateProductionOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await updateProductionOrder(id, parsed.data);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/plan", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const order = await planProductionOrder(id);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/release", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      // RELEASE é ação auditada: quem liberou vem da sessão.
      const actor = requireCurrentUser(request);
      const order = await releaseProductionOrder(id, { id: actor.id, name: actor.name });
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cancelProductionOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await cancelProductionOrder(id, parsed.data.reason);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
