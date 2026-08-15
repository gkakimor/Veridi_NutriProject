import type { FastifyPluginAsync } from "fastify";
import type { HealthResponse } from "@veridi/shared";
import { isDatabaseReachable } from "../../db/prisma.js";

/**
 * `GET /health`
 *
 * Comprova a cadeia API -> Prisma -> PostgreSQL.
 * Responde 200 quando o banco esta acessivel, 503 quando nao esta.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    const databaseUp = await isDatabaseReachable();

    const body: HealthResponse = {
      status: databaseUp ? "ok" : "degraded",
      database: databaseUp ? "up" : "down",
      checkedAt: new Date().toISOString(),
    };

    return reply.status(databaseUp ? 200 : 503).send(body);
  });
};
