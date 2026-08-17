import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectDTO } from "@veridi/shared";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRODUCT_LIFECYCLE_LABELS,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { prepareTechnicalProduct } from "../../lib/projects-api";

/**
 * Custo e precificação dentro do projeto.
 *
 * Antes desta capacidade o produto só nascia na aprovação — e sem produto
 * não havia formulação, custo nem preço para embasar a proposta. Preparar o
 * produto TÉCNICO destrava a engenharia sem antecipar decisão comercial: o
 * projeto continua no mesmo status, e é o MESMO produto que a aprovação
 * promove depois.
 */
export function ProjectCostingSection({
  project,
  canEdit,
  onChanged,
}: {
  project: ProjectDTO;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [unitCode, setUnitCode] = useState("un");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const costing = project.costing;
  const preparable = project.status !== "CANCELLED" && project.status !== "APPROVED";

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      await prepareTechnicalProduct(project.id, { finishedUnitCode: unitCode.trim() });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao preparar o produto técnico");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSection
      title="Custo e precificação"
      subtitle="Formulação, estrutura de custos, cálculo e preço vivem no produto — o projeto acompanha a cadeia."
    >
      {error && <p className="form-alert">{error}</p>}

      {!costing ? (
        <>
          <p className="field__hint">Produto técnico ainda não preparado.</p>
          {canEdit && preparable && (
            <>
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="technical-unit">Unidade do produto acabado</label>
                  <input
                    id="technical-unit"
                    type="text"
                    value={unitCode}
                    onChange={(event) => setUnitCode(event.target.value)}
                  />
                  <span className="field__hint">
                    Nunca inventada a partir do brief — informe a unidade que o produto usa.
                  </span>
                </div>
              </div>
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy || !unitCode.trim()}
                  onClick={() => void prepare()}
                >
                  Preparar produto técnico
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <dl className="definition-list">
            <dt>Produto</dt>
            <dd>
              <span className="code">{costing.productCode}</span> {costing.productName}{" "}
              <span
                className={
                  costing.lifecycle === "APPROVED" ? "badge badge--active" : "badge badge--warn"
                }
              >
                {PRODUCT_LIFECYCLE_LABELS[costing.lifecycle]}
              </span>
              {!costing.productActive && <span className="badge badge--inactive"> Inativo</span>}
            </dd>
            <dt>Formulação</dt>
            <dd>
              {costing.formulationVersionNumber
                ? `V${costing.formulationVersionNumber} (${costing.formulationStatus === "ACTIVE" ? "ativa" : "rascunho"})`
                : "—"}
            </dd>
            <dt>Estrutura de custos</dt>
            <dd>{costing.industrialCostVersionLabel ?? "—"}</dd>
            <dt>Último cálculo</dt>
            <dd>
              {costing.calculationCode ?? "—"}
              {costing.calculationQuality && (
                <span className="field__hint">
                  {" "}
                  {INDUSTRIAL_COST_QUALITY_LABELS[costing.calculationQuality]}
                </span>
              )}
            </dd>
            <dt>Data de referência do custo</dt>
            <dd>
              {costing.costReferenceDate
                ? new Date(costing.costReferenceDate).toLocaleDateString("pt-BR")
                : "—"}
            </dd>
            <dt>Precificação ativa</dt>
            <dd>
              {costing.pricingLabel
                ? `${costing.pricingLabel} · ${costing.pricingTierCount} ${costing.pricingTierCount === 1 ? "faixa" : "faixas"}`
                : "Sem precificação ativa"}
            </dd>
          </dl>

          <div className="line-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() =>
                // Identidade, não texto: busca aproximada podia trazer mais de
                // um produto ou esbarrar no filtro da visita anterior.
                navigate(
                  `/cadastros/produtos?productId=${costing.productId}&open=${costing.productId}`,
                )
              }
            >
              Abrir produto
            </button>
            {costing.formulationVersionId && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() =>
                  navigate(
                    `/producao/formulacoes/${costing.productId}/versoes/${costing.formulationVersionId}`,
                  )
                }
              >
                Abrir formulação
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => navigate(`/produtos/${costing.productId}/custos`)}
            >
              Abrir custos
            </button>
            {costing.pricingVersionId && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/gestao/precificacao/${costing.pricingVersionId}`)}
              >
                Abrir precificação
              </button>
            )}
          </div>

          {costing.lifecycle === "DEVELOPMENT" && (
            <p className="field__hint">
              Produto em desenvolvimento: serve para engenharia e custeio, mas ainda não entra em
              pedido, produção comercial, expedição ou faturamento. A aprovação do projeto promove
              este mesmo produto.
            </p>
          )}
        </>
      )}
    </FormSection>
  );
}
