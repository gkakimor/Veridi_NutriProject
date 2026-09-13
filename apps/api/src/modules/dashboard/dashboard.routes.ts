import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { getDashboard } from "./dashboard.service.js";
import { dashboardQuerySchemaEm } from "./dashboard.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /dashboard?from=…&to=…` — read model único do cockpit operacional,
 * para o frontend não disparar dezenas de requisições independentes.
 * Estado atual nunca responde ao filtro de período; só as métricas
 * históricas. Nada é persistido para alimentar esta tela.
 */
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/dashboard", async (request, reply) => {
    // Um instante por requisição (DASHBOARD-CONSISTENT-NOW-01): o "hoje" do
    // período, o estado atual e a lista de atenção saem do mesmo relógio.
    const now = new Date();
    const parsed = dashboardQuerySchemaEm(now).safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    return reply.send(await getDashboard(parsed.data, now));
  });
};
