import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";
import { comBanco, exigirBancoDeTeste } from "./banco-de-teste.js";
import { descartarUsuarios, listarUsuariosDeRodadaInterrompida } from "./usuarios-de-teste.js";

/**
 * `globalSetup` das faixas que escrevem em banco — as duas da API
 * (`vitest.config.ts` e `vitest.serial.config.ts`) e a de scripts da raiz
 * (`vitest.scripts.config.ts`): deixa o banco de teste pronto antes do
 * primeiro arquivo.
 *
 * 1. confere de novo que o destino é banco de teste (`banco-de-teste.ts`);
 * 2. cria o banco se ele não existe — no mesmo servidor, com a mesma
 *    credencial (CI que entrega o banco pronto nunca passa por aqui);
 * 3. aplica as migrations pendentes (`prisma migrate deploy`: aplica, nunca
 *    cria) e recusa banco com migration que este checkout não conhece;
 * 4. tira os usuários do `buildTestApp` que uma rodada interrompida deixou.
 *
 * Roda no processo principal do Vitest, fora dos workers.
 */

const MIGRATION_DESCONHECIDA =
  "o banco de teste tem migration que este checkout não conhece — é de outra branch.\n" +
  "O banco de teste é descartável: remova-o (DROP DATABASE) e a próxima rodada o recria.";

/**
 * A pasta da API, dona das migrations e do Prisma. Vem deste arquivo, não do
 * `root` do projeto Vitest: a faixa de scripts tem a raiz do monorepo como root.
 */
const RAIZ_DA_API = fileURLToPath(new URL("../../", import.meta.url));

export default async function prepararBancoDeTeste(project: TestProject): Promise<void> {
  const ambiente = { ...process.env, ...project.config.env } as Record<string, string | undefined>;
  const { url, alvo, banco } = exigirBancoDeTeste(ambiente["DATABASE_URL"], ambiente);

  const prisma = await conectarCriandoSeFaltar(url, banco);
  try {
    // Antes das migrations, com a única conexão desta preparação: qualquer
    // outra conexão no banco é de uma rodada viva.
    const orfaos = await listarUsuariosDeRodadaInterrompida(prisma);

    const pendentes = await migrationsPendentes(prisma, RAIZ_DA_API);
    if (pendentes > 0) aplicarMigrations(url, RAIZ_DA_API);

    const descarte = orfaos ? await descartarUsuarios(prisma, orfaos) : null;
    const partes = [`banco de teste: ${alvo}`];
    if (pendentes > 0) partes.push(`${pendentes} migration(s) aplicada(s)`);
    if (descarte && descarte.removidos > 0) partes.push(`${descarte.removidos} usuário(s) de rodada interrompida removido(s)`);
    console.log(partes.join(" · "));
  } finally {
    await prisma.$disconnect();
  }
}

/** Uma conexão só: a leitura do `pg_stat_activity` não pode contar o próprio pool. */
function umaConexao(url: string): string {
  const u = new URL(url);
  u.searchParams.set("connection_limit", "1");
  return u.toString();
}

async function conectarCriandoSeFaltar(url: string, banco: string): Promise<PrismaClient> {
  const conectar = () => new PrismaClient({ datasources: { db: { url: umaConexao(url) } } });
  const teste = conectar();
  try {
    await teste.$queryRaw`SELECT 1`;
    return teste;
  } catch (falhaAoConectar) {
    await teste.$disconnect();
    // Só cria se o servidor confirmar que o banco não existe; qualquer outra
    // falha (servidor fora, credencial) sobe como veio.
    const servidor = new PrismaClient({ datasources: { db: { url: umaConexao(comBanco(url, "postgres")) } } });
    try {
      const [linha] = await servidor
        .$queryRaw<Array<{ existe: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${banco}) AS "existe"`
        .catch(() => [{ existe: true }]);
      if (linha?.existe !== false) throw falhaAoConectar;
      await servidor.$executeRawUnsafe(`CREATE DATABASE "${banco.replaceAll('"', '""')}"`);
    } finally {
      await servidor.$disconnect();
    }
  }
  return conectar();
}

async function migrationsPendentes(prisma: PrismaClient, raizDaApi: string): Promise<number> {
  const pasta = path.join(raizDaApi, "prisma", "migrations");
  const locais = readdirSync(pasta, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory() && existsSync(path.join(pasta, entrada.name, "migration.sql")))
    .map((entrada) => entrada.name);

  const [tabela] = await prisma.$queryRaw<Array<{ existe: boolean }>>`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "existe"`;
  if (!tabela?.existe) return locais.length;

  const aplicadas = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT "migration_name" FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
  const nomes = new Set(aplicadas.map((linha) => linha.migration_name));
  const desconhecidas = [...nomes].filter((nome) => !locais.includes(nome));
  if (desconhecidas.length > 0) {
    throw new Error(`${MIGRATION_DESCONHECIDA}\n  ${desconhecidas.join("\n  ")}`);
  }
  return locais.filter((nome) => !nomes.has(nome)).length;
}

function aplicarMigrations(url: string, raizDaApi: string): void {
  const prismaBin = path.join(
    path.dirname(createRequire(path.join(raizDaApi, "package.json")).resolve("prisma/package.json")),
    "build",
    "index.js",
  );
  try {
    execFileSync(process.execPath, [prismaBin, "migrate", "deploy"], {
      cwd: raizDaApi,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (erro) {
    const { stdout, stderr } = erro as { stdout?: string; stderr?: string };
    throw new Error(`migrations não aplicaram no banco de teste:\n${[stdout, stderr].filter(Boolean).join("\n").slice(-2000)}`);
  }
}
