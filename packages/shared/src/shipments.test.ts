import { describe, expect, it } from "vitest";
import { previaDeExpedicaoDoProduto } from "./shipments.js";

/**
 * O que a expedição em edição faz com um produto do pedido — a mesma soma
 * por produto e o mesmo teto por linha que o servidor aplica ao confirmar.
 */
describe("previaDeExpedicaoDoProduto", () => {
  it("expedição parcial: expedindo agora e restante depois", () => {
    const r = previaDeExpedicaoDoProduto({
      outstandingQuantity: "38",
      linhas: [
        { id: "a", reservedRemaining: "30", quantity: "20" },
        { id: "b", reservedRemaining: "10", quantity: "0" },
      ],
    });
    expect(r.expedindoAgora).toBe("20");
    expect(r.restanteDepois).toBe("18");
    expect(r.linhasAcimaDoReservado).toEqual([]);
    expect(r.acimaDoQueFalta).toBe(false);
  });

  it("vários lotes: a soma considera todas as linhas, não só a primeira", () => {
    const r = previaDeExpedicaoDoProduto({
      outstandingQuantity: "100",
      linhas: [
        { id: "a", reservedRemaining: "40", quantity: "40" },
        { id: "b", reservedRemaining: "40", quantity: "35.5" },
        { id: "c", reservedRemaining: "20", quantity: "0.5" },
      ],
    });
    expect(r.expedindoAgora).toBe("76");
    expect(r.restanteDepois).toBe("24");
  });

  it("linha acima do reservado é apontada pelo id", () => {
    const r = previaDeExpedicaoDoProduto({
      outstandingQuantity: "100",
      linhas: [
        { id: "a", reservedRemaining: "40", quantity: "41" },
        { id: "b", reservedRemaining: "40", quantity: "40" },
      ],
    });
    expect(r.linhasAcimaDoReservado).toEqual(["a"]);
  });

  it("soma acima do que falta expedir é dita, nunca um saldo negativo válido", () => {
    const r = previaDeExpedicaoDoProduto({
      outstandingQuantity: "50",
      linhas: [
        { id: "a", reservedRemaining: "40", quantity: "40" },
        { id: "b", reservedRemaining: "40", quantity: "22" },
      ],
    });
    expect(r.expedindoAgora).toBe("62");
    expect(r.acimaDoQueFalta).toBe(true);
    expect(r.restanteDepois).toBe("-12");
  });

  it("quantidade zero em tudo: nada a expedir, restante igual ao que falta", () => {
    const r = previaDeExpedicaoDoProduto({
      outstandingQuantity: "10",
      linhas: [{ id: "a", reservedRemaining: "10", quantity: "0" }],
    });
    expect(r.expedindoAgora).toBe("0");
    expect(r.restanteDepois).toBe("10");
  });

  it("decimais somam exato", () => {
    const r = previaDeExpedicaoDoProduto({
      outstandingQuantity: "1",
      linhas: [
        { id: "a", reservedRemaining: "1", quantity: "0.1" },
        { id: "b", reservedRemaining: "1", quantity: "0.2" },
      ],
    });
    expect(r.expedindoAgora).toBe("0.3");
    expect(r.restanteDepois).toBe("0.7");
  });
});
