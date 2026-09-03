import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EntityLink } from "../../components/EntityLink";
import type {
  IndustrialCostCalculationDTO,
  IndustrialCostCalculationSummaryDTO,
} from "@veridi/shared";
import { INDUSTRIAL_COST_QUALITY_LABELS } from "@veridi/shared";
import { CostBreakdown, CostQualityBadge, formatUnitCost } from "../../components/CostBreakdown";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { formatBRL } from "../../lib/currency";
import {
  calculateIndustrialCost,
  listProductCostCalculations,
  saveIndustrialCostCalculation,
} from "../../lib/cost-calculation-api";
import { createPricingVersion } from "../../lib/pricing-api";
import { formatDate } from "../../lib/dates";
import { UsePricingPolicyDialog } from "../cost-templates/UsePricingPolicyDialog";
import { applyPricingPolicyToProduct } from "../../lib/cost-pricing-templates-api";

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
  const [confirmarIncompleto, setConfirmarIncompleto] = useState(false);
  const [confirmarSalvar, setConfirmarSalvar] = useState(false);
  /*
   * Trava de duplo envio.
   *
   * `busy` chega tarde: entre o clique e o re-render o botão ainda aceita
   * outro. Na auditoria isso gerou CALC-000001 e CALC-000002 idênticos, e
   * snapshot é imutável — não dá para desfazer depois.
   */
  const salvando = useRef(false);
  const [result, setResult] = useState<IndustrialCostCalculationDTO | null>(null);
  const [history, setHistory] = useState<IndustrialCostCalculationSummaryDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Aplicar política precisa de uma base de custo escolhida: o preço nasce
  // de um CALC, não do produto em abstrato.
  const [politicaPara, setPoliticaPara] = useState<IndustrialCostCalculationSummaryDTO | null>(
    null,
  );

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

  /*
   * "Incompleto" é a MESMA noção que o motor publica na qualidade — a tela
   * não redefine o que é um custo fechado.
   */
  const incompleto =
    result !== null &&
    result.quality !== "COMPLETE_REAL_REFERENCE" &&
    result.quality !== "COMPLETE_WITH_ESTIMATES";

  async function salvar() {
    if (salvando.current) return;
    salvando.current = true;
    try {
      await run(async () => {
        const saved = await saveIndustrialCostCalculation(versionId, {
          costReferenceDate: new Date(`${referenceDate}T12:00:00`).toISOString(),
        });
        loadHistory();
        navigate(`/calculos-custo/${saved.id}`);
      });
    } finally {
      salvando.current = false;
    }
  }

  return (
    <>
      <FormSection
        title="Cálculo padrão"
        subtitle="Quanto custa produzir a base de referência desta estrutura pelas informações conhecidas na data escolhida. Não é o custo realizado de uma produção."
      >
        {/* Campo único e curto: o padrão do app é `field--narrow` fora da
            grade de duas colunas, não meia tela em branco ao lado. */}
        <div className="field field--narrow">
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
            className="btn btn--accent btn--sm"
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
          {/*
              Calcular é exploração reversível; salvar cria documento
              imutável que orçamento e preço vão citar. A ação que
              compromete não deve ser a mais fácil de acertar — por isso
              ela é secundária, e sempre pergunta antes.
          */}
          {canSave && result && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => {
                // Congelar é decisão de quem salva — mas congelar um custo
                // INCOMPLETO em silêncio não é decisão, é acidente: o número
                // vira a base econômica do produto e nada mais avisa.
                if (incompleto) {
                  setConfirmarIncompleto(true);
                  return;
                }
                setConfirmarSalvar(true);
              }}
            >
              Salvar cálculo
            </button>
          )}
        </div>

        {error && <p className="form-alert" role="alert">{error}</p>}

        {result && (
          <>
            <div className="doc-title">
              <CostQualityBadge quality={result.quality} />
              {result.draftReference && (
                <span className="badge badge--warn">Referência de rascunho</span>
              )}
            </div>
            <CostBreakdown
              result={result}
              productId={productId}
              onStructurePage
              structureLocked={result.structureStatus !== "DRAFT"}
            />
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
                  <td className="is-code">
                    <EntityLink kind="costCalculation" id={row.id} code={row.code} />
                  </td>
                  <td>{row.industrialCostVersionLabel}</td>
                  <td>{formatDate(row.costReferenceDate)}</td>
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
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => setPoliticaPara(row)}
                      >
                        Usar política
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

      {politicaPara && (
        <UsePricingPolicyDialog
          productId={productId}
          calculationId={politicaPara.id}
          calculationCode={politicaPara.code}
          saving={busy}
          onCancel={() => setPoliticaPara(null)}
          onApply={(pricingPolicyVersionId) => {
            const calculationId = politicaPara.id;
            setPoliticaPara(null);
            void run(async () => {
              const pricing = await applyPricingPolicyToProduct(
                productId,
                pricingPolicyVersionId,
                calculationId,
              );
              navigate(`/gestao/precificacao/${pricing.id}`);
            });
          }}
        />
      )}

      <ConfirmDialog
        open={confirmarSalvar}
        title="Salvar este cálculo?"
        confirmLabel="Salvar"
        cancelLabel="Cancelar"
        confirmTone="accent"
        message={
          <>
            <p>
              Será criado um registro imutável com a data de referência{" "}
              <b>{formatDate(referenceDate)}</b> e as premissas desta estrutura. Precificações
              podem citá-lo como base econômica, e por isso ele não é reescrito depois.
            </p>
            {result && (
              <p>
                Custo total <b>{result.totalIndustrialCost ? formatBRL(result.totalIndustrialCost) : "—"}</b>{" "}
                · por unidade{" "}
                <b>{result.costPerUnit ? formatUnitCost(result.costPerUnit) : "—"}</b>.
              </p>
            )}
          </>
        }
        onCancel={() => setConfirmarSalvar(false)}
        onConfirm={() => {
          setConfirmarSalvar(false);
          void salvar();
        }}
      />

      <ConfirmDialog
        open={confirmarIncompleto}
        title="Congelar um custo incompleto?"
        confirmLabel="Salvar assim mesmo"
        cancelLabel="Voltar e completar"
        confirmTone="accent"
        message={
          <>
            <p>
              Este cálculo vira a base econômica do produto: é dele que o CMV e a precificação
              passam a falar. Salvo incompleto, o custo total continua sem existir — o que aparece
              é só o subtotal conhecido.
            </p>
            <p>O que está em aberto:</p>
            <ul className="confirm-dialog__list">
              {(result?.warnings ?? []).map((warning, index) => (
                <li key={`${warning.code}-${index}`}>{warning.message}</li>
              ))}
            </ul>
          </>
        }
        onCancel={() => setConfirmarIncompleto(false)}
        onConfirm={() => {
          setConfirmarIncompleto(false);
          void salvar();
        }}
      />
    </>
  );
}
