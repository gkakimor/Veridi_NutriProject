import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { InventoryMovementDTO, InventoryMovementType } from "@veridi/shared";
import { INVENTORY_MOVEMENT_DIRECTION, INVENTORY_MOVEMENT_TYPE_LABELS } from "@veridi/shared";
import { listInventoryMovements } from "../../lib/inventory-api";

type TypeFilter = InventoryMovementType | "all";

const PAGE_SIZE = 20;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

/** Estoque → Movimentações — ledger histórico, somente leitura. */
export function InventoryMovementsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const itemId = searchParams.get("itemId") ?? undefined;

  const [movements, setMovements] = useState<InventoryMovementDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, itemId]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listInventoryMovements>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (typeFilter !== "all") params.type = typeFilter;
    if (itemId) params.itemId = itemId;

    listInventoryMovements(params)
      .then((result) => {
        setMovements(result.movements);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar movimentações");
      })
      .finally(() => setLoading(false));
  }, [page, search, typeFilter, itemId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Movimentações</h1>
          <p className="page__subtitle">
            Histórico imutável de estoque — entradas e saídas nunca são editadas.
          </p>
        </div>
        <ExportCsvButton path="/inventory-movements/export.csv" filters={{ search, type: typeFilter === "all" ? undefined : typeFilter, itemId }} />
</div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="movements-search">
            Buscar movimentações
          </label>
          <input
            id="movements-search"
            type="search"
            placeholder="Buscar por código/nome do item ou lote…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="movements-type-filter">
          Filtrar por tipo
        </label>
        <select
          id="movements-type-filter"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
        >
          <option value="all">Todos os tipos</option>
          {Object.entries(INVENTORY_MOVEMENT_TYPE_LABELS).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>

        {itemId && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/estoque/movimentacoes")}
          >
            Limpar filtro de item
          </button>
        )}
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Item</th>
              <th>Lote</th>
              <th>Tipo</th>
              <th>Entrada/Saída</th>
              <th>Quantidade</th>
              <th>Origem</th>
              <th>Usuário</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement) => (
              <tr key={movement.id}>
                <td>{formatDateTime(movement.occurredAt)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => navigate(`/estoque/${movement.itemId}`)}
                  >
                    <span className="code">{movement.itemCode}</span> {movement.itemName}
                  </button>
                </td>
                <td>
                  {movement.lotId ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/estoque/lotes/${movement.lotId}`)}
                    >
                      <span className="code">{movement.lotCode}</span>
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{INVENTORY_MOVEMENT_TYPE_LABELS[movement.type]}</td>
                <td>
                  <span className={INVENTORY_MOVEMENT_DIRECTION[movement.type] > 0 ? "badge badge--active" : "badge badge--err"}>
                    {INVENTORY_MOVEMENT_DIRECTION[movement.type] > 0 ? "Entrada" : "Saída"}
                  </span>
                </td>
                <td>{movement.quantity}</td>
                <td>
                  {movement.receiptId ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/compras/recebimentos/${movement.receiptId}`)}
                    >
                      <span className="code">{movement.receiptCode}</span>
                    </button>
                  ) : movement.shipmentId ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/comercial/expedicoes/${movement.shipmentId}`)}
                    >
                      <span className="code">{movement.shipmentCode}</span>
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{movement.createdBy ?? "—"}</td>
                <td>{movement.reason ?? "—"}</td>
              </tr>
            ))}

            {!loading && movements.length === 0 && (
              <tr>
                <td colSpan={9} className="table__empty">
                  Nenhuma movimentação encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "movimentação" : "movimentações"}
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
