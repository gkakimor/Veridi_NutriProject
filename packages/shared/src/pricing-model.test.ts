import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal-config.js";
import { computePrice } from "./pricing-math.js";
import {
  DEFAULT_PRICING_MODEL,
  computePricingModelEffect,
  percentualDeImpostoSobreVenda,
  problemaDoDivisorDoPreco,
  taxProfileFit,
  validarModeloDePrecificacao,
  type PricingModelConfig,
  type PricingModelEffectInput,
} from "./pricing-model.js";

/**
 * Modelo de Precificação flexível — PRICING-TEMPLATE-FLEX-01, §84.
 *
 * Faixa de referência: 1.000 un, materiais R$ 3.000,00 (R$ 3,00/un) e cálculo
 * do ERP R$ 4.200,00 (R$ 1.200,00 de conversão). Margem 30%, comissão 5%.
 */

const FAIXA: Omit<PricingModelEffectInput, "model"> = {
  quantity: "1000",
  materialCostTotal: "3000",
  materialCostQuality: "COMPLETE_REAL_REFERENCE",
  calculatedCostTotal: "4200",
  calculatedCostQuality: "COMPLETE_REAL_REFERENCE",
};

const modelo = (overrides: Partial<PricingModelConfig> = {}): PricingModelConfig => ({
  ...DEFAULT_PRICING_MODEL,
  ...overrides,
});

const efeito = (overrides: Partial<PricingModelConfig> = {}, faixa = FAIXA) =>
  computePricingModelEffect({ ...faixa, model: modelo(overrides) });

/** Preço pela margem sobre o custo que o Modelo formou — a conta canônica. */
function preco(overrides: Partial<PricingModelConfig> = {}, margem = "30", comissao = "5") {
  const e = efeito(overrides);
  return computePrice({
    priceMode: "TARGET_MARGIN",
    quantity: FAIXA.quantity,
    costPerUnit: e.pricingCostPerUnit,
    targetMarginPercent: margem,
    commissionPercent: comissao,
    manualUnitPrice: null,
    estimatedTaxPercent: e.estimatedTaxPercent,
  });
}

const casas = (valor: string | null, n = 8) => (valor === null ? null : new Decimal(valor).toFixed(n));

describe("custo industrial", () => {
  it("regressão: Modelo padrão = o custo do cálculo do ERP e o MESMO preço de antes", () => {
    const e = efeito();
    expect(e.pricingCostTotal).toBe("4200");
    expect(e.pricingCostPerUnit).toBe("4.2");
    expect(e.industrialCostAmount).toBe("1200");
    // A conta de antes, com o custo por unidade do ERP, e a de agora: iguais,
    // dígito a dígito.
    const antes = computePrice({
      priceMode: "TARGET_MARGIN",
      quantity: "1000",
      costPerUnit: new Decimal("4200").dividedBy("1000").toString(),
      targetMarginPercent: "30",
      commissionPercent: "5",
      manualUnitPrice: null,
    });
    expect(preco()).toEqual(antes);
    expect(casas(antes.suggestedUnitPrice)).toBe("6.46153846");
  });

  it("IGNORE: fora da conta — o preço se forma sobre os materiais", () => {
    const e = efeito({ industrialCostMode: "IGNORE" });
    expect(e.pricingCostPerUnit).toBe("3");
    expect(e.industrialCostAmount).toBeNull();
    expect(casas(preco({ industrialCostMode: "IGNORE" }).suggestedUnitPrice)).toBe("4.61538462");
  });

  it("% sobre custo de materiais: materiais × percentual", () => {
    const e = efeito({ industrialCostMode: "PERCENT_MATERIAL_COST", industrialCostPercentOfMaterials: "12" });
    expect(e.industrialCostAmount).toBe("360");
    expect(e.pricingCostPerUnit).toBe("3.36");
  });

  it("R$ por unidade: valor × quantidade", () => {
    const e = efeito({ industrialCostMode: "PER_UNIT", industrialCostAmountPerUnit: "0.8" });
    expect(e.industrialCostAmount).toBe("800");
    expect(e.pricingCostPerUnit).toBe("3.8");
  });

  it("R$ total: o valor entra UMA vez no cálculo da faixa", () => {
    const e = efeito({ industrialCostMode: "TOTAL", industrialCostAmountTotal: "500" });
    expect(e.industrialCostAmount).toBe("500");
    expect(e.pricingCostPerUnit).toBe("3.5");
    // A mesma premissa em outra quantidade continua sendo R$ 500 — não escala.
    const dobro = efeito(
      { industrialCostMode: "TOTAL", industrialCostAmountTotal: "500" },
      { ...FAIXA, quantity: "2000", materialCostTotal: "6000", calculatedCostTotal: "8400" },
    );
    expect(dobro.industrialCostAmount).toBe("500");
    expect(dobro.pricingCostPerUnit).toBe("3.25");
  });

  it('"não considerar" não é zero: mesmo preço, estados diferentes', () => {
    const fora = efeito({ industrialCostMode: "IGNORE" });
    const zero = efeito({ industrialCostMode: "PER_UNIT", industrialCostAmountPerUnit: "0" });
    expect(zero.pricingCostPerUnit).toBe(fora.pricingCostPerUnit);
    expect(fora.industrialCostAmount).toBeNull();
    expect(zero.industrialCostAmount).toBe("0");
  });

  it("energia sem tarifa não trava o preço de um Modelo que não usa o cálculo", () => {
    const parcial = { ...FAIXA, calculatedCostTotal: null, calculatedCostQuality: "PARTIAL" as const };
    const padrao = efeito({}, parcial);
    expect(padrao.pricingCostPerUnit).toBeNull();
    expect(padrao.pricingCostQuality).toBe("PARTIAL");

    const porUnidade = efeito({ industrialCostMode: "PER_UNIT", industrialCostAmountPerUnit: "0.8" }, parcial);
    expect(porUnidade.pricingCostPerUnit).toBe("3.8");
    expect(porUnidade.pricingCostQuality).toBe("COMPLETE_REAL_REFERENCE");
  });

  it("material sem custo continua bloqueando — em qualquer modo", () => {
    const semMaterial = {
      ...FAIXA,
      materialCostTotal: null,
      materialCostQuality: "PARTIAL" as const,
      calculatedCostTotal: null,
      calculatedCostQuality: "PARTIAL" as const,
    };
    for (const overrides of [
      { industrialCostMode: "IGNORE" as const },
      { industrialCostMode: "PERCENT_MATERIAL_COST" as const, industrialCostPercentOfMaterials: "12" },
      { industrialCostMode: "PER_UNIT" as const, industrialCostAmountPerUnit: "0.8" },
    ]) {
      expect(efeito(overrides, semMaterial).pricingCostPerUnit).toBeNull();
    }
  });
});

