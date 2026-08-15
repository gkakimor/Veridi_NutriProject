import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  activateSupplier,
  createSupplier,
  deactivateSupplier,
  getSupplierById,
  listSuppliers,
  updateSupplier,
} from "./suppliers.service.js";
import { DuplicateCnpjError, SupplierNotFoundError } from "./suppliers.errors.js";
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
} from "./suppliers.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /suppliers`, `GET /suppliers/:id`, `POST /suppliers`,
 * `PATCH /suppliers/:id`, `POST /suppliers/:id/activate`,
 * `POST /suppliers/:id/deactivate`.
 *
 * Sem exclusão física: fornecedores inativos permanecem visíveis.
 */
export const suppliersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/suppliers", async (request, reply) => {
    const parsed = listSuppliersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listSuppliers(parsed.data);
    return reply.send(result);
  });

  app.get("/suppliers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplier = await getSupplierById(id);
    if (!supplier) return reply.status(404).send({ error: "not_found" });
    return reply.send(supplier);
  });

  app.post("/suppliers", async (request, reply) => {
    const parsed = createSupplierSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const supplier = await createSupplier(parsed.data);
      return reply.status(201).send(supplier);
    } catch (error) {
      if (error instanceof DuplicateCnpjError) {
        return reply
          .status(400)
          .send({ error: "duplicate_cnpj", message: error.message });
      }
      throw error;
    }
  });

  app.patch("/suppliers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSupplierSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const supplier = await updateSupplier(id, parsed.data);
      return reply.send(supplier);
    } catch (error) {
      if (error instanceof SupplierNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof DuplicateCnpjError) {
        return reply
          .status(400)
          .send({ error: "duplicate_cnpj", message: error.message });
      }
      throw error;
    }
  });

  app.post("/suppliers/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await activateSupplier(id));
    } catch (error) {
      if (error instanceof SupplierNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/suppliers/:id/deactivate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await deactivateSupplier(id));
    } catch (error) {
      if (error instanceof SupplierNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });
};
