import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ESCALA_PRECO_COMERCIAL, fecharPrecoUnitarioComercial } from "./commercial-price.js";
import "./decimal.js";

/**
 * A fronteira técnica → comercial — `PRODUCT_RULES.md` §60.
 *
 * O corte de oito casas para quatro é DELIBERADO, e este arquivo é o que
 * impede que ele volte a parecer acidental. Enquanto estava escrito como
 * `.toFixed(4)` no meio de um `update`, era indistinguível dos cortes
 * silenciosos que a fundação numérica passou a caçar — e um `.toFixed(4)` que
 * ninguém sabe explicar acaba "corrigido" por engano.
 *
 * O modo de arredondamento NÃO é escolhido aqui: `decimal-config.ts` mexe em
 * `precision` e em nada mais, então `rounding` segue no `ROUND_HALF_UP` do
 * default — o mesmo do PostgreSQL, e o mesmo que o `.toFixed(4)` anterior já
 * aplicava. Os casos de empate abaixo existem para provar isso: se alguém
 * trocar o modo global, o centavo de todo documento comercial muda, e é aqui
 * que se descobre.
 */

describe("fechamento do preço unitário comercial", () => {
  it("o caso canônico: 4,05318764 fecha em 4,0532", () => {
    const fechado = fecharPrecoUnitarioComercial(new Prisma.Decimal("4.05318764"));
    expect(fechado.toFixed(4)).toBe("4.0532");
  });

  it("preserva o rounding mode do produto — HALF_UP, nunca banker's", () => {
    // A configuração canônica só toca em `precision`; `rounding` continua no
    // default. Se isto falhar, a mudança não é deste arquivo: é global.
    expect(Prisma.Decimal.rounding).toBe(Prisma.Decimal.ROUND_HALF_UP);

    // Empates exatos na quinta casa. Banker's rounding devolveria `4.0532`
    // nos dois — meio para o par —, e o documento fecharia outro centavo.
    expect(fecharPrecoUnitarioComercial(new Prisma.Decimal("4.05315")).toFixed(4)).toBe("4.0532");
    expect(fecharPrecoUnitarioComercial(new Prisma.Decimal("4.05325")).toFixed(4)).toBe("4.0533");
  });

  it.each([
    ["já em 4 casas, não mexe", "4.0531", "4.0531"],
    ["logo abaixo do empate", "4.05314999", "4.0531"],
    ["logo acima do empate", "4.05315001", "4.0532"],
    ["arredonda para cima e carrega a casa", "4.99995", "5.0000"],
    ["valor menor que o centésimo de milésimo vira zero", "0.00000001", "0.0000"],
    ["zero continua zero", "0", "0.0000"],
  ])("%s: %s → %s", (_nome, entrada, esperado) => {
    expect(fecharPrecoUnitarioComercial(new Prisma.Decimal(entrada)).toFixed(4)).toBe(esperado);
  });

  it("devolve Decimal, nunca number — o fechado ainda é operando de total", () => {
    const fechado = fecharPrecoUnitarioComercial(new Prisma.Decimal("4.05318764"));
    expect(fechado).toBeInstanceOf(Prisma.Decimal);
    expect(typeof fechado).not.toBe("number");
    // E é exatamente igual ao valor comercial, sem resíduo de double.
    expect(fechado.equals(new Prisma.Decimal("4.0532"))).toBe(true);
  });

  it("a escala é a da coluna comercial", () => {
    expect(ESCALA_PRECO_COMERCIAL).toBe(4);
  });

  it("não é arredondamento em cadeia: fechar duas vezes dá o mesmo número", () => {
    // Idempotência importa porque o valor fechado é copiado adiante — Pedido
    // e Faturamento recebem cópias exatas, e nenhuma delas pode mover o
    // centavo de novo.
    const uma = fecharPrecoUnitarioComercial(new Prisma.Decimal("4.05318764"));
    const duas = fecharPrecoUnitarioComercial(uma);
    expect(duas.equals(uma)).toBe(true);
  });
});
