import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { ProductNotOperationalError } from "../../lib/product-lifecycle.js";
import { createOrderFromAcceptedQuote } from "./quote-to-order.service.js";
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
  applyQuoteLinePricing,
  getQuoteLinePricingOptions,
  useManualQuoteLinePrice,
} from "./quote-pricing.service.js";
import {
  addProjectProduct,
  listProjectProducts,
  removeProjectProduct,
} from "./project-products.service.js";
import {
  ProjectNotPreparableError,
  ProjectProductAlreadyExistsError,
} from "./technical-product.service.js";
import {
  CustomerLockedError,
  IncompleteQuoteError,
  ProjectProductCustomerMismatchError,
  ProjectProductDuplicateError,
  ProjectProductNotFoundError,
  QuoteLineDuplicateError,
  QuoteLineNotFoundError,
  QuoteLineProductNotInProjectError,
  InvalidStatusTransitionError,
  MissingAcceptedQuoteError,
  MissingCancelDetailsError,
  MissingFinishedUnitError,
  ProjectLockedError,
  ProjectNotFoundError,
  QuoteNotDraftError,
  QuoteNotFoundError,
  QuoteNotSentError,
  ProjectNotApprovedForOrderError,
  QuoteNotAcceptedForOrderError,
  QuoteOrderUomMismatchError,
  QuoteWithoutOrderableLinesError,
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
  addProjectProductSchema,
  addQuoteLineSchema,
  updateQuoteLineSchema,
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
  addQuoteLine,
  createQuoteVersion,
  removeQuoteLine,
  updateQuoteLine,
  canSeePricingProvenance,
  getQuoteById,
  rejectQuoteVersion,
  sendQuoteVersion,
  previewQuotePaymentSchedule,
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
  if (
    error instanceof ProjectNotFoundError ||
    error instanceof QuoteNotFoundError ||
    error instanceof QuoteLineNotFoundError ||
    error instanceof ProjectProductNotFoundError
  ) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof QuoteLineDuplicateError || error instanceof ProjectProductDuplicateError) {
    return { status: 409, body: { error: "duplicate", message: error.message } };
  }
  if (error instanceof QuoteLineProductNotInProjectError) {
    return { status: 400, body: { error: "product_not_in_project", message: error.message } };
  }
  if (error instanceof ProjectProductCustomerMismatchError) {
    return { status: 400, body: { error: "customer_mismatch", message: error.message } };
  }
  if (error instanceof QuoteNotAcceptedForOrderError) {
    return { status: 409, body: { error: "quote_not_accepted", message: error.message } };
  }
  if (error instanceof ProjectNotApprovedForOrderError) {
    return { status: 409, body: { error: "project_not_approved", message: error.message } };
  }
  if (error instanceof QuoteWithoutOrderableLinesError) {
    return { status: 409, body: { error: "quote_without_lines", message: error.message } };
  }
  if (error instanceof QuoteOrderUomMismatchError) {
    return { status: 409, body: { error: "uom_mismatch", message: error.message } };
  }
  if (error instanceof ProductNotOperationalError) {
    return { status: 409, body: { error: "product_not_operational", message: error.message } };
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
    const user = requireCurrentUser(request);
    // Mesmo gate do detalhe do orçamento: Produção vê a proposta, nunca
    // custo, margem ou comissão.
    const project = await getProjectById(id, canSeePricingProvenance(user.role));
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

  /*
   * Produtos do projeto.
   *
   * Duas formas legítimas de entrar: criar o produto técnico aqui, ou
   * vincular um que já existe. Produto de outro cliente é recusado.
   */
  app.get("/projects/:id/products", async (request, reply) => {
    const { id } = request.params as { id: string };
    requireCurrentUser(request);
    return reply.send({ products: await listProjectProducts(id) });
  });

  app.post("/projects/:id/products", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = addProjectProductSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await addProjectProduct(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.delete("/project-products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      await removeProjectProduct(id);
      return reply.status(204).send();
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
    // Custo, margem, markup e comissão são informação interna: só quem
    // negocia (ou administra) recebe a proveniência econômica — e ela é por
    // linha, porque cada produto tem a própria cadeia PREC → CALC. O DTO
    // monta isso a partir das relações já carregadas: antes a rota fazia uma
    // consulta por linha, e o detalhe do projeto não montava nada.
    const quote = await getQuoteById(id, canSeePricingProvenance(user.role));
    if (!quote) return reply.status(404).send({ error: "not_found" });

    return reply.send(quote);
  });

  /*
   * Linhas do orçamento.
   *
   * A proposta é da negociação: só produto associado ao projeto entra, e só
   * enquanto a versão é rascunho. Proposta apresentada é história.
   */
  app.post("/quote-versions/:id/lines", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = addQuoteLineSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await addQuoteLine(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/quote-lines/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = updateQuoteLineSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateQuoteLine(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.delete("/quote-lines/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      return reply.send(await removeQuoteLine(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/quote-lines/:id/pricing-options", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      const pricing = await getQuoteLinePricingOptions(id);
      if (!pricing) return reply.status(404).send({ error: "not_found" });
      return reply.send(pricing);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/quote-lines/:id/apply-pricing", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = applyQuotePricingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const quoteVersionId = await applyQuoteLinePricing(id, parsed.data.pricingTierId, actor);
      return reply.send(await getQuoteById(quoteVersionId, canSeePricingProvenance(actor.role)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/quote-lines/:id/manual-price", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const quoteVersionId = await useManualQuoteLinePrice(id, actor);
      return reply.send(await getQuoteById(quoteVersionId, canSeePricingProvenance(actor.role)));
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

  /*
   * Simular condições sem gravar. Uma chamada por clique — recalcular a cada
   * tecla digitada faria o formulário conversar com o servidor o tempo todo
   * para mostrar números que ninguém pediu ainda.
   */
  app.post("/quote-versions/:id/payment-preview", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, "COMMERCIAL", "ADMIN");
      const parsed = updateQuoteVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send({ schedule: await previewQuotePaymentSchedule(id, parsed.data) });
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /*
   * Proposta aceita → Pedido. Uma única maneira de executar a operação: não
   * existe caminho paralelo pelo Projeto que faça a mesma coisa por outra
   * porta. 201 quando nasce, 200 quando já existia — clicar duas vezes abre
   * o mesmo pedido em vez de criar um segundo.
   */
  app.post("/quote-versions/:id/create-order", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const { order, alreadyExisted } = await createOrderFromAcceptedQuote(id, actor);
      return reply.status(alreadyExisted ? 200 : 201).send(order);
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
