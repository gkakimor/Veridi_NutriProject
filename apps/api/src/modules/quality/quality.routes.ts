import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import { LotNotFoundError } from "../lots/lots.errors.js";
import {
  CoaAlreadyApprovedError,
  CoaNotRequiredError,
  MissingCoaDocumentError,
  MissingRejectionReasonError,
} from "./quality.errors.js";
import {
  approveCoaSchema,
  listQualityQueueQuerySchema,
  rejectCoaSchema,
} from "./quality.schemas.js";
import { approveCoa, listQualityQueue, rejectCoa } from "./quality.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof LotNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof CoaNotRequiredError) {
    return { status: 400, body: { error: "coa_not_required", message: error.message } };
  }
  if (error instanceof MissingCoaDocumentError) {
    return { status: 400, body: { error: "missing_coa_document", message: error.message } };
  }
  if (error instanceof MissingRejectionReasonError) {
    return { status: 400, body: { error: "missing_reason", message: error.message } };
  }
  if (error instanceof CoaAlreadyApprovedError) {
    return { status: 409, body: { error: "coa_already_approved", message: error.message } };
  }
  return null;
}

/**
 * Fila da Qualidade e revisão documental do laudo.
 *
 * Aprovar/rejeitar é privativo de QUALITY/ADMIN — Compras anexa documento,
 * mas não decide. Nenhuma destas ações movimenta estoque.
 */
export const qualityRoutes: FastifyPluginAsync = async (app) => {
  app.get("/quality/coa-queue", async (request, reply) => {
    const parsed = listQualityQueueQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listQualityQueue(parsed.data));
  });

  app.post("/lots/:id/coa/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = approveCoaSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const actor = requireRole(request, "QUALITY", "ADMIN");
      return reply.send(await approveCoa(id, parsed.data.note, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/lots/:id/coa/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = rejectCoaSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const actor = requireRole(request, "QUALITY", "ADMIN");
      return reply.send(await rejectCoa(id, parsed.data.reason, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
