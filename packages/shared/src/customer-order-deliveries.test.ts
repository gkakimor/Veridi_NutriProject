import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal-config.js";
import {
  alocarQuantidadeNasEntregasPendentes,
  saldoDaLinhaProgramada,
  saldoProgramavel,
  situacaoDaEntrega,
} from "./customer-order-deliveries.js";

/**
 * A aritmética das entregas programadas, sem banco.
 *
 * O que se protege aqui é a parte que não se vê: a situação nunca é gravada,
 * então um erro de derivação não aparece como dado errado no banco — aparece
 * como uma entrega cumprida sendo chamada de atrasada, ou como saldo
 * programável que ressuscita depois de um cancelamento parcial.
 */

const d = (valor: string) => new Decimal(valor);

/** Uma entrega com uma linha só — a forma mais comum. */
function entrega(
  prometido: string,
  atendido: string,
  opcoes: { data: string; hoje: string; cancelada?: boolean },
) {
  return situacaoDaEntrega({
    cancelada: opcoes.cancelada ?? false,
    scheduledDateISO: opcoes.data,
    hojeISO: opcoes.hoje,
    linhas: [{ prometido: d(prometido), atendido: d(atendido) }],
  });
}

describe("saldo de uma linha programada", () => {
  it("é o prometido menos o atendido", () => {
    expect(saldoDaLinhaProgramada(d("400"), d("250")).toString()).toBe("150");
  });

  it("nunca é negativo — excesso lê-se como nada a entregar", () => {
    expect(saldoDaLinhaProgramada(d("400"), d("450")).toString()).toBe("0");
  });

  it("preserva a escala de quantidade, sem arredondar", () => {
    expect(saldoDaLinhaProgramada(d("1000"), d("0.000000000001")).toString()).toBe(
      "999.999999999999",
    );
  });
});

describe("situação derivada da entrega", () => {
  it("programada: nada atendido e a data ainda não chegou", () => {
    expect(entrega("400", "0", { data: "2026-10-15", hoje: "2026-09-09" })).toBe("SCHEDULED");
  });

  it("parcialmente atendida: parte saiu e a data ainda não passou", () => {
    expect(entrega("400", "250", { data: "2026-10-15", hoje: "2026-09-09" })).toBe(
      "PARTIALLY_FULFILLED",
    );
  });

  it("atendida: o prometido saiu inteiro", () => {
    expect(entrega("400", "400", { data: "2026-10-15", hoje: "2026-09-09" })).toBe("FULFILLED");
  });

  it("atrasada: o dia passou e ainda falta quantidade", () => {
    expect(entrega("400", "250", { data: "2026-10-15", hoje: "2026-10-16" })).toBe("LATE");
  });

  /*
   * O defeito que §72/§73 documentam: comparar o marcador do dia com o
   * relógio vencia a promessa no começo do próprio dia dela. A promessa vale
   * o dia inteiro.
   */
  it("no PRÓPRIO dia da entrega não está atrasada", () => {
    expect(entrega("400", "0", { data: "2026-10-15", hoje: "2026-10-15" })).toBe("SCHEDULED");
    expect(entrega("400", "250", { data: "2026-10-15", hoje: "2026-10-15" })).toBe(
      "PARTIALLY_FULFILLED",
    );
  });

  it("entrega cumprida NUNCA vira atrasada depois", () => {
    expect(entrega("400", "400", { data: "2026-10-15", hoje: "2027-01-01" })).toBe("FULFILLED");
  });

  it("cancelada vence qualquer outra leitura, inclusive o atraso", () => {
    expect(entrega("400", "250", { data: "2026-10-15", hoje: "2026-12-01", cancelada: true })).toBe(
      "CANCELLED",
    );
  });

  it("entrega sem linhas é programada, não atendida", () => {
    expect(
      situacaoDaEntrega({
        cancelada: false,
        scheduledDateISO: "2026-10-15",
        hojeISO: "2026-09-09",
        linhas: [],
      }),
    ).toBe("SCHEDULED");
  });

  it("multiproduto só é atendida quando TODAS as linhas fecham", () => {
    const parcial = situacaoDaEntrega({
      cancelada: false,
      scheduledDateISO: "2026-10-15",
      hojeISO: "2026-09-09",
      linhas: [
        { prometido: d("1000"), atendido: d("1000") },
        { prometido: d("500"), atendido: d("200") },
      ],
    });
    expect(parcial).toBe("PARTIALLY_FULFILLED");

    const completa = situacaoDaEntrega({
      cancelada: false,
      scheduledDateISO: "2026-10-15",
      hojeISO: "2026-09-09",
      linhas: [
        { prometido: d("1000"), atendido: d("1000") },
        { prometido: d("500"), atendido: d("500") },
      ],
    });
    expect(completa).toBe("FULFILLED");
  });
});

