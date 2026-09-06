import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { Decimal as DecimalCompartilhado } from "@veridi/shared";
import { Decimal } from "./decimal.js";
import { splitDecimal } from "./part-split.js";
import { convertUomDecimal } from "../modules/items/uom.js";

/**
 * `Prisma.Decimal` na precisão canônica — `PRODUCT_RULES.md` §59.
 *
 * O Prisma empacota a própria cópia do `decimal.js`. `Prisma.Decimal` e o
 * `Decimal` de `@veridi/shared` são objetos DIFERENTES, com configuração
 * independente, e é `Prisma.Decimal` que roda quase todo o cálculo de domínio
 * da API. Configurar só o pacote compartilhado deixaria a API em 20 dígitos —
 * e nenhum teste de `@veridi/shared` perceberia.
 */

const UNIDADES = [
  { code: "g", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("1") },
  { code: "kg", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("1000") },
  { code: "mg", dimension: "MASS" as const, toBaseFactor: new Prisma.Decimal("0.001") },
];

describe("Prisma.Decimal canônico", () => {
  it("está em 40 dígitos significativos", () => {
    expect(Decimal.precision).toBe(40);
    expect(Prisma.Decimal.precision).toBe(40);
  });

  it("é o mesmo construtor que `Prisma.Decimal`, e não o de @veridi/shared", () => {
    expect(Decimal).toBe(Prisma.Decimal);
    // Dois construtores distintos, ambos configurados. Se um dia virarem o
    // mesmo objeto, o teste falha e alguém revisa a premissa deste módulo.
    expect(Prisma.Decimal).not.toBe(DecimalCompartilhado);
    expect(DecimalCompartilhado.precision).toBe(40);
    // E por comportamento, que é o que a migration depende: 40 dígitos na conta.
    expect(new DecimalCompartilhado(1).dividedBy(3).toString()).toHaveLength(42);
  });

  it("divide além de 20 dígitos significativos — o teto anterior", () => {
    const terco = new Prisma.Decimal(1).dividedBy(3).toString();
    expect(terco).toBe("0.3333333333333333333333333333333333333333");
  });

  it("preserva um operando de 24 dígitos, o que `DECIMAL(24,12)` guarda", () => {
    const bruto = "123456789012.123456789012";
    expect(new Prisma.Decimal(bruto).dividedBy(1).toString()).toBe(bruto);
  });

  it("mexe só em precision — rounding preservado", () => {
    expect(Prisma.Decimal.rounding).toBe(4);
  });
});

describe("precisão canônica nos cálculos reais da API", () => {
  it("conversão de unidade preserva a dízima além de 20 dígitos", () => {
    // 1 kg convertido para mg e dividido por 3: dízima real do domínio.
    const emMg = convertUomDecimal(new Prisma.Decimal(1), "kg", "mg", UNIDADES);
    expect(emMg.toString()).toBe("1000000");
    const terco = emMg.dividedBy(3).toString();
    expect(terco.replace(/[^0-9]/g, "").replace(/^0+/, "").length).toBeGreaterThan(20);
  });

  it("splitDecimal fecha exatamente com o total, sem float", () => {
    // 10 kg em 3 partes: as duas primeiras arredondam para baixo na escala
    // operacional e a última absorve o resto. A soma é EXATAMENTE o total.
    const partes = splitDecimal(new Prisma.Decimal("10"), 3);
    expect(partes).toHaveLength(3);
    const soma = partes.reduce((a, p) => a.plus(p), new Prisma.Decimal(0));
    expect(soma.equals(new Prisma.Decimal("10"))).toBe(true);
  });

  it("microdosagem sobrevive à conversão mg → kg", () => {
    // 0,045 mg em item estocado em kg = 4,5e-8 kg. Precisa existir como número
    // antes de qualquer decisão sobre em que coluna ele cabe.
    const emKg = convertUomDecimal(new Prisma.Decimal("0.045"), "mg", "kg", UNIDADES);
    expect(emKg.toFixed(6)).toBe("0.000000");
    expect(emKg.toFixed(12)).toBe("0.000000045000");
    expect(emKg.isZero()).toBe(false);
  });
});
