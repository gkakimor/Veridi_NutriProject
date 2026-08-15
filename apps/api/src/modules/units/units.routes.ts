import type { FastifyPluginAsync } from "fastify";
import { listUnitsOfMeasure } from "./units.service.js";

/** `GET /units` — leitura para o formulário de item selecionar a unidade principal. */
export const unitsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/units", async (_request, reply) => {
    return reply.send(await listUnitsOfMeasure());
  });
};
