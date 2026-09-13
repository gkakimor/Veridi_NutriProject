import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { ProductNotOperationalError } from "../../lib/product-lifecycle.js";
import { requireRole } from "../../lib/current-user.js";
import type { ZodError } from "zod";
import { ForbiddenError } from "../auth/auth.errors.js";
import {
  ProductWithoutUnitError,
  ProductionProfileUomIncompatibleError,
  ProductionProfileVersionNotActiveError,
  ProductionProfileVersionNotFoundError,
} from "../production-profiles/production-profiles.errors.js";
import {
  applyProductionProfileToOrder,
  cancelProductionOrder,
  createProductionOrder,
  getProductionOrderById,
  listProductionOrders,
  planProductionOrder,
  releaseProductionOrder,
  updateProductionOrder,
} from "./production-orders.service.js";
import {
  CustomerMismatchError,
  FormulationVersionNotFoundError,
  FormulationVersionProductMismatchError,
  InactiveProductError,
  InvalidTransitionError,
  LegacyRouteRepairNeedsConfirmationError,
  MissingFinishedItemError,
  NoDefaultProductionProfileError,
  OrderLockedError,
  PlanValidationError,
  ProductNotFoundError,
  ProductionOrderNotFoundError,
  ProductionRouteChangedError,
  ReleaseValidationError,
  RouteReasonRequiredError,
  RouteRequiredError,
  ScheduleRemovalNeedsConfirmationError,
} from "./production-orders.errors.js";
import {
  applyProductionRouteSchema,
  cancelProductionOrderSchema,
  createProductionOrderSchema,
  listProductionOrdersQuerySchema,
  updateProductionOrderSchema,
} from "./production-orders.schemas.js";

/**
 * Quem opera a Ordem de Produção pela porta direta: Produção e Administração
 * (PRODUCTION-ROUTE-ASSIGNMENT-01). Criar, editar, aplicar ou trocar roteiro,
 * planejar, liberar e cancelar. Ler continua aberto a toda sessão válida.
 *
 * A OP que nasce do Pedido NÃO passa por aqui: o Plano de Atendimento e o
 * saldo têm rota própria e seguem abertos ao Comercial — o Pedido gera a
 * necessidade; como fabricar é da Produção.
 */
const OPERATION_ROLES = ["ADMIN", "PRODUCTION"] as const;

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
  if (error instanceof RouteRequiredError) {
    return { status: 400, body: { error: "route_required", message: error.message } };
  }
  if (error instanceof RouteReasonRequiredError) {
    return { status: 400, body: { error: "reason_required", message: error.message } };
  }
  if (error instanceof LegacyRouteRepairNeedsConfirmationError) {
    return { status: 409, body: { error: "legacy_repair_needs_confirmation", message: error.message } };
  }
  if (error instanceof ScheduleRemovalNeedsConfirmationError) {
    return { status: 409, body: { error: "schedule_removal_needs_confirmation", message: error.message } };
  }
  if (error instanceof ProductionRouteChangedError) {
    return { status: 409, body: { error: "route_changed", message: error.message } };
  }
  if (error instanceof ProductionProfileVersionNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof ProductionProfileVersionNotActiveError) {
    return { status: 409, body: { error: "profile_version_not_active", message: error.message } };
  }
  if (error instanceof ProductWithoutUnitError) {
    return { status: 400, body: { error: "product_without_unit", message: error.message } };
  }
  if (error instanceof ProductionProfileUomIncompatibleError) {
    return { status: 400, body: { error: "incompatible_uom", message: error.message } };
  }
  /*
   * A cópia do roteiro é uma por OP (unique). Com a linha da ordem travada a
   * corrida não chega aqui; se chegar, é conflito — nunca 500.
   */
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return {
      status: 409,
      body: {
        error: "route_changed",
        message: "Outra alteração desta ordem terminou antes. Recarregue a ordem e tente de novo.",
      },
    };
  }
  if (error instanceof ProductNotOperationalError) {
    // Produto técnico de projeto não entra em operação comercial/industrial.
    return { status: 400, body: { error: "product_not_operational", message: error.message } };
  }
  if (error instanceof ProductNotFoundError) {
    return { status: 400, body: { error: "product_not_found", message: error.message } };
  }
  if (error instanceof InactiveProductError) {
    return { status: 400, body: { error: "inactive_product", message: error.message } };
  }
  if (error instanceof MissingFinishedItemError) {
    return { status: 400, body: { error: "missing_finished_item", message: error.message } };
  }
  if (error instanceof FormulationVersionNotFoundError) {
    return { status: 400, body: { error: "version_not_found", message: error.message } };
  }
  if (error instanceof FormulationVersionProductMismatchError) {
    return { status: 400, body: { error: "version_product_mismatch", message: error.message } };
  }
  if (error instanceof ProductionOrderNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof InvalidTransitionError) {
    return { status: 400, body: { error: "invalid_transition", message: error.message } };
  }
  if (error instanceof OrderLockedError) {
    return { status: 400, body: { error: "order_locked", message: error.message } };
  }
  if (error instanceof NoDefaultProductionProfileError) {
    return { status: 400, body: { error: "no_production_profile", message: error.message } };
  }
  if (error instanceof PlanValidationError) {
    return { status: 400, body: { error: "plan_validation_failed", message: error.message } };
  }
  if (error instanceof ReleaseValidationError) {
    return { status: 400, body: { error: "release_validation_failed", message: error.message } };
  }
  /*
   * Nasce em `resolveOrderCustomerId`: o Produto pertence a um cliente e o
   * Pedido da OP a outro. Chega aqui pelo PATCH (trocar de produto resolve o
   * cliente de novo) e pelo /plan (OP que ainda não tem cliente resolvido).
   * É recusa de regra de negócio, e saía como 500 — a mensagem certa aparecia
   * por acidente, porque o handler genérico do Fastify também carrega
   * `message`. Mesmo status e mesmo código já usados pelos dois irmãos:
   * `apply-fulfillment-plan` (a mesma classe) e o módulo de Projetos
   * (`ProjectProductCustomerMismatchError`).
   */
  if (error instanceof CustomerMismatchError) {
    return { status: 400, body: { error: "customer_mismatch", message: error.message } };
  }
  return null;
}

