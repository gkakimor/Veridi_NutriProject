import { describe, expect, it } from "vitest";
import {
  formatDecimalInput,
  isValidDecimalInput,
  mensagemDecimalInvalido,
  parseDecimalInput,
} from "./decimal-input";

describe("entrada decimal em português", () => {
  it("aceita vírgula, que é como a pessoa digita", () => {
    expect(parseDecimalInput("0,85")).toBe("0.85");
    expect(parseDecimalInput("123,45")).toBe("123.45");
    expect(parseDecimalInput("1234,5678")).toBe("1234.5678");
  });

  it("continua aceitando ponto, que é o que já funcionava", () => {
    expect(parseDecimalInput("0.85")).toBe("0.85");
    expect(parseDecimalInput("123.45")).toBe("123.45");
  });

  it("aceita inteiro sem separador nenhum", () => {
    expect(parseDecimalInput("123")).toBe("123");
    expect(parseDecimalInput("0")).toBe("0");
  });

  it("ignora espaço em volta", () => {
    expect(parseDecimalInput("  7,5  ")).toBe("7.5");
  });

  it("recusa separador de milhar em vez de adivinhar", () => {
    // O erro que isto evita vale mil vezes o valor certo.
    expect(parseDecimalInput("1.234,56")).toBeNull();
    expect(parseDecimalInput("1,234.56")).toBeNull();
    expect(parseDecimalInput("1.234.567")).toBeNull();
  });

  it("um separador só é sempre casa decimal — a leitura que não infla", () => {
    expect(parseDecimalInput("1.234")).toBe("1.234");
    expect(parseDecimalInput("1,234")).toBe("1.234");
  });

  it("recusa o que não é número", () => {
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput("12a")).toBeNull();
    expect(parseDecimalInput("-5")).toBeNull();
    expect(parseDecimalInput(",")).toBeNull();
    expect(parseDecimalInput("12,")).toBeNull();
    expect(parseDecimalInput(",5")).toBeNull();
  });

  it("texto vazio é ausência, não erro — quem decide é o formulário", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
  });

  it("isValidDecimalInput concorda com parseDecimalInput", () => {
    for (const entrada of ["0,85", "0.85", "123", "1.234,56", "abc", ""]) {
      expect(isValidDecimalInput(entrada)).toBe(parseDecimalInput(entrada) !== null);
    }
  });

  it("formata de volta para português sem mexer na precisão", () => {
    expect(formatDecimalInput("0.85")).toBe("0,85");
    expect(formatDecimalInput("1234.5000")).toBe("1234,5000");
    expect(formatDecimalInput("10")).toBe("10");
    expect(formatDecimalInput(null)).toBe("");
    expect(formatDecimalInput(undefined)).toBe("");
    expect(formatDecimalInput("")).toBe("");
  });

  it("a mensagem de erro ensina o formato, não só reclama", () => {
    expect(mensagemDecimalInvalido()).toContain("vírgula ou ponto");
    expect(mensagemDecimalInvalido("Preço")).toContain("Preço");
    expect(mensagemDecimalInvalido()).not.toBe("Erro de validação");
  });
});
