import type { IndustrialMaterialCostLineDTO } from "@veridi/shared";
import { INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS } from "@veridi/shared";
import { formatUnitCost } from "./CostBreakdown";
import { formatBRL } from "../lib/currency";
import { formatDate } from "../lib/dates";

/**
 * Fonte do custo por material — seleção automática ou referência manual
 * FORÇADA, neste cálculo.
 *
 * Só aparece para material Veridi que TEM referência manual vigente na data
 * de referência: sem referência não há o que forçar, e material do cliente
 * não tem custo de aquisição a substituir.
 *
 * A escolha vale para este cálculo e para este componente. Nada aqui marca o
 * item: o próximo cálculo nasce automático de novo. O padrão é — e continua
 * sendo — a seleção automática; forçar é exceção, e exceção pede motivo.
 */
export function MaterialCostSourceChooser({
  materials,
  overrides,
  disabled,
  onToggle,
  onReason,
}: {
  materials: IndustrialMaterialCostLineDTO[];
  /** itemId → motivo. A presença da chave é o que força. */
  overrides: Record<string, string>;
  disabled?: boolean;
  onToggle: (itemId: string, forced: boolean) => void;
  onReason: (itemId: string, reason: string) => void;
}) {
  const candidatos = materials.filter(
    (material) => !material.customerSupplied && material.manualReference,
  );
  if (candidatos.length === 0) return null;

  return (
    <div className="cost-source-chooser">
      <h4 className="cost-source-chooser__title">Fonte do custo por material</h4>
      <p className="field__hint">
        Seleção automática é o padrão. Forçar a referência manual vale só para este cálculo e
        exige motivo — o item e a ordem de seleção não mudam.
      </p>

      {candidatos.map((material) => {
        const forcado = Object.prototype.hasOwnProperty.call(overrides, material.itemId);
        const manual = material.manualReference!;
        // Quando já está forçado, o que a seleção automática teria usado
        // viaja dentro da própria linha — a tela não refaz a seleção.
        const autoSource = material.override ? material.override.automaticSource : material.costSource;
        const autoUnitCost = material.override ? material.override.automaticUnitCost : material.unitCost;
        const nome = `cost-source-${material.itemId}`;

        return (
          <fieldset key={material.itemId} className="cost-source-chooser__material">
            <legend>
              <span className="code">{material.itemCode}</span> {material.itemName}
            </legend>
            <div className="cost-source-chooser__options">
              <label className="cost-source-chooser__option">
                <input
                  type="radio"
                  name={nome}
                  value="automatic"
                  checked={!forcado}
                  disabled={disabled}
                  onChange={() => onToggle(material.itemId, false)}
                />
                <span>
                  <b>Seleção automática (recomendada)</b>
                  <span className="field__hint">
                    {" "}
                    {INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[autoSource]}
                    {autoUnitCost !== null
                      ? ` · ${formatUnitCost(autoUnitCost)}/${material.unitCode}`
                      : " · sem custo conhecido"}
                  </span>
                </span>
              </label>
              <label className="cost-source-chooser__option">
                <input
                  type="radio"
                  name={nome}
                  value="manual"
                  checked={forcado}
                  disabled={disabled}
                  onChange={() => onToggle(material.itemId, true)}
                />
                <span>
                  <b>Forçar referência manual</b>
                  <span className="field__hint">
                    {" "}
                    Referência atual · {formatUnitCost(manual.unitCost)}/{material.unitCode}
                    {manual.declaredUomCode !== material.unitCode
                      ? ` (declarada ${formatUnitCost(manual.declaredUnitCost)}/${manual.declaredUomCode})`
                      : ""}
                    {" · válida desde "}
                    {formatDate(manual.effectiveFrom)}
                  </span>
                </span>
              </label>
            </div>

            {forcado && (
              <div className="field">
                <label htmlFor={`${nome}-reason`}>
                  Motivo da substituição <span className="req">*</span>
                </label>
                <textarea
                  id={`${nome}-reason`}
                  rows={2}
                  maxLength={500}
                  value={overrides[material.itemId] ?? ""}
                  disabled={disabled}
                  onChange={(event) => onReason(material.itemId, event.target.value)}
                  {...((overrides[material.itemId] ?? "").trim() === ""
                    ? { "aria-invalid": true as const }
                    : {})}
                />
                {(overrides[material.itemId] ?? "").trim() === "" && (
                  <p className="field__error">
                    Informe o motivo para salvar o cálculo com a referência manual forçada.
                  </p>
                )}
                {material.override?.impact !== null && material.override?.impact !== undefined && (
                  <p className="field__hint">
                    Impacto neste cálculo:{" "}
                    <b>
                      {Number(material.override.impact) >= 0 ? "+ " : "− "}
                      {formatBRL(String(Math.abs(Number(material.override.impact))))}
                    </b>{" "}
                    em relação à seleção automática.
                  </p>
                )}
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
