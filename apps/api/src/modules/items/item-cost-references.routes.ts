import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import {
  CostReferenceUnitIncompatibleError,
  InvalidCostReferenceError,
  ItemNotFoundError,
  UnitNotFoundError,
} from "./items.errors.js";
import { createItemCostReference, listItemCostReferences } from "./item-cost-references.service.js";

export const createItemCostReferenceSchema = z.object({
  unitCost: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
  uomCode: z.string().trim().min(1).optional(),
  effectiveFrom: z.string().trim().min(1).optional(),
  note: z.string().trim().max(500).nullish(),
});

/**
 * `GET /items/:id/cost-references` — vigência atual, histórico e a fonte
 * que a seleção automática escolhe hoje.
 * `POST /items/:id/cost-references` — nova vigência (nunca atualiza a anterior).
 *
 * Definir referência é decisão de custeio, como salvar um cálculo: fica com
 * quem negocia (COMMERCIAL) e com ADMIN.
 */
export const itemCostReferencesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/items/:id/cost-references", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireCurrentUser(request);
      return reply.send(await listItemCostReferences(id));
    } catch (error) {
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found", message: error.message });
      }
      throw error;
    }
  });

  app.post("/items/:id/cost-references", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = createItemCostReferenceSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      const input = parsed.data;
      return reply.status(201).send(
        await createItemCostReference(
          id,
          {
            unitCost: input.unitCost,
            ...(input.uomCode ? { uomCode: input.uomCode } : {}),
            ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
          },
          actor,
        ),
      );
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return reply.status(403).send({ error: "forbidden", message: error.message });
      }
      if (error instanceof ItemNotFoundError) {
        return reply.status(404).send({ error: "not_found", message: error.message });
      }
      if (error instanceof UnitNotFoundError) {
        return reply.status(400).send({ error: "invalid_unit", message: error.message });
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
};
