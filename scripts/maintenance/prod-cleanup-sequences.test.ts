import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEQUENCES_DE_NEGOCIO, SEQUENCES_PRESERVADAS, conferirSequences } from "./prod-cleanup-sequences.mjs";

/**
 * PROD-CLEANUP-SEQUENCE-CLASSIFICATION-01 — toda sequence que uma migration
 * cria está em exatamente uma lista de `prod-cleanup-sequences.mjs`.
 *
 * `prod-cleanup.mjs` aborta quando `pg_sequences` traz nome fora das listas —
 * fail closed de propósito. `production_profile_code_seq` e
 * `stock_count_code_seq` nasceram em migration sem entrar nelas, e a validação
 * de sequences passou a recusar todo banco migrado, até em dry-run: só o banco
 * acusava.
 * Aqui a fonte são os `migration.sql` versionados, sem executar migration e
 * sem número fixo — a conferência cresce com a cadeia. A conferência é a MESMA
 * `conferirSequences()` que o script roda contra o banco
 * (PROD-CLEANUP-MODEL-CLASSIFICATION-01).
 */

const PASTA_MIGRATIONS = new URL("../../apps/api/prisma/migrations/", import.meta.url);

/** Identificador Postgres: com aspas guarda a grafia; sem aspas o banco dobra para minúsculas. */
const IDENTIFICADOR = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const CREATE_SEQUENCE = new RegExp(
  String.raw`\bCREATE\s+(?:UNLOGGED\s+)?SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:${IDENTIFICADOR}\s*\.\s*)?${IDENTIFICADOR})`,
  "gi",
);
/** Qualquer `CREATE ... SEQUENCE`, lido ou não pelo padrão acima. */
const CREATE_SEQUENCE_QUALQUER = /\bCREATE\s+(?:\w+\s+)?SEQUENCE\b/gi;

/**
 * Formas que mudam o conjunto de sequences, ou o dono delas, sem
 * `CREATE SEQUENCE`: coluna serial/identity cria a sua; `DEFAULT nextval` e
 * `OWNED BY` prendem a sequence a uma coluna; `DROP`/`RENAME`/`SET SCHEMA`
 * tiram ou trocam o nome; schema novo tira do `public`, o único que o script
 * lê. A conferência não as modela — aparecendo, reprova em vez de passar cega.
 */
const FORMAS_NAO_MODELADAS = [
  /(?<!["'\w])(?:SMALL|BIG)?SERIAL[248]?(?!["'\w])/i,
  /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i,
  /\bDEFAULT\s+nextval\s*\(/i,
  /\bOWNED\s+BY\b/i,
  /\bDROP\s+SEQUENCE\b/i,
  /\bALTER\s+SEQUENCE\b[^;]*\b(?:RENAME|SET\s+SCHEMA)\b/i,
  /_seq"?\s[^;]*\bRENAME\b|\bRENAME\b[^;]*_seq\b/i,
  /\b(?:CREATE|DROP)\s+SCHEMA\b/i,
  /\bSET\s+SCHEMA\b/i,
];

const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "");

function sequencesCriadas(sql: string): string[] {
  return [...semComentarios(sql).matchAll(CREATE_SEQUENCE)].map((m) => {
    const ultimo = m[1]!.match(new RegExp(IDENTIFICADOR, "g"))!.at(-1)!;
    return ultimo.startsWith('"') ? ultimo.slice(1, -1).replaceAll('""', '"') : ultimo.toLowerCase();
  });
}

function formasNaoModeladas(sql: string): string[] {
  const codigo = semComentarios(sql);
  const achadas = FORMAS_NAO_MODELADAS.flatMap((f) => codigo.match(f)?.[0].trim() ?? []);
  const lidas = sequencesCriadas(sql).length;
  const escritas = codigo.match(CREATE_SEQUENCE_QUALQUER)?.length ?? 0;
  return lidas === escritas ? achadas : [...achadas, `${escritas} CREATE SEQUENCE, ${lidas} lido(s)`];
}

const migrations = readdirSync(PASTA_MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ pasta: d.name, sql: readFileSync(new URL(`${d.name}/migration.sql`, PASTA_MIGRATIONS), "utf8") }));
const criadasPelasMigrations = migrations.flatMap((m) => sequencesCriadas(m.sql));
/** Como o banco migrado responde a `pg_sequences`. */
const doBanco = (nomes: string[]) => nomes.map((nome) => ({ schema: "public", nome }));

