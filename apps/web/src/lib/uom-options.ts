import type { UnitOfMeasureDTO } from "@veridi/shared";

/**
 * As unidades em que um Item pode ser medido: as do catálogo com a mesma
 * dimensão da unidade de estoque dele — a regra de `isUomCompatible` na API.
 *
 * A Formulação e o Modelo de Formulação oferecem exatamente esta lista
 * (FORM-UOM-01): duas cópias do filtro divergiriam, e uma tela aceitaria o que
 * a outra recusa. A ordem é a do catálogo.
 */
export function unidadesDaDimensao(
  units: readonly UnitOfMeasureDTO[],
  dimensao: string,
): UnitOfMeasureDTO[] {
  return units.filter((unit) => unit.dimension === dimensao);
}
