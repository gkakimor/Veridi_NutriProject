import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  activateCustomer,
  createCustomer,
  deactivateCustomer,
  getCustomerById,
  listCustomers,
  updateCustomer,
} from "./customers.service.js";
import { CustomerNotFoundError, DuplicateCnpjError } from "./customers.errors.js";
import {
  createCustomerSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from "./customers.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /customers`, `GET /customers/:id`, `POST /customers`,
 * `PATCH /customers/:id`, `POST /customers/:id/activate`,
 * `POST /customers/:id/deactivate`.
 *
 * Sem exclusão física: clientes inativos permanecem visíveis.
 */
export const customersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/customers", async (request, reply) => {
    const parsed = listCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listCustomers(parsed.data);
    return reply.send(result);
  });

  app.get("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = await getCustomerById(id);
    if (!customer) return reply.status(404).send({ error: "not_found" });
    return reply.send(customer);
  });

  app.post("/customers", async (request, reply) => {
    const parsed = createCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const customer = await createCustomer(parsed.data);
      return reply.status(201).send(customer);
    } catch (error) {
      if (error instanceof DuplicateCnpjError) {
        return reply
          .status(400)
          .send({ error: "duplicate_cnpj", message: error.message });
      }
      throw error;
    }
  });

  app.patch("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const customer = await updateCustomer(id, parsed.data);
      return reply.send(customer);
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
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

  app.post("/customers/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await activateCustomer(id));
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/customers/:id/deactivate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await deactivateCustomer(id));
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      throw error;
    }
  });
};
