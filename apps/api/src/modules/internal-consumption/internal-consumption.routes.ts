import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { INTERNAL_CONSUMPTION_REVERSAL_ROLES, INTERNAL_CONSUMPTION_WRITE_ROLES } from "@veridi/shared";
import { exigirPerfil } from "../../lib/current-user.js";
import {
  CustomerOwnedLotNotAllowedError,
  FutureInternalConsumptionDateError,
  InsufficientInternalConsumptionStockError,
  InternalConsumptionItemNotFoundError,
  InternalConsumptionLotNotFoundError,
  InternalConsumptionNotFoundError,
  InvalidInternalConsumptionItemTypeError,
  LotNotEligibleForInternalConsumptionError,
  MissingInternalConsumptionLotError,
  NothingToReverseError,
  ReversalConcurrentWriteError,
  ReversalExceedsBalanceError,
  ReversalPositionCountedAfterConsumptionError,
  ReversalPositionInOpenCountError,
  ReversalStateChangedError,
  UnexpectedInternalConsumptionLotError,
} from "./internal-consumption.errors.js";
import {
  createInternalConsumptionReversalSchema,
  createInternalConsumptionSchema,
  listInternalConsumptionsQuerySchema,
} from "./internal-consumption.schemas.js";
import {
  getInternalConsumptionAvailability,
  listInternalConsumptions,
  registerInternalConsumption,
} from "./internal-consumption.service.js";
import {
  getInternalConsumptionDetail,
  reverseInternalConsumption,
} from "./internal-consumption-reversal.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/** Toda recusa de domínio é 400 com código estável — nunca 500. */
export function mapInternalConsumptionError(
  error: unknown,
): { status: number; body: { error: string; message: string; [extra: string]: string } } | null {
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

  // Estorno (INTERNAL-CONSUMPTION-REVERSAL-01): 400 para a quantidade pedida,
  // 409 para estado que mudou ou que outro documento segura. A mensagem é a
  // recusa inteira — a tela a mostra como veio.
  const conflito = (codigo: string, erro: Error, extra: Record<string, string> = {}) => ({
    status: 409,
    body: { error: codigo, message: erro.message, ...extra },
  });
  if (error instanceof InternalConsumptionNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof NothingToReverseError) return como("nothing_to_reverse", error);
  if (error instanceof ReversalExceedsBalanceError) return como("reversal_exceeds_balance", error);
  if (error instanceof ReversalStateChangedError) {
    return conflito("reversal_state_changed", error, {
      shownReversedQuantity: error.shown,
      currentReversedQuantity: error.current,
    });
  }
  if (error instanceof ReversalPositionInOpenCountError) {
    return conflito("position_in_open_count", error, { stockCountCode: error.stockCountCode });
  }
  if (error instanceof ReversalPositionCountedAfterConsumptionError) {
    return conflito("position_counted_after_consumption", error, { stockCountCode: error.stockCountCode });
  }
  if (error instanceof ReversalConcurrentWriteError) return conflito("concurrent_write", error);
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

  /*
   * O detalhe traz também os estornos (mais recente primeiro) e os avisos do
   * diálogo de estorno — item inativo, lote bloqueado ou vencido, ajuste
   * manual posterior. Leitura de todo usuário autenticado, como a lista.
   */
  app.get("/internal-consumptions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const consumption = await getInternalConsumptionDetail(id);
    if (!consumption) return reply.status(404).send({ error: "not_found" });
    return reply.send(consumption);
  });

  /*
   * Estorno do consumo — INTERNAL-CONSUMPTION-REVERSAL-01. Operação de domínio
   * explícita, com lista PRÓPRIA de perfis (ADMIN e QUALITY): quem registra
   * consumo não estorna por isso. Quem estorna é o usuário da sessão.
   */
  app.post("/internal-consumptions/:id/reversals", async (request, reply) => {
    // Perfil ANTES do corpo e da existência: quem não pode recebe 403.
    const actor = exigirPerfil(request, reply, INTERNAL_CONSUMPTION_REVERSAL_ROLES);
    if (!actor) return reply;

    const parsed = createInternalConsumptionReversalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const { id } = request.params as { id: string };
    try {
      const reversal = await reverseInternalConsumption(id, parsed.data, actor);
      return reply.status(201).send(reversal);
    } catch (error) {
      const mapped = mapInternalConsumptionError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
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
