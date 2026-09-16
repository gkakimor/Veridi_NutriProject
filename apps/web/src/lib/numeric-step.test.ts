import { describe, expect, it } from "vitest";
import { passoNaUltimaCasa } from "./numeric-step";
import { CASAS_PERCENTUAL_TECNICO } from "./numeric-scales";

/**
 * O passo do campo é a ÚLTIMA CASA ESCRITA, não uma unidade fixa.
 *
 * `1` sobe para `2`, `1,1` para `1,2`, `0,0026` para `0,0027`. Quem clica na
 * seta está incrementando o dígito que está vendo — é esse o contrato, e é ele
 * que estes casos protegem.
 */
const PERCENTUAL = { scale: CASAS_PERCENTUAL_TECNICO, simbolo: "percentual" as const };

describe("Passo na última casa", () => {
  it("sobe e desce na casa em que o número está", () => {
    expect(passoNaUltimaCasa("1", 1, PERCENTUAL)).toBe("2");
    expect(passoNaUltimaCasa("1,1", 1, PERCENTUAL)).toBe("1,2");
    // A casa não some ao virar o inteiro: `2,0`, não `2`. Senão o clique
    // seguinte pularia para 3 em vez de ir a 2,1.
    expect(passoNaUltimaCasa("1,9", 1, PERCENTUAL)).toBe("2,0");
    expect(passoNaUltimaCasa("0,0026", 1, PERCENTUAL)).toBe("0,0027");

    expect(passoNaUltimaCasa("2", -1, PERCENTUAL)).toBe("1");
    expect(passoNaUltimaCasa("1,2", -1, PERCENTUAL)).toBe("1,1");
    expect(passoNaUltimaCasa("2", -1, PERCENTUAL)).toBe("1");
  });

  it("a conta é exata: somar dez vezes um décimo dá um inteiro", () => {
    // Em ponto flutuante `0,1` somado dez vezes dá 0,9999999999999999, e um
    // campo que mostrasse isso depois de dez cliques perderia a confiança de
    // quem digita. A conta é feita em inteiros, sobre o texto.
    let valor = "0,0";
    for (let i = 0; i < 10; i += 1) valor = passoNaUltimaCasa(valor, 1, PERCENTUAL)!;
    expect(valor).toBe("1,0");
  });

  it("respeita a faixa do domínio e não reescreve no limite", () => {
    // Pureza: 0 < x ≤ 100. A seta para onde a validação pararia.
    const pureza = { ...PERCENTUAL, min: "0", max: "100" };
    expect(passoNaUltimaCasa("99,9", 1, pureza)).toBe("100,0");
    expect(passoNaUltimaCasa("100", 1, pureza)).toBeNull();
    expect(passoNaUltimaCasa("0", -1, pureza)).toBeNull();

    // Reserva: o domínio nunca declarou teto.
    const reserva = { ...PERCENTUAL, min: "0" };
    expect(passoNaUltimaCasa("999", 1, reserva)).toBe("1000");
  });

  it("nunca cria casa além do que o campo aceita", () => {
    const duasCasas = { scale: 2 };
    expect(passoNaUltimaCasa("1,25", 1, duasCasas)).toBe("1,26");
    // Texto com mais casas que o campo é ilegível para ele: nada acontece.
    expect(passoNaUltimaCasa("1,2345", 1, duasCasas)).toBeNull();
  });

  it("campo vazio é ponto de partida, não zero gravado", () => {
    const comMinimo = { ...PERCENTUAL, min: "0" };
    expect(passoNaUltimaCasa("", 1, comMinimo)).toBe("1");
    // Descer do vazio com mínimo zero não inventa um zero na linha.
    expect(passoNaUltimaCasa("", -1, comMinimo)).toBeNull();
  });

  it("texto ilegível não vira número", () => {
    // `1.234` é ambíguo em português (mil duzentos e trinta e quatro, ou 1,234?)
    // e o campo já o recusa. A seta não pode desempatar por conta própria.
    expect(passoNaUltimaCasa("1.234", 1, PERCENTUAL)).toBeNull();
    expect(passoNaUltimaCasa("abc", 1, PERCENTUAL)).toBeNull();
  });

  it("negativo só quando o campo aceita", () => {
    expect(passoNaUltimaCasa("0", -1, { scale: 2 })).toBeNull();
    expect(passoNaUltimaCasa("0", -1, { scale: 2, allowNegative: true })).toBe("-1");
    expect(passoNaUltimaCasa("-1,5", 1, { scale: 2, allowNegative: true })).toBe("-1,4");
  });
});
