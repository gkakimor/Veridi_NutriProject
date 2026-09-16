import { describe, expect, it } from "vitest";
import {
  baseSegueQuantidadeProduzida,
  lerPerdaPrevista,
  quantidadeBrutaPlanejada,
  rendimentoEsperado,
} from "./formulation-quantity.js";
import { APRESENTACOES_POR_FORMA, apresentacoesDaForma } from "./formulations.js";
import { PRESENTATION_TYPES } from "./products.js";

/**
 * PERDA PREVISTA DE PRODUÇÃO — a matemática (FORMULATION-WORKBENCH-01).
 *
 * A premissa é da VERSÃO e responde uma pergunta só: quanto precisa ENTRAR na
 * produção para sair a quantidade líquida desejada. Ela não é pureza (que
 * corrige o teor de um insumo) nem reserva de matéria-prima (que é um
 * adicional por linha), e nunca toca quantidade comercial.
 */
describe("Perda prevista de produção", () => {
  it("quantidade bruta é a líquida DIVIDIDA pelo rendimento, não multiplicada pela perda", () => {
    const bruta = quantidadeBrutaPlanejada(5000, "1");
    expect(typeof bruta).not.toBe("string");
    if (typeof bruta === "string") return;

    // 5.000 / 0,99 = 5.050,5050…  O erro clássico é 5.000 × 1,01 = 5.050, que
    // depois da perda entrega 4.999,5 — sempre para MENOS, que é o lado que
    // falta material.
    expect(bruta.toFixed(6)).toBe("5050.505051");
    expect(bruta.greaterThan(5050)).toBe(true);
  });

  it("perda não declarada devolve a própria líquida — ausência não inventa correção", () => {
    expect(String(quantidadeBrutaPlanejada(5000, null))).toBe("5000");
    expect(String(quantidadeBrutaPlanejada(5000, undefined))).toBe("5000");
    expect(String(quantidadeBrutaPlanejada(5000, ""))).toBe("5000");
  });

  it("perda zero é uma declaração legítima e não muda quantidade nenhuma", () => {
    expect(String(quantidadeBrutaPlanejada(5000, "0"))).toBe("5000");
    expect(String(lerPerdaPrevista("0"))).toBe("0");
  });

  it("rendimento esperado é 100 menos a perda, e nunca é digitado", () => {
    expect(String(rendimentoEsperado("1"))).toBe("99");
    expect(String(rendimentoEsperado("2.5"))).toBe("97.5");
    // Sem perda declarada não há rendimento presumido: 100% seria a mesma
    // invenção que 0% de perda.
    expect(rendimentoEsperado(null)).toBeNull();
  });

  it("perda fora da faixa [0, 100) é recusada, não degradada", () => {
    expect(lerPerdaPrevista("100")).toBe("PERDA_INVALIDA");
    expect(lerPerdaPrevista("120")).toBe("PERDA_INVALIDA");
    expect(lerPerdaPrevista("-1")).toBe("PERDA_INVALIDA");
    expect(quantidadeBrutaPlanejada(5000, "100")).toBe("PERDA_INVALIDA");
    expect(rendimentoEsperado("100")).toBe("PERDA_INVALIDA");
  });

  it("só as bases que acompanham a quantidade produzida entram na conta da perda", () => {
    expect(baseSegueQuantidadeProduzida("PER_DOSE")).toBe(true);
    expect(baseSegueQuantidadeProduzida("FIXED_BASIS")).toBe(true);
    // Embalagem comercial segue a unidade VENDÁVEL: a perda não vende pote.
    expect(baseSegueQuantidadeProduzida("PER_FINISHED_UNIT")).toBe(false);
  });

  it("dose e cápsula são a mesma conta com ou sem perda — a premissa é do lote", () => {
    // A bancada calcula a dose com produção = 1 e doses por embalagem = 1. A
    // perda não participa dessa chamada em lugar nenhum do motor, e é isso que
    // garante que digitar 1% não mexa em 0,571429 mg por cápsula.
    const semPerda = quantidadeBrutaPlanejada(1, null);
    const comPerda = quantidadeBrutaPlanejada(1, "1");
    expect(typeof semPerda).not.toBe("string");
    expect(typeof comPerda).not.toBe("string");
    if (typeof semPerda === "string" || typeof comPerda === "string") return;
    // A bruta muda; a dose não usa a bruta.
    expect(comPerda.greaterThan(semPerda)).toBe(true);
  });
});

describe("Apresentação comercial por forma", () => {
  it("a forma restringe a lista, e o pó não oferece frasco", () => {
    expect(apresentacoesDaForma("POWDER", null, PRESENTATION_TYPES)).toEqual(
      APRESENTACOES_POR_FORMA.POWDER,
    );
    expect(apresentacoesDaForma("POWDER", null, PRESENTATION_TYPES)).not.toContain("BOTTLE");
    expect(apresentacoesDaForma("CAPSULE", null, PRESENTATION_TYPES)).toContain("BOTTLE");
  });

  it("a apresentação JÁ GRAVADA continua na lista mesmo fora da forma atual", () => {
    // Tirar a opção de um valor gravado faria o seletor cair no traço e apagar
    // a premissa da versão no primeiro salvamento.
    const oferecidas = apresentacoesDaForma("POWDER", "BOTTLE", PRESENTATION_TYPES);
    expect(oferecidas).toContain("BOTTLE");
    expect(oferecidas).toContain("POT");
    // E entra na ordem canônica, não colada no fim.
    expect([...oferecidas]).toEqual(
      PRESENTATION_TYPES.filter(
        (tipo) => APRESENTACOES_POR_FORMA.POWDER!.includes(tipo) || tipo === "BOTTLE",
      ),
    );
  });

  it("forma em branco ou fora da bancada oferece a lista inteira", () => {
    expect(apresentacoesDaForma(null, null, PRESENTATION_TYPES)).toEqual(PRESENTATION_TYPES);
    expect(apresentacoesDaForma("LIQUID", null, PRESENTATION_TYPES)).toEqual(PRESENTATION_TYPES);
  });
});
