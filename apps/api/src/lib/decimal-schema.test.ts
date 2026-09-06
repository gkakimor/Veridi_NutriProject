import { describe, expect, it } from "vitest";
import {
  CASAS_QUANTIDADE,
  decimalStringSchema,
  optionalQuantityDecimalSchema,
  quantityDecimalSchema,
} from "./decimal-schema.js";

/**
 * A fronteira de precisão da entrada — PREC-MIG-A.
 *
 * Antes desta capability a coluna guardava seis casas e o PostgreSQL
 * arredondava a sétima em silêncio: o operador digitava um número e o banco
 * gravava outro, sem dizer. Ampliar o scale para doze mudaria só o ponto onde
 * o silêncio acontece — por isso a validação recusa acima do scale, em vez de
 * deixar o banco decidir.
 */

describe("quantityDecimalSchema", () => {
  it("fixa o limite no scale da coluna", () => {
    expect(CASAS_QUANTIDADE).toBe(12);
  });

  it("aceita até 12 casas decimais", () => {
    for (const valor of ["1", "0.1", "0.123456", "0.123456789012", "999999999999.999999999999".slice(0, 25)]) {
      const r = quantityDecimalSchema().safeParse(valor);
      expect(r.success, `${valor} deveria passar`).toBe(true);
    }
    expect(quantityDecimalSchema().parse("0.000000048")).toBe("0.000000048");
    expect(quantityDecimalSchema().parse("0.000000000001")).toBe("0.000000000001");
  });

  it("recusa 13 casas em vez de deixar o banco arredondar em silêncio", () => {
    const r = quantityDecimalSchema().safeParse("0.1234567890123");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain("12 casas decimais");
    }
  });

  it("recusa com vírgula também — a normalização acontece antes da contagem", () => {
    expect(quantityDecimalSchema().safeParse("0,1234567890123").success).toBe(false);
    expect(quantityDecimalSchema().parse("0,123456789012")).toBe("0.123456789012");
  });

  it("mantém as recusas que já existiam", () => {
    expect(quantityDecimalSchema().safeParse("0").success).toBe(false);
    expect(quantityDecimalSchema({ allowZero: true }).safeParse("0").success).toBe(true);
    expect(quantityDecimalSchema().safeParse("1.234,56").success).toBe(false);
    expect(quantityDecimalSchema().safeParse("abc").success).toBe(false);
  });

  it("a versão opcional aceita ausência e aplica o mesmo teto", () => {
    const s = optionalQuantityDecimalSchema();
    expect(s.parse(undefined)).toBeUndefined();
    expect(s.parse(null)).toBeNull();
    expect(s.parse("")).toBeNull();
    expect(s.parse("0.123456789012")).toBe("0.123456789012");
    expect(s.safeParse("0.1234567890123").success).toBe(false);
  });

  it("não impõe teto a quem não pediu — PREC-MIG-B segue com a própria escala", () => {
    // `decimalStringSchema` sem `maxDecimals` continua como estava: custo e
    // preço pertencem ao PREC-MIG-B e não têm o teto de 12 aplicado aqui.
    expect(decimalStringSchema().safeParse("0.1234567890123").success).toBe(true);
  });
});
