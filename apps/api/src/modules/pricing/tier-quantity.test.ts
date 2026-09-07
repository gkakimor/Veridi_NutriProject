import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  normalizarQuantidadeDeFaixa,
  quantidadesDeFaixaEquivalentes,
  unidadeCanonicaDaFaixa,
} from "./tier-quantity.js";
import { InvalidTierQuantityError } from "./pricing.errors.js";

/**
 * Identidade da faixa de precificação — PREC-CMP-02.
 *
 * As unidades são as REAIS do sistema (`units_of_measure`): três de massa, uma
 * de contagem, duas de volume. Nenhum exemplo aqui é impossível no domínio.
 */
const UNIDADES = [
  { code: "mg", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("0.001") },
  { code: "g", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("1") },
  { code: "kg", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("1000") },
  { code: "un", dimension: "COUNT" as const, toBaseFactor: new Prisma.Decimal("1") },
  { code: "mL", dimension: "VOLUME" as const, toBaseFactor: new Prisma.Decimal("0.001") },
  { code: "L", dimension: "VOLUME" as const, toBaseFactor: new Prisma.Decimal("1") },
];

const faixa = (quantity: string, uomCode: string) => ({
  quantity: new Prisma.Decimal(quantity),
  uomCode,
});
const equivale = (a: [string, string], b: [string, string], canonica: string) =>
  quantidadesDeFaixaEquivalentes(
    faixa(a[0], a[1]),
    normalizarQuantidadeDeFaixa(faixa(b[0], b[1]), canonica, UNIDADES),
    canonica,
    UNIDADES,
  );

describe("unidadeCanonicaDaFaixa", () => {
  it("é a unidade do Item de produto acabado", () => {
    expect(unidadeCanonicaDaFaixa("kg")).toBe("kg");
    expect(unidadeCanonicaDaFaixa("g")).toBe("g");
  });

  it("produto sem Item de produto acabado cai em `un`", () => {
    // `finishedProductItemId` é opcional no schema; é o que a criação de faixa
    // já assumia antes desta capability.
    expect(unidadeCanonicaDaFaixa(null)).toBe("un");
    expect(unidadeCanonicaDaFaixa(undefined)).toBe("un");
  });
});

describe("normalizarQuantidadeDeFaixa", () => {
  it("converte para a unidade canônica do produto", () => {
    expect(normalizarQuantidadeDeFaixa(faixa("1", "kg"), "g", UNIDADES).toString()).toBe("1000");
    expect(normalizarQuantidadeDeFaixa(faixa("1000", "g"), "kg", UNIDADES).toString()).toBe("1");
    expect(normalizarQuantidadeDeFaixa(faixa("1", "L"), "mL", UNIDADES).toString()).toBe("1000");
  });

  it("mesma unidade não converte — devolve o próprio valor", () => {
    const q = faixa("1000.000000000000", "un");
    expect(normalizarQuantidadeDeFaixa(q, "un", UNIDADES)).toBe(q.quantity);
  });

  it("recusa unidade de outra dimensão com erro de domínio", () => {
    // Massa e volume não se convertem sem densidade, que o domínio não tem.
    expect(() => normalizarQuantidadeDeFaixa(faixa("1", "kg"), "L", UNIDADES)).toThrow(
      InvalidTierQuantityError,
    );
    expect(() => normalizarQuantidadeDeFaixa(faixa("1", "kg"), "un", UNIDADES)).toThrow(
      /não é compatível com a unidade do produto acabado/,
    );
  });

  it("não trunca — a conversão sai íntegra do motor", () => {
    // 0,000001 mg em kg é 1e-12: a menor quantidade que `DECIMAL(24,12)` guarda.
    expect(normalizarQuantidadeDeFaixa(faixa("0.000001", "mg"), "kg", UNIDADES).toString()).toBe(
      "1e-12",
    );
  });
});

describe("quantidadesDeFaixaEquivalentes", () => {
  it("1 kg e 1000 g são a MESMA faixa", () => {
    expect(equivale(["1", "kg"], ["1000", "g"], "g")).toBe(true);
    expect(equivale(["1", "kg"], ["1000", "g"], "kg")).toBe(true);
    // A unidade canônica não muda a resposta — ela só escolhe onde comparar.
    expect(equivale(["1", "kg"], ["1000", "g"], "mg")).toBe(true);
  });

  it("0,5 kg e 500 g são a MESMA faixa", () => {
    expect(equivale(["0.5", "kg"], ["500", "g"], "g")).toBe(true);
  });

  it("500 g e 500 kg são faixas DIFERENTES", () => {
    // O erro que a comparação de `quantity` crua cometia: quinhentas vezes
    // mais produto tratado como repetição.
    expect(equivale(["500", "g"], ["500", "kg"], "g")).toBe(false);
  });

  it("1000 g e 1001 g são diferentes, mesmo escritos em outra unidade", () => {
    expect(equivale(["1000", "g"], ["1001", "g"], "g")).toBe(false);
    expect(equivale(["1000", "g"], ["1.001", "kg"], "g")).toBe(false);
  });

  it("a igualdade é numérica, não textual", () => {
    expect(equivale(["1000", "un"], ["1000.000000000000", "un"], "un")).toBe(true);
    expect(equivale(["1000", "un"], ["1000.0", "un"], "un")).toBe(true);
  });

  it("diferença na décima segunda casa é faixa diferente", () => {
    expect(equivale(["1.000000000001", "kg"], ["1.000000000002", "kg"], "kg")).toBe(false);
    // E sobrevive à conversão: em gramas são 1000,000000001 e 1000,000000002.
    expect(equivale(["1.000000000001", "kg"], ["1.000000000002", "kg"], "g")).toBe(false);
    expect(equivale(["1.000000000001", "kg"], ["1000.000000001", "g"], "g")).toBe(true);
  });

  it("faixa gravada em unidade incompatível não equivale a nada", () => {
    /*
     * Só pode ter nascido antes desta regra. Devolve `false` em vez de erro:
     * ela não deve impedir a criação de uma faixa nova e válida. O lado NOVO
     * continua sendo recusado, por `normalizarQuantidadeDeFaixa`.
     */
    expect(
      quantidadesDeFaixaEquivalentes(faixa("1", "L"), new Prisma.Decimal("1"), "kg", UNIDADES),
    ).toBe(false);
  });
});
