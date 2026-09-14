import { formatQuantity } from "../../lib/quantity";
import { useMemo, useState } from "react";
import type { CustomerOrderStatus } from "@veridi/shared";
import {
  CUSTOMER_ORDER_BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  recusaDoPeriodo,
} from "@veridi/shared";
import {
  getAwaitingBillingReport,
  getBillingPeriodReport,
  getOrderDeliveredBilledReport,
} from "../../lib/reports-api";
import { clienteFilterSource } from "../../lib/filter-sources";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import {
  DocLink,
  ReportPage,
  ReportPagination,
  ReportSummaryItem,
  ReportTable,
} from "./ReportPage";
import { useReport } from "./useReport";
import { useFiltrosDigitados } from "./useFiltrosDigitados";
import { ariaDoPeriodoRecusado, diaDoRelatorio } from "./report-period";
import { emDias } from "../../lib/duration";
import { formatBRL } from "../../lib/currency";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";

const PAGE_SIZE = 25;


/**
 * Filtro por Cliente com busca no servidor — o `<select>` de mil clientes
 * escondia do filtro quem passasse do milésimo.
 */
function CustomerFilter({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <EntityFilterSelect
      id={id}
      label="Cliente"
      placeholder="Todos os clientes"
      value={value}
      onChange={onChange}
      source={clienteFilterSource}
    />
  );
}

/** R-15 — Faturamento por período. */
export function BillingPeriodReportPage() {
  const [customerId, setCustomerId] = useState("");
  const [page, setPage] = useState(1);
  const digitados = useFiltrosDigitados({ search: "", from: diaDoRelatorio(-29), to: diaDoRelatorio(0) }, setPage);
  const { search, from, to } = digitados.aplicados;

  const filters = useMemo(
    () => ({
      search,
      customerId,
      from,
      to,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, customerId, from, to, page],
  );
  const periodoRecusado = recusaDoPeriodo(from, to);
  const { data, loading, error } = useReport(getBillingPeriodReport, filters, { enabled: periodoRecusado === null });

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
      periodRefusal={periodoRecusado}
      filtersPending={digitados.pendente}
      summary={
        // Sem documento no recorte, não há valor a completar: "Valores
        // incompletos" apontaria um preço faltando que não existe. O vazio é
        // dito pela tabela.
        data &&
        data.summary.billingCount > 0 && (
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
          <input id="bill-from" type="date" {...digitados.campo("from")} {...ariaDoPeriodoRecusado(periodoRecusado)} />
          <label htmlFor="bill-to">até</label>
          <input id="bill-to" type="date" {...digitados.campo("to")} {...ariaDoPeriodoRecusado(periodoRecusado)} />
          <CustomerFilter
            id="bill-customer"
            value={customerId}
            onChange={(value) => {
              setPage(1);
              setCustomerId(value);
            }}
          />
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por faturamento, pedido ou expedição…"
              {...digitados.campo("search")}
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
        // Curta de propósito: a célula da tabela não quebra linha, e em 390px
        // a frase inteira precisa caber na área visível.
        emptyMessage="Nenhum faturamento para os filtros informados."
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
  const [customerId, setCustomerId] = useState("");
  const [page, setPage] = useState(1);
  const digitados = useFiltrosDigitados({ search: "" }, setPage);
  const { search } = digitados.aplicados;

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
      filtersPending={digitados.pendente}
      filters={
        <>
          <CustomerFilter
            id="await-customer"
            value={customerId}
            onChange={(value) => {
              setPage(1);
              setCustomerId(value);
            }}
          />
          <div className="toolbar__search">
            <input type="search" placeholder="Buscar por expedição, pedido ou cliente…" {...digitados.campo("search")} />
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
            <td className="is-number">{emDias(row.daysWaiting)}</td>
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
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const digitados = useFiltrosDigitados({ search: "" }, setPage);
  const { search } = digitados.aplicados;

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
      filtersPending={digitados.pendente}
      filters={
        <>
          <CustomerFilter
            id="odb-customer"
            value={customerId}
            onChange={(value) => {
              setPage(1);
              setCustomerId(value);
            }}
          />
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
            <input type="search" placeholder="Buscar por pedido ou cliente…" {...digitados.campo("search")} />
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
              {formatQuantity(row.orderedQuantity)} {row.unitCode}
            </td>
            <td className="is-number">{formatQuantity(row.shippedQuantity)}</td>
            <td className="is-number">{formatQuantity(row.billedQuantity)}</td>
            <td className="is-number">{formatQuantity(row.unbilledShippedQuantity)}</td>
            <td className="is-number">{formatQuantity(row.outstandingDeliveryQuantity)}</td>
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
