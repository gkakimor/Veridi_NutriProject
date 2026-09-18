import { describe, expect, it } from "vitest";
import { DECISOES_DE_DUPLICATAS } from "./item-duplicate-decisions.js";
import {
  absorvidosPorCodigoDaPlanilha,
  decisaoDeGrupo,
  decisoesDaOnda,
  gruposDaOnda,
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

describe("Onda 2 no arquivo de decisão (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01)", () => {
  it("traz exatamente os oito grupos aprovados pelo PO, com o canônico e o valor consolidado de cada um", () => {
    expect(
      gruposDaOnda("2").map((g) => [
        g.grupo,
        g.canonico.codigo,
        g.absorvidos.map((a) => a.codigo).join(","),
        g.consolidar?.declaredNutrient ?? null,
      ]),
    ).toEqual([
      ["G2", "MP-000115", "MP-000322", "Fibra Alimentar · Arabinogalactana"],
      ["G3", "MP-000118", "MP-000304", "Fibra Alimentar · Beta-glucana"],
      ["G5", "MP-000347", "MP-000165,MP-000324,MP-000349", "Clorogênico** · Adenosina · Rutina"],
      ["G8", "MP-000204", "MP-000285", "Magnésio · Fósforo"],
      ["G9", "MP-000269", "MP-000283", "Cálcio · Fósforo"],
      ["G10", "MP-000270", "MP-000284", "Cálcio · Fósforo"],
      ["G15", "MP-000312", "MP-000317,MP-000319", "Colágeno · Glicosaminoglicanos · Ácido hialurônico"],
      ["D5-SILICA", "ME-000021", "ME-000089", null],
    ]);
  });

  it("os grupos em revisão e o Modelo X ficam FORA — nenhum código deles no arquivo", () => {
    const codigos = new Set(DECISOES_DE_DUPLICATAS.flatMap((d) => [d.absorvido.codigo, d.canonico.codigo]));
    for (const codigo of ["MP-000149", "MP-000475", "MP-000325", "MP-000348", "MP-000320", "MP-000468", "MP-000014", "MP-000022", "MP-000393", "MP-000486"]) {
      expect(codigos.has(codigo), codigo).toBe(false);
    }
  });

  it("a sílica entra como par NOMEADO, e o arquivo recusa par nomeado que a regra automática já juntaria", () => {
    const [silica] = gruposDaOnda("2").filter((g) => g.grupo === "D5-SILICA");
    expect(silica?.absorvidos[0]?.nomeDoAbsorvido).toBe("SACHÊ SÍLICA GEL 5G");
    const base = decisao("G1", "MP-000002", "MP-000001", "2", "1");
    expect(validarDecisoes([{ ...base, nomeDoAbsorvido: "  MATERIAL " }]).join("\n")).toMatch(
      /nomeDoAbsorvido só existe para nome que a regra automática não junta/,
    );
    expect(validarDecisoes([{ ...base, nomeDoAbsorvido: "Matérial" }])).toEqual([]);
  });

  it("grupo de mais de dois: aceito com o mesmo canônico, nome e consolidação; recusado se algum diverge", () => {
    const consolidar = { declaredNutrient: "A · B" };
    const um = { ...decisao("G1", "MP-000002", "MP-000001", "2", "1"), consolidar };
    const dois = { ...decisao("G1", "MP-000003", "MP-000001", "3", "1"), consolidar };
    expect(validarDecisoes([um, dois])).toEqual([]);
    expect(validarDecisoes([um, { ...dois, canonico: { codigo: "MP-000009", codigoPlanilha: "9" } }]).join("\n")).toMatch(
      /grupo repetido com outro canônico/,
    );
    expect(validarDecisoes([um, { ...dois, nome: "Outro" }]).join("\n")).toMatch(/grupo repetido com outro nome/);
    expect(validarDecisoes([um, { ...dois, consolidar: { declaredNutrient: "A" } }]).join("\n")).toMatch(
      /grupo repetido com outra consolidação/,
    );
  });

  it("consolidação escrita fora do formato é recusada", () => {
    const base = decisao("G1", "MP-000002", "MP-000001", "2", "1");
    expect(validarDecisoes([{ ...base, consolidar: { declaredNutrient: "A ·  B" } }]).join("\n")).toMatch(
      /termo vazio ou com espaço sobrando/,
    );
    expect(validarDecisoes([{ ...base, consolidar: { declaredNutrient: "A · · B" } }]).join("\n")).toMatch(
      /termo vazio/,
    );
  });

  it("a impressão da Onda A não mudou com a Onda 2 no mesmo arquivo", () => {
    // O valor da main antes desta capability: plano da Onda A feito antes continua válido.
    expect(impressaoDasDecisoes(decisoesDaOnda("A"))).toBe(
      "71004c99e54feb52e0d4fa0f80f1bbbe029b50fa8e2a9ed9a5dc981a97b436ed",
    );
  });

  it("a consolidação e o par nomeado entram na impressão da onda", () => {
    const base = { ...decisao("G1", "MP-000002", "MP-000001", "2", "1"), consolidar: { declaredNutrient: "A · B" } };
    expect(impressaoDasDecisoes([base])).not.toBe(
      impressaoDasDecisoes([{ ...base, consolidar: { declaredNutrient: "A · C" } }]),
    );
    expect(impressaoDasDecisoes([base])).not.toBe(impressaoDasDecisoes([{ ...base, nomeDoAbsorvido: "Matérial" }]));
  });

  it("decisaoDeGrupo separa o que é da ferramenta de Item do que é da ferramenta genérica", () => {
    const [primeira] = decisoesDaOnda("A");
    expect(decisaoDeGrupo(primeira!, DECISOES_DE_DUPLICATAS)).toBe(false);
    for (const d of decisoesDaOnda("2")) expect(decisaoDeGrupo(d, DECISOES_DE_DUPLICATAS), d.grupo).toBe(true);
  });

  it("o importador reconhece os onze absorvidos pelo código da planilha e resolve cada um para o canônico", () => {
    const absorvidos = absorvidosPorCodigoDaPlanilha();
    expect(absorvidos.get("166")?.canonico.codigo).toBe("MP-000347");
    expect(absorvidos.get("548")?.canonico.codigo).toBe("ME-000021");
    expect(decisoesDaOnda("2")).toHaveLength(11);
  });
});
