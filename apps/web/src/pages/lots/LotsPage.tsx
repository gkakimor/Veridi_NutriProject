import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { Link, useNavigate } from "react-router-dom";
import type { InventoryOwnerType, LotDTO, LotStatus } from "@veridi/shared";
import { LOT_STATUSES, LOT_STATUS_LABELS, ownerLabel } from "@veridi/shared";
import type { ListLotsParams } from "../../lib/lots-api";
import { listLots } from "../../lib/lots-api";
import { useAuth } from "../../app/AuthProvider";
import { EntityLink } from "../../components/EntityLink";
import { RowActions } from "../../components/RowActions";
import { formatDate } from "../../lib/dates";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { useListFilters } from "../../lib/list-filters";
import { ActiveFilterChips } from "../../components/filters/ActiveFilterChips";
import type { FilterChip } from "../../components/filters/ActiveFilterChips";
import { ClearFilters } from "../../components/filters/ClearFilters";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { itemFilterSource } from "../../lib/filter-sources";

/** ⓘ de uma coluna, lido do registro central — o texto nunca mora no JSX. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

type StatusFilter = LotStatus | "all";
type OwnerFilter = InventoryOwnerType | "all";

const PAGE_SIZE = 20;

/**
 * Os filtros desta lista e o que cada um significa quando está limpo.
 *
 * `itemId` é FILTRO, não um contexto à parte. Ele vivia fora do conjunto —
 * lido direto de `useSearchParams` — e por isso ficava fora do recarregamento,
 * fora do CSV e fora do "Limpar filtros". Aqui ele é um filtro como os
 * outros, com chip, × e endereço.
 *
 * `ownerType` também não estava na URL: o filtro funcionava e o endereço não
 * o reproduzia, então "me manda o link do que você está vendo" mostrava
 * outra lista.
 */
const FILTROS_PADRAO = {
  search: "",
  status: "all",
  ownerType: "all",
  itemId: "",
};

/**
 * Status conhecido, ou o default.
 *
 * A URL é texto de fora: `?status=QUALQUERCOISA` produziria uma consulta com
 * um status que o domínio não tem — a API recusaria, e a tela mostraria erro
 * em vez de lista. Cair no default é a leitura honesta de um endereço quebrado.
 */
function statusValido(valor: string): StatusFilter {
  if (valor === "all") return "all";
  return (LOT_STATUSES as readonly string[]).includes(valor) ? (valor as LotStatus) : "all";
}

function ownerValido(valor: string): OwnerFilter {
  return valor === "VERIDI" || valor === "CUSTOMER" ? valor : "all";
}

const OWNER_LABELS: Record<InventoryOwnerType, string> = {
  VERIDI: "Veridi",
  CUSTOMER: "Cliente",
};

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
 *
 * É TAMBÉM a tela de "Liberação de lotes", que é este mesmo endereço com
 * `?status=AWAITING_RELEASE` (ver `app/navigation.ts`). Duas portas, uma
 * lista — e é por isso que contexto residual doía tanto aqui: quem tinha
 * deixado um filtro na sessão clicava em "Liberação de lotes" e recebia o
 * cruzamento do status do link com a busca e o proprietário da visita
 * anterior. Na foundation a URL é conjunto explícito, não merge por campo.
 */
const FILTER_SCOPE = "lots";

