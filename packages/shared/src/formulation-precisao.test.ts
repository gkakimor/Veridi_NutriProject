import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal-config.js";
import {
  ajustesAutorizados,
  aplicarAjustes,
  calcularQuantidadeDoComponente,
  type UomFactorLike,
} from "./formulation-quantity.js";

/**
 * Pureza e overage com a precisão do PREC-MIG-C — `DECIMAL(9,6)`.
 *
 * Antes desta capability a coluna guardava três casas: `99,9995%` de um laudo
 * de ensaio era gravado como `100,000`, e o operando que entrava no motor já
 * vinha errado. Ampliar a coluna resolve o armazenamento; estes testes provam
 * o outro lado — que o motor CONSOME as seis casas, que nenhuma delas some num
 * arredondamento intermediário, e que a fórmula canônica continua sendo a
 * mesma de sempre:
 *
 *   físico = teórico ÷ (pureza/100) × (1 + overage/100)
 *
 * A conta de referência é feita em `Decimal` DENTRO DO TESTE, nunca por um
 * segundo motor de produção: duas contas para o mesmo número acabam
 * discordando, e a que ninguém usa é a que fica errada em silêncio.
 */

const UNIDADES: UomFactorLike[] = [
  { code: "kg", dimension: "MASS", toBaseFactor: "1000" },
  { code: "g", dimension: "MASS", toBaseFactor: "1" },
  { code: "mg", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", dimension: "COUNT", toBaseFactor: "1" },
];

const TEORICO = { basisQuantity: "1", dosesPerPackage: null };

/** A conta de referência, escrita à mão, em Decimal — só para comparar. */
function referencia(
  teorico: string,
  purezaPercent: string | null,
  overagePercent: string | null,
): Decimal {
  let valor = new Decimal(teorico);
  if (purezaPercent !== null) valor = valor.dividedBy(new Decimal(purezaPercent).dividedBy(100));
  if (overagePercent !== null) {
    valor = valor.times(new Decimal(100).plus(overagePercent).dividedBy(100));
  }
  return valor;
}

describe("PREC-MIG-C: o motor consome as seis casas de pureza e overage", () => {
  it("purity 97,123456% e overage 3,654321% batem com a conta em Decimal", () => {
    const resultado = calcularQuantidadeDoComponente(
      {
        basis: "FIXED_BASIS",
        quantity: "1",
        unitCode: "kg",
        stockUnitCode: "kg",
        purityPercent: "97.123456",
        overagePercent: "3.654321",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
      1,
      TEORICO,
      UNIDADES,
    );

    expect(typeof resultado).not.toBe("string");
    if (typeof resultado === "string") return;

    const esperado = referencia("1", "97.123456", "3.654321");
    expect(resultado.physical.toString()).toBe(esperado.toString());
    // O teórico não sofre ajuste nenhum — é o operando, não o resultado.
    expect(resultado.theoretical.toString()).toBe("1");
  });

  it("nenhum arredondamento intermediário: o resultado passa de seis casas", () => {
    const resultado = aplicarAjustes(new Decimal("1"), "97.123456", "3.654321", {
      purity: true,
      overage: true,
    });
    // 1 ÷ 0,97123456 × 1,03654321 = 1,067214… — dízima que só existe se a
    // divisão e a multiplicação não forem cortadas no caminho.
    const casas = resultado.toString().split(".")[1] ?? "";
    expect(casas.length).toBeGreaterThan(6);
    expect(resultado.toString()).toBe(referencia("1", "97.123456", "3.654321").toString());
  });

  it("a ordem canônica é preservada: divide pela pureza, depois aplica o overage", () => {
    // Inverter a ordem daria outro número em qualquer aritmética exata que
    // arredondasse no meio; aqui as duas ordens só coincidem porque nada é
    // cortado entre elas. O teste fixa a ordem escrita na regra.
    const doMotor = aplicarAjustes(new Decimal("220"), "97.123456", "3.654321", {
      purity: true,
      overage: true,
    });
    const naMao = new Decimal("220")
      .dividedBy(new Decimal("97.123456").dividedBy(100))
      .times(new Decimal(100).plus("3.654321").dividedBy(100));
    expect(doMotor.toString()).toBe(naMao.toString());
  });
});

describe("PREC-MIG-C: valores que a precisão antiga destruía", () => {
  it("99,999500% e 100,000000% continuam DISTINTOS", () => {
    const comLaudo = aplicarAjustes(new Decimal("1"), "99.999500", null, {
      purity: true,
      overage: false,
    });
    const comCem = aplicarAjustes(new Decimal("1"), "100.000000", null, {
      purity: true,
      overage: false,
    });
    expect(comLaudo.toString()).not.toBe(comCem.toString());
    expect(comCem.toString()).toBe("1");
    // A diferença é pequena e real: 1 ÷ 0,999995 = 1,000005000025…
    expect(comLaudo.greaterThan(comCem)).toBe(true);
  });

  it("overage de 0,000001% não vira zero", () => {
    const comOverage = aplicarAjustes(new Decimal("1000"), null, "0.000001", {
      purity: false,
      overage: true,
    });
    expect(comOverage.toString()).not.toBe("1000");
    expect(comOverage.toString()).toBe(new Decimal("1000").times("1.00000001").toString());
  });

  it("98,1234 e 98,123456 produzem físicos diferentes", () => {
    const curto = aplicarAjustes(new Decimal("1"), "98.1234", null, {
      purity: true,
      overage: false,
    });
    const longo = aplicarAjustes(new Decimal("1"), "98.123456", null, {
      purity: true,
      overage: false,
    });
    expect(curto.toString()).not.toBe(longo.toString());
  });
});

describe("PREC-MIG-C: as bases continuam se comportando como sempre", () => {
  it("FIXED_BASIS com pureza e overage de seis casas", () => {
    const resultado = calcularQuantidadeDoComponente(
      {
        basis: "FIXED_BASIS",
        quantity: "220",
        unitCode: "mg",
        stockUnitCode: "kg",
        purityPercent: "97.123456",
        overagePercent: "3.654321",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
      1000,
      { basisQuantity: "1", dosesPerPackage: null },
      UNIDADES,
    );
    expect(typeof resultado).not.toBe("string");
    if (typeof resultado === "string") return;

    // 220 mg × 1000 = 220 g = 0,22 kg de teórico.
    expect(resultado.theoretical.toString()).toBe("0.22");
    expect(resultado.physical.toString()).toBe(
      referencia("0.22", "97.123456", "3.654321").toString(),
    );
  });

  it("PER_DOSE com pureza e overage de seis casas", () => {
    const resultado = calcularQuantidadeDoComponente(
      {
        basis: "PER_DOSE",
        quantity: "200",
        unitCode: "mg",
        stockUnitCode: "kg",
        purityPercent: "97.123456",
        overagePercent: "3.654321",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
      100,
      { basisQuantity: "1", dosesPerPackage: 60 },
      UNIDADES,
    );
    expect(typeof resultado).not.toBe("string");
    if (typeof resultado === "string") return;

    // 200 mg × 60 doses × 100 embalagens = 1200 g = 1,2 kg de teórico.
    expect(resultado.theoretical.toString()).toBe("1.2");
    expect(resultado.physical.toString()).toBe(
      referencia("1.2", "97.123456", "3.654321").toString(),
    );
  });

  it("PER_DOSE sem doses por embalagem continua BLOQUEANDO, não zerando", () => {
    // A precisão maior não afrouxa a premissa: `null` segue fail-closed.
    const resultado = calcularQuantidadeDoComponente(
      {
        basis: "PER_DOSE",
        quantity: "200",
        unitCode: "mg",
        stockUnitCode: "kg",
        purityPercent: "97.123456",
        overagePercent: "3.654321",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
      100,
      { basisQuantity: "1", dosesPerPackage: null },
      UNIDADES,
    );
    expect(resultado).toBe("DOSES_PER_PACKAGE");
  });
});

describe("PREC-MIG-C: o que NÃO mudou", () => {
  it("PHYSICAL_DIRECT continua sem aplicar nada, por mais precisa que a pureza seja", () => {
    const autorizados = ajustesAutorizados({
      quantityMode: "PHYSICAL_DIRECT",
      applyPurityAdjustment: true,
      applyOverageAdjustment: true,
    });
    expect(autorizados).toEqual({ purity: false, overage: false });

    const resultado = calcularQuantidadeDoComponente(
      {
        basis: "FIXED_BASIS",
        quantity: "220",
        unitCode: "mg",
        stockUnitCode: "kg",
        purityPercent: "97.123456",
        overagePercent: "3.654321",
        quantityMode: "PHYSICAL_DIRECT",
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
      1000,
      { basisQuantity: "1", dosesPerPackage: null },
      UNIDADES,
    );
    expect(typeof resultado).not.toBe("string");
    if (typeof resultado === "string") return;
    // Pureza e overage ficam DOCUMENTAIS: teórico e físico coincidem.
    expect(resultado.physical.toString()).toBe(resultado.theoretical.toString());
    expect(resultado.physical.toString()).toBe("0.22");
  });

  it("pureza nula continua sem correção, e pureza zero não divide por zero", () => {
    const semPureza = aplicarAjustes(new Decimal("1"), null, null, {
      purity: true,
      overage: true,
    });
    expect(semPureza.toString()).toBe("1");

    const purezaZero = aplicarAjustes(new Decimal("1"), "0.000000", null, {
      purity: true,
      overage: true,
    });
    expect(purezaZero.isFinite()).toBe(true);
    expect(purezaZero.toString()).toBe("1");
  });

  it("o motor canônico continua em 40 dígitos", () => {
    expect(Decimal.precision).toBe(40);
  });
});
