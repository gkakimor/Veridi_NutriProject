import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import { ProjectNotFoundError } from "../projects/projects.errors.js";
import {
  InsufficientSampleStockError,
  InvalidSampleQuantityError,
  InvalidSampleTransitionError,
  LotNotEligibleForSampleError,
  LotOwnerNotAllowedError,
  MissingDecisionNotesError,
  MissingSampleLotError,
  MissingSampleOutputError,
  ProjectNotOpenForSamplesError,
  SampleClosedError,
  SampleItemNotFoundError,
  SampleLotNotFoundError,
  SampleNotFoundError,
  SampleWithoutConsumptionError,
} from "./samples.errors.js";
import {
  createSampleSchema,
  listSamplesQuerySchema,
  produceSampleSchema,
  registerSampleConsumptionSchema,
  sampleDecisionSchema,
} from "./samples.schemas.js";
import {
  createSample,
  decideSample,
  getSampleById,
  listSamples,
  lookupSampleByCode,
  produceSample,
  registerSampleConsumption,
} from "./samples.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof SampleNotFoundError || error instanceof ProjectNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ProjectNotOpenForSamplesError) {
    return { status: 409, body: { error: "project_closed", message: error.message } };
  }
  if (error instanceof SampleClosedError || error instanceof InvalidSampleTransitionError) {
    return { status: 409, body: { error: "invalid_transition", message: error.message } };
  }
  if (error instanceof SampleWithoutConsumptionError) {
    return { status: 409, body: { error: "no_consumption", message: error.message } };
  }
  if (error instanceof SampleItemNotFoundError || error instanceof SampleLotNotFoundError) {
    return { status: 400, body: { error: "not_found_reference", message: error.message } };
  }
  if (error instanceof MissingSampleLotError) {
    return { status: 400, body: { error: "missing_lot", message: error.message } };
  }
  if (error instanceof LotNotEligibleForSampleError) {
    return { status: 400, body: { error: "lot_not_eligible", message: error.message } };
  }
  if (error instanceof LotOwnerNotAllowedError) {
    return { status: 400, body: { error: "lot_owner_mismatch", message: error.message } };
  }
  if (error instanceof InsufficientSampleStockError) {
    return { status: 400, body: { error: "insufficient_stock", message: error.message } };
  }
  if (error instanceof InvalidSampleQuantityError || error instanceof MissingSampleOutputError) {
    return { status: 400, body: { error: "invalid_quantity", message: error.message } };
  }
  if (error instanceof MissingDecisionNotesError) {
    return { status: 400, body: { error: "missing_decision_notes", message: error.message } };
  }
  return null;
}

/**
 * Amostras/pilotos.
 *
 * Criar amostra: Comercial, Produção ou ADMIN. Consumo e conclusão são
 * atos físicos: Produção ou ADMIN. Decisão sobre o resultado é do
 * desenvolvimento/cliente: Comercial ou ADMIN. Qualidade lê e baixa
 * documentos. Quem executou vem sempre da sessão.
 */
export const samplesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/project-samples", async (request, reply) => {
    const parsed = listSamplesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listSamples(parsed.data));
  });

  app.get("/project-samples/lookup", async (request, reply) => {
    const { code } = request.query as { code?: string };
    requireCurrentUser(request);
    if (!code) return reply.status(400).send({ error: "missing_code" });

    const sample = await lookupSampleByCode(code);
    if (!sample) return reply.status(404).send({ error: "not_found" });
    return reply.send(sample);
  });

  app.get("/project-samples/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sample = await getSampleById(id);
    if (!sample) return reply.status(404).send({ error: "not_found" });
    return reply.send(sample);
  });

  app.get("/projects/:id/samples", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await listSamples({ projectId: id, page: 1, pageSize: 100 }));
  });

  app.post("/projects/:id/samples", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "PRODUCTION", "ADMIN");
      const parsed = createSampleSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createSample(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/project-samples/:id/consumptions", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      // Consumo é ato físico de chão de fábrica.
      const actor = requireRole(request, "PRODUCTION", "ADMIN");
      const parsed = registerSampleConsumptionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await registerSampleConsumption(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/project-samples/:id/produce", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "PRODUCTION", "ADMIN");
      const parsed = produceSampleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await produceSample(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  for (const [path, decision] of [
    ["approve", "APPROVED"],
    ["reject", "REJECTED"],
    ["cancel", "CANCELLED"],
  ] as const) {
    app.post(`/project-samples/:id/${path}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        // Aprovar/reprovar é decisão de desenvolvimento/cliente; cancelar
        // acompanha quem conduz a amostra.
        const actor =
          decision === "CANCELLED"
            ? requireRole(request, "COMMERCIAL", "PRODUCTION", "ADMIN")
            : requireRole(request, "COMMERCIAL", "ADMIN");

        const parsed = sampleDecisionSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply
            .status(400)
            .send({ error: "validation_error", issues: formatZodError(parsed.error) });
        }
        return reply.send(await decideSample(id, decision, parsed.data, actor));
      } catch (error) {
        const mapped = mapDomainError(error);
        if (mapped) return reply.status(mapped.status).send(mapped.body);
        throw error;
      }
    });
  }
};
