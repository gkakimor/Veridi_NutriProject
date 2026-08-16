import type { FastifyPluginAsync } from "fastify";
import { requireCurrentUser } from "../../lib/current-user.js";
import type { ZodError } from "zod";
import { blockLot, getLotById, listLots, lookupLotByCode, releaseLot } from "./lots.service.js";
import { CoaNotApprovedError } from "../quality/quality.errors.js";
import { InvalidLotTransitionError, LotNotFoundError } from "./lots.errors.js";
import { blockLotSchema, listLotsQuerySchema, lookupLotQuerySchema } from "./lots.schemas.js";
import { getLotTraceability } from "./traceability.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /lots`, `GET /lots/:id`, `POST /lots/:id/release`, `POST /lots/:id/block`.
 * Sem exclusão física, sem PATCH de status livre — só as duas transições
 * explícitas desta entrega.
 */
export const lotsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/lots", async (request, reply) => {
    const parsed = listLotsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listLots(parsed.data);
    return reply.send(result);
  });

  app.get("/lots/lookup", async (request, reply) => {
    const parsed = lookupLotQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const lot = await lookupLotByCode(parsed.data.code);
    if (!lot) return reply.status(404).send({ error: "not_found" });
    return reply.send(lot);
  });

  app.get("/lots/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const lot = await getLotById(id);
    if (!lot) return reply.status(404).send({ error: "not_found" });
    return reply.send(lot);
  });

  app.get("/lots/:id/traceability", async (request, reply) => {
    const { id } = request.params as { id: string };
    const traceability = await getLotTraceability(id);
    if (!traceability) return reply.status(404).send({ error: "not_found" });
    return reply.send(traceability);
  });

  app.post("/lots/:id/release", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await releaseLot(id, requireCurrentUser(request).name));
    } catch (error) {
      if (error instanceof LotNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof InvalidLotTransitionError) {
        return reply.status(400).send({ error: "invalid_transition", message: error.message });
      }
      // Pendência documental é motivo legítimo de recusa da liberação.
      if (error instanceof CoaNotApprovedError) {
        return reply.status(400).send({ error: "coa_not_approved", message: error.message });
      }
      throw error;
    }
  });

  app.post("/lots/:id/block", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = blockLotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await blockLot(id, parsed.data.reason));
    } catch (error) {
      if (error instanceof LotNotFoundError) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (error instanceof InvalidLotTransitionError) {
        return reply.status(400).send({ error: "invalid_transition", message: error.message });
      }
      throw error;
    }
  });
};
