import type { FormulationTemplateDiffDTO, FormulationTemplateDiffKind } from "@veridi/shared";

/**
 * O que muda entre duas composições.
 *
 * Lista específica e curta de propósito: as coisas que mudam numa fórmula são
 * conhecidas e contáveis. Comparar é para decidir, não para auditar — quem
 * precisa do detalhe abre as duas versões.
 */

const ROTULO: Record<FormulationTemplateDiffKind, string> = {
  BASIS: "Base",
  MODE: "Modo",
  DOSES: "Doses",
  OUTPUT_UOM: "Unidade",
  COMPONENT_ADDED: "Componente adicionado",
  COMPONENT_REMOVED: "Componente removido",
  COMPONENT_CHANGED: "Componente alterado",
};

export function TemplateDiff({ diff }: { diff: FormulationTemplateDiffDTO }) {
  if (diff.entries.length === 0) {
    return (
      <div className="template-diff">
        <h4 className="template-diff__title">
          {diff.fromLabel} → {diff.toLabel}
        </h4>
        <p className="field__hint">Nada muda entre as duas versões.</p>
      </div>
    );
  }

  return (
    <div className="template-diff">
      <h4 className="template-diff__title">
        Comparando {diff.fromLabel} → {diff.toLabel}
      </h4>
      <table className="table">
        <thead>
          <tr>
            <th>O que</th>
            <th>Onde</th>
            <th>De</th>
            <th>Para</th>
          </tr>
        </thead>
        <tbody>
          {diff.entries.map((entry, index) => (
            <tr key={`${entry.kind}-${entry.label}-${entry.field ?? ""}-${index}`}>
              <td>{ROTULO[entry.kind]}</td>
              <td>
                {entry.label}
                {entry.field && <span className="field__hint">{entry.field}</span>}
              </td>
              <td>{entry.from ?? "—"}</td>
              <td>{entry.to ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
