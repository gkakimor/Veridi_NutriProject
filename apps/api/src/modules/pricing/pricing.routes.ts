import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import {
  CalculationProductMismatchError,
  CalculationRequiredError,
  DuplicatedTierQuantityError,
  IncompleteCostActivationError,
  InvalidPricingPercentError,
  InvalidTierQuantityError,
  MissingTierPriceError,
  NoTiersToActivateError,
  OutdatedCostStructureError,
  PricingProductNotFoundError,
  PricingTierNotFoundError,
  PricingVersionLockedError,
  PricingVersionNotFoundError,
  TargetMarginWithoutPriceError,
} from "./pricing.errors.js";
import {
  activatePricingVersionSchema,
  createPricingTierSchema,
  createPricingVersionSchema,
  listPricingVersionsQuerySchema,
  updatePricingTierSchema,
  updatePricingVersionSchema,
} from "./pricing.schemas.js";
import {
  activatePricingVersion,
  createPricingTier,
  createPricingVersion,
  deletePricingTier,
  getActivePricingForProduct,
  getPricingRebasePreview,
  getPricingVersion,
  getProductPricing,
  listPricingVersions,
  updatePricingTier,
  updatePricingVersion,
} from "./pricing.service.js";

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
    error instanceof PricingVersionNotFoundError ||
    error instanceof PricingTierNotFoundError ||
    error instanceof PricingProductNotFoundError
  ) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof PricingVersionLockedError) {
    return { status: 409, body: { error: "version_locked", message: error.message } };
  }
  if (error instanceof IncompleteCostActivationError) {
    return { status: 409, body: { error: "incomplete_cost", message: error.message } };
  }
  if (error instanceof OutdatedCostStructureError) {
    return { status: 409, body: { error: "outdated_structure", message: error.message } };
  }
  if (
    error instanceof MissingTierPriceError ||
    error instanceof TargetMarginWithoutPriceError ||
    error instanceof NoTiersToActivateError
  ) {
    return { status: 409, body: { error: "incomplete_pricing", message: error.message } };
  }
  if (error instanceof DuplicatedTierQuantityError) {
    return { status: 409, body: { error: "duplicated_tier", message: error.message } };
  }
  if (
    error instanceof CalculationRequiredError ||
    error instanceof CalculationProductMismatchError
  ) {
    return { status: 400, body: { error: "invalid_calculation", message: error.message } };
  }
  if (error instanceof InvalidTierQuantityError) {
    return { status: 400, body: { error: "invalid_quantity", message: error.message } };
  }
  if (error instanceof InvalidPricingPercentError) {
    return { status: 400, body: { error: "invalid_percent", message: error.message } };
  }
  return null;
}

/**
 * Precificação industrial/comercial.
 *
 * Preço é informação comercial sensível: escrita é de COMMERCIAL e ADMIN, e
 * a leitura fica com quem negocia ou compra (Compras precisa enxergar o
 * impacto do custo). Produção, Qualidade e visualização geral não acessam.
 */
const WRITE_ROLES = ["COMMERCIAL", "ADMIN"] as const;
const READ_ROLES = ["COMMERCIAL", "ADMIN", "PURCHASING"] as const;

export const pricingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/pricing-versions", async (request, reply) => {
    try {
      requireRole(request, ...READ_ROLES);
      const parsed = listPricingVersionsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await listPricingVersions(parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/pricing-versions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...READ_ROLES);
      return reply.send(await getPricingVersion(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/pricing-versions/:id/rebase-preview", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      return reply.send(await getPricingRebasePreview(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/products/:id/pricing", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...READ_ROLES);
      return reply.send(await getProductPricing(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  // Read model preparado para a integração de Orçamento (capacidade 47).
  app.get("/products/:id/active-pricing", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...READ_ROLES);
      const pricing = await getActivePricingForProduct(id);
      if (!pricing) return reply.status(404).send({ error: "not_found" });
      return reply.send(pricing);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/products/:id/pricing", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = createPricingVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createPricingVersion(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/pricing-versions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = updatePricingVersionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updatePricingVersion(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/pricing-versions/:id/tiers", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = createPricingTierSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createPricingTier(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/pricing-tiers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = updatePricingTierSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updatePricingTier(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.delete("/pricing-tiers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      return reply.send(await deletePricingTier(id, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/pricing-versions/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = activatePricingVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await activatePricingVersion(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
