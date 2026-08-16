import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import { RevisionAlreadyExistsError, RevisionNotFoundError } from "./controlled-documents.errors.js";
import { createRevisionSchema } from "./controlled-documents.schemas.js";
import { activateRevision, createRevision, listRevisions } from "./controlled-documents.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof RevisionNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof RevisionAlreadyExistsError) {
    return { status: 409, body: { error: "revision_exists", message: error.message } };
  }
  return null;
}

/**
 * `GET /controlled-documents` (qualquer usuário autenticado — a impressão
 * precisa do cabeçalho), criação/ativação de revisão só para ADMIN.
 */
export const controlledDocumentsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/controlled-documents", async (_request, reply) => {
    return reply.send(await listRevisions());
  });

  app.post("/controlled-documents", async (request, reply) => {
    try {
      const actor = requireRole(request, "ADMIN");

      const parsed = createRevisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }

      const revision = await createRevision(parsed.data, { id: actor.id, name: actor.name });
      return reply.status(201).send(revision);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/controlled-documents/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "ADMIN");
      return reply.send(await activateRevision(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
