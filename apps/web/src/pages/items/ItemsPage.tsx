import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import {
  SelectionBar,
  SelectionCell,
  SelectionHeaderCell,
  useTableSelection,
} from "../../components/TableSelection";
import type { ItemDTO, ItemType, UnitOfMeasureDTO } from "@veridi/shared";
import { ITEM_FAMILY_LABELS, ITEM_TYPE_LABELS } from "@veridi/shared";
import { listItems, setItemActive } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { ItemFormModal } from "./ItemFormModal";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { RowActions } from "../../components/RowActions";

type ActiveFilter = "all" | "active" | "inactive";
type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; item: ItemDTO };

const PAGE_SIZE = 20;

/**
 * Cadastros → Itens. Primeira tela CRUD do MVP: define o padrao de
 * tabela densa + modal fullscreen para os proximos cadastros.
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
  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });

  // Seleção existe aqui porque há ação real: exportar exatamente o que foi
  // marcado. Trocar filtro/página limpa a seleção — ver TableSelection.
  const selection = useTableSelection(items, `${search}|${typeFilter}|${activeFilter}|${page}`);
  const [confirmDeactivate, setConfirmDeactivate] = useState<ItemDTO | null>(null);

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

  function handleToggleActive(item: ItemDTO) {
    if (item.active) {
      setConfirmDeactivate(item);
      return;
    }
    void applyActive(item, true);
  }

  async function applyActive(item: ItemDTO, active: boolean) {
    try {
      await setItemActive(item.id, active);
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
          onClick={() => setModalState({ mode: "create" })}
        >
          + Novo item
        </button>
        <ExportCsvButton path="/items/export.csv" filters={{ search, type: typeFilter, active: activeFilter === "all" ? undefined : activeFilter === "active" }} />
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

      <SelectionBar count={selection.count} onClear={selection.clear}>
        <ExportCsvButton
          path="/items/export.csv"
          label="Exportar selecionados"
          filters={{ ids: selection.selected.join(",") }}
        />
      </SelectionBar>

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <SelectionHeaderCell
                checked={selection.allOnPageSelected}
                onToggle={selection.togglePage}
              />
              <th>Código</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Família</th>
              <th>Fonte</th>
              <th>Unidade</th>
              <th>Lote</th>
              <th>Validade</th>
              <th>Status</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              // Com caixa de seleção, "Editar" e "⋯" dentro da linha, manter a
              // própria linha focável só acrescentaria uma parada de Tab por
              // registro — 20 a mais por página, sem alcance novo. O clique
              // continua abrindo o cadastro.
              <tr key={item.id} onClick={() => setModalState({ mode: "edit", item })}>
                <SelectionCell
                  checked={selection.isSelected(item.id)}
                  onToggle={() => selection.toggle(item.id)}
                  label={item.code}
                />
                <td className="is-code">{item.code}</td>
                <td>
                  {item.name}
                  {/* Nutriente declarado como texto secundário: informa sem
                      alargar a tabela. */}
                  {item.declaredNutrient && (
                    <div className="muted is-small">{item.declaredNutrient}</div>
                  )}
                </td>
                <td>
                  <span className="badge badge--neutral">
                    {ITEM_TYPE_LABELS[item.type]}
                  </span>
                </td>
                <td>{item.family ? ITEM_FAMILY_LABELS[item.family] : "—"}</td>
                <td>{item.sourceName ?? "—"}</td>
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
                <td onClick={(event) => event.stopPropagation()}>
                  <RowActions
                    actions={[
                      {
                        label: item.active ? "Inativar" : "Reativar",
                        destructive: item.active,
                        onSelect: () => handleToggleActive(item),
                      },
                    ]}
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setModalState({ mode: "edit", item })}
                    >
                      Editar
                    </button>
                  </RowActions>
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

      {modalState.mode !== "closed" && (
        <ItemFormModal
          key={modalState.mode === "edit" ? modalState.item.id : "create"}
          mode={modalState.mode}
          item={modalState.mode === "edit" ? modalState.item : null}
          units={units}
          onClose={() => setModalState({ mode: "closed" })}
          onSaved={() => {
            setModalState({ mode: "closed" });
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeactivate !== null}
        title="Inativar item?"
        message={
          <>
            "{confirmDeactivate?.name}" deixará de aparecer para novas compras
            e produções. O registro não será excluído — o histórico será
            preservado e ele pode ser reativado a qualquer momento.
          </>
        }
        confirmLabel="Inativar"
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => {
          const target = confirmDeactivate;
          setConfirmDeactivate(null);
          if (target) void applyActive(target, false);
        }}
      />
    </>
  );
}
