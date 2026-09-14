import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProjectSampleDTO, ProjectSampleStatus } from "@veridi/shared";
import { PROJECT_SAMPLE_STATUSES, PROJECT_SAMPLE_STATUS_LABELS } from "@veridi/shared";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import type { ListSamplesParams } from "../../lib/samples-api";
import { listSamples } from "../../lib/samples-api";
import { clienteAtivoFilterSource } from "../../lib/filter-sources";
import { EntityLink } from "../../components/EntityLink";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { formatDateTime } from "../../lib/dates";

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

/**
 * Comercial → Amostras. Visão global de tudo que foi testado, independente
 * do projeto: substitui a aba de amostras da planilha, onde cada teste Tn
 * só existia numa linha solta.
 */
export function SamplesPage() {
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectSampleStatus | "all">("all");
  const [customerId, setCustomerId] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListSamplesParams, "page" | "pageSize"> = {};
    if (search) filtros.search = search;
    if (status !== "all") filtros.status = status;
    if (customerId) filtros.customerId = customerId;
    return filtros;
  }, [search, status, customerId]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca. */
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listSamples,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar amostras" },
  );
  const samples: ProjectSampleDTO[] = consulta.data?.samples ?? [];
  const total = consulta.data?.total ?? 0;

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

        {/* Era um `<select>` com os 100 primeiros clientes ativos: do 101º em
            diante o cliente tinha amostra e não tinha filtro. */}
        <EntityFilterSelect
          id="samples-customer"
          label="Filtrar por cliente"
          placeholder="Todos os clientes"
          value={customerId}
          onChange={setCustomerId}
          source={clienteAtivoFilterSource}
        />
      </div>

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
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

            <ListStatusRow colSpan={9} query={consulta} rowCount={samples.length}>
              {/* Amostra pertence a um projeto — não existe "amostra
                  solta". Quem chega por este menu procurando criar não
                  achava o caminho, e a lista vazia não dizia nada. */}
              Nenhuma amostra encontrada. Toda amostra nasce dentro de um{" "}
              <Link to="/comercial/projetos">projeto</Link>, no bloco "Amostras / testes".
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
            Página {page} de {totalPages} — {total} amostra(s)
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
