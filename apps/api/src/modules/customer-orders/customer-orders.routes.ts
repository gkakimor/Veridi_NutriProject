import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  cancelCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrder,
  getCustomerOrderById,
  listCustomerOrders,
  updateCustomerOrder,
} from "./customer-orders.service.js";
import {
  CancellationBlockedError,
  CustomerNotFoundError,
  CustomerOrderNotFoundError,
  DuplicateLineProductError,
  EmptyOrderError,
  InactiveCustomerError,
  InactiveLineProductError,
  InvalidTransitionError,
  LineProductNotFoundError,
  MissingFinishedItemError,
  OrderLockedError,
} from "./customer-orders.errors.js";
import {
  cancelCustomerOrderSchema,
  createCustomerOrderSchema,
  listCustomerOrdersQuerySchema,
  updateCustomerOrderSchema,
} from "./customer-orders.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof CustomerNotFoundError) {
    return { status: 400, body: { error: "customer_not_found", message: error.message } };
  }
  if (error instanceof InactiveCustomerError) {
    return { status: 400, body: { error: "inactive_customer", message: error.message } };
  }
  if (error instanceof LineProductNotFoundError) {
    return { status: 400, body: { error: "product_not_found", message: error.message } };
  }
  if (error instanceof InactiveLineProductError) {
    return { status: 400, body: { error: "inactive_product", message: error.message } };
  }
  if (error instanceof MissingFinishedItemError) {
    return { status: 400, body: { error: "missing_finished_item", message: error.message } };
  }
  if (error instanceof DuplicateLineProductError) {
    return { status: 400, body: { error: "duplicate_product", message: error.message } };
  }
  if (error instanceof EmptyOrderError) {
    return { status: 400, body: { error: "empty_order", message: error.message } };
  }
  if (error instanceof InvalidTransitionError) {
    return { status: 400, body: { error: "invalid_transition", message: error.message } };
  }
  if (error instanceof OrderLockedError) {
    return { status: 400, body: { error: "order_locked", message: error.message } };
  }
  if (error instanceof CancellationBlockedError) {
    return { status: 400, body: { error: "cancellation_blocked", message: error.message } };
  }
  return null;
}

/**
 * `GET /customer-orders`, `GET /customer-orders/:id`, `POST /customer-orders`,
 * `PATCH /customer-orders/:id`, `POST /customer-orders/:id/confirm`,
 * `POST /customer-orders/:id/cancel`.
 *
 * Sem exclusão física: pedidos cancelados permanecem no histórico. Plano de
 * Atendimento (`GET .../fulfillment-plan`, `POST .../apply-fulfillment-plan`)
 * vive em `fulfillment-plan.routes.ts`.
 */
export const customerOrdersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/customer-orders", async (request, reply) => {
    const parsed = listCustomerOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listCustomerOrders(parsed.data);
    return reply.send(result);
  });

  app.get("/customer-orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await getCustomerOrderById(id);
    if (!order) return reply.status(404).send({ error: "not_found" });
    return reply.send(order);
  });

  app.post("/customer-orders", async (request, reply) => {
    const parsed = createCustomerOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await createCustomerOrder(parsed.data);
      return reply.status(201).send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/customer-orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCustomerOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await updateCustomerOrder(id, parsed.data);
      return reply.send(order);
    } catch (error) {
      if (error instanceof CustomerOrderNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/:id/confirm", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await confirmCustomerOrder(id));
    } catch (error) {
      if (error instanceof CustomerOrderNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cancelCustomerOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await cancelCustomerOrder(id, parsed.data.reason));
    } catch (error) {
      if (error instanceof CustomerOrderNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
