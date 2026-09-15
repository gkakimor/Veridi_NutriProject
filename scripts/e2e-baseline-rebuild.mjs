import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { descreverDestino, exigirBancoLocal } from "./local-db-guard.mjs";

/**
 * Reconstrói do zero o banco de base das suítes E2E com a MESMA carga inicial
 * que a Veridi recebeu em produção (E2E_BASELINE_REBUILD).
 *
 *   pnpm e2e:baseline:rebuild
 *
 * drop → create → migrations (`apply-migrations.mjs`) → ADMIN local
 * (`seed-infra.ts`) → VALIDATE → PLAN → APPLY → VERIFY do importador oficial,
 * com o pacote técnico aprovado. Nenhuma regra de carga mora aqui: o script só
 * encadeia os comandos que já existem, apontados para outro banco.
 *
 * O alvo nunca é o banco da `.env`. É `veridi_e2e_baseline` — ou
 * `E2E_BASELINE_DATABASE`, que precisa conter `e2e_baseline` — no MESMO
 * servidor local e com a mesma credencial; o DEV segue intocado.
 *
 * Variáveis opcionais:
 * - `E2E_BASELINE_DATABASE` — nome do banco (padrão `veridi_e2e_baseline`);
 * - `VERIDI_REVIEW_PACKAGE` — pacote aprovado (padrão
 *   `../.local-data/veridi/carga-inicial/pacote-carga-final.json`);
 * - `VERIDI_CORPUS_DIR` — pasta dos CSVs; `overrides/` e
 *   `cmv-product-overrides.csv` vêm da pasta de cima, como no importador
 *   (padrão `../.local-data/veridi/csv`);
 * - `E2E_EMAIL` / `E2E_PASSWORD` — ADMIN criado; sem elas, o do `seed-infra`,
 *   que é o mesmo que `scripts/e2e/lib/browser.mjs` usa.
 *
 * A carga roda sobre uma CÓPIA do corpus em
 * `../.local-data/veridi/e2e-baseline/<banco>/`: o importador grava plano,
 * findings e de-para ao lado dos CSVs, e a cópia mantém os relatórios da carga
 * de produção onde estão.
 */

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = path.join(RAIZ, "apps", "api");
const DADOS = path.resolve(RAIZ, "..", ".local-data", "veridi");
const BANCO_PADRAO = "veridi_e2e_baseline";

/** Models que a carga inicial escreve, mais o que a instalação traz. */
const CONTAGENS = [
  "Customer",
  "Supplier",
  "Item",
  "Product",
  "FormulationVersion",
  "FormulationComponent",
  "Project",
  "ProjectStatusHistory",
  "QuoteVersion",
  "SupplierItem",
  "SupplierItemOffer",
  "SupplierItemQualificationHistory",
  "UnitOfMeasure",
  "User",
];

/**
 * O banco de base E2E, a partir da `DATABASE_URL` da `.env`: mesmo servidor e
 * credencial, outro banco. Lança antes de qualquer efeito quando o servidor
 * não é local, quando o nome foge do padrão ou quando ele é o próprio banco da
 * `.env`.
 */
export function resolverAlvo(env = process.env) {
  const { url, banco: bancoDaEnv } = exigirBancoLocal(env);
  const banco = (env["E2E_BASELINE_DATABASE"] ?? BANCO_PADRAO).trim();
  if (!/^[a-z0-9_]+$/.test(banco) || !banco.includes("e2e_baseline")) {
    throw new Error(
      `RECUSADO: banco de base E2E "${banco}" fora do padrão — só minúsculas, dígitos e "_", ` +
        `e o nome contém "e2e_baseline". Nada foi alterado.`,
    );
  }
  if (banco === bancoDaEnv) {
    throw new Error(`RECUSADO: a base E2E não pode ser o banco da .env (${bancoDaEnv}). Nada foi alterado.`);
  }
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  // A mesma guarda sobre o destino final: marca de produção no nome também recusa.
  exigirBancoLocal({ ...env, DATABASE_URL: alvo.toString() });
  return { banco, url: alvo.toString(), servidor: url };
}

function passo(texto) {
  console.log(`\n— ${texto}`);
}

/**
 * Roda uma etapa com a saída no terminal. `pnpm` no Windows é um `.cmd` e
 * exige shell, que concatena argumentos: argumento com espaço ou metacaractere
 * é recusado antes, em vez de virar outro comando.
 */
