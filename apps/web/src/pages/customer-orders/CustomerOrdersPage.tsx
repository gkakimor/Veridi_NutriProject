import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CustomerDTO, CustomerOrderDTO, CustomerOrderStatus } from "@veridi/shared";
import { CUSTOMER_ORDER_STATUSES, CUSTOMER_ORDER_STATUS_LABELS } from "@veridi/shared";
import { listCustomerOrders } from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";

type ActiveFilter = CustomerOrderStatus | "all";

const PAGE_SIZE = 20;

function statusBadgeClass(status: CustomerOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "IN_FULFILLMENT":
      return "badge badge--warn";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Comercial → Pedidos. Documento transacional: linhas abrem página própria, não modal. */
export function CustomerOrdersPage() {
  const navigate = useNavigate();

  const [customerOrders, setCustomerOrders] = useState<CustomerOrderDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ActiveFilter>("all");

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
    listCustomers({ pageSize: 100 })
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
      </div>

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
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Data</th>
              <th>Entrega</th>
              <th>Produtos</th>
              <th>Quantidade</th>
              <th>Atendimento</th>
              <th>Status</th>
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
                  <td className="is-code">{order.code}</td>
                  <td>{order.customerName ?? "—"}</td>
                  <td>{formatDate(order.orderDate)}</td>
                  <td>{formatDate(order.requestedDeliveryDate)}</td>
                  <td>{order.lines.length}</td>
                  <td>{totalQuantity}</td>
                  <td>
                    {order.reservation || order.generatedProductionOrders.length > 0
                      ? "Em atendimento"
                      : "Não analisado"}
                  </td>
                  <td>
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
                <td colSpan={9} className="table__empty">
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