const SEM_DEFEITO = {
  semClassificacao: [],
  nasDuasListas: [],
  repetidasNaLista: [],
  fantasmas: [],
  foraDoPublic: [],
  colunasNumeradas: [],
  sequencesComDono: [],
};

describe("classificação das sequences do prod-cleanup", () => {
  it("toda sequence criada por migration está em exatamente uma lista, sem fantasma", () => {
    expect(migrations.length).toBeGreaterThan(0);
    // As duas grafias reais: com aspas ("product_code_seq") e sem (user_code_seq).
    expect(criadasPelasMigrations).toEqual(expect.arrayContaining(["product_code_seq", "user_code_seq"]));
    expect(conferirSequences({ sequences: doBanco(criadasPelasMigrations) })).toEqual(SEM_DEFEITO);
    expect(new Set(criadasPelasMigrations).size).toBe(SEQUENCES_PRESERVADAS.length + SEQUENCES_DE_NEGOCIO.length);
  });

  it("decisão do PO: só a de usuário é preservada; perfil produtivo e contagem física são numeração de negócio", () => {
    // Os usuários ficam na limpeza: reiniciar `user_code_seq` colidiria o próximo USR-.
    expect(SEQUENCES_PRESERVADAS).toEqual(["user_code_seq"]);
    expect(SEQUENCES_DE_NEGOCIO).toEqual(expect.arrayContaining(["production_profile_code_seq", "stock_count_code_seq"]));
    expect(SEQUENCES_DE_NEGOCIO).not.toContain("user_code_seq");
  });

  it("nenhuma migration muda o conjunto de sequences por forma que a conferência não lê", () => {
    const pendentes = migrations
      .map((m) => ({ pasta: m.pasta, formas: formasNaoModeladas(m.sql) }))
      .filter((m) => m.formas.length);
    expect(pendentes).toEqual([]);
  });

  it("acusa sequence nova sem lista, nas duas listas, repetida e fantasma", () => {
    const listas = { SEQUENCES_PRESERVADAS, SEQUENCES_DE_NEGOCIO };
    const atuais = doBanco(criadasPelasMigrations);
    // CREATE SEQUENCE novo, sem classificação — o caso da sequence de Uso e consumo antes de entrar na lista.
    expect(conferirSequences({ sequences: [...atuais, { schema: "public", nome: "nova_code_seq" }] })).toEqual({
      ...SEM_DEFEITO,
      semClassificacao: ["nova_code_seq"],
    });
    // Nas duas: seria listada como preservada e reiniciada mesmo assim.
    expect(
      conferirSequences({ sequences: atuais }, { ...listas, SEQUENCES_PRESERVADAS: [...SEQUENCES_PRESERVADAS, "lot_code_seq"] }),
    ).toEqual({ ...SEM_DEFEITO, nasDuasListas: ["lot_code_seq"] });
    expect(
      conferirSequences({ sequences: atuais }, { ...listas, SEQUENCES_DE_NEGOCIO: [...SEQUENCES_DE_NEGOCIO, "quote_code_seq"] }),
    ).toEqual({ ...SEM_DEFEITO, repetidasNaLista: ["quote_code_seq"] });
    // Fantasma: classificada e ausente do banco.
    expect(
      conferirSequences({ sequences: atuais }, { ...listas, SEQUENCES_DE_NEGOCIO: [...SEQUENCES_DE_NEGOCIO, "fantasma_seq"] }),
    ).toEqual({ ...SEM_DEFEITO, fantasmas: ["fantasma_seq"] });
  });

  it("acusa DROP e RENAME no banco, sequence fora do public, serial/identity e sequence presa a coluna", () => {
    const atuais = doBanco(criadasPelasMigrations);
    const semLote = atuais.filter((s) => s.nome !== "lot_code_seq");
    // Apagada: só fantasma. Renomeada: o nome novo sem lista e o antigo fantasma.
    expect(conferirSequences({ sequences: semLote })).toEqual({ ...SEM_DEFEITO, fantasmas: ["lot_code_seq"] });
    expect(conferirSequences({ sequences: [...semLote, { schema: "public", nome: "lote_code_seq" }] })).toEqual({
      ...SEM_DEFEITO,
      semClassificacao: ["lote_code_seq"],
      fantasmas: ["lot_code_seq"],
    });
    // Mesmo nome em outro schema: o script só lê e só reinicia no public.
    expect(conferirSequences({ sequences: [...atuais, { schema: "arquivo", nome: "lot_code_seq" }] })).toEqual({
      ...SEM_DEFEITO,
      foraDoPublic: ["arquivo.lot_code_seq"],
    });
    expect(
      conferirSequences({
        sequences: atuais,
        colunasNumeradas: ["items.legacyNumber"],
        sequencesComDono: ["items_legacyNumber_seq (items)"],
      }),
    ).toEqual({
      ...SEM_DEFEITO,
      colunasNumeradas: ["items.legacyNumber"],
      sequencesComDono: ["items_legacyNumber_seq (items)"],
    });
  });

  it("lê aspas, schema, IF NOT EXISTS e caixa; comentário não cria sequence", () => {
    const sql = [
      `-- CREATE SEQUENCE "comentada_seq" START 1;`,
      `CREATE SEQUENCE "nova_code_seq" START 1;`,
      `create sequence if not exists public.outra_seq;`,
      `CREATE SEQUENCE "public"."Com""Aspas_seq";`,
      `CREATE SEQUENCE Maiuscula_Seq START WITH 1;`,
    ].join("\n");
    expect(sequencesCriadas(sql)).toEqual(["nova_code_seq", "outra_seq", 'Com"Aspas_seq', "maiuscula_seq"]);
    expect(formasNaoModeladas(sql)).toEqual([]);
    expect(formasNaoModeladas(`CREATE TABLE "t" ("id" SERIAL NOT NULL, "serialNumber" TEXT);`)).toEqual(["SERIAL"]);
    expect(formasNaoModeladas(`CREATE TEMP SEQUENCE "t_seq";`)).toEqual(["1 CREATE SEQUENCE, 0 lido(s)"]);
  });

  it("reprova migration com serial/identity, nextval, OWNED BY, DROP, RENAME ou schema novo", () => {
    const casos: Array<[string, string]> = [
      [`ALTER TABLE "items" ADD COLUMN "n" INTEGER GENERATED BY DEFAULT AS IDENTITY;`, "GENERATED BY DEFAULT AS IDENTITY"],
      [`ALTER TABLE "items" ALTER COLUMN "n" SET DEFAULT nextval('lot_code_seq');`, "DEFAULT nextval("],
      [`ALTER SEQUENCE "lot_code_seq" OWNED BY "lots"."code";`, "OWNED BY"],
      [`DROP SEQUENCE "lot_code_seq";`, "DROP SEQUENCE"],
      [`ALTER TABLE "lot_code_seq" RENAME TO "lote_code_seq";`, `_seq" RENAME`],
      [`CREATE SCHEMA "arquivo";`, "CREATE SCHEMA"],
      [`ALTER TABLE "lots" SET SCHEMA "arquivo";`, "SET SCHEMA"],
    ];
    for (const [sql, forma] of casos) {
      expect(formasNaoModeladas(sql), sql).toEqual(expect.arrayContaining([expect.stringContaining(forma)]));
    }
    // O que as migrations reais escrevem não dispara nenhuma: tabela, índice, FK e o CREATE SEQUENCE lido.
    expect(
      formasNaoModeladas(
        [
          `CREATE SEQUENCE "stock_count_code_seq" START 1;`,
          `CREATE TABLE "stock_counts" ("id" TEXT NOT NULL, "code" TEXT NOT NULL);`,
          `ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "stock_count_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
