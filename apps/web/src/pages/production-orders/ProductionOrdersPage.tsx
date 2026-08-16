import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProductionOrderDTO, ProductionOrderStatus } from "@veridi/shared";
import { PRODUCTION_ORDER_STATUSES, PRODUCTION_ORDER_STATUS_LABELS } from "@veridi/shared";
import { listProductionOrders } from "../../lib/production-orders-api";

type ActiveFilter = ProductionOrderStatus | "all";

const PAGE_SIZE = 20;

function statusBadgeClass(status: ProductionOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "PLANNED":
    case "RELEASED":
      return "badge badge--active";
    case "IN_PRODUCTION":
      return "badge badge--warn";
    case "COMPLETED":
      return "badge badge--active";
    case "BLOCKED":
      return "badge badge--warn";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR");
}

function materialsLabel(order: ProductionOrderDTO): string {
  if (order.status === "CANCELLED") return "—";
  if (order.status === "RELEASED" || order.status === "IN_PRODUCTION" || order.status === "COMPLETED") {
    return "Reservado";
  }
  return order.materialsStatus === "MATERIALS_AVAILABLE"
    ? "Disponível"
    : `Falta em ${order.shortageItemCount} ${order.shortageItemCount === 1 ? "material" : "materiais"}`;
}

function materialsBadgeClass(order: ProductionOrderDTO): string {
  if (order.status === "CANCELLED") return "badge badge--neutral";
  if (order.status === "RELEASED" || order.status === "IN_PRODUCTION" || order.status === "COMPLETED") {
    return "badge badge--active";
  }
  return order.materialsStatus === "MATERIALS_AVAILABLE" ? "badge badge--active" : "badge badge--warn";
}

/** Produção → Ordens de Produção. Documento transacional: linha abre página própria, não modal. */
export function ProductionOrdersPage() {
  const navigate = useNavigate();

  const [productionOrders, setProductionOrders] = useState<ProductionOrderDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ActiveFilter>("all");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listProductionOrders>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (statusFilter !== "all") params.status = statusFilter;

    listProductionOrders(params)
      .then((result) => {
        setProductionOrders(result.productionOrders);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar ordens de produção");
      })
      .finally(() => setLoading(false));
  }, [page, search, statusFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordens de Produção</h1>
          <p className="page__subtitle">
            Necessidade de materiais calculada a partir do Produto e da Formulação.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/producao/ordens/nova")}
        >
          + Nova OP
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="op-search">
            Buscar ordens de produção
          </label>
          <input
            id="op-search"
            type="search"
            placeholder="Buscar por código ou produto…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="op-status-filter">
          Filtrar por status
        </label>
        <select
          id="op-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ActiveFilter)}
        >
          <option value="all">Todos os status</option>
          {PRODUCTION_ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PRODUCTION_ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>OP</th>
              <th>Produto</th>
              <th>Formulação</th>
              <th>Quantidade</th>
              <th>Unidade</th>
              <th>Materiais</th>
              <th>Status</th>
              <th>Criada em</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {productionOrders.map((op) => (
              <tr
                key={op.id}
                tabIndex={0}
                onClick={() => navigate(`/producao/ordens/${op.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/producao/ordens/${op.id}`);
                }}
              >
                <td className="is-code">{op.code}</td>
                <td>
                  {op.productCode} — {op.productName}
                </td>
                <td>{op.formulationVersionLabel ?? "—"}</td>
                <td>{op.plannedQuantity}</td>
                <td>{op.outputUnitCode}</td>
                <td>
                  <span className={materialsBadgeClass(op)}>{materialsLabel(op)}</span>
                </td>
                <td>
                  <span className={statusBadgeClass(op.status)}>
                    {PRODUCTION_ORDER_STATUS_LABELS[op.status]}
                  </span>
                </td>
                <td>{formatDate(op.createdAt)}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/producao/ordens/${op.id}`)}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && productionOrders.length === 0 && (
              <tr>
                <td colSpan={9} className="table__empty">
                  Nenhuma ordem de produção encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "ordem de produção" : "ordens de produção"}
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
