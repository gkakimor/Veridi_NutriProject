import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { computeComponentRequirement, ajustesHabilitados } from "./formulation-math.js";

/**
 * Registrar um ajuste não é autorizá-lo.
 *
 * Antes desta capability, preencher a pureza de um componente bastava para
 * mudar a necessidade física de material. O dado real tem duas populações que
 * são indistinguíveis pelo valor: componentes cuja quantidade é teórica e
 * espera a correção, e componentes cuja quantidade já vem corrigida de fora.
 *
 * A Coenzima Q10 do corpus é o segundo caso — guarda 224,4898 mg por dose, que
 * é 220 dividido por 0,98. Preencher a pureza ali aplicaria a divisão uma
 * segunda vez, em silêncio, e a receita passaria a pedir 229,07 mg.
 *
 * Por isso o modo é explícito e o default é `PHYSICAL_DIRECT`.
 */

const units = [
  { code: "mg", dimension: "MASS", toBaseFactor: new Prisma.Decimal("0.000001") },
  { code: "g", dimension: "MASS", toBaseFactor: new Prisma.Decimal("0.001") },
  { code: "kg", dimension: "MASS", toBaseFactor: new Prisma.Decimal("1") },
  { code: "un", dimension: "COUNT", toBaseFactor: new Prisma.Decimal("1") },
] as never;

const base = {
  basis: "FIXED_BASIS" as const,
  unitCode: "mg",
  stockUnitCode: "mg",
};
const contexto = { basisQuantity: new Prisma.Decimal("1"), dosesPerPackage: 30 };
const UMA = new Prisma.Decimal("1");

function fisico(input: Parameters<typeof computeComponentRequirement>[0]) {
  return computeComponentRequirement(input, UMA, contexto, units).requiredQuantity;
}

describe("PHYSICAL_DIRECT — a quantidade declarada já é a física", () => {
  it("sem modo declarado, o default não aplica nada", () => {
    const r = fisico({
      ...base,
      quantity: new Prisma.Decimal("224.4898"),
      purityPercentApplied: new Prisma.Decimal("98"),
      overagePercent: new Prisma.Decimal("20"),
    });
    expect(r.toFixed(4)).toBe("224.4898");
  });

  it("o caso da Coenzima Q10: pureza documental não recalcula", () => {
    // 224,4898 mg já são 220 ÷ 0,98. Aplicar de novo daria 229,0712.
    const r = fisico({
      ...base,
      quantity: new Prisma.Decimal("224.4898"),
      purityPercentApplied: new Prisma.Decimal("98"),
      overagePercent: null,
      quantityMode: "PHYSICAL_DIRECT",
      applyPurityAdjustment: false,
    });
    expect(r.toFixed(4)).toBe("224.4898");
    expect(r.toFixed(4)).not.toBe("229.0712");
  });

  it("modo físico ignora as flags mesmo se vierem ligadas", () => {
    // A flag sozinha não pode ressuscitar o ajuste: o modo manda.
    const r = fisico({
      ...base,
      quantity: new Prisma.Decimal("100"),
      purityPercentApplied: new Prisma.Decimal("50"),
      overagePercent: new Prisma.Decimal("20"),
      quantityMode: "PHYSICAL_DIRECT",
      applyPurityAdjustment: true,
      applyOverageAdjustment: true,
    });
    expect(r.toFixed(6)).toBe("100.000000");
  });
});

describe("THEORETICAL_WITH_ADJUSTMENTS — só o que foi autorizado", () => {
  const teorico = {
    ...base,
    quantity: new Prisma.Decimal("220"),
    purityPercentApplied: new Prisma.Decimal("98"),
    overagePercent: new Prisma.Decimal("20"),
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS" as const,
  };

  it("nenhum ajuste habilitado devolve a quantidade declarada", () => {
    const r = fisico({ ...teorico, applyPurityAdjustment: false, applyOverageAdjustment: false });
    expect(r.toFixed(6)).toBe("220.000000");
  });

  it("só pureza: 220 ÷ 0,98", () => {
    const r = fisico({ ...teorico, applyPurityAdjustment: true, applyOverageAdjustment: false });
    expect(r.toFixed(4)).toBe("224.4898");
  });

  it("só overage: 220 × 1,20", () => {
    const r = fisico({ ...teorico, applyPurityAdjustment: false, applyOverageAdjustment: true });
    expect(r.toFixed(6)).toBe("264.000000");
  });

  it("os dois, na ordem do domínio: 200 × 1,20 ÷ 0,98", () => {
    const r = fisico({
      ...teorico,
      quantity: new Prisma.Decimal("200"),
      applyPurityAdjustment: true,
      applyOverageAdjustment: true,
    });
    // O handoff previu 244,897959…; a conta fecha nas duas ordens porque
    // multiplicação e divisão comutam.
    expect(r.toFixed(6)).toBe("244.897959");
  });

  it("pureza ausente não vira 100% para o número fechar", () => {
    const r = fisico({
      ...teorico,
      purityPercentApplied: null,
      applyPurityAdjustment: true,
      applyOverageAdjustment: false,
    });
    expect(r.toFixed(6)).toBe("220.000000");
  });

  it("pureza zero não divide — divisão por zero não é correção", () => {
    const r = fisico({
      ...teorico,
      purityPercentApplied: new Prisma.Decimal("0"),
      applyPurityAdjustment: true,
      applyOverageAdjustment: false,
    });
    expect(r.toFixed(6)).toBe("220.000000");
    expect(r.isFinite()).toBe(true);
  });
});

describe("Precisão", () => {
  it("a conta não passa por float — 1 ÷ 3 preserva as casas do Decimal", () => {
    const r = fisico({
      ...base,
      quantity: new Prisma.Decimal("1"),
      purityPercentApplied: new Prisma.Decimal("3"),
      overagePercent: null,
      quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
      applyPurityAdjustment: true,
    });
    // 1 ÷ 0,03 = 33,333… com a precisão do Decimal, não os 17 dígitos do float.
    expect(r.toFixed(10)).toBe("33.3333333333");
  });
});

describe("ajustesHabilitados", () => {
  it("modo ausente é físico direto", () => {
    expect(ajustesHabilitados({ ...base, quantity: UMA, purityPercentApplied: null, overagePercent: null }))
      .toEqual({ purity: false, overage: false });
  });

  it("teórico reporta exatamente as flags", () => {
    expect(
      ajustesHabilitados({
        ...base,
        quantity: UMA,
        purityPercentApplied: null,
        overagePercent: null,
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
        applyOverageAdjustment: false,
      }),
    ).toEqual({ purity: true, overage: false });
  });
});
