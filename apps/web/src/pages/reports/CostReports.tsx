import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { INDUSTRIAL_COST_QUALITY_LABELS, PRICE_MODE_LABELS } from "@veridi/shared";
import { ReportPage, ReportPagination, ReportTable } from "./ReportPage";
import { useReport } from "./useReport";
import {
  getIndustrialCostByProductReport,
  getPricingByProductReport,
} from "../../lib/reports-api";
import { formatUnitCost } from "../../components/CostBreakdown";
import { formatBRL } from "../../lib/currency";

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
              <span className="code">{row.productCode}</span> {row.productName}
            </td>
            <td>{row.customerName ?? "—"}</td>
            <td>{row.activeCostVersionLabel ?? "—"}</td>
            <td className="is-code">{row.calculationCode ?? "—"}</td>
            <td>
              {row.costReferenceDate
                ? new Date(row.costReferenceDate).toLocaleDateString("pt-BR")
                : "—"}
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
            key={`${row.pricingVersionId}-${row.quantity}`}
            tabIndex={0}
            onClick={() => navigate(`/gestao/precificacao/${row.pricingVersionId}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter") navigate(`/gestao/precificacao/${row.pricingVersionId}`);
            }}
          >
            <td>
              <span className="code">{row.productCode}</span> {row.productName}
            </td>
            <td>{row.customerName ?? "—"}</td>
            <td className="is-code">{row.pricingLabel}</td>
            <td>
              {row.quantity} {row.uomCode}
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
              {row.activatedAt ? new Date(row.activatedAt).toLocaleDateString("pt-BR") : "—"}
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
