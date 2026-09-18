/**
 * Contrato de filtros de cada relatório exportável — REPORTS-PRINT-FILTER-KEYS-DRIFT-01.
 *
 * O PDF de um relatório lê o CSV da API e escreve "Filtros aplicados" só com
 * as chaves que o schema DAQUELE relatório aceita. A lista vivia copiada à mão
 * no `ReportPrintPage` (web): filtro novo na API sem a chave na web sumia do
 * papel sem aviso, e filtro removido na API continuaria declarado.
 *
 * Agora a lista mora aqui, uma vez, e os dois lados a leem: a impressão usa
 * `csvPath` e `filterKeys` daqui, e o teste de contrato da API
 * (`api modules/exports/report-filter-contracts.test.ts`) compara cada
 * `filterKeys` com as chaves do schema da rota `csvPath` — chave acrescentada
 * ou removida de um lado só reprova. É metadado, não schema: a web não depende
 * do zod da API.
 *
 * `filterKeys` não inclui paginação (`page`, `pageSize`, `all`): paginação não
 * é filtro, e o documento traz o recorte inteiro.
 */
export interface ReportFilterContract {
  /** Rota de exportação CSV — a mesma que o PDF lê. */
  readonly csvPath: string;
  /** Chaves de filtro que o schema da rota aceita, na ordem do schema. */
  readonly filterKeys: readonly string[];
}

export const REPORT_FILTER_CONTRACTS = {
  "R-01": {
    csvPath: "/reports/inventory/position/export.csv",
    filterKeys: ["search", "itemId", "itemType", "status", "location", "ownerType", "ownerCustomerId", "onlyWithBalance"],
  },
  "R-02": {
    csvPath: "/reports/inventory/expiry/export.csv",
    filterKeys: ["search", "itemId", "itemType", "window", "onlyWithBalance", "from", "to"],
  },
  "R-03": {
    csvPath: "/reports/inventory/movements/export.csv",
    filterKeys: ["search", "itemId", "lotId", "type", "sourceType", "from", "to"],
  },
  "R-04": {
    csvPath: "/reports/production/requirements/export.csv",
    filterKeys: ["search", "productionOrderId", "productId", "status", "onlyShortage"],
  },
  "R-05": {
    csvPath: "/reports/production/planned-actual/export.csv",
    filterKeys: ["search", "productId", "productionOrderId", "status", "includeCost", "from", "to"],
  },
  "R-07": {
    csvPath: "/reports/production/consumption/export.csv",
    filterKeys: ["search", "itemId", "productId", "productionOrderId", "from", "to"],
  },
  "R-08": {
    csvPath: "/reports/purchasing/orders/export.csv",
    filterKeys: ["search", "supplierId", "status", "origin", "from", "to"],
  },
  "R-09": {
    csvPath: "/reports/purchasing/receipts/export.csv",
    filterKeys: ["search", "supplierId", "itemId", "purchaseOrderId", "from", "to"],
  },
  "R-10": {
    csvPath: "/reports/purchasing/on-order/export.csv",
    filterKeys: ["search", "supplierId", "itemId"],
  },
  "R-11": {
    csvPath: "/reports/purchasing/late/export.csv",
    filterKeys: ["search", "supplierId", "itemId"],
  },
  "R-12": {
    csvPath: "/reports/commercial/orders/export.csv",
    filterKeys: ["search", "customerId", "status", "from", "to"],
  },
  "R-13": {
    csvPath: "/reports/commercial/fulfillment/export.csv",
    filterKeys: ["search", "customerId", "customerOrderId", "productId", "status", "from", "to"],
  },
  "R-15": {
    csvPath: "/reports/billing/period/export.csv",
    filterKeys: ["search", "customerId", "customerOrderId", "from", "to"],
  },
  "R-16": {
    csvPath: "/reports/billing/awaiting/export.csv",
    filterKeys: ["search", "customerId"],
  },
  "R-17": {
    csvPath: "/reports/billing/order-delivered-billed/export.csv",
    // Mesmo schema do R-13 na API.
    filterKeys: ["search", "customerId", "customerOrderId", "productId", "status", "from", "to"],
  },
  "R-18": {
    csvPath: "/reports/costs/industrial-by-product/export.csv",
    filterKeys: ["search", "customerId", "active"],
  },
  "R-19": {
    csvPath: "/reports/costs/pricing-by-product/export.csv",
    filterKeys: ["search", "customerId"],
  },
  "R-20": {
    csvPath: "/reports/commercial/quote-pricing/export.csv",
    filterKeys: ["search", "customerId", "priceSource", "status", "from", "to"],
  },
  "R-21": {
    csvPath: "/reports/inventory/internal-consumption/export.csv",
    filterKeys: ["search", "itemId", "purpose", "registeredByUserId", "costSource", "hasCost", "from", "to"],
  },
} as const satisfies Readonly<Record<string, ReportFilterContract>>;

export type ReportFilterContractCode = keyof typeof REPORT_FILTER_CONTRACTS;
