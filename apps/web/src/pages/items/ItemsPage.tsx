import { useCallback, useEffect, useState } from "react";
import type { ItemDTO, ItemType, UnitOfMeasureDTO } from "@veridi/shared";
import { ITEM_TYPE_LABELS } from "@veridi/shared";
import { listItems, setItemActive } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { ItemFormDrawer } from "./ItemFormDrawer";

type ActiveFilter = "all" | "active" | "inactive";
type DrawerState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; item: ItemDTO };

const PAGE_SIZE = 20;

/**
 * Cadastros → Itens. Primeira tela CRUD do MVP: define o padrao de
 * tabela densa + drawer contextual para os proximos cadastros.
 */
export function ItemsPage() {
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "">("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  const [drawerState, setDrawerState] = useState<DrawerState>({
    mode: "closed",
  });

  // Debounce da busca: evita 1 requisicao por tecla digitada.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, activeFilter]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listItems>[0] = {
      page,
      pageSize: PAGE_SIZE,
    };
    if (search) params.search = search;
    if (typeFilter) params.type = typeFilter;
    if (activeFilter !== "all") params.active = activeFilter === "active";

    listItems(params)
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "Falha ao carregar itens",
        );
      })
      .finally(() => setLoading(false));
  }, [page, search, typeFilter, activeFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  async function handleToggleActive(item: ItemDTO) {
    const nextActive = !item.active;
    const question = nextActive
      ? `Reativar "${item.name}"?`
      : `Inativar "${item.name}"? O item continua visível no histórico.`;
    if (!window.confirm(question)) return;

    try {
      await setItemActive(item.id, nextActive);
      reload();
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Falha ao atualizar status",
      );
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Itens</h1>
          <p className="page__subtitle">
            Matérias-primas, embalagens e produtos acabados controlados pela
            operação.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setDrawerState({ mode: "create" })}
        >
          Novo item
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="items-search">
            Buscar itens
          </label>
          <input
            id="items-search"
            type="search"
            placeholder="Buscar por código, nome ou barcode…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="items-type-filter">
          Filtrar por tipo
        </label>
        <select
          id="items-type-filter"
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value as ItemType | "")
          }
        >
          <option value="">Todos os tipos</option>
          {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="items-active-filter">
          Filtrar por status
        </label>
        <select
          id="items-active-filter"
          value={activeFilter}
          onChange={(event) =>
            setActiveFilter(event.target.value as ActiveFilter)
          }
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Unidade</th>
              <th>Lote</th>
              <th>Validade</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="is-code">{item.code}</td>
                <td>{item.name}</td>
                <td>{ITEM_TYPE_LABELS[item.type]}</td>
                <td>{item.unit.code}</td>
                <td>{item.controlsLot ? "Sim" : "Não"}</td>
                <td>{item.controlsExpiry ? "Sim" : "Não"}</td>
                <td>
                  <span
                    className={
                      item.active ? "badge badge--active" : "badge badge--inactive"
                    }
                  >
                    {item.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setDrawerState({ mode: "edit", item })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={
                        item.active ? "btn btn--danger btn--sm" : "btn btn--secondary btn--sm"
                      }
                      onClick={() => handleToggleActive(item)}
                    >
                      {item.active ? "Inativar" : "Reativar"}
                    </button>
                  </div>
                </td>
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
      </div>

      <div className="pagination">
        <span>
          {total} {total === 1 ? "item" : "itens"}
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
          <span>
            Página {page} de {totalPages}
          </span>
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

      {drawerState.mode !== "closed" && (
        <ItemFormDrawer
          key={drawerState.mode === "edit" ? drawerState.item.id : "create"}
          mode={drawerState.mode}
          item={drawerState.mode === "edit" ? drawerState.item : null}
          units={units}
          onClose={() => setDrawerState({ mode: "closed" })}
          onSaved={() => {
            setDrawerState({ mode: "closed" });
            reload();
          }}
        />
      )}
    </>
  );
}
