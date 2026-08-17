import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { InventoryOwnerType, LotDTO, LotStatus } from "@veridi/shared";
import { LOT_STATUSES, LOT_STATUS_LABELS, ownerLabel } from "@veridi/shared";
import { listLots } from "../../lib/lots-api";
import { useAuth } from "../../app/AuthProvider";
import { useInitialFilters } from "../../lib/filter-params";
import { clearStoredFilters, usePersistentFilter } from "../../lib/stored-filters";

type StatusFilter = LotStatus | "all";
type OwnerFilter = InventoryOwnerType | "all";

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
const FILTER_SCOPE = "lots";

export function LotsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [lots, setLots] = useState<LotDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros lembrados na sessão: quem abre um lote e volta não perde o
  // recorte. `Limpar filtros` devolve a lista completa em um clique.
  const urlFilter = useInitialFilters();
  const [search, setSearch] = usePersistentFilter(
    user?.id ?? null,
    FILTER_SCOPE,
    "search",
    "",
    urlFilter("search"),
  );
  const [statusFilter, setStatusFilter] = usePersistentFilter<StatusFilter>(
    user?.id ?? null,
    FILTER_SCOPE,
    "status",
    "all",
  );
  const [ownerFilter, setOwnerFilter] = usePersistentFilter<OwnerFilter>(
    user?.id ?? null,
    FILTER_SCOPE,
    "owner",
    "all",
  );
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
    // `setSearch` é estável; incluí-lo só provocaria reexecução do debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const hasFilters = search !== "" || statusFilter !== "all" || ownerFilter !== "all";

  function handleClearFilters() {
    setSearchInput("");
    setSearch("");
    setStatusFilter("all");
    setOwnerFilter("all");
    clearStoredFilters(user?.id ?? null, FILTER_SCOPE);
  }

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, ownerFilter]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listLots>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (statusFilter !== "all") params.status = statusFilter;
    if (ownerFilter !== "all") params.ownerType = ownerFilter;

    listLots(params)
      .then((result) => {
        setLots(result.lots);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar lotes");
      })
      .finally(() => setLoading(false));
  }, [page, search, statusFilter, ownerFilter]);

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
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/estoque/lotes/escanear")}
        >
          Escanear QR
        </button>
        <ExportCsvButton
          path="/lots/export.csv"
          filters={{
            search,
            status: statusFilter === "all" ? undefined : statusFilter,
            ownerType: ownerFilter === "all" ? undefined : ownerFilter,
          }}
        />
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

        <label className="sr-only" htmlFor="lots-owner-filter">
          Filtrar por proprietário
        </label>
        <select
          id="lots-owner-filter"
          value={ownerFilter}
          onChange={(event) => setOwnerFilter(event.target.value as OwnerFilter)}
        >
          <option value="all">Todos os proprietários</option>
          <option value="VERIDI">Veridi</option>
          <option value="CUSTOMER">Cliente</option>
        </select>

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

        {hasFilters && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleClearFilters}>
            Limpar filtros
          </button>
        )}
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Lote Interno</th>
              <th>Item</th>
              <th>Lote Fornecedor</th>
              <th>Proprietário</th>
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
                <td>{ownerLabel(lot.ownerType, lot.ownerCustomerName)}</td>
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
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/estoque/lotes/${lot.id}/etiqueta`)}
                    >
                      QR / Etiqueta
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && lots.length === 0 && (
              <tr>
                <td colSpan={10} className="table__empty">
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
