import { useEffect, useMemo, useState } from "react";
import type { CustomerDTO, CustomerOrderDTO, CustomerOrderStatus } from "@veridi/shared";
import {
  CUSTOMER_ORDER_BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
} from "@veridi/shared";
import {
  getCustomerOrdersReport,
  getFulfillmentReport,
  getOrderOperationReport,
} from "../../lib/reports-api";
import { listCustomers } from "../../lib/customers-api";
import { listCustomerOrders } from "../../lib/customer-orders-api";
import { DocLink, ReportPage, ReportPagination, ReportTable } from "./ReportPage";
import { useReport } from "./useReport";
import { dateInputValueOffset } from "../../lib/period";
import { formatBRL } from "../../lib/currency";

const PAGE_SIZE = 25;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function useCustomerOptions() {
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
  }, []);
  return customers;
}

function CustomerFilter({
  customers,
  value,
  onChange,
}: {
  customers: CustomerDTO[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor="customer-filter">Cliente</label>
      <select id="customer-filter" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todos</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.legalName}
          </option>
        ))}
      </select>
    </>
  );
}

/** R-12 — Pedidos do Cliente. */
export function CustomerOrdersReportPage() {
  const customers = useCustomerOptions();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(dateInputValueOffset(-89));
  const [to, setTo] = useState(dateInputValueOffset(0));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      search,
      customerId,
      status,
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59.999`).toISOString(),
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, customerId, status, from, to, page],
  );
  const { data, loading, error } = useReport(getCustomerOrdersReport, filters);

  return (
    <ReportPage
      title="R-12 · Pedidos do Cliente"
      csvPath="/reports/commercial/orders/export.csv"
      reportCode="R-12"
      csvFilters={filters}
      total={data?.total}
      subtitle="Pedidos por data, com o estado operacional e o de faturamento derivados dos documentos."
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="co-from">De</label>
          <input id="co-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <label htmlFor="co-to">até</label>
          <input id="co-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <CustomerFilter
            customers={customers}
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
          "Data",
          "Entrega solicitada",
          "Produtos",
          "Linhas",
          "Status",
          "Faturamento",
          "Expedições",
          "Faturamentos",
        ]}
        emptyMessage="Nenhum pedido no período selecionado."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.customerOrderId}>
            <td>
              <DocLink code={row.code} to={`/comercial/pedidos/${row.customerOrderId}`} />
            </td>
            <td>{row.customerName}</td>
            <td>{formatDate(row.orderDate)}</td>
            <td>{formatDate(row.requestedDeliveryDate)}</td>
            {/* Produtos são listados, nunca somados entre unidades diferentes. */}
            <td>{row.productCodes.join(", ")}</td>
            <td className="is-number">{row.lineCount}</td>
            <td>{CUSTOMER_ORDER_STATUS_LABELS[row.status]}</td>
            <td>{CUSTOMER_ORDER_BILLING_STATUS_LABELS[row.billingStatus]}</td>
            <td className="is-number">{row.shipmentCount}</td>
            <td className="is-number">{row.billingCount}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}

/** R-13 — Atendimento dos Pedidos. */
export function FulfillmentReportPage() {
  const customers = useCustomerOptions();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ search, customerId, status, page, pageSize: PAGE_SIZE }),
    [search, customerId, status, page],
  );
  const { data, loading, error } = useReport(getFulfillmentReport, filters);

  return (
    <ReportPage
      title="R-13 · Atendimento dos Pedidos"
      csvPath="/reports/commercial/fulfillment/export.csv"
      reportCode="R-13"
      csvFilters={filters}
      total={data?.total}
      subtitle="Por produto do pedido: reservado, produzido, expedido e faturado — conceitos distintos, nunca inferidos um do outro."
      loading={loading}
      error={error}
      filters={
        <>
          <CustomerFilter
            customers={customers}
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
          "Reservado",
          "Produzido",
          "OPs",
          "Expedido",
          "Faturado",
          "Falta expedir",
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
              <span className="code">{row.productCode}</span> {row.productName}
            </td>
            <td className="is-number">
              {row.orderedQuantity} {row.unitCode}
            </td>
            <td className="is-number">{row.reservedRemaining}</td>
            <td className="is-number">{row.producedQuantity}</td>
            <td className="is-number">{row.productionOrderCount}</td>
            <td className="is-number">{row.shippedQuantity}</td>
            <td className="is-number">{row.billedQuantity}</td>
            <td className="is-number">{row.outstandingQuantity}</td>
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

/** R-14 — Pedido → Operação. */
export function OrderOperationReportPage() {
  const [orders, setOrders] = useState<CustomerOrderDTO[]>([]);
  const [customerOrderId, setCustomerOrderId] = useState("");

  useEffect(() => {
    listCustomerOrders({ pageSize: 100 })
      .then((result) => setOrders(result.customerOrders))
      .catch(() => setOrders([]));
  }, []);

  const filters = useMemo(() => ({ customerOrderId }), [customerOrderId]);
  const { data, loading, error } = useReport(getOrderOperationReport, filters, {
    enabled: customerOrderId !== "",
  });

  return (
    <ReportPage
      title="R-14 · Pedido → Operação"
      reportCode="R-14"
      printFilters={{ customerOrderId }}
      subtitle="Cadeia operacional de um pedido: reserva, produção, compras, expedição e faturamento."
      loading={loading}
      error={error}
      filters={
        <>
          <label htmlFor="chain-order">Pedido</label>
          <select
            id="chain-order"
            value={customerOrderId}
            onChange={(event) => setCustomerOrderId(event.target.value)}
          >
            <option value="">Selecione o pedido…</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.code} — {order.customerName}
              </option>
            ))}
          </select>
        </>
      }
    >
      {!customerOrderId && <p className="muted">Selecione um pedido para ver a cadeia operacional.</p>}

      {data && (
        <>
          <section className="report-block">
            <h2>Pedido</h2>
            <dl className="definition-list">
              <dt>Pedido</dt>
              <dd>
                <DocLink code={data.code} to={`/comercial/pedidos/${data.customerOrderId}`} />
              </dd>
              <dt>Cliente</dt>
              <dd>{data.customerName}</dd>
              <dt>Status</dt>
              <dd>{CUSTOMER_ORDER_STATUS_LABELS[data.status]}</dd>
              <dt>Data / Entrega solicitada</dt>
              <dd>
                {formatDate(data.orderDate)} · {formatDate(data.requestedDeliveryDate)}
              </dd>
            </dl>
            <ReportTable
              columns={["Produto", "Quantidade"]}
              emptyMessage="Pedido sem produtos."
              rows={data.lines.map((line) => (
                <tr key={line.customerOrderLineId}>
                  <td>
                    <span className="code">{line.productCode}</span> {line.productName}
                  </td>
                  <td className="is-number">
                    {line.orderedQuantity} {line.unitCode}
                  </td>
                </tr>
              ))}
            />
          </section>

          <section className="report-block">
            <h2>Reservas de produto acabado</h2>
            <ReportTable
              columns={["Produto", "Lote", "Reservado", "Expedido", "Remanescente", "Situação"]}
              emptyMessage="Nenhuma reserva de produto acabado neste pedido."
              rows={data.reservations.map((row) => (
                <tr key={row.reservationLineId}>
                  <td>
                    <span className="code">{row.productCode}</span> {row.productName}
                  </td>
                  <td>
                    <DocLink code={row.lotCode} to={row.lotId ? `/estoque/lotes/${row.lotId}` : null} />
                  </td>
                  <td className="is-number">
                    {row.reservedQuantity} {row.unitCode}
                  </td>
                  <td className="is-number">{row.shippedQuantity}</td>
                  <td className="is-number">{row.remainingQuantity}</td>
                  <td>{row.releasedAt ? "Liberada" : "Ativa"}</td>
                </tr>
              ))}
            />
          </section>

          <section className="report-block">
            <h2>Ordens de produção</h2>
            <ReportTable
              columns={["OP", "Produto", "Planejado", "Produzido", "Status"]}
              emptyMessage="Nenhuma Ordem de Produção ligada a este pedido."
              rows={data.productionOrders.map((row) => (
                <tr key={row.productionOrderId}>
                  <td>
                    <DocLink code={row.code} to={`/producao/ordens/${row.productionOrderId}`} />
                  </td>
                  <td>
                    <span className="code">{row.productCode}</span> {row.productName}
                  </td>
                  <td className="is-number">
                    {row.plannedQuantity} {row.unitCode}
                  </td>
                  <td className="is-number">{row.producedQuantity}</td>
                  <td>{PRODUCTION_ORDER_STATUS_LABELS[row.status]}</td>
                </tr>
              ))}
            />
          </section>

          <section className="report-block">
            <h2>Ordens de compra vinculadas</h2>
            <ReportTable
              columns={["OC", "Fornecedor", "Status", "Itens", "Previsão"]}
              emptyMessage="Nenhuma ordem de compra vinculada a este pedido."
              rows={data.purchaseOrders.map((row) => (
                <tr key={row.purchaseOrderId}>
                  <td>
                    <DocLink code={row.code} to={`/compras/ordens/${row.purchaseOrderId}`} />
                  </td>
                  <td>{row.supplierName}</td>
                  <td>{PURCHASE_ORDER_STATUS_LABELS[row.status]}</td>
                  <td className="is-number">{row.itemCount}</td>
                  <td>{formatDate(row.expectedDeliveryDate)}</td>
                </tr>
              ))}
            />
          </section>

          <section className="report-block">
            <h2>Expedições</h2>
            <ReportTable
              columns={["Expedição", "Confirmada em", "Status", "Produtos e quantidades"]}
              emptyMessage="Nenhuma expedição neste pedido."
              rows={data.shipments.map((row) => (
                <tr key={row.shipmentId}>
                  <td>
                    <DocLink code={row.code} to={`/comercial/expedicoes/${row.shipmentId}`} />
                  </td>
                  <td>{formatDate(row.confirmedAt)}</td>
                  <td>{row.status}</td>
                  <td>
                    {row.lines
                      .map((line) => `${line.productCode} ${line.quantity} ${line.unitCode}`)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            />
          </section>

          <section className="report-block">
            <h2>Faturamentos</h2>
            <ReportTable
              columns={["Faturamento", "Expedição", "Status", "Emitido em", "Linhas", "Valor"]}
              emptyMessage="Nenhum faturamento neste pedido."
              rows={data.billings.map((row) => (
                <tr key={row.billingId}>
                  <td>
                    <DocLink code={row.code} to={`/comercial/faturamento/${row.billingId}`} />
                  </td>
                  <td>
                    <DocLink code={row.shipmentCode} to={`/comercial/expedicoes/${row.shipmentId}`} />
                  </td>
                  <td>{row.status}</td>
                  <td>{formatDate(row.issuedAt)}</td>
                  <td className="is-number">{row.lineCount}</td>
                  {/* Valor só quando o documento inteiro tem preço. */}
                  <td className="is-number">
                    {row.totalAmount ? formatBRL(row.totalAmount) : "Preço incompleto"}
                  </td>
                </tr>
              ))}
            />
          </section>
        </>
      )}
    </ReportPage>
  );
}
