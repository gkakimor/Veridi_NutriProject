import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import {
  ProductionCalendarConfigInvalidError,
  ProductionCalendarDateInvalidError,
  ProductionCalendarExceptionDateTakenError,
  ProductionCalendarExceptionNotFoundError,
} from "./production-calendar.errors.js";
import {
  createProductionCalendarException,
  deleteProductionCalendarException,
  getProductionCalendar,
  listProductionCalendarExceptions,
  updateProductionCalendar,
  updateProductionCalendarException,
} from "./production-calendar.service.js";
import {
  createProductionCalendarExceptionSchema,
  listProductionCalendarExceptionsQuerySchema,
  updateProductionCalendarExceptionSchema,
  updateProductionCalendarSchema,
} from "./production-calendar.schemas.js";

/**
 * Planejamento → Calendário de Produção (PLANNING-CALENDAR-01).
 *
 * Rotas no SINGULAR e sem id: existe um calendário, e a URL diz isso. Não é
 * um motor genérico de calendários — nada aqui aceita "qual calendário".
 *
 * Mesmo gate dos Perfis de Produção: quem configura como a fábrica opera é
 * produção ou administração; os demais perfis leem.
 */
const READ_ROLES = ["ADMIN", "PRODUCTION", "QUALITY", "PURCHASING", "COMMERCIAL", "VIEWER"] as const;
const WRITE_ROLES = ["ADMIN", "PRODUCTION"] as const;

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof ProductionCalendarExceptionNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ProductionCalendarConfigInvalidError) {
    return { status: 400, body: { error: "invalid_calendar_config", message: error.message } };
  }
  if (error instanceof ProductionCalendarDateInvalidError) {
    return { status: 400, body: { error: "invalid_date", message: error.message } };
  }
  // Uma exceção por data: conflito explícito, nunca sobrescrita silenciosa.
  if (error instanceof ProductionCalendarExceptionDateTakenError) {
    return { status: 409, body: { error: "exception_date_taken", message: error.message } };
  }
  return null;
}

export const productionCalendarRoutes: FastifyPluginAsync = async (app) => {
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

  /** Ler nunca cria: sem configuração salva, devolve o padrão sugerido. */
  app.get("/production-calendar", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      return reply.send(await getProductionCalendar());
    }),
  );

  app.put("/production-calendar", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = updateProductionCalendarSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateProductionCalendar(parsed.data, actor));
    }),
  );

  app.get("/production-calendar/exceptions", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const parsed = listProductionCalendarExceptionsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await listProductionCalendarExceptions(parsed.data));
    }),
  );

  app.post("/production-calendar/exceptions", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = createProductionCalendarExceptionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createProductionCalendarException(parsed.data, actor));
    }),
  );

  app.patch("/production-calendar/exceptions/:id", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = updateProductionCalendarExceptionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateProductionCalendarException(id, parsed.data, actor));
    }),
  );

  app.delete("/production-calendar/exceptions/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      await deleteProductionCalendarException(id);
      return reply.status(204).send();
    }),
  );
};
