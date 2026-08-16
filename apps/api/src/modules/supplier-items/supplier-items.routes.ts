import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import {
  IncompatibleOfferUomError,
  InactiveSupplierItemPartyError,
  InvalidCurrencyCodeError,
  InvalidMinimumOrderError,
  InvalidOfferPriceError,
  InvalidOfferValidityError,
  SupplierItemAlreadyExistsError,
  SupplierItemInvalidItemTypeError,
  SupplierItemItemNotFoundError,
  SupplierItemNotEligibleForPreferredError,
  SupplierItemNotFoundError,
  SupplierItemSupplierNotFoundError,
} from "./supplier-items.errors.js";
import {
  changeQualificationSchema,
  createOfferSchema,
  createSupplierItemSchema,
  listSupplierItemsQuerySchema,
  setPreferredSchema,
  updateSupplierItemSchema,
} from "./supplier-items.schemas.js";
import {
  changeQualification,
  createOffer,
  createSupplierItem,
  getSupplierItemById,
  listSupplierItems,
  setPreferred,
  updateSupplierItem,
} from "./supplier-items.service.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof SupplierItemNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (
    error instanceof SupplierItemItemNotFoundError ||
    error instanceof SupplierItemSupplierNotFoundError
  ) {
    return { status: 400, body: { error: "not_found_reference", message: error.message } };
  }
  if (error instanceof SupplierItemAlreadyExistsError) {
    return { status: 409, body: { error: "already_exists", message: error.message } };
  }
  if (error instanceof SupplierItemInvalidItemTypeError) {
    return { status: 400, body: { error: "invalid_item_type", message: error.message } };
  }
  if (error instanceof InactiveSupplierItemPartyError) {
    return { status: 400, body: { error: "inactive_reference", message: error.message } };
  }
  if (error instanceof SupplierItemNotEligibleForPreferredError) {
    return { status: 409, body: { error: "not_eligible_preferred", message: error.message } };
  }
  if (error instanceof InvalidCurrencyCodeError) {
    return { status: 400, body: { error: "invalid_currency", message: error.message } };
  }
  if (error instanceof IncompatibleOfferUomError) {
    return { status: 400, body: { error: "incompatible_uom", message: error.message } };
  }
  if (error instanceof InvalidMinimumOrderError) {
    return { status: 400, body: { error: "invalid_minimum_order", message: error.message } };
  }
  if (error instanceof InvalidOfferValidityError) {
    return { status: 400, body: { error: "invalid_validity", message: error.message } };
  }
  if (error instanceof InvalidOfferPriceError) {
    return { status: 400, body: { error: "invalid_price", message: error.message } };
  }
  return null;
}

/**
 * `GET/POST /supplier-items`, homologação, preferencial e ofertas.
 *
 * Compras mantém a relação comercial (cadastro, código do fornecedor,
 * preços, preferencial); homologar/bloquear é da Qualidade — Compras não
 * homologa o próprio fornecedor. Devolver para pendente é administrativo e
 * fica com ambos. Qualquer usuário autenticado consulta.
 */
export const supplierItemsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/supplier-items", async (request, reply) => {
    requireCurrentUser(request);
    const parsed = listSupplierItemsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listSupplierItems(parsed.data));
  });

  app.get("/supplier-items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    requireCurrentUser(request);
    const supplierItem = await getSupplierItemById(id);
    if (!supplierItem) return reply.status(404).send({ error: "not_found" });
    return reply.send(supplierItem);
  });

  app.get("/items/:id/supplier-items", async (request, reply) => {
    const { id } = request.params as { id: string };
    requireCurrentUser(request);
    return reply.send(await listSupplierItems({ itemId: id, page: 1, pageSize: 100 }));
  });

  app.get("/suppliers/:id/supplier-items", async (request, reply) => {
    const { id } = request.params as { id: string };
    requireCurrentUser(request);
    return reply.send(await listSupplierItems({ supplierId: id, page: 1, pageSize: 100 }));
  });

  app.post("/supplier-items", async (request, reply) => {
    try {
      const actor = requireRole(request, "PURCHASING", "ADMIN");
      const parsed = createSupplierItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createSupplierItem(parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/supplier-items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "PURCHASING", "ADMIN");
      const parsed = updateSupplierItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await updateSupplierItem(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/supplier-items/:id/qualification", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const parsed = changeQualificationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      // Homologar/bloquear é ato da Qualidade; devolver para pendente é
      // administrativo e Compras também pode fazer.
      const actor =
        parsed.data.status === "PENDING"
          ? requireRole(request, "PURCHASING", "QUALITY", "ADMIN")
          : requireRole(request, "QUALITY", "ADMIN");

      return reply.send(await changeQualification(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/supplier-items/:id/preferred", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "PURCHASING", "ADMIN");
      const parsed = setPreferredSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.send(await setPreferred(id, parsed.data.preferred, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/supplier-items/:id/offers", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "PURCHASING", "ADMIN");
      const parsed = createOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      return reply.status(201).send(await createOffer(id, parsed.data, actor));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
