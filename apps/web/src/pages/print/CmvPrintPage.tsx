import { formatQuantity } from "../../lib/quantity";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { CmvGroup, ProductCmvResponse } from "@veridi/shared";
import {
  CMV_GROUP_LABELS,
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
} from "@veridi/shared";
import { PrintSection, PrintTable, formatPrintDate } from "../../print/PrintLayout";
import { PrintSheet } from "../../print/PrintSheet";
import { formatBRL, formatUnitPriceBRL } from "../../lib/currency";
import { getProductCmv } from "../../lib/product-cmv-api";

/**
 * CMV impresso — a base econômica de uma quantidade.
 *
 * Imprime a BASE CONGELADA e nada mais. A simulação "com os dados de hoje"
 * existe para orientar quem está definindo o produto na tela, e papel
 * circula: um número provisório em PDF vira, dois dias depois, o custo que
 * alguém usou para fechar preço. O que sai daqui é o que se consegue
 * reproduzir — cálculo salvo, com código e data.
 *
 * Custo parcial sai dizendo que é parcial: subtotal conhecido nunca se
 * disfarça de total.
 */
const GROUP_ORDER: CmvGroup[] = [
  "FORMULA_MATERIAL",
  "PACKAGING",
  "CUSTOMER_SUPPLIED",
  "INDUSTRIAL_RESOURCE",
  "OVERHEAD",
];

/** Unidade de recurso vem como enum de tarifa ("HOUR") — no papel vira hora. */
function describeUnit(unitCode: string | null): string {
  if (!unitCode) return "";
  const tarifa =
    INDUSTRIAL_RATE_UOM_LABELS[unitCode as keyof typeof INDUSTRIAL_RATE_UOM_LABELS];
  return tarifa ?? unitCode;
}

function describeOrigin(costSource: string | null, customerSupplied: boolean): string {
  if (customerSupplied) return "Fornecido pelo cliente";
  if (!costSource) return "—";
  const label = (INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS as Record<string, string>)[costSource];
  return label ?? costSource;
}

