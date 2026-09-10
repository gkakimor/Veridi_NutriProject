import { describe, expect, it } from "vitest";
import type { UnitOfMeasureDTO } from "@veridi/shared";
import { unidadesDaDimensao } from "./uom-options";

const CATALOGO: UnitOfMeasureDTO[] = [
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "L", label: "Litro", dimension: "VOLUME", toBaseFactor: "1000" },
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
];

describe("unidadesDaDimensao — a lista que a Formulação e o Modelo oferecem", () => {
  it("só a dimensão pedida, na ordem do catálogo", () => {
    expect(unidadesDaDimensao(CATALOGO, "MASS").map((unit) => unit.code)).toEqual(["mg", "g", "kg"]);
    expect(unidadesDaDimensao(CATALOGO, "COUNT").map((unit) => unit.code)).toEqual(["un"]);
  });

  it("dimensão sem unidade no catálogo não inventa opção", () => {
    expect(unidadesDaDimensao(CATALOGO, "AREA")).toEqual([]);
    expect(unidadesDaDimensao([], "MASS")).toEqual([]);
  });
});
