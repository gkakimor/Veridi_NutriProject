import { describe, expect, it } from "vitest";
import {
  CADASTROS_MESTRE_NO_BANCO,
  cadastroPorChave,
  camposPreenchidos,
  compararCampos,
  consolidarTermos,
  escolherCanonico,
} from "./master-data-catalog.js";
import type { CadastroMestreNoBanco, RegistroDoGrupo } from "./master-data-catalog.js";

/**
 * Escopo, normalização e critério de canônico
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01). Sem banco.
 */

const ITEM = cadastroPorChave("ITEM");

function registro(parcial: Partial<RegistroDoGrupo> & { codigo: string }): RegistroDoGrupo {
  return {
    id: `id-${parcial.codigo}`,
    nome: "Goma xantana",
    dados: { id: `id-${parcial.codigo}`, code: parcial.codigo, name: "Goma xantana" },
    referencias: 0,
    tabelasQueReferenciam: 0,
    criadoEm: "2026-01-01T00:00:00.000Z",
    ...parcial,
  };
}

describe("escopo dos cadastros", () => {
  it("cobre os nove cadastros com nome de catálogo", () => {
    expect(CADASTROS_MESTRE_NO_BANCO.map((c) => c.chave)).toEqual([
      "ITEM",
      "CUSTOMER",
      "SUPPLIER",
      "PRODUCT",
      "INDUSTRIAL_RESOURCE",
      "FORMULATION_TEMPLATE",
      "INDUSTRIAL_COST_TEMPLATE",
      "PRICING_POLICY_TEMPLATE",
      "PRODUCTION_PROFILE",
    ]);
  });

  it("deixa documento transacional e catálogo fechado de fora", () => {
    const tabelas = CADASTROS_MESTRE_NO_BANCO.map((c) => c.tabela);
    for (const fora of [
      "customer_orders",
      "purchase_orders",
      "production_orders",
      "receipts",
      "inventory_movements",
      "shipments",
      "quote_versions",
      "units_of_measure",
      "users",
      "production_calendars",
      "formulation_versions",
    ]) {
      expect(tabelas).not.toContain(fora);
    }
  });

  it("todo cadastro declara o motivo de estar no escopo", () => {
    for (const cadastro of CADASTROS_MESTRE_NO_BANCO) {
      expect(cadastro.motivo.length).toBeGreaterThan(20);
      expect(cadastro.colunasNeutras).toContain(cadastro.colunaNome);
      expect(cadastro.colunasNeutras).toContain(cadastro.colunaCodigo);
    }
  });

  it("recusa cadastro fora do escopo com a lista dos conhecidos", () => {
    expect(() => cadastroPorChave("PEDIDO")).toThrow(/não está no escopo.*ITEM/s);
  });
});

