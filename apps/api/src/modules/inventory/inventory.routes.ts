import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { getAllocationSuggestion } from "./allocation.service.js";
import {
  createInventoryAdjustment,
  createStockCount,
  getInventoryByItemId,
  listInventory,
  listInventoryMovements,
} from "./inventory.service.js";
import {
  InsufficientStockError,
  ItemNotFoundError,
  LotItemMismatchError,
  LotNotFoundError,
  MissingCountReasonError,
  MissingLotError,
  UnexpectedLotError,
} from "./inventory.errors.js";
import {
  allocationSuggestionQuerySchema,
  createInventoryAdjustmentSchema,
  listInventoryMovementsQuerySchema,
  listInventoryQuerySchema,
  stockCountSchema,
} from "./inventory.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ItemNotFoundError) {
    return { status: 400, body: { error: "item_not_found", message: error.message } };
  }
  if (error instanceof LotNotFoundError) {
    return { status: 400, body: { error: "lot_not_found", message: error.message } };
  }
  if (error instanceof LotItemMismatchError) {
    return { status: 400, body: { error: "lot_item_mismatch", message: error.message } };
  }
  if (error instanceof MissingLotError) {
    return { status: 400, body: { error: "missing_lot", message: error.message } };
  }
  if (error instanceof UnexpectedLotError) {
    return { status: 400, body: { error: "unexpected_lot", message: error.message } };
  }
  if (error instanceof InsufficientStockError) {
    return { status: 400, body: { error: "insufficient_stock", message: error.message } };
  }
  if (error instanceof MissingCountReasonError) {
    return { status: 400, body: { error: "missing_count_reason", message: error.message } };
  }
  return null;
}

/**
 * `GET /inventory`, `GET /inventory/:itemId`, `GET /inventory-movements`,
 * `POST /inventory-adjustments`, `POST /stock-counts`. Operacoes de dominio
 * explicitas — nunca um `POST /inventory-movements` generico que deixe o
 * frontend inventar tipo/origem.
 */
export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/inventory", async (request, reply) => {
    const parsed = listInventoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listInventory(parsed.data);
    return reply.send(result);
  });

  app.get("/inventory-movements", async (request, reply) => {
    const parsed = listInventoryMovementsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listInventoryMovements(parsed.data);
    return reply.send(result);
  });

  app.get("/inventory/:itemId", async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const detail = await getInventoryByItemId(itemId);
    if (!detail) return reply.status(404).send({ error: "not_found" });
    return reply.send(detail);
  });

  // Somente leitura: nunca reserva/baixa estoque, so calcula sob demanda.
  app.get("/inventory/:itemId/allocation-suggestion", async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const parsed = allocationSuggestionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const suggestion = await getAllocationSuggestion(itemId, parsed.data.quantity);
      return reply.send(suggestion);
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/inventory-adjustments", async (request, reply) => {
    const parsed = createInventoryAdjustmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const movement = await createInventoryAdjustment(parsed.data);
      return reply.status(201).send(movement);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/stock-counts", async (request, reply) => {
    const parsed = stockCountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const result = await createStockCount(parsed.data);
      return reply.status(201).send(result);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