function rodar(rotulo, comando, args, env) {
  const comShell = process.platform === "win32" && comando === "pnpm";
  if (comShell) {
    const perigoso = args.find((a) => /[\s"'&|<>^%!`$;()]/.test(a));
    if (perigoso) throw new Error(`${rotulo}: argumento que o shell interpretaria (${perigoso}). Nada foi executado.`);
  }
  try {
    execFileSync(comando, args, { cwd: RAIZ, env, stdio: "inherit", shell: comShell });
  } catch (erro) {
    throw new Error(`${rotulo} falhou (exit ${erro.status ?? "?"}): a base E2E ficou incompleta — corrija e rode de novo.`);
  }
}

function clientePrisma(url) {
  const { PrismaClient } = createRequire(path.join(API, "package.json"))("@prisma/client");
  return new PrismaClient({ datasources: { db: { url } } });
}

async function recriarBanco({ banco, servidor }) {
  const postgres = new URL(servidor);
  postgres.pathname = "/postgres";
  const admin = clientePrisma(postgres.toString());
  try {
    // `banco` já passou pelo padrão de `resolverAlvo`: só [a-z0-9_].
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${banco}"`);
  } finally {
    await admin.$disconnect();
  }
}

function prepararCopiaDoCorpus(origemCsv, banco) {
  const origem = path.dirname(origemCsv);
  const trabalho = path.join(DADOS, "e2e-baseline", banco);
  if (path.basename(path.dirname(trabalho)) !== "e2e-baseline") throw new Error("pasta de trabalho inesperada");
  rmSync(trabalho, { recursive: true, force: true });
  mkdirSync(trabalho, { recursive: true });
  cpSync(origemCsv, path.join(trabalho, "csv"), { recursive: true });
  if (existsSync(path.join(origem, "overrides"))) {
    cpSync(path.join(origem, "overrides"), path.join(trabalho, "overrides"), { recursive: true });
  }
  if (existsSync(path.join(origem, "cmv-product-overrides.csv"))) {
    cpSync(path.join(origem, "cmv-product-overrides.csv"), path.join(trabalho, "cmv-product-overrides.csv"));
  }
  return trabalho;
}

async function contar(url) {
  const db = clientePrisma(url);
  try {
    const contagens = {};
    for (const model of CONTAGENS) contagens[model] = await db[model.charAt(0).toLowerCase() + model.slice(1)].count();
    return contagens;
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const alvo = resolverAlvo();
  const pacote = path.resolve(process.env["VERIDI_REVIEW_PACKAGE"] ?? path.join(DADOS, "carga-inicial", "pacote-carga-final.json"));
  const origemCsv = path.resolve(process.env["VERIDI_CORPUS_DIR"] ?? path.join(DADOS, "csv"));
  if (!existsSync(pacote)) throw new Error(`pacote aprovado não encontrado: ${pacote}`);
  if (!existsSync(origemCsv)) throw new Error(`corpus não encontrado: ${origemCsv}`);

  console.log(`base E2E: ${descreverDestino(alvo.url)}`);
  console.log(`pacote:   ${pacote}`);
  console.log(`corpus:   ${origemCsv}`);

  passo("cópia do corpus para a pasta de trabalho");
  const trabalho = prepararCopiaDoCorpus(origemCsv, alvo.banco);
  console.log(`  ${trabalho}`);

  const env = { ...process.env, DATABASE_URL: alvo.url, VERIDI_CORPUS_DIR: path.join(trabalho, "csv") };
  if (process.env["E2E_EMAIL"]) env["SEED_ADMIN_EMAIL"] = process.env["E2E_EMAIL"];
  if (process.env["E2E_PASSWORD"]) env["SEED_ADMIN_PASSWORD"] = process.env["E2E_PASSWORD"];
  const devolucao = `--devolucao=${pacote.replaceAll("\\", "/")}`;

  passo(`drop + create ${alvo.banco}`);
  await recriarBanco(alvo);

  passo("migrations");
  rodar("migrations", process.execPath, [path.join(RAIZ, "scripts", "apply-migrations.mjs")], env);

  passo("ADMIN local (seed-infra: confere as unidades da migration, nada de negócio)");
  rodar("seed-infra", "pnpm", ["--filter", "@veridi/api", "exec", "tsx", "prisma/seed-infra.ts"], env);

  passo("VALIDATE");
  rodar("validate", "pnpm", ["exec", "tsx", "scripts/veridi-import/validate.ts"], env);
  passo("PLAN");
  rodar("plan", "pnpm", ["exec", "tsx", "scripts/veridi-import/plan.ts", devolucao], env);
  passo("APPLY");
  rodar("apply", "pnpm", ["exec", "tsx", "scripts/veridi-import/apply.ts", "--apply", devolucao], env);
  passo("VERIFY");
  rodar("verify", "pnpm", ["exec", "tsx", "scripts/veridi-import/verify.ts"], env);

  passo("contagens");
  const contagens = await contar(alvo.url);
  for (const [model, n] of Object.entries(contagens)) console.log(`  ${model}: ${n}`);
  const plano = JSON.parse(readFileSync(path.join(trabalho, "out", "import-plan.json"), "utf8"));
  writeFileSync(
    path.join(trabalho, "baseline.json"),
    JSON.stringify(
      { banco: alvo.banco, geradoEm: new Date().toISOString(), pacote: plano.reviewPackage?.identidade ?? null, contagens },
      null,
      2,
    ),
  );
  console.log(`\nok  base E2E pronta: ${descreverDestino(alvo.url)} · pacote ${String(plano.reviewPackage?.identidade).slice(0, 16)}…`);
}

/** Rodando como comando — e não importado pelo teste da guarda. */
function executadoDireto() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (executadoDireto()) {
  main().catch((erro) => {
    console.error(`\nFALHOU: ${erro.message}`);
    process.exitCode = 1;
  });
}
