import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal.js";
import {
  ESCALA_RESULTADO_TECNICO,
  fecharResultadoTecnicoPersistido,
} from "./technical-result.js";

/**
 * A fronteira de persistência do resultado técnico — PREC-MIG-D.
 *
 * O motor calcula em 40 dígitos; a coluna guarda doze casas. A redução é do
 * domínio, com `ROUND_HALF_UP` **declarado na chamada** — não herdado do
 * default do `decimal.js`. Um arredondamento que virou regra de domínio não
 * pode depender de um default que outra capability pode mudar de carona.
 *
 * Irmão de `technical-price.test.ts`, uma escala acima. O teste que sustenta o
 * hardening é o mesmo: inverte o `Decimal.rounding` do processo para banker's,
 * chama a fronteira e exige o resultado de HALF_UP.
 */

/** O empate que separa HALF_UP de banker's: a 13ª casa é 5 e a 12ª é PAR. */
const EMPATE_DISCRIMINANTE = "0.2026593333345";

describe("fechamento do resultado técnico persistido", () => {
  it("o resultado do motor cabe na coluna: 40 dígitos → 12 casas", () => {
    const doMotor = new Decimal("0.20265933333333333333333333333333333333");
    expect(fecharResultadoTecnicoPersistido(doMotor).toFixed(12)).toBe("0.202659333333");
  });

  it("a escala é a da coluna de resultado técnico", () => {
    expect(ESCALA_RESULTADO_TECNICO).toBe(12);
  });

  it.each([
    ["não mexe no que já cabe", "0.202659333333", "0.202659333333"],
    ["seis casas históricas atravessam intactas", "0.202659", "0.202659000000"],
    ["oito casas atravessam intactas", "0.20265933", "0.202659330000"],
    ["empate com 12ª casa PAR sobe", EMPATE_DISCRIMINANTE, "0.202659333335"],
    ["empate com 12ª casa ÍMPAR sobe também", "0.2026593333355", "0.202659333336"],
    ["logo abaixo do empate", "0.20265933333449", "0.202659333334"],
    ["logo acima do empate", "0.20265933333451", "0.202659333335"],
    ["valor mínimo da coluna sobrevive", "0.000000000001", "0.000000000001"],
    ["abaixo do mínimo vira zero", "0.0000000000004", "0.000000000000"],
    ["zero continua zero", "0", "0.000000000000"],
  ])("%s: %s → %s", (_nome, entrada, esperado) => {
    expect(fecharResultadoTecnicoPersistido(new Decimal(entrada)).toFixed(12)).toBe(esperado);
  });

  it("contribuição NEGATIVA atravessa, e HALF_UP afasta do zero", () => {
    // Preço abaixo do custo mais comissão é informação comercial legítima —
    // `NEGATIVE_CONTRIBUTION`. A fronteira não tem opinião sobre o sinal.
    expect(fecharResultadoTecnicoPersistido(new Decimal("-2.4444444444445")).toFixed(12)).toBe(
      "-2.444444444445",
    );
    expect(fecharResultadoTecnicoPersistido(new Decimal("-2.444444")).toFixed(12)).toBe(
      "-2.444444000000",
    );
  });

  it("não é banker's rounding — HALF_UP afasta do zero", () => {
    // O mesmo número pelos dois modos, lado a lado: se a fronteira usasse
    // banker's, `0.2026593333345` pararia em `0.202659333334`.
    const valor = new Decimal(EMPATE_DISCRIMINANTE);
    expect(valor.toDecimalPlaces(12, Decimal.ROUND_HALF_EVEN).toFixed(12)).toBe("0.202659333334");
    expect(fecharResultadoTecnicoPersistido(valor).toFixed(12)).toBe("0.202659333335");
  });

  it("sobrevive à troca do rounding global — o modo viaja na chamada", () => {
    /*
     * Este teste é o hardening. `Decimal.rounding` é global do processo, e o
     * default de hoje é `ROUND_HALF_UP` (4) — o que faria a chamada implícita
     * passar mesmo sem o modo declarado. Invertendo o global para banker's, só
     * passa quem declara o modo.
     *
     * A janela é síncrona e o valor original volta no `finally`: nada entre o
     * `set` e a restauração pode observar a configuração invertida.
     */
    const original = Decimal.rounding;
    expect(original).toBe(Decimal.ROUND_HALF_UP);
    try {
      Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });
      expect(fecharResultadoTecnicoPersistido(new Decimal(EMPATE_DISCRIMINANTE)).toFixed(12)).toBe(
        "0.202659333335",
      );
      expect(fecharResultadoTecnicoPersistido(new Decimal("-2.4444444444445")).toFixed(12)).toBe(
        "-2.444444444445",
      );
    } finally {
      Decimal.set({ rounding: original });
    }
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  it("devolve Decimal, nunca number", () => {
    const fechado = fecharResultadoTecnicoPersistido(new Decimal("0.20265933333451"));
    expect(fechado).toBeInstanceOf(Decimal);
    expect(typeof fechado).not.toBe("number");
  });

  it("é outra fronteira que a do preço — a escala pertence à categoria", () => {
    // Resultado técnico fecha em doze; preço técnico fecha em oito. Uma função
    // só para as duas escalas voltaria a cortar o que a coluna passou a
    // guardar — foi assim que comissão e contribuição perderam seis casas.
    expect(ESCALA_RESULTADO_TECNICO).not.toBe(8);
  });
});
