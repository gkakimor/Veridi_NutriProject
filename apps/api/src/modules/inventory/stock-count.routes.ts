import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodError } from "zod";
import { STOCK_COUNT_WRITE_ROLES } from "@veridi/shared";
import type { StockCountErrorBody, StockCountErrorCode } from "@veridi/shared";
import { requireRole } from "../../lib/current-user.js";
import { ForbiddenError } from "../auth/auth.errors.js";
import {
  CountBelowReservedError,
  ItemNotFoundError,
  LotItemMismatchError,
  LotNotFoundError,
  MissingCountReasonError,
  MissingLotError,
  UnexpectedLotError,
} from "./inventory.errors.js";
import {
  ClientRequestReusedError,
  FractionalCountQuantityError,
  InvalidStockCountStatusError,
  PositionAlreadyInCountError,
  PositionHeldByOpenCountError,
  StockCountActionNotAllowedError,
  StockCountCloseBlockedError,
  StockCountConcurrentWriteError,
  StockCountCustomerNotFoundError,
  StockCountDecisionNotAllowedError,
  StockCountEntryConflictError,
  StockCountEntryNotAllowedError,
  StockCountFindingInvalidError,
  StockCountFirstRoundIncompleteError,
  StockCountNothingToReviewError,
  StockCountNotFoundError,
  StockCountPositionNotFoundError,
  StockCountRecountNotAllowedError,
  StockCountScopeChangedError,
  StockCountScopeEmptyError,
  StockCountScopeTooLargeError,
  SystemQuantityChangedError,
} from "./stock-count.errors.js";
import {
  addStockCountPositionSchema,
  cancelStockCountSchema,
  createStockCountFindingSchema,
  decideStockCountSchema,
  listStockCountsQuerySchema,
  previewStockCountSchema,
  registerStockCountEntrySchema,
  removeStockCountPositionSchema,
  requestStockCountRecountSchema,
  startStockCountSchema,
  stockCountDetailQuerySchema,
} from "./stock-count.schemas.js";
import {
  addStockCountPosition,
  cancelStockCount,
  closeStockCountFirstRound,
  completeStockCount,
  createStockCountFinding,
  decideStockCountPositions,
  getStockCountDetail,
  getStockCountFinding,
  getStockCountPosition,
  listStockCounts,
  previewStockCount,
  registerStockCountEntry,
  removeStockCountPosition,
  requestStockCountRecount,
  startStockCount,
} from "./stock-count.service.js";

/*
 * Quem inicia, conta, revisa, encerra e cancela inventário é
 * `STOCK_COUNT_WRITE_ROLES` (`@veridi/shared`, decisão D4 do PO) — a mesma
 * lista que a tela usa para não oferecer a ação. Consultar é de qualquer sessão
 * autenticada, como o resto do estoque.
 */

type Resposta = { status: number; body: StockCountErrorBody };

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function erroDeValidacao(reply: FastifyReply, error: ZodError) {
  return reply.status(400).send({ error: "validation_error", issues: formatZodError(error) });
}

