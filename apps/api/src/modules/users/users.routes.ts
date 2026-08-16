import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import { EmailAlreadyUsedError, UserNotFoundError } from "./users.errors.js";
import {
  createUserSchema,
  listUsersQuerySchema,
  resetUserPasswordSchema,
  updateUserSchema,
} from "./users.schemas.js";
import {
  createUser,
  getUserById,
  listUsers,
  resetUserPassword,
  updateUser,
} from "./users.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof UserNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof EmailAlreadyUsedError) {
    return { status: 409, body: { error: "email_already_used", message: error.message } };
  }
  return null;
}

/**
 * Administração de usuários — só ADMIN. Usuário nunca é excluído: com
 * histórico GMP atrás dele, apagar seria perder rastreabilidade. Inativa-se.
 */
export const usersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/users", async (request, reply) => {
    try {
      requireRole(request, "ADMIN");
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }

    const parsed = listUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listUsers(parsed.data));
  });

  app.get("/users/:id", async (request, reply) => {
    try {
      requireRole(request, "ADMIN");
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }

    const { id } = request.params as { id: string };
    const user = await getUserById(id);
    if (!user) return reply.status(404).send({ error: "not_found" });
    return reply.send(user);
  });

  app.post("/users", async (request, reply) => {
    try {
      requireRole(request, "ADMIN");

      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }

      return reply.status(201).send(await createUser(parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "ADMIN");

      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }

      return reply.send(await updateUser(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/users/:id/reset-password", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "ADMIN");

      const parsed = resetUserPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }

      return reply.send(await resetUserPassword(id, parsed.data.password));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
