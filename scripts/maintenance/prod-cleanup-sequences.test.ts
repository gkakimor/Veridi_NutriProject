import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEQUENCES_DE_NEGOCIO, SEQUENCES_PRESERVADAS } from "./prod-cleanup-sequences.mjs";

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
 * sem número fixo — a conferência cresce com a cadeia.
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
 * Formas que mudam o conjunto de sequences sem `CREATE SEQUENCE`: coluna
 * serial/identity cria a sua, `DROP`/`RENAME`/`SET SCHEMA` tiram ou trocam o
 * nome. A conferência não as modela — aparecendo, reprova em vez de passar cega.
 */
const FORMAS_NAO_MODELADAS = [
  /(?<!["'\w])(?:SMALL|BIG)?SERIAL[248]?(?!["'\w])/i,
  /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i,
  /\bDROP\s+SEQUENCE\b/i,
  /\bALTER\s+SEQUENCE\b[^;]*\b(?:RENAME|SET\s+SCHEMA)\b/i,
];

const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "");

function sequencesCriadas(sql: string): string[] {
  return [...semComentarios(sql).matchAll(CREATE_SEQUENCE)].map((m) => {
    const ultimo = m[1].match(new RegExp(IDENTIFICADOR, "g"))!.at(-1)!;
    return ultimo.startsWith('"') ? ultimo.slice(1, -1).replaceAll('""', '"') : ultimo.toLowerCase();
  });
}

function formasNaoModeladas(sql: string): string[] {
  const codigo = semComentarios(sql);
  const achadas = FORMAS_NAO_MODELADAS.flatMap((f) => codigo.match(f)?.[0] ?? []);
  const lidas = sequencesCriadas(sql).length;
  const escritas = codigo.match(CREATE_SEQUENCE_QUALQUER)?.length ?? 0;
  return lidas === escritas ? achadas : [...achadas, `${escritas} CREATE SEQUENCE, ${lidas} lido(s)`];
}

function conferirClassificacao(criadas: string[], preservadas: string[], negocio: string[]) {
  const repetidas = (lista: string[]) => lista.filter((n, i) => lista.indexOf(n) !== i);
  const classificadas = new Set([...preservadas, ...negocio]);
  const existentes = new Set(criadas);
  return {
    semClassificacao: [...existentes].filter((n) => !classificadas.has(n)).sort(),
    nasDuasListas: preservadas.filter((n) => negocio.includes(n)).sort(),
    repetidasNaLista: [...new Set([...repetidas(preservadas), ...repetidas(negocio)])].sort(),
    semMigration: [...classificadas].filter((n) => !existentes.has(n)).sort(),
  };
}

const migrations = readdirSync(PASTA_MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ pasta: d.name, sql: readFileSync(new URL(`${d.name}/migration.sql`, PASTA_MIGRATIONS), "utf8") }));
const criadasPelasMigrations = migrations.flatMap((m) => sequencesCriadas(m.sql));

const SEM_DIVERGENCIA = { semClassificacao: [], nasDuasListas: [], repetidasNaLista: [], semMigration: [] };

describe("classificação das sequences do prod-cleanup", () => {
  it("toda sequence criada por migration está em exatamente uma lista", () => {
    expect(migrations.length).toBeGreaterThan(0);
    // As duas grafias reais: com aspas ("product_code_seq") e sem (user_code_seq).
    expect(criadasPelasMigrations).toEqual(expect.arrayContaining(["product_code_seq", "user_code_seq"]));
    expect(conferirClassificacao(criadasPelasMigrations, SEQUENCES_PRESERVADAS, SEQUENCES_DE_NEGOCIO)).toEqual(
      SEM_DIVERGENCIA,
    );
  });

  it("perfil produtivo e contagem física são numeração de negócio; só a de usuário é preservada", () => {
    expect(SEQUENCES_DE_NEGOCIO).toEqual(expect.arrayContaining(["production_profile_code_seq", "stock_count_code_seq"]));
    // Os usuários ficam na limpeza: reiniciar `user_code_seq` colidiria o próximo USR-.
    expect(SEQUENCES_PRESERVADAS).toEqual(["user_code_seq"]);
  });

  it("nenhuma migration muda o conjunto de sequences por forma que a conferência não lê", () => {
    const pendentes = migrations
      .map((m) => ({ pasta: m.pasta, formas: formasNaoModeladas(m.sql) }))
      .filter((m) => m.formas.length);
    expect(pendentes).toEqual([]);
  });

  it("a conferência acusa sequence nova sem lista, nas duas listas, repetida e classificada sem migration", () => {
    expect(conferirClassificacao([...criadasPelasMigrations, "nova_code_seq"], SEQUENCES_PRESERVADAS, SEQUENCES_DE_NEGOCIO))
      .toEqual({ ...SEM_DIVERGENCIA, semClassificacao: ["nova_code_seq"] });
    expect(conferirClassificacao(criadasPelasMigrations, [...SEQUENCES_PRESERVADAS, "lot_code_seq"], SEQUENCES_DE_NEGOCIO))
      .toEqual({ ...SEM_DIVERGENCIA, nasDuasListas: ["lot_code_seq"] });
    expect(conferirClassificacao(criadasPelasMigrations, SEQUENCES_PRESERVADAS, [...SEQUENCES_DE_NEGOCIO, "quote_code_seq"]))
      .toEqual({ ...SEM_DIVERGENCIA, repetidasNaLista: ["quote_code_seq"] });
    expect(conferirClassificacao(criadasPelasMigrations, SEQUENCES_PRESERVADAS, [...SEQUENCES_DE_NEGOCIO, "fantasma_seq"]))
      .toEqual({ ...SEM_DIVERGENCIA, semMigration: ["fantasma_seq"] });
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
});
