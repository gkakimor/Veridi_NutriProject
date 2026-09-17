import { describe, expect, it } from "vitest";
import { DECISOES_DE_DUPLICATAS } from "./item-duplicate-decisions.js";
import {
  absorvidosPorCodigoDaPlanilha,
  decisoesDaOnda,
  impressaoDasDecisoes,
  validarDecisoes,
} from "./item-duplicates.js";
import type { DecisaoDeDuplicata } from "./item-duplicates.js";

const decisao = (
  grupo: string,
  absorvido: string,
  canonico: string,
  planilhaDoAbsorvido: string,
  planilhaDoCanonico: string,
): DecisaoDeDuplicata => ({
  onda: "T",
  grupo,
  nome: "Material",
  absorvido: { codigo: absorvido, codigoPlanilha: planilhaDoAbsorvido },
  canonico: { codigo: canonico, codigoPlanilha: planilhaDoCanonico },
});

describe("Arquivo de decisão de duplicatas de Item", () => {
  it("a Onda A é válida e traz exatamente os seis grupos aprovados pelo PO", () => {
    expect(validarDecisoes(DECISOES_DE_DUPLICATAS)).toEqual([]);
    expect(decisoesDaOnda("A").map((d) => `${d.grupo} ${d.absorvido.codigo}>${d.canonico.codigo}`)).toEqual([
      "G1 MP-000034>MP-000032",
      "G12 MP-000509>MP-000458",
      "G14 MP-000507>MP-000049",
      "G16 ME-000084>ME-000047",
      "G17 ME-000086>ME-000049",
      "G18 ME-000129>ME-000127",
    ]);
    // É pelo código da planilha que o importador reconhece a duplicata.
    expect(absorvidosPorCodigoDaPlanilha().get("542")?.canonico.codigo).toBe("ME-000047");
  });

  it("recusa cadeia, absorvido em dois grupos, tipos diferentes e código fora do padrão", () => {
    const base = decisao("G1", "MP-000002", "MP-000001", "2", "1");
    expect(validarDecisoes([base, decisao("G2", "MP-000001", "MP-000003", "1", "3")]).join("\n")).toMatch(
      /absorção em cadeia/,
    );
    expect(validarDecisoes([base, decisao("G2", "MP-000002", "MP-000004", "20", "4")]).join("\n")).toMatch(
      /já é absorvido em outro grupo/,
    );
    expect(validarDecisoes([decisao("G1", "ME-000002", "MP-000001", "2", "1")]).join("\n")).toMatch(/tipos diferentes/);
    expect(validarDecisoes([decisao("G1", "MP-2", "MP-000001", "2", "1")]).join("\n")).toMatch(/fora do padrão/);
    expect(() => absorvidosPorCodigoDaPlanilha([base, decisao("G2", "MP-000001", "MP-000003", "1", "3")])).toThrow(
      /inválido/,
    );
    expect(() => decisoesDaOnda("Z")).toThrow(/não tem grupo/);
  });

  it("a impressão ignora caixa do nome e muda quando um lado da decisão muda", () => {
    const [base] = [decisao("G1", "MP-000002", "MP-000001", "2", "1")];
    expect(impressaoDasDecisoes([base])).toBe(impressaoDasDecisoes([{ ...base, nome: "  MATERIAL " }]));
    expect(impressaoDasDecisoes([base])).not.toBe(
      impressaoDasDecisoes([{ ...base, canonico: { codigo: "MP-000003", codigoPlanilha: "1" } }]),
    );
  });
});
