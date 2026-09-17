import { describe, expect, it } from "vitest";
import {
  FORMULATION_CALCULATION_MODES,
  SECAO_DA_FORMULA_LABELS,
  SECAO_DO_TIPO_DE_ITEM,
  baseDaSecao,
  baseDoComponente,
  receitaPorDose,
  secaoDoItem,
} from "./formulations.js";
import { DOSAGE_FORMS } from "./products.js";
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

  it("a base sai da seção — e a base fixa continua existindo", () => {
    // Embalagem conta por unidade acabada: uma tampa por pote.
    expect(baseDaSecao("EMBALAGEM", true)).toBe("PER_FINISHED_UNIT");
    expect(baseDaSecao("EMBALAGEM", false)).toBe("PER_FINISHED_UNIT");
    // Composição segue a receita: por dose quando a receita é por dose.
    expect(baseDaSecao("COMPOSICAO", true)).toBe("PER_DOSE");
    expect(baseDaSecao("COMPOSICAO", false)).toBe("FIXED_BASIS");
  });
});

/**
 * FORMULATION-COMPONENT-BASIS-AUTOMATION-01 — a base DERIVADA.
 *
 * Quem formula não escolhe a base: ela sai da seção do Item e do modo da
 * receita, e a tela e o servidor perguntam à mesma função. A matriz inteira é
 * conferida — modo × forma × tipo —, porque uma combinação esquecida é
 * exatamente onde duas regras parecidas voltariam a divergir.
 */
describe("Base derivada do componente", () => {
  it("receita por dose: modo por dose, ou forma que deriva doses (cápsula e pó)", () => {
    expect(receitaPorDose({ calculationMode: "PER_DOSE", dosageForm: null })).toBe(true);
    expect(receitaPorDose({ calculationMode: "FIXED_BASIS", dosageForm: null })).toBe(false);
    expect(receitaPorDose({ calculationMode: "FIXED_BASIS", dosageForm: "CAPSULE" })).toBe(true);
    expect(receitaPorDose({ calculationMode: "FIXED_BASIS", dosageForm: "POWDER" })).toBe(true);
    // Comprimido, líquido e "outro" continuam digitando doses: não fazem a receita por dose.
    expect(receitaPorDose({ calculationMode: "FIXED_BASIS", dosageForm: "TABLET" })).toBe(false);
    expect(receitaPorDose({ calculationMode: "FIXED_BASIS", dosageForm: "LIQUID" })).toBe(false);
    expect(receitaPorDose({ calculationMode: "FIXED_BASIS", dosageForm: "OTHER" })).toBe(false);
    expect(receitaPorDose({ calculationMode: undefined, dosageForm: undefined })).toBe(false);
  });

  it("toda combinação de modo, forma e tipo cai na regra — e embalagem nunca é por dose", () => {
    for (const calculationMode of FORMULATION_CALCULATION_MODES) {
      for (const dosageForm of [null, ...DOSAGE_FORMS]) {
        const porDose =
          calculationMode === "PER_DOSE" || dosageForm === "CAPSULE" || dosageForm === "POWDER";
        const versao = { calculationMode, dosageForm };
        const caso = `${calculationMode} × ${String(dosageForm)}`;
        expect(baseDoComponente("PACKAGING", versao), caso).toBe("PER_FINISHED_UNIT");
        expect(baseDoComponente("RAW_MATERIAL", versao), caso).toBe(
          porDose ? "PER_DOSE" : "FIXED_BASIS",
        );
      }
    }
  });
});
