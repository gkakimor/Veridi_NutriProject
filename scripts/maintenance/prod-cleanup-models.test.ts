import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALVOS,
  CONTADORES,
  PRESERVAR,
  calcularOrdem,
  conferirClassificacao,
  removerNaOrdem,
} from "./prod-cleanup-models.mjs";

/**
 * PROD-CLEANUP-MODEL-CLASSIFICATION-01 — todo model do schema está em
 * exatamente uma lista de `prod-cleanup-models.mjs`, e a ordem de remoção
 * atravessa o ciclo de FK da contagem física.
 *
 * `prod-cleanup.mjs` aborta, até em dry-run, quando o client traz model fora
 * das listas — fail closed de propósito. Dezesseis models nasceram em
 * migration sem entrar nelas, e o script recusava todo banco migrado antes de
 * conectar. Aqui a fonte é o `schema.prisma` versionado — só as linhas
 * `model Nome {` —, sem gerar client nem conectar.
 */

const SCHEMA = readFileSync(new URL("../../apps/api/prisma/schema.prisma", import.meta.url), "utf8");

/** `model Nome {` no começo da linha; `enum`, `///` e campo chamado `model` não casam. */
const modelsDe = (schema: string) => [...schema.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
const modelsDoSchema = modelsDe(SCHEMA);

const SEM_DEFEITO = { semClassificacao: [], emMaisDeUmaLista: [], repetidosNaLista: [], semModel: [] };

describe("classificação dos models do prod-cleanup", () => {
  it("todo model do schema está em exatamente uma lista, e toda lista só tem model do schema", () => {
    expect(modelsDoSchema).toEqual(expect.arrayContaining(["User", "StockCount", "ProductionCalendar"]));
    expect(conferirClassificacao(modelsDoSchema)).toEqual(SEM_DEFEITO);
    expect(ALVOS.length + PRESERVAR.length + CONTADORES.length).toBe(modelsDoSchema.length);
  });

  it("decisão do PO: contagem, perfil, roteiro e agenda da OP, histórico do cliente e rótulo saem; preferência e calendário ficam", () => {
    expect(ALVOS).toEqual(
      expect.arrayContaining([
        "StockCount",
        "StockCountPosition",
        "StockCountEntry",
        "StockCountFinding",
        "ProductionProfile",
        "ProductionProfileVersion",
        "ProductionProfileStep",
        "ProductionProfileStepResource",
        "ProductionOrderPlanningSnapshot",
        "ProductionOrderSchedule",
        "CustomerStatusHistory",
        "ItemLabelFileVersion",
      ]),
    );
    // Lista exata: model que entrar aqui por engano some da limpeza sem ninguém decidir.
    expect(PRESERVAR).toEqual([
      "User",
      "UserSession",
      "UserPreference",
      "UnitOfMeasure",
      "ProductionCalendar",
      "ProductionCalendarWeekday",
      "ProductionCalendarException",
    ]);
  });

  it("a conferência acusa model sem lista, em duas listas, repetido e classificado sem model", () => {
    const listas = { ALVOS, PRESERVAR, CONTADORES };
    expect(conferirClassificacao([...modelsDoSchema, "ModelNovo"])).toEqual({ ...SEM_DEFEITO, semClassificacao: ["ModelNovo"] });
    // Usuário nas duas listas seria apagado com a limpeza.
    expect(conferirClassificacao(modelsDoSchema, { ...listas, ALVOS: [...ALVOS, "User"] })).toEqual({
      ...SEM_DEFEITO,
      emMaisDeUmaLista: ["User"],
    });
    expect(conferirClassificacao(modelsDoSchema, { ...listas, ALVOS: [...ALVOS, "Item"] })).toEqual({
      ...SEM_DEFEITO,
      repetidosNaLista: ["Item"],
    });
    expect(conferirClassificacao(modelsDoSchema, { ...listas, ALVOS: [...ALVOS, "Fantasma"] })).toEqual({
      ...SEM_DEFEITO,
      semModel: ["Fantasma"],
    });
  });

  it("lê `model Nome {` e ignora enum e comentário", () => {
    const schema = [
      "/// model Comentado {",
      "enum Status {",
      "  ATIVO",
      "}",
      "model Um {",
      "  model String",
      "}",
      "model  Dois{",
      "}",
    ].join("\n");
    expect(modelsDe(schema)).toEqual(["Um", "Dois"]);
  });
});

/** FK como o `pg_constraint` devolve: tabela filha, tabela pai, nome e letra do `confdeltype`. */
const fk = (src: string, tgt: string, acao: string) => ({ src, tgt, nome: `${src}_${tgt}_fkey`, acao });

describe("ordem de remoção do prod-cleanup", () => {
  it("CASCADE que fecha ciclo com NO ACTION não ordena: a posição sai antes e leva os registros", () => {
    // A forma real (20260925093026): a posição aponta para o registro que vale
    // (NO ACTION) e o registro aponta de volta para a posição (CASCADE).
    const fks = [
      fk("stock_count_positions", "stock_count_entries", "a"),
      fk("stock_count_entries", "stock_count_positions", "c"),
      fk("stock_count_positions", "stock_counts", "c"),
      fk("stock_count_findings", "stock_counts", "c"),
      fk("stock_count_positions", "items", "c"),
      fk("stock_count_positions", "inventory_movements", "n"),
      fk("stock_count_positions", "users", "n"),
    ];
    const alvos = new Set([
      "stock_counts",
      "stock_count_positions",
      "stock_count_entries",
      "stock_count_findings",
      "items",
      "inventory_movements",
    ]);
    const { ordem, cascatasEmCiclo } = calcularOrdem(fks, alvos);
    expect(ordem).toEqual([
      "inventory_movements",
      "stock_count_findings",
      "stock_count_positions",
      "items",
      "stock_count_entries",
      "stock_counts",
    ]);
    expect(cascatasEmCiclo.map((c: { nome: string }) => c.nome)).toEqual(["stock_count_entries_stock_count_positions_fkey"]);
  });

  it("sem ciclo, CASCADE continua ordenando: a filha sai antes da pai", () => {
    const fks = [
      fk("billing_lines", "billings", "c"),
      fk("billings", "customers", "r"),
      fk("item_label_file_versions", "item_label_file_versions", "r"),
    ];
    const { ordem, cascatasEmCiclo } = calcularOrdem(fks, new Set(["customers", "billings", "billing_lines", "item_label_file_versions"]));
    expect(ordem).toEqual(["billing_lines", "billings", "customers", "item_label_file_versions"]);
    expect(cascatasEmCiclo).toEqual([]);
  });

  it("ciclo só de RESTRICT/NO ACTION aborta — nenhuma ordem o desfaz", () => {
    expect(() => calcularOrdem([fk("a", "b", "r"), fk("b", "a", "a")], new Set(["a", "b"]))).toThrow(
      "Ciclo de FK impede ordenar: a, b",
    );
  });

  it("a remoção conta o que o CASCADE em ciclo levou junto com a pai", async () => {
    const linhas: Record<string, number> = { StockCountPosition: 2, StockCountEntry: 3, StockCount: 1 };
    const chamadas: string[] = [];
    const delegate = (model: string) => ({
      count: async () => {
        chamadas.push(`count ${model}`);
        return linhas[model];
      },
      deleteMany: async () => {
        chamadas.push(`delete ${model}`);
        const count = linhas[model];
        linhas[model] = 0;
        if (model === "StockCountPosition") linhas.StockCountEntry = 0; // o CASCADE do banco
        return { count };
      },
    });
    const tx = { stockCountPosition: delegate("StockCountPosition"), stockCountEntry: delegate("StockCountEntry"), stockCount: delegate("StockCount") };

    const removidos = await removerNaOrdem(
      tx,
      ["StockCountPosition", "StockCountEntry", "StockCount"],
      new Map([["StockCountPosition", new Set(["StockCountEntry"])]]),
    );

    expect(removidos).toEqual([
      { model: "StockCountPosition", removidos: 2, peloCascade: 0 },
      { model: "StockCountEntry", removidos: 3, peloCascade: 3 },
      { model: "StockCount", removidos: 1, peloCascade: 0 },
    ]);
    expect(chamadas).toEqual([
      "count StockCountEntry",
      "delete StockCountPosition",
      "count StockCountEntry",
      "delete StockCountEntry",
      "delete StockCount",
    ]);
  });
});
