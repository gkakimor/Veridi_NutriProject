import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireRole } from "../../lib/current-user.js";
import {
  ComponentItemNotFoundError,
  DuplicateComponentItemError,
  FormulationVersionNotFoundError,
  IncompatibleComponentUnitError,
  InactiveComponentItemError,
  InvalidComponentItemTypeError,
  InvalidComponentQuantityError,
  MissingFinishedItemError,
  ProductNotFoundError,
} from "../formulations/formulations.errors.js";
import {
  FormulationNotEmptyForTemplateError,
  FormulationTemplateNotFoundError,
  FormulationTemplateVersionNotFoundError,
  TemplateArchivedError,
  TemplateDosesRequiredError,
  TemplateDraftAlreadyExistsError,
  TemplateVersionNotActiveError,
  TemplateVersionNotDraftError,
  TemplateVersionWithoutComponentsError,
} from "./formulation-templates.errors.js";
import {
  activateFormulationTemplateVersion,
  compareTemplateVersions,
  createFormulationTemplate,
  createTemplateVersionFrom,
  getFormulationTemplate,
  getFormulationTemplateVersion,
  listFormulationTemplates,
  setFormulationTemplateArchived,
  updateFormulationTemplate,
  updateFormulationTemplateVersion,
} from "./formulation-templates.service.js";
import {
  applyTemplateToProduct,
  compareFormulationWithTemplate,
  createTemplateFromFormulation,
  getTemplateUpdateAvailable,
} from "./apply-template.service.js";
import {
  applyFormulationTemplateSchema,
  archiveFormulationTemplateSchema,
  createFormulationTemplateSchema,
  createTemplateFromFormulationSchema,
  listFormulationTemplatesQuerySchema,
  updateFormulationTemplateSchema,
  updateFormulationTemplateVersionSchema,
} from "./formulation-templates.schemas.js";

/**
 * Biblioteca técnica de Formulações.
 *
 * Escrita segue a política do domínio técnico — quem mexe em fórmula é
 * produção ou administração. Leitura é de qualquer pessoa autenticada: saber
 * qual matriz existe é trabalho normal de quem negocia e de quem compra.
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
    error instanceof FormulationTemplateNotFoundError ||
    error instanceof FormulationTemplateVersionNotFoundError ||
    error instanceof FormulationVersionNotFoundError ||
    error instanceof ProductNotFoundError
  ) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof TemplateVersionNotDraftError) {
    return { status: 409, body: { error: "template_version_not_draft", message: error.message } };
  }
  if (error instanceof TemplateVersionNotActiveError) {
    return { status: 409, body: { error: "template_version_not_active", message: error.message } };
  }
  if (error instanceof TemplateDraftAlreadyExistsError) {
    return { status: 409, body: { error: "template_draft_exists", message: error.message } };
  }
  if (error instanceof TemplateVersionWithoutComponentsError) {
    return { status: 409, body: { error: "template_without_components", message: error.message } };
  }
  if (error instanceof TemplateArchivedError) {
    return { status: 409, body: { error: "template_archived", message: error.message } };
  }
  if (error instanceof FormulationNotEmptyForTemplateError) {
    return { status: 409, body: { error: "formulation_not_empty", message: error.message } };
  }
  if (error instanceof MissingFinishedItemError) {
    return { status: 409, body: { error: "missing_finished_item", message: error.message } };
  }
  if (
    error instanceof TemplateDosesRequiredError ||
    error instanceof DuplicateComponentItemError ||
    error instanceof InvalidComponentItemTypeError ||
    error instanceof InactiveComponentItemError ||
    error instanceof ComponentItemNotFoundError ||
    error instanceof InvalidComponentQuantityError ||
    error instanceof IncompatibleComponentUnitError
  ) {
    return { status: 400, body: { error: "invalid_component", message: error.message } };
  }
  return null;
}

export const formulationTemplatesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/formulation-templates", async (request, reply) => {
    try {
      requireRole(request, ...READ_ROLES);
      const parsed = listFormulationTemplatesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const { page, pageSize } = parsed.data;
      return reply.send(await listFormulationTemplates(parsed.data, { page, pageSize }));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/formulation-templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...READ_ROLES);
      return reply.send(await getFormulationTemplate(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/formulation-templates", async (request, reply) => {
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = createFormulationTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createFormulationTemplate(parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/formulation-templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...WRITE_ROLES);
      const parsed = updateFormulationTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateFormulationTemplate(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/formulation-templates/:id/archive", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = archiveFormulationTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await setFormulationTemplateArchived(id, parsed.data.archived, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.get("/formulation-template-versions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...READ_ROLES);
      return reply.send(await getFormulationTemplateVersion(id));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/formulation-template-versions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...WRITE_ROLES);
      const parsed = updateFormulationTemplateVersionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateFormulationTemplateVersion(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/formulation-template-versions/:id/activate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      return reply.send(await activateFormulationTemplateVersion(id, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/formulation-template-versions/:id/new-version", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      return reply.status(201).send(await createTemplateVersionFrom(id, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /** Diff entre duas versões de template. */
  app.get("/formulation-template-versions/:id/compare", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { against } = request.query as { against?: string };
    try {
      requireRole(request, ...READ_ROLES);
      if (!against) {
        return reply
          .status(400)
          .send({ error: "validation_error", message: "Informe a versão a comparar." });
      }
      return reply.send(await compareTemplateVersions(id, against));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /*
   * Aplicar um template ao produto: COPIA. Nenhuma linha compartilhada,
   * nenhum vínculo vivo. Dois clientes partem da mesma matriz e seguem
   * caminhos diferentes sem que um saiba do outro.
   */
  app.post("/products/:productId/formulation-versions/from-template", async (request, reply) => {
    const { productId } = request.params as { productId: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = applyFormulationTemplateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply
        .status(201)
        .send(
          await applyTemplateToProduct(productId, parsed.data.formulationTemplateVersionId, actor),
        );
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /** Existe versão de template mais recente que a que originou esta formulação? */
  app.get("/formulation-versions/:id/template-update", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...READ_ROLES);
      return reply.send({ update: await getTemplateUpdateAvailable(id) });
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /** O que muda entre esta formulação e a versão nova do template. */
  app.get("/formulation-versions/:id/template-diff", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { against } = request.query as { against?: string };
    try {
      requireRole(request, ...READ_ROLES);
      return reply.send(await compareFormulationWithTemplate(id, against));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /** Salvar a formulação do produto como matriz da biblioteca — cópia. */
  app.post("/formulation-versions/:id/save-as-template", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...WRITE_ROLES);
      const parsed = createTemplateFromFormulationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createTemplateFromFormulation(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
