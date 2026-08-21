import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import { ForbiddenError } from "../auth/auth.errors.js";
import {
  ActiveBillingAlreadyExistsError,
  AgreedPriceNotEditableError,
  BillingLineNotFoundError,
  BillingNotDraftError,
  BillingNotFoundError,
  EmptyShipmentForBillingError,
  NoAgreedPriceToOverrideError,
  PriceOverrideReasonRequiredError,
  ShipmentNotBillableError,
} from "./billings.errors.js";
import {
  cancelBilling,
  createBilling,
  getBillingById,
  issueBilling,
  listAwaitingBilling,
  listBillings,
  overrideBillingLinePrice,
  updateBilling,
} from "./billings.service.js";
import {
  cancelBillingSchema,
  createBillingSchema,
  listBillingsQuerySchema,
  overrideBillingPriceSchema,
  updateBillingSchema,
} from "./billings.schemas.js";

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
  if (error instanceof BillingNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ShipmentNotBillableError) {
    return { status: 400, body: { error: "shipment_not_billable", message: error.message } };
  }
  if (error instanceof ActiveBillingAlreadyExistsError) {
    return { status: 400, body: { error: "active_billing_exists", message: error.message } };
  }
  if (error instanceof EmptyShipmentForBillingError) {
    return { status: 400, body: { error: "empty_billing", message: error.message } };
  }
  if (error instanceof AgreedPriceNotEditableError) {
    return { status: 400, body: { error: "agreed_price_not_editable", message: error.message } };
  }
  if (error instanceof PriceOverrideReasonRequiredError) {
    return { status: 400, body: { error: "override_reason_required", message: error.message } };
  }
  if (error instanceof NoAgreedPriceToOverrideError) {
    return { status: 400, body: { error: "no_agreed_price_to_override", message: error.message } };
  }
  if (error instanceof BillingNotDraftError) {
    return { status: 400, body: { error: "billing_not_draft", message: error.message } };
  }
  if (error instanceof BillingLineNotFoundError) {
    return { status: 400, body: { error: "billing_line_not_found", message: error.message } };
  }
  return null;
}

/**
 * `GET /billings`, `GET /billings/awaiting`, `GET /billings/:id`,
 * `POST /billings`, `PATCH /billings/:id`, `POST /billings/:id/issue`,
 * `POST /billings/:id/cancel`.
 *
 * Faturamento é comercial/operacional — nunca emite Nota Fiscal e nunca
 * movimenta estoque (a saída física já aconteceu no SHIPMENT_OUT da
 * Expedição).
 */
export const billingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/billings", async (request, reply) => {
    const parsed = listBillingsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }
    return reply.send(await listBillings(parsed.data));
  });

  // Precisa vir antes de `/billings/:id` para não ser capturada como id.
  app.get("/billings/awaiting", async (_request, reply) => {
    return reply.send(await listAwaitingBilling());
  });

  app.get("/billings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const billing = await getBillingById(id);
    if (!billing) return reply.status(404).send({ error: "not_found" });
    return reply.send(billing);
  });

  app.post("/billings", async (request, reply) => {
    const parsed = createBillingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.status(201).send(await createBilling(parsed.data.shipmentId, requireCurrentUser(request)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/billings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateBillingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await updateBilling(id, parsed.data));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /**
   * Alterar o preço faturado é decisão comercial, não operação de
   * expedição: Produção, Qualidade, Compras e Viewer não passam daqui.
   * Mesma política já usada em precificação e orçamento.
   */
  app.post("/billings/:id/lines/:lineId/price-override", async (request, reply) => {
    const { id, lineId } = request.params as { id: string; lineId: string };
    const parsed = overrideBillingPriceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const actor = requireRole(request, "COMMERCIAL", "ADMIN");
      const billing = await overrideBillingLinePrice(id, lineId, parsed.data, actor);
      return reply.send(billing);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/billings/:id/issue", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await issueBilling(id, requireCurrentUser(request)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/billings/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = cancelBillingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await cancelBilling(id, parsed.data.reason, requireCurrentUser(request)));
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
