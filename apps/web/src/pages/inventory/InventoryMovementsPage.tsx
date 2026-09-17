import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";
import { useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { InventoryMovementDTO, InventoryMovementType } from "@veridi/shared";
import { INVENTORY_MOVEMENT_DIRECTION, INVENTORY_MOVEMENT_TYPE_LABELS } from "@veridi/shared";
import { useInitialFilters } from "../../lib/filter-params";
import { listInventoryMovements } from "../../lib/inventory-api";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import { EntityLink } from "../../components/EntityLink";
import { ContextHelp, InfoHint } from "../../components/help";
import { OrigemDoMovimento } from "./OrigemDoMovimento";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { formatDateTime } from "../../lib/dates";

type TypeFilter = InventoryMovementType | "all";

const PAGE_SIZE = 20;

/** ⓘ de uma coluna, lido do registro central — o texto nunca mora no JSX. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

/** Estoque → Movimentações — ledger histórico, somente leitura. */
export function InventoryMovementsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const itemId = searchParams.get("itemId") ?? undefined;

  const urlFilter = useInitialFilters();
  const [searchInput, setSearchInput] = useState(urlFilter("search"));
  const [search, setSearch] = useState(urlFilter("search"));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const filtrosDaConsulta = {
    ...(search ? { search } : {}),
    ...(typeFilter !== "all" ? { type: typeFilter } : {}),
    ...(itemId ? { itemId } : {}),
  };
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  /*
   * Consulta que falhou não deixa o resultado anterior na tela.
   *
   * Era exatamente este o sintoma da rodada adversarial: cinco tipos do
   * filtro devolviam 400, a tabela anterior continuava exibida e o
   * contador seguia com o número velho, então o operador lia um
   * resultado que não correspondia ao filtro escolhido. A falha já limpava
   * a tabela; faltava o filtro novo carregando e a resposta fora de ordem,
   * que `useListQuery` também não deixa virar tela.
   */
  const consulta = useListQuery(
    listInventoryMovements,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar movimentações" },
  );
  const movements: InventoryMovementDTO[] = consulta.data?.movements ?? [];
  const total = consulta.data?.total ?? 0;

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

      {/* "Histórico imutável" no subtítulo diz o QUE; quem procura o botão de
          corrigir precisa saber o ONDE — e que o saldo sai daqui. */}
      <ContextHelp topic={helpTopics["estoque.movimentacoes"]} />

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

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table">
          <thead>
            <tr>
              <th className="col-tight">Data</th>
              <th className="col-flex">Item</th>
              <th className="col-tight">Lote</th>
              <th className="col-tight">Tipo</th>
              <th className="col-tight">Entrada/Saída</th>
              <th className="col-tight is-numeric">Quantidade</th>
              <th className="col-tight">
                Origem
                <DicaDaColuna id="estoque.origemMovimento" />
              </th>
              <th className="col-flex">Usuário</th>
              {/* Texto livre digitado no ajuste. Hoje quase sempre vazio, e é
                  justamente por isso que estava sem teto: o primeiro motivo
                  longo empurraria o extrato inteiro. */}
              <th className="col-flex">
                Motivo
                <DicaDaColuna id="estoque.motivoMovimento" />
              </th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement) => (
              <tr key={movement.id}>
                <td className="col-tight">{formatDateTime(movement.occurredAt)}</td>
                <td className="col-flex">
                  <EntityLink kind="item" id={movement.itemId} code={movement.itemCode} name={movement.itemName} />
                </td>
                <td className="col-tight is-code">
                  {movement.lotId ? (
                    <EntityLink kind="lot" id={movement.lotId} code={movement.lotCode} />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="col-tight">{INVENTORY_MOVEMENT_TYPE_LABELS[movement.type]}</td>
                <td className="col-tight">
                  <span className={INVENTORY_MOVEMENT_DIRECTION[movement.type] > 0 ? "badge badge--active" : "badge badge--err"}>
                    {INVENTORY_MOVEMENT_DIRECTION[movement.type] > 0 ? "Entrada" : "Saída"}
                  </span>
                </td>
                <td className="col-tight is-numeric">{formatQuantity(movement.quantity)}</td>
                {/* Todo movimento tem um documento que o causou; o extrato só
                    conhecia recebimento e expedição, e as saídas de produção
                    — as maiores do ledger — apareciam sem origem nenhuma. O
                    ajuste de inventário aponta o INV- (Fatia 2B). */}
                <td className="col-tight is-code">
                  <OrigemDoMovimento movimento={movement} />
                </td>
                <td className="col-flex">{movement.createdBy ?? "—"}</td>
                <td className="col-flex">{movement.reason ?? "—"}</td>
              </tr>
            ))}

            <ListStatusRow colSpan={9} query={consulta} rowCount={movements.length}>
              Nenhuma movimentação encontrada.
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {formatIntegerPtBr(total)} {total === 1 ? "movimentação" : "movimentações"}
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