describe("impostos estimados", () => {
  it("IGNORE: nada entra", () => {
    const e = efeito({ estimatedTaxMode: "IGNORE", estimatedTaxAmountPerUnit: "9" });
    expect(e.estimatedTaxAmount).toBeNull();
    expect(e.estimatedTaxPercent).toBeNull();
    expect(e.pricingCostPerUnit).toBe("4.2");
  });

  it("R$ por unidade: valor × quantidade, somado ao custo", () => {
    const e = efeito({ estimatedTaxMode: "PER_UNIT", estimatedTaxAmountPerUnit: "0.25" });
    expect(e.estimatedTaxAmount).toBe("250");
    expect(e.pricingCostPerUnit).toBe("4.45");
  });

  it("R$ total: uma vez", () => {
    const e = efeito({ estimatedTaxMode: "TOTAL", estimatedTaxAmountTotal: "100" });
    expect(e.estimatedTaxAmount).toBe("100");
    expect(e.pricingCostPerUnit).toBe("4.3");
  });

  it("% sobre o preço de venda vai ao DIVISOR, não ao custo: P = C ÷ (1 − m − c − t)", () => {
    const e = efeito({ estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "10" });
    expect(e.pricingCostPerUnit).toBe("4.2");
    expect(e.estimatedTaxPercent).toBe("10");

    const r = preco({ estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "10" });
    // 4,20 ÷ (1 − 0,30 − 0,05 − 0,10) = 4,20 ÷ 0,55.
    expect(casas(r.suggestedUnitPrice)).toBe("7.63636364");
    expect(casas(r.estimatedTaxPerUnit)).toBe("0.76363636");
    // O imposto sai de dentro do preço: a margem que sobra é a pedida.
    expect(casas(r.contributionMarginPercent, 6)).toBe("30.000000");
  });
});

describe("gestão externa", () => {
  const configurado = {
    industrialCostMode: "PERCENT_MATERIAL_COST" as const,
    industrialCostPercentOfMaterials: "12",
    estimatedTaxMode: "PERCENT_SALE_PRICE" as const,
    estimatedTaxPercentOfSalePrice: "10",
  };

  it("ligada: custo industrial e impostos fora da conta, materiais continuam", () => {
    const e = efeito({ ...configurado, externalAdditionalCosts: true });
    expect(e.pricingCostPerUnit).toBe("3");
    expect(e.industrialCostAmount).toBeNull();
    expect(e.estimatedTaxPercent).toBeNull();
    expect(casas(preco({ ...configurado, externalAdditionalCosts: true }).suggestedUnitPrice)).toBe("4.61538462");
  });

  it("desligada de novo: os MESMOS valores voltam a participar — nada foi apagado", () => {
    const config = modelo({ ...configurado, externalAdditionalCosts: true });
    computePricingModelEffect({ ...FAIXA, model: config });
    expect(config.industrialCostPercentOfMaterials).toBe("12");
    expect(config.estimatedTaxPercentOfSalePrice).toBe("10");

    const religado = efeito({ ...configurado, externalAdditionalCosts: false });
    expect(religado.pricingCostPerUnit).toBe("3.36");
    expect(religado.estimatedTaxPercent).toBe("10");
  });

  it("margem e comissão continuam no preço — não são custo adicional", () => {
    const r = preco({ ...configurado, externalAdditionalCosts: true }, "30", "5");
    expect(casas(r.contributionMarginPercent, 6)).toBe("30.000000");
    expect(percentualDeImpostoSobreVenda(modelo({ ...configurado, externalAdditionalCosts: true }))).toBeNull();
  });
});

