import { describe, expect, it } from "vitest";
import { splitDecimal } from "@veridi/shared";
import { formatPartShare } from "./part-share";
import { formatQuantity } from "./quantity";

/**
 * Rateio por parte no documento impresso — #21.
 *
 * O papel da Ordem de Produção dividia sozinho:
 *
 *     `${(Number(requiredQuantity) / numberOfParts).toFixed(6)} × ${numberOfParts}`
 *
 * Dois defeitos. O float é o menor deles: o grave é a frase "N partes iguais",
 * que o motor da produção nunca executou. Quem pesa lê a Folha de Receita, e a
 * folha traz outro número.
 */

/** A conta que estava no documento, para medir a distância — nunca para usar. */
function comoOImpressoFaziaAntes(total: string, partes: number): string {
  return `${(Number(total) / partes).toFixed(6)} × ${partes}`;
}

describe("a classe do problema, com o código antigo", () => {
  it("o papel anunciava um valor que parte NENHUMA seria pesada", () => {
    // 2 kg em 3 partes. O motor da produção planeja assim:
    const doMotor = splitDecimal("2", 3).map((parte) => parte.toString());
    expect(doMotor).toEqual(["0.666666", "0.666666", "0.666668"]);

    // E o impresso dizia isto:
    expect(comoOImpressoFaziaAntes("2", 3)).toBe("0.666667 × 3");

    // `0.666667` não é nenhuma das três. O documento afirmava uma pesagem que
    // a ordem não tem.
    expect(doMotor).not.toContain("0.666667");
  });

  it("as partes anunciadas não somavam o total da ordem", () => {
    // Três vezes 0,666667 é 2,000001 — mais material do que a OP planejou.
    expect(Number("0.666667") * 3).toBeCloseTo(2.000001, 12);
    // Pelo motor, a soma fecha exatamente.
    const soma = splitDecimal("2", 3).reduce((total, parte) => total.plus(parte), splitDecimal("0", 1)[0]!);
    expect(soma.toString()).toBe("2");
  });

  it("para baixo o erro é o mesmo, na direção oposta", () => {
    // 10 kg em 3: o impresso somava 9,999999 — faltando material no papel.
    expect(comoOImpressoFaziaAntes("10", 3)).toBe("3.333333 × 3");
    expect(Number("3.333333") * 3).toBeCloseTo(9.999999, 12);
    expect(splitDecimal("10", 3).map((p) => p.toString())).toEqual([
      "3.333333",
      "3.333333",
      "3.333334",
    ]);
  });

  it("e o float aparece sozinho quando a quantidade tem dígitos demais", () => {
    /*
     * `DECIMAL(24,12)` guarda 24 dígitos significativos; um `double` guarda
     * ~15. Esta quantidade cabe na coluna e não cabe no float — a divisão já
     * começa errada, antes de qualquer arredondamento.
     */
    const total = "999999999999.000000000003";
    expect(Number(total)).toBe(999999999999);
    expect(comoOImpressoFaziaAntes(total, 3)).toBe("333333333333.000000 × 3");
    // Pelo motor, a terceira parte carrega os dígitos que o float perdeu.
    expect(splitDecimal(total, 3).map((p) => p.toString())).toEqual([
      "333333333333",
      "333333333333",
      "333333333333.000000000003",
    ]);
  });
});

describe("formatPartShare", () => {
  it("divisão exata mantém a forma curta de sempre", () => {
    expect(formatPartShare("9", 3)).toBe("3 × 3");
    expect(formatPartShare("100", 4)).toBe("25 × 4");
  });

  it("quando a última parte difere, o documento diz isso", () => {
    expect(formatPartShare("2", 3)).toBe("0,666666 × 2 + 0,666668");
    expect(formatPartShare("10", 3)).toBe("3,333333 × 2 + 3,333334");
  });

  it("em duas partes são só as duas parcelas", () => {
    expect(formatPartShare("1", 2)).toBe("0,5 × 2");
    // A sobra da segunda parte é 0,5000005; a exibição corta em seis casas,
    // HALF_UP — o cálculo é exato, a apresentação é que decide (§65).
    expect(formatPartShare("1.0000005", 2)).toBe("0,5 + 0,500001");
  });

  it("parte única não tem rateio — travessão, como no resto do documento", () => {
    expect(formatPartShare("10", 1)).toBe("—");
    expect(formatPartShare("10", 0)).toBe("—");
  });

  it("quantidade ausente ou ilegível não derruba o documento", () => {
    expect(formatPartShare(null, 3)).toBe("—");
    expect(formatPartShare(undefined, 3)).toBe("—");
    expect(formatPartShare("", 3)).toBe("—");
    expect(formatPartShare("abc", 3)).toBe("—");
  });

  it("zero rateado continua zero, nunca travessão nem NaN", () => {
    expect(formatPartShare("0", 3)).toBe("0 × 3");
    expect(formatPartShare("0.000000000000", 4)).toBe("0 × 4");
  });

  it("vírgula decimal, como todo o resto do documento em português", () => {
    // A coluna antiga era a única da linha com ponto: `3.333333 × 3`.
    expect(formatPartShare("10", 3)).toContain(",");
    expect(formatPartShare("10", 3)).not.toContain("3.333333");
  });

  it("o cálculo é exato; só a apresentação corta em seis casas", () => {
    /*
     * `1 / 3` dá 0,333333333... O rateio já trunca em seis (é a escala
     * operacional), e o formatador não precisa cortar nada. Mas a ÚLTIMA parte
     * carrega o resto com todas as casas, e é ali que a apresentação decide.
     */
    const partes = splitDecimal("1.0000000000009", 3);
    expect(partes[2]!.toString()).toBe("0.3333340000009");
    // Exibida com seis casas, HALF_UP — §65.
    expect(formatPartShare("1.0000000000009", 3)).toBe("0,333333 × 2 + 0,333334");
  });

  it("quantidade grande do domínio não perde dígito no caminho", () => {
    // Cabe em DECIMAL(24,12) e não cabe num double.
    expect(formatPartShare("999999999999.000000000003", 3)).toBe(
      "333333333333 × 2 + 333333333333",
    );
  });

  it("parte que o rateio zera é zero; a sobra pequena é ≈ 0", () => {
    /*
     * 0,0000009 em 3: cada parte daria 0,0000003, abaixo da escala do rateio,
     * e o truncamento as zera DE VERDADE — as duas primeiras não recebem
     * material, e a terceira carrega tudo. O documento diz as duas coisas com
     * palavras diferentes: `0` é a parte planejada como nada, `≈ 0` é o resto
     * pequeno demais para seis casas — que existe e não pode ser lido como
     * "não precisa de material" (§65).
     */
    expect(formatPartShare("0.0000009", 3)).toBe("0 × 2 + ≈ 0");
  });
});

describe("o impresso e a execução usam o MESMO rateio", () => {
  it("cada parcela exibida é a parte que o motor planeja", () => {
    /*
     * O que a Folha de Receita mostra em `plannedQuantity` sai de `partShare`,
     * no servidor. Aqui o documento da OP chega aos mesmos números pela mesma
     * função — não por uma segunda conta que precise ser mantida em sincronia.
     */
    for (const [total, partes] of [
      ["2", 3],
      ["10", 3],
      ["7.5", 4],
      ["100", 7],
    ] as const) {
      const doMotor = splitDecimal(total, partes);
      const texto = formatPartShare(total, partes);
      expect(texto).toContain(formatQuantity(doMotor[0]!.toString()));
      expect(texto).toContain(formatQuantity(doMotor[partes - 1]!.toString()));
    }
  });
});