/** Erros do Inventário Físico em HTTP. Também serve à Contagem rápida (`POST /stock-counts`). */
export function mapStockCountError(error: unknown): Resposta | null {
  const corpo = (
    codigo: StockCountErrorCode,
    extra: Omit<Partial<StockCountErrorBody>, "error" | "message"> = {},
  ): StockCountErrorBody => ({
    error: codigo,
    message: (error as Error).message,
    ...extra,
  });

  if (error instanceof ForbiddenError) return { status: 403, body: corpo("forbidden") };
  if (error instanceof StockCountNotFoundError) return { status: 404, body: corpo("not_found") };
  if (error instanceof StockCountPositionNotFoundError) return { status: 404, body: corpo("position_not_found") };
  if (error instanceof InvalidStockCountStatusError) {
    return { status: 409, body: corpo("invalid_stock_count_status", { status: error.status }) };
  }
  if (error instanceof StockCountScopeEmptyError) return { status: 400, body: corpo("empty_scope") };
  if (error instanceof StockCountScopeTooLargeError) {
    return {
      status: 400,
      body: corpo("scope_too_large", { positionCount: error.positionCount, maxPositions: error.maxPositions }),
    };
  }
  if (error instanceof StockCountScopeChangedError) {
    return { status: 409, body: corpo("scope_changed", { added: error.added, removed: error.removed }) };
  }
  if (error instanceof StockCountCustomerNotFoundError) return { status: 400, body: corpo("customer_not_found") };
  if (error instanceof PositionHeldByOpenCountError) {
    return { status: 409, body: corpo("position_in_open_count", { held: error.held }) };
  }
  if (error instanceof PositionAlreadyInCountError) return { status: 409, body: corpo("position_already_in_count") };
  if (error instanceof StockCountActionNotAllowedError) return { status: 409, body: corpo("action_not_allowed") };
  if (error instanceof StockCountEntryNotAllowedError) return { status: 409, body: corpo("entry_not_allowed") };
  if (error instanceof ClientRequestReusedError) return { status: 409, body: corpo("client_request_reused") };
  if (error instanceof FractionalCountQuantityError) {
    return { status: 400, body: corpo("fractional_count_quantity") };
  }
  if (error instanceof StockCountFirstRoundIncompleteError) {
    return { status: 409, body: corpo("first_round_incomplete", { pendingCount: error.pendingCount }) };
  }
  if (error instanceof StockCountNothingToReviewError) return { status: 409, body: corpo("nothing_to_review") };
  if (error instanceof StockCountRecountNotAllowedError) return { status: 409, body: corpo("recount_not_allowed") };
  if (error instanceof StockCountDecisionNotAllowedError) {
    return { status: 409, body: corpo("decision_not_allowed") };
  }
  if (error instanceof StockCountCloseBlockedError) {
    return { status: 409, body: corpo("stock_count_close_blocked", { issues: error.issues }) };
  }
  if (error instanceof SystemQuantityChangedError) {
    return {
      status: 409,
      body: corpo("system_quantity_changed", { shownQuantity: error.shown, currentQuantity: error.current }),
    };
  }
  if (error instanceof StockCountFindingInvalidError) return { status: 400, body: corpo("invalid_finding") };
  if (error instanceof StockCountConcurrentWriteError) return { status: 409, body: corpo("concurrent_write") };
  if (error instanceof ItemNotFoundError) return { status: 400, body: corpo("item_not_found") };
  if (error instanceof LotNotFoundError) return { status: 400, body: corpo("lot_not_found") };
  if (error instanceof LotItemMismatchError) return { status: 400, body: corpo("lot_item_mismatch") };
  if (error instanceof MissingLotError) return { status: 400, body: corpo("missing_lot") };
  if (error instanceof UnexpectedLotError) return { status: 400, body: corpo("unexpected_lot") };
  if (error instanceof MissingCountReasonError) return { status: 400, body: corpo("missing_count_reason") };
  if (error instanceof CountBelowReservedError) return { status: 400, body: corpo("count_below_reserved") };
  return null;
}

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

function comErrosDeDominio(handler: Handler): Handler {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      const mapped = mapStockCountError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  };
}

/** Depois de um comando, a leitura de revisão — que respeita a cegueira do estado. */
async function detalheDeRevisao(id: string) {
  const detalhe = await getStockCountDetail(id, "review");
  if (!detalhe) throw new StockCountNotFoundError();
  return detalhe;
}

/**
 * Inventário Físico em sessão (INVENTORY-PHYSICAL-COUNT-01). A Contagem rápida
 * continua em `POST /stock-counts`, em `inventory.routes.ts`.
 */
