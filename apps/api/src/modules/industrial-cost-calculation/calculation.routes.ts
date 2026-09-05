import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import { IndustrialCostVersionNotFoundError } from "../industrial-costs/industrial-costs.errors.js";
import { ProductionOrderNotFoundError } from "../production-orders/production-orders.errors.js";
import { calculateIndustrialCost } from "./calculation.service.js";
import {
  CalculationBlockedByFormulationError,
  CalculationInUseError,
  IndustrialCostCalculationNotFoundError,
  InvalidCostReferenceDateError,
  ManualReferenceMissingError,
  OverrideNotApplicableError,
  OverrideReasonRequiredError,
} from "./calculation.errors.js";
import { getProductionOrderCost } from "./production-cost.service.js";
import {
  discardIndustrialCostCalculation,
  getIndustrialCostCalculation,
  listProductCostCalculations,
  saveIndustrialCostCalculation,
} from "./snapshot.service.js";

const referenceDateSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .transform((value) => (value === undefined ? undefined : new Date(value)));

/**
 * Substituição por material. O motivo é opcional aqui porque a prévia
 * precisa mostrar o impacto ANTES de a pessoa escrever a justificativa; ao
 * salvar, o serviço exige o motivo preenchido.
 */
const materialOverrideSchema = z.object({
  itemId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
});

const previewCalculationSchema = z.object({
  costReferenceDate: referenceDateSchema,
  materialOverrides: z.array(materialOverrideSchema).max(200).optional(),
});

const saveCalculationSchema = z.object({
  costReferenceDate: referenceDateSchema,
  notes: z.string().trim().max(1000).nullish(),
  materialOverrides: z.array(materialOverrideSchema).max(200).optional(),
});

/** Data explícita sempre vence; ausência significa "hoje", nunca no domínio. */
function parseReferenceDate(raw: unknown): Date {
  if (raw === undefined || raw === null || raw === "") return new Date();
  const parsed = new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) throw new InvalidCostReferenceDateError();
  return parsed;
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (
    error instanceof IndustrialCostVersionNotFoundError ||
    error instanceof IndustrialCostCalculationNotFoundError ||
    error instanceof ProductionOrderNotFoundError
  ) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof InvalidCostReferenceDateError) {
    return { status: 400, body: { error: "invalid_reference_date", message: error.message } };
  }
  if (error instanceof CalculationBlockedByFormulationError) {
    return { status: 409, body: { error: "formulation_incomplete", message: error.message } };
  }
  if (error instanceof ManualReferenceMissingError) {
    return { status: 409, body: { error: "manual_reference_missing", message: error.message } };
  }
  if (error instanceof OverrideReasonRequiredError) {
    return { status: 400, body: { error: "override_reason_required", message: error.message } };
  }
  if (error instanceof OverrideNotApplicableError) {
    return { status: 400, body: { error: "override_not_applicable", message: error.message } };
  }
  return null;
}

/**
 * Cálculo do custo industrial.
 *
 * Toda a matemática econômica vive aqui: o frontend envia inputs e desenha
 * o resultado, nunca calcula custo. Salvar um cálculo RECALCULA no backend
 * — o payload exibido na tela não é aceito como verdade.
 */
export const industrialCostCalculationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/industrial-costs/:id/calculate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { referenceDate?: string };
    try {
      requireCurrentUser(request);
      const referenceDate = parseReferenceDate(query.referenceDate);
      return reply.send(await calculateIndustrialCost(id, referenceDate));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /**
   * Prévia com substituições — mesma matemática, nada persistido. Existe
   * separada do GET porque a lista de substituições não cabe numa query.
   */
  app.post("/industrial-costs/:id/calculate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireCurrentUser(request);
      const parsed = previewCalculationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      const { costReferenceDate, materialOverrides } = parsed.data;
      if (costReferenceDate && Number.isNaN(costReferenceDate.getTime())) {
        throw new InvalidCostReferenceDateError();
      }
      return reply.send(
        await calculateIndustrialCost(id, costReferenceDate ?? new Date(), {
          materialOverrides: materialOverrides ?? [],
          requireOverrideReason: false,
          actor,
        }),
      );
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/industrial-costs/:id/calculations", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = saveCalculationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "validation_error",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      const { costReferenceDate, notes, materialOverrides } = parsed.data;
      if (costReferenceDate && Number.isNaN(costReferenceDate.getTime())) {
        throw new InvalidCostReferenceDateError();
      }
      return reply.status(201).send(
        await saveIndustrialCostCalculation(
          id,
          {
            ...(costReferenceDate ? { costReferenceDate } : {}),
            ...(notes !== undefined ? { notes } : {}),
            ...(materialOverrides ? { materialOverrides } : {}),
          },
          actor,
        ),
      );
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.delete("/industrial-cost-calculations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      await discardIndustrialCostCalculation(id);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof CalculationInUseError) {
        return reply.status(409).send({ error: "calculation_in_use", message: error.message });
      }
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/industrial-cost-calculations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireCurrentUser(request);
      return reply.send(await getIndustrialCostCalculation(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/products/:id/cost-calculations", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireCurrentUser(request);
      return reply.send({ calculations: await listProductCostCalculations(id) });
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/production-orders/:id/cost", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireCurrentUser(request);
      return reply.send(await getProductionOrderCost(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
