import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { descreverDestino, exigirBancoLocal } from "./local-db-guard.mjs";

/**
 * Prova que as migrations reconstroem um banco VAZIO.
 *
 *   pnpm validate:migrations:fresh
 *
 * Cria um banco descartável no MESMO servidor local da `DATABASE_URL`, aplica
 * `prisma migrate deploy` nele do zero, confere `prisma migrate status` e
 * derruba o banco no fim — inclusive quando algo falha no meio.
 *
 * Existe por causa de um defeito que produção nunca mostrou: uma migration
 * que alterava uma tabela criada por outra de nome maior. Em banco existente
 * o `migrate deploy` só aplica o que falta, na ordem em que as pastas foram
 * chegando; em banco novo a ordem dos nomes é a ordem real, e a reconstrução
 * quebrava. `scripts/migration-order.test.ts` pega isso estaticamente em
 * `pnpm test`; este script é a prova de verdade, contra o Postgres.
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
