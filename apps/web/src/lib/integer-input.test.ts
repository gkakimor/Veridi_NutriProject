import { describe, expect, it } from "vitest";
import { erroDeInteiro, lerInteiroOpcional, mensagemInteiroInvalido } from "./integer-input";

/**
 * Leitura estrita de inteiro — QUOTE-INT-FIELDS-01.
 *
 * O defeito era `Number(texto)`: `abc` virava `NaN`, e `NaN` vira `null` no
 * JSON — o erro de digitação apagava o valor gravado. A leitura agora tem três
 * saídas, e nenhuma delas é `NaN`.
 */

describe("lerInteiroOpcional", () => {
  it.each(["", "   ", "\t"])("%j é vazio — não informado", (texto) => {
    expect(lerInteiroOpcional(texto)).toEqual({ tipo: "vazio" });
  });

  it.each([
    ["30", 30],
    [" 30 ", 30],
    ["030", 30],
    ["0", 0],
    ["120", 120],
  ])("%j é o inteiro %i", (texto, valor) => {
    expect(lerInteiroOpcional(texto)).toEqual({ tipo: "valido", valor });
  });

  it.each([
    "abc",
    "30abc",
    "3 dias",
    "30,5",
    "30.5",
    "30.",
    "1e2",
    "0x1E",
    "-1",
    "+1",
    "Infinity",
    "NaN",
    // Maior que o maior inteiro seguro: nada de arredondar em silêncio.
    "9007199254740993",
  ])("%j é inválido — nunca truncado, arredondado ou convertido", (texto) => {
    expect(lerInteiroOpcional(texto)).toEqual({ tipo: "invalido" });
  });

  it("nenhuma leitura carrega NaN", () => {
    for (const texto of ["abc", "", "30", "1e2", "NaN", "-0", "30,5"]) {
      expect(JSON.stringify(lerInteiroOpcional(texto))).not.toContain("null");
      expect(Number.isNaN((lerInteiroOpcional(texto) as { valor?: number }).valor)).toBe(false);
    }
  });
});

describe("erroDeInteiro — a regra do campo, com os limites da API", () => {
  const parcelas = { minimo: 1, maximo: 120 } as const;
  const prazo = { minimo: 1, maximo: null } as const;

  it("vazio segue: quem decide se é obrigatório é o formulário", () => {
    expect(erroDeInteiro("Parcelas", "  ", parcelas)).toBeNull();
  });

  it("dentro dos limites segue", () => {
    expect(erroDeInteiro("Parcelas", "1", parcelas)).toBeNull();
    expect(erroDeInteiro("Parcelas", "120", parcelas)).toBeNull();
    expect(erroDeInteiro("Prazo", "9999", prazo)).toBeNull();
  });

  it.each(["0", "121", "abc", "3,5", "-2"])("%j não segue, e a mensagem diz a regra", (texto) => {
    expect(erroDeInteiro("Parcelas", texto, parcelas)).toBe(
      "Parcelas: informe um número inteiro de 1 a 120.",
    );
  });

  it("sem teto, a mensagem diz maior que zero", () => {
    expect(erroDeInteiro("Prazo de entrega (dias)", "0", prazo)).toBe(
      "Prazo de entrega (dias): informe um número inteiro maior que zero.",
    );
    expect(mensagemInteiroInvalido("Dias", { minimo: 5, maximo: null })).toBe(
      "Dias: informe um número inteiro a partir de 5.",
    );
  });
});
