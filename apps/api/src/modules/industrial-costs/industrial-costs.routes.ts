import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import {
  DirectEnergyNotAllowedError,
  DuplicatedResourceUsageError,
  EnergyUsageRequiresDirectModeError,
  FormulationNotStableError,
  FormulationProductMismatchError,
  FormulationVersionNotFoundError,
  IncompatibleReferenceUomError,
  IncompleteActivationError,
  IndustrialCostLineNotFoundError,
  IndustrialCostProductNotFoundError,
  IndustrialCostVersionLockedError,
  IndustrialCostVersionNotFoundError,
  InactiveResourceActivationError,
  InvalidCostRateError,
  InvalidReferenceOutputError,
  MissingFormulationVersionError,
  ResourceNotFoundForUsageError,
  ResourceUsageNotFoundError,
} from "./industrial-costs.errors.js";
import {
  activateIndustrialCostVersionSchema,
  createIndustrialCostLineSchema,
  createIndustrialCostVersionSchema,
  createResourceUsageSchema,
  updateEnergyModeSchema,
  updateIndustrialCostLineSchema,
  updateIndustrialCostVersionSchema,
} from "./industrial-costs.schemas.js";
import {
  activateIndustrialCostVersion,
  createIndustrialCostLine,
  createIndustrialCostVersion,
  createResourceUsage,
  deleteIndustrialCostLine,
  deleteResourceUsage,
  updateEnergyMode,
  getIndustrialCostVersion,
  getProductIndustrialCosts,
  updateIndustrialCostLine,
  updateIndustrialCostVersion,
} from "./industrial-costs.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (
    error instanceof IndustrialCostVersionNotFoundError ||
    error instanceof IndustrialCostLineNotFoundError ||
    error instanceof IndustrialCostProductNotFoundError
  ) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (
    error instanceof ResourceNotFoundForUsageError ||
    error instanceof ResourceUsageNotFoundError
  ) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof DuplicatedResourceUsageError) {
    return { status: 409, body: { error: "duplicated_resource", message: error.message } };
  }
  if (
    error instanceof EnergyUsageRequiresDirectModeError ||
    error instanceof DirectEnergyNotAllowedError
  ) {
    // Energia direta e derivada nunca convivem — evita contar duas vezes.
    return { status: 409, body: { error: "energy_mode_conflict", message: error.message } };
  }
  if (error instanceof InactiveResourceActivationError) {
    return { status: 409, body: { error: "inactive_resource", message: error.message } };
  }
  if (error instanceof IndustrialCostVersionLockedError) {
    return { status: 409, body: { error: "version_locked", message: error.message } };
  }
  if (error instanceof FormulationNotStableError) {
    return { status: 409, body: { error: "formulation_not_stable", message: error.message } };
  }
  if (error instanceof IncompleteActivationError) {
    return { status: 409, body: { error: "incomplete_structure", message: error.message } };
  }
  if (
    error instanceof FormulationVersionNotFoundError ||
    error instanceof FormulationProductMismatchError ||
    error instanceof MissingFormulationVersionError
  ) {
    return { status: 400, body: { error: "invalid_formulation", message: error.message } };
  }
  if (
    error instanceof InvalidReferenceOutputError ||
    error instanceof IncompatibleReferenceUomError
  ) {
    return { status: 400, body: { error: "invalid_reference_output", message: error.message } };
  }
  if (error instanceof InvalidCostRateError) {
    return { status: 400, body: { error: "invalid_rate", message: error.message } };
  }
  return null;
}

/**
 * Estrutura de custos industriais.
 *
 * Escrita é de quem estrutura custo comercial/industrial: COMMERCIAL e
 * ADMIN. Os demais perfis consultam — Compras precisa ver a estrutura para
 * fornecer referência de preço, Produção e Qualidade para entender o
 * escopo. Não existe perfil COSTING nesta fase.
 */
export const industrialCostsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/products/:id/industrial-costs", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireCurrentUser(request);
      return reply.send(await getProductIndustrialCosts(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/industrial-costs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    requireCurrentUser(request);
    const version = await getIndustrialCostVersion(id);
    if (!version) return reply.status(404).send({ error: "not_found" });
    return reply.send(version);
  });

  app.post("/products/:id/industrial-costs", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = createIndustrialCostVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createIndustrialCostVersion(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/industrial-costs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = updateIndustrialCostVersionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateIndustrialCostVersion(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/industrial-costs/:id/lines", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = createIndustrialCostLineSchema.safeParse(request.body);
      if (!parsed.success) {
        // Categorias de recurso industrial (mão de obra, equipamento,
        // energia) caem aqui de propósito: elas não são linha manual.
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createIndustrialCostLine(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/industrial-cost-lines/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = updateIndustrialCostLineSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateIndustrialCostLine(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.delete("/industrial-cost-lines/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      return reply.send(await deleteIndustrialCostLine(id, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/industrial-costs/:id/resource-usages", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = createResourceUsageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createResourceUsage(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.delete("/industrial-cost-resource-usages/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      return reply.send(await deleteResourceUsage(id, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/industrial-costs/:id/energy-mode", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = updateEnergyModeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateEnergyMode(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/industrial-costs/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = activateIndustrialCostVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await activateIndustrialCostVersion(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
