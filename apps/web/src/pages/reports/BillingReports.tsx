import { useEffect, useMemo, useState } from "react";
import type { CustomerDTO, CustomerOrderStatus } from "@veridi/shared";
import {
  CUSTOMER_ORDER_BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
} from "@veridi/shared";
import {
  getAwaitingBillingReport,
  getBillingPeriodReport,
  getOrderDeliveredBilledReport,
} from "../../lib/reports-api";
import { listCustomers } from "../../lib/customers-api";
import {
  DocLink,
  ReportPage,
  ReportPagination,
  ReportSummaryItem,
  ReportTable,
} from "./ReportPage";
import { useReport } from "./useReport";
import { dateInputValueOffset } from "../../lib/period";
import { formatBRL } from "../../lib/currency";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";

const PAGE_SIZE = 25;


function useCustomerOptions() {
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
  }, []);
  return customers;
}

/** R-15 — Faturamento por período. */
export function BillingPeriodReportPage() {
  const customers = useCustomerOptions();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState(dateInputValueOffset(-29));
  const [to, setTo] = useState(dateInputValueOffset(0));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      search,
      customerId,
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59.999`).toISOString(),
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, customerId, from, to, page],
  );
  const { data, loading, error } = useReport(getBillingPeriodReport, filters);

  return (
    <ReportPage
      title="R-15 · Faturamento por período"
      csvPath="/reports/billing/period/export.csv"
      reportCode="R-15"
      csvFilters={filters}
      total={data?.total}
      subtitle="Somente faturamentos emitidos, pela data de emissão."
      loading={loading}
      error={error}
      summary={
        data && (
          <>
            <ReportSummaryItem label="Documentos emitidos" value={data.summary.billingCount} />
            <ReportSummaryItem
              label="Com preço completo"
              value={`${data.summary.billingsWithCompletePricing} de ${data.summary.billingCount}`}
            />
            {/* Total só existe quando TODOS os documentos têm preço completo. */}
            <ReportSummaryItem
              label="Valor faturado"
              value={data.summary.totalAmount ? formatBRL(data.summary.totalAmount) : "Valores incompletos"}
            />
          </>
        )
      }
      filters={
        <>
          <label htmlFor="bill-from">De</label>
          <input id="bill-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <label htmlFor="bill-to">até</label>
          <input id="bill-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <label htmlFor="bill-customer">Cliente</label>
          <select
            id="bill-customer"
            value={customerId}
            onChange={(event) => {
              setPage(1);
              setCustomerId(event.target.value);
            }}
          >
            <option value="">Todos</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.legalName}
              </option>
            ))}
          </select>
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por faturamento, pedido ou expedição…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
        </>
      }
    >
      <ReportTable
        columns={[
          "Faturamento",
          "Data",
          "Pedido",
          "Expedição",
          "Cliente",
          "Linhas",
          "Valor",
          "Precificação",
          "Referência externa",
        ]}
        emptyMessage="Nenhum faturamento emitido no período."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.billingId}>
            <td>
              <DocLink code={row.code} to={`/comercial/faturamento/${row.billingId}`} />
            </td>
            <td>{formatDate(row.issuedAt)}</td>
            <td>
              <DocLink code={row.customerOrderCode} to={`/comercial/pedidos/${row.customerOrderId}`} />
            </td>
            <td>
              <DocLink code={row.shipmentCode} to={`/comercial/expedicoes/${row.shipmentId}`} />
            </td>
            <td>{row.customerName ?? "—"}</td>
            <td className="is-number">{row.lineCount}</td>
            <td className="is-number">{row.totalAmount ? formatBRL(row.totalAmount) : "—"}</td>
            <td>{row.hasCompletePricing ? "Completa" : "Incompleta"}</td>
            <td>{row.externalReference ?? "—"}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-16 — Aguardando faturamento. */
export function AwaitingBillingReportPage() {
  const customers = useCustomerOptions();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ search, customerId, page, pageSize: PAGE_SIZE }),
    [search, customerId, page],
  );
  const { data, loading, error } = useReport(getAwaitingBillingReport, filters);

  return (
    <ReportPage
      title="R-16 · Aguardando faturamento"
      csvPath="/reports/billing/awaiting/export.csv"
      reportCode="R-16"
      csvFilters={filters}
      total={data?.total}
      subtitle="Expedições confirmadas ainda sem faturamento emitido — mais antiga primeiro."
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="await-customer">Cliente</label>
          <select
            id="await-customer"
            value={customerId}
            onChange={(event) => {
              setPage(1);
              setCustomerId(event.target.value);
            }}
          >
            <option value="">Todos</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.legalName}
              </option>
            ))}
          </select>
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por expedição, pedido ou cliente…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
        </>
      }
    >
      <ReportTable
        columns={[
          "Expedição",
          "Data",
          "Pedido",
          "Cliente",
          "Produtos",
          "Situação",
          "Faturamento em preparação",
          "Aguardando há",
        ]}
        emptyMessage="Nenhuma expedição aguardando faturamento."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.shipmentId}>
            <td>
              <DocLink code={row.shipmentCode} to={`/comercial/expedicoes/${row.shipmentId}`} />
            </td>
            <td>{formatDate(row.confirmedAt)}</td>
            <td>
              <DocLink code={row.customerOrderCode} to={`/comercial/pedidos/${row.customerOrderId}`} />
            </td>
            <td>{row.customerName ?? "—"}</td>
            <td>{row.productCodes.join(", ")}</td>
            <td>{row.situation === "DRAFT" ? "Em preparação" : "Pendente"}</td>
            <td>
              <DocLink
                code={row.billingCode}
                to={row.billingId ? `/comercial/faturamento/${row.billingId}` : null}
              />
            </td>
            <td className="is-number">{row.daysWaiting} dias</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-17 — Pedido x Entregue x Faturado. */
export function OrderDeliveredBilledReportPage() {
  const customers = useCustomerOptions();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ search, customerId, status, page, pageSize: PAGE_SIZE }),
    [search, customerId, status, page],
  );
  const { data, loading, error } = useReport(getOrderDeliveredBilledReport, filters);

  return (
    <ReportPage
      title="R-17 · Pedido x Entregue x Faturado"
      csvPath="/reports/billing/order-delivered-billed/export.csv"
      reportCode="R-17"
      csvFilters={filters}
      total={data?.total}
      subtitle="Expedido conta só Expedições confirmadas; faturado conta só Faturamentos emitidos."
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="odb-customer">Cliente</label>
          <select
            id="odb-customer"
            value={customerId}
            onChange={(event) => {
              setPage(1);
              setCustomerId(event.target.value);
            }}
          >
            <option value="">Todos</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.legalName}
              </option>
            ))}
          </select>
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">Todos os status</option>
            {(Object.keys(CUSTOMER_ORDER_STATUS_LABELS) as CustomerOrderStatus[]).map((option) => (
              <option key={option} value={option}>
                {CUSTOMER_ORDER_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por pedido ou cliente…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
        </>
      }
    >
      <ReportTable
        columns={[
          "Pedido",
          "Cliente",
          "Produto",
          "Qtd. pedida",
          "Expedido",
          "Faturado",
          "Expedido sem faturar",
          "Falta entregar",
          "Status",
          "Faturamento",
        ]}
        emptyMessage="Nenhuma linha de pedido encontrada."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.customerOrderLineId}>
            <td>
              <DocLink code={row.customerOrderCode} to={`/comercial/pedidos/${row.customerOrderId}`} />
            </td>
            <td>{row.customerName}</td>
            <td>
              <EntityLink kind="product" id={row.productId} code={row.productCode} name={row.productName} />
            </td>
            <td className="is-number">
              {row.orderedQuantity} {row.unitCode}
            </td>
            <td className="is-number">{row.shippedQuantity}</td>
            <td className="is-number">{row.billedQuantity}</td>
            <td className="is-number">{row.unbilledShippedQuantity}</td>
            <td className="is-number">{row.outstandingDeliveryQuantity}</td>
            <td>{CUSTOMER_ORDER_STATUS_LABELS[row.status]}</td>
            <td>{CUSTOMER_ORDER_BILLING_STATUS_LABELS[row.billingStatus]}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}
