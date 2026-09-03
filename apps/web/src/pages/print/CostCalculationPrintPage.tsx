import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { IndustrialCostCalculationSnapshotDTO } from "@veridi/shared";
import {
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
} from "@veridi/shared";
import { PrintSection, PrintTable, formatPrintDate, formatPrintDateTime } from "../../print/PrintLayout";
import { PrintSheet } from "../../print/PrintSheet";
import { formatUnitCost } from "../../components/CostBreakdown";
import { formatBRL } from "../../lib/currency";
import { getIndustrialCostCalculation } from "../../lib/cost-calculation-api";
import { formatQuantity } from "../../lib/quantity";

/**
 * Cálculo de custo industrial impresso.
 *
 * Documento de análise: mostra de onde veio cada custo unitário, o que
 * ficou desconhecido e qual é a qualidade do resultado. Cálculo parcial sai
 * no papel dizendo que é parcial — subtotal conhecido nunca se disfarça de
 * total.
 */
export function CostCalculationPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [calculation, setCalculation] = useState<IndustrialCostCalculationSnapshotDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getIndustrialCostCalculation(id)
      .then(setCalculation)
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
  if (!calculation) return <div className="print-screen">Carregando…</div>;

  const partial = calculation.totalIndustrialCost === null;

  return (
    <PrintSheet
      sheetCode={calculation.code}
      title="Cálculo de custo industrial"
      subtitle={INDUSTRIAL_COST_QUALITY_LABELS[calculation.quality]}
      backTo={`/calculos-custo/${calculation.id}`}
      meta={[
        { label: "Produto", value: `${calculation.productCode} — ${calculation.productName}` },
        { label: "Cliente", value: calculation.customerName ?? "—" },
        { label: "Estrutura", value: calculation.industrialCostVersionLabel },
        { label: "Formulação", value: `V${calculation.formulationVersionNumber}` },
        {
          label: "Base de referência",
          value: `${formatQuantity(calculation.referenceOutputQuantity)} ${calculation.referenceOutputUomCode}`,
        },
        {
          label: "Data de referência de custo",
          value: formatPrintDate(calculation.costReferenceDate),
        },
        {
          label: "Calculado",
          value: `${formatPrintDateTime(calculation.calculatedAt)} — ${calculation.calculatedByName ?? "—"}`,
        },
      ]}
    >
      {partial && (
        <p className="print-doc__notice">
          Cálculo parcial — existem premissas ou custos não informados. O valor apresentado é o
          subtotal conhecido e não representa o custo industrial total.
        </p>
      )}
      {calculation.structureStatusAtCalculation === "DRAFT" && (
        <p className="print-doc__notice">
          Estrutura em rascunho no momento do cálculo: as premissas ainda podiam mudar.
        </p>
      )}

      <PrintSection title="Materiais e embalagens">
        <PrintTable
          columns={["Item", "Quantidade", "Custo unitário", "Origem", "Subtotal"]}
          isEmpty={calculation.materials.length === 0}
          emptyMessage="A formulação vinculada não tem componentes."
        >
          {calculation.materials.map((material) => (
            <tr key={material.itemId}>
              <td>
                {material.itemCode} — {material.itemName}
              </td>
              <td className="is-number">
                {formatQuantity(material.requiredQuantity)} {material.unitCode}
              </td>
              <td className="is-number">{formatUnitCost(material.unitCost)}</td>
              <td>{INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[material.costSource]}</td>
              <td className="is-number">
                {material.subtotal === null ? "—" : formatBRL(material.subtotal)}
              </td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Recursos industriais">
        <PrintTable
          columns={["Recurso", "Tipo", "Consumo", "Tarifa", "Subtotal"]}
          isEmpty={calculation.resources.length === 0}
          emptyMessage="Nenhum recurso declarado nesta estrutura."
        >
          {calculation.resources.map((resource) => (
            <tr key={resource.resourceId}>
              <td>
                {resource.resourceCode} — {resource.resourceName}
              </td>
              <td>{INDUSTRIAL_RESOURCE_TYPE_LABELS[resource.resourceType]}</td>
              <td className="is-number">
                {formatQuantity(resource.quantity)} {INDUSTRIAL_RATE_UOM_LABELS[resource.quantityUom]}
              </td>
              <td className="is-number">
                {resource.rateValue === null ? "—" : formatBRL(resource.rateValue)}
              </td>
              <td className="is-number">
                {resource.subtotal === null ? "—" : formatBRL(resource.subtotal)}
              </td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Premissas de custo">
        <PrintTable
          columns={["Descrição", "Categoria", "Base de cálculo", "Valor", "Subtotal"]}
          isEmpty={calculation.manualLines.length === 0}
          emptyMessage="Nenhuma premissa adicional registrada."
        >
          {calculation.manualLines.map((line) => (
            <tr key={line.lineId}>
              <td>{line.description}</td>
              <td>{INDUSTRIAL_COST_CATEGORY_LABELS[line.category]}</td>
              <td>
                {INDUSTRIAL_COST_BASIS_LABELS[line.calculationBasis]}
                {line.computedUnits ? ` (${line.computedUnits} cx)` : ""}
              </td>
              <td className="is-number">
                {line.rateValue === null
                  ? "—"
                  : line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST"
                    ? `${line.rateValue}%`
                    : formatBRL(line.rateValue)}
              </td>
              <td className="is-number">
                {line.subtotal === null ? "—" : formatBRL(line.subtotal)}
              </td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Resultado">
        <PrintTable columns={["Componente", "Valor"]} isEmpty={false} emptyMessage="">
          <tr>
            <td>Materiais e embalagens Veridi</td>
            <td className="is-number">{formatBRL(calculation.materialsSubtotalKnown)}</td>
          </tr>
          <tr>
            <td>Mão de obra</td>
            <td className="is-number">{formatBRL(calculation.laborSubtotalKnown)}</td>
          </tr>
          <tr>
            <td>Equipamentos</td>
            <td className="is-number">{formatBRL(calculation.equipmentSubtotalKnown)}</td>
          </tr>
          <tr>
            <td>Energia</td>
            <td className="is-number">
              {calculation.energySubtotal === null ? "—" : formatBRL(calculation.energySubtotal)}
            </td>
          </tr>
          <tr>
            <td>Embalagem secundária</td>
            <td className="is-number">
              {formatBRL(calculation.secondaryPackagingSubtotalKnown)}
            </td>
          </tr>
          <tr>
            <td>Serviços de terceiros</td>
            <td className="is-number">{formatBRL(calculation.thirdPartySubtotalKnown)}</td>
          </tr>
          <tr>
            <td>Outros custos diretos</td>
            <td className="is-number">{formatBRL(calculation.otherSubtotalKnown)}</td>
          </tr>
          <tr>
            <td>Custo industrial direto</td>
            <td className="is-number">
              {calculation.directIndustrialCost === null
                ? "—"
                : formatBRL(calculation.directIndustrialCost)}
            </td>
          </tr>
          <tr>
            <td>Overhead</td>
            <td className="is-number">{formatBRL(calculation.overheadSubtotalKnown)}</td>
          </tr>
          <tr>
            <td>{partial ? "Subtotal conhecido" : "Custo industrial total"}</td>
            <td className="is-number">
              {partial
                ? formatBRL(calculation.knownSubtotal)
                : formatBRL(calculation.totalIndustrialCost)}
            </td>
          </tr>
          <tr>
            <td>Custo por unidade</td>
            <td className="is-number">{formatUnitCost(calculation.costPerUnit)}</td>
          </tr>
          <tr>
            <td>Custo por 1.000 unidades</td>
            <td className="is-number">
              {calculation.costPer1000 === null ? "—" : formatBRL(calculation.costPer1000)}
            </td>
          </tr>
        </PrintTable>
      </PrintSection>

      {calculation.hasCustomerSuppliedMaterials && (
        <PrintSection title="Materiais fornecidos pelo cliente">
          <PrintTable columns={["Item", "Quantidade"]} isEmpty={false} emptyMessage="">
            {calculation.customerSuppliedMaterials.map((material) => (
              <tr key={material.itemId}>
                <td>
                  {material.itemCode} — {material.itemName}
                </td>
                <td className="is-number">
                  {formatQuantity(material.requiredQuantity)} {material.unitCode}
                </td>
              </tr>
            ))}
          </PrintTable>
          <p className="print-doc__status">
            Pertencem à estrutura física do produto e não têm valor econômico atribuído à Veridi.
          </p>
        </PrintSection>
      )}

      {calculation.warnings.length > 0 && (
        <PrintSection title="Observações do cálculo">
          <PrintTable columns={["Observação"]} isEmpty={false} emptyMessage="">
            {calculation.warnings.map((warning) => (
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
