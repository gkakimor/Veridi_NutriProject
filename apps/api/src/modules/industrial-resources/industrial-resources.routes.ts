import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import {
  IndustrialResourceNotFoundError,
  InvalidResourcePowerError,
  InvalidResourceRateError,
  InvalidResourceRateUomError,
} from "./industrial-resources.errors.js";
import {
  createIndustrialResourceSchema,
  createResourceRateSchema,
  listResourcesQuerySchema,
  updateIndustrialResourceSchema,
} from "./industrial-resources.schemas.js";
import {
  createIndustrialResource,
  createResourceRate,
  getIndustrialResource,
  listIndustrialResources,
  updateIndustrialResource,
} from "./industrial-resources.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof IndustrialResourceNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof InvalidResourcePowerError) {
    return { status: 400, body: { error: "invalid_power", message: error.message } };
  }
  if (error instanceof InvalidResourceRateUomError) {
    return { status: 400, body: { error: "invalid_rate_uom", message: error.message } };
  }
  if (error instanceof InvalidResourceRateError) {
    return { status: 400, body: { error: "invalid_rate", message: error.message } };
  }
  return null;
}

/**
 * Recursos industriais e tarifas.
 *
 * Escrita é de ADMIN: tarifa de mão de obra, equipamento e energia é
 * configuração econômica da fábrica, não cadastro operacional. Os demais
 * perfis consultam — o comercial precisa ver a tarifa para entender a
 * estrutura de custo. Não existe perfil de custeio nesta fase.
 *
 * Não há rota de edição de tarifa: tarifa é imutável, reajuste é registro
 * novo.
 */
export const industrialResourcesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/industrial-resources", async (request, reply) => {
    requireCurrentUser(request);
    const parsed = listResourcesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listIndustrialResources(parsed.data));
  });

  app.get("/industrial-resources/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    requireCurrentUser(request);
    const resource = await getIndustrialResource(id);
    if (!resource) return reply.status(404).send({ error: "not_found" });
    return reply.send(resource);
  });

  app.post("/industrial-resources", async (request, reply) => {
    try {
      const actor = requireRole(request, "ADMIN");
      const parsed = createIndustrialResourceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createIndustrialResource(parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/industrial-resources/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "ADMIN");
      const parsed = updateIndustrialResourceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateIndustrialResource(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/industrial-resources/:id/rates", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "ADMIN");
      const parsed = createResourceRateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createResourceRate(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
