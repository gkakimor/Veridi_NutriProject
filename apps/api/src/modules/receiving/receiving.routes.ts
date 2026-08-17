import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { requireCurrentUser } from "../../lib/current-user.js";
import {
  createCustomerSuppliedReceipt,
  createReceipt,
  getReceiptById,
  listReceipts,
} from "./receiving.service.js";
import {
  CustomerMaterialRequiresLotControlError,
  CustomerNotFoundError,
  EmptyReceiptError,
  InactiveCustomerError,
  InvalidCustomerSuppliedItemTypeError,
  ReceiptItemNotFoundError,
  InvalidExpiryDateError,
  InvalidPurchaseOrderStatusError,
  InvalidReceivedQuantityError,
  MissingExpiryDateError,
  MissingSupplierLotError,
  OverReceiptError,
  PurchaseOrderLineNotFoundError,
  PurchaseOrderNotFoundError,
} from "./receiving.errors.js";
import {
  createCustomerSuppliedReceiptSchema,
  createReceiptSchema,
  listReceiptsQuerySchema,
} from "./receiving.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof PurchaseOrderNotFoundError) {
    return { status: 400, body: { error: "purchase_order_not_found", message: error.message } };
  }
  if (error instanceof InvalidPurchaseOrderStatusError) {
    return { status: 400, body: { error: "invalid_purchase_order_status", message: error.message } };
  }
  if (error instanceof PurchaseOrderLineNotFoundError) {
    return { status: 400, body: { error: "line_not_found", message: error.message } };
  }
  if (error instanceof EmptyReceiptError) {
    return { status: 400, body: { error: "empty_receipt", message: error.message } };
  }
  if (error instanceof InvalidReceivedQuantityError) {
    return { status: 400, body: { error: "invalid_quantity", message: error.message } };
  }
  if (error instanceof OverReceiptError) {
    return { status: 400, body: { error: "over_receipt", message: error.message } };
  }
  if (error instanceof MissingSupplierLotError) {
    return { status: 400, body: { error: "missing_supplier_lot", message: error.message } };
  }
  if (error instanceof MissingExpiryDateError) {
    return { status: 400, body: { error: "missing_expiry_date", message: error.message } };
  }
  if (error instanceof InvalidExpiryDateError) {
    return { status: 400, body: { error: "invalid_expiry_date", message: error.message } };
  }
  if (error instanceof CustomerNotFoundError) {
    return { status: 400, body: { error: "customer_not_found", message: error.message } };
  }
  if (error instanceof InactiveCustomerError) {
    return { status: 400, body: { error: "inactive_customer", message: error.message } };
  }
  if (error instanceof ReceiptItemNotFoundError) {
    return { status: 400, body: { error: "item_not_found", message: error.message } };
  }
  if (error instanceof InvalidCustomerSuppliedItemTypeError) {
    return { status: 400, body: { error: "invalid_item_type", message: error.message } };
  }
  if (error instanceof CustomerMaterialRequiresLotControlError) {
    return { status: 400, body: { error: "lot_control_required", message: error.message } };
  }
  return null;
}

/**
 * `GET /receipts`, `GET /receipts/:id`, `POST /purchase-orders/:id/receipts`.
 * Sem exclusão física: um Receipt confirmado é histórico/somente leitura.
 */
export const receivingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/receipts", async (request, reply) => {
    const parsed = listReceiptsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listReceipts(parsed.data);
    return reply.send(result);
  });

  app.get("/receipts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await getReceiptById(id);
    if (!receipt) return reply.status(404).send({ error: "not_found" });
    return reply.send(receipt);
  });

  // Recebimento de material enviado pelo cliente — rota propria, sem OC.
  app.post("/receipts/customer-supplied", async (request, reply) => {
    const parsed = createCustomerSuppliedReceiptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const receipt = await createCustomerSuppliedReceipt(parsed.data, requireCurrentUser(request));
      return reply.status(201).send(receipt);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/purchase-orders/:id/receipts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createReceiptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const receipt = await createReceipt(id, parsed.data, requireCurrentUser(request));
      return reply.status(201).send(receipt);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
