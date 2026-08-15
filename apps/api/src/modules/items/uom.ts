import type { UomDimension } from "@veridi/shared";

export interface UnitOfMeasureLike {
  code: string;
  dimension: UomDimension;
  /** Fator de conversão para a unidade-base da dimensão. */
  toBaseFactor: number;
}

export class UomNotFoundError extends Error {
  constructor(code: string) {
    super(`Unidade de medida desconhecida: ${code}`);
    this.name = "UomNotFoundError";
  }
}

export class UomDimensionMismatchError extends Error {
  constructor(fromCode: string, toCode: string) {
    super(
      `Não é possível converter entre dimensões incompatíveis: ${fromCode} -> ${toCode}`,
    );
    this.name = "UomDimensionMismatchError";
  }
}

/**
 * Converte uma quantidade entre unidades da mesma dimensão, via a
 * unidade-base de cada uma (ex.: 1000 mg -> 1 g -> 1000 g -> 1 kg).
 * Fundação para formulações; não é usada por nenhuma rota ainda.
 */
export function convertUom(
  quantity: number,
  fromCode: string,
  toCode: string,
  units: readonly UnitOfMeasureLike[],
): number {
  const from = units.find((unit) => unit.code === fromCode);
  const to = units.find((unit) => unit.code === toCode);

  if (!from) throw new UomNotFoundError(fromCode);
  if (!to) throw new UomNotFoundError(toCode);
  if (from.dimension !== to.dimension) {
    throw new UomDimensionMismatchError(fromCode, toCode);
  }

  const baseQuantity = quantity * from.toBaseFactor;
  return baseQuantity / to.toBaseFactor;
}
