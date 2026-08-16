import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { listFinishedGoods } from "./finished-goods.service.js";
import { listFinishedGoodsQuerySchema } from "./finished-goods.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /finished-goods` — visão operacional somente leitura dos lotes
 * realmente produzidos (`Lot.origin = PRODUCTION`). Não existe POST: produto
 * acabado nasce exclusivamente por ProductionOrder → ProductionOutput.
 * As ações de Qualidade continuam nas rotas de Lote já existentes.
 */
export const finishedGoodsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/finished-goods", async (request, reply) => {
    const parsed = listFinishedGoodsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    return reply.send(await listFinishedGoods(parsed.data));
  });
};
