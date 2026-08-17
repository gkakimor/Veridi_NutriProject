import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CustomerDTO, ProjectDTO, ProjectStatus } from "@veridi/shared";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@veridi/shared";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { listProjects, getProjectVocabulary } from "../../lib/projects-api";
import { listCustomers } from "../../lib/customers-api";
import { ProjectFormModal } from "./ProjectFormModal";
import { useAuth } from "../../app/AuthProvider";
import { clearStoredFilters, usePersistentFilter } from "../../lib/stored-filters";

const PAGE_SIZE = 20;

function statusBadgeClass(status: ProjectStatus): string {
  switch (status) {
    case "APPROVED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
    case "SAMPLE":
      return "badge badge--warn";
    default:
      return "badge badge--neutral";
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR");
}

/**
 * Comercial → Projetos. Substitui o controle principal da aba PL da
 * planilha: quais projetos entram, de qual cliente, em que estágio e com
 * qual versão de orçamento.
 */
const FILTER_SCOPE = "projects";

export function ProjectsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [search, setSearch] = usePersistentFilter(user?.id ?? null, FILTER_SCOPE, "search", "");
  const [status, setStatus] = usePersistentFilter<ProjectStatus | "all">(
    user?.id ?? null,
    FILTER_SCOPE,
    "status",
    "all",
  );
  const [customerId, setCustomerId] = usePersistentFilter(
    user?.id ?? null,
    FILTER_SCOPE,
    "customer",
    "",
  );
  const [channel, setChannel] = usePersistentFilter(user?.id ?? null, FILTER_SCOPE, "channel", "");
  const [searchInput, setSearchInput] = useState(search);

  const hasFilters = search !== "" || status !== "all" || customerId !== "" || channel !== "";

  function handleClearFilters() {
    setSearchInput("");
    setSearch("");
    setStatus("all");
    setCustomerId("");
    setChannel("");
    clearStoredFilters(user?.id ?? null, FILTER_SCOPE);
  }
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [channels, setChannels] = useState<string[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, status, customerId, channel]);

  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
    getProjectVocabulary()
      .then((vocabulary) => setChannels(vocabulary.channels))
      .catch(() => setChannels([]));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listProjects>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (status !== "all") params.status = status;
    if (customerId) params.customerId = customerId;
    if (channel) params.channel = channel;

    listProjects(params)
      .then((result) => {
        setProjects(result.projects);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar projetos"),
      )
      .finally(() => setLoading(false));
  }, [page, search, status, customerId, channel]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Projetos</h1>
          <p className="page__subtitle">
            Funil private label: entrada do projeto, orçamentos versionados e aprovação — o produto
            operacional nasce a partir daqui.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>
          Novo projeto
        </button>
        <ExportCsvButton
          path="/projects/export.csv"
          filters={{
            search,
            status: status === "all" ? undefined : status,
            customerId: customerId || undefined,
            channel: channel || undefined,
          }}
        />
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="projects-search">
            Buscar projetos
          </label>
          <input
            id="projects-search"
            type="search"
            placeholder="Buscar por código, código legado, projeto ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="projects-status">
          Filtrar por status
        </label>
        <select
          id="projects-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as ProjectStatus | "all")}
        >
          <option value="all">Todos os status</option>
          {PROJECT_STATUSES.map((option) => (
            <option key={option} value={option}>
              {PROJECT_STATUS_LABELS[option]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="projects-customer">
          Filtrar por cliente
        </label>
        <select
          id="projects-customer"
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

        <label className="sr-only" htmlFor="projects-channel">
          Filtrar por canal
        </label>
        <select
          id="projects-channel"
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
        >
          <option value="">Todos os canais</option>
          {channels.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleClearFilters}>
            Limpar filtros
          </button>
        )}
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Projeto</th>
              <th>Código legado</th>
              <th>Entrada</th>
              <th>Cliente</th>
              <th>Conceito</th>
              <th>Canal</th>
              <th>Responsável</th>
              <th>Última versão</th>
              <th>Status</th>
              <th>Produto</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr
                key={project.id}
                tabIndex={0}
                onClick={() => navigate(`/comercial/projetos/${project.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/comercial/projetos/${project.id}`);
                }}
              >
                <td>
                  <span className="code">{project.code}</span> {project.name}
                </td>
                <td className="is-code">{project.externalCode ?? "—"}</td>
                <td>{formatDate(project.entryDate)}</td>
                <td>{project.customerName}</td>
                <td>{project.concept ?? "—"}</td>
                <td>{project.channel ?? "—"}</td>
                <td>{project.responsibleUserName ?? "—"}</td>
                <td className="is-code">{project.latestQuoteLabel ?? "—"}</td>
                <td>
                  <span className={statusBadgeClass(project.status)}>
                    {PROJECT_STATUS_LABELS[project.status]}
                  </span>
                </td>
                <td className="is-code">{project.productCode ?? "—"}</td>
              </tr>
            ))}

            {!loading && projects.length === 0 && (
              <tr>
                <td colSpan={10} className="table__empty">
                  Nenhum projeto encontrado.
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
          Página {page} de {totalPages} — {total} projeto(s)
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

      {createOpen && (
        <ProjectFormModal
          project={null}
          onClose={() => setCreateOpen(false)}
          onSaved={(project) => {
            setCreateOpen(false);
            navigate(`/comercial/projetos/${project.id}`);
          }}
        />
      )}
    </>
  );
}
