import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AwaitingBillingRowDTO, BillingDTO, BillingStatus } from "@veridi/shared";
import {
  BILLING_STATUSES,
  BILLING_STATUS_LABELS,
  SHIPMENT_BILLING_STATUS_LABELS,
} from "@veridi/shared";
import { createBilling, listAwaitingBilling, listBillings } from "../../lib/billings-api";
import { formatBRL } from "../../lib/currency";

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

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
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

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ActiveFilter>("all");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const reloadAwaiting = useCallback(() => {
    listAwaitingBilling()
      .then((result) => setAwaiting(result.rows))
      .catch(() => setAwaiting([]));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listBillings>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (statusFilter !== "all") params.status = statusFilter;

    listBillings(params)
      .then((result) => {
        setBillings(result.billings);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar faturamentos");
      })
      .finally(() => setLoading(false));
  }, [page, search, statusFilter]);

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
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th colSpan={7}>Aguardando faturamento</th>
            </tr>
            <tr>
              <th>Expedição</th>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Data</th>
              <th>Quantidade</th>
              <th>Situação</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {awaiting.map((row) => (
              <tr key={row.shipmentId}>
                <td className="is-code">{row.shipmentCode}</td>
                <td className="is-code">{row.customerOrderCode}</td>
                <td>{row.customerName ?? "—"}</td>
                <td>{formatDate(row.shipmentDate)}</td>
                <td>{row.totalQuantity}</td>
                <td>
                  <span
                    className={row.billingStatus === "DRAFT" ? "badge badge--warn" : "badge badge--neutral"}
                  >
                    {SHIPMENT_BILLING_STATUS_LABELS[row.billingStatus]}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={preparingShipmentId === row.shipmentId}
                    onClick={() => handlePrepare(row)}
                  >
                    {row.billingId
                      ? `Abrir ${row.billingCode}`
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
      </div>

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th colSpan={9}>Documentos de faturamento</th>
            </tr>
            <tr>
              <th>Faturamento</th>
              <th>Expedição</th>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Quantidade</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Emitido em</th>
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
                <td className="is-code">{billing.code}</td>
                <td className="is-code">{billing.shipmentCode}</td>
                <td className="is-code">{billing.customerOrderCode}</td>
                <td>{billing.customerName ?? "—"}</td>
                <td>{billing.totalQuantity}</td>
                <td>{billing.totalAmount ? formatBRL(billing.totalAmount) : "Não informado"}</td>
                <td>
                  <span className={statusBadgeClass(billing.status)}>
                    {BILLING_STATUS_LABELS[billing.status]}
                  </span>
                </td>
                <td>{formatDate(billing.issuedAt)}</td>
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
                  Nenhum faturamento encontrado.
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
