import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal.js";
import { ESCALA_PRECO_TECNICO, fecharPrecoTecnicoPersistido } from "./technical-price.js";

/**
 * A fronteira de persistência do preço técnico — `PRODUCT_RULES.md` §60.
 *
 * O motor calcula em 40 dígitos; a coluna guarda oito casas. A redução é do
 * domínio, com `ROUND_HALF_UP` **declarado na chamada** — não herdado do
 * default do `decimal.js`. Um arredondamento que virou regra de domínio não
 * pode depender de um default que outra capability pode mudar de carona.
 *
 * O teste que sustenta o hardening é "sobrevive à troca do rounding global":
 * ele inverte o `Decimal.rounding` do processo para banker's, chama a
 * fronteira e exige o resultado de HALF_UP. Se alguém remover o modo explícito
 * da chamada, esse teste falha — que é exatamente o alarme que o PO pediu.
 */

/** O empate que separa HALF_UP de banker's: a nona casa é 5 e a oitava é PAR. */
const EMPATE_DISCRIMINANTE = "4.053187645";

describe("fechamento do preço técnico persistido", () => {
  it("o resultado do motor cabe na coluna: 40 dígitos → 8 casas", () => {
    const doMotor = new Decimal("4.05318764123456789012345678901234567890");
    expect(fecharPrecoTecnicoPersistido(doMotor).toFixed(8)).toBe("4.05318764");
  });

  it("a escala é a da coluna técnica", () => {
    expect(ESCALA_PRECO_TECNICO).toBe(8);
  });

  it.each([
    ["não mexe no que já cabe", "4.05318764", "4.05318764"],
    ["empate com oitava casa PAR sobe", EMPATE_DISCRIMINANTE, "4.05318765"],
    ["empate com oitava casa ÍMPAR sobe também", "4.053187635", "4.05318764"],
    ["logo abaixo do empate", "4.0531876449", "4.05318764"],
    ["logo acima do empate", "4.0531876451", "4.05318765"],
    ["valor mínimo da coluna sobrevive", "0.00000001", "0.00000001"],
    ["abaixo do mínimo vira zero", "0.000000004", "0.00000000"],
    ["zero continua zero", "0", "0.00000000"],
  ])("%s: %s → %s", (_nome, entrada, esperado) => {
    expect(fecharPrecoTecnicoPersistido(new Decimal(entrada)).toFixed(8)).toBe(esperado);
  });

  it("não é banker's rounding — HALF_UP afasta do zero", () => {
    // O mesmo número pelos dois modos, lado a lado: se a fronteira usasse
    // banker's, `4.053187645` pararia em `4.05318764`.
    const valor = new Decimal(EMPATE_DISCRIMINANTE);
    expect(valor.toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toFixed(8)).toBe("4.05318764");
    expect(fecharPrecoTecnicoPersistido(valor).toFixed(8)).toBe("4.05318765");
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
      expect(fecharPrecoTecnicoPersistido(new Decimal(EMPATE_DISCRIMINANTE)).toFixed(8)).toBe(
        "4.05318765",
      );
    } finally {
      Decimal.set({ rounding: original });
    }
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  it("devolve Decimal, nunca number", () => {
    const fechado = fecharPrecoTecnicoPersistido(new Decimal("4.0531876451"));
    expect(fechado).toBeInstanceOf(Decimal);
    expect(typeof fechado).not.toBe("number");
  });

  /*
   * Sem caso negativo: preço não é grandeza com sinal neste domínio. A entrada
   * de faixa recusa o sinal na fronteira (`^\d+(\.\d+)?$`) e o preço sugerido
   * nasce de `custo ÷ denominador positivo`, com custo `>= 0`. Um teste com
   * `-4,05` provaria o comportamento de um cenário que não existe.
   */
});
