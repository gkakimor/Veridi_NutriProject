import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { CustomerDTO, ProjectDTO, ProjectStatus } from "@veridi/shared";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@veridi/shared";
import { EntityLink } from "../../components/EntityLink";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { listProjects, getProjectVocabulary } from "../../lib/projects-api";
import { listCustomers } from "../../lib/customers-api";
import { ProjectFormModal } from "./ProjectFormModal";
import { useAuth } from "../../app/AuthProvider";
import { useInitialFilters } from "../../lib/filter-params";
import { clearStoredFilters, usePersistentFilter } from "../../lib/stored-filters";
import { formatDate } from "../../lib/dates";

const PAGE_SIZE = 20;

/**
 * ⓘ de cabeçalho de coluna. O texto mora em `help-content`: "Status" quer
 * dizer a mesma coisa aqui e na ficha do projeto, e quem revisa a explicação
 * não deveria precisar abrir duas telas.
 */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

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
  /*
   * `?novo=1` abre o cadastro direto — é como a ação rápida do Dashboard
   * chega aqui sem duplicar o formulário numa rota própria.
   *
   * O botão daqui também põe o parâmetro, e não por simetria: o campo
   * Cliente do formulário sai para a TELA OFICIAL de cadastro, e sair
   * DESMONTA o modal. Quem volta precisa encontrá-lo aberto, e a URL é a
   * única coisa que atravessa a navegação — o rascunho volta pelo contexto,
   * mas só se houver formulário montado para recebê-lo.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(searchParams.get("novo") === "1");

  function openCreate() {
    setCreateOpen(true);
    if (searchParams.get("novo") === "1") return;
    const next = new URLSearchParams(searchParams);
    next.set("novo", "1");
    setSearchParams(next, { replace: true });
  }

  function closeCreate() {
    setCreateOpen(false);
    if (searchParams.get("novo") === "1") {
      const next = new URLSearchParams(searchParams);
      next.delete("novo");
      setSearchParams(next, { replace: true });
    }
  }

  const urlFilter = useInitialFilters();
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
    urlFilter("customerId"),
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
        <button type="button" className="btn btn--primary" onClick={openCreate}>
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

      {/* "Projeto" é a palavra mais sobrecarregada do módulo: aqui ele é a
          negociação ANTES do produto existir, e o funil só termina quando a
          aprovação cria o produto operacional. */}
      <ContextHelp topic={helpTopics["comercial.projetos"]} />

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

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows table--sticky-actions">
          <thead>
            <tr>
              <th className="col-flex">Projeto</th>
              <th className="col-tight">
                Código legado
                <DicaDaColuna id="comercial.projetoCodigoLegado" />
              </th>
              <th className="col-tight">Entrada</th>
              <th className="col-flex">Cliente</th>
              <th className="col-tight">Conceito</th>
              <th className="col-tight">
                Canal
                <DicaDaColuna id="comercial.projetoCanal" />
              </th>
              <th className="col-tight">Responsável</th>
              <th className="col-tight">
                Última versão
                <DicaDaColuna id="comercial.projetoUltimaVersao" />
              </th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="comercial.projetoStatus" />
              </th>
              <th className="col-tight">
                Produto
                <DicaDaColuna id="comercial.projetoProduto" />
              </th>
              <th aria-hidden="true" />
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
                {/* O projeto precisa ser o destino explícito da linha: antes o
                    único link aqui era o do Cliente, e mirar "o projeto"
                    abria o cadastro do cliente. */}
                <td className="col-flex">
                  <EntityLink
                    kind="project"
                    id={project.id}
                    code={project.code}
                    name={project.name}
                  />
                </td>
                <td className="is-code col-tight">{project.externalCode ?? "—"}</td>
                <td className="col-tight">{formatDate(project.entryDate)}</td>
                <td className="col-flex">
                  <EntityLink kind="customer" id={project.customerId} code={project.customerCode} name={project.customerName} />
                </td>
                <td className="col-tight">{project.concept ?? "—"}</td>
                <td className="col-tight">{project.channel ?? "—"}</td>
                <td className="col-tight">{project.responsibleUserName ?? "—"}</td>
                <td className="is-code col-tight">{project.latestQuoteLabel ?? "—"}</td>
                <td className="col-tight">
                  <span className={statusBadgeClass(project.status)}>
                    {PROJECT_STATUS_LABELS[project.status]}
                  </span>
                </td>
                <td className="is-code col-tight">{project.productCode ?? "—"}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/comercial/projetos/${project.id}`}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && projects.length === 0 && (
              <tr>
                <td colSpan={11} className="table__empty">
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
          onClose={closeCreate}
          onSaved={(project) => {
            closeCreate();
            navigate(`/comercial/projetos/${project.id}`);
          }}
        />
      )}
    </>
  );
}
