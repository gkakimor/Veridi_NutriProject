import type { FormulationTemplateDiffDTO, TemplateDiffDTO } from "@veridi/shared";

/**
 * O que muda entre duas versões de uma matriz.
 *
 * Serve às três bibliotecas — formulação, estrutura de custos e política —
 * porque a pergunta é a mesma em todas: o que essa versão nova faz diferente?
 *
 * A lista é curta de propósito. Comparar é para decidir, não para auditar; e
 * em nenhuma das três aparece dinheiro resolvido por tarifa ou por custo de
 * produto, porque isso faria parecer que a matriz mudou quando só o mundo
 * ao redor dela mudou.
 */

const ROTULO: Record<string, string> = {
  // formulação
  BASIS: "Base",
  MODE: "Modo",
  DOSES: "Doses",
  OUTPUT_UOM: "Unidade",
  COMPONENT_ADDED: "Componente adicionado",
  COMPONENT_REMOVED: "Componente removido",
  COMPONENT_CHANGED: "Componente alterado",
  // estrutura de custos
  ENERGY_MODE: "Energia",
  ENERGY_RESOURCE: "Recurso de energia",
  RESOURCE_ADDED: "Recurso adicionado",
  RESOURCE_REMOVED: "Recurso removido",
  RESOURCE_CHANGED: "Recurso alterado",
  COST_ADDED: "Premissa adicionada",
  COST_REMOVED: "Premissa removida",
  COST_CHANGED: "Premissa alterada",
  // política de precificação
  TIER_ADDED: "Faixa adicionada",
  TIER_REMOVED: "Faixa removida",
  TIER_CHANGED: "Faixa alterada",
};

export function TemplateDiffTable({
  diff,
}: {
  diff: TemplateDiffDTO | FormulationTemplateDiffDTO;
}) {
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
              <td>{ROTULO[entry.kind] ?? entry.kind}</td>
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
