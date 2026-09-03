import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { ProductionOrderCostDTO } from "@veridi/shared";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  REALIZED_COST_STATUS_LABELS,
} from "@veridi/shared";
import { PrintSection, PrintTable, formatPrintDateTime } from "../../print/PrintLayout";
import { PrintSheet } from "../../print/PrintSheet";
import { formatUnitCost } from "../../components/CostBreakdown";
import { formatBRL } from "../../lib/currency";
import { getProductionOrderCost } from "../../lib/cost-calculation-api";

/**
 * Custo industrial de uma produção, em documento SEPARADO.
 *
 * A Ordem de Produção impressa (R.PRO.002) é documento controlado de chão de
 * fábrica: custo não entra lá. Aqui o papel diz exatamente o que é —
 * materiais realizados somados a custos industriais PADRÃO aplicados, nunca
 * "horas reais", que ninguém mediu.
 */
export function ProductionCostPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [cost, setCost] = useState<ProductionOrderCostDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getProductionOrderCost(id)
      .then(setCost)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o documento"),
      );
  }, [id]);

  if (error) {
    return (
      <div className="print-screen">
        <article className="print-doc">
          <p className="form-alert" role="alert">{error}</p>
        </article>
      </div>
    );
  }
  if (!cost) return <div className="print-screen">Carregando…</div>;

  const partial = cost.totalIndustrialCost === null;

  return (
    <PrintSheet
      sheetCode={cost.productionOrderCode}
      title="Custo industrial da produção"
      subtitle={`${INDUSTRIAL_COST_QUALITY_LABELS[cost.quality]} · ${REALIZED_COST_STATUS_LABELS[cost.status]}`}
      backTo={`/producao/ordens/${cost.productionOrderId}`}
      meta={[
        { label: "Produto", value: `${cost.productCode} — ${cost.productName}` },
        {
          label: "Formulação",
          value: cost.formulationVersionNumber ? `V${cost.formulationVersionNumber}` : "—",
        },
        { label: "Estrutura de custos", value: cost.industrialCostVersionLabel ?? "—" },
        {
          label: "Produzido",
          value: `${cost.producedQuantity} ${cost.outputUnitCode}`,
        },
        { label: "Proporção aplicada", value: cost.allocationFactor ?? "—" },
        {
          label: "Congelado em",
          value: cost.snapshotCreatedAt ? formatPrintDateTime(cost.snapshotCreatedAt) : "—",
        },
      ]}
    >
      <p className="print-doc__notice">
        {cost.hybrid
          ? "Híbrido: materiais realizados + custos industriais padrão aplicados. As horas de operador, de máquina e o consumo de energia não são medidos — são premissas da estrutura de custos."
          : "Materiais realizados. Os custos industriais adicionais dependem de estrutura de custos vinculada."}
      </p>
      {partial && (
        <p className="print-doc__notice">
          Cálculo parcial — existem custos não informados. O valor apresentado é o subtotal
          conhecido.
        </p>
      )}

      <PrintSection title="Materiais realizados">
        <PrintTable
          columns={["Item", "Lote", "Quantidade", "Consumido em", "Custo unitário", "Subtotal"]}
          isEmpty={cost.materials.length === 0}
          emptyMessage="Nenhum consumo registrado."
        >
          {cost.materials.map((material) => (
            <tr key={material.consumptionId}>
              <td>
                {material.itemCode} — {material.itemName}
              </td>
              <td>{material.lotCode ?? "—"}</td>
              <td className="is-number">
                {material.quantity} {material.unitCode}
              </td>
              <td>{formatPrintDateTime(material.consumedAt)}</td>
              <td className="is-number">
                {material.customerSupplied ? "Material do cliente" : formatUnitCost(material.unitCost)}
              </td>
              <td className="is-number">
                {material.subtotal === null ? "—" : formatBRL(material.subtotal)}
              </td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Custos industriais padrão aplicados">
        <PrintTable
          columns={["Componente", "Tipo", "Quantidade aplicada", "Tarifa", "Subtotal"]}
          isEmpty={cost.standardApplied.length === 0 && cost.standardAppliedManual.length === 0}
          emptyMessage="Sem estrutura de custos vinculada — custos industriais adicionais não estruturados."
        >
          <>
            {cost.standardApplied.map((resource) => (
              <tr key={resource.resourceId}>
                <td>
                  {resource.resourceCode} — {resource.resourceName}
                </td>
                <td>{INDUSTRIAL_RESOURCE_TYPE_LABELS[resource.resourceType]}</td>
                <td className="is-number">
                  {resource.quantity} {INDUSTRIAL_RATE_UOM_LABELS[resource.quantityUom]}
                </td>
                <td className="is-number">
                  {resource.rateValue === null ? "—" : formatBRL(resource.rateValue)}
                </td>
                <td className="is-number">
                  {resource.subtotal === null ? "—" : formatBRL(resource.subtotal)}
                </td>
              </tr>
            ))}
            {cost.standardAppliedManual.map((line) => (
              <tr key={line.lineId}>
                <td>{line.description}</td>
                <td>Premissa</td>
                <td className="is-number">{line.computedUnits ?? "—"}</td>
                <td className="is-number">
                  {line.rateValue === null ? "—" : formatBRL(line.rateValue)}
                </td>
                <td className="is-number">
                  {line.subtotal === null ? "—" : formatBRL(line.subtotal)}
                </td>
              </tr>
            ))}
          </>
        </PrintTable>
      </PrintSection>

      <PrintSection title="Resultado">
        <PrintTable columns={["Componente", "Valor"]} isEmpty={false} emptyMessage="">
          <tr>
            <td>Materiais realizados</td>
            <td className="is-number">{formatBRL(cost.actualMaterialCostKnown)}</td>
          </tr>
          <tr>
            <td>Custos padrão aplicados</td>
            <td className="is-number">{formatBRL(cost.standardAppliedCostKnown)}</td>
          </tr>
          <tr>
            <td>{partial ? "Subtotal conhecido" : "Custo industrial da produção"}</td>
            <td className="is-number">
              {partial ? formatBRL(cost.knownSubtotal) : formatBRL(cost.totalIndustrialCost)}
            </td>
          </tr>
          <tr>
            <td>Custo por unidade produzida</td>
            <td className="is-number">{formatUnitCost(cost.costPerProducedUnit)}</td>
          </tr>
        </PrintTable>
      </PrintSection>

      {cost.warnings.length > 0 && (
        <PrintSection title="Observações do cálculo">
          <PrintTable columns={["Observação"]} isEmpty={false} emptyMessage="">
            {cost.warnings.map((warning) => (
              <tr key={`${warning.code}-${warning.message}`}>
                <td>{warning.message}</td>
              </tr>
            ))}
          </PrintTable>
        </PrintSection>
      )}
    </PrintSheet>
  );
}
