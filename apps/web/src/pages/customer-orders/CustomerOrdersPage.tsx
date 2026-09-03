import { useCallback, useEffect, useState } from "react";
import { EntityLink } from "../../components/EntityLink";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { CustomerDTO, CustomerOrderDTO, CustomerOrderStatus } from "@veridi/shared";
import {
  CUSTOMER_ORDER_BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUSES,
  CUSTOMER_ORDER_STATUS_LABELS,
} from "@veridi/shared";
import { listCustomerOrders } from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { useAuth } from "../../app/AuthProvider";
import { useInitialFilters } from "../../lib/filter-params";
import { clearStoredFilters, usePersistentFilter } from "../../lib/stored-filters";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

type ActiveFilter = CustomerOrderStatus | "all";

const PAGE_SIZE = 20;

function statusBadgeClass(status: CustomerOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "IN_FULFILLMENT":
    case "PARTIALLY_SHIPPED":
      return "badge badge--warn";
    case "SHIPPED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}


/** Comercial → Pedidos. Documento transacional: linhas abrem página própria, não modal. */
const FILTER_SCOPE = "customer-orders";

export function CustomerOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [customerOrders, setCustomerOrders] = useState<CustomerOrderDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const urlFilter = useInitialFilters();
  const [search, setSearch] = usePersistentFilter(user?.id ?? null, FILTER_SCOPE, "search", "");
  const [customerFilter, setCustomerFilter] = usePersistentFilter(
    user?.id ?? null,
    FILTER_SCOPE,
    "customer",
    "",
    urlFilter("customerId"),
  );
  const [statusFilter, setStatusFilter] = usePersistentFilter<ActiveFilter>(
    user?.id ?? null,
    FILTER_SCOPE,
    "status",
    "all",
  );
  const [searchInput, setSearchInput] = useState(search);

  const hasFilters = search !== "" || customerFilter !== "" || statusFilter !== "all";

  function handleClearFilters() {
    setSearchInput("");
    setSearch("");
    setCustomerFilter("");
    setStatusFilter("all");
    clearStoredFilters(user?.id ?? null, FILTER_SCOPE);
  }

  const [customers, setCustomers] = useState<CustomerDTO[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, customerFilter, statusFilter]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listCustomerOrders>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (customerFilter) params.customerId = customerFilter;
    if (statusFilter !== "all") params.status = statusFilter;

    listCustomerOrders(params)
      .then((result) => {
        setCustomerOrders(result.customerOrders);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar pedidos");
      })
      .finally(() => setLoading(false));
  }, [page, search, customerFilter, statusFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    listCustomers({ pageSize: 1000 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Pedidos do Cliente</h1>
          <p className="page__subtitle">Demanda comercial — conecta o pedido à disponibilidade real de estoque e produção.</p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/comercial/pedidos/novo")}
        >
          + Novo pedido
        </button>
        <ExportCsvButton path="/customer-orders/export.csv" filters={{ search, customerId: customerFilter, status: statusFilter === "all" ? undefined : statusFilter }} />
</div>

      <ContextHelp topic={helpTopics["comercial.pedidos"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="co-search">
            Buscar pedidos
          </label>
          <input
            id="co-search"
            type="search"
            placeholder="Buscar por código ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="co-customer-filter">
          Filtrar por cliente
        </label>
        <select
          id="co-customer-filter"
          value={customerFilter}
          onChange={(event) => setCustomerFilter(event.target.value)}
        >
          <option value="">Todos os clientes</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.code} — {customer.tradeName ?? customer.legalName}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="co-status-filter">
          Filtrar por status
        </label>
        <select
          id="co-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ActiveFilter)}
        >
          <option value="all">Todos os status</option>
          {CUSTOMER_ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CUSTOMER_ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleClearFilters}>
            Limpar filtros
          </button>
        )}
      </div>

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Pedido</th>
              <th className="col-flex">Cliente</th>
              <th className="col-tight">Data</th>
              <th className="col-tight">Entrega</th>
              <th className="col-tight">Produtos</th>
              <th className="is-numeric col-tight">Quantidade</th>
              <th className="col-tight">Atendimento</th>
              <th className="col-tight">Faturamento</th>
              <th className="col-tight">Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {customerOrders.map((order) => {
              const totalQuantity = order.lines.reduce((sum, line) => sum + Number(line.orderedQuantity), 0);
              return (
                <tr
                  key={order.id}
                  tabIndex={0}
                  onClick={() => navigate(`/comercial/pedidos/${order.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") navigate(`/comercial/pedidos/${order.id}`);
                  }}
                >
                  <td className="is-code col-tight">{order.code}</td>
                  <td className="col-flex">
                    <EntityLink kind="customer" id={order.customerId} code={order.customerName} />
                  </td>
                  <td className="col-tight">{formatDate(order.orderDate)}</td>
                  <td className="col-tight">{formatDate(order.requestedDeliveryDate)}</td>
                  <td className="col-tight">{order.lines.length}</td>
                  <td className="is-numeric col-tight">{totalQuantity}</td>
                  <td className="col-tight">
                    {order.shipments.some((shipment) => shipment.status === "CONFIRMED")
                      ? "Expedido"
                      : order.reservation || order.generatedProductionOrders.length > 0
                        ? "Em atendimento"
                        : "Não analisado"}
                  </td>
                  <td className="col-tight">
                    {CUSTOMER_ORDER_BILLING_STATUS_LABELS[order.billingStatus]}
                  </td>
                  <td className="col-tight">
                    <span className={statusBadgeClass(order.status)}>
                      {CUSTOMER_ORDER_STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="table__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => navigate(`/comercial/pedidos/${order.id}`)}
                      >
                        Abrir
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {!loading && customerOrders.length === 0 && (
              <tr>
                <td colSpan={10} className="table__empty">
                  Nenhum pedido encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "pedido" : "pedidos"}
        </div>
      </div>

      <div className="pagination">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </>
  );
}
