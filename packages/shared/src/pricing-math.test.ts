import { describe, expect, it } from "vitest";
import { computePrice } from "./pricing-math.js";

/**
 * A conta canônica do preço da faixa (P = C ÷ (1 − margem − comissão)),
 * pura, a mesma que a API embrulha e que a prévia da tela chama.
 */
describe("computePrice — preço pela margem", () => {
  it("custo ÷ (1 − margem − comissão), sem arredondar antes", () => {
    const r = computePrice({
      priceMode: "TARGET_MARGIN",
      quantity: "1000",
      costPerUnit: "10.001",
      targetMarginPercent: "30",
      commissionPercent: "5",
      manualUnitPrice: null,
    });
    // 10,001 ÷ 0,65 — o mesmo valor que a API grava com 6 casas: 15.386154.
    expect(Number(r.suggestedUnitPrice).toFixed(6)).toBe("15.386154");
    expect(r.selectedUnitPrice).toBe(r.suggestedUnitPrice);
    expect(Number(r.contributionMarginPercent).toFixed(4)).toBe("30.0000");
    expect(Number(r.commissionPerUnit).toFixed(6)).toBe(
      (Number(r.suggestedUnitPrice) * 0.05).toFixed(6),
    );
    expect(r.warnings).toEqual([]);
  });

  it("muda com custo, margem e comissão — cada operando move o preço", () => {
    const base = { priceMode: "TARGET_MARGIN" as const, quantity: "500", manualUnitPrice: null };
    const p1 = computePrice({ ...base, costPerUnit: "3.20", targetMarginPercent: "35", commissionPercent: "5" });
    const p2 = computePrice({ ...base, costPerUnit: "4.00", targetMarginPercent: "35", commissionPercent: "5" });
    const p3 = computePrice({ ...base, costPerUnit: "3.20", targetMarginPercent: "40", commissionPercent: "5" });
    const p4 = computePrice({ ...base, costPerUnit: "3.20", targetMarginPercent: "35", commissionPercent: "10" });
    expect(Number(p1.suggestedUnitPrice).toFixed(4)).toBe("5.3333");
    expect(Number(p2.suggestedUnitPrice)).toBeGreaterThan(Number(p1.suggestedUnitPrice));
    expect(Number(p3.suggestedUnitPrice)).toBeGreaterThan(Number(p1.suggestedUnitPrice));
    expect(Number(p4.suggestedUnitPrice)).toBeGreaterThan(Number(p1.suggestedUnitPrice));
  });

  it("margem + comissão em 100% é fail-closed: sem preço, com aviso — nunca Infinity", () => {
    const r = computePrice({
      priceMode: "TARGET_MARGIN",
      quantity: "100",
      costPerUnit: "10",
      targetMarginPercent: "70",
      commissionPercent: "30",
      manualUnitPrice: null,
    });
    expect(r.suggestedUnitPrice).toBeNull();
    expect(r.selectedUnitPrice).toBeNull();
    expect(r.warnings.map((w) => w.code)).toEqual(["TARGET_PRICE_IMPOSSIBLE"]);
  });

  it("custo incompleto não vira preço pela margem", () => {
    const r = computePrice({
      priceMode: "TARGET_MARGIN",
      quantity: "100",
      costPerUnit: null,
      targetMarginPercent: "30",
      commissionPercent: "5",
      manualUnitPrice: null,
    });
    expect(r.suggestedUnitPrice).toBeNull();
    expect(r.warnings.map((w) => w.code)).toEqual(["TARGET_PRICE_UNAVAILABLE"]);
  });

  it("preço informado: contribuição, margem resultante e markup — negativa preservada", () => {
    const r = computePrice({
      priceMode: "MANUAL_PRICE",
      quantity: "10",
      costPerUnit: "10",
      targetMarginPercent: null,
      commissionPercent: "5",
      manualUnitPrice: "20",
    });
    expect(r.suggestedUnitPrice).toBeNull();
    expect(r.selectedUnitPrice).toBe("20");
    expect(r.commissionPerUnit).toBe("1");
    expect(r.contributionPerUnit).toBe("9");
    expect(r.contributionMarginPercent).toBe("45");
    expect(r.markupPercent).toBe("100");
    expect(r.grossRevenue).toBe("200");

    const abaixo = computePrice({ ...r, priceMode: "MANUAL_PRICE", quantity: "10", costPerUnit: "10", targetMarginPercent: null, commissionPercent: "5", manualUnitPrice: "8" });
    expect(abaixo.contributionPerUnit).toBe("-2.4");
    expect(abaixo.warnings.map((w) => w.code)).toEqual(["NEGATIVE_CONTRIBUTION"]);
  });

  it("custo zero: markup indefinido, não infinito", () => {
    const r = computePrice({
      priceMode: "MANUAL_PRICE",
      quantity: "1",
      costPerUnit: "0",
      targetMarginPercent: null,
      commissionPercent: "0",
      manualUnitPrice: "5",
    });
    expect(r.markupPercent).toBeNull();
    expect(r.warnings.map((w) => w.code)).toEqual(["MARKUP_UNDEFINED"]);
  });
});