describe("critério de canônico", () => {
  it("1 — o lado referenciado ganha, mesmo sendo o mais novo e de código maior", () => {
    const escolha = escolherCanonico(
      [
        registro({ codigo: "MP-000001", criadoEm: "2020-01-01T00:00:00.000Z" }),
        registro({ codigo: "MP-000999", criadoEm: "2026-01-01T00:00:00.000Z", referencias: 1, tabelasQueReferenciam: 1 }),
      ],
      ITEM,
    );
    expect(escolha.canonico.codigo).toBe("MP-000999");
    expect(escolha.motivo).toBe("referenciado");
  });

  it("2 — com os dois referenciados, ganha quem tem mais histórico", () => {
    const escolha = escolherCanonico(
      [
        registro({ codigo: "MP-000001", referencias: 1, tabelasQueReferenciam: 1 }),
        registro({ codigo: "MP-000002", referencias: 7, tabelasQueReferenciam: 2 }),
      ],
      ITEM,
    );
    expect(escolha.canonico.codigo).toBe("MP-000002");
    expect(escolha.motivo).toBe("mais-historico");
  });

  it("3 — sem referência dos dois lados, ganha o mais completo", () => {
    const escolha = escolherCanonico(
      [
        registro({ codigo: "MP-000001" }),
        registro({
          codigo: "MP-000002",
          dados: { id: "id-MP-000002", code: "MP-000002", name: "Goma xantana", unitCode: "kg", family: "MINERAL" },
        }),
      ],
      ITEM,
    );
    expect(escolha.canonico.codigo).toBe("MP-000002");
    expect(escolha.motivo).toBe("mais-completo");
  });

  it("4 — empatado, ganha o mais antigo; depois, o de menor código", () => {
    const antigo = escolherCanonico(
      [
        registro({ codigo: "MP-000009", criadoEm: "2020-01-01T00:00:00.000Z" }),
        registro({ codigo: "MP-000002", criadoEm: "2026-01-01T00:00:00.000Z" }),
      ],
      ITEM,
    );
    expect(antigo.canonico.codigo).toBe("MP-000009");
    expect(antigo.motivo).toBe("mais-antigo");

    const codigo = escolherCanonico(
      [registro({ codigo: "MP-000009" }), registro({ codigo: "MP-000002" })],
      ITEM,
    );
    expect(codigo.canonico.codigo).toBe("MP-000002");
    expect(codigo.motivo).toBe("menor-codigo");
  });

  it("não depende da ordem em que o banco devolveu as linhas", () => {
    const linhas = [
      registro({ codigo: "MP-000003", criadoEm: "2021-01-01T00:00:00.000Z" }),
      registro({ codigo: "MP-000001", criadoEm: "2021-01-01T00:00:00.000Z" }),
      registro({ codigo: "MP-000002", criadoEm: "2021-01-01T00:00:00.000Z" }),
    ];
    const direto = escolherCanonico(linhas, ITEM);
    const invertido = escolherCanonico([...linhas].reverse(), ITEM);
    expect(direto.canonico.codigo).toBe(invertido.canonico.codigo);
    expect(direto.absorvidos.map((a) => a.codigo).sort()).toEqual(invertido.absorvidos.map((a) => a.codigo).sort());
  });

  it("terceiro duplicado: um canônico e dois absorvidos", () => {
    const escolha = escolherCanonico(
      [
        registro({ codigo: "MP-000001", referencias: 2, tabelasQueReferenciam: 1 }),
        registro({ codigo: "MP-000002" }),
        registro({ codigo: "MP-000003" }),
      ],
      ITEM,
    );
    expect(escolha.canonico.codigo).toBe("MP-000001");
    expect(escolha.absorvidos.map((a) => a.codigo)).toEqual(["MP-000002", "MP-000003"]);
  });

  it("grupo com um registro só não é grupo", () => {
    expect(() => escolherCanonico([registro({ codigo: "MP-000001" })], ITEM)).toThrow(/menos de dois/);
  });

  it("completude conta campo de negócio, nunca escrituração", () => {
    const so = registro({
      codigo: "MP-000001",
      dados: { id: "x", code: "MP-000001", name: "n", createdAt: "2026-01-01", updatedAt: "2026-01-01", externalCode: "7" },
    });
    expect(camposPreenchidos(so, ITEM)).toBe(0);
  });
});

describe("conflito material", () => {
  const comNutriente = (codigo: string, nutriente: string | null): RegistroDoGrupo =>
    registro({
      codigo,
      dados: { id: `id-${codigo}`, code: codigo, name: "Fosfato", declaredNutrient: nutriente },
    });

  it("valores diferentes dos dois lados bloqueiam o grupo", () => {
    const { conflitos } = compararCampos(comNutriente("MP-1", "Cálcio"), [comNutriente("MP-2", "Fósforo")], ITEM);
    expect(conflitos).toEqual([{ coluna: "declaredNutrient", valores: ["Cálcio", "Fósforo"] }]);
  });

  it("valor só no absorvido é PERDA declarada, não conflito", () => {
    const { conflitos, perdidos } = compararCampos(comNutriente("MP-1", null), [comNutriente("MP-2", "Fósforo")], ITEM);
    expect(conflitos).toEqual([]);
    expect(perdidos).toEqual([{ coluna: "declaredNutrient", codigo: "MP-2", valor: "Fósforo" }]);
  });

  it("canônico vazio com absorvidos divergentes ainda é conflito", () => {
    const { conflitos } = compararCampos(
      comNutriente("MP-1", null),
      [comNutriente("MP-2", "Fósforo"), comNutriente("MP-3", "Cálcio")],
      ITEM,
    );
    expect(conflitos).toEqual([{ coluna: "declaredNutrient", valores: ["Cálcio", "Fósforo"] }]);
  });

  it("coluna neutra divergente não bloqueia", () => {
    const { conflitos } = compararCampos(
      registro({ codigo: "MP-1", dados: { id: "a", code: "MP-1", name: "X", externalCode: "10", createdAt: "2020-01-01" } }),
      [registro({ codigo: "MP-2", dados: { id: "b", code: "MP-2", name: "x", externalCode: "77", createdAt: "2026-01-01" } })],
      ITEM,
    );
    expect(conflitos).toEqual([]);
  });

  it("FAIL CLOSED: coluna nova, que ninguém declarou neutra, bloqueia", () => {
    const { conflitos } = compararCampos(
      registro({ codigo: "MP-1", dados: { id: "a", code: "MP-1", name: "X", campoQueNasceuHoje: "A" } }),
      [registro({ codigo: "MP-2", dados: { id: "b", code: "MP-2", name: "X", campoQueNasceuHoje: "B" } })],
      ITEM,
    );
    expect(conflitos).toEqual([{ coluna: "campoQueNasceuHoje", valores: ["A", "B"] }]);
  });

  it("histórico incompatível: mesma coluna com valores de épocas diferentes bloqueia", () => {
    const cadastro: CadastroMestreNoBanco = { ...ITEM, colunasNeutras: ["id", "code", "name"] };
    const { conflitos } = compararCampos(
      registro({ codigo: "MP-1", dados: { id: "a", code: "MP-1", name: "X", defaultPurityPercent: "70.000000" } }),
      [registro({ codigo: "MP-2", dados: { id: "b", code: "MP-2", name: "X", defaultPurityPercent: "22.000000" } })],
      cadastro,
    );
    expect(conflitos.map((c) => c.coluna)).toEqual(["defaultPurityPercent"]);
  });
});

