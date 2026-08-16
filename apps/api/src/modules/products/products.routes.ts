import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  activateProduct,
  createProduct,
  deactivateProduct,
  getProductById,
  listProducts,
  updateProduct,
} from "./products.service.js";
import {
  CustomerNotFoundError,
  DoseUomNotFoundError,
  DuplicateFinishedItemError,
  FinishedItemNotFoundError,
  InactiveCustomerError,
  InactiveFinishedItemError,
  InvalidFinishedItemTypeError,
  ProductNotFoundError,
} from "./products.errors.js";
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from "./products.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof DoseUomNotFoundError) {
    return { status: 400, body: { error: "dose_uom_not_found", message: error.message } };
  }
  if (error instanceof CustomerNotFoundError) {
    return { status: 400, body: { error: "customer_not_found", message: error.message } };
  }
  if (error instanceof InactiveCustomerError) {
    return { status: 400, body: { error: "inactive_customer", message: error.message } };
  }
  if (error instanceof FinishedItemNotFoundError) {
    return { status: 400, body: { error: "item_not_found", message: error.message } };
  }
  if (error instanceof InvalidFinishedItemTypeError) {
    return { status: 400, body: { error: "invalid_item_type", message: error.message } };
  }
  if (error instanceof InactiveFinishedItemError) {
    return { status: 400, body: { error: "inactive_item", message: error.message } };
  }
  if (error instanceof DuplicateFinishedItemError) {
    return { status: 400, body: { error: "duplicate_finished_item", message: error.message } };
  }
  return null;
}

/**
 * `GET /products`, `GET /products/:id`, `POST /products`,
 * `PATCH /products/:id`, `POST /products/:id/activate`,
 * `POST /products/:id/deactivate`.
 *
 * Sem exclusão física: produtos inativos permanecem visíveis no histórico.
 */
export const productsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/products", async (request, reply) => {
    const parsed = listProductsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listProducts(parsed.data);
    return reply.send(result);
  });

  app.get("/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await getProductById(id);
    if (!product) return reply.status(404).send({ error: "not_found" });
    return reply.send(product);
  });

  app.post("/products", async (request, reply) => {
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const product = await createProduct(parsed.data);
      return reply.status(201).send(product);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateProductSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const product = await updateProduct(id, parsed.data);
      return reply.send(product);
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/products/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await activateProduct(id));
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/products/:id/deactivate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await deactivateProduct(id));
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });
};
