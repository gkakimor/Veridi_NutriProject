import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALVOS,
  CASCADES_EM_CICLO_DOCUMENTADAS,
  CONTADORES,
  PRESERVAR,
  calcularOrdem,
  cascatasDocumentadasAusentes,
  conferirClassificacao,
  conferirTabelas,
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
 * `model Nome {` e o `@@map` — e as FKs que os `migration.sql` escrevem, sem
 * gerar client nem conectar.
 */

const SCHEMA = readFileSync(new URL("../../apps/api/prisma/schema.prisma", import.meta.url), "utf8");
const PASTA_MIGRATIONS = new URL("../../apps/api/prisma/migrations/", import.meta.url);

/** `model Nome {` no começo da linha; `enum`, `///` e campo chamado `model` não casam. */
const modelsDe = (schema: string) => [...schema.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
const modelsDoSchema = modelsDe(SCHEMA);

/** Model -> tabela: o `@@map` do bloco, ou o próprio nome. */
const tabelaDoModel = new Map(
  [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((m) => [
    m[1]!,
    m[2]!.match(/@@map\("([^"]+)"\)/)?.[1] ?? m[1]!,
  ]),
);
const tabelas = (models: string[]) => new Set(models.map((m) => tabelaDoModel.get(m)!));

const LETRA_DA_ACAO: Record<string, string> = {
  "NO ACTION": "a",
  RESTRICT: "r",
  CASCADE: "c",
  "SET NULL": "n",
  "SET DEFAULT": "d",
};

type Fk = { src: string; tgt: string; nome: string; acao: string };

/**
 * As FKs que a cadeia de migrations deixa no banco, no formato do
 * `pg_constraint` que o script lê: `ADD CONSTRAINT` posterior sobrescreve,
 * `DROP CONSTRAINT` remove. Nenhuma migration usa bloco `$$`, então o `;`
 * separa com segurança (o mesmo corte de `schema-fk-actions.test.ts`).
 */
function fksDasMigrations(): Fk[] {
  const porNome = new Map<string, Fk>();
  const pastas = readdirSync(PASTA_MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const pasta of pastas) {
    const sql = readFileSync(new URL(`${pasta}/migration.sql`, PASTA_MIGRATIONS), "utf8").replace(/--[^\n]*/g, "");
    for (const instrucao of sql.split(";").map((s) => s.replace(/\s+/g, " ").trim())) {
      const drop = instrucao.match(/^ALTER TABLE "([^"]+)" DROP CONSTRAINT (?:IF EXISTS )?"([^"]+)"/i);
      if (drop) porNome.delete(`${drop[1]}.${drop[2]}`);
      const add = instrucao.match(
        /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \([^)]*\) REFERENCES "([^"]+)"\s*\([^)]*\)\s*ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)/i,
      );
      if (add) {
        const [src, nome, tgt, acao] = [add[1]!, add[2]!, add[3]!, add[4]!];
        porNome.set(`${src}.${nome}`, { src, tgt, nome, acao: LETRA_DA_ACAO[acao.toUpperCase()]! });
      }
    }
  }
  return [...porNome.values()];
}

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
    expect(CONTADORES).toEqual(["ProductionOrderNumberCounter"]);
  });

  it("a conferência acusa model sem lista, em TARGET e PRESERVE, repetido e classificado sem model", () => {
    const listas = { ALVOS, PRESERVAR, CONTADORES };
    expect(conferirClassificacao([...modelsDoSchema, "ModelNovo"])).toEqual({ ...SEM_DEFEITO, semClassificacao: ["ModelNovo"] });
    // Usuário nas duas listas seria apagado com a limpeza.
    expect(conferirClassificacao(modelsDoSchema, { ...listas, ALVOS: [...ALVOS, "User"] })).toEqual({
      ...SEM_DEFEITO,
      emMaisDeUmaLista: ["User"],
    });
    expect(conferirClassificacao(modelsDoSchema, { ...listas, PRESERVAR: [...PRESERVAR, "StockCount"] })).toEqual({
      ...SEM_DEFEITO,
      emMaisDeUmaLista: ["StockCount"],
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

  it("schema novo inesperado: model acrescentado ao schema.prisma reprova até ser classificado", () => {
    /*
     * O model hipotético precisa de um nome que NUNCA vire real: quando
     * "InternalConsumption" passou a existir de verdade
     * (INTERNAL-CONSUMPTION-01), este caso parou de provar coisa alguma — o
     * nome já estava classificado, e a guarda de "model novo reprova"
     * acusava um defeito que era do próprio teste.
     */
    const schemaNovo = `${SCHEMA}\nmodel ModelQueNuncaExistiu {\n  id String @id\n\n  @@map("models_que_nunca_existiram")\n}\n`;
    expect(conferirClassificacao(modelsDe(schemaNovo))).toEqual({
      ...SEM_DEFEITO,
      semClassificacao: ["ModelQueNuncaExistiu"],
    });
    // Removido do schema e esquecido na lista também reprova.
    const semContagem = SCHEMA.replace(/^model StockCountFinding \{[\s\S]*?^\}/m, "");
    expect(conferirClassificacao(modelsDe(semContagem))).toEqual({ ...SEM_DEFEITO, semModel: ["StockCountFinding"] });
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

describe("o banco não tem nada fora da classificação", () => {
  const tabelasDoBanco = [...tabelaDoModel.values(), "_prisma_migrations"];
  const SEM_SOBRA = { tabelaSemModel: [], modelSemTabela: [], foraDoPublic: [], gatilhos: [], regras: [] };

  it("o banco que as migrations constroem: toda tabela é de model ou do Prisma", () => {
    expect(tabelaDoModel.size).toBe(modelsDoSchema.length);
    expect(tabelaDoModel.get("StockCountEntry")).toBe("stock_count_entries");
    expect(conferirTabelas({ tabelas: tabelasDoBanco, tabelaDoModel })).toEqual(SEM_SOBRA);
  });

  it("acusa tabela sem model, model sem tabela, relação fora do public, trigger e rule", () => {
    // Nome de tabela que nenhum model tem — e que nenhum vai ter.
    expect(conferirTabelas({ tabelas: [...tabelasDoBanco, "tabelas_que_nunca_existiram"], tabelaDoModel })).toEqual({
      ...SEM_SOBRA,
      tabelaSemModel: ["tabelas_que_nunca_existiram"],
    });
    // Banco atrás do client: contar pela tabela que não existe seria adivinhação.
    expect(
      conferirTabelas({ tabelas: tabelasDoBanco.filter((t) => t !== "stock_count_findings"), tabelaDoModel }),
    ).toEqual({ ...SEM_SOBRA, modelSemTabela: ["StockCountFinding"] });
    expect(
      conferirTabelas({
        tabelas: tabelasDoBanco,
        tabelaDoModel,
        foraDoPublic: ["arquivo.items"],
        gatilhos: ["items.apaga_rotulo"],
        regras: ["lots.nao_apagar"],
      }),
    ).toEqual({
      ...SEM_SOBRA,
      foraDoPublic: ["arquivo.items"],
      gatilhos: ["items.apaga_rotulo"],
      regras: ["lots.nao_apagar"],
    });
  });
});

/** FK sintética como o `pg_constraint` devolve: tabela filha, tabela pai, nome e letra do `confdeltype`. */
const fk = (src: string, tgt: string, acao: string, nome = `${src}_${tgt}_fkey`) => ({ src, tgt, nome, acao });

/** A forma real da contagem física (20260925093026). */
const CICLO_DA_CONTAGEM = [
  fk("stock_count_positions", "stock_count_entries", "a", "stock_count_positions_validEntryId_fkey"),
  fk("stock_count_entries", "stock_count_positions", "c", "stock_count_entries_positionId_fkey"),
  fk("stock_count_positions", "stock_counts", "c", "stock_count_positions_stockCountId_fkey"),
  fk("stock_count_findings", "stock_counts", "c", "stock_count_findings_stockCountId_fkey"),
  fk("stock_count_positions", "items", "c", "stock_count_positions_itemId_fkey"),
  fk("stock_count_positions", "inventory_movements", "n", "stock_count_positions_adjustmentMovementId_fkey"),
  fk("stock_count_positions", "users", "n", "stock_count_positions_addedByUserId_fkey"),
];
const TABELAS_DA_CONTAGEM = new Set([
  "stock_counts",
  "stock_count_positions",
  "stock_count_entries",
  "stock_count_findings",
  "items",
  "inventory_movements",
]);

describe("ordem de remoção do prod-cleanup", () => {
  const fksReais = fksDasMigrations();

  it("pelas FKs reais das migrations: ordena todos os alvos, e toda FK que trava sai filha antes da pai", () => {
    // Paridade com o schema: uma FK por `@relation(fields: ...)`.
    expect(fksReais.length).toBe([...SCHEMA.matchAll(/@relation\([^)\n]*fields:/g)].length);

    const alvos = tabelas(ALVOS);
    const { ordem, cascatasEmCiclo } = calcularOrdem(fksReais, alvos);
    expect(ordem).toHaveLength(ALVOS.length);
    expect(cascatasEmCiclo.map((c: Fk) => c.nome)).toEqual(CASCADES_EM_CICLO_DOCUMENTADAS.map((d) => d.nome));
    expect(cascatasDocumentadasAusentes(cascatasEmCiclo)).toEqual([]);

    const posicao = new Map(ordem.map((t: string, i: number) => [t, i]));
    const travam = fksReais.filter(
      (f) => alvos.has(f.src) && alvos.has(f.tgt) && f.src !== f.tgt && ["r", "a", "c"].includes(f.acao),
    );
    expect(travam.length).toBeGreaterThan(100);
    const foraDeOrdem = travam
      .filter((f) => !cascatasEmCiclo.includes(f))
      .filter((f) => posicao.get(f.src)! > posicao.get(f.tgt)!)
      .map((f) => `${f.src}.${f.nome} -> ${f.tgt}`);
    expect(foraDeOrdem).toEqual([]);

    // O ciclo da contagem: a posição sai antes do registro e leva os registros pelo CASCADE.
    expect(posicao.get("stock_count_positions")).toBeLessThan(posicao.get("stock_count_entries")!);
    expect(posicao.get("item_label_file_versions")).toBeLessThan(posicao.get("items")!);
    expect(posicao.get("production_profile_step_resources")).toBeLessThan(posicao.get("industrial_resources")!);

    // Com `--reset-sequences` o contador anual da OP entra e a ordem continua completa.
    expect(calcularOrdem(fksReais, tabelas([...ALVOS, ...CONTADORES])).ordem).toHaveLength(ALVOS.length + CONTADORES.length);
  });

  it("pelas FKs reais: nenhuma tabela preservada aponta para tabela a esvaziar, com ou sem o contador", () => {
    const preservadas = tabelas(PRESERVAR);
    const esvaziadas = tabelas([...ALVOS, ...CONTADORES]);
    expect(fksReais.filter((f) => preservadas.has(f.src) && esvaziadas.has(f.tgt))).toEqual([]);
    // As que apontam da limpeza para a configuração não travam: a preservada é a pai.
    expect(fksReais.some((f) => esvaziadas.has(f.src) && preservadas.has(f.tgt))).toBe(true);
  });

  it("CASCADE documentado que fecha ciclo com NO ACTION não ordena: a posição sai antes e leva os registros", () => {
    const { ordem, cascatasEmCiclo } = calcularOrdem(CICLO_DA_CONTAGEM, TABELAS_DA_CONTAGEM);
    expect(ordem).toEqual([
      "inventory_movements",
      "stock_count_findings",
      "stock_count_positions",
      "items",
      "stock_count_entries",
      "stock_counts",
    ]);
    expect(cascatasEmCiclo.map((c: Fk) => c.nome)).toEqual(["stock_count_entries_positionId_fkey"]);
  });

  it("CASCADE em ciclo fora da documentação aborta — a limpeza não depende de cascata que ninguém leu", () => {
    const ciclo = [fk("pedidos", "entregas", "a"), fk("entregas", "pedidos", "c")];
    expect(() => calcularOrdem(ciclo, new Set(["pedidos", "entregas"]))).toThrow(
      "CASCADE em ciclo sem documentação (a limpeza dependeria dele): entregas.entregas_pedidos_fkey -> pedidos",
    );
    // Mesmo par de tabelas com outro nome de constraint também não é o documentado.
    const renomeada = CICLO_DA_CONTAGEM.map((f) =>
      f.nome === "stock_count_entries_positionId_fkey" ? { ...f, nome: "stock_count_entries_position_fkey" } : f,
    );
    expect(() => calcularOrdem(renomeada, TABELAS_DA_CONTAGEM)).toThrow("CASCADE em ciclo sem documentação");
    // E o documentado que o banco não tem mais em ciclo aparece para o script abortar.
    const semCiclo = CICLO_DA_CONTAGEM.filter((f) => f.nome !== "stock_count_positions_validEntryId_fkey");
    const { cascatasEmCiclo } = calcularOrdem(semCiclo, TABELAS_DA_CONTAGEM);
    expect(cascatasDocumentadasAusentes(cascatasEmCiclo).map((d) => d.nome)).toEqual(["stock_count_entries_positionId_fkey"]);
  });

  it("aborta quando outra tabela aponta para a filha que sai pelo CASCADE em ciclo", () => {
    // O achado sairia depois da posição, mas o registro já teria ido embora com ela.
    const fks = [...CICLO_DA_CONTAGEM, fk("stock_count_findings", "stock_count_entries", "r", "stock_count_findings_entryId_fkey")];
    expect(() => calcularOrdem(fks, TABELAS_DA_CONTAGEM)).toThrow(
      "Tabela que sai pelo CASCADE em ciclo é referenciada por outra: stock_count_findings.stock_count_findings_entryId_fkey -> stock_count_entries",
    );
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
