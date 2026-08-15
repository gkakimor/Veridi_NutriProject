import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  activateItem,
  createItem,
  deactivateItem,
  getItemById,
  listItems,
  updateItem,
} from "./items.service.js";
import { ItemNotFoundError, UnitNotFoundError } from "./items.errors.js";
import {
  createItemSchema,
  listItemsQuerySchema,
  updateItemSchema,
} from "./items.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /items`, `GET /items/:id`, `POST /items`, `PATCH /items/:id`,
 * `POST /items/:id/activate`, `POST /items/:id/deactivate`.
 *
 * Sem exclusão física: itens inativos permanecem visíveis no histórico.
 */
export const itemsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/items", async (request, reply) => {
    const parsed = listItemsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listItems(parsed.data);
    return reply.send(result);
  });

  app.get("/items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await getItemById(id);
    if (!item) return reply.status(404).send({ error: "not_found" });
    return reply.send(item);
  });

  app.post("/items", async (request, reply) => {
    const parsed = createItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const item = await createItem(parsed.data);
      return reply.status(201).send(item);
    } catch (error) {
      if (error instanceof UnitNotFoundError) {
        return reply
          .status(400)
          .send({ error: "invalid_unit", message: error.message });
      }
      throw error;
    }
  });

  app.patch("/items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const item = await updateItem(id, parsed.data);
      return reply.send(item);
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof UnitNotFoundError) {
        return reply
          .status(400)
          .send({ error: "invalid_unit", message: error.message });
      }
      throw error;
    }
  });

  app.post("/items/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await activateItem(id));
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/items/:id/deactivate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await deactivateItem(id));
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });
};
