import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProductIndustrialCostResponse, ProductPricingResponse } from "@veridi/shared";
import { INDUSTRIAL_COST_VERSION_STATUS_LABELS } from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { getProductIndustrialCosts } from "../../lib/industrial-costs-api";
import { getProductPricing } from "../../lib/pricing-api";

/**
 * Resumo da estrutura de custos dentro do cadastro do produto.
 *
 * Só leitura e um caminho: a estrutura é documento versionado e vive em
 * página própria. Nenhum total aparece aqui — o custo industrial
 * consolidado é calculado em outra etapa.
 */
export function ProductIndustrialCostSummary({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductIndustrialCostResponse | null>(null);
  const [pricing, setPricing] = useState<ProductPricingResponse | null>(null);

  useEffect(() => {
    getProductIndustrialCosts(productId)
      .then(setData)
      .catch(() => setData(null));
    // Sem permissão comercial a chamada é recusada — o resumo simplesmente
    // não aparece, e nenhum preço vaza para quem não precisa dele.
    getProductPricing(productId)
      .then(setPricing)
      .catch(() => setPricing(null));
  }, [productId]);

  const current = data?.current ?? null;
  const activePricing = pricing?.current ?? null;

  return (
    <FormSection
      title="Custos industriais"
      subtitle="Estrutura versionada de premissas de custo — o custo consolidado é calculado separadamente."
    >
      {current ? (
        <dl className="definition-list">
          <dt>Estrutura ativa</dt>
          <dd className="is-code">{current.label}</dd>
          <dt>Formulação utilizada</dt>
          <dd>V{current.formulationVersionNumber}</dd>
          <dt>Base de referência</dt>
          <dd>
            {current.referenceOutputQuantity} {current.referenceOutputUomCode}
          </dd>
          <dt>Situação</dt>
          <dd>
            {INDUSTRIAL_COST_VERSION_STATUS_LABELS[current.status]} ·{" "}
            {current.complete ? "Completa" : "Com pendências"}
          </dd>
        </dl>
      ) : (
        <p className="field__hint">
          {data?.draft
            ? `Existe um rascunho de estrutura (${data.draft.label}) ainda não ativado.`
            : "Este produto ainda não tem estrutura de custos."}
        </p>
      )}

      {pricing && (
        <p className="field__hint">
          {activePricing
            ? `Precificação ativa: ${activePricing.label} · ${activePricing.tiers.length} ${activePricing.tiers.length === 1 ? "faixa" : "faixas"}.`
            : "Sem precificação ativa."}
        </p>
      )}

      <div className="line-actions">
        {activePricing && (
          <Link
            to={`/gestao/precificacao/${activePricing.id}`}
            className="btn btn--ghost btn--sm"
          >
            Abrir precificação
          </Link>
        )}
        <Link to={`/produtos/${productId}/custos`} className="btn btn--secondary btn--sm">
          {current || data?.draft ? "Abrir estrutura" : "Criar estrutura de custos"}
        </Link>
      </div>
    </FormSection>
  );
}
