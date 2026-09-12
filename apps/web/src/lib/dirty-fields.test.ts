import { describe, expect, it } from "vitest";
import { assinaturaDoDocumento, decimalComparavel, inteiroComparavel, textoComparavel } from "./dirty-fields";

/**
 * A normalização que separa alteração de reescrita.
 *
 * A guarda de alterações não salvas compara o documento na tela com o
 * documento de referência. Sem isto ela pergunta onde não há perda — o
 * servidor devolve `10.000000`, a pessoa redigita `10`, e a tela anuncia
 * risco de perder o que é exatamente o mesmo número. Guarda que pergunta à
 * toa ensina a ignorar a pergunta que importa.
 *
 * O outro lado também é regra: normalizar não afrouxa. `10` e `10,5` seguem
 * diferentes, e o que a tela não sabe ler não é igual a nada.
 */

describe("decimal comparável", () => {
  it("a mesma quantidade escrita de vários jeitos é a mesma coisa", () => {
    const canonico = decimalComparavel("10");
    expect(decimalComparavel("10,0")).toBe(canonico);
    expect(decimalComparavel("10.0")).toBe(canonico);
    expect(decimalComparavel("10.000000")).toBe(canonico);
    expect(decimalComparavel(" 10 ")).toBe(canonico);
  });

  it("quantidade diferente continua diferente", () => {
    expect(decimalComparavel("10,5")).not.toBe(decimalComparavel("10"));
    expect(decimalComparavel("0,1")).not.toBe(decimalComparavel("0,10001"));
  });

  it("ausência e vazio são a mesma coisa: não informado", () => {
    expect(decimalComparavel("")).toBeNull();
    expect(decimalComparavel("   ")).toBeNull();
    expect(decimalComparavel(null)).toBeNull();
    expect(decimalComparavel(undefined)).toBeNull();
  });

  it("ilegível não é igual a nada — nem a zero, nem a vazio", () => {
    const ilegivel = decimalComparavel("abc");
    expect(ilegivel).not.toBeNull();
    expect(ilegivel).not.toBe(decimalComparavel("0"));
    expect(ilegivel).not.toBe(decimalComparavel(""));
    // O que a tela não sabe ler ela não sabe comparar: é pendência por definição.
    expect(decimalComparavel("abc")).toBe(ilegivel);
  });

  it("separador de milhar continua recusado — 1.234 não vira mil duzentos e trinta e quatro", () => {
    expect(decimalComparavel("1.234")).toBe(decimalComparavel("1,234"));
    expect(decimalComparavel("1.234")).not.toBe(decimalComparavel("1234"));
  });
});

describe("texto comparável", () => {
  it("ausência, vazio e só espaço são a mesma coisa", () => {
    expect(textoComparavel(null)).toBeNull();
    expect(textoComparavel("")).toBeNull();
    expect(textoComparavel("   ")).toBeNull();
  });

  it("espaço nas pontas não é conteúdo; no meio, é", () => {
    expect(textoComparavel(" Lote A ")).toBe(textoComparavel("Lote A"));
    expect(textoComparavel("Lote  A")).not.toBe(textoComparavel("Lote A"));
  });
});

describe("inteiro comparável", () => {
  it("o número do servidor e o texto do campo dão o mesmo", () => {
    expect(inteiroComparavel(3)).toBe(inteiroComparavel("3"));
    expect(inteiroComparavel(1)).not.toBe(inteiroComparavel("2"));
  });
});

describe("assinatura do documento", () => {
  it("mesmo conteúdo dá a mesma assinatura; um campo a mais muda tudo", () => {
    const a = assinaturaDoDocumento({ nome: "X", quantidade: decimalComparavel("10,0") });
    const b = assinaturaDoDocumento({ nome: "X", quantidade: decimalComparavel("10") });
    expect(a).toBe(b);

    const c = assinaturaDoDocumento({ nome: "X", quantidade: decimalComparavel("11") });
    expect(c).not.toBe(a);
  });

  it("a ordem das linhas é parte do documento", () => {
    const subir = assinaturaDoDocumento({ lines: [{ id: "a" }, { id: "b" }] });
    const descer = assinaturaDoDocumento({ lines: [{ id: "b" }, { id: "a" }] });
    expect(subir).not.toBe(descer);
  });
});
