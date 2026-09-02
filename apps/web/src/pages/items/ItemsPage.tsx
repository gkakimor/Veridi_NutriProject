import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import {
  RecordContextChip,
  useOpenRecord,
  useRecordContext,
} from "../../components/RecordContext";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

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

  // Chegada por link contextual: `ids` reduz a lista, `open` abre o registro.
  const { contextIds, openId, clear: clearContext, contextKey } = useRecordContext("/cadastros/itens");

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
  }, [search, typeFilter, activeFilter, contextKey]);

  // Filtro antigo somado ao contexto esconderia o próprio registro citado.
  useEffect(() => {
    if (!contextKey) return;
    setSearchInput("");
    setSearch("");
    setTypeFilter("");
    setActiveFilter("all");
  }, [contextKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listItems>[0] = {
      page,
      pageSize: PAGE_SIZE,
    };
    if (contextIds) params.ids = contextIds;
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
  }, [page, search, typeFilter, activeFilter, contextKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  useOpenRecord(openId, items, (item) => setModalState({ mode: "edit", item }));

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
          <h1 className="page__title">Itens de estoque</h1>
          <p className="page__subtitle">
            Cadastre matérias-primas, materiais de embalagem e outros itens
            utilizados na operação. Produtos acabados aparecem aqui, mas são
            criados pelo cadastro de Produtos.
          </p>
        </div>
        {/* Leva à tela oficial, não ao modal: o cadastro passou a ter URL
            própria, e é ela que sobrevive a um F5 e vale como link. O modal
            continua servindo à EDIÇÃO, aberta a partir da linha. */}
        <Link className="btn btn--primary" to="/cadastros/itens/novo">
          + Novo item de estoque
        </Link>
        <ExportCsvButton path="/items/export.csv" filters={{ search, type: typeFilter, active: activeFilter === "all" ? undefined : activeFilter === "active" }} />
</div>

      {/* "Item" e "produto" são a confusão de estreia desta tela, e tipo e
          unidade travam no primeiro uso operacional — as duas coisas
          precisam estar ditas antes do primeiro cadastro, não depois. */}
      <ContextHelp topic={helpTopics["item.comoFunciona"]} />

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

      {contextIds && (
        <RecordContextChip
          noun="o item"
          code={items[0]?.code}
          name={items[0]?.name}
          onClear={clearContext}
        />
      )}

      <SelectionBar count={selection.count} onClear={selection.clear}>
        <ExportCsvButton
          path="/items/export.csv"
          label="Exportar selecionados"
          filters={{ ids: selection.selected.join(",") }}
        />
      </SelectionBar>

      <div className="table-container">
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <SelectionHeaderCell
                checked={selection.allOnPageSelected}
                onToggle={selection.togglePage}
              />
              <th className="col-tight">Código</th>
              <th className="col-flex">Nome</th>
              <th className="col-tight">
                Tipo
                <DicaDaColuna id="item.tipo" />
              </th>
              <th className="col-tight">Família</th>
              <th className="col-flex">
                Fonte
                <DicaDaColuna id="item.fonte" />
              </th>
              <th className="col-tight">
                Unidade
                <DicaDaColuna id="item.unidade" />
              </th>
              <th className="col-tight">
                Lote
                <DicaDaColuna id="item.controlaLote" />
              </th>
              <th className="col-tight">
                Validade
                <DicaDaColuna id="item.controlaValidade" />
              </th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="item.situacao" />
              </th>
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
                <td className="is-code col-tight">{item.code}</td>
                <td className="col-flex">
                  {item.name}
                  {/* Nutriente declarado como texto secundário: informa sem
                      alargar a tabela. */}
                  {item.declaredNutrient && (
                    <div className="muted is-small">{item.declaredNutrient}</div>
                  )}
                </td>
                <td className="col-tight">
                  <span className="badge badge--neutral">
                    {ITEM_TYPE_LABELS[item.type]}
                  </span>
                </td>
                <td className="col-tight">
                  {item.family ? ITEM_FAMILY_LABELS[item.family] : "—"}
                </td>
                <td className="col-flex">{item.sourceName ?? "—"}</td>
                <td className="col-tight">{item.unit.code}</td>
                <td className="col-tight">{item.controlsLot ? "Sim" : "Não"}</td>
                <td className="col-tight">{item.controlsExpiry ? "Sim" : "Não"}</td>
                <td className="col-tight">
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
