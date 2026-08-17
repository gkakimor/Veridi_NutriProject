import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { confirmPicking, recordConsumption, substituteReservationLine } from "./picking.service.js";
import {
  AlternateLotItemMismatchError,
  AlternateLotOwnerMismatchError,
  ConsumptionExceedsReservedError,
  ConsumptionLotNotEligibleError,
  EmptyConsumptionBatchError,
  InsufficientAlternateLotError,
  InsufficientOnHandError,
  InvalidConsumptionQuantityError,
  ItemDoesNotControlLotError,
  LineAlreadyPickedError,
  LineNotActiveError,
  LotMismatchError,
  LotNoLongerEligibleError,
  LotNotFoundByCodeError,
  MissingLotCodeError,
  PickingRequiredError,
  ProductionOrderNotReleasedError,
  ReservationLineNotFoundError,
  SameLotSubstitutionError,
  SubstitutionAfterConsumptionError,
} from "./picking.errors.js";
import { requireCurrentUser } from "../../lib/current-user.js";
import { ProductionOrderNotFoundError } from "./production-orders.errors.js";
import {
  confirmPickingSchema,
  recordConsumptionSchema,
  substituteReservationLineSchema,
} from "./picking.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string; expectedLotCode?: string; scannedLotCode?: string } } | null {
  if (error instanceof ProductionOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ReservationLineNotFoundError) {
    return { status: 404, body: { error: "reservation_line_not_found", message: error.message } };
  }
  if (error instanceof ProductionOrderNotReleasedError) {
    return { status: 400, body: { error: "order_not_released", message: error.message } };
  }
  if (error instanceof LineAlreadyPickedError) {
    return { status: 400, body: { error: "line_already_picked", message: error.message } };
  }
  if (error instanceof LineNotActiveError) {
    return { status: 400, body: { error: "line_not_active", message: error.message } };
  }
  if (error instanceof MissingLotCodeError) {
    return { status: 400, body: { error: "missing_lot_code", message: error.message } };
  }
  if (error instanceof LotNotFoundByCodeError) {
    return { status: 400, body: { error: "lot_not_found", message: error.message } };
  }
  if (error instanceof LotMismatchError) {
    return {
      status: 409,
      body: {
        error: "lot_mismatch",
        message: error.message,
        expectedLotCode: error.expectedLotCode,
        scannedLotCode: error.scannedLotCode,
      },
    };
  }
  if (error instanceof LotNoLongerEligibleError) {
    return { status: 400, body: { error: "lot_not_eligible", message: error.message } };
  }
  if (error instanceof ItemDoesNotControlLotError) {
    return { status: 400, body: { error: "item_does_not_control_lot", message: error.message } };
  }
  if (error instanceof SameLotSubstitutionError) {
    return { status: 400, body: { error: "same_lot_substitution", message: error.message } };
  }
  if (error instanceof AlternateLotItemMismatchError) {
    return { status: 400, body: { error: "alternate_lot_item_mismatch", message: error.message } };
  }
  if (error instanceof AlternateLotOwnerMismatchError) {
    return { status: 400, body: { error: "alternate_lot_owner_mismatch", message: error.message } };
  }
  if (error instanceof InsufficientAlternateLotError) {
    return { status: 400, body: { error: "insufficient_alternate_lot", message: error.message } };
  }
  if (error instanceof SubstitutionAfterConsumptionError) {
    return { status: 400, body: { error: "substitution_after_consumption", message: error.message } };
  }
  if (error instanceof PickingRequiredError) {
    return { status: 400, body: { error: "picking_required", message: error.message } };
  }
  if (error instanceof ConsumptionExceedsReservedError) {
    return { status: 400, body: { error: "consumption_exceeds_reserved", message: error.message } };
  }
  if (error instanceof InvalidConsumptionQuantityError) {
    return { status: 400, body: { error: "invalid_consumption_quantity", message: error.message } };
  }
  if (error instanceof ConsumptionLotNotEligibleError) {
    return { status: 400, body: { error: "consumption_lot_not_eligible", message: error.message } };
  }
  if (error instanceof InsufficientOnHandError) {
    return { status: 400, body: { error: "insufficient_on_hand", message: error.message } };
  }
  if (error instanceof EmptyConsumptionBatchError) {
    return { status: 400, body: { error: "empty_consumption_batch", message: error.message } };
  }
  return null;
}

/**
 * `POST /production-orders/:id/picking/:reservationLineId/confirm`,
 * `POST /production-orders/:id/picking/:reservationLineId/substitute`,
 * `POST /production-orders/:id/consumptions`.
 *
 * Picking nunca cria InventoryMovement nem recalcula reserva — so
 * confirma fisicamente a linha inteira (sem partial picking). Consumo
 * sempre gera exatamente 1 ProductionConsumption + 1 InventoryMovement
 * PRODUCTION_CONSUMPTION por entrada, nunca excede o que ainda resta
 * reservado na linha. Leitura de Picking/Consumo vem embutida em
 * `GET /production-orders/:id` (reservation.lines + consumptions) —
 * sem endpoint generico separado.
 */
export const pickingRoutes: FastifyPluginAsync = async (app) => {
  app.post("/production-orders/:id/picking/:reservationLineId/confirm", async (request, reply) => {
    const { id, reservationLineId } = request.params as { id: string; reservationLineId: string };
    const parsed = confirmPickingSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await confirmPicking(id, reservationLineId, parsed.data.lotCode);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/picking/:reservationLineId/substitute", async (request, reply) => {
    const { id, reservationLineId } = request.params as { id: string; reservationLineId: string };
    const parsed = substituteReservationLineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const order = await substituteReservationLine(id, reservationLineId, parsed.data.lotCode);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/consumptions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = recordConsumptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      // Consumo é registro de rastreabilidade: fica com quem confirmou,
      // não com o ator de sistema.
      const order = await recordConsumption(id, parsed.data.entries, requireCurrentUser(request));
      return reply.status(201).send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
