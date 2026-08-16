import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ItemNotFoundError } from "../inventory/inventory.errors.js";
import { ProductionOrderNotFoundError } from "../production-orders/production-orders.errors.js";
import { setAcquisitionCost } from "./acquisition-cost.service.js";
import {
  FormulationVersionNotFoundError,
  InvalidAcquisitionCostError,
  ReceiptLineNotFoundError,
} from "./costs.errors.js";
import {
  getFormulationCostEstimate,
  getItemCostReferenceDTO,
  getProductionOrderMaterialCost,
} from "./costs.service.js";
import { costReferenceQuerySchema, setAcquisitionCostSchema } from "./costs.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ReceiptLineNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof FormulationVersionNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ProductionOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ItemNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof InvalidAcquisitionCostError) {
    return { status: 400, body: { error: "invalid_acquisition_cost", message: error.message } };
  }
  return null;
}

/**
 * `PUT /receipt-lines/:id/acquisition-cost` (custeio, nunca recebimento
 * físico), `GET /items/:id/cost-reference`,
 * `GET /formulation-versions/:id/cost-estimate`,
 * `GET /production-orders/:id/material-cost`.
 *
 * Nenhum endpoint genérico de custo sem contexto de domínio. Definir
 * custo nunca movimenta estoque.
 */
export const costsRoutes: FastifyPluginAsync = async (app) => {
  app.put("/receipt-lines/:id/acquisition-cost", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = setAcquisitionCostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await setAcquisitionCost(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/items/:id/cost-reference", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = costReferenceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await getItemCostReferenceDTO(id, parsed.data.referenceDate));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/formulation-versions/:id/cost-estimate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = costReferenceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await getFormulationCostEstimate(id, parsed.data.referenceDate));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/production-orders/:id/material-cost", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await getProductionOrderMaterialCost(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
