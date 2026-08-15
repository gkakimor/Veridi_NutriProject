import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { InventoryItemSummaryDTO, ItemType } from "@veridi/shared";
import { ITEM_TYPES, ITEM_TYPE_LABELS } from "@veridi/shared";
import { listInventory } from "../../lib/inventory-api";

type TypeFilter = ItemType | "all";

const PAGE_SIZE = 20;

/**
 * Estoque → Visão Geral. On Hand/Disponível/Em Compra são sempre derivados
 * do InventoryMovement ledger — nunca uma coluna armazenada. Reservado é
 * "0" nesta entrega (Reservation pertence ao módulo de OP).
 */
export function InventoryOverviewPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState<InventoryItemSummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [onlyWithStock, setOnlyWithStock] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, onlyWithStock]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listInventory>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (typeFilter !== "all") params.type = typeFilter;
    if (onlyWithStock) params.onlyWithStock = true;

    listInventory(params)
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar estoque");
      })
      .finally(() => setLoading(false));
  }, [page, search, typeFilter, onlyWithStock]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Estoque</h1>
          <p className="page__subtitle">
            On Hand, disponível e em compra por item — derivados do histórico de movimentações.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="inventory-search">
            Buscar itens
          </label>
          <input
            id="inventory-search"
            type="search"
            placeholder="Buscar por código ou nome do item…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="inventory-type-filter">
          Filtrar por tipo
        </label>
        <select
          id="inventory-type-filter"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
        >
          <option value="all">Todos os tipos</option>
          {ITEM_TYPES.map((type) => (
            <option key={type} value={type}>
              {ITEM_TYPE_LABELS[type]}
            </option>
          ))}
        </select>

        <label className="field--checkbox field">
          <input
            type="checkbox"
            checked={onlyWithStock}
            onChange={(event) => setOnlyWithStock(event.target.checked)}
          />
          Somente com estoque
        </label>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Código</th>
              <th>Item</th>
              <th>Tipo</th>
              <th>Un.</th>
              <th>On Hand</th>
              <th>Reservado</th>
              <th>Disponível</th>
              <th>Em Compra</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.itemId}
                tabIndex={0}
                onClick={() => navigate(`/estoque/${item.itemId}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/estoque/${item.itemId}`);
                }}
              >
                <td className="is-code">{item.itemCode}</td>
                <td>{item.itemName}</td>
                <td>{ITEM_TYPE_LABELS[item.itemType]}</td>
                <td>{item.unitCode}</td>
                <td>{item.onHand}</td>
                <td>{item.reserved}</td>
                <td>{item.available}</td>
                <td>{item.onOrder}</td>
              </tr>
            ))}

            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  Nenhum item encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "item" : "itens"}
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
