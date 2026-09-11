import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { descreverDestino, exigirBancoLocal } from "./local-db-guard.mjs";

/**
 * Prova que as migrations reconstroem um banco VAZIO **e que esse banco é o
 * `schema.prisma`** — com o dado de referência que uma instalação nova
 * precisa para funcionar.
 *
 *   pnpm validate:migrations:fresh
 *
 * Cria um banco descartável no MESMO servidor local da `DATABASE_URL`, aplica
 * `prisma migrate deploy` nele do zero, confere `prisma migrate status`,
 * exige que `prisma migrate diff` entre esse banco e o `schema.prisma` saia
 * VAZIO, confere o catálogo de referência, e derruba o banco no fim —
 * inclusive quando algo falha no meio.
 *
 * São três defeitos distintos, cada um com sua verificação:
 *
 * 1. ORDEM (BACKLOG #13) — uma migration alterava uma tabela criada por outra
 *    de nome maior. Em banco existente o `migrate deploy` só aplica o que
 *    falta, na ordem em que as pastas foram chegando; em banco novo a ordem
 *    dos nomes é a ordem real, e a reconstrução quebrava.
 *    `scripts/migration-order.test.ts` pega isso estaticamente em `pnpm test`;
 *    o `migrate deploy` daqui é a prova de verdade, contra o Postgres.
 *
 * 2. DRIFT (BACKLOG #14) — as migrations construíam uma estrutura que o
 *    `schema.prisma` não descrevia: 27 chaves estrangeiras com `ON DELETE
 *    RESTRICT` que o modelo deixava implícitas (o Prisma assume SET NULL), 26
 *    constraints e índices com nome fora da convenção do Prisma e 6 índices
 *    que o modelo não declarava. `migrate deploy` e `migrate status` passavam
 *    limpos com os 86 comandos de drift no lugar: nenhum dos dois compara a
 *    estrutura com o modelo. O `migrate diff` daqui compara — e é a única
 *    barreira que reprova esse defeito antes do commit.
 *
 * 3. INSTALAÇÃO (FAST-DEVELOPMENT-RESET-02) — o catálogo de unidades de
 *    medida só existia porque alguém tinha rodado seed: produção nunca roda
 *    seed, e uma instalação nova nascia sem unidade nenhuma — sem Item, sem
 *    nada. Agora ele nasce da migration, e este banco vazio, que nunca viu
 *    seed, é a prova.
 *
 * LOCAL SOMENTE. A `DATABASE_URL` passa por `exigirBancoLocal` (host local,
 * sem marca de banco gerenciado, sem credencial de produção no ambiente) e o
 * banco temporário leva um marcador no nome. Nunca aponta para o Railway.
 */

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = path.join(RAIZ, "apps", "api");
const MARCADOR = "veridi_fresh_check_";

const requireFromApi = createRequire(path.join(API, "package.json"));
const { PrismaClient } = requireFromApi("@prisma/client");

/**
 * O que uma instalação nova precisa ter sem ninguém cadastrar. Valor
 * esperado de teste, escrito por extenso de propósito: se a migration mudar
 * o catálogo, este número tem de mudar junto, conscientemente.
 */
const CATALOGO_DE_UNIDADES = [
  { code: "L", dimension: "VOLUME", fator: "1" },
  { code: "g", dimension: "MASS", fator: "1" },
  { code: "kg", dimension: "MASS", fator: "1000" },
  { code: "mL", dimension: "VOLUME", fator: "0.001" },
  { code: "mg", dimension: "MASS", fator: "0.001" },
  { code: "un", dimension: "COUNT", fator: "1" },
];

function comBanco(url, nome) {
  const u = new URL(url);
  u.pathname = `/${nome}`;
  return u.toString();
}

function prisma(args, databaseUrl) {
  return execFileSync("pnpm", ["exec", "prisma", ...args], {
    cwd: API,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // `pnpm` no Windows é um .cmd: sem shell falha com ENOENT.
    shell: process.platform === "win32",
  });
}

/** `DECIMAL(18,6)` volta com seis casas; "1000.000000" e "1000" são o mesmo fator. */
const semZerosAMais = (fator) => (fator.includes(".") ? fator.replace(/0+$/, "").replace(/\.$/, "") : fator);

