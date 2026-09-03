import { formatQuantity } from "../../lib/quantity";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRICE_MODE_LABELS,
  QUOTE_PRICE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
} from "@veridi/shared";
import { ReportPage, ReportPagination, ReportTable } from "./ReportPage";
import { useReport } from "./useReport";
import {
  getIndustrialCostByProductReport,
  getPricingByProductReport,
  getQuotePricingAuditReport,
} from "../../lib/reports-api";
import { formatUnitCost } from "../../components/CostBreakdown";
import { formatBRL, formatUnitPriceBRL } from "../../lib/currency";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";

const PAGE_SIZE = 25;

/**
 * R-18 — Custo industrial por produto.
 *
 * Mostra o ÚLTIMO CÁLCULO SALVO de cada produto. Abrir o relatório não
 * dispara centenas de cálculos, e produto sem cálculo aparece com "—": a
 * ausência de análise é informação gerencial, não um custo zero.
 */
export function IndustrialCostByProductReportPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(() => ({ search, page, pageSize: PAGE_SIZE }), [search, page]);
  const { data, loading, error } = useReport(getIndustrialCostByProductReport, filters);

  return (
    <ReportPage
      title="R-18 · Custo industrial por produto"
      csvPath="/reports/costs/industrial-by-product/export.csv"
      reportCode="R-18"
      csvFilters={filters}
      total={data?.total}
      subtitle="Último cálculo salvo por produto. Cálculo parcial mostra subtotal conhecido, nunca um total."
      loading={loading}
      error={error}
      filters={
        <div className="toolbar__search">
          <input
            type="search"
            placeholder="Buscar por código ou nome do produto…"
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </div>
      }
    >
      <ReportTable
        columns={[
          "Produto",
          "Cliente",
          "Estrutura ativa",
          "Último cálculo",
          "Referência",
          "Qualidade",
          "Custo total",
          "Custo/unidade",
          "Custo/1.000",
        ]}
        emptyMessage="Nenhum produto encontrado."
        rows={data?.rows.map((row) => (
          <tr
            key={row.productId}
            tabIndex={row.calculationId ? 0 : -1}
            onClick={() => row.calculationId && navigate(`/calculos-custo/${row.calculationId}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && row.calculationId) {
                navigate(`/calculos-custo/${row.calculationId}`);
              }
            }}
          >
            <td>
              <EntityLink kind="product" id={row.productId} code={row.productCode} name={row.productName} />
            </td>
            <td>{row.customerName ?? "—"}</td>
            <td>{row.activeCostVersionLabel ?? "—"}</td>
            <td className="is-code">{row.calculationCode ?? "—"}</td>
            <td>
              {formatDate(row.costReferenceDate)}
            </td>
            <td>{row.quality ? INDUSTRIAL_COST_QUALITY_LABELS[row.quality] : "—"}</td>
            <td>
              {row.totalIndustrialCost
                ? formatBRL(row.totalIndustrialCost)
                : row.knownSubtotal
                  ? `${formatBRL(row.knownSubtotal)} (subtotal conhecido)`
                  : "—"}
            </td>
            <td>{formatUnitCost(row.costPerUnit)}</td>
            <td>{row.costPer1000 ? formatBRL(row.costPer1000) : "—"}</td>
          </tr>
        ))}
      />

      {data && (
        <ReportPagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={setPage}
        />
      )}
    </ReportPage>
  );
}

/**
 * R-19 — Precificação por produto.
 *
 * Uma linha por faixa de preço ATIVA, lendo o que foi congelado na ativação.
 * O relatório nunca resimula: mostra o preço praticado, com a qualidade do
 * custo que o embasou.
 */
export function PricingByProductReportPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(() => ({ search, page, pageSize: PAGE_SIZE }), [search, page]);
  const { data, loading, error } = useReport(getPricingByProductReport, filters);

  return (
    <ReportPage
      title="R-19 · Precificação por produto"
      csvPath="/reports/costs/pricing-by-product/export.csv"
      reportCode="R-19"
      csvFilters={filters}
      total={data?.total}
      subtitle="Faixas de preço ativas com margem de contribuição — não é lucro líquido."
      loading={loading}
      error={error}
      filters={
        <div className="toolbar__search">
          <input
            type="search"
            placeholder="Buscar por produto, PREC ou CALC…"
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </div>
      }
    >
      <ReportTable
        columns={[
          "Produto",
          "Cliente",
          "Precificação",
          "Quantidade",
          "Cálculo",
          "Qualidade",
          "Custo/un",
          "Comissão",
          "Preço",
          "Margem contrib.",
          "Markup",
          "Contribuição/un",
          "Ativada em",
        ]}
        emptyMessage="Nenhuma precificação ativa."
        rows={data?.rows.map((row) => (
          <tr
            key={`${row.pricingVersionId}-${formatQuantity(row.quantity)}`}
            tabIndex={0}
            onClick={() => navigate(`/gestao/precificacao/${row.pricingVersionId}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter") navigate(`/gestao/precificacao/${row.pricingVersionId}`);
            }}
          >
            <td>
              <EntityLink kind="product" id={row.productId} code={row.productCode} name={row.productName} />
            </td>
            <td>{row.customerName ?? "—"}</td>
            <td className="is-code">{row.pricingLabel}</td>
            <td>
              {formatQuantity(row.quantity)} {row.uomCode}
              <span className="field__hint"> {PRICE_MODE_LABELS[row.priceMode]}</span>
            </td>
            <td className="is-code">{row.calculationCode}</td>
            <td>{INDUSTRIAL_COST_QUALITY_LABELS[row.costQuality]}</td>
            <td>{formatUnitCost(row.costPerUnit)}</td>
            <td>{row.commissionPercent}%</td>
            <td>{formatUnitCost(row.unitPrice)}</td>
            <td>
              {row.contributionMarginPercent === null ? "—" : `${row.contributionMarginPercent}%`}
            </td>
            <td>{row.markupPercent === null ? "—" : `${row.markupPercent}%`}</td>
            <td>{formatUnitCost(row.contributionPerUnit)}</td>
            <td>
              {formatDate(row.activatedAt)}
            </td>
          </tr>
        ))}
      />

      {data && (
        <ReportPagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={setPage}
        />
      )}
    </ReportPage>
  );
}

