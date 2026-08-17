import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PricingVersionDTO, QuoteVersionDTO } from "@veridi/shared";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  QUOTE_PRICE_SOURCE_LABELS,
} from "@veridi/shared";
import { formatUnitCost } from "../../components/CostBreakdown";
import {
  applyQuotePricing,
  getQuotePricingOptions,
  useManualQuotePrice,
} from "../../lib/projects-api";

function formatPercent(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return "—";
  return `${number.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * Origem do preço da proposta.
 *
 * Informação INTERNA: custo, margem, markup e comissão aparecem aqui e
 * jamais no documento entregue ao cliente. Quem não negocia nem recebe esses
 * dados do backend.
 *
 * A faixa é um cenário econômico fechado — por isso a quantidade tem que
 * bater exatamente, sem "faixa mais próxima" nem interpolação.
 */
export function QuotePricingSection({
  quote,
  canEdit,
  onChanged,
}: {
  quote: QuoteVersionDTO;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [pricing, setPricing] = useState<PricingVersionDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getQuotePricingOptions(quote.id)
      .then(setPricing)
      .catch(() => setPricing(null));
  }, [quote.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar a ação");
    } finally {
      setBusy(false);
    }
  }

  const provenance = quote.pricing;

  return (
    <div className="doc-body">
      <h4>Origem do preço</h4>
      <p className="field__hint">
        {QUOTE_PRICE_SOURCE_LABELS[quote.priceSource]} — informação interna: o documento do cliente
        não mostra custo, margem nem comissão.
      </p>

      {error && <p className="form-alert">{error}</p>}

      {provenance && (
        <dl className="definition-list">
          <dt>Precificação</dt>
          <dd>
            {provenance.pricingVersionId ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/gestao/precificacao/${provenance.pricingVersionId}`)}
              >
                {provenance.pricingCode} · V{provenance.pricingVersionNumber}
              </button>
            ) : (
              "—"
            )}
          </dd>
          <dt>Faixa</dt>
          <dd>
            {provenance.tierQuantity} {provenance.tierUomCode}
          </dd>
          <dt>Cálculo de custo</dt>
          <dd>{provenance.calculationCode ?? "—"}</dd>
          <dt>Estrutura / formulação</dt>
          <dd>
            {provenance.costStructureLabel ?? "—"}
            {provenance.formulationVersionNumber
              ? ` · V${provenance.formulationVersionNumber}`
              : ""}
          </dd>
          <dt>Data de referência do custo</dt>
          <dd>
            {provenance.costReferenceDate
              ? new Date(provenance.costReferenceDate).toLocaleDateString("pt-BR")
              : "—"}
          </dd>
          <dt>Custo industrial / unidade</dt>
          <dd>{formatUnitCost(provenance.industrialCostPerUnit)}</dd>
          <dt>Qualidade do custo</dt>
          <dd>
            {provenance.costQuality
              ? INDUSTRIAL_COST_QUALITY_LABELS[provenance.costQuality]
              : "—"}
          </dd>
          <dt>Comissão</dt>
          <dd>{formatPercent(provenance.commissionPercent)}</dd>
          <dt>Margem de contribuição</dt>
          <dd>{formatPercent(provenance.contributionMarginPercent)}</dd>
          <dt>Contribuição / unidade</dt>
          <dd>{formatUnitCost(provenance.contributionPerUnit)}</dd>
          <dt>Base congelada</dt>
          <dd>{provenance.frozen ? "Sim — congelada no envio" : "Não — vínculo vivo do rascunho"}</dd>
        </dl>
      )}

      {provenance?.warnings.map((warning) => (
        <p key={warning.code} className="field__hint">
          {warning.message}
        </p>
      ))}

      {canEdit && quote.status === "DRAFT" && (
        <>
          {quote.priceSource === "PRICING_TIER" ? (
            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => void run(() => useManualQuotePrice(quote.id))}
              >
                Usar preço manual
              </button>
            </div>
          ) : pricing ? (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quantidade</th>
                    <th>Custo/un</th>
                    <th>Qualidade</th>
                    <th>Comissão</th>
                    <th>Preço</th>
                    <th>Margem de contribuição</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {pricing.tiers.map((tier) => {
                    const sameQuantity =
                      quote.quotedQuantity === null ||
                      Number(quote.quotedQuantity) === Number(tier.quantity);
                    return (
                      <tr key={tier.id}>
                        <td>
                          {tier.quantity} {tier.uomCode}
                        </td>
                        <td>{formatUnitCost(tier.industrialCostPerUnit)}</td>
                        <td>{INDUSTRIAL_COST_QUALITY_LABELS[tier.costQuality]}</td>
                        <td>{formatPercent(tier.commissionPercent)}</td>
                        <td>{formatUnitCost(tier.selectedUnitPrice)}</td>
                        <td>{formatPercent(tier.contributionMarginPercent)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busy}
                            onClick={() => void run(() => applyQuotePricing(quote.id, tier.id))}
                          >
                            Usar esta faixa
                          </button>
                          {!sameQuantity && (
                            <span className="field__hint">
                              {" "}
                              Quantidade do orçamento é diferente desta faixa.
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="table-foot">
                {pricing.label} · custo de referência {pricing.calculationCode}
              </div>
            </div>
          ) : (
            <p className="field__hint">
              Nenhuma precificação ativa para este produto. Prepare o produto técnico, calcule o
              custo e ative uma precificação para usar preço estruturado — ou siga com preço manual.
            </p>
          )}
        </>
      )}
    </div>
  );
}
