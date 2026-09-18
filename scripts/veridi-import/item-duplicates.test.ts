import { describe, expect, it } from "vitest";
import { DECISOES_DE_DUPLICATAS } from "./item-duplicate-decisions.js";
import {
  CONJUNTO_DO_ARQUIVO,
  absorvidosPorCodigoDaPlanilha,
  cadastrosDaOnda,
  conjuntoDaOnda,
  decisaoDeGrupo,
  decisaoDoCodigo,
  decisoesDaOnda,
  gruposDaOnda,
  gruposDeFusao,
  impressaoDaOnda,
  impressaoDasDecisoes,
  validarConjunto,
  validarDecisoes,
} from "./item-duplicates.js";
import type { ConjuntoDeDecisoes, DecisaoDeDuplicata, DecisaoDeRenomeacao } from "./item-duplicates.js";

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

  it("'Clorogênico' = 'Clorogênico**' é equivalência declarada SÓ no G5 — nenhum outro grupo junta termo por asterisco", () => {
    const comEquivalencia = gruposDaOnda("2").filter((g) => g.consolidar?.equivalentes !== undefined);
    expect(comEquivalencia.map((g) => [g.grupo, g.consolidar?.equivalentes])).toEqual([
      ["G5", { "Clorogênico": "Clorogênico**" }],
    ]);
    expect(DECISOES_DE_DUPLICATAS.filter((d) => d.consolidar?.equivalentes !== undefined).map((d) => d.grupo)).toEqual([
      "G5",
      "G5",
      "G5",
    ]);
  });

  it("a Onda 2 não traz nenhum código dos grupos que o PO decidiu depois (Onda 3)", () => {
    const codigos = new Set(decisoesDaOnda("2").flatMap((d) => [d.absorvido.codigo, d.canonico.codigo]));
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

  it("equivalência declarada: leva a um termo do valor final, e o termo que ela junta sai do valor", () => {
    const base = decisao("G1", "MP-000002", "MP-000001", "2", "1");
    const com = (declaredNutrient: string, equivalentes: Record<string, string>) =>
      validarDecisoes([{ ...base, consolidar: { declaredNutrient, equivalentes } }]).join("\n");
    expect(com("A** · B", { A: "A**" })).toBe("");
    expect(com("A · B", { A: "A**" })).toMatch(/leva "A" a "A\*\*", que não está no valor consolidado/);
    expect(com("A** · A · B", { A: "A**" })).toMatch(/"A" é declarado igual a "A\*\*" e continua no valor consolidado/);
    expect(com("A** · B", { " A": "A**" })).toMatch(/equivalência com termo vazio ou com espaço sobrando/);
    expect(com("A** · B", { "": "A**" })).toMatch(/equivalência com termo vazio/);
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
    // A equivalência é decisão: plano feito sem ela não se aplica com ela.
    expect(impressaoDasDecisoes([base])).not.toBe(
      impressaoDasDecisoes([{ ...base, consolidar: { declaredNutrient: "A · B", equivalentes: { "A*": "A" } } }]),
    );
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

describe("Onda 3 no arquivo de decisão (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01)", () => {
  const onda3 = () => conjuntoDaOnda("3");

  it("traz exatamente as decisões do PO: uma fusão, duas renomeações, uma exclusão e dois grupos em revisão", () => {
    const c = onda3();
    expect(
      gruposDeFusao(c.fusoes).map((g) => [g.grupo, g.canonico.codigo, g.absorvidos.map((a) => a.codigo).join(","), g.consolidar?.declaredNutrient]),
    ).toEqual([["G4", "MP-000475", "MP-000149", "Açúcar de maçã · Carboidrato"]]);
    expect(c.renomeacoes.map((d) => [d.grupo, d.renomear.map((r) => `${r.codigo}>${r.para}`), d.manter.map((m) => m.codigo)])).toEqual([
      [
        "G7",
        [
          "MP-000320>Extrato de polpa de oliva (Olea europaea L.) — Verbascosídeo",
          "MP-000468>Extrato de polpa de oliva (Olea europaea L.) — Hidroxitirosol",
        ],
        [],
      ],
      ["G13", ["MP-000393>Extrato de guaraná 22%"], ["MP-000486"]],
    ]);
    expect(c.exclusoes.map((d) => [d.grupo, d.cadastro, d.excluir.map((e) => e.codigo)])).toEqual([
      ["MODELO-X", "FORMULATION_TEMPLATE", ["FT-000001", "FT-000002"]],
    ]);
    expect(c.revisoes.map((d) => [d.grupo, d.codigos])).toEqual([
      ["G6", ["MP-000325", "MP-000348"]],
      ["G11", ["MP-000014", "MP-000022"]],
    ]);
    expect(cadastrosDaOnda("3")).toEqual(["FORMULATION_TEMPLATE", "ITEM"]);
  });

  it("os grupos em revisão levam as perguntas à Veridi e nenhum código deles está em outra decisão", () => {
    const c = onda3();
    const [cafe, piridoxal] = c.revisoes;
    expect(cafe?.perguntas).toHaveLength(4);
    expect(cafe?.perguntas.join("\n")).toMatch(/"\*" e "\*\*"/);
    expect(cafe?.perguntas.join("\n")).toMatch(/R\$160\/kg .* R\$650\/kg/);
    expect(cafe?.perguntas.join("\n")).toMatch(/8%, 45% e 50%/);
    expect(piridoxal?.perguntas).toHaveLength(1);
    const decididos = decisaoDoCodigo();
    for (const codigo of ["MP-000325", "MP-000348", "MP-000014", "MP-000022"]) {
      expect(decididos.get(codigo)?.especie, codigo).toBe("revisão");
    }
    // O canônico do G4 é o único com fornecedor; o absorvido é o do cadastro sem uso.
    expect(absorvidosPorCodigoDaPlanilha().get("149")?.canonico.codigo).toBe("MP-000475");
  });

  it("a renomeação nunca inventa forma física nem toca o nutriente: só o nome muda", () => {
    const [oliva, guarana] = onda3().renomeacoes;
    for (const r of [...(oliva?.renomear ?? []), ...(guarana?.renomear ?? [])]) {
      expect(r.de.trim().toUpperCase()).not.toBe(r.para.trim().toUpperCase());
    }
    // O MP-000486 mantém o nome gravado hoje — sem acento em "soluvel", como está no cadastro.
    expect(guarana?.manter).toEqual([{ codigo: "MP-000486", codigoPlanilha: "594", nome: "Guaraná em pó soluvel" }]);
    expect(onda3().fusoes[0]?.nome).toBe("Concentrado de maçã");
  });

  it("as impressões das Ondas A e 2 não mudaram com a Onda 3 no mesmo arquivo — planos antigos continuam valendo", () => {
    expect(impressaoDaOnda("A")).toBe("71004c99e54feb52e0d4fa0f80f1bbbe029b50fa8e2a9ed9a5dc981a97b436ed");
    expect(impressaoDaOnda("2")).toBe("f31e07c67aaa22842b5dc7918d28f5466e0e5b918c19e3e38fa79cab41fa388b");
    expect(impressaoDaOnda("2")).toBe(impressaoDasDecisoes(decisoesDaOnda("2")));
  });

  it("a impressão da Onda 3 muda quando qualquer espécie de decisão muda", () => {
    const base = CONJUNTO_DO_ARQUIVO;
    const antes = impressaoDaOnda("3", base);
    const [oliva, ...resto] = base.renomeacoes;
    const outroNome = {
      ...base,
      renomeacoes: [
        { ...oliva!, renomear: oliva!.renomear.map((r, i) => (i === 0 ? { ...r, para: `${r.para} 2` } : r)) },
        ...resto,
      ],
    };
    expect(impressaoDaOnda("3", outroNome)).not.toBe(antes);
    const semUmModelo = {
      ...base,
      exclusoes: base.exclusoes.map((e) => ({ ...e, excluir: e.excluir.slice(0, 1) })),
    };
    expect(impressaoDaOnda("3", semUmModelo)).not.toBe(antes);
  });
});

describe("validação das espécies novas do arquivo de decisão", () => {
  const renomeacao = (extra: Partial<DecisaoDeRenomeacao> = {}): DecisaoDeRenomeacao => ({
    onda: "T",
    grupo: "R1",
    cadastro: "ITEM",
    nome: "Material",
    renomear: [{ codigo: "MP-000010", codigoPlanilha: "10", de: "Material", para: "Material — A" }],
    manter: [{ codigo: "MP-000011", codigoPlanilha: "11", nome: "Material" }],
    motivo: "material diferente",
    ...extra,
  });
  const conjunto = (parcial: Partial<ConjuntoDeDecisoes>): ConjuntoDeDecisoes => ({
    fusoes: [],
    renomeacoes: [],
    exclusoes: [],
    revisoes: [],
    ...parcial,
  });

  it("aceita a renomeação bem formada", () => {
    expect(validarConjunto(conjunto({ renomeacoes: [renomeacao()] }))).toEqual([]);
  });

  it("recusa nome novo igual ao do grupo, destino repetido, 'de' fora do grupo e dois registros mantendo o nome", () => {
    const erros = (d: DecisaoDeRenomeacao) => validarConjunto(conjunto({ renomeacoes: [d] })).join("\n");
    expect(erros(renomeacao({ renomear: [{ codigo: "MP-000010", codigoPlanilha: "10", de: "Material", para: "MATERIAL" }] }))).toMatch(
      /é o mesmo nome do grupo/,
    );
    expect(
      erros(
        renomeacao({
          renomear: [
            { codigo: "MP-000010", codigoPlanilha: "10", de: "Material", para: "Material — A" },
            { codigo: "MP-000012", codigoPlanilha: "12", de: "Material", para: "material — a" },
          ],
        }),
      ),
    ).toMatch(/é o nome novo de dois registros/);
    expect(erros(renomeacao({ renomear: [{ codigo: "MP-000010", codigoPlanilha: "10", de: "Outro", para: "Material — A" }] }))).toMatch(
      /que não é o nome do grupo/,
    );
    expect(
      erros(
        renomeacao({
          manter: [
            { codigo: "MP-000011", codigoPlanilha: "11", nome: "Material" },
            { codigo: "MP-000013", codigoPlanilha: "13", nome: "Material" },
          ],
        }),
      ),
    ).toMatch(/mais de um registro mantém o nome/);
    expect(erros(renomeacao({ renomear: [{ codigo: "MP-000010", codigoPlanilha: "10", de: "Material", para: " Material — A" }] }))).toMatch(
      /vazio ou com espaço sobrando/,
    );
  });

  it("exclusão só de Modelo, com código FT-000000; revisão exige pergunta e dois registros", () => {
    const exclusao = {
      onda: "T",
      grupo: "X1",
      cadastro: "FORMULATION_TEMPLATE" as const,
      nome: "X",
      excluir: [{ codigo: "FT-1" }],
      motivo: "teste",
    };
    expect(validarConjunto(conjunto({ exclusoes: [exclusao] })).join("\n")).toMatch(/fora do padrão FT-000000/);
    const revisao = { onda: "T", grupo: "V1", cadastro: "ITEM" as const, nome: "M", codigos: ["MP-000020"], motivo: "espera", perguntas: [] };
    const erros = validarConjunto(conjunto({ revisoes: [revisao] })).join("\n");
    expect(erros).toMatch(/sem a pergunta que o destrava/);
    expect(erros).toMatch(/precisa de dois registros distintos/);
  });

  it("um código está em UMA decisão só, e um grupo é de uma espécie só na onda", () => {
    const fusao = decisao("R1", "MP-000010", "MP-000030", "10", "30");
    const erros = validarConjunto(conjunto({ fusoes: [{ ...fusao, onda: "T" }], renomeacoes: [renomeacao()] })).join("\n");
    expect(erros).toMatch(/MP-000010 já está em outra decisão/);
    expect(erros).toMatch(/o grupo já é de outra espécie/);
    expect(() => conjuntoDaOnda("Z")).toThrow(/não tem grupo/);
  });
});