/**
 * R-20 — Orçamento × Precificação.
 *
 * Auditoria comercial: qual proposta nasceu de precificação estruturada e
 * qual foi exceção. Contém custo e margem — documento interno, restrito a
 * quem negocia.
 */
export function QuotePricingAuditReportPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [priceSource, setPriceSource] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ search, priceSource, page, pageSize: PAGE_SIZE }),
    [search, priceSource, page],
  );
  const { data, loading, error } = useReport(getQuotePricingAuditReport, filters);

  return (
    <ReportPage
      title="R-20 · Orçamento × Precificação"
      csvPath="/reports/commercial/quote-pricing/export.csv"
      reportCode="R-20"
      csvFilters={filters}
      total={data?.total}
      subtitle="Documento interno: mostra custo e margem por proposta. Não é o orçamento do cliente."
      loading={loading}
      error={error}
      filters={
        <>
          <label className="sr-only" htmlFor="r20-source">
            Origem do preço
          </label>
          <select
            id="r20-source"
            value={priceSource}
            onChange={(event) => {
              setPage(1);
              setPriceSource(event.target.value);
            }}
          >
            <option value="">Todas as origens</option>
            <option value="PRICING_TIER">Faixa de precificação</option>
            <option value="MANUAL">Preço manual</option>
          </select>
          <div className="toolbar__search">
            <input
              type="search"
              placeholder="Buscar por ORC, PREC, CALC ou projeto…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
        </>
      }
    >
      <ReportTable
        columns={[
          "Orçamento",
          "Projeto",
          "Cliente",
          "Produto",
          "Status",
          "Quantidade",
          "Preço unitário",
          "Total",
          "Origem",
          "Precificação",
          "Cálculo",
          "Qualidade",
          "Custo/un",
          "Margem contrib.",
          "Enviado",
          "Aceito",
        ]}
        emptyMessage="Nenhum orçamento encontrado."
        rows={data?.rows.map((row) => (
          <tr
            key={row.quoteVersionId}
            tabIndex={0}
            onClick={() => navigate(`/comercial/projetos/${row.projectId}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter") navigate(`/comercial/projetos/${row.projectId}`);
            }}
          >
            <td className="is-code">{row.quoteLabel}</td>
            <td>
              <EntityLink kind="project" id={row.projectId} code={row.projectCode} name={row.projectName} />
            </td>
            <td>{row.customerName ?? "—"}</td>
            <td className="is-code">{row.productCode ?? "—"}</td>
            <td>{QUOTE_STATUS_LABELS[row.status]}</td>
            <td>
              {row.quotedQuantity ?? "—"} {row.uomCode ?? ""}
            </td>
            <td>{row.unitPrice ? formatUnitPriceBRL(row.unitPrice) : "—"}</td>
            <td>{row.total ? formatBRL(row.total) : "—"}</td>
            <td>{QUOTE_PRICE_SOURCE_LABELS[row.priceSource]}</td>
            <td className="is-code">{row.pricingLabel ?? "—"}</td>
            <td className="is-code">{row.calculationCode ?? "—"}</td>
            <td>{row.costQuality ? INDUSTRIAL_COST_QUALITY_LABELS[row.costQuality] : "—"}</td>
            <td>{formatUnitCost(row.industrialCostPerUnit)}</td>
            <td>
              {row.contributionMarginPercent === null
                ? "—"
                : `${row.contributionMarginPercent}%`}
            </td>
            <td>{formatDate(row.sentAt)}</td>
            <td>{formatDate(row.acceptedAt)}</td>
          </tr>
        ))}
      />

      {data && (
        <ReportPagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={setPage}
        />
      )}
    </ReportPage>
  );
}
