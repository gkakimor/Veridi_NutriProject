import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal.js";
import { ESCALA_PRECO_COMERCIAL, fecharPrecoUnitarioComercial } from "./commercial-price.js";

/**
 * A fronteira técnica → comercial — `PRODUCT_RULES.md` §60.
 *
 * O corte de oito casas para quatro é DELIBERADO, e este arquivo é o que
 * impede que ele volte a parecer acidental. Enquanto estava escrito como
 * `.toFixed(4)` no meio de um `update`, era indistinguível dos cortes
 * silenciosos que a fundação numérica passou a caçar — e um `.toFixed(4)` que
 * ninguém sabe explicar acaba "corrigido" por engano.
 *
 * O modo de arredondamento é `ROUND_HALF_UP` **declarado na chamada**.
 * `decimal-config.ts` continua mexendo só em `precision` (§59): o centavo de
 * todo documento comercial do sistema não pode depender de um default global
 * que outra capability pode trocar de carona. Os empates abaixo, e o teste que
 * inverte o global, são o alarme.
 */

/** O empate que separa HALF_UP de banker's: a quinta casa é 5 e a quarta é PAR. */
const EMPATE_DISCRIMINANTE = "4.05325";

describe("fechamento do preço unitário comercial", () => {
  it("o caso canônico: 4,05318764 fecha em 4,0532", () => {
    const fechado = fecharPrecoUnitarioComercial(new Decimal("4.05318764"));
    expect(fechado.toFixed(4)).toBe("4.0532");
  });

  it("os empates do acceptance", () => {
    // Quarta casa ÍMPAR: HALF_UP e banker's concordam, e o valor sobe.
    expect(fecharPrecoUnitarioComercial(new Decimal("4.05315")).toFixed(4)).toBe("4.0532");
    // Quarta casa PAR: só HALF_UP sobe. Banker's pararia em 4,0532.
    expect(fecharPrecoUnitarioComercial(new Decimal("4.05325")).toFixed(4)).toBe("4.0533");
  });

  it("não é banker's rounding — HALF_UP afasta do zero", () => {
    const valor = new Decimal(EMPATE_DISCRIMINANTE);
    expect(valor.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(4)).toBe("4.0532");
    expect(fecharPrecoUnitarioComercial(valor).toFixed(4)).toBe("4.0533");
  });

  it("sobrevive à troca do rounding global — o modo viaja na chamada", () => {
    /*
     * Este teste é o hardening. `Decimal.rounding` é global do processo e o
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
      expect(fecharPrecoUnitarioComercial(new Decimal(EMPATE_DISCRIMINANTE)).toFixed(4)).toBe(
        "4.0533",
      );
    } finally {
      Decimal.set({ rounding: original });
    }
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  it.each([
    ["já em 4 casas, não mexe", "4.0531", "4.0531"],
    ["logo abaixo do empate", "4.05314999", "4.0531"],
    ["logo acima do empate", "4.05315001", "4.0532"],
    ["arredonda para cima e carrega a casa", "4.99995", "5.0000"],
    ["valor menor que o centésimo de milésimo vira zero", "0.00000001", "0.0000"],
    ["zero continua zero", "0", "0.0000"],
  ])("%s: %s → %s", (_nome, entrada, esperado) => {
    expect(fecharPrecoUnitarioComercial(new Decimal(entrada)).toFixed(4)).toBe(esperado);
  });

  it("devolve Decimal, nunca number — o fechado ainda é operando de total", () => {
    const fechado = fecharPrecoUnitarioComercial(new Decimal("4.05318764"));
    expect(fechado).toBeInstanceOf(Decimal);
    expect(typeof fechado).not.toBe("number");
    // E é exatamente igual ao valor comercial, sem resíduo de double.
    expect(fechado.equals(new Decimal("4.0532"))).toBe(true);
  });

  it("a escala é a da coluna comercial", () => {
    expect(ESCALA_PRECO_COMERCIAL).toBe(4);
  });

  it("não é arredondamento em cadeia: fechar duas vezes dá o mesmo número", () => {
    // Idempotência importa porque o valor fechado é copiado adiante — Pedido
    // e Faturamento recebem cópias exatas, e nenhuma delas pode mover o
    // centavo de novo.
    const uma = fecharPrecoUnitarioComercial(new Decimal("4.05318764"));
    const duas = fecharPrecoUnitarioComercial(uma);
    expect(duas.equals(uma)).toBe(true);
  });

  /*
   * Sem caso negativo: preço não é grandeza com sinal neste domínio. O preço
   * comercial nasce do técnico, que a fronteira de entrada já recusa com sinal
   * (`^\d+(\.\d+)?$`). Um teste com `-4,05` provaria cenário inexistente.
   */
});
