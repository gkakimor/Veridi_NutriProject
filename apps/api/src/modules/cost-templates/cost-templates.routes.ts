import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import { ProductNotFoundError } from "../formulations/formulations.errors.js";
import { IndustrialCostVersionNotFoundError } from "../industrial-costs/industrial-costs.errors.js";
import { PricingVersionNotFoundError } from "../pricing/pricing.errors.js";
import {
  CostDraftInUseError,
  CostTemplateEmptyError,
  CostTemplateEnergyResourceRequiredError,
  CostTemplateNotFoundError,
  CostTemplateVersionNotFoundError,
  PricingPolicyCalculationRequiredError,
  PricingPolicyEmptyError,
  PricingPolicyNotFoundError,
  PricingPolicyVersionNotFoundError,
  TemplateArchivedForUseError,
  TemplateDraftExistsError,
  TemplateNotActiveError,
  TemplateNotDraftError,
} from "./cost-templates.errors.js";
import {
  activateCostTemplateVersion,
  compareCostTemplateVersions,
  createCostTemplate,
  createCostTemplateVersionFrom,
  getCostTemplate,
  getCostTemplateVersion,
  listCostTemplates,
  setCostTemplateArchived,
  updateCostTemplateIdentity,
  updateCostTemplateVersion,
} from "./cost-templates.service.js";
import {
  applyCostTemplateToProduct,
  compareCostVersionWithTemplate,
  createCostTemplateFromVersion,
  getCostTemplateUpdateAvailable,
} from "./apply-cost-template.service.js";
import {
  activatePricingPolicyVersion,
  applyPricingPolicyToProduct,
  comparePricingPolicyVersions,
  createPolicyFromPricingVersion,
  createPolicyVersionFrom,
  createPricingPolicy,
  getPricingPolicy,
  getPricingPolicyUpdateAvailable,
  getPricingPolicyVersion,
  listPricingPolicies,
  previewPricingPolicy,
  setPricingPolicyArchived,
  updatePricingPolicyIdentity,
  updatePricingPolicyVersion,
} from "./pricing-policies.service.js";
import {
  applyCostTemplateSchema,
  applyPricingPolicySchema,
  archiveTemplateSchema,
  createCostTemplateFromVersionSchema,
  createCostTemplateSchema,
  createPolicyFromPricingSchema,
  createPricingPolicySchema,
  listTemplatesQuerySchema,
  previewPricingPolicySchema,
  updateCostTemplateVersionSchema,
  updatePricingPolicyVersionSchema,
  updateTemplateIdentitySchema,
} from "./cost-templates.schemas.js";

/**
 * Bibliotecas de Estrutura de Custos e de Política de Precificação.
 *
 * Os gates seguem o domínio de cada uma, e não uma uniformidade artificial:
 * quem configura produção industrial é produção/administração; quem define
 * política comercial é comercial/administração. Dar acesso comercial a
 * produção só para os dois módulos ficarem iguais seria conceder permissão
 * que ninguém pediu.
 */
const READ_ROLES = ["ADMIN", "PRODUCTION", "QUALITY", "PURCHASING", "COMMERCIAL", "VIEWER"] as const;
const COST_WRITE_ROLES = ["ADMIN", "PRODUCTION"] as const;
const PRICING_WRITE_ROLES = ["ADMIN", "COMMERCIAL"] as const;

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (
    error instanceof CostTemplateNotFoundError ||
    error instanceof CostTemplateVersionNotFoundError ||
    error instanceof PricingPolicyNotFoundError ||
    error instanceof PricingPolicyVersionNotFoundError ||
    error instanceof IndustrialCostVersionNotFoundError ||
    error instanceof PricingVersionNotFoundError ||
    error instanceof ProductNotFoundError
  ) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof TemplateNotDraftError) {
    return { status: 409, body: { error: "template_not_draft", message: error.message } };
  }
  if (error instanceof TemplateNotActiveError) {
    return { status: 409, body: { error: "template_not_active", message: error.message } };
  }
  if (error instanceof TemplateDraftExistsError) {
    return { status: 409, body: { error: "template_draft_exists", message: error.message } };
  }
  if (error instanceof CostDraftInUseError) {
    return { status: 409, body: { error: "cost_draft_in_use", message: error.message } };
  }
  if (error instanceof TemplateArchivedForUseError) {
    return { status: 409, body: { error: "template_archived", message: error.message } };
  }
  if (error instanceof CostTemplateEmptyError || error instanceof PricingPolicyEmptyError) {
    return { status: 409, body: { error: "template_empty", message: error.message } };
  }
  if (error instanceof CostTemplateEnergyResourceRequiredError) {
    return { status: 400, body: { error: "energy_resource_required", message: error.message } };
  }
  if (error instanceof PricingPolicyCalculationRequiredError) {
    return { status: 400, body: { error: "calculation_required", message: error.message } };
  }
  return null;
}

