import { useCallback, useEffect, useState } from "react";
import { useInitialFilters } from "../../lib/filter-params";
import { EntityLink } from "../../components/EntityLink";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { PurchaseOrderDTO, PurchaseOrderStatus, SupplierDTO } from "@veridi/shared";
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABELS } from "@veridi/shared";
import { listPurchaseOrders } from "../../lib/purchase-orders-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { formatBRL } from "../../lib/currency";
import { formatDate } from "../../lib/dates";

type ActiveFilter = PurchaseOrderStatus | "all";

const PAGE_SIZE = 20;

function statusBadgeClass(status: PurchaseOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "ORDERED":
    case "RECEIVED":
      return "badge badge--active";
    case "PARTIALLY_RECEIVED":
      return "badge badge--warn";
    case "CANCELLED":
      return "badge badge--err";
  }
}


/** Compras → Ordens de Compra. Documento transacional: linhas abrem pagina propria, nao modal. */
export function PurchaseOrdersPage() {
  const navigate = useNavigate();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const urlFilter = useInitialFilters();
  const [supplierFilter, setSupplierFilter] = useState(urlFilter("supplierId"));
  const [statusFilter, setStatusFilter] = useState<ActiveFilter>("all");

  const [suppliers, setSuppliers] = useState<SupplierDTO[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, supplierFilter, statusFilter]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listPurchaseOrders>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (supplierFilter) params.supplierId = supplierFilter;
    if (statusFilter !== "all") params.status = statusFilter;

    listPurchaseOrders(params)
      .then((result) => {
        setPurchaseOrders(result.purchaseOrders);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar ordens de compra");
      })
      .finally(() => setLoading(false));
  }, [page, search, supplierFilter, statusFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    listSuppliers({ pageSize: 1000 })
      .then((result) => setSuppliers(result.suppliers))
      .catch(() => setSuppliers([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordens de Compra</h1>
          <p className="page__subtitle">
            Pedidos de materiais e embalagens enviados aos fornecedores.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/compras/ordens/nova")}
        >
          + Nova OC
        </button>
        <ExportCsvButton path="/purchase-orders/export.csv" filters={{ search, supplierId: supplierFilter, status: statusFilter === "all" ? undefined : statusFilter }} />
</div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="po-search">
            Buscar ordens de compra
          </label>
          <input
            id="po-search"
            type="search"
            placeholder="Buscar por código ou fornecedor…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="po-supplier-filter">
          Filtrar por fornecedor
        </label>
        <select
          id="po-supplier-filter"
          value={supplierFilter}
          onChange={(event) => setSupplierFilter(event.target.value)}
        >
          <option value="">Todos os fornecedores</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.code} — {supplier.tradeName ?? supplier.legalName}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="po-status-filter">
          Filtrar por status
        </label>
        <select
          id="po-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ActiveFilter)}
        >
          <option value="all">Todos os status</option>
          {PURCHASE_ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PURCHASE_ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Código</th>
              <th>Fornecedor</th>
              <th>Data</th>
              <th>Previsão</th>
              <th className="is-numeric">Itens</th>
              <th className="is-numeric">Total</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr
                key={po.id}
                tabIndex={0}
                onClick={() => navigate(`/compras/ordens/${po.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/compras/ordens/${po.id}`);
                }}
              >
                <td className="is-code">{po.code}</td>
                <td>
                  <EntityLink kind="supplier" id={po.supplierId} code={po.supplierCode} name={po.supplierName} />
                </td>
                <td>{formatDate(po.orderDate)}</td>
                <td>{formatDate(po.expectedDeliveryDate)}</td>
                <td className="is-numeric">{po.lines.length}</td>
                <td className="is-numeric">{formatBRL(po.orderTotal)}</td>
                <td>
                  <span className={statusBadgeClass(po.status)}>
                    {PURCHASE_ORDER_STATUS_LABELS[po.status]}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/compras/ordens/${po.id}`)}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && purchaseOrders.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  Nenhuma ordem de compra encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "ordem de compra" : "ordens de compra"}
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
