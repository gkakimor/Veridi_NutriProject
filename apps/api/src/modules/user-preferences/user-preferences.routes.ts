import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { requireCurrentUser } from "../../lib/current-user.js";
import { NotAuthenticatedError } from "../auth/auth.errors.js";
import { updateUserPreferencesSchema } from "./user-preferences.schemas.js";
import { getUserPreferences, updateUserPreferences } from "./user-preferences.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/**
 * `GET /me/preferences` e `PATCH /me/preferences`.
 *
 * Sempre do usuário da SESSÃO: não existe `userId` na rota nem no corpo, então
 * não há como ler ou gravar a preferência de outra pessoa — nem sendo ADMIN.
 * Qualquer perfil autenticado usa; não há regra de autorização nova.
 */
export const userPreferencesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me/preferences", async (request, reply) => {
    try {
      const user = requireCurrentUser(request);
      return reply.send(await getUserPreferences(user.id));
    } catch (error) {
      if (error instanceof NotAuthenticatedError) {
        return reply.status(401).send({ error: "not_authenticated", message: error.message });
      }
      throw error;
    }
  });

  app.patch("/me/preferences", async (request, reply) => {
    try {
      const user = requireCurrentUser(request);

      const parsed = updateUserPreferencesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }

      return reply.send(await updateUserPreferences(user.id, parsed.data));
    } catch (error) {
      if (error instanceof NotAuthenticatedError) {
        return reply.status(401).send({ error: "not_authenticated", message: error.message });
      }
      throw error;
    }
  });
};
