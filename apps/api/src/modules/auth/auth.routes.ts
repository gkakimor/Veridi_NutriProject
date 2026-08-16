import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  clearedSessionCookie,
  readSessionToken,
  requireCurrentUser,
  sessionCookie,
} from "../../lib/current-user.js";
import { InvalidCredentialsError, NotAuthenticatedError } from "./auth.errors.js";
import { loginSchema } from "./auth.schemas.js";
import { login, logout, toAuthenticatedUserDTO } from "./auth.service.js";

/**
 * `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
 *
 * O token de sessão vive apenas em cookie HttpOnly — nunca volta no corpo
 * da resposta e nunca vai para o localStorage do navegador.
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = parsed.error as ZodError;
      return reply.status(400).send({
        error: "validation_error",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    try {
      const result = await login(parsed.data.email, parsed.data.password);
      return reply
        .header("set-cookie", sessionCookie(result.token, result.expiresAt))
        .send(result.user);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return reply.status(401).send({ error: "invalid_credentials", message: error.message });
      }
      throw error;
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    await logout(readSessionToken(request));
    return reply.header("set-cookie", clearedSessionCookie()).send({ ok: true });
  });

  /**
   * Sonda de sessão do frontend. Responde 200 SEMPRE — "não há sessão" é
   * um estado esperado na tela de Login, não um erro. `/auth/me` continua
   * devolvendo 401 (semântica HTTP correta para quem exige sessão); esta
   * rota existe para o app perguntar "quem sou eu?" sem sujar o console do
   * navegador com um 401 previsto.
   */
  app.get("/auth/session", async (request, reply) => {
    const user = request.currentUser;
    return reply.send({ user: user ? toAuthenticatedUserDTO(user) : null });
  });

  app.get("/auth/me", async (request, reply) => {
    try {
      return reply.send(toAuthenticatedUserDTO(requireCurrentUser(request)));
    } catch (error) {
      if (error instanceof NotAuthenticatedError) {
        return reply.status(401).send({ error: "not_authenticated", message: error.message });
      }
      throw error;
    }
  });
};
