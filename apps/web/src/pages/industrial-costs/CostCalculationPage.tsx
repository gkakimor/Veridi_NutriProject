import { formatQuantity } from "../../lib/quantity";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { IndustrialCostCalculationSnapshotDTO } from "@veridi/shared";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { EntityLink } from "../../components/EntityLink";
import { CostBreakdown, CostQualityBadge } from "../../components/CostBreakdown";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { FormSection } from "../../components/FormSection";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { getIndustrialCostCalculation } from "../../lib/cost-calculation-api";
import { formatDate } from "../../lib/dates";

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

  if (error) return <p className="form-alert" role="alert">{error}</p>;
  if (!calculation) return <p>Carregando…</p>;

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Produtos", href: "/cadastros/produtos" }, { label: "Cálculo de custo" }]} />
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
          {/* Aviso que não leva a lugar nenhum vira beco: a ativação acontece
              na estrutura, e é de lá que este cálculo passa a valer. */}
          {calculation.structureStatusAtCalculation === "DRAFT" && (
            <p className="field__hint">
              Esta estrutura ainda é rascunho — tarifas e premissas podem mudar até a ativação.{" "}
              <Link to={`/produtos/${calculation.productId}/custos`}>
                Abrir a estrutura de custos para ativar
              </Link>
              .
            </p>
          )}
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/print/calculo-custo/${calculation.id}`)}
          >
            Imprimir / Salvar PDF
          </button>
          <Link
            className="btn btn--ghost"
            to={`/produtos/${calculation.productId}/custos`}
          >
            ← Voltar
          </Link>
        </div>
      </div>

      <div className="doc-body">
      <ProductRelatedLinks productId={calculation.productId} current="calculation" />

        {/* A tela do CMV explica como o custo de uma quantidade é somado.
            Aqui a pergunta é outra: por que este documento não muda mais, e o
            que a precificação está citando quando aponta para ele. */}
        <ContextHelp topic={helpTopics["calculo.comoFunciona"]} />

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
              {formatQuantity(calculation.referenceOutputQuantity)} {calculation.referenceOutputUomCode}
            </dd>
            <dt>Data de referência de custo</dt>
            <dd>{formatDate(calculation.costReferenceDate)}</dd>
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
          <CostBreakdown
            result={calculation}
            productId={calculation.productId}
            structureLocked={calculation.structureStatus !== "DRAFT"}
          />
        </FormSection>
      </div>
    </>
  );
}
