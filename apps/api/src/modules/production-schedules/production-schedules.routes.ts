import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ProductionScheduleInputError } from "@veridi/shared";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import {
  CalendarBreakNotPositionedError,
  CalendarNotConfiguredError,
  ProductionOrderNotFoundError,
  ProductionOrderRouteUomError,
  ProductionOrderWithoutRouteError,
  ScheduleQuantityChangedError,
  ScheduleRouteChangedError,
  ScheduleLockedError,
  ScheduleNeedsConfirmationError,
  ScheduleNotFoundError,
  ScheduleStartNotOperationalError,
} from "./production-schedules.errors.js";
import {
  getProductionBoard,
  getProductionOrderSchedule,
  previewProductionOrderSchedule,
  scheduleProductionOrder,
  unscheduleProductionOrder,
} from "./production-schedules.service.js";
import {
  productionBoardQuerySchema,
  scheduleProductionOrderSchema,
} from "./production-schedules.schemas.js";

/**
 * Planejamento → Programação de Produção (PLANNING-CAPACITY-BOARD-01).
 *
 * Mesmo gate do resto do Planejamento: quem programa a fábrica é produção ou
 * administração; os demais perfis leem o quadro.
 *
 * A prévia é um POST e não um GET porque ela CALCULA — e porque o corpo leva
 * o instante escolhido. Ela não grava nada.
 */
const READ_ROLES = ["ADMIN", "PRODUCTION", "QUALITY", "PURCHASING", "COMMERCIAL", "VIEWER"] as const;
const WRITE_ROLES = ["ADMIN", "PRODUCTION"] as const;

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof ProductionOrderNotFoundError || error instanceof ScheduleNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ProductionOrderWithoutRouteError) {
    return { status: 409, body: { error: "order_without_route", message: error.message } };
  }
  if (error instanceof ProductionOrderRouteUomError) {
    return { status: 409, body: { error: "route_uom_incompatible", message: error.message } };
  }
  if (error instanceof ScheduleRouteChangedError) {
    return { status: 409, body: { error: "route_changed", message: error.message } };
  }
  if (error instanceof ScheduleQuantityChangedError) {
    return { status: 409, body: { error: "quantity_changed", message: error.message } };
  }
  // Fail-closed do calendário: a recusa diz o que falta configurar.
  if (error instanceof CalendarBreakNotPositionedError) {
    return { status: 409, body: { error: "calendar_break_not_positioned", message: error.message } };
  }
  if (error instanceof CalendarNotConfiguredError) {
    return { status: 409, body: { error: "calendar_not_configured", message: error.message } };
  }
  // A sugestão viaja no corpo: a tela oferece "usar este horário" como ação
  // explícita, e nunca desloca sozinha.
  if (error instanceof ScheduleStartNotOperationalError) {
    return {
      status: 400,
      body: {
        error: "start_not_operational",
        message: error.message,
        suggestionAt: error.suggestionAt,
      },
    };
  }
  if (error instanceof ScheduleNeedsConfirmationError) {
    return { status: 409, body: { error: "schedule_needs_confirmation", message: error.message } };
  }
  if (error instanceof ScheduleLockedError) {
    return { status: 409, body: { error: "schedule_locked", message: error.message } };
  }
  if (error instanceof ProductionScheduleInputError) {
    return { status: 400, body: { error: "invalid_schedule", message: error.message } };
  }
  return null;
}

export const productionSchedulesRoutes: FastifyPluginAsync = async (app) => {
  const guard = async (
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
    fn: () => Promise<unknown>,
  ) => {
    try {
      return await fn();
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  };

  app.get("/production-orders/:id/schedule", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send({ schedule: await getProductionOrderSchedule(id) });
    }),
  );

  /** Calcula e devolve — nada persiste. */
  app.post("/production-orders/:id/schedule/preview", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = scheduleProductionOrderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await previewProductionOrderSchedule(id, parsed.data.startAt));
    }),
  );

  app.put("/production-orders/:id/schedule", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = scheduleProductionOrderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await scheduleProductionOrder(id, parsed.data, actor));
    }),
  );

  app.delete("/production-orders/:id/schedule", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      await unscheduleProductionOrder(id);
      return reply.status(204).send();
    }),
  );

  app.get("/production-board", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const parsed = productionBoardQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await getProductionBoard(parsed.data));
    }),
  );
};
