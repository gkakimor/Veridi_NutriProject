import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import { IndustrialCostVersionNotFoundError } from "../industrial-costs/industrial-costs.errors.js";
import { ProductionOrderNotFoundError } from "../production-orders/production-orders.errors.js";
import { calculateIndustrialCost } from "./calculation.service.js";
import {
  IndustrialCostCalculationNotFoundError,
  InvalidCostReferenceDateError,
} from "./calculation.errors.js";
import { getProductionOrderCost } from "./production-cost.service.js";
import {
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

const saveCalculationSchema = z.object({
  costReferenceDate: referenceDateSchema,
  notes: z.string().trim().max(1000).nullish(),
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
      const { costReferenceDate, notes } = parsed.data;
      if (costReferenceDate && Number.isNaN(costReferenceDate.getTime())) {
        throw new InvalidCostReferenceDateError();
      }
      return reply.status(201).send(
        await saveIndustrialCostCalculation(
          id,
          {
            ...(costReferenceDate ? { costReferenceDate } : {}),
            ...(notes !== undefined ? { notes } : {}),
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