export function LotsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [lots, setLots] = useState<LotDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itemEscolhido, setItemEscolhido] = useState<EntityOption | null>(null);

  const { values, page, set, setPage, clear, isActive } = useListFilters({
    defaults: FILTROS_PADRAO,
    persistScope: FILTER_SCOPE,
    userId: user?.id ?? null,
  });
  const { search, itemId } = values;
  const statusFilter = statusValido(values.status);
  const ownerFilter = ownerValido(values.ownerType);

  /*
   * UM conjunto de filtros para a consulta e para o CSV.
   *
   * `itemId` era lido de `useSearchParams` à parte e não entrava aqui: o CSV
   * exportava a base inteira enquanto a tela mostrava os lotes de um item, e
   * ninguém tinha como notar olhando o arquivo.
   */
  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListLotsParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (itemId) filtros.itemId = itemId;
    if (statusFilter !== "all") filtros.status = statusFilter;
    if (ownerFilter !== "all") filtros.ownerType = ownerFilter;
    return filtros;
  }, [search, itemId, statusFilter, ownerFilter]);

  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (searchInput === search) return;
    const handle = setTimeout(() => set({ search: searchInput }), 300);
    return () => clearTimeout(handle);
  }, [searchInput, search, set]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    listLots({ ...filtrosDaConsulta, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setLots(result.lots);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar lotes");
      })
      .finally(() => setLoading(false));
    /*
     * `filtrosDaConsulta` inclui `itemId`. Antes as dependências eram
     * `[page, search, statusFilter, ownerFilter]` e o item ficava de fora:
     * trocar `?itemId=` sem desmontar a página — navegar de um item para
     * outro pelo mesmo link — deixava na tela os lotes do item ANTERIOR, com
     * a URL já apontando para o novo.
     */
  }, [filtrosDaConsulta, page]);

  useEffect(() => {
    reload();
  }, [reload]);

  const chips: FilterChip[] = [];
  if (search) {
    chips.push({ label: "Busca", value: search, onRemove: () => set({ search: "" }) });
  }
  if (statusFilter !== "all") {
    chips.push({
      label: "Status",
      value: LOT_STATUS_LABELS[statusFilter],
      onRemove: () => set({ status: "all" }),
    });
  }
  if (ownerFilter !== "all") {
    chips.push({
      label: "Proprietário",
      value: OWNER_LABELS[ownerFilter],
      onRemove: () => set({ ownerType: "all" }),
    });
  }
  if (itemId) {
    /*
     * O nome do item sai do próprio campo de filtro, não das linhas: chegar
     * por um link e não encontrar lote nenhum é justamente quando a pessoa
     * precisa ler de que item a tela está falando.
     */
    const nome =
      itemEscolhido?.id === itemId
        ? `${itemEscolhido.code} · ${itemEscolhido.name}`
        : (lots.find((lot) => lot.itemId === itemId)?.itemCode ?? "selecionado");
    chips.push({ label: "Item", value: nome, onRemove: () => set({ itemId: "" }) });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Lotes</h1>
          <p className="page__subtitle">
            Lotes internos criados por recebimento ou por produção. O saldo de cada um é a soma
            das movimentações.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate("/estoque/lotes/escanear")}
        >
          Escanear QR
        </button>
        <ExportCsvButton path="/lots/export.csv" filters={filtrosDaConsulta} />
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
          onChange={(event) => set({ ownerType: event.target.value })}
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
          onChange={(event) => set({ status: event.target.value })}
        >
          <option value="all">Todos os status</option>
          {LOT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LOT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        {/* O item era só contexto de link: não havia como filtrar por ele a
            partir da própria tela, embora a API sempre tenha respondido. O
            catálogo de itens é grande — a busca é do servidor. */}
        <EntityFilterSelect
          id="lots-item-filter"
          label="Filtrar por item"
          placeholder="Todos os itens"
          value={itemId}
          onChange={(value) => set({ itemId: value })}
          source={itemFilterSource}
          onResolve={setItemEscolhido}
        />
      </div>

      {/* Um "Limpar filtros" só, e ele limpa tudo — inclusive o item que veio
          pelo link. Havia dois botões com o mesmo texto: o da barra zerava os
          filtros da sessão e deixava o `?itemId=` de pé; o do aviso de
          contexto trocava de endereço e deixava a sessão intacta. */}
      <ActiveFilterChips chips={chips} onClear={clear} />

      {error && <p className="form-alert" role="alert">{error}</p>}

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
                    label={`Mais ações de ${lot.code}`}
                    actions={[
                      {
                        label: "Imprimir etiqueta (QR)",
                        onSelect: () => navigate(`/estoque/lotes/${lot.id}/etiqueta`),
                      },
                    ]}
                  >
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/estoque/lotes/${lot.id}`}
                    >
                      Abrir
                    </Link>
                  </RowActions>
                </td>
              </tr>
            ))}

            {!loading && lots.length === 0 && (
              <tr>
                <td colSpan={10} className="table__empty">
                  {isActive ? (
                    <>
                      Nenhum lote encontrado para os filtros atuais.{" "}
                      <ClearFilters onClear={clear} />
                    </>
                  ) : (
                    "Nenhum lote encontrado."
                  )}
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
    </>
  );
}
