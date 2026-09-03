import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { InventoryItemSummaryDTO, ItemType } from "@veridi/shared";
import { INVENTORY_UNAVAILABLE_REASON_LABELS, ITEM_TYPES, ITEM_TYPE_LABELS } from "@veridi/shared";
import { useInitialFilters } from "../../lib/filter-params";
import { listInventory } from "../../lib/inventory-api";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

type TypeFilter = ItemType | "all";

/** "3 kg aguardando liberação da Qualidade · 2 kg reservado" */
function explicarIndisponibilidade(item: InventoryItemSummaryDTO): string {
  return item.unavailable
    .map((linha) => `${linha.quantity} ${item.unitCode} ${INVENTORY_UNAVAILABLE_REASON_LABELS[linha.reason]}`)
    .join(" · ");
}

/** ⓘ de uma coluna, lido do registro central — o texto nunca mora no JSX. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

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

  const urlFilter = useInitialFilters();
  const [searchInput, setSearchInput] = useState(urlFilter("search"));
  const [search, setSearch] = useState(urlFilter("search"));
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
            Saldo físico, disponível e em compra por item — derivados do histórico de movimentações.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() =>
            navigate(`/print/posicao-estoque${search ? `?search=${encodeURIComponent(search)}` : ""}`)
          }
        >
          Imprimir posição (FO-02)
        </button>
        <ExportCsvButton path="/inventory/export.csv" filters={{ search, type: typeFilter === "all" ? undefined : typeFilter, onlyWithStock }} />
</div>

      {/* A legenda abaixo define as quatro palavras; o painel explica de onde
          os números VÊM — que é a pergunta seguinte, e a que faz alguém
          procurar um campo de saldo que não existe. */}
      <ContextHelp topic={helpTopics["estoque.posicao"]} />

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

      {error && <p className="form-alert" role="alert">{error}</p>}

      {/* Quem vem de planilha não tem por que adivinhar o que cada coluna
          significa — a definição fica ao lado da tabela, não escondida em
          tooltip. */}
      <dl className="stock-legend">
        <div>
          <dt>Físico</dt>
          <dd>o que existe no depósito agora, somando todos os lotes.</dd>
        </div>
        <div>
          <dt>Reservado</dt>
          <dd>parte do físico já comprometida com ordens de produção ou pedidos.</dd>
        </div>
        <div>
          <dt>Disponível</dt>
          <dd>físico menos reservado, contando só lote liberado e não vencido.</dd>
        </div>
        <div>
          <dt>Em Compra</dt>
          <dd>saldo de ordens de compra confirmadas que ainda não chegaram.</dd>
        </div>
      </dl>

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-flex">Item</th>
              <th className="col-tight">Tipo</th>
              <th className="col-tight">Un.</th>
              <th className="col-tight is-numeric">
                Físico
                <DicaDaColuna id="estoque.fisico" />
              </th>
              <th className="col-tight is-numeric">
                Reservado
                <DicaDaColuna id="estoque.reservado" />
              </th>
              {/* Sem `col-tight`: esta é a única célula que carrega a
                  explicação da indisponibilidade (`cell-sub--wrap`), e é ela
                  que precisa da sobra da tela para não quebrar em cinco
                  linhas. */}
              <th className="is-numeric">
                Disponível
                <DicaDaColuna id="estoque.disponivel" />
              </th>
              <th className="col-tight is-numeric">
                Em Compra
                <DicaDaColuna id="estoque.emCompra" />
              </th>
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
                <td className="col-tight is-code">{item.itemCode}</td>
                <td className="col-flex">{item.itemName}</td>
                <td className="col-tight">{ITEM_TYPE_LABELS[item.itemType]}</td>
                <td className="col-tight">{item.unitCode}</td>
                <td className="col-tight is-numeric">{item.onHand}</td>
                <td className="col-tight is-numeric">{item.reserved}</td>
                <td className="is-numeric">
                  {item.available}
                  {/*
                      A linha que destoa é a única que alguém pergunta.
                      Físico 5 e Disponível 0 sem explicação obriga o
                      operador a abrir o item para descobrir que o lote
                      aguarda a Qualidade. A causa vem dos lotes reais.
                  */}
                  {item.unavailable.length > 0 && (
                    <span className="cell-sub cell-sub--wrap">
                      {explicarIndisponibilidade(item)}
                    </span>
                  )}
                </td>
                <td className="col-tight is-numeric">{item.onOrder}</td>
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
