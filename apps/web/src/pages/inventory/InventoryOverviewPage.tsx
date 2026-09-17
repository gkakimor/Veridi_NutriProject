import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";
import { useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import { useNavigate } from "react-router-dom";
import type { InventoryItemSummaryDTO, ItemType } from "@veridi/shared";
import { INVENTORY_UNAVAILABLE_REASON_LABELS, ITEM_TYPES, ITEM_TYPE_LABELS } from "@veridi/shared";
import { useInitialFilters } from "../../lib/filter-params";
import { listInventory } from "../../lib/inventory-api";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

type TypeFilter = ItemType | "all";

/** "3 kg aguardando liberação da Qualidade · 2 kg reservado" */
function explicarIndisponibilidade(item: InventoryItemSummaryDTO): string {
  return item.unavailable
    .map((linha) => `${formatQuantity(linha.quantity)} ${item.unitCode} ${INVENTORY_UNAVAILABLE_REASON_LABELS[linha.reason]}`)
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

  const urlFilter = useInitialFilters();
  const [searchInput, setSearchInput] = useState(urlFilter("search"));
  const [search, setSearch] = useState(urlFilter("search"));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const filtrosDaConsulta = {
    ...(search ? { search } : {}),
    ...(typeFilter !== "all" ? { type: typeFilter } : {}),
    ...(onlyWithStock ? { onlyWithStock: true } : {}),
    ...(includeInactive ? { includeInactiveWithoutPosition: true } : {}),
  };
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listInventory,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar estoque" },
  );
  const items: InventoryItemSummaryDTO[] = consulta.data?.items ?? [];
  const total = consulta.data?.total ?? 0;

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
          Folha de posição (FO-02)
        </button>
        <ExportCsvButton
          path="/inventory/export.csv"
          filters={{
            search,
            type: typeFilter === "all" ? undefined : typeFilter,
            onlyWithStock,
            includeInactiveWithoutPosition: includeInactive,
          }}
        />
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

        {/* Item inativo com saldo, reserva ou compra aberta aparece sempre,
            marcado (§107). Sem posição ele não tem o que mostrar no físico, e
            só entra a pedido. */}
        <label className="field--checkbox field">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
          Incluir inativos sem saldo
        </label>
      </div>

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

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

      <div className="table-container" aria-busy={consulta.loading || undefined}>
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
                <td className="col-flex">
                  {item.itemName}
                  {!item.itemActive && (
                    <>
                      {" "}
                      <span className="badge badge--inactive">Item inativo</span>
                    </>
                  )}
                </td>
                <td className="col-tight">{ITEM_TYPE_LABELS[item.itemType]}</td>
                <td className="col-tight">{item.unitCode}</td>
                <td className="col-tight is-numeric">{formatQuantity(item.onHand)}</td>
                <td className="col-tight is-numeric">{formatQuantity(item.reserved)}</td>
                <td className="is-numeric">
                  {formatQuantity(item.available)}
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
                <td className="col-tight is-numeric">{formatQuantity(item.onOrder)}</td>
              </tr>
            ))}

            <ListStatusRow colSpan={8} query={consulta} rowCount={items.length}>
              Nenhum item encontrado.
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {formatIntegerPtBr(total)} {total === 1 ? "item" : "itens"}
          </div>
        )}
      </div>

      {consulta.data && (
        <div className="pagination">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="table__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </>
  );
}
