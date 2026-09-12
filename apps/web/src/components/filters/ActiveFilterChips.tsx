import { ClearFilters } from "./ClearFilters";

export interface FilterChip {
  /** Que pergunta o filtro responde — "Cliente", "Período", "Status". */
  label: string;
  /** O valor como a pessoa o lê: o nome do cliente, não o id. */
  value: string;
  /** Remover só este filtro. Sem isto o chip é informativo. */
  onRemove?: () => void;
}

/**
 * O que a lista está escondendo, e como parar de esconder.
 *
 * Um filtro aplicado é a explicação de por que a linha que a pessoa procura
 * não aparece — e um `<select>` com o valor escolhido não conta essa
 * história: ela está fora do campo de visão de quem está olhando a tabela. O
 * contador `Filtros (3)` é o sinal discreto; os chips dizem quais, e cada um
 * se remove sozinho, porque quase sempre um filtro está sobrando e não todos.
 *
 * Nada aparece quando não há filtro ativo: barra vazia ocupando espaço em
 * toda lista é pior que barra ausente.
 */
export function ActiveFilterChips({
  chips,
  onClear,
}: {
  chips: FilterChip[];
  onClear: () => void;
}) {
  if (chips.length === 0) return null;

  return (
    <div className="filter-chips">
      <span className="filter-chips__count">Filtros ({chips.length})</span>
      {chips.map((chip) => (
        <span key={chip.label} className="filter-chip">
          <span className="filter-chip__label">{chip.label}:</span> {chip.value}
          {chip.onRemove && (
            <button
              type="button"
              className="filter-chip__remove"
              aria-label={`Remover filtro ${chip.label}`}
              onClick={chip.onRemove}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <ClearFilters onClear={onClear} />
    </div>
  );
}
