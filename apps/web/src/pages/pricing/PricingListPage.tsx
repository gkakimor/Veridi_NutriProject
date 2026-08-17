import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PricingVersionSummaryDTO } from "@veridi/shared";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRICING_VERSION_STATUS_LABELS,
} from "@veridi/shared";
import { listPricingVersions } from "../../lib/pricing-api";
import { EntityLink } from "../../components/EntityLink";

const PAGE_SIZE = 20;

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return "badge badge--active";
  if (status === "INACTIVE") return "badge badge--neutral";
  return "badge badge--warn";
}

/**
 * Gestão → Precificação.
 *
 * Lista de trabalho comercial: qual produto tem preço vigente, sobre qual
 * cálculo de custo ele foi construído e com que qualidade de custo. O preço
 * em si vive no detalhe — a lista existe para achar e comparar.
 */
export function PricingListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PricingVersionSummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [quality, setQuality] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, status, quality]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listPricingVersions({
      page,
      pageSize: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(quality ? { quality } : {}),
    })
      .then((result) => {
        setRows(result.pricingVersions);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar precificações"),
      )
      .finally(() => setLoading(false));
  }, [page, search, status, quality]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Precificação</h1>
          <p className="page__subtitle">
            Preço e margem de contribuição por faixa de quantidade, sempre a partir de um cálculo de
            custo salvo.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="pricing-search">
            Buscar precificações
          </label>
          <input
            id="pricing-search"
            type="search"
            placeholder="Buscar por PREC, CALC, código ou nome do produto…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="pricing-status">
          Filtrar por situação
        </label>
        <select
          id="pricing-status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Todas as situações</option>
          <option value="DRAFT">Rascunho</option>
          <option value="ACTIVE">Ativa</option>
          <option value="INACTIVE">Inativa</option>
        </select>

        <label className="sr-only" htmlFor="pricing-quality">
          Filtrar por qualidade do custo
        </label>
        <select
          id="pricing-quality"
          value={quality}
          onChange={(event) => setQuality(event.target.value)}
        >
          <option value="">Todas as qualidades de custo</option>
          <option value="COMPLETE_REAL_REFERENCE">Referências reais</option>
          <option value="COMPLETE_WITH_ESTIMATES">Com estimativa</option>
          <option value="PARTIAL">Parcial</option>
          <option value="NO_COST">Sem custo</option>
        </select>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Precificação</th>
              <th>Produto</th>
              <th>Cliente</th>
              <th>Situação</th>
              <th>Cálculo</th>
              <th>Estrutura</th>
              <th>Data do custo</th>
              <th>Qualidade</th>
              <th>Faixas</th>
              <th>Ativada</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => navigate(`/gestao/precificacao/${row.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/gestao/precificacao/${row.id}`);
                }}
              >
                <td className="is-code">{row.label}</td>
                <td>
                  <EntityLink kind="product" id={row.productId} code={row.productCode} name={row.productName} />
                </td>
                <td>{row.customerName ?? "—"}</td>
                <td>
                  <span className={statusBadgeClass(row.status)}>
                    {PRICING_VERSION_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td className="is-code">{row.calculationCode}</td>
                <td>{row.industrialCostVersionLabel}</td>
                <td>{new Date(row.costReferenceDate).toLocaleDateString("pt-BR")}</td>
                <td>{INDUSTRIAL_COST_QUALITY_LABELS[row.costQuality]}</td>
                <td>{row.tierCount}</td>
                <td>
                  {row.activatedAt ? new Date(row.activatedAt).toLocaleDateString("pt-BR") : "—"}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="table__empty">
                  Nenhuma precificação encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "precificação" : "precificações"}
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
