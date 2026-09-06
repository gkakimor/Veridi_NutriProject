import { describe, expect, it } from "vitest";
import DecimalDireto from "decimal.js";
import {
  Decimal,
  PRECISAO_DECIMAL_CANONICA,
  configurarDecimal,
} from "./decimal-config.js";
import { calcularQuantidadeDoComponente } from "./formulation-quantity.js";

/**
 * A precisão canônica do motor — `PRODUCT_RULES.md` §59.
 *
 * Estes testes não conferem uma constante: conferem COMPORTAMENTO. Um teste
 * que só lesse `Decimal.precision` continuaria passando se a configuração
 * deixasse de alcançar o construtor que o domínio realmente usa, que foi
 * exatamente o defeito que a auditoria PREC-01 encontrou.
 */

const UNIDADES = [
  { code: "g", dimension: "MASS", toBaseFactor: "1" },
  { code: "kg", dimension: "MASS", toBaseFactor: "1000" },
  { code: "mg", dimension: "MASS", toBaseFactor: "0.001" },
] as const;

describe("configuração canônica do decimal.js", () => {
  it("expõe 40 dígitos significativos", () => {
    expect(PRECISAO_DECIMAL_CANONICA).toBe(40);
    expect(Decimal.precision).toBe(40);
  });

  it("configura o mesmo construtor que um import direto de decimal.js recebe", () => {
    // O produto inteiro é ESM, então `import` sempre resolve para `decimal.mjs`
    // — uma cópia só. Se algum dia alguém trocar por `require`, cairia na cópia
    // CJS, que é outro objeto e não estaria configurada. Este teste falha nesse dia.
    expect(DecimalDireto).toBe(Decimal);
    expect(DecimalDireto.precision).toBe(40);
  });

  it("divide com mais de 20 dígitos significativos — o teto anterior", () => {
    const um = new Decimal(1).dividedBy(3).toString();
    // Com precision 20 isto teria 20 dígitos e terminaria em "...33333".
    expect(um).toBe("0.3333333333333333333333333333333333333333");
    expect(um.replace("0.", "").length).toBe(40);
  });

  it("preserva um operando de 24 dígitos que precision 20 truncava", () => {
    // O caso medido pela auditoria: 12 inteiros + 12 decimais é o que
    // `DECIMAL(24,12)` guarda, e o motor precisa conseguir produzi-lo.
    const bruto = "123456789012.123456789012";
    expect(new Decimal(bruto).times(1).toString()).toBe(bruto);
    expect(new Decimal(bruto).dividedBy(1).toString()).toBe(bruto);
  });

  it("mexe só em precision — rounding e expoentes ficam como estavam", () => {
    // ROUND_HALF_UP é o mesmo arredondamento que o PostgreSQL aplica ao gravar.
    // Trocá-lo de carona mudaria em silêncio todo cálculo monetário do sistema.
    expect(Decimal.rounding).toBe(4);
    expect(Decimal.toExpNeg).toBe(-7);
    expect(Decimal.toExpPos).toBe(21);
    expect(Decimal.modulo).toBe(1);
  });

  it("configurarDecimal é idempotente e devolve o construtor", () => {
    expect(configurarDecimal(Decimal)).toBe(Decimal);
    expect(Decimal.precision).toBe(40);
  });
});

describe("precisão canônica no motor de Formulação", () => {
  it("preserva a divisão por pureza além de 20 dígitos significativos", () => {
    // Operação real do domínio: 1 kg de base, pureza 97% e overage 3%.
    // `1 ÷ 0,97 × 1,03` é dízima — com precision 20 o resultado parava em 20
    // dígitos; com 40 continua.
    const r = calcularQuantidadeDoComponente(
      {
        basis: "FIXED_BASIS",
        quantity: "1",
        unitCode: "kg",
        stockUnitCode: "kg",
        purityPercent: "97",
        overagePercent: "3",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
      "1",
      { basisQuantity: "1", dosesPerPackage: null },
      UNIDADES,
    );
    if (typeof r === "string") throw new Error(`bloqueio inesperado: ${r}`);

    const digitos = r.physical.toString().replace(/[^0-9]/g, "").replace(/^0+/, "");
    expect(digitos.length).toBeGreaterThan(20);
    expect(r.physical.toFixed(12)).toBe("1.061855670103");
  });

  it("preserva microdosagem que scale 6 zerava — o caso de #19", () => {
    // `MP-000147`: 0,000048 kg sobre base 1000, produzindo 1 unidade.
    // Físico = 4,8e-8 kg. Em `Decimal(18,6)` isto persistia como 0,000000 e a
    // Ordem de Produção afirmava que o material não era necessário.
    const r = calcularQuantidadeDoComponente(
      {
        basis: "FIXED_BASIS",
        quantity: "0.000048",
        unitCode: "kg",
        stockUnitCode: "kg",
        purityPercent: null,
        overagePercent: null,
        quantityMode: "PHYSICAL_DIRECT",
      },
      "1",
      { basisQuantity: "1000", dosesPerPackage: null },
      UNIDADES,
    );
    if (typeof r === "string") throw new Error(`bloqueio inesperado: ${r}`);

    expect(r.physical.toFixed(6)).toBe("0.000000");
    expect(r.physical.toFixed(12)).toBe("0.000000048000");
    expect(r.physical.isZero()).toBe(false);
  });
});
