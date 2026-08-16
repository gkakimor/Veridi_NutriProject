import type { FastifyPluginAsync } from "fastify";
import type { ZodError, ZodTypeAny } from "zod";
import {
  getExpiryReport,
  getInventoryPosition,
  getMovementsReport,
} from "./inventory-reports.service.js";
import {
  getConsumptionReport,
  getPlannedActualReport,
  getProductionTraceability,
  getRequirementsReport,
} from "./production-reports.service.js";
import {
  getLatePurchaseOrdersReport,
  getOnOrderReport,
  getPurchaseOrdersReport,
  getReceiptsReport,
} from "./purchasing-reports.service.js";
import {
  getCustomerOrdersReport,
  getFulfillmentReport,
  getOrderDeliveredBilledReport,
  getOrderOperation,
} from "./commercial-reports.service.js";
import { getAwaitingBillingReport, getBillingPeriodReport } from "./billing-reports.service.js";
import { ALL_ROWS } from "../../lib/pagination.js";
import type { Pagination } from "../../lib/pagination.js";
import {
  awaitingBillingQuerySchema,
  billingPeriodQuerySchema,
  consumptionQuerySchema,
  customerOrdersQuerySchema,
  expiryQuerySchema,
  fulfillmentQuerySchema,
  inventoryPositionQuerySchema,
  movementsQuerySchema,
  onOrderQuerySchema,
  orderOperationQuerySchema,
  plannedActualQuerySchema,
  productionTraceabilityQuerySchema,
  purchaseOrdersQuerySchema,
  receiptsQuerySchema,
  requirementsQuerySchema,
} from "./reports.schemas.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Relatórios (capacidade 31) — todos SOMENTE LEITURA.
 *
 * Cada relatório é um read model próprio sobre as entidades operacionais:
 * não existe tabela de relatório, agregado persistido nem BI configurável.
 * Filtro e paginação são conceitos separados, para a exportação (capacidade
 * 32) reutilizar os mesmos filtros pedindo o resultado completo.
 */
export const reportsRoutes: FastifyPluginAsync = async (app) => {
  function register<TSchema extends ZodTypeAny>(
    path: string,
    schema: TSchema,
    handler: (query: TSchema["_output"], pagination?: Pagination) => Promise<unknown>,
  ) {
    app.get(path, async (request, reply) => {
      const parsed = schema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }
      // `all=true` devolve o resultado filtrado completo (impressão); a
      // paginação continua sendo o padrão da tela.
      const query = parsed.data as { all?: boolean };
      const result = await handler(parsed.data, query.all === true ? ALL_ROWS : undefined);
      if (result === null) return reply.status(404).send({ error: "not_found" });
      return reply.send(result);
    });
  }

  // Estoque
  register("/reports/inventory/position", inventoryPositionQuerySchema, getInventoryPosition);
  register("/reports/inventory/expiry", expiryQuerySchema, getExpiryReport);
  register("/reports/inventory/movements", movementsQuerySchema, getMovementsReport);

  // Produção
  register("/reports/production/requirements", requirementsQuerySchema, getRequirementsReport);
  register("/reports/production/planned-actual", plannedActualQuerySchema, getPlannedActualReport);
  register(
    "/reports/production/traceability",
    productionTraceabilityQuerySchema,
    getProductionTraceability,
  );
  register("/reports/production/consumption", consumptionQuerySchema, getConsumptionReport);

  // Compras
  register("/reports/purchasing/orders", purchaseOrdersQuerySchema, getPurchaseOrdersReport);
  register("/reports/purchasing/receipts", receiptsQuerySchema, getReceiptsReport);
  register("/reports/purchasing/on-order", onOrderQuerySchema, getOnOrderReport);
  register("/reports/purchasing/late", onOrderQuerySchema, getLatePurchaseOrdersReport);

  // Comercial
  register("/reports/commercial/orders", customerOrdersQuerySchema, getCustomerOrdersReport);
  register("/reports/commercial/fulfillment", fulfillmentQuerySchema, getFulfillmentReport);
  register("/reports/commercial/order-operation", orderOperationQuerySchema, getOrderOperation);

  // Faturamento
  register("/reports/billing/period", billingPeriodQuerySchema, getBillingPeriodReport);
  register("/reports/billing/awaiting", awaitingBillingQuerySchema, getAwaitingBillingReport);
  register(
    "/reports/billing/order-delivered-billed",
    fulfillmentQuerySchema,
    getOrderDeliveredBilledReport,
  );
};
