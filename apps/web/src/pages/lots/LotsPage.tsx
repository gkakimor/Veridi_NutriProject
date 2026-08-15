import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LotDTO, LotStatus } from "@veridi/shared";
import { LOT_STATUSES, LOT_STATUS_LABELS } from "@veridi/shared";
import { listLots } from "../../lib/lots-api";

type StatusFilter = LotStatus | "all";

const PAGE_SIZE = 20;

function statusBadgeClass(status: LotStatus, isExpired: boolean): string {
  if (isExpired) return "badge badge--err";
  switch (status) {
    case "AWAITING_RELEASE":
      return "badge badge--warn";
    case "AVAILABLE":
      return "badge badge--active";
    case "BLOCKED":
      return "badge badge--err";
    case "EXPIRED":
      return "badge badge--err";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/**
 * Estoque → Lotes. `Recebido` e a quantidade ORIGINAL do recebimento — nao
 * e saldo. Sem On Hand ainda (isso vem com Inventory Movements).
 */
export function LotsPage() {
  const navigate = useNavigate();

  const [lots, setLots] = useState<LotDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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

    const params: Parameters<typeof listLots>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (statusFilter !== "all") params.status = statusFilter;

    listLots(params)
      .then((result) => {
        setLots(result.lots);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar lotes");
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
          <h1 className="page__title">Lotes</h1>
          <p className="page__subtitle">
            Lotes internos gerados a partir de recebimentos. Sem saldo de estoque ainda.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="lots-search">
            Buscar lotes
          </label>
          <input
            id="lots-search"
            type="search"
            placeholder="Buscar por lote interno, lote do fornecedor, código ou nome do item…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="lots-status-filter">
          Filtrar por status
        </label>
        <select
          id="lots-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
        >
          <option value="all">Todos os status</option>
          {LOT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LOT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Lote Interno</th>
              <th>Item</th>
              <th>Lote Fornecedor</th>
              <th>Fornecedor</th>
              <th>Recebido</th>
              <th>Validade</th>
              <th>Localização</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr
                key={lot.id}
                tabIndex={0}
                onClick={() => navigate(`/estoque/lotes/${lot.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/estoque/lotes/${lot.id}`);
                }}
              >
                <td className="is-code">{lot.code}</td>
                <td>
                  <span className="code">{lot.itemCode}</span> {lot.itemName}
                </td>
                <td>{lot.supplierLot ?? "—"}</td>
                <td>{lot.supplierName}</td>
                <td>
                  {lot.initialReceivedQuantity} {lot.unitCode}
                </td>
                <td>{formatDate(lot.expiryDate)}</td>
                <td>{lot.location ?? "—"}</td>
                <td>
                  <span className={statusBadgeClass(lot.status, lot.isExpired)}>
                    {lot.isExpired ? "Vencido" : LOT_STATUS_LABELS[lot.status]}
                  </span>
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/estoque/lotes/${lot.id}`)}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && lots.length === 0 && (
              <tr>
                <td colSpan={9} className="table__empty">
                  Nenhum lote encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "lote" : "lotes"}
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