async function conferirCatalogo(databaseUrl) {
  const banco = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const linhas = await banco.$queryRawUnsafe(
      `SELECT code, dimension::text AS dimension, "toBaseFactor"::text AS fator
       FROM units_of_measure ORDER BY code COLLATE "C"`,
    );
    const lido = linhas.map((l) => `${l.code} ${l.dimension} ${semZerosAMais(l.fator)}`);
    const esperado = CATALOGO_DE_UNIDADES.map((u) => `${u.code} ${u.dimension} ${u.fator}`);
    if (JSON.stringify(lido) !== JSON.stringify(esperado)) {
      throw new Error(
        `catálogo de unidades do banco novo não é o de referência.\n` +
          `  esperado: ${esperado.join(" · ")}\n  lido:     ${lido.join(" · ") || "(vazio)"}`,
      );
    }
    return lido.length;
  } finally {
    await banco.$disconnect();
  }
}

async function main() {
  const { url, alvo } = exigirBancoLocal();
  const temporario = `${MARCADOR}${Date.now()}`;
  const adminUrl = comBanco(url, "postgres");
  const tempUrl = comBanco(url, temporario);

  // Segunda barreira, além do guard: o nome do banco descartável leva o marcador.
  if (!descreverDestino(tempUrl).endsWith(temporario) || !temporario.startsWith(MARCADOR)) {
    throw new Error("banco temporário sem marcador — abortado antes de criar qualquer coisa");
  }

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  console.log(`servidor local: ${alvo}`);
  console.log(`banco descartável: ${temporario}`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${temporario}"`);

  let falha = null;
  try {
    console.log("— prisma migrate deploy (do zero)");
    const deploy = prisma(["migrate", "deploy"], tempUrl);
    const aplicadas = (deploy.match(/^\s*└─ \d{14}_/gm) ?? []).length;
    if (!/All migrations have been successfully applied/.test(deploy)) {
      throw new Error(`deploy não terminou limpo:\n${deploy.slice(-1500)}`);
    }
    console.log(`  aplicadas: ${aplicadas}`);

    console.log("— prisma migrate status");
    const status = prisma(["migrate", "status"], tempUrl);
    if (!/Database schema is up to date/.test(status)) {
      throw new Error(`status não está em dia:\n${status.slice(-1500)}`);
    }
    console.log("  Database schema is up to date!");

    console.log("— prisma migrate diff (banco novo × schema.prisma)");
    const diff = prisma(
      [
        "migrate",
        "diff",
        "--from-schema-datasource",
        "prisma/schema.prisma",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--script",
      ],
      tempUrl,
    );
    // O script sai como comentário único quando não há diferença. Qualquer
    // linha executável é drift: o banco que as migrations constroem não é o
    // que o `schema.prisma` descreve.
    const comandos = diff
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
    if (comandos.length > 0) {
      throw new Error(
        `DRIFT: o banco das migrations não é o schema.prisma — ${comandos.length} comando(s).\n` +
          `Corrija a FONTE (migration faltante, ou declaração que falta no modelo);\n` +
          `não gere uma migration só para o diff sumir.\n\n${diff.trim()}`,
      );
    }
    console.log("  sem drift: as migrations constroem exatamente o schema.prisma");

    console.log("— dado de referência (banco novo, nenhum seed)");
    const unidades = await conferirCatalogo(tempUrl);
    console.log(`  units_of_measure: ${unidades} unidades, as de referência — nascem da migration`);
  } catch (erro) {
    falha = erro;
  } finally {
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${temporario}" WITH (FORCE)`);
      console.log(`— banco descartável removido: ${temporario}`);
    } catch (erroDrop) {
      console.error(`AVISO: não removeu ${temporario}: ${erroDrop.message}`);
    }
    await admin.$disconnect();
  }

  if (falha) {
    console.error(`\nFALHOU: ${falha.stderr ? falha.stderr.slice(-2000) : falha.message}`);
    process.exitCode = 1;
  } else {
    console.log("\nok  banco vazio reconstruído só com as migrations do repositório");
  }
}

main().catch((erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
