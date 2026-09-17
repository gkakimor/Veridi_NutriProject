import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  ITEM_DEACTIVATE_ROLES,
  ITEM_EDIT_ROLES,
  ITEM_REACTIVATE_ROLES,
} from "@veridi/shared";
import { exigirPerfil, responderSemPermissao } from "../../lib/current-user.js";
import { ForbiddenError } from "../auth/auth.errors.js";
import {
  activateItem,
  createItem,
  deactivateItem,
  getItemById,
  listItems,
  updateItem,
} from "./items.service.js";
import {
  CostReferenceUnitIncompatibleError,
  InvalidCostReferenceError,
  InvalidItemStatusTransitionError,
  ItemNotFoundError,
  PackagingSubtypeNotApplicableError,
  StructuralFieldLockedError,
  UnitNotFoundError,
} from "./items.errors.js";
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
 * Consultar é de toda sessão. Criar e editar são de `ITEM_EDIT_ROLES`;
 * inativar e reativar, de listas próprias — tudo conferido antes do corpo e da
 * existência do Item (MASTER-DATA-EDIT-PERMISSIONS-01). Dentro do cadastro, os
 * controles, a marca de consumo e o custo inicial têm dono mais estreito: o
 * serviço recusa com `ForbiddenError`, que sai aqui como 403.
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
    const actor = exigirPerfil(request, reply, ITEM_EDIT_ROLES);
    if (!actor) return reply;

    const parsed = createItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const item = await createItem(parsed.data, actor);
      return reply.status(201).send(item);
    } catch (error) {
      if (error instanceof ForbiddenError) return responderSemPermissao(reply, error);
      if (error instanceof PackagingSubtypeNotApplicableError) {
        return reply
          .status(400)
          .send({ error: "packaging_subtype_not_applicable", message: error.message });
      }
      if (error instanceof UnitNotFoundError) {
        return reply
          .status(400)
          .send({ error: "invalid_unit", message: error.message });
      }
      if (error instanceof CostReferenceUnitIncompatibleError) {
        return reply
          .status(400)
          .send({ error: "cost_reference_unit_incompatible", message: error.message });
      }
      if (error instanceof InvalidCostReferenceError) {
        return reply
          .status(400)
          .send({ error: "invalid_cost_reference", message: error.message });
      }
      throw error;
    }
  });

  app.patch("/items/:id", async (request, reply) => {
    // Antes do `id` servir para qualquer leitura: sem permissão, item
    // existente e inexistente recebem a mesma resposta.
    const actor = exigirPerfil(request, reply, ITEM_EDIT_ROLES);
    if (!actor) return reply;

    const { id } = request.params as { id: string };
    const parsed = updateItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const item = await updateItem(id, parsed.data, actor);
      return reply.send(item);
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof ForbiddenError) return responderSemPermissao(reply, error);
      if (error instanceof PackagingSubtypeNotApplicableError) {
        return reply
          .status(400)
          .send({ error: "packaging_subtype_not_applicable", message: error.message });
      }
      if (error instanceof UnitNotFoundError) {
        return reply
          .status(400)
          .send({ error: "invalid_unit", message: error.message });
      }
      if (error instanceof StructuralFieldLockedError) {
        return reply
          .status(400)
          .send({ error: "structural_field_locked", message: error.message });
      }
      throw error;
    }
  });

  app.post("/items/:id/activate", async (request, reply) => {
    const actor = exigirPerfil(request, reply, ITEM_REACTIVATE_ROLES);
    if (!actor) return reply;

    const { id } = request.params as { id: string };
    try {
      return reply.send(await activateItem(id));
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof InvalidItemStatusTransitionError) {
        return reply
          .status(409)
          .send({ error: "invalid_status_transition", message: error.message });
      }
      throw error;
    }
  });

  app.post("/items/:id/deactivate", async (request, reply) => {
    const actor = exigirPerfil(request, reply, ITEM_DEACTIVATE_ROLES);
    if (!actor) return reply;

    const { id } = request.params as { id: string };
    try {
      return reply.send(await deactivateItem(id));
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof InvalidItemStatusTransitionError) {
        return reply
          .status(409)
          .send({ error: "invalid_status_transition", message: error.message });
      }
      throw error;
    }
  });
};
