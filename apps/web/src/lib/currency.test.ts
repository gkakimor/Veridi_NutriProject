import { describe, expect, it } from "vitest";
import { formatBRL, formatUnitPriceBRL } from "./currency";

/**
 * Preço unitário e total são dois números diferentes, e a diferença aparece
 * no papel.
 *
 * O faturamento exibia `R$ 4,05` ao lado de um total de `R$ 498,53`,
 * calculado sobre o preço real `4,0531`. Quem conferisse o documento com uma
 * calculadora chegava a R$ 498,15. Os R$ 0,38 não eram erro de cálculo — o
 * cálculo estava certo — e sim um documento que escondia a metade do número
 * que o produzia.
 *
 * `Intl` insere espaço não separável entre símbolo e valor; as asserções
 * normalizam para não prender o teste a um detalhe de plataforma.
 */
const semNbsp = (texto: string) => texto.replace(/ /g, " ");

describe("formatUnitPriceBRL — de 2 a 4 casas, conforme o preço", () => {
  it("mostra as quatro casas quando elas existem", () => {
    expect(semNbsp(formatUnitPriceBRL("4.0531"))).toBe("R$ 4,0531");
  });

  it("mostra três quando a quarta é zero", () => {
    expect(semNbsp(formatUnitPriceBRL("4.0530"))).toBe("R$ 4,053");
  });

  it("preço redondo não carrega zeros de enfeite", () => {
    expect(semNbsp(formatUnitPriceBRL("4.0500"))).toBe("R$ 4,05");
    expect(semNbsp(formatUnitPriceBRL("4.05"))).toBe("R$ 4,05");
  });

  it("mantém as duas casas mínimas — preço inteiro ainda lê como dinheiro", () => {
    expect(semNbsp(formatUnitPriceBRL("4"))).toBe("R$ 4,00");
  });

  it("sem preço continua sendo travessão, nunca zero", () => {
    expect(formatUnitPriceBRL(null)).toBe("—");
    expect(formatUnitPriceBRL("nao-numero")).toBe("—");
  });

  /*
   * O ponto do achado: o número exibido tem de reproduzir o total impresso.
   */
  it("a conta do operador fecha com o que está na tela", () => {
    const precoExibido = semNbsp(formatUnitPriceBRL("4.0531"));
    const numero = Number(precoExibido.replace("R$ ", "").replace(",", "."));
    expect((numero * 123).toFixed(2)).toBe("498.53");
  });
});

describe("formatBRL — total continua com duas casas", () => {
  it("total de linha e de documento não ganham casas extras", () => {
    expect(semNbsp(formatBRL("498.5313"))).toBe("R$ 498,53");
    expect(semNbsp(formatBRL("1677.27"))).toBe("R$ 1.677,27");
  });

  it("valor ausente é travessão", () => {
    expect(formatBRL(null)).toBe("—");
  });
});
