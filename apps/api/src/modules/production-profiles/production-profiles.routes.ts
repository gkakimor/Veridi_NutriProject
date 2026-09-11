import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ProductionPlanInputError } from "@veridi/shared";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import {
  CapacityResourceNotAllowedError,
  DuplicateStepResourceError,
  ProductWithoutUnitError,
  ProductionProfileDraftExistsError,
  ProductionProfileEmptyError,
  ProductionProfileNotFoundError,
  ProductionProfileProductNotFoundError,
  ProductionProfileUomIncompatibleError,
  ProductionProfileUomNotFoundError,
  ProductionProfileVersionNotActiveError,
  ProductionProfileVersionNotDraftError,
  ProductionProfileVersionNotFoundError,
  StepResourceInactiveError,
  StepResourceNotFoundError,
} from "./production-profiles.errors.js";
import {
  activateProductionProfileVersion,
  createProductionProfile,
  createProductionProfileVersionFrom,
  getProductProductionProfile,
  getProductionProfile,
  getProductionProfileVersion,
  listProductionProfiles,
  previewProductionProfileVersion,
  setProductProductionProfile,
  updateProductionProfileIdentity,
  updateProductionProfileVersion,
} from "./production-profiles.service.js";
import {
  createProductionProfileSchema,
  listProductionProfilesQuerySchema,
  previewQuerySchema,
  setProductProductionProfileSchema,
  updateProductionProfileIdentitySchema,
  updateProductionProfileVersionSchema,
} from "./production-profiles.schemas.js";

/**
 * Planejamento → Perfis de Produção (`PRODUCT_RULES.md` §89).
 *
 * Mesmo gate da Estrutura de Custos: quem configura como se produz é
 * produção ou administração; os demais perfis leem.
 */
const READ_ROLES = ["ADMIN", "PRODUCTION", "QUALITY", "PURCHASING", "COMMERCIAL", "VIEWER"] as const;
const WRITE_ROLES = ["ADMIN", "PRODUCTION"] as const;

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
    error instanceof ProductionProfileNotFoundError ||
    error instanceof ProductionProfileVersionNotFoundError ||
    error instanceof ProductionProfileProductNotFoundError
  ) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ProductionProfileVersionNotDraftError) {
    return { status: 409, body: { error: "profile_version_not_draft", message: error.message } };
  }
  if (error instanceof ProductionProfileDraftExistsError) {
    return { status: 409, body: { error: "profile_draft_exists", message: error.message } };
  }
  if (error instanceof ProductionProfileEmptyError) {
    return { status: 409, body: { error: "profile_empty", message: error.message } };
  }
  if (error instanceof ProductionProfileVersionNotActiveError) {
    return { status: 409, body: { error: "profile_version_not_active", message: error.message } };
  }
  // Energia não é capacidade: recusa de negócio, nunca 500.
  if (error instanceof CapacityResourceNotAllowedError) {
    return { status: 400, body: { error: "resource_not_capacity", message: error.message } };
  }
  if (error instanceof StepResourceNotFoundError) {
    return { status: 400, body: { error: "invalid_resource", message: error.message } };
  }
  if (error instanceof StepResourceInactiveError) {
    return { status: 400, body: { error: "resource_inactive", message: error.message } };
  }
  if (error instanceof DuplicateStepResourceError) {
    return { status: 400, body: { error: "duplicate_step_resource", message: error.message } };
  }
  if (error instanceof ProductionProfileUomNotFoundError) {
    return { status: 400, body: { error: "invalid_uom", message: error.message } };
  }
  if (error instanceof ProductWithoutUnitError) {
    return { status: 400, body: { error: "product_without_unit", message: error.message } };
  }
  if (error instanceof ProductionProfileUomIncompatibleError) {
    return { status: 400, body: { error: "incompatible_uom", message: error.message } };
  }
  if (error instanceof ProductionPlanInputError) {
    return { status: 400, body: { error: "invalid_quantity", message: error.message } };
  }
  return null;
}

export const productionProfilesRoutes: FastifyPluginAsync = async (app) => {
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

  app.get("/production-profiles", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const parsed = listProductionProfilesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const { page, pageSize } = parsed.data;
      return reply.send(await listProductionProfiles(parsed.data, { page, pageSize }));
    }),
  );

  app.post("/production-profiles", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = createProductionProfileSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createProductionProfile(parsed.data, actor));
    }),
  );

  app.get("/production-profiles/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await getProductionProfile(id));
    }),
  );

  app.patch("/production-profiles/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = updateProductionProfileIdentitySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateProductionProfileIdentity(id, parsed.data));
    }),
  );

  app.get("/production-profile-versions/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await getProductionProfileVersion(id));
    }),
  );

  app.patch("/production-profile-versions/:id", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      const parsed = updateProductionProfileVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateProductionProfileVersion(id, parsed.data));
    }),
  );

  app.post("/production-profile-versions/:id/activate", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      return reply.send(await activateProductionProfileVersion(id, actor));
    }),
  );

  app.post("/production-profile-versions/:id/new-version", async (request, reply) =>
    guard(reply, async () => {
      const actor = requireRole(request, ...WRITE_ROLES);
      const { id } = request.params as { id: string };
      return reply.status(201).send(await createProductionProfileVersionFrom(id, actor));
    }),
  );

  /** Simulação: GET de propósito — calcula e devolve, nunca grava. */
  app.get("/production-profile-versions/:id/preview", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { id } = request.params as { id: string };
      const parsed = previewQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await previewProductionProfileVersion(id, parsed.data.quantity));
    }),
  );

  app.get("/products/:productId/production-profile", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...READ_ROLES);
      const { productId } = request.params as { productId: string };
      return reply.send(await getProductProductionProfile(productId));
    }),
  );

  app.put("/products/:productId/production-profile", async (request, reply) =>
    guard(reply, async () => {
      requireRole(request, ...WRITE_ROLES);
      const { productId } = request.params as { productId: string };
      const parsed = setProductProductionProfileSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(
        await setProductProductionProfile(productId, parsed.data.productionProfileVersionId),
      );
    }),
  );
};
