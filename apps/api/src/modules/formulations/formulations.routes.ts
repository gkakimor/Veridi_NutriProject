import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import {
  activateFormulationVersion,
  createFirstFormulationVersion,
  createNewVersionFrom,
  getFormulationVersionById,
  listFormulationVersionsByProduct,
  listFormulations,
  updateFormulationVersion,
} from "./formulations.service.js";
import {
  ComponentItemNotFoundError,
  DuplicateComponentItemError,
  FormulationActivationError,
  FormulationAlreadyExistsError,
  FormulationVersionNotFoundError,
  InactiveComponentItemError,
  IncompatibleComponentUnitError,
  InvalidComponentItemTypeError,
  InvalidComponentQuantityError,
  MissingFinishedItemError,
  ProductNotFoundError,
  VersionIsDraftSourceError,
  VersionNotActiveError,
  VersionNotDraftError,
} from "./formulations.errors.js";
import {
  createFormulationVersionSchema,
  listFormulationsQuerySchema,
  updateFormulationVersionSchema,
} from "./formulations.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ProductNotFoundError) {
    return { status: 400, body: { error: "product_not_found", message: error.message } };
  }
  if (error instanceof FormulationVersionNotFoundError) {
    return { status: 400, body: { error: "version_not_found", message: error.message } };
  }
  if (error instanceof MissingFinishedItemError) {
    return { status: 400, body: { error: "missing_finished_item", message: error.message } };
  }
  if (error instanceof FormulationAlreadyExistsError) {
    return { status: 400, body: { error: "formulation_already_exists", message: error.message } };
  }
  if (error instanceof VersionNotDraftError) {
    return { status: 400, body: { error: "version_not_draft", message: error.message } };
  }
  if (error instanceof VersionNotActiveError) {
    return { status: 400, body: { error: "version_not_active", message: error.message } };
  }
  if (error instanceof VersionIsDraftSourceError) {
    return { status: 400, body: { error: "version_is_draft_source", message: error.message } };
  }
  if (error instanceof DuplicateComponentItemError) {
    return { status: 400, body: { error: "duplicate_component", message: error.message } };
  }
  if (error instanceof InvalidComponentItemTypeError) {
    return { status: 400, body: { error: "invalid_component_type", message: error.message } };
  }
  if (error instanceof InactiveComponentItemError) {
    return { status: 400, body: { error: "inactive_component", message: error.message } };
  }
  if (error instanceof ComponentItemNotFoundError) {
    return { status: 400, body: { error: "component_not_found", message: error.message } };
  }
  if (error instanceof InvalidComponentQuantityError) {
    return { status: 400, body: { error: "invalid_component_quantity", message: error.message } };
  }
  if (error instanceof IncompatibleComponentUnitError) {
    return { status: 400, body: { error: "incompatible_component_unit", message: error.message } };
  }
  if (error instanceof FormulationActivationError) {
    return { status: 400, body: { error: "activation_blocked", message: error.message } };
  }
  return null;
}

/**
 * `GET /formulations`, `GET /products/:productId/formulations`,
 * `GET /formulation-versions/:id`, `POST /products/:productId/formulation-versions`,
 * `PATCH /formulation-versions/:id`, `POST /formulation-versions/:id/activate`,
 * `POST /formulation-versions/:id/new-version`.
 *
 * ACTIVE/INACTIVE nunca aceitam edicao — so DRAFT. Sem DELETE nesta entrega.
 */
export const formulationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/formulations", async (request, reply) => {
    const parsed = listFormulationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listFormulations(parsed.data);
    return reply.send(result);
  });

  app.get("/products/:productId/formulations", async (request, reply) => {
    const { productId } = request.params as { productId: string };
    try {
      const result = await listFormulationVersionsByProduct(productId);
      return reply.send(result);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/formulation-versions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await getFormulationVersionById(id);
    if (!version) return reply.status(404).send({ error: "not_found" });
    return reply.send(version);
  });

  app.post("/products/:productId/formulation-versions", async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const parsed = createFormulationVersionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const version = await createFirstFormulationVersion(productId, parsed.data);
      return reply.status(201).send(version);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/formulation-versions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateFormulationVersionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const version = await updateFormulationVersion(id, parsed.data);
      return reply.send(version);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/formulation-versions/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const version = await activateFormulationVersion(id);
      return reply.send(version);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/formulation-versions/:id/new-version", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const version = await createNewVersionFrom(id);
      return reply.status(201).send(version);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
