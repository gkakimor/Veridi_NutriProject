import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrderById,
  listPurchaseOrders,
  updatePurchaseOrder,
} from "./purchase-orders.service.js";
import {
  DuplicateLineItemError,
  EmptyOrderError,
  InactiveLineItemError,
  InactiveSupplierError,
  InvalidLineItemTypeError,
  InvalidTransitionError,
  LineItemNotFoundError,
  OrderLockedError,
  PurchaseOrderNotFoundError,
  SupplierNotFoundError,
} from "./purchase-orders.errors.js";
import {
  cancelPurchaseOrderSchema,
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderSchema,
} from "./purchase-orders.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof SupplierNotFoundError) {
    return { status: 400, body: { error: "supplier_not_found", message: error.message } };
  }
  if (error instanceof InactiveSupplierError) {
    return { status: 400, body: { error: "inactive_supplier", message: error.message } };
  }
  if (error instanceof LineItemNotFoundError) {
    return { status: 400, body: { error: "item_not_found", message: error.message } };
  }
  if (error instanceof InvalidLineItemTypeError) {
    return { status: 400, body: { error: "invalid_item_type", message: error.message } };
  }
  if (error instanceof InactiveLineItemError) {
    return { status: 400, body: { error: "inactive_item", message: error.message } };
  }
  if (error instanceof DuplicateLineItemError) {
    return { status: 400, body: { error: "duplicate_item", message: error.message } };
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
  return null;
}

/**
 * `GET /purchase-orders`, `GET /purchase-orders/:id`, `POST /purchase-orders`,
 * `PATCH /purchase-orders/:id`, `POST /purchase-orders/:id/confirm`,
 * `POST /purchase-orders/:id/cancel`.
 *
 * Sem exclusão física: OCs canceladas permanecem no histórico.
 */
export const purchaseOrdersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/purchase-orders", async (request, reply) => {
    const parsed = listPurchaseOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listPurchaseOrders(parsed.data);
    return reply.send(result);
  });

  app.get("/purchase-orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const purchaseOrder = await getPurchaseOrderById(id);
    if (!purchaseOrder) return reply.status(404).send({ error: "not_found" });
    return reply.send(purchaseOrder);
  });

  app.post("/purchase-orders", async (request, reply) => {
    const parsed = createPurchaseOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const purchaseOrder = await createPurchaseOrder(parsed.data);
      return reply.status(201).send(purchaseOrder);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/purchase-orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updatePurchaseOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const purchaseOrder = await updatePurchaseOrder(id, parsed.data);
      return reply.send(purchaseOrder);
    } catch (error) {
      if (error instanceof PurchaseOrderNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/purchase-orders/:id/confirm", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await confirmPurchaseOrder(id));
    } catch (error) {
      if (error instanceof PurchaseOrderNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/purchase-orders/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cancelPurchaseOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await cancelPurchaseOrder(id, parsed.data.reason));
    } catch (error) {
      if (error instanceof PurchaseOrderNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
