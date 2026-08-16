import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { ShipmentDTO, ShipmentStatus } from "@veridi/shared";
import { SHIPMENT_STATUSES, SHIPMENT_STATUS_LABELS } from "@veridi/shared";
import { listShipments } from "../../lib/shipments-api";

type ActiveFilter = ShipmentStatus | "all";

const PAGE_SIZE = 20;

function statusBadgeClass(status: ShipmentStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Comercial → Expedições. Documento transacional: linhas abrem página própria. */
export function ShipmentsPage() {
  const navigate = useNavigate();

  const [shipments, setShipments] = useState<ShipmentDTO[]>([]);
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

    const params: Parameters<typeof listShipments>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (statusFilter !== "all") params.status = statusFilter;

    listShipments(params)
      .then((result) => {
        setShipments(result.shipments);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar expedições");
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
          <h1 className="page__title">Expedições</h1>
          <p className="page__subtitle">
            Saída física de produto acabado — só uma expedição confirmada altera o estoque.
          </p>
        </div>
        <ExportCsvButton path="/shipments/export.csv" filters={{ search, status: statusFilter === "all" ? undefined : statusFilter }} />
</div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="shipment-search">
            Buscar expedições
          </label>
          <input
            id="shipment-search"
            type="search"
            placeholder="Buscar por código, pedido ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="shipment-status-filter">
          Filtrar por status
        </label>
        <select
          id="shipment-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ActiveFilter)}
        >
          <option value="all">Todos os status</option>
          {SHIPMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SHIPMENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Expedição</th>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Data</th>
              <th>Quantidade</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {shipments.map((shipment) => (
              <tr
                key={shipment.id}
                tabIndex={0}
                onClick={() => navigate(`/comercial/expedicoes/${shipment.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/comercial/expedicoes/${shipment.id}`);
                }}
              >
                <td className="is-code">{shipment.code}</td>
                <td className="is-code">{shipment.customerOrderCode}</td>
                <td>{shipment.customerName ?? "—"}</td>
                <td>{formatDate(shipment.shipmentDate)}</td>
                <td>{shipment.totalQuantity}</td>
                <td>
                  <span className={statusBadgeClass(shipment.status)}>
                    {SHIPMENT_STATUS_LABELS[shipment.status]}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/comercial/expedicoes/${shipment.id}`)}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && shipments.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhuma expedição encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "expedição" : "expedições"}
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
