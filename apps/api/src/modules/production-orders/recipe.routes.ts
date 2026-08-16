import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { requireCurrentUser } from "../../lib/current-user.js";
import {
  AlternateLotOwnerMismatchError,
  ConsumptionExceedsReservedError,
  ConsumptionLotNotEligibleError,
  InsufficientOnHandError,
  InvalidConsumptionQuantityError,
  LotNotFoundByCodeError,
  ProductionOrderNotReleasedError,
  ReservationLineNotFoundError,
} from "./picking.errors.js";
import { ProductionOrderNotFoundError } from "./production-orders.errors.js";
import {
  PartAlreadyCompletedError,
  PartNotFoundError,
  RequirementNotWeighableError,
  UnweighedRequirementError,
  WeighingNotFoundError,
} from "./recipe.errors.js";
import { registerWeighingSchema } from "./recipe.schemas.js";
import { completePart, confirmWeighing, getRecipeSheet, registerWeighing } from "./recipe.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ProductionOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof PartNotFoundError || error instanceof WeighingNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ProductionOrderNotReleasedError) {
    return { status: 409, body: { error: "order_not_released", message: error.message } };
  }
  if (error instanceof PartAlreadyCompletedError) {
    return { status: 409, body: { error: "part_completed", message: error.message } };
  }
  if (error instanceof UnweighedRequirementError) {
    return { status: 409, body: { error: "unweighed_requirement", message: error.message } };
  }
  if (error instanceof RequirementNotWeighableError) {
    return { status: 400, body: { error: "not_weighable", message: error.message } };
  }
  if (error instanceof LotNotFoundByCodeError) {
    return { status: 400, body: { error: "lot_not_found", message: error.message } };
  }
  if (error instanceof ConsumptionLotNotEligibleError) {
    return { status: 400, body: { error: "lot_not_eligible", message: error.message } };
  }
  if (error instanceof AlternateLotOwnerMismatchError) {
    return { status: 400, body: { error: "lot_owner_mismatch", message: error.message } };
  }
  if (error instanceof ReservationLineNotFoundError) {
    return { status: 400, body: { error: "line_not_found", message: error.message } };
  }
  if (error instanceof ConsumptionExceedsReservedError) {
    return { status: 400, body: { error: "exceeds_reserved", message: error.message } };
  }
  if (error instanceof InsufficientOnHandError) {
    return { status: 400, body: { error: "insufficient_on_hand", message: error.message } };
  }
  if (error instanceof InvalidConsumptionQuantityError) {
    return { status: 400, body: { error: "invalid_quantity", message: error.message } };
  }
  return null;
}

/**
 * Folha de Receita da OP: leitura, registro de pesagem e conclusão de
 * parte. Toda ação registra o usuário da SESSÃO — o corpo da requisição
 * nunca informa quem executou.
 */
export const recipeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/production-orders/:id/recipe", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await getRecipeSheet(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/parts/:partNumber/weighings", async (request, reply) => {
    const { id, partNumber } = request.params as { id: string; partNumber: string };
    const parsed = registerWeighingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const actor = requireCurrentUser(request);
      const sheet = await registerWeighing(id, Number(partNumber), parsed.data, actor);
      return reply.status(201).send(sheet);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/weighings/:weighingId/confirm", async (request, reply) => {
    const { id, weighingId } = request.params as { id: string; weighingId: string };
    try {
      const actor = requireCurrentUser(request);
      return reply.send(await confirmWeighing(id, weighingId, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/parts/:partNumber/complete", async (request, reply) => {
    const { id, partNumber } = request.params as { id: string; partNumber: string };
    try {
      const actor = requireCurrentUser(request);
      return reply.send(await completePart(id, Number(partNumber), actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
