import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate , useSearchParams } from "react-router-dom";
import type { InventoryOwnerType, LotDTO, LotStatus } from "@veridi/shared";
import { LOT_STATUSES, LOT_STATUS_LABELS, ownerLabel } from "@veridi/shared";
import { listLots } from "../../lib/lots-api";
import { useAuth } from "../../app/AuthProvider";
import { useInitialFilters } from "../../lib/filter-params";
import { clearStoredFilters, usePersistentFilter } from "../../lib/stored-filters";
import { EntityLink } from "../../components/EntityLink";
import { RowActions } from "../../components/RowActions";
import { formatDate } from "../../lib/dates";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/** ⓘ de uma coluna, lido do registro central — o texto nunca mora no JSX. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

type StatusFilter = LotStatus | "all";
type OwnerFilter = InventoryOwnerType | "all";

const PAGE_SIZE = 20;

/**
 * Traduz o `?status=` da URL, recusando o que não for um status conhecido.
 *
 * `null` significa "sem contexto na URL", que é o que faz o filtro guardado da
 * sessão continuar valendo. Aceitar texto arbitrário aqui produziria uma tela
 * filtrada por um status que não existe, e portanto vazia sem explicação.
 */
function statusDaUrl(valor: string): StatusFilter | null {
  if (valor === "") return null;
  if (valor === "all") return "all";
  return (LOT_STATUSES as readonly string[]).includes(valor) ? (valor as LotStatus) : null;
}

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
    /*
     * O parâmetro da URL vence o filtro guardado da sessão — o campo de busca
     * ao lado já fazia isso e este não fazia.
     *
     * O Dashboard aponta para `?status=AWAITING_RELEASE` no atalho de "Lotes
     * aguardando liberação", e a tela abria em "Todos os status": a pessoa
     * clicava no caminho mais visível para a tarefa mais sensível e recebia a
     * lista inteira, com o lote que aguarda Qualidade perdido no meio. Link
     * que carrega contexto e a tela ignora é pior que link nenhum, porque
     * ensina a confiar num filtro que não foi aplicado.
     */
    statusDaUrl(urlFilter("status")),
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

  // Link contextual traz identidade exata; nunca combina com filtro anterior.
  const [urlParams] = useSearchParams();
  const contextParam = urlParams.get("itemId") ?? "";

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listLots>[0] = { page, pageSize: PAGE_SIZE };
    if (contextParam) params.itemId = contextParam;
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

      {/* "Lote" aqui é duas identidades ao mesmo tempo, e a coluna Status
          decide se o material pode ser usado. Nenhuma das duas coisas se
          adivinha pelo cabeçalho. */}
      <ContextHelp topic={helpTopics["estoque.lotes"]} />

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

      {error && <p className="form-alert" role="alert">{error}</p>}

      {contextParam && (
        <p className="context-chip">
          Mostrando apenas os lotes deste item — filtro veio de um link.{" "}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/estoque/lotes")}
          >
            Limpar filtros
          </button>
        </p>
      )}

      <div className="table-container">
        <table className="table table--clickable-rows table--sticky-actions">
          <thead>
            <tr>
              <th className="col-tight">
                Lote Interno
                <DicaDaColuna id="estoque.loteInterno" />
              </th>
              <th className="col-flex">Item</th>
              {/* Status ao lado da identidade: era a última coluna antes das
                  ações e saía da tela junto com elas, justamente a informação
                  que decide se o lote pode ser usado. */}
              <th className="col-tight">
                Status
                <DicaDaColuna id="estoque.situacaoLote" />
              </th>
              {/* Variável apesar de parecer curta: `ownerLabel` devolve
                  "Cliente — <razão social>" quando o lote é de terceiro. */}
              <th className="col-flex">
                Proprietário
                <DicaDaColuna id="estoque.proprietario" />
              </th>
              <th className="col-tight">
                Lote Fornecedor
                <DicaDaColuna id="estoque.loteFornecedor" />
              </th>
              <th className="col-flex">Fornecedor</th>
              <th className="col-tight is-numeric">
                Recebido
                <DicaDaColuna id="estoque.recebido" />
              </th>
              <th className="col-tight">Validade</th>
              <th className="col-tight">Localização</th>
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
                <td className="col-tight is-code">
                  <EntityLink kind="lot" id={lot.id} code={lot.code} />
                </td>
                <td className="col-flex">
                  <EntityLink kind="item" id={lot.itemId} code={lot.itemCode} name={lot.itemName} />
                </td>
                <td className="col-tight">
                  <span className={statusBadgeClass(lot.status, lot.isExpired)}>
                    {lot.isExpired ? "Vencido" : LOT_STATUS_LABELS[lot.status]}
                  </span>
                </td>
                <td className="col-flex">{ownerLabel(lot.ownerType, lot.ownerCustomerName)}</td>
                <td className="col-tight">{lot.supplierLot ?? "—"}</td>
                <td className="col-flex">
                  <EntityLink kind="supplier" id={lot.supplierId} code={lot.supplierCode} name={lot.supplierName} />
                </td>
                <td className="col-tight is-numeric">
                  {formatQuantity(lot.initialReceivedQuantity)} {lot.unitCode}
                </td>
                <td className="col-tight">{formatDate(lot.expiryDate)}</td>
                <td className="col-tight">{lot.location ?? "—"}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  {/*
                    Abrir é a ação da linha; a etiqueta é de exceção AQUI.
                    O momento de rotina da impressão é o recebimento — o
                    Recebimento e a própria página do lote têm o botão — e na
                    LISTA ela custava mais largura que seis colunas de negócio.
                  */}
                  <RowActions
                    actions={[
                      {
                        label: "Imprimir etiqueta (QR)",
                        onSelect: () => navigate(`/estoque/lotes/${lot.id}/etiqueta`),
                      },
                    ]}
                  >
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/estoque/lotes/${lot.id}`)}
                    >
                      Abrir
                    </button>
                  </RowActions>
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
