import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import {
  IncompleteCostQuoteError,
  PriceLockedByPricingError,
  PricingNotActiveError,
  PricingProductMismatchError,
  PricingTierNotFoundForQuoteError,
  QuoteQuantityMismatchError,
  QuoteUomIncompatibleError,
  QuoteWithoutProductError,
  TierWithoutPriceError,
  applyQuotePricing,
  getQuotePricingOptions,
  getQuoteWithPricing,
  toPricingProvenance,
  useManualQuotePrice,
} from "./quote-pricing.service.js";
import {
  ProjectNotPreparableError,
  ProjectProductAlreadyExistsError,
} from "./technical-product.service.js";
import {
  CustomerLockedError,
  IncompleteQuoteError,
  InvalidStatusTransitionError,
  MissingAcceptedQuoteError,
  MissingCancelDetailsError,
  MissingFinishedUnitError,
  ProjectLockedError,
  ProjectNotFoundError,
  QuoteNotDraftError,
  QuoteNotFoundError,
  QuoteNotSentError,
} from "./projects.errors.js";
import {
  applyQuotePricingSchema,
  approveProjectSchema,
  prepareTechnicalProductSchema,
  sendQuoteVersionSchema,
  cancelProjectSchema,
  changeProjectStatusSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  rejectQuoteSchema,
  updateProjectSchema,
  updateQuoteVersionSchema,
} from "./projects.schemas.js";
import {
  approveProject,
  prepareTechnicalProduct,
  cancelProject,
  changeProjectStatus,
  createProject,
  getProjectById,
  getProjectVocabulary,
  listProjects,
  updateProject,
} from "./projects.service.js";
import {
  acceptQuoteVersion,
  createQuoteVersion,
  getQuoteById,
  rejectQuoteVersion,
  sendQuoteVersion,
  updateQuoteVersion,
} from "./quotes.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof ProjectNotFoundError || error instanceof QuoteNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ProjectLockedError) {
    return { status: 409, body: { error: "project_locked", message: error.message } };
  }
  if (error instanceof InvalidStatusTransitionError) {
    return { status: 409, body: { error: "invalid_transition", message: error.message } };
  }
  if (error instanceof CustomerLockedError) {
    return { status: 409, body: { error: "customer_locked", message: error.message } };
  }
  if (error instanceof MissingAcceptedQuoteError) {
    return { status: 409, body: { error: "missing_accepted_quote", message: error.message } };
  }
  if (error instanceof MissingFinishedUnitError) {
    return { status: 400, body: { error: "missing_finished_unit", message: error.message } };
  }
  if (error instanceof MissingCancelDetailsError) {
    return { status: 400, body: { error: "missing_cancel_details", message: error.message } };
  }
  if (error instanceof QuoteNotDraftError) {
    return { status: 409, body: { error: "quote_not_draft", message: error.message } };
  }
  if (error instanceof PricingTierNotFoundForQuoteError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (
    error instanceof PricingProductMismatchError ||
    error instanceof QuoteWithoutProductError ||
    error instanceof TierWithoutPriceError
  ) {
    return { status: 400, body: { error: "invalid_pricing", message: error.message } };
  }
  if (error instanceof PricingNotActiveError) {
    return { status: 409, body: { error: "pricing_not_active", message: error.message } };
  }
  if (
    error instanceof QuoteQuantityMismatchError ||
    error instanceof QuoteUomIncompatibleError
  ) {
    return { status: 409, body: { error: "quantity_mismatch", message: error.message } };
  }
  if (error instanceof PriceLockedByPricingError) {
    return { status: 409, body: { error: "price_locked", message: error.message } };
  }
  if (error instanceof IncompleteCostQuoteError) {
    return { status: 409, body: { error: "incomplete_cost", message: error.message } };
  }
  if (error instanceof ProjectProductAlreadyExistsError) {
    return { status: 409, body: { error: "product_exists", message: error.message } };
  }
  if (error instanceof ProjectNotPreparableError) {
    return { status: 409, body: { error: "not_preparable", message: error.message } };
  }
  if (error instanceof QuoteNotSentError) {
    return { status: 409, body: { error: "quote_not_sent", message: error.message } };
  }
  if (error instanceof IncompleteQuoteError) {
    return { status: 400, body: { error: "incomplete_quote", message: error.message } };
  }
  return null;
}

/**
 * Projetos e orçamentos. Criar/alterar projeto e negociar orçamento são
 * ações comerciais (COMMERCIAL/ADMIN); leitura fica aberta a qualquer
 * usuário autenticado. Quem executou vem sempre da sessão.
 */
export const projectsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projects", async (request, reply) => {
    const parsed = listProjectsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listProjects(parsed.data));
  });

  // Vocabulário já usado — alimenta o autocomplete de conceito/canal.
  app.get("/projects/vocabulary", async (_request, reply) => {
    return reply.send(await getProjectVocabulary());
  });

  app.get("/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProjectById(id);
    if (!project) return reply.status(404).send({ error: "not_found" });
    return reply.send(project);
  });

  app.post("/projects", async (request, reply) => {
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = createProjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createProject(parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = updateProjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateProject(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/projects/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = changeProjectStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(
        await changeProjectStatus(id, parsed.data.status, parsed.data.reason, actor),
      );
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/projects/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = cancelProjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await cancelProject(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/projects/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = approveProjectSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await approveProject(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/projects/:id/technical-product", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = prepareTechnicalProductSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await prepareTechnicalProduct(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/projects/:id/quote-versions", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      return reply.status(201).send(await createQuoteVersion(id, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/quote-versions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = requireCurrentUser(request);
    const quote = await getQuoteById(id);
    if (!quote) return reply.status(404).send({ error: "not_found" });

    // Custo, margem, markup e comissão são informação interna: só quem
    // negocia (ou administra) recebe a proveniência econômica.
    if (user.role !== "COMMERCIAL" && user.role !== "ADMIN") return reply.send(quote);

    const row = await getQuoteWithPricing(id);
    return reply.send({ ...quote, pricing: toPricingProvenance(row) });
  });

  app.get("/quote-versions/:id/pricing-options", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      const pricing = await getQuotePricingOptions(id);
      if (!pricing) return reply.status(404).send({ error: "not_found" });
      return reply.send(pricing);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/quote-versions/:id/apply-pricing", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = applyQuotePricingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await applyQuotePricing(id, parsed.data.pricingTierId, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/quote-versions/:id/manual-price", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      return reply.send(await useManualQuotePrice(id, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/quote-versions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = updateQuoteVersionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateQuoteVersion(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/quote-versions/:id/send", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = sendQuoteVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await sendQuoteVersion(id, actor, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/quote-versions/:id/accept", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      return reply.send(await acceptQuoteVersion(id, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/quote-versions/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = rejectQuoteSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await rejectQuoteVersion(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