export function CmvPrintPage() {
  const { productId } = useParams<{ productId: string }>();
  const [params] = useSearchParams();
  const quantity = params.get("quantity") ?? "1000";
  const referenceDate = params.get("referenceDate") ?? new Date().toISOString().slice(0, 10);

  const [data, setData] = useState<ProductCmvResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    getProductCmv(productId, { quantity, referenceDate })
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o CMV"),
      );
  }, [productId, quantity, referenceDate]);

  if (error) {
    return (
      <div className="print-screen">
        <article className="print-doc">
          <p className="form-alert" role="alert">{error}</p>
        </article>
      </div>
    );
  }
  if (!data) return <div className="print-screen">Carregando…</div>;

  const simulation = data.simulation;
  const parcial = simulation !== null && simulation.totalCost === null;
  const voltar = `/produtos/${productId}/cmv?quantity=${quantity}&referenceDate=${referenceDate}`;

  return (
    <PrintSheet
      sheetCode={data.calculationCode ?? "CMV"}
      title="CMV — custo da mercadoria vendida"
      subtitle={simulation ? INDUSTRIAL_COST_QUALITY_LABELS[simulation.quality] : "Sem base econômica"}
      backTo={voltar}
      meta={[
        { label: "Produto", value: `${data.productCode} — ${data.productName}` },
        { label: "Cliente", value: data.customerName ?? "—" },
        { label: "Quantidade", value: `${quantity} ${data.outputUomCode}` },
        { label: "Data de referência", value: formatPrintDate(referenceDate) },
        {
          label: "Formulação usada",
          value: data.basisFormulationVersionNumber
            ? `V${data.basisFormulationVersionNumber}`
            : "—",
        },
        { label: "Estrutura de custos", value: data.industrialCostVersionLabel ?? "—" },
        {
          label: "Base de produção",
          value: data.referenceOutputQuantity
            ? `${formatQuantity(data.referenceOutputQuantity)} ${data.referenceOutputUomCode ?? ""}`
            : "—",
        },
        {
          label: "Cálculo de referência",
          value: data.calculationCode
            ? `${data.calculationCode} · ${formatPrintDate(data.calculationReferenceDate)}`
            : "—",
        },
      ]}
    >
      {/* O papel precisa dizer de qual retrato ele fala: sem isto, um PDF de
          três semanas atrás é indistinguível do custo de hoje. */}
      <p className="print-doc__notice">
        Base econômica congelada. Os valores descrevem os documentos citados acima, não o estado
        atual do cadastro.
      </p>

      {data.unavailableReason && <p className="print-doc__notice">{data.unavailableReason}</p>}

      {parcial && (
        <p className="print-doc__notice">
          CMV parcial — há custos não informados. O valor apresentado é o subtotal conhecido e não
          representa o custo total.
        </p>
      )}

      {data.basisFormulationVersionNumber !== null &&
        data.formulationVersionNumber !== null &&
        data.basisFormulationVersionNumber !== data.formulationVersionNumber && (
          <p className="print-doc__notice">
            Este CMV descreve a formulação V{data.basisFormulationVersionNumber}; a formulação
            ativa do produto é V{data.formulationVersionNumber}.
          </p>
        )}

      {simulation &&
        GROUP_ORDER.map((group) => {
          const rows = simulation.components.filter((component) => component.group === group);
          if (rows.length === 0) return null;
          return (
            <PrintSection title={CMV_GROUP_LABELS[group]} key={group}>
              <PrintTable
                columns={["Item", "Quantidade", "Origem do custo", "Custo unitário", "Subtotal"]}
                isEmpty={false}
                emptyMessage=""
              >
                {rows.map((component, index) => (
                  <tr key={`${group}-${component.code}-${index}`}>
                    {/* Linha que não é item de estoque tem `code` técnico —
                        o modo de rateio, o tipo do recurso. Imprimir isso
                        colocava "FIXED_PER_BATCH" ao lado do nome. */}
                    <td>
                      {component.itemId ? `${component.code} — ${component.name}` : component.name}
                    </td>
                    <td className="is-number">
                      {component.requiredQuantity
                        ? `${formatQuantity(component.requiredQuantity)} ${describeUnit(component.unitCode)}`
                        : "—"}
                    </td>
                    <td>{describeOrigin(component.costSource, component.customerSupplied)}</td>
                    <td className="is-number">
                      {component.unitCost ? formatBRL(component.unitCost) : "—"}
                    </td>
                    <td className="is-number">
                      {component.totalCost ? formatBRL(component.totalCost) : "—"}
                    </td>
                  </tr>
                ))}
              </PrintTable>
            </PrintSection>
          );
        })}

      {simulation && (
        <PrintSection title="Resultado">
          <PrintTable columns={["Medida", "Valor"]} isEmpty={false} emptyMessage="">
            <tr>
              <td>Quantidade simulada</td>
              <td className="is-number">
                {formatQuantity(simulation.quantity)} {simulation.uomCode}
              </td>
            </tr>
            <tr>
              <td>Lotes de referência</td>
              <td className="is-number">{simulation.batchCount}</td>
            </tr>
            <tr>
              <td>{parcial ? "Subtotal conhecido" : "CMV total"}</td>
              <td className="is-number">
                {formatBRL(parcial ? simulation.knownSubtotal : simulation.totalCost!)}
              </td>
            </tr>
            <tr>
              <td>CMV por unidade</td>
              <td className="is-number">
                {simulation.costPerUnit ? formatBRL(simulation.costPerUnit) : "—"}
              </td>
            </tr>
            <tr>
              <td>CMV por 1.000 unidades</td>
              <td className="is-number">
                {simulation.costPer1000 ? formatBRL(simulation.costPer1000) : "—"}
              </td>
            </tr>
          </PrintTable>
        </PrintSection>
      )}

      {/* Preço só sai no papel para quem a API deixou ver: o gate é o mesmo
          da tela, e imprimir não é uma segunda porta. */}
      {data.pricing && (
        <PrintSection title="Precificação vigente">
          <PrintTable columns={["Item", "Valor"]} isEmpty={false} emptyMessage="">
            <tr>
              <td>Versão</td>
              <td>{data.pricing.pricingVersionLabel}</td>
            </tr>
            <tr>
              <td>Faixa desta quantidade</td>
              <td className="is-number">
                {data.pricing.tierQuantity ?? "Não há faixa para esta quantidade exata"}
              </td>
            </tr>
            <tr>
              <td>Preço unitário</td>
              <td className="is-number">
                {data.pricing.unitPrice ? formatUnitPriceBRL(data.pricing.unitPrice) : "—"}
              </td>
            </tr>
          </PrintTable>
        </PrintSection>
      )}

      {simulation && simulation.warnings.length > 0 && (
        <PrintSection title="Observações do cálculo">
          <PrintTable columns={["Observação"]} isEmpty={false} emptyMessage="">
            {simulation.warnings.map((warning, index) => (
              <tr key={`${warning.code}-${index}`}>
                <td>{warning.message}</td>
              </tr>
            ))}
          </PrintTable>
        </PrintSection>
      )}
    </PrintSheet>
  );
}
