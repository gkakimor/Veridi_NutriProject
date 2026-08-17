import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { IndustrialCostCalculationSnapshotDTO } from "@veridi/shared";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { EntityLink } from "../../components/EntityLink";
import { CostBreakdown, CostQualityBadge } from "../../components/CostBreakdown";
import { FormSection } from "../../components/FormSection";
import { getIndustrialCostCalculation } from "../../lib/cost-calculation-api";

/**
 * Cálculo salvo — somente leitura.
 *
 * Nada aqui é recalculado: o documento mostra as referências de custo do
 * momento em que a análise foi feita, mesmo que as compras de hoje já
 * contem outra história.
 */
export function CostCalculationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [calculation, setCalculation] = useState<IndustrialCostCalculationSnapshotDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getIndustrialCostCalculation(id)
      .then(setCalculation)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o cálculo"),
      );
  }, [id]);

  if (error) return <p className="form-alert">{error}</p>;
  if (!calculation) return <p>Carregando…</p>;

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Cadastros / Produtos / Custos industriais / Cálculo</div>
          <div className="doc-title">
            <h1>
              <EntityLink kind="product" id={calculation.productId} code={calculation.productCode} />{" "}
              · {calculation.productName}
            </h1>
            <span className="code">{calculation.code}</span>
            <CostQualityBadge quality={calculation.quality} />
            {calculation.structureStatusAtCalculation === "DRAFT" && (
              <span className="badge badge--warn">Estrutura em rascunho</span>
            )}
          </div>
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/print/calculo-custo/${calculation.id}`)}
          >
            Imprimir / Salvar PDF
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate(`/produtos/${calculation.productId}/custos`)}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
      <ProductRelatedLinks productId={calculation.productId} current="costs" />
        <FormSection title="Contexto do cálculo">
          <dl className="definition-list">
            <dt>Cliente</dt>
            <dd>{calculation.customerName ?? "—"}</dd>
            <dt>Estrutura de custos</dt>
            <dd>{calculation.industrialCostVersionLabel}</dd>
            <dt>Formulação</dt>
            <dd>V{calculation.formulationVersionNumber}</dd>
            <dt>Base de referência</dt>
            <dd>
              {calculation.referenceOutputQuantity} {calculation.referenceOutputUomCode}
            </dd>
            <dt>Data de referência de custo</dt>
            <dd>{new Date(calculation.costReferenceDate).toLocaleDateString("pt-BR")}</dd>
            <dt>Calculado em</dt>
            <dd>
              {new Date(calculation.calculatedAt).toLocaleString("pt-BR")} —{" "}
              {calculation.calculatedByName ?? "—"}
            </dd>
          </dl>
        </FormSection>

        <FormSection
          title="Detalhamento"
          subtitle="Resultado congelado: alterações posteriores em compras, tarifas ou estrutura não mudam este documento."
        >
          <CostBreakdown result={calculation} />
        </FormSection>
      </div>
    </>
  );
}
