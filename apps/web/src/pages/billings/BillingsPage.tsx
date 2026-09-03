import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import { listCustomers } from "../../lib/customers-api";
import { EntityLink } from "../../components/EntityLink";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useNavigate } from "react-router-dom";
import type { AwaitingBillingRowDTO, BillingDTO, BillingStatus } from "@veridi/shared";
import {
  BILLING_STATUSES,
  BILLING_STATUS_LABELS,
  SHIPMENT_BILLING_STATUS_LABELS,
} from "@veridi/shared";
import { createBilling, listAwaitingBilling, listBillings } from "../../lib/billings-api";
import { formatBRL } from "../../lib/currency";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

type ActiveFilter = BillingStatus | "all";

const PAGE_SIZE = 20;

function statusBadgeClass(status: BillingStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "ISSUED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}


/**
 * Comercial → Faturamento. Foco operacional: primeiro o que está
 * aguardando faturamento, depois os documentos já criados.
 */
export function BillingsPage() {
  const navigate = useNavigate();

  const [awaiting, setAwaiting] = useState<AwaitingBillingRowDTO[]>([]);
  const [billings, setBillings] = useState<BillingDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preparingShipmentId, setPreparingShipmentId] = useState<string | null>(null);

  // Contexto explícito na URL manda: chegar aqui pelo cliente tem que abrir a
  // tela já filtrada por ele.
  const [params] = useSearchParams();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ActiveFilter>("all");
  const [customerFilter, setCustomerFilter] = useState(params.get("customerId") ?? "");
  const [dateFrom, setDateFrom] = useState(params.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(params.get("dateTo") ?? "");
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);

  useEffect(() => {
    listCustomers({ pageSize: 1000 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
  }, []);

  const hasFilters =
    Boolean(search) || statusFilter !== "all" || Boolean(customerFilter) || Boolean(dateFrom) || Boolean(dateTo);

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setStatusFilter("all");
    setCustomerFilter("");
    setDateFrom("");
    setDateTo("");
  }

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, customerFilter, dateFrom, dateTo]);

  const reloadAwaiting = useCallback(() => {
    listAwaitingBilling()
      .then((result) => setAwaiting(result.rows))
      .catch(() => setAwaiting([]));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const query: Parameters<typeof listBillings>[0] = { page, pageSize: PAGE_SIZE };
    if (search) query.search = search;
    if (statusFilter !== "all") query.status = statusFilter;
    if (customerFilter) query.customerId = customerFilter;
    if (dateFrom) query.dateFrom = dateFrom;
    if (dateTo) query.dateTo = dateTo;

    listBillings(query)
      .then((result) => {
        setBillings(result.billings);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar faturamentos");
      })
      .finally(() => setLoading(false));
  }, [page, search, statusFilter, customerFilter, dateFrom, dateTo]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    reloadAwaiting();
  }, [reloadAwaiting]);

  async function handlePrepare(row: AwaitingBillingRowDTO) {
    if (row.billingId) {
      navigate(`/comercial/faturamento/${row.billingId}`);
      return;
    }
    setPreparingShipmentId(row.shipmentId);
    setError(null);
    try {
      const billing = await createBilling(row.shipmentId);
      navigate(`/comercial/faturamento/${billing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar faturamento");
    } finally {
      setPreparingShipmentId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Faturamento</h1>
          <p className="page__subtitle">
            Faturamento comercial/operacional do que foi realmente expedido — não emite Nota Fiscal.
          </p>
        </div>
        <ExportCsvButton path="/billings/export.csv" filters={{
            search,
            status: statusFilter === "all" ? undefined : statusFilter,
            customerId: customerFilter,
            dateFrom,
            dateTo,
          }} />
</div>

      <ContextHelp topic={helpTopics["faturamento.comoFunciona"]} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th colSpan={7}>Aguardando faturamento</th>
            </tr>
            <tr>
              <th className="col-tight">Expedição</th>
              <th className="col-tight">Pedido</th>
              <th className="col-flex">Cliente</th>
              <th className="col-tight">Data</th>
              <th className="is-numeric col-tight">Quantidade</th>
              <th className="col-tight">Situação</th>
              {/* Esta tabela não é `table--sticky-actions`, então a regra que
                  congela a última coluna não vale aqui: a classe vai à mão. */}
              <th aria-hidden="true" className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {awaiting.map((row) => (
              <tr key={row.shipmentId}>
                <td className="is-code col-tight">{row.shipmentCode}</td>
                <td className="is-code col-tight">{row.customerOrderCode}</td>
                <td className="col-flex">
                  <EntityLink kind="customer" id={row.customerId} code={row.customerName} />
                </td>
                <td className="col-tight">{formatDate(row.shipmentDate)}</td>
                <td className="col-tight">{formatQuantity(row.totalQuantity)}</td>
                <td className="col-tight">
                  <span
                    className={row.billingStatus === "DRAFT" ? "badge badge--warn" : "badge badge--neutral"}
                  >
                    {SHIPMENT_BILLING_STATUS_LABELS[row.billingStatus]}
                  </span>
                </td>
                <td className="col-actions">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={preparingShipmentId === row.shipmentId}
                    /* O código do faturamento já está na linha (coluna
                       Expedição/Pedido) e repeti-lo dentro do botão fazia a
                       coluna de ações virar a 2ª mais larga da tela. Fica só
                       no nome acessível, para quem navega por leitor de tela
                       ouvir qual documento vai abrir. */
                    aria-label={row.billingId ? `Abrir ${row.billingCode}` : undefined}
                    onClick={() => handlePrepare(row)}
                  >
                    {row.billingId
                      ? "Abrir"
                      : preparingShipmentId === row.shipmentId
                        ? "Preparando…"
                        : "Preparar faturamento"}
                  </button>
                </td>
              </tr>
            ))}

            {awaiting.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhuma expedição aguardando faturamento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* A barra filtra os DOCUMENTOS de faturamento; a fila "Aguardando
          faturamento" acima é outra pergunta e não responde a ela. Dizer isso
          é mais barato do que deixar o usuário deduzir pela posição. */}
      <p className="toolbar__scope">Filtrar documentos de faturamento</p>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="billing-search">
            Buscar faturamentos
          </label>
          <input
            id="billing-search"
            type="search"
            placeholder="Buscar por código, pedido, expedição ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="billing-status-filter">
          Filtrar por status
        </label>
        <select
          id="billing-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ActiveFilter)}
        >
          <option value="all">Todos os status</option>
          {BILLING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {BILLING_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <div className="toolbar__entity">
          <label className="sr-only" htmlFor="billing-customer-filter">
            Filtrar por cliente
          </label>
          <SearchableEntitySelect
            id="billing-customer-filter"
            value={customerFilter}
            onChange={setCustomerFilter}
            placeholder="Todos os clientes"
            options={customers.map((customer) => ({
              id: customer.id,
              code: customer.code,
              name: customer.tradeName ?? customer.legalName,
            }))}
          />
        </div>

        <label className="sr-only" htmlFor="billing-date-from">
          Emitido a partir de
        </label>
        <input
          id="billing-date-from"
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <label className="sr-only" htmlFor="billing-date-to">
          Emitido até
        </label>
        <input
          id="billing-date-to"
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />

        {hasFilters && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>
            Limpar filtros
          </button>
        )}
      </div>

      <div className="table-container">
        <table className="table table--clickable-rows table--sticky-actions">
          <thead>
            <tr>
              <th colSpan={9}>Documentos de faturamento</th>
            </tr>
            <tr>
              <th className="col-tight">Faturamento</th>
              <th className="col-tight">Expedição</th>
              <th className="col-tight">Pedido</th>
              <th className="col-flex">Cliente</th>
              <th className="is-numeric col-tight">Quantidade</th>
              {/* Valor nunca trunca: meio número parece um número verdadeiro. */}
              <th className="is-numeric col-tight">Valor</th>
              <th className="col-tight">Status</th>
              <th className="col-tight">Emitido em</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {billings.map((billing) => (
              <tr
                key={billing.id}
                tabIndex={0}
                onClick={() => navigate(`/comercial/faturamento/${billing.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/comercial/faturamento/${billing.id}`);
                }}
              >
                <td className="is-code col-tight">{billing.code}</td>
                <td className="is-code col-tight">{billing.shipmentCode}</td>
                <td className="is-code col-tight">{billing.customerOrderCode}</td>
                <td className="col-flex">
                  <EntityLink kind="customer" id={billing.customerId} code={billing.customerName} />
                </td>
                <td className="col-tight">{formatQuantity(billing.totalQuantity)}</td>
                <td className="col-tight">
                  {billing.totalAmount ? formatBRL(billing.totalAmount) : "Não informado"}
                </td>
                <td className="col-tight">
                  <span className={statusBadgeClass(billing.status)}>
                    {BILLING_STATUS_LABELS[billing.status]}
                  </span>
                </td>
                <td className="col-tight">{formatDate(billing.issuedAt)}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/comercial/faturamento/${billing.id}`)}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && billings.length === 0 && (
              <tr>
                <td colSpan={9} className="table__empty">
                  {hasFilters ? (
                    <>
                      Nenhum faturamento encontrado para os filtros atuais.{" "}
                      <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>
                        Limpar filtros
                      </button>
                    </>
                  ) : (
                    "Nenhum faturamento cadastrado."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "faturamento" : "faturamentos"}
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