/**
 * `GET /production-orders`, `GET /production-orders/:id`, `POST /production-orders`,
 * `PATCH /production-orders/:id`, `POST /production-orders/:id/production-profile`,
 * `POST /production-orders/:id/plan`,
 * `POST /production-orders/:id/release`, `POST /production-orders/:id/cancel`.
 *
 * Sem PATCH de status livre — so as transicoes DRAFT->PLANNED (via /plan),
 * PLANNED->RELEASED (via /release) e DRAFT|PLANNED|RELEASED->CANCELLED
 * (via /cancel) existem nesta entrega.
 */
export const productionOrdersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/production-orders", async (request, reply) => {
    const parsed = listProductionOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    const result = await listProductionOrders(parsed.data);
    return reply.send(result);
  });

  app.get("/production-orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await getProductionOrderById(id);
    if (!order) return reply.status(404).send({ error: "not_found" });
    return reply.send(order);
  });

  /*
   * Escrita: o perfil vem ANTES da validação do corpo — quem não opera a OP
   * recebe 403, não uma lista de campos a corrigir.
   */
  app.post("/production-orders", async (request, reply) => {
    try {
      const actor = requireRole(request, ...OPERATION_ROLES);
      const parsed = createProductionOrderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const order = await createProductionOrder(parsed.data, actor);
      return reply.status(201).send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.patch("/production-orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...OPERATION_ROLES);
      const parsed = updateProductionOrderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const order = await updateProductionOrder(id, parsed.data, actor);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  /*
   * Aplicar ou trocar o roteiro da OP. Corpo vazio aplica o padrão atual do
   * Produto; com `productionProfileVersionId` aplica a versão escolhida, e
   * `setAsProductDefault` grava também o padrão do Produto na mesma transação.
   * Situação, motivo e confirmações são decididos no serviço.
   */
  app.post("/production-orders/:id/production-profile", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...OPERATION_ROLES);
      const parsed = applyProductionRouteSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const order = await applyProductionProfileToOrder(id, parsed.data, actor);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/plan", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, ...OPERATION_ROLES);
      const order = await planProductionOrder(id, actor);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/release", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      // RELEASE é ação auditada: quem liberou vem da sessão.
      const actor = requireRole(request, ...OPERATION_ROLES);
      const order = await releaseProductionOrder(id, { id: actor.id, name: actor.name });
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/production-orders/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireRole(request, ...OPERATION_ROLES);
      const parsed = cancelProductionOrderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      const order = await cancelProductionOrder(id, parsed.data.reason);
      return reply.send(order);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
