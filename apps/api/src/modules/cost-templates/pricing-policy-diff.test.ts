import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING_MODEL } from "@veridi/shared";
import type { PricingModelConfig } from "@veridi/shared";
import { compararPoliticas } from "./pricing-policies.service.js";

/**
 * PRICING-MODEL-DIFF-01 — "Comparar versões" da política compara a regra
 * econômica inteira: o Modelo de Precificação (§84) e as faixas.
 *
 * Antes, só as faixas entravam: trocar o modo do custo industrial, o valor que
 * ele lê, os impostos ou a gestão externa dava "Nada muda entre as duas
 * versões" — e mudava o preço de todo produto que usasse a política.
 */

const FAIXAS = [
  { quantity: "500", uomCode: "un", margin: "35", commission: "5" },
  { quantity: "1000", uomCode: "un", margin: "32", commission: "5" },
];

function politica(
  opcoes: { label?: string; model?: Partial<PricingModelConfig>; tiers?: typeof FAIXAS } = {},
) {
  return {
    label: opcoes.label ?? "TPP-000001 · V1",
    model: { ...DEFAULT_PRICING_MODEL, ...opcoes.model },
    tiers: opcoes.tiers ?? FAIXAS,
  };
}

const resumo = (diff: ReturnType<typeof compararPoliticas>) =>
  diff.entries.map((entry) => [entry.kind, entry.field, entry.from, entry.to]);

describe("diff da política — Modelo e faixas", () => {
  it("modelo idêntico, faixas idênticas: nada muda", () => {
    expect(compararPoliticas(politica(), politica()).entries).toEqual([]);
    const configurado = politica({
      model: {
        industrialCostMode: "PER_UNIT",
        industrialCostAmountPerUnit: "0.5",
        estimatedTaxMode: "PERCENT_SALE_PRICE",
        estimatedTaxPercentOfSalePrice: "10",
      },
    });
    expect(compararPoliticas(configurado, politica({ model: configurado.model })).entries).toEqual([]);
  });

  it("só o rótulo muda: título do diff, nenhuma diferença de regra", () => {
    const diff = compararPoliticas(politica(), politica({ label: "TPP-000001 · V2" }));
    expect(diff.fromLabel).toBe("TPP-000001 · V1");
    expect(diff.toLabel).toBe("TPP-000001 · V2");
    expect(diff.entries).toEqual([]);
  });

  it("faixa muda: diferença de faixa, nenhuma do Modelo", () => {
    const diff = compararPoliticas(
      politica(),
      politica({ tiers: [FAIXAS[0]!, { ...FAIXAS[1]!, margin: "30" }] }),
    );
    expect(resumo(diff)).toEqual([["TIER_CHANGED", "Margem alvo", "32", "30"]]);
  });

  it("configuração econômica muda sem mexer em faixa: modo e o valor que ele lê aparecem", () => {
    const diff = compararPoliticas(
      politica(),
      politica({ model: { industrialCostMode: "PER_UNIT", industrialCostAmountPerUnit: "0.5" } }),
    );
    expect(resumo(diff)).toEqual([
      [
        "MODEL_CHANGED",
        "Custo industrial",
        "Conforme a Estrutura de Custos (cálculo do ERP)",
        "R$ por unidade",
      ],
      ["MODEL_CHANGED", "Custo industrial (R$ por unidade)", null, "0.5"],
    ]);
  });

  it("valor do mesmo modo, impostos e gestão externa — cada um é diferença", () => {
    const de = politica({
      model: { industrialCostMode: "PERCENT_MATERIAL_COST", industrialCostPercentOfMaterials: "12" },
    });
    const para = politica({
      model: {
        industrialCostMode: "PERCENT_MATERIAL_COST",
        industrialCostPercentOfMaterials: "15",
        estimatedTaxMode: "TOTAL",
        estimatedTaxAmountTotal: "100",
        externalAdditionalCosts: true,
      },
    });
    expect(resumo(compararPoliticas(de, para))).toEqual([
      ["MODEL_CHANGED", "Custo industrial (% sobre custo de materiais)", "12", "15"],
      ["MODEL_CHANGED", "Impostos estimados", "Não considerar", "R$ total"],
      ["MODEL_CHANGED", "Impostos estimados (R$ total)", null, "100"],
      ["MODEL_CHANGED", "Custos adicionais administrados externamente", "Não", "Sim"],
    ]);
  });

  it("mesmo número com outra escala não é diferença: 12.0000 = 12", () => {
    const de = politica({
      model: { estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "12.0000" },
    });
    const para = politica({
      model: { estimatedTaxMode: "PERCENT_SALE_PRICE", estimatedTaxPercentOfSalePrice: "12" },
    });
    expect(compararPoliticas(de, para).entries).toEqual([]);
  });

  it("valor guardado de modo desligado não entra em preço — e não entra no diff", () => {
    const de = politica({ model: { industrialCostMode: "IGNORE", industrialCostAmountPerUnit: "9" } });
    const para = politica({ model: { industrialCostMode: "IGNORE", industrialCostAmountPerUnit: "10" } });
    expect(compararPoliticas(de, para).entries).toEqual([]);
  });

  it("Modelo e faixa mudam juntos: as duas diferenças, Modelo primeiro", () => {
    const diff = compararPoliticas(
      politica(),
      politica({
        model: { externalAdditionalCosts: true },
        tiers: [FAIXAS[0]!, { ...FAIXAS[1]!, commission: "3" }],
      }),
    );
    expect(resumo(diff)).toEqual([
      ["MODEL_CHANGED", "Custos adicionais administrados externamente", "Não", "Sim"],
      ["TIER_CHANGED", "Comissão", "5", "3"],
    ]);
  });
});