export const stockCountRoutes: FastifyPluginAsync = async (app) => {
  app.get("/stock-counts", async (request, reply) => {
    const parsed = listStockCountsQuerySchema.safeParse(request.query);
    if (!parsed.success) return erroDeValidacao(reply, parsed.error);
    return reply.send(await listStockCounts(parsed.data));
  });

  app.get("/stock-counts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = stockCountDetailQuerySchema.safeParse(request.query);
    if (!parsed.success) return erroDeValidacao(reply, parsed.error);
    const detalhe = await getStockCountDetail(id, parsed.data.view);
    if (!detalhe) return reply.status(404).send({ error: "not_found" });
    return reply.send(detalhe);
  });

  app.post(
    "/stock-counts/preview",
    comErrosDeDominio(async (request, reply) => {
      requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const parsed = previewStockCountSchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      return reply.send(await previewStockCount(parsed.data));
    }),
  );

  app.post(
    "/stock-counts/sessions",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const parsed = startStockCountSchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      const id = await startStockCount(parsed.data, actor);
      return reply.status(201).send(await detalheDeRevisao(id));
    }),
  );

  /*
   * Adicionar e retirar posição respondem a leitura de QUEM CONTA. Numa
   * contagem cega em revisão, a leitura de revisão já revela — e devolvia o
   * saldo de referência da posição recém-adicionada a quem ainda vai contá-la
   * (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A). Na contagem com saldo as duas
   * leituras são a mesma; quem revisa relê o detalhe.
   */
  app.post(
    "/stock-counts/:id/positions",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = addStockCountPositionSchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      const positionId = await addStockCountPosition(id, parsed.data, actor);
      return reply.status(201).send(await getStockCountPosition(id, positionId, "counting"));
    }),
  );

  app.post(
    "/stock-counts/:id/positions/:positionId/remove",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id, positionId } = request.params as { id: string; positionId: string };
      const parsed = removeStockCountPositionSchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      await removeStockCountPosition(id, positionId, parsed.data.reason, actor);
      return reply.send(await getStockCountPosition(id, positionId, "counting"));
    }),
  );

  /*
   * Registro de contagem. A resposta é a leitura de quem conta: numa contagem
   * cega não traz saldo, esperado nem diferença. O conflito otimista devolve a
   * posição como está agora, para a tela pedir decisão explícita.
   */
  app.post(
    "/stock-counts/:id/positions/:positionId/entries",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id, positionId } = request.params as { id: string; positionId: string };
      const parsed = registerStockCountEntrySchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      try {
        const { created, entryId } = await registerStockCountEntry(id, positionId, parsed.data, actor);
        const position = await getStockCountPosition(id, positionId, "counting");
        const entry = position?.entries.find((registro) => registro.id === entryId) ?? null;
        return reply.status(created ? 201 : 200).send({ created, entry, position });
      } catch (error) {
        if (!(error instanceof StockCountEntryConflictError)) throw error;
        const position = await getStockCountPosition(id, positionId, "counting");
        const corpo: StockCountErrorBody = {
          error: "stock_count_entry_conflict",
          message: error.message,
          ...(position ? { position } : {}),
        };
        return reply.status(409).send(corpo);
      }
    }),
  );

  app.post(
    "/stock-counts/:id/close-first-round",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id } = request.params as { id: string };
      await closeStockCountFirstRound(id, actor);
      return reply.send(await detalheDeRevisao(id));
    }),
  );

  app.post(
    "/stock-counts/:id/recounts",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = requestStockCountRecountSchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      await requestStockCountRecount(id, parsed.data.positionIds, actor);
      return reply.send(await detalheDeRevisao(id));
    }),
  );

  app.post(
    "/stock-counts/:id/decisions",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = decideStockCountSchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      await decideStockCountPositions(id, parsed.data.decisions, actor);
      return reply.send(await detalheDeRevisao(id));
    }),
  );

  app.post(
    "/stock-counts/:id/complete",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id } = request.params as { id: string };
      await completeStockCount(id, actor);
      return reply.send(await detalheDeRevisao(id));
    }),
  );

  app.post(
    "/stock-counts/:id/cancel",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = cancelStockCountSchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      await cancelStockCount(id, parsed.data.reason, actor);
      return reply.send(await detalheDeRevisao(id));
    }),
  );

  app.post(
    "/stock-counts/:id/findings",
    comErrosDeDominio(async (request, reply) => {
      const actor = requireRole(request, ...STOCK_COUNT_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = createStockCountFindingSchema.safeParse(request.body);
      if (!parsed.success) return erroDeValidacao(reply, parsed.error);
      const findingId = await createStockCountFinding(id, parsed.data, actor);
      return reply.status(201).send(await getStockCountFinding(findingId));
    }),
  );
};
