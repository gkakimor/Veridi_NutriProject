import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { PricingVersionDTO } from "@veridi/shared";
import {
  COMMISSION_BASE_DESCRIPTION,
  CONTRIBUTION_DEFINITION,
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRICE_MODE_LABELS,
  PRICING_VERSION_STATUS_LABELS,
} from "@veridi/shared";
import { PrintSection, PrintTable, formatPrintDate } from "../../print/PrintLayout";
import { PrintSheet } from "../../print/PrintSheet";
import { formatUnitCost } from "../../components/CostBreakdown";
import { formatBRL } from "../../lib/currency";
import { getPricingVersion } from "../../lib/pricing-api";
import { formatPercent } from "../../lib/percent";

/**
 * Simulação de preço e margem impressa.
 *
 * Documento INTERNO: não é orçamento ao cliente e não é documento fiscal. O
 * que ele mostra é margem de CONTRIBUIÇÃO — impostos, despesas financeiras
 * e frete comercial não estão modelados.
 */
export function PricingPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [pricing, setPricing] = useState<PricingVersionDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getPricingVersion(id)
      .then(setPricing)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o documento"),
      );
  }, [id]);

  if (error) {
    return (
      <div className="print-screen">
        <article className="print-doc">
          <p className="form-alert" role="alert">{error}</p>
        </article>
      </div>
    );
  }
  if (!pricing) return <div className="print-screen">Carregando…</div>;

  const incompleteTiers = pricing.tiers.filter(
    (tier) => tier.costQuality === "PARTIAL" || tier.costQuality === "NO_COST",
  );

  return (
    <PrintSheet
      sheetCode={pricing.label}
      title="Simulação de preço e margem"
      subtitle={`${PRICING_VERSION_STATUS_LABELS[pricing.status]} · ${INDUSTRIAL_COST_QUALITY_LABELS[pricing.costQuality]}`}
      backTo={`/gestao/precificacao/${pricing.id}`}
      landscape
      meta={[
        { label: "Produto", value: `${pricing.productCode} — ${pricing.productName}` },
        { label: "Cliente", value: pricing.customerName ?? "—" },
        { label: "Cálculo de custo", value: pricing.calculationCode },
        { label: "Estrutura", value: pricing.industrialCostVersionLabel },
        { label: "Formulação", value: `V${pricing.formulationVersionNumber}` },
        { label: "Data de referência do custo", value: formatPrintDate(pricing.costReferenceDate) },
        { label: "Criada por", value: pricing.createdByName ?? "—" },
        {
          label: "Ativada",
          value: pricing.activatedAt
            ? `${formatPrintDate(pricing.activatedAt)} — ${pricing.activatedByName ?? "—"}`
            : "—",
        },
      ]}
    >
      <p className="print-doc__notice">
        Documento interno de precificação. Não é orçamento ao cliente e não é documento fiscal.
      </p>
      {incompleteTiers.length > 0 && (
        <p className="print-doc__notice">
          Custo incompleto — margem não calculável para as faixas afetadas. O valor apresentado
          nessas linhas é o subtotal conhecido, nunca o custo total.
        </p>
      )}

      <PrintSection title="Faixas de quantidade">
        <PrintTable
          columns={[
            "Quantidade",
            "Custo/un",
            "Modo",
            "Margem alvo",
            "Comissão",
            "Preço",
            "Margem resultante",
            "Markup",
            "Contribuição/un",
            "Receita",
            "Contribuição total",
          ]}
          isEmpty={pricing.tiers.length === 0}
          emptyMessage="Nenhuma faixa de quantidade cadastrada."
        >
          {pricing.tiers.map((tier) => (
            <tr key={tier.id}>
              <td className="is-number">
                {tier.quantity} {tier.uomCode}
              </td>
              <td className="is-number">
                {tier.industrialCostPerUnit === null
                  ? "—"
                  : formatUnitCost(tier.industrialCostPerUnit)}
              </td>
              <td>{PRICE_MODE_LABELS[tier.priceMode]}</td>
              <td className="is-number">{formatPercent(tier.targetContributionMarginPercent)}</td>
              <td className="is-number">{formatPercent(tier.commissionPercent)}</td>
              <td className="is-number">{formatUnitCost(tier.selectedUnitPrice)}</td>
              <td className="is-number">{formatPercent(tier.contributionMarginPercent)}</td>
              <td className="is-number">{formatPercent(tier.markupPercent)}</td>
              <td className="is-number">{formatUnitCost(tier.contributionPerUnit)}</td>
              <td className="is-number">
                {tier.grossRevenue === null ? "—" : formatBRL(tier.grossRevenue)}
              </td>
              <td className="is-number">
                {tier.contributionTotal === null ? "—" : formatBRL(tier.contributionTotal)}
              </td>
            </tr>
          ))}
        </PrintTable>
        <p className="print-doc__status">
          {CONTRIBUTION_DEFINITION} {COMMISSION_BASE_DESCRIPTION}
        </p>
      </PrintSection>

      <PrintSection title="Custo por faixa">
        <PrintTable
          columns={["Quantidade", "Lotes de referência", "Custo total", "Custo/1.000", "Qualidade"]}
          isEmpty={pricing.tiers.length === 0}
          emptyMessage=""
        >
          {pricing.tiers.map((tier) => (
            <tr key={tier.id}>
              <td className="is-number">
                {tier.quantity} {tier.uomCode}
              </td>
              <td className="is-number">{tier.batchCount}</td>
              <td className="is-number">
                {tier.industrialCostTotal === null
                  ? `${formatBRL(tier.knownSubtotal)} (subtotal conhecido)`
                  : formatBRL(tier.industrialCostTotal)}
              </td>
              <td className="is-number">
                {tier.costPer1000 === null ? "—" : formatBRL(tier.costPer1000)}
              </td>
              <td>{INDUSTRIAL_COST_QUALITY_LABELS[tier.costQuality]}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      {(pricing.warnings.length > 0 || pricing.tiers.some((tier) => tier.warnings.length > 0)) && (
        <PrintSection title="Observações">
          <PrintTable columns={["Faixa", "Observação"]} isEmpty={false} emptyMessage="">
            <>
              {pricing.warnings.map((warning, index) => (
                <tr key={`${index}-${warning.code}`}>
                  <td>—</td>
                  <td>{warning.message}</td>
                </tr>
              ))}
              {pricing.tiers.flatMap((tier) =>
                tier.warnings.map((warning, index) => (
                  <tr key={`${tier.id}-${index}-${warning.code}`}>
                    <td>
                      {tier.quantity} {tier.uomCode}
                    </td>
                    <td>{warning.message}</td>
                  </tr>
                )),
              )}
            </>
          </PrintTable>
        </PrintSection>
      )}
    </PrintSheet>
  );
}
