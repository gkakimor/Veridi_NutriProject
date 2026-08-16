import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { CustomerOrderNotFoundError } from "./customer-orders.errors.js";
import {
  InactiveLineItemError,
  InactiveSupplierError,
  InvalidLineItemTypeError,
  LineItemNotFoundError,
  SupplierNotFoundError,
} from "../purchase-orders/purchase-orders.errors.js";
import {
  CustomerOrderNotInFulfillmentError,
  CustomerSuppliedItemPurchaseError,
  EmptyPurchaseDraftsError,
} from "./purchase-suggestion.errors.js";
import { generatePurchaseDrafts, getPurchaseSuggestion } from "./purchase-suggestion.service.js";
import { generatePurchaseDraftsSchema } from "./purchase-suggestion.schemas.js";

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
  if (error instanceof CustomerOrderNotInFulfillmentError) {
    return { status: 400, body: { error: "order_not_in_fulfillment", message: error.message } };
  }
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
  if (error instanceof EmptyPurchaseDraftsError) {
    return { status: 400, body: { error: "empty_purchase_drafts", message: error.message } };
  }
  if (error instanceof CustomerSuppliedItemPurchaseError) {
    return { status: 400, body: { error: "customer_supplied_item", message: error.message } };
  }
  return null;
}

/**
 * `GET /customer-orders/:id/purchase-suggestion` (análise, nunca
 * persiste), `POST /customer-orders/:id/purchase-drafts` (gera OC(s)
 * DRAFT agrupadas por fornecedor, nunca confirma automaticamente).
 */
export const purchaseSuggestionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/customer-orders/:id/purchase-suggestion", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await getPurchaseSuggestion(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/:id/purchase-drafts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = generatePurchaseDraftsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.status(201).send(await generatePurchaseDrafts(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
