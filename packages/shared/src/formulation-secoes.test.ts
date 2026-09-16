import { describe, expect, it } from "vitest";
import {
  SECAO_DA_FORMULA_LABELS,
  SECAO_DO_TIPO_DE_ITEM,
  baseSugeridaDaSecao,
  secaoDoItem,
} from "./formulations.js";
import { ITEM_TYPES } from "./items.js";

/**
 * FORMULATION-TEMPLATE-WORKBENCH-01 (fatia 1) — as seções da bancada.
 *
 * A Formulação e o Modelo mostram a MESMA divisão: composição é o que entra na
 * dose, embalagem é o que embala o produto. A tabela mora no shared justamente
 * para não existirem duas — duas cópias divergem no primeiro tipo de Item
 * reclassificado, e aí a mesma linha aparece numa seção em cada tela.
 *
 * Quem responde é o TIPO REAL do Item, e não o nome nem uma marcação nova na
 * linha: não existe coluna de seção no banco, e inventar uma criaria uma
 * segunda verdade que diverge do cadastro.
 */
describe("Seções da bancada", () => {
  it("todo tipo de Item tem seção — nenhum cai em lugar nenhum", () => {
    for (const tipo of ITEM_TYPES) {
      expect(SECAO_DO_TIPO_DE_ITEM[tipo], `tipo sem seção: ${tipo}`).toBeDefined();
      expect(SECAO_DA_FORMULA_LABELS[SECAO_DO_TIPO_DE_ITEM[tipo]]).toBeTruthy();
    }
  });

  it("matéria-prima é composição, embalagem é embalagem", () => {
    expect(secaoDoItem("RAW_MATERIAL")).toBe("COMPOSICAO");
    expect(secaoDoItem("PACKAGING")).toBe("EMBALAGEM");
  });

  it("produto acabado fica na composição, onde o bloqueio de ativação o explica", () => {
    expect(secaoDoItem("FINISHED_PRODUCT")).toBe("COMPOSICAO");
  });

  it("sem tipo conhecido a linha nasce na composição, nunca sem seção", () => {
    expect(secaoDoItem(null)).toBe("COMPOSICAO");
    expect(secaoDoItem(undefined)).toBe("COMPOSICAO");
  });

  it("a base SUGERIDA sai da seção — e a base fixa continua existindo", () => {
    // Embalagem conta por unidade acabada: uma tampa por pote.
    expect(baseSugeridaDaSecao("EMBALAGEM", true)).toBe("PER_FINISHED_UNIT");
    expect(baseSugeridaDaSecao("EMBALAGEM", false)).toBe("PER_FINISHED_UNIT");
    // Composição segue a receita: por dose quando a receita é por dose.
    expect(baseSugeridaDaSecao("COMPOSICAO", true)).toBe("PER_DOSE");
    expect(baseSugeridaDaSecao("COMPOSICAO", false)).toBe("FIXED_BASIS");
  });
});
