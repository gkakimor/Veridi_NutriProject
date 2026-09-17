import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { INTERNAL_CONSUMPTION_WRITE_ROLES } from "@veridi/shared";
import { exigirPerfil } from "../../lib/current-user.js";
import {
  CustomerOwnedLotNotAllowedError,
  FutureInternalConsumptionDateError,
  InsufficientInternalConsumptionStockError,
  InternalConsumptionItemNotFoundError,
  InternalConsumptionLotNotFoundError,
  InvalidInternalConsumptionItemTypeError,
  LotNotEligibleForInternalConsumptionError,
  MissingInternalConsumptionLotError,
  UnexpectedInternalConsumptionLotError,
} from "./internal-consumption.errors.js";
import {
  createInternalConsumptionSchema,
  listInternalConsumptionsQuerySchema,
} from "./internal-consumption.schemas.js";
import {
  getInternalConsumptionAvailability,
  getInternalConsumptionById,
  listInternalConsumptions,
  registerInternalConsumption,
} from "./internal-consumption.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/** Toda recusa de domínio é 400 com código estável — nunca 500. */
export function mapInternalConsumptionError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  const como = (codigo: string, erro: Error) => ({
    status: 400,
    body: { error: codigo, message: erro.message },
  });
  if (error instanceof InternalConsumptionItemNotFoundError) return como("item_not_found", error);
  if (error instanceof InvalidInternalConsumptionItemTypeError) {
    return como("invalid_item_type", error);
  }
  if (error instanceof MissingInternalConsumptionLotError) return como("missing_lot", error);
  if (error instanceof UnexpectedInternalConsumptionLotError) return como("unexpected_lot", error);
  if (error instanceof InternalConsumptionLotNotFoundError) return como("lot_not_found", error);
  if (error instanceof LotNotEligibleForInternalConsumptionError) {
    return como("lot_not_eligible", error);
  }
  if (error instanceof CustomerOwnedLotNotAllowedError) return como("customer_owned_lot", error);
  if (error instanceof InsufficientInternalConsumptionStockError) {
    return como("insufficient_stock", error);
  }
  if (error instanceof FutureInternalConsumptionDateError) return como("future_date", error);
  return null;
}

/**
 * `GET /internal-consumptions`, `GET /internal-consumptions/:id`,
 * `POST /internal-consumptions` e a disponibilidade que a tela mostra antes de
 * confirmar.
 *
 * Operação de domínio explícita — nunca um `POST /inventory-movements`
 * genérico que deixasse o cliente inventar tipo e origem.
 *
 * LEITURA é de todo usuário autenticado, inclusive `VIEWER`: o histórico de
 * consumo é rastreabilidade, e esconder do perfil de consulta o que a
 * Movimentação já mostra não protegeria nada.
 */
export const internalConsumptionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/internal-consumptions", async (request, reply) => {
    const parsed = listInternalConsumptionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listInternalConsumptions(parsed.data));
  });

  /*
   * Saldo do item para a tela do consumo. Antes do `:id` de propósito: uma
   * rota estática precisa vencer o parâmetro, senão "availability" viraria um
   * id de consumo e a tela receberia 404.
   */
  app.get("/internal-consumptions/availability/:itemId", async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    try {
      const availability = await getInternalConsumptionAvailability(itemId);
      if (!availability) return reply.status(404).send({ error: "not_found" });
      return reply.send(availability);
    } catch (error) {
      const mapped = mapInternalConsumptionError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/internal-consumptions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const consumption = await getInternalConsumptionById(id);
    if (!consumption) return reply.status(404).send({ error: "not_found" });
    return reply.send(consumption);
  });

  app.post("/internal-consumptions", async (request, reply) => {
    // Perfil ANTES do corpo: quem não pode recebe 403, nunca o 400 da validação.
    const actor = exigirPerfil(request, reply, INTERNAL_CONSUMPTION_WRITE_ROLES);
    if (!actor) return reply;

    const parsed = createInternalConsumptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const consumption = await registerInternalConsumption(parsed.data, actor);
      return reply.status(201).send(consumption);
    } catch (error) {
      const mapped = mapInternalConsumptionError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
