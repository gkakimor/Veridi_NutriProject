import { formatQuantity } from "../lib/quantity";
import type { IndustrialCostCalculationDTO } from "@veridi/shared";
import {
  COST_SOURCE_AUTO_SELECTION_TEXT,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_QUALITY_HINTS,
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
} from "@veridi/shared";
import { formatBRL } from "../lib/currency";
import { formatDateTime } from "../lib/dates";
import { EntityLink } from "./EntityLink";
import { CostWarnings } from "./CostWarnings";
import { CalcHint } from "./help/CalcHint";

/**
 * Dinheiro na tela é real brasileiro com dois centavos.
 *
 * Isto já foi seis casas, para preservar custos unitários minúsculos. O preço
 * de venda pagava a conta: "R$ 1.407,523077" não é um número que alguém
 * fatura, cobra ou confere, e a precisão extra virou ruído em toda tabela.
 *
 * A exceção é o valor pequeno demais para dois centavos: mostrar R$ 0,00 para
 * uma cápsula a R$ 0,0032 diria que ela é de graça. Aí, e só aí, o formato
 * abre casas até o número aparecer.
 */
export function formatUnitCost(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return "—";
  const desapareceria = number !== 0 && Math.abs(number) < 0.005;
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: desapareceria ? 6 : 2,
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
      {/* A ordem da seleção é regra do produto, e é aqui que ela é lida:
          ao lado da coluna que diz qual fonte cada material recebeu. */}
      <p className="field__hint">{COST_SOURCE_AUTO_SELECTION_TEXT}</p>
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
                  {formatQuantity(material.requiredQuantity)} {material.unitCode}
                </td>
                {/* Três estados que não se confundem: valor, "Não aplicável"
                    (material do cliente) e "—" (desconhecido). Nunca R$ 0,00. */}
                <td className="is-numeric">
                  {material.customerSupplied ? "Não aplicável" : formatUnitCost(material.unitCost)}
                </td>
                <td>
                  {material.override && <span className="badge badge--warn">Forçada</span>}{" "}
                  {INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[material.costSource]}
                  {material.costSourceDetails && (
                    <span className="field__hint"> {material.costSourceDetails}</span>
                  )}
                  {/* Auditoria da substituição, lida do próprio documento:
                      o que a seleção automática teria usado, o motivo, quem
                      e quando. Não depende do item de hoje. */}
                  {material.override && (
                    <div className="field__hint cost-override-audit">
                      <div>
                        Fonte automática:{" "}
                        {INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[material.override.automaticSource]}
                        {material.override.automaticUnitCost !== null
                          ? ` · ${formatUnitCost(material.override.automaticUnitCost)}/${material.unitCode}`
                          : " · sem custo conhecido"}
                      </div>
                      {material.override.impact !== null && (
                        <div>
                          Impacto neste cálculo:{" "}
                          <b>
                            {Number(material.override.impact) >= 0 ? "+ " : "− "}
                            {formatBRL(String(Math.abs(Number(material.override.impact))))}
                          </b>
                        </div>
                      )}
                      {material.override.reason && <div>Motivo: {material.override.reason}</div>}
                      <div>
                        Por {material.override.forcedByName ?? "—"} em{" "}
                        {formatDateTime(material.override.forcedAt)}
                      </div>
                    </div>
                  )}
                </td>
                <td className="is-numeric">
                  {material.customerSupplied
                    ? "Não aplicável"
                    : material.subtotal === null
                      ? "—"
                      : formatBRL(material.subtotal)}
                  {/* A conta com os números DESTA linha, conferida pelo
                      próprio componente: quantidade × custo unitário. A nota
                      diz a fonte — e, quando forçada, a que teria sido usada. */}
                  {!material.customerSupplied && material.subtotal !== null && material.unitCost !== null && (
                    <CalcHint
                      label={`Subtotal de ${material.itemCode}`}
                      operandos={[
                        {
                          valor: formatQuantity(material.requiredQuantity),
                          papel: `quantidade física em ${material.unitCode}`,
                          numero: Number(material.requiredQuantity),
                        },
                        {
                          valor: formatUnitCost(material.unitCost),
                          papel: `custo utilizado por ${material.unitCode}`,
                          numero: Number(material.unitCost),
                        },
                      ]}
                      resultado={formatBRL(material.subtotal)}
                      nota={
                        material.override
                          ? `Fonte: ${INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[material.costSource]}. Fonte automática: ${INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[material.override.automaticSource]}${
                              material.override.automaticUnitCost !== null
                                ? ` · ${formatUnitCost(material.override.automaticUnitCost)}/${material.unitCode}`
                                : ""
                            }.`
                          : `Fonte: ${INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[material.costSource]}.`
                      }
                    />
                  )}
                  {material.customerSupplied && (
                    <CalcHint
                      label={`Subtotal de ${material.itemCode}`}
                      operandos={[
                        {
                          valor: formatQuantity(material.requiredQuantity),
                          papel: `quantidade física em ${material.unitCode}`,
                        },
                      ]}
                      resultado="não aplicável"
                      nota="Material do cliente: a Veridi não o comprou, então não há custo de aquisição. Não é zero nem desconhecido — mesmo que o item tenha referência manual de custo."
                    />
                  )}
                </td>
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
                    {formatQuantity(resource.quantity)} {INDUSTRIAL_RATE_UOM_LABELS[resource.quantityUom]}
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
            .map((material) => `${material.itemCode} (${formatQuantity(material.requiredQuantity)} ${material.unitCode})`)
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
