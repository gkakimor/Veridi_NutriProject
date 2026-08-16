import type {
  AwaitingBillingReportRowDTO,
  BillingPeriodRowDTO,
  BillingPeriodSummaryDTO,
  ConsumptionRowDTO,
  CustomerOrderReportRowDTO,
  ExpiryRowDTO,
  FulfillmentRowDTO,
  InventoryPositionRowDTO,
  LatePurchaseOrderRowDTO,
  MovementReportRowDTO,
  OnOrderRowDTO,
  OrderDeliveredBilledRowDTO,
  OrderOperationDTO,
  PlannedActualRowDTO,
  ProductionRequirementRowDTO,
  ProductionTraceabilityDTO,
  PurchaseOrderReportRowDTO,
  ReceiptReportRowDTO,
  ReportPageDTO,
} from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Cliente dos relatórios. Filtro e paginação são passados separadamente: o
 * filtro define o resultado, a página só a fatia — é isso que permitirá a
 * exportação (capacidade 32) reutilizar os mesmos read models pedindo o
 * resultado completo.
 */
export type ReportFilters = Record<string, string | number | boolean | undefined>;

async function fetchReport<T>(path: string, filters: ReportFilters): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${API_URL}/reports/${path}${suffix}`);
  return (await parseJsonOrThrow(response)) as T;
}

/* Estoque */
export const getInventoryPositionReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<InventoryPositionRowDTO>>("inventory/position", filters);
export const getExpiryReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<ExpiryRowDTO>>("inventory/expiry", filters);
export const getMovementsReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<MovementReportRowDTO>>("inventory/movements", filters);

/* Produção */
export const getRequirementsReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<ProductionRequirementRowDTO>>("production/requirements", filters);
export const getPlannedActualReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<PlannedActualRowDTO>>("production/planned-actual", filters);
export const getProductionTraceabilityReport = (filters: ReportFilters) =>
  fetchReport<ProductionTraceabilityDTO>("production/traceability", filters);
export const getConsumptionReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<ConsumptionRowDTO>>("production/consumption", filters);

/* Compras */
export const getPurchaseOrdersReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<PurchaseOrderReportRowDTO>>("purchasing/orders", filters);
export const getReceiptsReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<ReceiptReportRowDTO>>("purchasing/receipts", filters);
export const getOnOrderReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<OnOrderRowDTO>>("purchasing/on-order", filters);
export const getLatePurchaseOrdersReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<LatePurchaseOrderRowDTO>>("purchasing/late", filters);

/* Comercial */
export const getCustomerOrdersReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<CustomerOrderReportRowDTO>>("commercial/orders", filters);
export const getFulfillmentReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<FulfillmentRowDTO>>("commercial/fulfillment", filters);
export const getOrderOperationReport = (filters: ReportFilters) =>
  fetchReport<OrderOperationDTO>("commercial/order-operation", filters);

/* Faturamento */
export interface BillingPeriodReport extends ReportPageDTO<BillingPeriodRowDTO> {
  summary: BillingPeriodSummaryDTO;
}
export const getBillingPeriodReport = (filters: ReportFilters) =>
  fetchReport<BillingPeriodReport>("billing/period", filters);
export const getAwaitingBillingReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<AwaitingBillingReportRowDTO>>("billing/awaiting", filters);
export const getOrderDeliveredBilledReport = (filters: ReportFilters) =>
  fetchReport<ReportPageDTO<OrderDeliveredBilledRowDTO>>("billing/order-delivered-billed", filters);