export const costPricingTemplatesRoutes: FastifyPluginAsync = async (app) => {
  const guard = async (
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
    fn: () => Promise<unknown>,
  ) => {
    try {
      return await fn();
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  };

  // ══════════════════════════════════ Templates de Estrutura de Custos

  app.get("/cost-templates", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const parsed = listTemplatesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const { page, pageSize } = parsed.data;
      return reply.send(await listCostTemplates(parsed.data, { page, pageSize }));
    }),
  );

  app.get("/cost-templates/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await getCostTemplate(id));
    }),
  );

  app.post("/cost-templates", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...COST_WRITE_ROLES);
      const parsed = createCostTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createCostTemplate(parsed.data, actor));
    }),
  );

  app.patch("/cost-templates/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...COST_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = updateTemplateIdentitySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateCostTemplateIdentity(id, parsed.data));
    }),
  );

  app.post("/cost-templates/:id/archive", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...COST_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = archiveTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await setCostTemplateArchived(id, parsed.data.archived, actor));
    }),
  );

  app.get("/cost-template-versions/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await getCostTemplateVersion(id));
    }),
  );

  app.patch("/cost-template-versions/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...COST_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = updateCostTemplateVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateCostTemplateVersion(id, parsed.data));
    }),
  );

  app.post("/cost-template-versions/:id/activate", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...COST_WRITE_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await activateCostTemplateVersion(id, actor));
    }),
  );

  app.post("/cost-template-versions/:id/new-version", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...COST_WRITE_ROLES);
      const { id } = request.params as { id: string };
      return reply.status(201).send(await createCostTemplateVersionFrom(id, actor));
    }),
  );

  app.get("/cost-template-versions/:id/compare", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      const { against } = request.query as { against?: string };
      if (!against) {
        return reply
          .status(400)
          .send({ error: "validation_error", message: "Informe a versão a comparar." });
      }
      return reply.send(await compareCostTemplateVersions(id, against));
    }),
  );

  /*
   * Aplicar ao produto: COPIA a configuração. Tarifa nenhuma viaja — quanto
   * vale cada hora continua sendo resolvido pelo motor na data de referência.
   */
  app.post("/products/:productId/industrial-costs/from-template", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...COST_WRITE_ROLES);
      const { productId } = request.params as { productId: string };
      const parsed = applyCostTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply
        .status(201)
        .send(
          await applyCostTemplateToProduct(productId, parsed.data.costTemplateVersionId, actor),
        );
    }),
  );

  app.get("/industrial-costs/:id/template-update", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send({ update: await getCostTemplateUpdateAvailable(id) });
    }),
  );

  app.get("/industrial-costs/:id/template-diff", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      const { against } = request.query as { against?: string };
      return reply.send(await compareCostVersionWithTemplate(id, against));
    }),
  );

  app.post("/industrial-costs/:id/save-as-template", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...COST_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = createCostTemplateFromVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createCostTemplateFromVersion(id, parsed.data, actor));
    }),
  );

  // ══════════════════════════════════ Políticas de Precificação

  app.get("/pricing-policies", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const parsed = listTemplatesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const { page, pageSize } = parsed.data;
      return reply.send(await listPricingPolicies(parsed.data, { page, pageSize }));
    }),
  );

  app.get("/pricing-policies/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await getPricingPolicy(id));
    }),
  );

  app.post("/pricing-policies", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...PRICING_WRITE_ROLES);
      const parsed = createPricingPolicySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createPricingPolicy(parsed.data, actor));
    }),
  );

  app.patch("/pricing-policies/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...PRICING_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = updateTemplateIdentitySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updatePricingPolicyIdentity(id, parsed.data));
    }),
  );

  app.post("/pricing-policies/:id/archive", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...PRICING_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = archiveTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await setPricingPolicyArchived(id, parsed.data.archived, actor));
    }),
  );

  app.get("/pricing-policy-versions/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await getPricingPolicyVersion(id));
    }),
  );

  app.patch("/pricing-policy-versions/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...PRICING_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = updatePricingPolicyVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updatePricingPolicyVersion(id, parsed.data));
    }),
  );

  app.post("/pricing-policy-versions/:id/activate", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...PRICING_WRITE_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await activatePricingPolicyVersion(id, actor));
    }),
  );

  app.post("/pricing-policy-versions/:id/new-version", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...PRICING_WRITE_ROLES);
      const { id } = request.params as { id: string };
      return reply.status(201).send(await createPolicyVersionFrom(id, actor));
    }),
  );

  app.get("/pricing-policy-versions/:id/compare", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      const { against } = request.query as { against?: string };
      if (!against) {
        return reply
          .status(400)
          .send({ error: "validation_error", message: "Informe a versão a comparar." });
      }
      return reply.send(await comparePricingPolicyVersions(id, against));
    }),
  );

  /*
   * Prévia: o que ESTA política produziria NESTE produto. Leitura pura — a
   * mesma política dá preços diferentes em produtos diferentes, e isso
   * precisa estar visível antes de confirmar.
   */
  app.post("/products/:productId/pricing/policy-preview", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...PRICING_WRITE_ROLES);
      const { productId } = request.params as { productId: string };
      const parsed = previewPricingPolicySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(
        await previewPricingPolicy(
          productId,
          parsed.data.pricingPolicyVersionId,
          parsed.data.industrialCostCalculationId,
        ),
      );
    }),
  );

  app.post("/products/:productId/pricing/from-policy", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...PRICING_WRITE_ROLES);
      const { productId } = request.params as { productId: string };
      const parsed = applyPricingPolicySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply
        .status(201)
        .send(
          await applyPricingPolicyToProduct(
            productId,
            parsed.data.pricingPolicyVersionId,
            parsed.data.industrialCostCalculationId,
            actor,
          ),
        );
    }),
  );

  app.get("/pricing-versions/:id/policy-update", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send({ update: await getPricingPolicyUpdateAvailable(id) });
    }),
  );

  app.post("/pricing-versions/:id/save-as-policy", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...PRICING_WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = createPolicyFromPricingSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply
        .status(201)
        .send(await createPolicyFromPricingVersion(id, parsed.data, actor));
    }),
  );
};
