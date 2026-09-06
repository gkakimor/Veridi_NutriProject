import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal.js";
import { ESCALA_TOTAL_TECNICO, fecharTotalTecnicoPersistido } from "./technical-total.js";

/**
 * A fronteira de persistência do TOTAL TÉCNICO — PREC-MIG-E / PREC-E-02.
 *
 * O motor soma e divide em 40 dígitos; a coluna guarda quatro casas. A escala
 * fica onde está por decisão do PO — nenhum consumidor destes valores recebe
 * mais de duas casas —, mas o corte passa a ser do domínio, com
 * `ROUND_HALF_UP` **declarado na chamada**.
 *
 * O teste que sustenta o hardening é o mesmo das outras duas fronteiras:
 * inverte o `Decimal.rounding` do processo para banker's e exige HALF_UP.
 */

/** O empate que separa HALF_UP de banker's: a 5ª casa é 5 e a 4ª é PAR. */
const EMPATE_DISCRIMINANTE = "2026.59385";

describe("fechamento do total técnico persistido", () => {
  it("o total do motor cabe na coluna: 40 dígitos → 4 casas", () => {
    const doMotor = new Decimal("2026.593820000000000000000000000000000000001");
    expect(fecharTotalTecnicoPersistido(doMotor).toFixed(4)).toBe("2026.5938");
  });

  it("a escala é a da coluna de total técnico", () => {
    expect(ESCALA_TOTAL_TECNICO).toBe(4);
  });

  it.each([
    ["não mexe no que já cabe", "2026.5938", "2026.5938"],
    ["duas casas históricas atravessam intactas", "2026.59", "2026.5900"],
    ["empate com 4ª casa PAR sobe", EMPATE_DISCRIMINANTE, "2026.5939"],
    ["empate com 4ª casa ÍMPAR sobe também", "2026.59375", "2026.5938"],
    ["logo abaixo do empate", "2026.5938449", "2026.5938"],
    ["logo acima do empate", "2026.5938451", "2026.5938"],
    ["valor mínimo da coluna sobrevive", "0.0001", "0.0001"],
    ["abaixo do mínimo vira zero", "0.00004", "0.0000"],
    ["zero continua zero", "0", "0.0000"],
  ])("%s: %s → %s", (_nome, entrada, esperado) => {
    expect(fecharTotalTecnicoPersistido(new Decimal(entrada)).toFixed(4)).toBe(esperado);
  });

  it("contribuição total NEGATIVA atravessa, e HALF_UP afasta do zero", () => {
    // Preço abaixo do custo mais comissão produz contribuição negativa na
    // faixa inteira. A fronteira não tem opinião sobre o sinal.
    expect(fecharTotalTecnicoPersistido(new Decimal("-1250.75005")).toFixed(4)).toBe("-1250.7501");
    expect(fecharTotalTecnicoPersistido(new Decimal("-1250.75")).toFixed(4)).toBe("-1250.7500");
  });

  it("não é banker's rounding — HALF_UP afasta do zero", () => {
    const valor = new Decimal(EMPATE_DISCRIMINANTE);
    expect(valor.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(4)).toBe("2026.5938");
    expect(fecharTotalTecnicoPersistido(valor).toFixed(4)).toBe("2026.5939");
  });

  it("sobrevive à troca do rounding global — o modo viaja na chamada", () => {
    /*
     * `Decimal.rounding` é global do processo, e o default de hoje é
     * `ROUND_HALF_UP` (4) — o que faria a chamada implícita passar mesmo sem o
     * modo declarado. Invertendo o global para banker's, só passa quem declara.
     *
     * A janela é síncrona e o valor original volta no `finally`.
     */
    const original = Decimal.rounding;
    expect(original).toBe(Decimal.ROUND_HALF_UP);
    try {
      Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });
      expect(fecharTotalTecnicoPersistido(new Decimal(EMPATE_DISCRIMINANTE)).toFixed(4)).toBe(
        "2026.5939",
      );
      expect(fecharTotalTecnicoPersistido(new Decimal("-1250.75005")).toFixed(4)).toBe(
        "-1250.7501",
      );
    } finally {
      Decimal.set({ rounding: original });
    }
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  it("devolve Decimal, nunca number", () => {
    const fechado = fecharTotalTecnicoPersistido(new Decimal("2026.5938451"));
    expect(fechado).toBeInstanceOf(Decimal);
    expect(typeof fechado).not.toBe("number");
  });

  it("é outra fronteira que a do resultado por unidade — §62 e §63", () => {
    // Total fecha em quatro; resultado por unidade fecha em doze. É a
    // assimetria de F-3, e ela é deliberada: uma função só para as duas
    // escalas apagaria a distinção que o PO decidiu manter.
    expect(ESCALA_TOTAL_TECNICO).not.toBe(12);
  });
});
