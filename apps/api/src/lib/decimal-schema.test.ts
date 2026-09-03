import { describe, expect, it } from "vitest";
import { decimalStringSchema } from "./decimal-schema.js";

/**
 * O contrato decimal visto de fora. O caso que motivou estes testes é real:
 * `0,85` digitado numa tarifa de recurso era recusado com "Erro de validação",
 * sem dizer que o problema era o separador — e a faixa de preço que dependia
 * dele deixava de existir sem ninguém perceber.
 */
describe("decimalStringSchema", () => {
  const schema = decimalStringSchema();

  it("aceita vírgula, que é como se digita em português", () => {
    expect(schema.parse("0,85")).toBe("0.85");
    expect(schema.parse("1234,5678")).toBe("1234.5678");
  });

  it("continua aceitando ponto e número", () => {
    expect(schema.parse("0.85")).toBe("0.85");
    expect(schema.parse("123")).toBe("123");
    expect(schema.parse(12.5)).toBe("12.5");
  });

  it("recusa separador de milhar em vez de adivinhar mil vezes errado", () => {
    expect(schema.safeParse("1.234,56").success).toBe(false);
    expect(schema.safeParse("1,234.56").success).toBe(false);
  });

  it("um separador só é sempre casa decimal", () => {
    expect(schema.parse("1.234")).toBe("1.234");
    expect(schema.parse("1,234")).toBe("1.234");
  });

  it("a mensagem ensina o formato em vez de só reclamar", () => {
    const resultado = schema.safeParse("abc");
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0]!.message).toContain("vírgula ou ponto");
    }
  });

  it("regras de sinal e zero seguem valendo", () => {
    expect(schema.safeParse("-5").success).toBe(false);
    expect(schema.safeParse("0").success).toBe(false);
    expect(decimalStringSchema({ allowZero: true }).parse("0")).toBe("0");
    expect(decimalStringSchema({ allowZero: true }).parse("0,0")).toBe("0.0");
  });
});
