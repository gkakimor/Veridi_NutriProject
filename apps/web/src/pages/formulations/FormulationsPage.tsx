import { useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import { Link, useNavigate } from "react-router-dom";
import type { FormulationSummaryDTO } from "@veridi/shared";
import { listFormulations } from "../../lib/formulations-api";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

const PAGE_SIZE = 20;

function situacaoBadge(formulation: FormulationSummaryDTO) {
  if (formulation.activeVersionLabel) {
    return (
      <span className="badge badge--active">Ativa ({formulation.activeVersionLabel})</span>
    );
  }
  if (formulation.hasFormulation) {
    return <span className="badge badge--warn">Rascunho, sem versão ativa</span>;
  }
  return <span className="badge badge--neutral">Sem formulação</span>;
}


/** Produção → Formulações — uma linha por Product, nunca por componente. */
export function FormulationsPage() {
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  /* Busca nova é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const filtrosDaConsulta = search ? { search } : {};
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listFormulations,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar formulações" },
  );
  const formulations: FormulationSummaryDTO[] = consulta.data?.formulations ?? [];
  const total = consulta.data?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Formulações</h1>
          <p className="page__subtitle">
            Uma versão ativa por produto — mudanças sempre criam uma nova versão.
          </p>
        </div>
        <ExportCsvButton path="/formulations/export.csv" filters={{ search }} />
</div>

      <ContextHelp topic={helpTopics["formulacao.lista"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="formulations-search">
            Buscar produtos
          </label>
          <input
            id="formulations-search"
            type="search"
            placeholder="Buscar por produto, código ou cliente…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
      </div>

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table table--sticky-actions table--clickable-rows">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cliente</th>
              <th>Item acabado</th>
              <th>Versão ativa</th>
              <th>Situação</th>
              <th>Última atualização</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {formulations.map((formulation) => (
              <tr
                key={formulation.productId}
                tabIndex={0}
                onClick={() => navigate(`/producao/formulacoes/${formulation.productId}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    navigate(`/producao/formulacoes/${formulation.productId}`);
                  }
                }}
              >
                <td>
                  <EntityLink kind="product" id={formulation.productId} code={formulation.productCode} name={formulation.productName} />
                </td>
                <td>{formulation.customerName ?? "—"}</td>
                <td>
                  <EntityLink
                    kind="item"
                    id={formulation.finishedProductItemId}
                    code={formulation.finishedProductItemCode}
                  />
                </td>
                <td>{formulation.activeVersionLabel ?? "—"}</td>
                <td>{situacaoBadge(formulation)}</td>
                <td>{formatDate(formulation.updatedAt)}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      to={`/producao/formulacoes/${formulation.productId}`}
                    >
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))}

            <ListStatusRow colSpan={7} query={consulta} rowCount={formulations.length}>
              Nenhum produto encontrado.
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {total} {total === 1 ? "produto" : "produtos"}
          </div>
        )}
      </div>

      {consulta.data && (
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
      )}
    </>
  );
}
