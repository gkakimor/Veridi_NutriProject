import { describe, expect, it } from "vitest";
import {
  UomDimensionMismatchError,
  UomNotFoundError,
  convertUom,
  type UnitOfMeasureLike,
} from "./uom.js";

const units: UnitOfMeasureLike[] = [
  { code: "mg", dimension: "MASS", toBaseFactor: 0.001 },
  { code: "g", dimension: "MASS", toBaseFactor: 1 },
  { code: "kg", dimension: "MASS", toBaseFactor: 1000 },
  { code: "un", dimension: "COUNT", toBaseFactor: 1 },
  { code: "mL", dimension: "VOLUME", toBaseFactor: 0.001 },
  { code: "L", dimension: "VOLUME", toBaseFactor: 1 },
];

describe("convertUom", () => {
  it("converte 1000 mg para 1 g", () => {
    expect(convertUom(1000, "mg", "g", units)).toBeCloseTo(1);
  });

  it("converte 1000 g para 1 kg", () => {
    expect(convertUom(1000, "g", "kg", units)).toBeCloseTo(1);
  });

  it("converte 1000 mL para 1 L", () => {
    expect(convertUom(1000, "mL", "L", units)).toBeCloseTo(1);
  });

  it("rejeita conversão entre dimensões incompatíveis (kg -> un)", () => {
    expect(() => convertUom(1, "kg", "un", units)).toThrow(
      UomDimensionMismatchError,
    );
  });

  it("rejeita unidade desconhecida", () => {
    expect(() => convertUom(1, "kg", "xx", units)).toThrow(UomNotFoundError);
  });
});