describe("consolidação de campo no canônico (Onda 2)", () => {
  it("junta os valores ÚNICOS em 'A · B · C', na ordem dada", () => {
    expect(consolidarTermos(["Cálcio", "Fósforo"]).valor).toBe("Cálcio · Fósforo");
    expect(consolidarTermos(["Colágeno", "Glicosaminoglicanos", "Ácido hialurônico"]).valor).toBe(
      "Colágeno · Glicosaminoglicanos · Ácido hialurônico",
    );
  });

  it("valor repetido entra uma vez só", () => {
    expect(consolidarTermos(["Cálcio", "Fósforo", "Cálcio"]).valor).toBe("Cálcio · Fósforo");
  });

  it("tira espaço das pontas e ignora vazio e nulo — nunca inventa termo", () => {
    expect(consolidarTermos(["  Cálcio ", null, "", "   ", undefined, " Fósforo"]).valor).toBe("Cálcio · Fósforo");
    expect(consolidarTermos([null, null]).valor).toBeNull();
  });

  it("caixa diferente é o mesmo termo, e fica a grafia que veio primeiro", () => {
    const { valor, fundidos } = consolidarTermos(["Fibra Alimentar", "FIBRA ALIMENTAR", "Beta-glucana"]);
    expect(valor).toBe("Fibra Alimentar · Beta-glucana");
    expect(fundidos).toEqual([{ termo: "FIBRA ALIMENTAR", em: "Fibra Alimentar" }]);
  });

  it("asterisco final é marcador: 'Clorogênico' e 'Clorogênico**' são o mesmo termo, e o fundido é declarado", () => {
    const { valor, fundidos } = consolidarTermos(["Clorogênico**", "Adenosina", "Clorogênico", "Rutina"]);
    expect(valor).toBe("Clorogênico** · Adenosina · Rutina");
    expect(fundidos).toEqual([{ termo: "Clorogênico", em: "Clorogênico**" }]);
  });

  it("acento continua contando: 'Fosforo' e 'Fósforo' NÃO são o mesmo termo", () => {
    expect(consolidarTermos(["Fósforo", "Fosforo"]).valor).toBe("Fósforo · Fosforo");
  });

  it("rodar de novo sobre o valor consolidado dá o mesmo valor", () => {
    const primeira = consolidarTermos(["Fibra Alimentar", "Arabinogalactana"]).valor;
    expect(consolidarTermos([primeira, "Arabinogalactana"]).valor).toBe(primeira);
    expect(consolidarTermos([primeira]).valor).toBe(primeira);
  });

  it("a ordem é a de quem chama: o canônico primeiro deixa o ANTES como começo do DEPOIS", () => {
    const antes = "Magnésio";
    const depois = consolidarTermos([antes, "Fósforo"]).valor!;
    expect(depois.startsWith(antes)).toBe(true);
    expect(consolidarTermos(["Fósforo", antes]).valor).toBe("Fósforo · Magnésio");
  });
});
