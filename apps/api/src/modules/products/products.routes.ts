import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { PRODUCT_EDIT_ROLES, PRODUCT_STATUS_CHANGE_ROLES } from "@veridi/shared";
import { exigirPerfil } from "../../lib/current-user.js";
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
  FinishedItemControlsNotEditableHereError,
  FinishedUnitNotFoundError,
  ProductCustomerLockedError,
  DuplicateFinishedItemError,
  FinishedItemNotFoundError,
  InactiveCustomerError,
  InactiveFinishedItemError,
  InvalidFinishedItemTypeError,
  InvalidProductStatusTransitionError,
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
  if (error instanceof FinishedUnitNotFoundError) {
    return { status: 400, body: { error: "finished_unit_not_found", message: error.message } };
  }
  if (error instanceof ProductCustomerLockedError) {
    return { status: 409, body: { error: "product_customer_locked", message: error.message } };
  }
  if (error instanceof FinishedItemControlsNotEditableHereError) {
    return {
      status: 409,
      body: { error: "finished_item_controls_not_editable_here", message: error.message },
    };
  }
  return null;
}

/**
 * `GET /products`, `GET /products/:id`, `POST /products`,
 * `PATCH /products/:id`, `POST /products/:id/activate`,
 * `POST /products/:id/deactivate`.
 *
 * Consultar é de toda sessão. Criar, editar, inativar e reativar são de
 * Comercial e Administrador (`PRODUCT_EDIT_ROLES`, `PRODUCT_STATUS_CHANGE_ROLES`),
 * conferidos antes do corpo e da existência (MASTER-DATA-EDIT-PERMISSIONS-01) —
 * inclusive a criação direta, que nasce aprovada. Formulação, roteiro,
 * documentos e controles do PA seguem nas rotas próprias, com gates próprios.
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
    const actor = exigirPerfil(request, reply, PRODUCT_EDIT_ROLES);
    if (!actor) return reply;

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
    // Antes do `id` servir para qualquer leitura: sem permissão, produto
    // existente e inexistente recebem a mesma resposta.
    const actor = exigirPerfil(request, reply, PRODUCT_EDIT_ROLES);
    if (!actor) return reply;

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
    const actor = exigirPerfil(request, reply, PRODUCT_STATUS_CHANGE_ROLES);
    if (!actor) return reply;

    const { id } = request.params as { id: string };
    try {
      return reply.send(await activateProduct(id));
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof InvalidProductStatusTransitionError) {
        return reply
          .status(409)
          .send({ error: "invalid_status_transition", message: error.message });
      }
      throw error;
    }
  });

  app.post("/products/:id/deactivate", async (request, reply) => {
    const actor = exigirPerfil(request, reply, PRODUCT_STATUS_CHANGE_ROLES);
    if (!actor) return reply;

    const { id } = request.params as { id: string };
    try {
      return reply.send(await deactivateProduct(id));
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof InvalidProductStatusTransitionError) {
        return reply
          .status(409)
          .send({ error: "invalid_status_transition", message: error.message });
      }
      throw error;
    }
  });
};
