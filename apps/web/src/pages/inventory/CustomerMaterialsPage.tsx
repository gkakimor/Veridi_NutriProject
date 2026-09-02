import { useCallback, useEffect, useState } from "react";
import type { CustomerMaterialRowDTO, LotStatus } from "@veridi/shared";
import { LOT_STATUSES, LOT_STATUS_LABELS } from "@veridi/shared";
import { useInitialFilters } from "../../lib/filter-params";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { listCustomerMaterials } from "../../lib/customer-materials-api";
import { listCustomers } from "../../lib/customers-api";
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
  const [rows, setRows] = useState<CustomerMaterialRowDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const urlFilter = useInitialFilters();
  const [customerId, setCustomerId] = useState(urlFilter("customerId"));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);
  const [customers, setCustomers] = useState<{ id: string; code: string; legalName: string }[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, customerId, statusFilter, onlyWithBalance]);

  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) =>
        setCustomers(
          result.customers.map((customer) => ({
            id: customer.id,
            code: customer.code,
            legalName: customer.legalName,
          })),
        ),
      )
      .catch(() => setCustomers([]));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listCustomerMaterials>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (customerId) params.customerId = customerId;
    if (statusFilter !== "all") params.status = statusFilter;
    if (onlyWithBalance) params.onlyWithBalance = true;

    listCustomerMaterials(params)
      .then((result) => {
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar materiais de clientes");
      })
      .finally(() => setLoading(false));
  }, [page, search, customerId, statusFilter, onlyWithBalance]);

  useEffect(() => {
    reload();
  }, [reload]);

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

        <label className="sr-only" htmlFor="customer-materials-customer">
          Filtrar por cliente
        </label>
        <select
          id="customer-materials-customer"
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
        >
          <option value="">Todos os clientes</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.code} — {customer.legalName}
            </option>
          ))}
        </select>

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

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
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
                <td className="col-tight is-code">{row.lotCode}</td>
                <td className="col-tight">{row.supplierLot ?? "—"}</td>
                <td className="col-tight">{formatDate(row.expiryDate)}</td>
                <td className="col-tight">{row.location ?? "—"}</td>
                <td className="col-tight is-numeric">
                  {row.onHand} {row.unitCode}
                </td>
                <td className="col-tight is-numeric">{row.reserved}</td>
                <td className="col-tight is-numeric">{row.available}</td>
                <td className="col-tight">
                  <span className={statusBadgeClass(row.status, row.isExpired)}>
                    {row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.status]}
                  </span>
                </td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="table__empty">
                  Nenhum material de cliente em estoque.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
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
          onClick={() => setPage((current) => current + 1)}
        >
          Próxima
        </button>
      </div>
    </>
  );
}