describe("saldo programável", () => {
  it("desconta o expedido e o pendente das entregas ativas", () => {
    const saldo = saldoProgramavel({
      pedido: d("1000"),
      expedido: d("0"),
      pendenteEmEntregasAtivas: d("400"),
    });
    expect(saldo.toString()).toBe("600");
  });

  it("chega a zero quando o Pedido inteiro está programado", () => {
    const saldo = saldoProgramavel({
      pedido: d("1000"),
      expedido: d("0"),
      pendenteEmEntregasAtivas: d("1000"),
    });
    expect(saldo.toString()).toBe("0");
  });

  /*
   * A regra que o cancelamento parcial define. Entrega de 400 com 250
   * confirmadas e depois cancelada: a saída física continua descontada, o
   * saldo que restava dela some da programação, e sobram 150 — nunca os 400.
   */
  it("depois de cancelar uma entrega parcialmente atendida, devolve só o pendente", () => {
    const saldo = saldoProgramavel({
      pedido: d("400"),
      expedido: d("250"),
      pendenteEmEntregasAtivas: d("0"),
    });
    expect(saldo.toString()).toBe("150");
  });

  it("nunca é negativo quando o expedido passou do programado", () => {
    const saldo = saldoProgramavel({
      pedido: d("400"),
      expedido: d("400"),
      pendenteEmEntregasAtivas: d("100"),
    });
    expect(saldo.toString()).toBe("0");
  });

  /*
   * Comparação entre Decimais, nunca entre textos: `toString()` de um valor
   * muito pequeno sai em notação exponencial, e o que se afirma aqui é o
   * VALOR — que a última casa da escala de quantidade sobrevive à subtração.
   */
  it("responde na escala de quantidade, sem epsilon", () => {
    const saldo = saldoProgramavel({
      pedido: d("1000"),
      expedido: d("0"),
      pendenteEmEntregasAtivas: d("999.999999999999"),
    });
    expect(saldo.equals(d("0.000000000001"))).toBe(true);
    expect(saldo.toFixed(12)).toBe("0.000000000001");
  });
});

/**
 * A repartição de uma quantidade expedida entre as promessas.
 *
 * O defeito que originou COM-04b: uma linha só era vinculada quando cabia
 * INTEIRA numa promessa. Expedir 500 contra entregas de 400 e 600 não cabia em
 * nenhuma, ficava sem vínculo, e o cronograma jurava que nada tinha sido
 * entregue. A quantidade atravessa promessas.
 */
describe("alocação de uma quantidade entre as promessas", () => {
  const promessa = (id: string, remaining: string) => ({ deliveryLineId: id, remaining: d(remaining) });
  const resumo = (alocacoes: ReturnType<typeof alocarQuantidadeNasEntregasPendentes>) =>
    alocacoes.map((item) => [item.deliveryLineId, item.quantity.toString()]);

  it("atravessa duas promessas: 500 contra 400 e 600 dá 400 e 100", () => {
    const alocado = alocarQuantidadeNasEntregasPendentes(d("500"), [
      promessa("A", "400"),
      promessa("B", "600"),
    ]);
    expect(resumo(alocado)).toEqual([
      ["A", "400"],
      ["B", "100"],
    ]);
  });

  it("respeita o saldo já consumido: A com 150 e B com 600, candidato 300", () => {
    const alocado = alocarQuantidadeNasEntregasPendentes(d("300"), [
      promessa("A", "150"),
      promessa("B", "600"),
    ]);
    expect(resumo(alocado)).toEqual([
      ["A", "150"],
      ["B", "150"],
    ]);
  });

  /*
   * Expedir não exige cronograma completo: o Pedido pode ter saldo real sem
   * promessa para ele, e essa parte fica sem vínculo em vez de ser recusada.
   */
  it("o que sobra depois das promessas fica sem vínculo", () => {
    const alocado = alocarQuantidadeNasEntregasPendentes(d("500"), [promessa("A", "400")]);
    expect(resumo(alocado)).toEqual([
      ["A", "400"],
      [null, "100"],
    ]);
  });

  it("sem promessa nenhuma, tudo fica sem vínculo", () => {
    expect(resumo(alocarQuantidadeNasEntregasPendentes(d("500"), []))).toEqual([[null, "500"]]);
  });

  /*
   * Promessa cancelada e promessa já cumprida não chegam aqui — quem monta a
   * fila as descarta. O que este teste fixa é a consequência: uma fila vazia
   * de saldo não consome nada, e a quantidade inteira sai sem vínculo.
   */
  it("promessa sem saldo é ignorada, e a fila segue para a próxima", () => {
    const alocado = alocarQuantidadeNasEntregasPendentes(d("300"), [
      promessa("cumprida", "0"),
      promessa("B", "600"),
    ]);
    expect(resumo(alocado)).toEqual([["B", "300"]]);
  });

  it("a ordem da fila é a ordem em que as promessas são servidas", () => {
    const alocado = alocarQuantidadeNasEntregasPendentes(d("250"), [
      promessa("mesmo-dia-seq-1", "100"),
      promessa("mesmo-dia-seq-2", "100"),
      promessa("dia-seguinte", "500"),
    ]);
    expect(resumo(alocado)).toEqual([
      ["mesmo-dia-seq-1", "100"],
      ["mesmo-dia-seq-2", "100"],
      ["dia-seguinte", "50"],
    ]);
  });

  it("candidato zero ou negativo não aloca nada", () => {
    expect(alocarQuantidadeNasEntregasPendentes(d("0"), [promessa("A", "400")])).toEqual([]);
  });

  it("reparte na escala de quantidade, sem arredondar", () => {
    const alocado = alocarQuantidadeNasEntregasPendentes(d("400.000000000001"), [
      promessa("A", "400"),
      promessa("B", "600"),
    ]);
    expect(alocado[0]!.quantity.toFixed(12)).toBe("400.000000000000");
    expect(alocado[1]!.quantity.toFixed(12)).toBe("0.000000000001");
    // A soma dos pedaços é EXATAMENTE o candidato — nenhum epsilon some.
    const soma = alocado.reduce((total, item) => total.plus(item.quantity), d("0"));
    expect(soma.equals(d("400.000000000001"))).toBe(true);
  });
});
