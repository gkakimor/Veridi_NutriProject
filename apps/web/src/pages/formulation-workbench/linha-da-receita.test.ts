import { describe, expect, it } from "vitest";
import type { UnitOfMeasureDTO } from "@veridi/shared";
import type { ItemDaBancada } from "./catalogo-de-itens";
import { baseForaDaRegra, comBaseDerivada, comItemEscolhido, linhaNova } from "./linha-da-receita";

/**
 * FORMULATION-COMPONENT-BASIS-AUTOMATION-01 — a base da linha, na bancada.
 *
 * As duas telas (Formulação e Modelo) montam a receita pelas funções deste
 * módulo. O que fica provado aqui, sem tela: a linha nova nasce com a base que
 * a seção e o modo dão, a base acompanha a troca de modo sem estado próprio, a
 * seção vem do tipo real do Item, e só dado anterior à regra é dito "fora da
 * regra". A regra em si é a de `@veridi/shared` (`baseDaSecao`), a mesma que o
 * servidor aplica ao gravar.
 */

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
] as UnitOfMeasureDTO[];

function item(overrides: Partial<ItemDaBancada>): ItemDaBancada {
  return {
    id: "item-1",
    code: "MP-000001",
    name: "Cafeína",
    type: "RAW_MATERIAL",
    unitCode: "kg",
    unitDimension: "MASS",
    active: true,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    packagingSubtype: null,
    defaultPurityPercent: null,
    externalCode: null,
    ...overrides,
  };
}

describe("Linha nova — a base sai da seção e do modo", () => {
  it("matéria-prima: por dose na receita por dose, sobre a base na receita em base fixa", () => {
    expect(linhaNova("COMPOSICAO", true).basis).toBe("PER_DOSE");
    expect(linhaNova("COMPOSICAO", false).basis).toBe("FIXED_BASIS");
  });

  it("embalagem: sempre por unidade acabada", () => {
    expect(linhaNova("EMBALAGEM", true).basis).toBe("PER_FINISHED_UNIT");
    expect(linhaNova("EMBALAGEM", false).basis).toBe("PER_FINISHED_UNIT");
  });
});

describe("Base derivada — sem estado de base para ficar para trás", () => {
  it("a linha criada em base fixa passa a por dose quando o modo muda, e volta", () => {
    const criada = linhaNova("COMPOSICAO", false);
    expect(comBaseDerivada(criada, true).basis).toBe("PER_DOSE");
    expect(comBaseDerivada(comBaseDerivada(criada, true), false).basis).toBe("FIXED_BASIS");
  });

  it("linha que já segue a regra volta a MESMA — a tabela não remonta a cada render", () => {
    const linha = linhaNova("COMPOSICAO", true);
    expect(comBaseDerivada(linha, true)).toBe(linha);
  });

  it("a seção vem do tipo real do Item, não de onde a linha nasceu", () => {
    // Nasceu na composição, mas o item escolhido é embalagem.
    const linha = { ...linhaNova("COMPOSICAO", true), itemId: "em-1", itemType: "PACKAGING" as const };
    expect(comBaseDerivada(linha, true).basis).toBe("PER_FINISHED_UNIT");
  });

  it("escolher matéria-prima em massa numa receita por dose propõe mg — pela base derivada, não pela gravada", () => {
    // Linha criada quando a receita ainda era base fixa.
    const criada = linhaNova("COMPOSICAO", false);
    const porDose = comItemEscolhido(comBaseDerivada(criada, true), item({}), UNIDADES);
    expect(porDose.unitCode).toBe("mg");
    const emBaseFixa = comItemEscolhido(comBaseDerivada(criada, false), item({}), UNIDADES);
    expect(emBaseFixa.unitCode).toBe("kg");
  });
});

describe("Base fora da regra — só dado anterior a ela", () => {
  it("devolve a base gravada quando a regra daria outra, e null quando segue a regra", () => {
    const materia = { ...linhaNova("COMPOSICAO", true), itemType: "RAW_MATERIAL" as const };
    expect(baseForaDaRegra(materia, true)).toBeNull();
    expect(baseForaDaRegra({ ...materia, basis: "FIXED_BASIS" }, true)).toBe("FIXED_BASIS");
    expect(baseForaDaRegra({ ...materia, basis: "PER_FINISHED_UNIT" }, false)).toBe(
      "PER_FINISHED_UNIT",
    );
    const pote = { ...linhaNova("EMBALAGEM", false), itemType: "PACKAGING" as const };
    expect(baseForaDaRegra(pote, true)).toBeNull();
    expect(baseForaDaRegra({ ...pote, basis: "PER_DOSE" }, true)).toBe("PER_DOSE");
  });
});
