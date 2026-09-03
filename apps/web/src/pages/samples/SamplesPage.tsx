import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CustomerDTO, ProjectSampleDTO, ProjectSampleStatus } from "@veridi/shared";
import { PROJECT_SAMPLE_STATUSES, PROJECT_SAMPLE_STATUS_LABELS } from "@veridi/shared";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { listSamples } from "../../lib/samples-api";
import { listCustomers } from "../../lib/customers-api";
import { EntityLink } from "../../components/EntityLink";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

const PAGE_SIZE = 20;

/**
 * ⓘ de rótulo e cabeçalho de coluna. O texto mora em `help-content`: a
 * mesma palavra quer dizer a mesma coisa na lista e na ficha, e quem revisa
 * a explicação não deveria precisar abrir duas telas.
 */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}


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

      {/* "Amostra" é lida como "lote pequeno" por quem chega da produção.
          O painel diz o que ela é antes que alguém procure o resultado no
          estoque de produto acabado. */}
      <ContextHelp topic={helpTopics["comercial.amostras"]} />

      {/* Amostra nasce dentro de um projeto, porque a numeração T1, T2, T3 é
          sequencial POR projeto — a regra está certa. O que faltava era dizer
          isso aqui: quem entrava por este menu encontrava uma lista sem botão
          de criar e sem nada indicando onde criar. A tela de Expedições, que
          tem exatamente a mesma situação, já resolvia assim. */}
      <div className="callout">
        <p>
          Novas amostras são criadas dentro de um Projeto, no bloco "Amostras / testes" — a
          numeração T1, T2, T3 é sequencial por projeto.
        </p>
        <div className="line-actions">
          <Link className="btn btn--secondary btn--sm" to="/comercial/projetos">
            Ir para Projetos
          </Link>
        </div>
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

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        {/* Sem `table--sticky-actions`: esta tabela não tem coluna de ações —
            a linha inteira é clicável. A classe congelava a última coluna de
            NEGÓCIO ("Produzida em") na borda direita, e numa tabela com mais
            de mil pixels de rolagem o dado que ficava fixo era o errado. */}
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Amostra</th>
              <th className="col-tight">
                Teste
                <DicaDaColuna id="comercial.amostraTeste" />
              </th>
              <th className="col-flex">Projeto</th>
              <th className="col-flex">
                Produto
                <DicaDaColuna id="comercial.amostraProdutoTestado" />
              </th>
              <th className="col-flex">Cliente</th>
              <th className="col-flex col-flex--truncate">Descrição</th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="comercial.amostraStatus" />
              </th>
              <th className="col-tight">
                Consumos
                <DicaDaColuna id="comercial.amostraConsumos" />
              </th>
              <th className="col-tight">Produzida em</th>
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
                <td className="is-code col-tight">
                  <EntityLink kind="sample" id={sample.id} code={sample.code} />
                </td>
                <td className="is-code col-tight">{sample.testLabel}</td>
                <td className="col-flex">
                  <EntityLink kind="project" id={sample.projectId} code={sample.projectCode} name={sample.projectName} />
                </td>
                <td className="col-flex">
                  {sample.productId ? (
                    <EntityLink
                      kind="product"
                      id={sample.productId}
                      code={sample.productCode}
                      name={sample.productName}
                    />
                  ) : (
                    <span className="muted">Produto não identificado</span>
                  )}
                </td>
                <td className="col-flex">
                  <EntityLink kind="customer" id={sample.customerId} code={sample.customerName} />
                </td>
                {/* Descrição livre: truncada com reticências para não virar
                    três linhas — o texto inteiro fica no `title`. */}
                <td className="col-flex col-flex--truncate" title={sample.description ?? undefined}>
                  {sample.description ?? "—"}
                </td>
                <td className="col-tight">
                  <span className={sampleStatusBadgeClass(sample.status)}>
                    {PROJECT_SAMPLE_STATUS_LABELS[sample.status]}
                  </span>
                </td>
                <td className="col-tight">{sample.consumptions.length}</td>
                <td className="col-tight">{formatDateTime(sample.producedAt)}</td>
              </tr>
            ))}

            {!loading && samples.length === 0 && (
              <tr>
                <td colSpan={9} className="table__empty">
                  {/* Amostra pertence a um projeto — não existe "amostra
                      solta". Quem chega por este menu procurando criar não
                      achava o caminho, e a lista vazia não dizia nada. */}
                  Nenhuma amostra encontrada. Toda amostra nasce dentro de um{" "}
                  <Link to="/comercial/projetos">projeto</Link>, no bloco "Amostras / testes".
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
