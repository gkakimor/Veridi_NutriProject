import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CustomerDTO, ProjectSampleDTO, ProjectSampleStatus } from "@veridi/shared";
import { PROJECT_SAMPLE_STATUSES, PROJECT_SAMPLE_STATUS_LABELS } from "@veridi/shared";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { listSamples } from "../../lib/samples-api";
import { listCustomers } from "../../lib/customers-api";

const PAGE_SIZE = 20;

export function sampleStatusBadgeClass(status: ProjectSampleStatus): string {
  switch (status) {
    case "APPROVED":
      return "badge badge--active";
    case "REJECTED":
      return "badge badge--err";
    case "CANCELLED":
      return "badge badge--neutral";
    case "PRODUCED":
      return "badge badge--warn";
    default:
      return "badge badge--neutral";
  }
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

/**
 * Comercial → Amostras. Visão global de tudo que foi testado, independente
 * do projeto: substitui a aba de amostras da planilha, onde cada teste Tn
 * só existia numa linha solta.
 */
export function SamplesPage() {
  const navigate = useNavigate();

  const [samples, setSamples] = useState<ProjectSampleDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectSampleStatus | "all">("all");
  const [customerId, setCustomerId] = useState("");
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, status, customerId]);

  useEffect(() => {
    listCustomers({ active: true, pageSize: 100 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listSamples>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (status !== "all") params.status = status;
    if (customerId) params.customerId = customerId;

    listSamples(params)
      .then((result) => {
        setSamples(result.samples);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar amostras"),
      )
      .finally(() => setLoading(false));
  }, [page, search, status, customerId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Amostras</h1>
          <p className="page__subtitle">
            Testes T1..Tn de desenvolvimento. Amostra não é lote nem ordem de produção: o material
            usado sai do estoque, mas o resultado nunca entra em produto acabado.
          </p>
        </div>
        <ExportCsvButton
          path="/project-samples/export.csv"
          filters={{
            search,
            status: status === "all" ? undefined : status,
            customerId: customerId || undefined,
          }}
        />
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="samples-search">
            Buscar amostras
          </label>
          <input
            id="samples-search"
            type="search"
            placeholder="Buscar por amostra, código legado, projeto ou descrição…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="samples-status">
          Filtrar por status
        </label>
        <select
          id="samples-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as ProjectSampleStatus | "all")}
        >
          <option value="all">Todos os status</option>
          {PROJECT_SAMPLE_STATUSES.map((option) => (
            <option key={option} value={option}>
              {PROJECT_SAMPLE_STATUS_LABELS[option]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="samples-customer">
          Filtrar por cliente
        </label>
        <select
          id="samples-customer"
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
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Amostra</th>
              <th>Teste</th>
              <th>Projeto</th>
              <th>Cliente</th>
              <th>Descrição</th>
              <th>Status</th>
              <th>Consumos</th>
              <th>Produzida em</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample) => (
              <tr
                key={sample.id}
                tabIndex={0}
                onClick={() => navigate(`/comercial/amostras/${sample.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/comercial/amostras/${sample.id}`);
                }}
              >
                <td className="is-code">{sample.code}</td>
                <td className="is-code">{sample.testLabel}</td>
                <td>
                  <span className="code">{sample.projectCode}</span> {sample.projectName}
                </td>
                <td>{sample.customerName}</td>
                <td>{sample.description ?? "—"}</td>
                <td>
                  <span className={sampleStatusBadgeClass(sample.status)}>
                    {PROJECT_SAMPLE_STATUS_LABELS[sample.status]}
                  </span>
                </td>
                <td>{sample.consumptions.length}</td>
                <td>{formatDateTime(sample.producedAt)}</td>
              </tr>
            ))}

            {!loading && samples.length === 0 && (
              <tr>
                <td colSpan={8} className="table__empty">
                  Nenhuma amostra encontrada.
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
          Página {page} de {totalPages} — {total} amostra(s)
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
