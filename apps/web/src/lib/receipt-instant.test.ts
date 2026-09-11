import { describe, expect, it } from "vitest";
import { diaComercialCompacto, hojeComercial } from "@veridi/shared";
import { instanteDoRecebimento } from "./receipt-instant";

/**
 * O campo do Recebimento é DATA CIVIL; `receivedAt` é INSTANTE (§81), e o
 * código do lote, o movimento de estoque e a janela de custo leem o dia
 * comercial desse instante (§72). A meia-noite UTC de um dia é 21h do dia
 * anterior em São Paulo — por isso nenhuma conversão aqui passa por ela.
 */
describe("instanteDoRecebimento", () => {
  it("hoje é agora: o recebimento acontece quando é lançado", () => {
    const agora = new Date("2026-09-11T14:20:00.000Z");
    expect(instanteDoRecebimento("2026-09-11", agora)).toBe(agora.toISOString());
  });

  it("outro dia é o início daquele dia comercial, e o lote leva aquele dia", () => {
    const agora = new Date("2026-09-11T14:20:00.000Z");
    const instante = instanteDoRecebimento("2026-08-20", agora);
    expect(instante).toBe("2026-08-20T03:00:00.000Z");
    expect(diaComercialCompacto(new Date(instante))).toBe("20260820");
  });

  it("nunca devolve a meia-noite UTC — que em São Paulo é a véspera", () => {
    const agora = new Date("2026-09-11T14:20:00.000Z");
    const instante = instanteDoRecebimento("2026-09-05", agora);
    expect(instante).not.toBe("2026-09-05T00:00:00.000Z");
    expect(hojeComercial(new Date(instante))).toBe("2026-09-05");
  });

  it("entre 21h e meia-noite em São Paulo, 'hoje' continua sendo o dia da Veridi", () => {
    // 01:30 UTC do dia 11 é 22:30 do dia 10 em São Paulo.
    const agora = new Date("2026-09-11T01:30:00.000Z");
    expect(hojeComercial(agora)).toBe("2026-09-10");
    expect(instanteDoRecebimento("2026-09-10", agora)).toBe(agora.toISOString());
  });
});
