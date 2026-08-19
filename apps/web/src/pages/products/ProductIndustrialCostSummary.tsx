import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ProductCmvResponse,
  ProductIndustrialCostResponse,
  ProductPricingResponse,
} from "@veridi/shared";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_COST_VERSION_STATUS_LABELS,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { IndustrialCostPendencies } from "../../components/IndustrialCostPendencies";
import { getProductIndustrialCosts } from "../../lib/industrial-costs-api";
import { getProductPricing } from "../../lib/pricing-api";
import { getProductCmv } from "../../lib/product-cmv-api";
import { formatBRL } from "../../lib/currency";
import { formatDate } from "../../lib/dates";

/**
 * CMV e precificação dentro do cadastro do produto.
 *
 * Só leitura, e um resumo — não uma segunda tela de CMV. A quantidade usada
 * aqui é a BASE DE PRODUÇÃO da estrutura ativa, que é a referência que o
 * próprio documento declara; qualquer outra quantidade seria um número
 * escolhido pela tela, e a tela não escolhe premissa econômica. Simular
 * outra quantidade é o trabalho da tela de CMV, para onde a CTA leva.
 *
 * A consulta é a MESMA do CMV (`GET /products/:id/cmv`): não existe um
 * segundo caminho de cálculo com lógica própria.
 */
export function ProductIndustrialCostSummary({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductIndustrialCostResponse | null>(null);
  const [pricing, setPricing] = useState<ProductPricingResponse | null>(null);
  const [cmv, setCmv] = useState<ProductCmvResponse | null>(null);

  useEffect(() => {
    let active = true;
    getProductIndustrialCosts(productId)
      .then((result) => {
        if (!active) return;
        setData(result);
        const reference = result.current?.referenceOutputQuantity;
        if (!reference) return;
        return getProductCmv(productId, {
          quantity: reference,
          referenceDate: new Date().toISOString().slice(0, 10),
        })
          .then((value) => {
            if (active) setCmv(value);
          })
          .catch(() => {
            if (active) setCmv(null);
          });
      })
      .catch(() => {
        if (active) setData(null);
      });
    // Sem permissão comercial a chamada é recusada — o resumo simplesmente
    // não aparece, e nenhum preço vaza para quem não precisa dele.
    getProductPricing(productId)
      .then((value) => {
        if (active) setPricing(value);
      })
      .catch(() => {
        if (active) setPricing(null);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  const current = data?.current ?? null;
  /*
   * Qual versão explica a ausência de custo: a ativa quando ela mesma está
   * incompleta, senão o rascunho que ainda não foi ativado.
   */
  const pendencyVersion =
    current && !current.complete ? current : (current ? null : (data?.draft ?? null));
  const activePricing = pricing?.current ?? null;
  const simulation = cmv?.simulation ?? null;

  return (
    <FormSection
      title="CMV e precificação"
      subtitle="Quanto custa produzir este produto na base de referência, e por qual preço ele está sendo vendido."
    >
      {current ? (
        <dl className="definition-list">
          <dt>Formulação ativa</dt>
          <dd>V{current.formulationVersionNumber}</dd>
          <dt>Estrutura de custos</dt>
          <dd className="is-code">{current.label}</dd>
          <dt>Base de referência</dt>
          <dd>
            {current.referenceOutputQuantity} {current.referenceOutputUomCode}
          </dd>
          <dt>CMV de referência</dt>
          <dd>
            {simulation?.totalCost ? (
              <>
                {formatBRL(simulation.totalCost)}
                {simulation.costPerUnit && (
                  <> · {formatBRL(simulation.costPerUnit)} por unidade</>
                )}
              </>
            ) : (
              "CMV indisponível"
            )}
          </dd>
          <dt>Qualidade do custo</dt>
          <dd>
            {simulation ? INDUSTRIAL_COST_QUALITY_LABELS[simulation.quality] : "—"}
          </dd>
          <dt>Cálculo de referência</dt>
          <dd>
            {cmv?.calculationCode ? (
              <>
                <span className="code">{cmv.calculationCode}</span> ·{" "}
                {formatDate(cmv.calculationReferenceDate)}
              </>
            ) : (
              "—"
            )}
          </dd>
          <dt>Situação da estrutura</dt>
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

      {cmv?.unavailableReason && <p className="field__hint">{cmv.unavailableReason}</p>}

      {/* Sem isto o produto só dizia "CMV indisponível" e a razão ficava a
          duas telas de distância, dentro da estrutura. */}
      {pendencyVersion && (
        <IndustrialCostPendencies
          pendencies={pendencyVersion.pendencies}
          productId={productId}
        />
      )}

      {pricing && (
        <p className="field__hint">
          {activePricing
            ? `Precificação ativa: ${activePricing.label} · ${activePricing.tiers.length} ${activePricing.tiers.length === 1 ? "faixa" : "faixas"}.`
            : "Sem precificação ativa."}
        </p>
      )}

      <div className="line-actions">
        {/* Uma CTA principal: a pergunta do dia a dia é "quanto custa produzir
            X unidades", e é a tela de CMV que responde. */}
        <Link to={`/produtos/${productId}/cmv`} className="btn btn--accent btn--sm">
          Abrir CMV
        </Link>
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