describe("valores preservados", () => {
  it("trocar de modo não lê nem apaga o valor de outro modo", () => {
    const guardado = {
      industrialCostPercentOfMaterials: "12",
      industrialCostAmountPerUnit: "0.8",
      industrialCostAmountTotal: "500",
    };
    expect(efeito({ ...guardado, industrialCostMode: "IGNORE" }).pricingCostPerUnit).toBe("3");
    expect(efeito({ ...guardado, industrialCostMode: "PERCENT_MATERIAL_COST" }).pricingCostPerUnit).toBe("3.36");
    expect(efeito({ ...guardado, industrialCostMode: "PER_UNIT" }).pricingCostPerUnit).toBe("3.8");
    expect(validarModeloDePrecificacao(modelo({ ...guardado, industrialCostMode: "IGNORE" }))).toBeNull();
  });
});

describe("validação do Modelo", () => {
  it("modo que lê um valor exige o valor — zero vale, ausência não", () => {
    expect(validarModeloDePrecificacao(modelo({ industrialCostMode: "PER_UNIT" }))).toMatch(/informe o valor/);
    expect(
      validarModeloDePrecificacao(modelo({ industrialCostMode: "PER_UNIT", industrialCostAmountPerUnit: "0" })),
    ).toBeNull();
    expect(validarModeloDePrecificacao(modelo({ estimatedTaxMode: "TOTAL" }))).toMatch(/Impostos estimados/);
  });

  it("recusa NaN, Infinity, negativo, notação científica e texto", () => {
    for (const valor of ["NaN", "Infinity", "-1", "1e3", "abc", ""]) {
      expect(
        validarModeloDePrecificacao(modelo({ industrialCostMode: "PER_UNIT", industrialCostAmountPerUnit: valor })),
      ).toMatch(/valor numérico válido/);
    }
  });

  it("faixas e casas: imposto sobre venda abaixo de 100%, percentual com até 4 casas", () => {
    expect(
      validarModeloDePrecificacao(
        modelo({ estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "100" }),
      ),
    ).toMatch(/abaixo de 100%/);
    expect(
      validarModeloDePrecificacao(
        modelo({ industrialCostMode: "PERCENT_MATERIAL_COST", industrialCostPercentOfMaterials: "12.12345" }),
      ),
    ).toMatch(/4 casas/);
    // Sobre materiais pode passar de 100%: conversão mais cara que o insumo.
    expect(
      validarModeloDePrecificacao(
        modelo({ industrialCostMode: "PERCENT_MATERIAL_COST", industrialCostPercentOfMaterials: "150" }),
      ),
    ).toBeNull();
  });
});

describe("denominador inválido", () => {
  it("margem + comissão + imposto ≥ 100%: recusa em português, nunca Infinity", () => {
    expect(
      problemaDoDivisorDoPreco({ targetMarginPercent: "60", commissionPercent: "5", estimatedTaxPercent: "35" }),
    ).toMatch(/somam 100% ou mais/);
    expect(
      problemaDoDivisorDoPreco({ targetMarginPercent: "70", commissionPercent: "30", estimatedTaxPercent: null }),
    ).toBe("Margem somada à comissão atinge 100% — não existe preço que satisfaça.");
    expect(
      problemaDoDivisorDoPreco({ targetMarginPercent: "30", commissionPercent: "5", estimatedTaxPercent: "10" }),
    ).toBeNull();

    const r = preco({ estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "40" }, "60", "0");
    expect(r.suggestedUnitPrice).toBeNull();
    expect(r.selectedUnitPrice).toBeNull();
    expect(r.warnings.map((w) => w.code)).toEqual(["TARGET_PRICE_IMPOSSIBLE"]);
  });
});

describe("perfil tributário do Cliente", () => {
  it("Modelo sem restrição: compatível com todos", () => {
    expect(taxProfileFit([], "LUCRO_REAL")).toBe("UNRESTRICTED");
    expect(taxProfileFit([], null)).toBe("UNRESTRICTED");
  });

  it("Simples Nacional × cliente Simples: indicado; × Lucro Real: não indicado", () => {
    expect(taxProfileFit(["SIMPLES_NACIONAL"], "SIMPLES_NACIONAL")).toBe("COMPATIBLE");
    expect(taxProfileFit(["SIMPLES_NACIONAL"], "LUCRO_REAL")).toBe("NOT_RECOMMENDED");
  });

  it("cliente sem perfil informado não é dito incompatível: é desconhecido", () => {
    expect(taxProfileFit(["SIMPLES_NACIONAL"], "NOT_INFORMED")).toBe("CUSTOMER_PROFILE_UNKNOWN");
    expect(taxProfileFit(["SIMPLES_NACIONAL"], null)).toBe("CUSTOMER_PROFILE_UNKNOWN");
  });
});
