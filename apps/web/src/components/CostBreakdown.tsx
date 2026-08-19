import type { IndustrialCostCalculationDTO } from "@veridi/shared";
import {
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_QUALITY_HINTS,
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
} from "@veridi/shared";
import { formatBRL } from "../lib/currency";
import { EntityLink } from "./EntityLink";
import { CostWarnings } from "./CostWarnings";

/** Custo unitário mantém casas decimais: R$ 0,083421/un não vira R$ 0,08. */
export function formatUnitCost(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return "—";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function qualityBadgeClass(quality: string): string {
  if (quality === "COMPLETE_REAL_REFERENCE") return "badge badge--active";
  if (quality === "COMPLETE_WITH_ESTIMATES") return "badge badge--neutral";
  return "badge badge--warn";
}

/**
 * Detalhamento do custo industrial calculado.
 *
 * Desconhecido aparece como "—", nunca como R$ 0,00, e um cálculo parcial
 * nunca exibe o subtotal conhecido sob o rótulo de total.
 */
export function CostBreakdown({
  result,
  productId,
  onStructurePage,
  structureLocked,
}: {
  result: IndustrialCostCalculationDTO;
  /** Para a observação de energia poder levar à seção certa. */
  productId?: string | undefined;
  onStructurePage?: boolean | undefined;
  /** Estrutura já congelada: a correção passa a ser uma versão nova. */
  structureLocked?: boolean | undefined;
}) {
  const partial = result.totalIndustrialCost === null;

  return (
    <>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Material</th>
              <th className="is-numeric">Quantidade</th>
              <th className="is-numeric">Custo unitário</th>
              <th>Origem do custo</th>
              <th className="is-numeric">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {result.materials.map((material) => (
              <tr key={material.itemId}>
                <td>
                  {/* Custo desconhecido se resolve no cadastro do item e nas
                      compras dele — ler "sem custo conhecido" e não ter como
                      abrir o material deixava o diagnóstico sem conserto. */}
                  <EntityLink
                    kind="item"
                    id={material.itemId}
                    code={material.itemCode}
                    name={material.itemName}
                  />
                </td>
                <td className="is-numeric">
                  {material.requiredQuantity} {material.unitCode}
                </td>
                <td className="is-numeric">{formatUnitCost(material.unitCost)}</td>
                <td>
                  {INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[material.costSource]}
                  {material.costSourceDetails && (
                    <span className="field__hint"> {material.costSourceDetails}</span>
                  )}
                </td>
                <td className="is-numeric">{material.subtotal === null ? "—" : formatBRL(material.subtotal)}</td>
              </tr>
            ))}
            {result.materials.length === 0 && (
              <tr>
                <td colSpan={5} className="table__empty">
                  A formulação vinculada não tem componentes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(result.resources.length > 0 || result.manualLines.length > 0) && (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Componente industrial</th>
                <th>Base</th>
                <th className="is-numeric">Quantidade</th>
                <th>Tarifa / valor</th>
                <th className="is-numeric">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {result.resources.map((resource) => (
                <tr key={resource.resourceId}>
                  <td>
                    <EntityLink
                    kind="industrialResource"
                    id={resource.resourceId}
                    code={resource.resourceCode}
                    name={resource.resourceName}
                  />
                  </td>
                  <td>{INDUSTRIAL_RESOURCE_TYPE_LABELS[resource.resourceType]}</td>
                  <td className="is-numeric">
                    {resource.quantity} {INDUSTRIAL_RATE_UOM_LABELS[resource.quantityUom]}
                  </td>
                  <td>
                    {resource.rateValue === null ? "—" : formatBRL(resource.rateValue)}
                    {resource.rateIsDraftReference && (
                      <span className="field__hint"> referência atual</span>
                    )}
                  </td>
                  <td className="is-numeric">{resource.subtotal === null ? "—" : formatBRL(resource.subtotal)}</td>
                </tr>
              ))}
              {result.manualLines.map((line) => (
                <tr key={line.lineId}>
                  <td>{line.description}</td>
                  <td>{INDUSTRIAL_COST_CATEGORY_LABELS[line.category]}</td>
                  <td className="is-numeric">
                    {line.computedUnits ? `${line.computedUnits} cx` : "—"}
                    <span className="field__hint">
                      {" "}
                      {INDUSTRIAL_COST_BASIS_LABELS[line.calculationBasis]}
                    </span>
                  </td>
                  <td>
                    {line.rateValue === null
                      ? "—"
                      : line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST"
                        ? `${line.rateValue}%`
                        : formatBRL(line.rateValue)}
                  </td>
                  <td className="is-numeric">{line.subtotal === null ? "—" : formatBRL(line.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="definition-list">
        <dt>Materiais e embalagens Veridi</dt>
        <dd>{formatBRL(result.materialsSubtotalKnown)}</dd>
        <dt>Mão de obra</dt>
        <dd>{formatBRL(result.laborSubtotalKnown)}</dd>
        <dt>Equipamentos</dt>
        <dd>{formatBRL(result.equipmentSubtotalKnown)}</dd>
        <dt>Energia</dt>
        {/* Energia desconhecida fica "—": nunca energia de graça. */}
        <dd>
          {result.energySubtotal === null ? "—" : formatBRL(result.energySubtotal)}
          {result.derivedEnergyKwh && (
            <span className="field__hint"> {result.derivedEnergyKwh} kWh derivados</span>
          )}
        </dd>
        <dt>Embalagem secundária</dt>
        <dd>{formatBRL(result.secondaryPackagingSubtotalKnown)}</dd>
        <dt>Serviços de terceiros</dt>
        <dd>{formatBRL(result.thirdPartySubtotalKnown)}</dd>
        <dt>Outros custos diretos</dt>
        <dd>{formatBRL(result.otherSubtotalKnown)}</dd>
        <dt>Custo industrial direto</dt>
        <dd>
          {result.directIndustrialCost === null ? "—" : formatBRL(result.directIndustrialCost)}
        </dd>
        <dt>Overhead</dt>
        <dd>{formatBRL(result.overheadSubtotalKnown)}</dd>
        {partial ? (
          <>
            <dt>Subtotal conhecido</dt>
            <dd>
              {formatBRL(result.knownSubtotal)}
              <span className="field__hint"> Existem custos não informados.</span>
            </dd>
          </>
        ) : (
          <>
            <dt>Custo industrial total</dt>
            <dd>{formatBRL(result.totalIndustrialCost)}</dd>
            <dt>Custo por unidade</dt>
            <dd>{formatUnitCost(result.costPerUnit)}</dd>
            <dt>Custo por 1.000 unidades</dt>
            <dd>{formatBRL(result.costPer1000)}</dd>
          </>
        )}
      </dl>

      <p className="field__hint">{INDUSTRIAL_COST_QUALITY_HINTS[result.quality]}</p>

      {result.hasCustomerSuppliedMaterials && (
        <p className="field__hint">
          Materiais fornecidos pelo cliente ({result.customerSuppliedMaterials.length}) fazem parte
          da estrutura física e não têm valor econômico atribuído aqui:{" "}
          {result.customerSuppliedMaterials
            .map((material) => `${material.itemCode} (${material.requiredQuantity} ${material.unitCode})`)
            .join(", ")}
          .
        </p>
      )}

      {/* A observação sem caminho é diagnóstico sem tratamento: aqui é onde
          "sem custo conhecido" é lido, e daqui tem que dar para agir. */}
      <CostWarnings
        warnings={result.warnings}
        title="Observações do cálculo"
        productId={productId}
        onStructurePage={onStructurePage}
        structureLocked={structureLocked}
      />
    </>
  );
}

export function CostQualityBadge({ quality }: { quality: IndustrialCostCalculationDTO["quality"] }) {
  return <span className={qualityBadgeClass(quality)}>{INDUSTRIAL_COST_QUALITY_LABELS[quality]}</span>;
}
