import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { requireCurrentUser } from "../../lib/current-user.js";
import { CustomerOrderNotFoundError } from "../customer-orders/customer-orders.errors.js";
import {
  DraftShipmentAlreadyExistsError,
  EmptyShipmentError,
  ExceedsOutstandingError,
  ExceedsReservedRemainingError,
  ExcessiveReserveRequestError,
  InsufficientAvailableError,
  InsufficientOnHandError,
  LineNotVerifiableError,
  LotMismatchError,
  LotNotFoundError,
  LotNotShippableError,
  NothingToReallocateError,
  NothingToShipError,
  OrderNotShippableError,
  ReservationLineNotFoundError,
  ShipmentLineNotFoundError,
  ShipmentNotDraftError,
  ShipmentNotFoundError,
  UnverifiedShipmentLinesError,
} from "./shipments.errors.js";
import {
  cancelShipment,
  confirmShipment,
  createShipmentDraft,
  getShipmentById,
  listShipments,
  updateShipment,
  verifyShipmentLine,
} from "./shipments.service.js";
import {
  getReservationStatus,
  reallocateReservationLine,
  reserveAvailable,
} from "./reservation-status.service.js";
import {
  cancelShipmentSchema,
  listShipmentsQuerySchema,
  reallocateReservationLineSchema,
  reserveAvailableSchema,
  updateShipmentSchema,
  verifyShipmentLineSchema,
} from "./shipments.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ShipmentNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof CustomerOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof OrderNotShippableError) {
    return { status: 400, body: { error: "order_not_shippable", message: error.message } };
  }
  if (error instanceof DraftShipmentAlreadyExistsError) {
    return { status: 400, body: { error: "draft_shipment_exists", message: error.message } };
  }
  if (error instanceof NothingToShipError) {
    return { status: 400, body: { error: "nothing_to_ship", message: error.message } };
  }
  if (error instanceof ShipmentNotDraftError) {
    return { status: 400, body: { error: "shipment_not_draft", message: error.message } };
  }
  if (error instanceof EmptyShipmentError) {
    return { status: 400, body: { error: "empty_shipment", message: error.message } };
  }
  if (error instanceof ReservationLineNotFoundError) {
    return { status: 400, body: { error: "reservation_line_not_found", message: error.message } };
  }
  if (error instanceof ExceedsReservedRemainingError) {
    return { status: 400, body: { error: "exceeds_reserved_remaining", message: error.message } };
  }
  if (error instanceof ExceedsOutstandingError) {
    return { status: 400, body: { error: "exceeds_outstanding", message: error.message } };
  }
  if (error instanceof LotNotShippableError) {
    return { status: 400, body: { error: "lot_not_shippable", message: error.message } };
  }
  if (error instanceof InsufficientOnHandError) {
    return { status: 400, body: { error: "insufficient_on_hand", message: error.message } };
  }
  if (error instanceof ExcessiveReserveRequestError) {
    return { status: 400, body: { error: "excessive_reserve_request", message: error.message } };
  }
  if (error instanceof InsufficientAvailableError) {
    return { status: 400, body: { error: "insufficient_available", message: error.message } };
  }
  if (error instanceof ShipmentLineNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof LotNotFoundError) {
    return { status: 404, body: { error: "lot_not_found", message: error.message } };
  }
  if (error instanceof LotMismatchError) {
    return { status: 400, body: { error: "lot_mismatch", message: error.message } };
  }
  if (error instanceof LineNotVerifiableError) {
    return { status: 400, body: { error: "line_not_verifiable", message: error.message } };
  }
  if (error instanceof UnverifiedShipmentLinesError) {
    return { status: 400, body: { error: "unverified_shipment_lines", message: error.message } };
  }
  if (error instanceof NothingToReallocateError) {
    return { status: 400, body: { error: "nothing_to_reallocate", message: error.message } };
  }
  return null;
}

/**
 * `GET /shipments`, `GET /shipments/:id`, `PATCH /shipments/:id`,
 * `POST /shipments/:id/lines/:lineId/verify` (conferência física do lote —
 * auditoria pura, nunca movimenta estoque),
 * `POST /shipments/:id/confirm`, `POST /shipments/:id/cancel`, mais as
 * operações do Pedido: `POST /customer-orders/:id/shipments` (cria DRAFT),
 * `GET /customer-orders/:id/reservation-status`,
 * `POST /customer-orders/:id/reserve-available`,
 * `POST /customer-orders/:id/reallocate-reservation-line`.
 *
 * Só `POST /shipments/:id/confirm` altera estoque — nunca há endpoint
 * genérico de movimentação.
 */
export const shipmentsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/shipments", async (request, reply) => {
    const parsed = listShipmentsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listShipments(parsed.data));
  });

  app.get("/shipments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const shipment = await getShipmentById(id);
    if (!shipment) return reply.status(404).send({ error: "not_found" });
    return reply.send(shipment);
  });

  app.post("/customer-orders/:id/shipments", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.status(201).send(await createShipmentDraft(id, requireCurrentUser(request)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/shipments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateShipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await updateShipment(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/shipments/:id/lines/:lineId/verify", async (request, reply) => {
    const { id, lineId } = request.params as { id: string; lineId: string };
    const parsed = verifyShipmentLineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await verifyShipmentLine(id, lineId, parsed.data.lotCode, requireCurrentUser(request)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/shipments/:id/confirm", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await confirmShipment(id, requireCurrentUser(request)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/shipments/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cancelShipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await cancelShipment(id, parsed.data.reason, requireCurrentUser(request)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/customer-orders/:id/reservation-status", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await getReservationStatus(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/:id/reserve-available", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = reserveAvailableSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await reserveAvailable(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/:id/reallocate-reservation-line", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = reallocateReservationLineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await reallocateReservationLine(id, parsed.data.customerOrderReservationLineId));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
