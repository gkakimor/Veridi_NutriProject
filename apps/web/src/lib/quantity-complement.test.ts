import { describe, expect, it } from "vitest";
import { complementoDeQuantidade } from "./quantity-complement";

/**
 * A conta é pequena; o que ela protege não é.
 *
 * O complemento do Plano de Atendimento vai no payload. Enquanto era
 * `Math.max(Number(pedido) - Number(digitado), 0)`, a décima segunda casa
 * sobrevivia por sorte — e o plano que "fecha" com o pedido é comparado por
 * igualdade exata, sem folga.
 */
describe("complementoDeQuantidade", () => {
  it("preserva a décima segunda casa", () => {
    expect(complementoDeQuantidade("10.000000000001", "3")).toBe("7.000000000001");
    expect(complementoDeQuantidade("1.529841916500", "0.1")).toBe("1.4298419165");
  });

  it("onde o ponto flutuante inventava dígito, agora não inventa", () => {
    // `Number(1.5298419165) - Number(0.1)` dá `1.4298419164999998`: dígito que
    // ninguém digitou, na décima sexta casa, indo para o payload.
    expect(String(1.5298419165 - 0.1)).toBe("1.4298419164999998");
    expect(complementoDeQuantidade("1.5298419165", "0.1")).toBe("1.4298419165");

    // E onde ele trocava o número por notação exponencial, que o servidor
    // recusa por regex (`decimal-schema.ts`).
    expect(String(10.000000000001 - 9.999999999999)).toBe("2.000177801164682e-12");
    expect(complementoDeQuantidade("10.000000000001", "9.999999999999")).toBe("0.000000000002");
  });

  it("diferença que existe SÓ na décima segunda casa continua existindo", () => {
    expect(complementoDeQuantidade("10.000000000001", "10")).toBe("0.000000000001");
    expect(complementoDeQuantidade("10.000000000002", "10.000000000001")).toBe("0.000000000001");
  });

  it("nunca escreve o resultado em notação exponencial", () => {
    for (const resultado of [
      complementoDeQuantidade("10.000000000001", "10"),
      complementoDeQuantidade("0.000000000002", "0.000000000001"),
      complementoDeQuantidade("2", "1.9999999999995"),
    ]) {
      expect(resultado).not.toMatch(/e/i);
      // É a mesma fronteira que o servidor aplica ao receber.
      expect(resultado).toMatch(/^\d+(\.\d+)?$/);
    }
  });

  it("reserva mais produção fecham com o pedido, casa por casa", () => {
    const pedido = "10.000000000001";
    const reservado = "3.500000000001";
    const produzido = complementoDeQuantidade(pedido, reservado);
    expect(produzido).toBe("6.5");
    // É esta soma que o Plano exige exata, sem `1e-6`.
    expect(complementoDeQuantidade(pedido, produzido)).toBe(reservado);
  });

  it("zero exato é zero", () => {
    expect(complementoDeQuantidade("7", "7")).toBe("0");
    expect(complementoDeQuantidade("0", "0")).toBe("0");
  });

  it("nunca devolve `-0` nem negativo", () => {
    expect(complementoDeQuantidade("0", "0")).not.toBe("-0");
    expect(complementoDeQuantidade("3", "10")).toBe("0");
    expect(complementoDeQuantidade("3", "3.000000000001")).toBe("0");
  });

  it("parte vazia de fato — o complemento é o total inteiro", () => {
    expect(complementoDeQuantidade("10.000000000001", "0")).toBe("10.000000000001");
  });

  it("não fecha em seis casas: a escala do domínio atravessa inteira", () => {
    expect(complementoDeQuantidade("1.529841916500", "0.000000000500")).toBe("1.529841916");
    expect(complementoDeQuantidade("2", "0.0000000000005")).toBe("1.9999999999995");
  });
});
