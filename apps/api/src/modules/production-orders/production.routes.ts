import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { requireCurrentUser } from "../../lib/current-user.js";
import { InvalidTransitionError, MissingFinishedItemError, ProductionOrderNotFoundError } from "./production-orders.errors.js";
import { completeProductionOrder, registerProductionOutput } from "./production.service.js";
import {
  ExpiryBeforeProducedAtError,
  FinishedLotNotEligibleError,
  FinishedLotNotFoundError,
  FinishedLotWrongItemError,
  FinishedLotWrongOrderError,
  LotControlRequiredError,
  MissingBusinessLotNumberError,
  MissingCompletionReasonError,
  MissingFinishedExpiryDateError,
  NoProductionOutputsError,
  OutputExceedsPlannedError,
} from "./production.errors.js";
import { completeProductionOrderSchema, registerProductionOutputSchema } from "./production.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(error: unknown): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ProductionOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof InvalidTransitionError) {
    return { status: 400, body: { error: "invalid_transition", message: error.message } };
  }
  if (error instanceof MissingFinishedItemError) {
    return { status: 400, body: { error: "missing_finished_item", message: error.message } };
  }
  if (error instanceof LotControlRequiredError) {
    return { status: 400, body: { error: "lot_control_required", message: error.message } };
  }
  if (error instanceof OutputExceedsPlannedError) {
    return { status: 400, body: { error: "output_exceeds_planned", message: error.message } };
  }
  if (error instanceof MissingBusinessLotNumberError) {
    return { status: 400, body: { error: "missing_business_lot_number", message: error.message } };
  }
  if (error instanceof MissingFinishedExpiryDateError) {
    return { status: 400, body: { error: "missing_expiry_date", message: error.message } };
  }
  if (error instanceof ExpiryBeforeProducedAtError) {
    return { status: 400, body: { error: "expiry_before_produced_at", message: error.message } };
  }
  if (error instanceof FinishedLotNotFoundError) {
    return { status: 404, body: { error: "finished_lot_not_found", message: error.message } };
  }
  if (error instanceof FinishedLotWrongOrderError) {
    return { status: 400, body: { error: "finished_lot_wrong_order", message: error.message } };
  }
  if (error instanceof FinishedLotWrongItemError) {
    return { status: 400, body: { error: "finished_lot_wrong_item", message: error.message } };
  }
  if (error instanceof FinishedLotNotEligibleError) {
    return { status: 400, body: { error: "finished_lot_not_eligible", message: error.message } };
  }
  if (error instanceof NoProductionOutputsError) {
    return { status: 400, body: { error: "no_production_outputs", message: error.message } };
  }
  if (error instanceof MissingCompletionReasonError) {
    return { status: 400, body: { error: "missing_completion_reason", message: error.message } };
  }
  return null;
}

/**
 * `POST /production-orders/:id/outputs`, `POST /production-orders/:id/complete`.
 * Apontamento de produção parcial + conclusão da OP — libera reserva
 * remanescente na conclusão. Leitura embutida em `GET /production-orders/:id`
 * (outputs + eligibleFinishedLots) — sem endpoint genérico separado.
 */
export const productionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/production-orders/:id/outputs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = registerProductionOutputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await registerProductionOutput(id, parsed.data, requireCurrentUser(request));
      return reply.status(201).send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/complete", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = completeProductionOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await completeProductionOrder(id, parsed.data, requireCurrentUser(request));
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
