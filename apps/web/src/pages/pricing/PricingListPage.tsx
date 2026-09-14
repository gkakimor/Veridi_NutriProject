import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { PricingVersionSummaryDTO } from "@veridi/shared";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRICING_VERSION_STATUS_LABELS,
} from "@veridi/shared";
import { listPricingVersions } from "../../lib/pricing-api";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import { EntityLink } from "../../components/EntityLink";
import { ListStatusRow } from "../../components/ListStatusRow";
import { RecordContextChip } from "../../components/RecordContext";
import { formatDate } from "../../lib/dates";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

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

  // Chegada pelas telas do produto: a lista abre já reduzida a ele. Sem isto
  // o link prometia contexto e entregava a lista inteira.
  const [params] = useSearchParams();
  const contextProductId = params.get("productId");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [quality, setQuality] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Filtro antigo somado ao contexto esconderia a própria precificação citada.
  useEffect(() => {
    if (!contextProductId) return;
    setSearchInput("");
    setSearch("");
    setStatus("");
    setQuality("");
  }, [contextProductId]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const filtrosDaConsulta = {
    ...(contextProductId ? { productId: contextProductId } : {}),
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(quality ? { quality } : {}),
  };
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listPricingVersions,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar precificações" },
  );
  const rows: PricingVersionSummaryDTO[] = consulta.data?.pricingVersions ?? [];
  const total = consulta.data?.total ?? 0;

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

      <ContextHelp topic={helpTopics["precificacao.comoFunciona"]} />

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

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

      {contextProductId && (
        <RecordContextChip
          noun="o produto"
          code={rows[0]?.productCode}
          name={rows[0]?.productName}
          onClear={() => navigate("/gestao/precificacao")}
        />
      )}

      <div className="table-container" aria-busy={consulta.loading || undefined}>
        <table className="table table--clickable-rows table--sticky-actions">
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
                <td className="is-code">
                  <EntityLink kind="pricingVersion" id={row.id} code={row.label} />
                </td>
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
                <td>{formatDate(row.costReferenceDate)}</td>
                <td>{INDUSTRIAL_COST_QUALITY_LABELS[row.costQuality]}</td>
                <td>{formatIntegerPtBr(row.tierCount)}</td>
                <td>
                  {formatDate(row.activatedAt)}
                </td>
              </tr>
            ))}
            <ListStatusRow colSpan={10} query={consulta} rowCount={rows.length}>
              {/* Lista vazia sem caminho é beco sem saída: precificação
                  não nasce aqui, nasce de um cálculo de custo salvo. Quem
                  chegou por um produto específico recebe o link direto. */}
              Nenhuma precificação encontrada. Uma precificação nasce de um{" "}
              <strong>cálculo de custo salvo</strong>, na estrutura de custos do produto.
              {contextProductId && (
                <>
                  {" "}
                  <Link to={`/produtos/${contextProductId}/custos`}>
                    Abrir a estrutura de custos deste produto
                  </Link>
                  .
                </>
              )}
            </ListStatusRow>
          </tbody>
        </table>
        {consulta.data && (
          <div className="table-foot">
            {formatIntegerPtBr(total)} {total === 1 ? "precificação" : "precificações"}
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
