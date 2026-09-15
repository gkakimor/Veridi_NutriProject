import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { MANAGEMENT_DASHBOARD_ROLES } from "@veridi/shared";
import { requireRole } from "../../lib/current-user.js";
import { ForbiddenError } from "../auth/auth.errors.js";
import { managementDashboardQuerySchema } from "./management-dashboard.schemas.js";
import { getManagementDashboard } from "./management-dashboard.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * `GET /management-dashboard?period=…&dateFrom=…&dateTo=…` — o read model do
 * Painel Gerencial (MANAGEMENT-DASHBOARD-V1-01). Módulo próprio: o
 * `GET /dashboard` operacional não cresce, e os perfis e o período dos dois
 * são outros.
 *
 * O perfil é conferido ANTES do filtro (decisão D4): quem não é ADMIN nem
 * COMMERCIAL recebe 403 — nunca 400 que revele a forma da consulta, e nunca o
 * 500 de um `ForbiddenError` sem tradução. A tela e o menu só não oferecem o
 * que seria negado; a autoridade é esta rota.
 */
export const managementDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/management-dashboard", async (request, reply) => {
    try {
      requireRole(request, ...MANAGEMENT_DASHBOARD_ROLES);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return reply.status(403).send({ error: "forbidden", message: error.message });
      }
      throw error;
    }

    const parsed = managementDashboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    // Um instante por requisição: o "hoje" do período, da carteira e dos
    // compromissos sai do mesmo relógio (o padrão de DASHBOARD-CONSISTENT-NOW-01).
    const now = new Date();
    return reply.send(await getManagementDashboard(parsed.data, now));
  });
};
