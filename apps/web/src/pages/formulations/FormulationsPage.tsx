import { useCallback, useEffect, useState } from "react";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { Link, useNavigate } from "react-router-dom";
import type { FormulationSummaryDTO } from "@veridi/shared";
import { listFormulations } from "../../lib/formulations-api";
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

  const [formulations, setFormulations] = useState<FormulationSummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listFormulations>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;

    listFormulations(params)
      .then((result) => {
        setFormulations(result.formulations);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar formulações");
      })
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => {
    reload();
  }, [reload]);

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

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
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

            {!loading && formulations.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhum produto encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "produto" : "produtos"}
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
