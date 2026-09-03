import { useEffect, useMemo, useState } from "react";
import type { PricingPolicyPreviewDTO, PricingPolicySummaryDTO } from "@veridi/shared";
import { INDUSTRIAL_COST_QUALITY_LABELS } from "@veridi/shared";
import { listPricingPolicies, previewPricingPolicy } from "../../lib/cost-pricing-templates-api";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { formatBRL } from "../../lib/currency";
import { formatPercent } from "../../lib/percent";
import { formatDate } from "../../lib/dates";

/**
 * Escolher uma política de precificação para um cálculo de custo salvo.
 *
 * A política guarda faixas, margem e comissão — nunca preço. Por isso a
 * prévia é obrigatória e é calculada pelo motor sobre ESTE CALC: a mesma
 * política em dois produtos dá preços diferentes, e quem aplica precisa ver
 * o número antes, não depois. Nada é gravado até confirmar.
 */

interface Props {
  productId: string;
  calculationId: string;
  calculationCode: string;
  onCancel: () => void;
  onApply: (pricingPolicyVersionId: string) => void;
  saving: boolean;
}

export function UsePricingPolicyDialog({
  productId,
  calculationId,
  calculationCode,
  onCancel,
  onApply,
  saving,
}: Props) {
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [policies, setPolicies] = useState<PricingPolicySummaryDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState<PricingPolicySummaryDTO | null>(null);
  const [preview, setPreview] = useState<PricingPolicyPreviewDTO | null>(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setTermo(busca), 300);
    return () => clearTimeout(handle);
  }, [busca]);

  useEffect(() => {
    setCarregando(true);
    listPricingPolicies(termo ? { search: termo, pageSize: 30 } : { pageSize: 30 })
      .then((result) => setPolicies(result.policies))
      .catch((err: unknown) =>
        setErro(err instanceof Error ? err.message : "Falha ao carregar a biblioteca"),
      )
      .finally(() => setCarregando(false));
  }, [termo]);

  // Só política revisada precifica um produto.
  const disponiveis = useMemo(
    () => policies.filter((policy) => policy.activeVersionId !== null),
    [policies],
  );

  function revisar(policy: PricingPolicySummaryDTO) {
    if (!policy.activeVersionId) return;
    setEscolhida(policy);
    setPreview(null);
    setErro(null);
    setCarregandoPreview(true);
    previewPricingPolicy(productId, policy.activeVersionId, calculationId)
      .then(setPreview)
      .catch((err: unknown) =>
        setErro(err instanceof Error ? err.message : "Falha ao calcular a prévia"),
      )
      .finally(() => setCarregandoPreview(false));
  }

  const semPreco = preview?.tiers.some((tier) => tier.suggestedUnitPrice === null) ?? false;

  return (
    <FullWorkspaceModal
      open
      onClose={onCancel}
      crumb="Gestão / Políticas de Precificação"
      crumbActive="Usar política"
      title="Usar política de precificação"
      footer={
        <>
          {escolhida && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setEscolhida(null);
                setPreview(null);
              }}
            >
              ← Escolher outra
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
          {escolhida?.activeVersionId && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving || carregandoPreview}
              onClick={() => onApply(escolhida.activeVersionId!)}
            >
              Aplicar e criar precificação
            </button>
          )}
        </>
      }
    >
      <div>
        {erro && <p className="form-alert" role="alert">{erro}</p>}

        {!escolhida ? (
          <>
            <p className="field__hint">
              Base de custo: <code>{calculationCode}</code>. O preço de cada faixa sai do motor de
              precificação sobre este cálculo.
            </p>

            <div className="field">
              <label htmlFor="tpp-busca">Buscar política</label>
              <input
                id="tpp-busca"
                type="search"
                autoFocus
                placeholder="Código TPP ou nome…"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
              />
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Nome</th>
                    <th>Versão</th>
                    <th>Faixas</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {disponiveis.map((policy) => (
                    <tr key={policy.id}>
                      <td>
                        <code>{policy.code}</code>
                      </td>
                      <td>{policy.name}</td>
                      <td>V{policy.activeVersionNumber}</td>
                      <td>{policy.tierQuantities.join(" / ")}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => revisar(policy)}
                        >
                          Ver prévia
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!carregando && disponiveis.length === 0 && (
                    <tr>
                      <td colSpan={5} className="table__empty">
                        {termo
                          ? "Nenhuma política ativa encontrada para esta busca."
                          : "A biblioteca ainda não tem nenhuma política ativa."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : carregandoPreview ? (
          <p className="field__hint">Calculando a prévia para este produto…</p>
        ) : preview ? (
          <>
            <dl className="definition-list">
              <dt>Política</dt>
              <dd>
                <code>{preview.policyCode}</code> · {preview.policyVersionLabel}
              </dd>
              <dt>Produto</dt>
              <dd>{preview.productCode}</dd>
              <dt>Base de custo</dt>
              <dd>
                <code>{preview.calculationCode}</code> · {formatDate(preview.costReferenceDate)} ·{" "}
                {INDUSTRIAL_COST_QUALITY_LABELS[
                  preview.costQuality as keyof typeof INDUSTRIAL_COST_QUALITY_LABELS
                ] ?? preview.costQuality}
              </dd>
            </dl>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th className="is-numeric">Quantidade</th>
                    <th>Unidade</th>
                    <th className="is-numeric">Margem alvo</th>
                    <th className="is-numeric">Comissão</th>
                    <th className="is-numeric">Custo/unidade</th>
                    <th className="is-numeric">Preço calculado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.tiers.map((tier) => (
                    <tr key={`${tier.quantity}-${tier.uomCode}`}>
                      <td className="is-numeric">{tier.quantity}</td>
                      <td>{tier.uomCode}</td>
                      <td className="is-numeric">
                        {formatPercent(tier.targetContributionMarginPercent)}
                      </td>
                      <td className="is-numeric">{formatPercent(tier.commissionPercent)}</td>
                      <td className="is-numeric">
                        {tier.costPerUnit === null ? "—" : formatBRL(tier.costPerUnit)}
                      </td>
                      <td className="is-numeric">
                        {tier.suggestedUnitPrice === null ? (
                          <span className="badge badge--warn">{tier.warning ?? "Sem preço"}</span>
                        ) : (
                          formatBRL(tier.suggestedUnitPrice)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {semPreco && (
              <p className="form-alert" role="status">
                Alguma faixa não produziu preço porque o custo deste cálculo está incompleto. A
                precificação nasce mesmo assim, mas a faixa fica sem preço até o custo fechar.
              </p>
            )}

            <p className="field__hint">
              Estes preços são desta aplicação. A política guarda margem e comissão; recalcular
              sobre outro cálculo de custo dá outros preços — e nada é gravado até você confirmar.
            </p>
          </>
        ) : null}
      </div>
    </FullWorkspaceModal>
  );
}
