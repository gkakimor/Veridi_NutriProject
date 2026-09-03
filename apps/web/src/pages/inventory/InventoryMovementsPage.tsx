import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { InventoryMovementDTO, InventoryMovementType } from "@veridi/shared";
import {
  INVENTORY_MOVEMENT_DIRECTION,
  INVENTORY_MOVEMENT_SOURCE_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
} from "@veridi/shared";
import { useInitialFilters } from "../../lib/filter-params";
import { listInventoryMovements } from "../../lib/inventory-api";
import { EntityLink } from "../../components/EntityLink";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

type TypeFilter = InventoryMovementType | "all";

const PAGE_SIZE = 20;

/** ⓘ de uma coluna, lido do registro central — o texto nunca mora no JSX. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

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

  const urlFilter = useInitialFilters();
  const [searchInput, setSearchInput] = useState(urlFilter("search"));
  const [search, setSearch] = useState(urlFilter("search"));
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

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
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
                    — as maiores do ledger — apareciam sem origem nenhuma. */}
                <td className="col-tight is-code">
                  {movement.receiptId ? (
                    <EntityLink kind="receipt" id={movement.receiptId} code={movement.receiptCode} />
                  ) : movement.shipmentId ? (
                    <EntityLink kind="shipment" id={movement.shipmentId} code={movement.shipmentCode} />
                  ) : movement.productionOrderId ? (
                    <EntityLink
                      kind="productionOrder"
                      id={movement.productionOrderId}
                      code={movement.productionOrderCode}
                    />
                  ) : movement.projectSampleId ? (
                    <EntityLink
                      kind="sample"
                      id={movement.projectSampleId}
                      code={movement.projectSampleCode}
                    />
                  ) : (
                    INVENTORY_MOVEMENT_SOURCE_LABELS[movement.sourceType]
                  )}
                </td>
                <td className="col-flex">{movement.createdBy ?? "—"}</td>
                <td className="col-flex">{movement.reason ?? "—"}</td>
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
