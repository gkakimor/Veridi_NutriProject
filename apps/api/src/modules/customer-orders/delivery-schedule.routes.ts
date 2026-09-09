import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { requireCurrentUser } from "../../lib/current-user.js";
import { CustomerOrderNotFoundError } from "./customer-orders.errors.js";
import {
  DeliveryAlreadyCancelledError,
  DeliveryAlreadyFulfilledError,
  DeliveryHasDraftShipmentError,
  DeliveryNotFoundError,
  DuplicateDeliveryLineError,
  EmptyDeliveryError,
  ExceedsSchedulableQuantityError,
  OrderNotSchedulableError,
  UnknownDeliveryLineError,
} from "./delivery-schedule.errors.js";
import {
  cancelDeliverySchedule,
  createDeliverySchedule,
  getDeliverySchedule,
  rescheduleDelivery,
} from "./delivery-schedule.service.js";
import {
  cancelDeliveryScheduleSchema,
  createDeliveryScheduleSchema,
  rescheduleDeliverySchema,
} from "./delivery-schedule.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Recusa de NEGÓCIO responde 4xx com a mensagem que a tela mostra — 500
 * transformaria "você prometeu mais do que o pedido tem" em erro de servidor,
 * sujaria o console e reprovaria a suíte E2E.
 */
function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof CustomerOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof DeliveryNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof OrderNotSchedulableError) {
    return { status: 400, body: { error: "order_not_schedulable", message: error.message } };
  }
  if (error instanceof UnknownDeliveryLineError) {
    return { status: 400, body: { error: "unknown_delivery_line", message: error.message } };
  }
  if (error instanceof DuplicateDeliveryLineError) {
    return { status: 400, body: { error: "duplicate_delivery_line", message: error.message } };
  }
  if (error instanceof ExceedsSchedulableQuantityError) {
    return { status: 400, body: { error: "exceeds_schedulable_quantity", message: error.message } };
  }
  if (error instanceof EmptyDeliveryError) {
    return { status: 400, body: { error: "empty_delivery", message: error.message } };
  }
  if (error instanceof DeliveryAlreadyCancelledError) {
    return { status: 400, body: { error: "delivery_already_cancelled", message: error.message } };
  }
  if (error instanceof DeliveryAlreadyFulfilledError) {
    return { status: 400, body: { error: "delivery_already_fulfilled", message: error.message } };
  }
  if (error instanceof DeliveryHasDraftShipmentError) {
    return { status: 400, body: { error: "delivery_has_draft_shipment", message: error.message } };
  }
  return null;
}

/**
 * Entregas programadas de um Pedido.
 *
 * `GET` devolve o cronograma inteiro E o saldo programável por linha, numa
 * resposta só: a tela precisa dos dois juntos para validar ao vivo, e duas
 * chamadas dariam duas leituras de momentos diferentes.
 *
 * Não existe `PATCH` de data: reprogramar é `POST .../reschedule`, que cancela
 * e cria a substituta na mesma transação.
 */
export const deliveryScheduleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/customer-orders/:id/deliveries", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await getDeliverySchedule(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-orders/:id/deliveries", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createDeliveryScheduleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const schedule = await createDeliverySchedule(id, parsed.data, requireCurrentUser(request));
      return reply.status(201).send(schedule);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-order-deliveries/:deliveryId/cancel", async (request, reply) => {
    const { deliveryId } = request.params as { deliveryId: string };
    const parsed = cancelDeliveryScheduleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(
        await cancelDeliverySchedule(deliveryId, parsed.data.reason, requireCurrentUser(request)),
      );
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/customer-order-deliveries/:deliveryId/reschedule", async (request, reply) => {
    const { deliveryId } = request.params as { deliveryId: string };
    const parsed = rescheduleDeliverySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(
        await rescheduleDelivery(deliveryId, parsed.data, requireCurrentUser(request)),
      );
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
