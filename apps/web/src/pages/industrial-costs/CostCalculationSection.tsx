import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  IndustrialCostCalculationDTO,
  IndustrialCostCalculationSummaryDTO,
} from "@veridi/shared";
import { INDUSTRIAL_COST_QUALITY_LABELS } from "@veridi/shared";
import { CostBreakdown, CostQualityBadge, formatUnitCost } from "../../components/CostBreakdown";
import { FormSection } from "../../components/FormSection";
import { formatBRL } from "../../lib/currency";
import {
  calculateIndustrialCost,
  listProductCostCalculations,
  saveIndustrialCostCalculation,
} from "../../lib/cost-calculation-api";
import { createPricingVersion } from "../../lib/pricing-api";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

/**
 * Cálculo padrão do custo industrial de uma estrutura.
 *
 * A data de referência é escolhida por quem calcula — custo de material
 * muda, e o mesmo produto calculado hoje e em março não precisa dar o mesmo
 * número. Calcular não persiste nada; salvar congela a análise para que a
 * decisão de preço continue explicável depois.
 */
export function CostCalculationSection({
  productId,
  versionId,
  canSave,
}: {
  productId: string;
  versionId: string;
  canSave: boolean;
}) {
  const navigate = useNavigate();
  const [referenceDate, setReferenceDate] = useState(today());
  const [result, setResult] = useState<IndustrialCostCalculationDTO | null>(null);
  const [history, setHistory] = useState<IndustrialCostCalculationSummaryDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    listProductCostCalculations(productId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [productId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Trocar de versão invalida o resultado exibido: ele é daquela estrutura.
  useEffect(() => {
    setResult(null);
  }, [versionId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao calcular o custo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <FormSection
        title="Cálculo padrão"
        subtitle="Quanto custa produzir a base de referência desta estrutura pelas informações conhecidas na data escolhida. Não é o custo realizado de uma produção."
      >
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="cost-reference-date">Data de referência de custo</label>
            <input
              id="cost-reference-date"
              type="date"
              value={referenceDate}
              onChange={(event) => setReferenceDate(event.target.value)}
            />
            <span className="field__hint">
              Compras posteriores a esta data não entram no cálculo.
            </span>
          </div>
        </div>

        <div className="line-actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setResult(
                  await calculateIndustrialCost(
                    versionId,
                    new Date(`${referenceDate}T12:00:00`).toISOString(),
                  ),
                );
              })
            }
          >
            Calcular custo
          </button>
          {canSave && result && (
            <button
              type="button"
              className="btn btn--accent btn--sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const saved = await saveIndustrialCostCalculation(versionId, {
                    costReferenceDate: new Date(`${referenceDate}T12:00:00`).toISOString(),
                  });
                  loadHistory();
                  navigate(`/calculos-custo/${saved.id}`);
                })
              }
            >
              Salvar cálculo
            </button>
          )}
        </div>

        {error && <p className="form-alert">{error}</p>}

        {result && (
          <>
            <div className="doc-title">
              <CostQualityBadge quality={result.quality} />
              {result.draftReference && (
                <span className="badge badge--warn">Referência de rascunho</span>
              )}
            </div>
            <CostBreakdown result={result} />
          </>
        )}

        {!result && !error && (
          <p className="field__hint">
            Nenhum cálculo executado nesta sessão. Calcular não altera nada — o resultado só vira
            histórico quando você salva.
          </p>
        )}
      </FormSection>

      <FormSection
        title="Cálculos salvos"
        subtitle="Cada cálculo salvo é imutável: ele preserva as referências de custo daquele momento."
      >
        <div className="table-container">
          <table className="table table--clickable-rows">
            <thead>
              <tr>
                <th>Código</th>
                <th>Estrutura</th>
                <th>Data de referência</th>
                <th>Calculado em</th>
                <th>Qualidade</th>
                <th className="is-numeric">Custo total</th>
                <th className="is-numeric">Custo/unidade</th>
                {canSave && <th aria-hidden="true" />}
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  onClick={() => navigate(`/calculos-custo/${row.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") navigate(`/calculos-custo/${row.id}`);
                  }}
                >
                  <td className="is-code">{row.code}</td>
                  <td>{row.industrialCostVersionLabel}</td>
                  <td>{new Date(row.costReferenceDate).toLocaleDateString("pt-BR")}</td>
                  <td>{formatDateTime(row.calculatedAt)}</td>
                  <td>{INDUSTRIAL_COST_QUALITY_LABELS[row.quality]}</td>
                  <td className="is-numeric">
                    {row.totalIndustrialCost === null
                      ? `${formatBRL(row.knownSubtotal)} (subtotal conhecido)`
                      : formatBRL(row.totalIndustrialCost)}
                  </td>
                  <td className="is-numeric">{formatUnitCost(row.costPerUnit)}</td>
                  {canSave && (
                    <td onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            // Precificação formal nasce de um cálculo salvo.
                            const pricing = await createPricingVersion(productId, {
                              industrialCostCalculationId: row.id,
                            });
                            navigate(`/gestao/precificacao/${pricing.id}`);
                          })
                        }
                      >
                        Criar precificação
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={canSave ? 8 : 7} className="table__empty">
                    Nenhum cálculo salvo para este produto.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </FormSection>
    </>
  );
}
