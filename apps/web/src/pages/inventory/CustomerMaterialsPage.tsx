import { formatQuantity } from "../../lib/quantity";
import { useEffect, useState } from "react";
import type { CustomerMaterialRowDTO, LotStatus } from "@veridi/shared";
import { LOT_STATUSES, LOT_STATUS_LABELS } from "@veridi/shared";
import { useInitialFilters } from "../../lib/filter-params";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import { listCustomerMaterials } from "../../lib/customer-materials-api";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import { clienteAtivoFilterSource } from "../../lib/filter-sources";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

type StatusFilter = LotStatus | "all";

const PAGE_SIZE = 20;

/** ⓘ de uma coluna, lido do registro central — o texto nunca mora no JSX. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}


function statusBadgeClass(status: LotStatus, isExpired: boolean): string {
  if (isExpired) return "badge badge--err";
  switch (status) {
    case "AVAILABLE":
      return "badge badge--active";
    case "AWAITING_RELEASE":
      return "badge badge--warn";
    default:
      return "badge badge--err";
  }
}

/**
 * Estoque → Materiais de Clientes. Somente leitura: responde "quanto
 * material de cada cliente está fisicamente na Veridi?". Nenhuma entidade
 * nova — é `Lot` de dono CUSTOMER lido pelo Inventory Ledger.
 */
export function CustomerMaterialsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const urlFilter = useInitialFilters();
  const [customerId, setCustomerId] = useState(urlFilter("customerId"));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const filtrosDaConsulta = {
    ...(search ? { search } : {}),
    ...(customerId ? { customerId } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(onlyWithBalance ? { onlyWithBalance: true } : {}),
  };
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listCustomerMaterials,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar materiais de clientes" },
  );
  const rows: CustomerMaterialRowDTO[] = consulta.data?.rows ?? [];
  const total = consulta.data?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Materiais de Clientes</h1>
          <p className="page__subtitle">
            Material que está fisicamente na Veridi mas pertence ao cliente. Só pode ser usado em
            Ordens de Produção do próprio cliente.
          </p>
        </div>
        <ExportCsvButton
          path="/inventory/customer-materials/export.csv"
          filters={{
            search,
            customerId: customerId || undefined,
            status: statusFilter === "all" ? undefined : statusFilter,
            onlyWithBalance: onlyWithBalance ? "true" : undefined,
          }}
        />
      </div>

      {/* Material de terceiro dentro da fábrica: a pergunta que sempre vem é
          "por que não posso usar isso na OP de outro cliente?". */}
      <ContextHelp topic={helpTopics["estoque.materiaisCliente"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="customer-materials-search">
            Buscar material de cliente
          </label>
          <input
            id="customer-materials-search"
            type="search"
            placeholder="Buscar por lote, item ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        {/* O filtro é pelo DONO do lote; a lista de clientes é a mesma de
            antes — só ativos —, agora com busca no servidor em vez de 1000. */}
        <EntityFilterSelect
          id="customer-materials-customer"
          label="Filtrar por cliente"
          placeholder="Todos os clientes"
          value={customerId}
          onChange={setCustomerId}
          source={clienteAtivoFilterSource}
        />

        <label className="sr-only" htmlFor="customer-materials-status">
          Filtrar por qualidade
        </label>
        <select
          id="customer-materials-status"
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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={onlyWithBalance}
            onChange={(event) => setOnlyWithBalance(event.target.checked)}
          />
          Somente com saldo
        </label>
      </div>

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table">
          <thead>
            <tr>
              <th className="col-flex">Cliente</th>
              <th className="col-flex">Item</th>
              <th className="col-tight">
                Lote interno
                <DicaDaColuna id="estoque.loteInterno" />
              </th>
              <th className="col-tight">
                Lote externo
                <DicaDaColuna id="estoque.loteFornecedor" />
              </th>
              <th className="col-tight">Validade</th>
              <th className="col-tight">Localização</th>
              <th className="col-tight is-numeric">
                Físico
                <DicaDaColuna id="estoque.fisico" />
              </th>
              <th className="col-tight is-numeric">
                Reservado
                <DicaDaColuna id="estoque.reservado" />
              </th>
              <th className="col-tight is-numeric">
                Disponível
                <DicaDaColuna id="estoque.disponivel" />
              </th>
              <th className="col-tight">
                Qualidade
                <DicaDaColuna id="estoque.situacaoLote" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.lotId}>
                <td className="col-flex">
                  <EntityLink kind="customer" id={row.customerId} code={row.customerCode} name={row.customerName} />
                </td>
                <td className="col-flex">
                  <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                </td>
                {/* Toda outra lista de lotes leva ao detalhe; esta era beco. */}
                <td className="col-tight is-code">
                  <EntityLink kind="lot" id={row.lotId} code={row.lotCode} />
                </td>
                <td className="col-tight">{row.supplierLot ?? "—"}</td>
                <td className="col-tight">{formatDate(row.expiryDate)}</td>
                <td className="col-tight">{row.location ?? "—"}</td>
                <td className="col-tight is-numeric">
                  {formatQuantity(row.onHand)} {row.unitCode}
                </td>
                <td className="col-tight is-numeric">{formatQuantity(row.reserved)}</td>
                <td className="col-tight is-numeric">{formatQuantity(row.available)}</td>
                <td className="col-tight">
                  <span className={statusBadgeClass(row.status, row.isExpired)}>
                    {row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.status]}
                  </span>
                </td>
              </tr>
            ))}

            <ListStatusRow colSpan={10} query={consulta} rowCount={rows.length}>
              Nenhum material de cliente em estoque.
            </ListStatusRow>
          </tbody>
        </table>
      </div>

      {consulta.data && (
        <div className="pagination">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
          >
            Anterior
          </button>
          <span className="pagination__info">
            Página {page} de {totalPages} — {total} lote(s)
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </>
  );
}
