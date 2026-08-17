/**
 * Proteção de ambiente do importador definitivo.
 *
 * Diferente do harness de desenvolvimento, este comando PODE um dia rodar
 * contra a base real — a migração de verdade acontece uma vez. Por isso a
 * regra não é "produção proibida para sempre", e sim: produção exige
 * opt-in explícito, em três camadas independentes (variável de ambiente,
 * `--apply` e confirmação do nome do banco). Nenhuma delas sozinha libera.
 *
 * Nada aqui apaga dados: o importador é aditivo e idempotente. Não existe
 * TRUNCATE, DROP, reset nem deleteMany global em lugar nenhum do fluxo.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export interface ImportEnvironment {
  host: string;
  database: string;
  isLocal: boolean;
  isProductionTarget: boolean;
}

function parseDatabaseUrl(): { host: string; database: string } {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("ABORTADO: DATABASE_URL ausente.");

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("ABORTADO: DATABASE_URL inválida.");
  }
  return { host: parsed.hostname, database: parsed.pathname.replace(/^\//, "") };
}

/**
 * `write=false` (validate/plan/verify): qualquer alvo é aceito, porque
 * nada é escrito.
 *
 * `write=true` (apply): alvo não-local exige
 * `VERIDI_ALLOW_PRODUCTION_IMPORT=true` E `--confirm-database=<nome>`
 * batendo com o banco real.
 */
export function assertImportEnvironment(options: {
  write: boolean;
  argv?: readonly string[];
}): ImportEnvironment {
  const { host, database } = parseDatabaseUrl();
  const isLocal = LOCAL_HOSTS.has(host);
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  const isProductionTarget = nodeEnv === "production" || !isLocal || /prod/i.test(database);

  if (!options.write || !isProductionTarget) {
    return { host, database, isLocal, isProductionTarget };
  }

  const argv = options.argv ?? process.argv;
  const allowed = process.env["VERIDI_ALLOW_PRODUCTION_IMPORT"] === "true";
  if (!allowed) {
    throw new Error(
      `ABORTADO: alvo de produção detectado (${database} em ${host}). ` +
        "Defina VERIDI_ALLOW_PRODUCTION_IMPORT=true para autorizar explicitamente.",
    );
  }

  const confirmation = argv
    .find((argument) => argument.startsWith("--confirm-database="))
    ?.split("=")[1];
  if (confirmation !== database) {
    throw new Error(
      `ABORTADO: confirme o banco de destino com --confirm-database=${database}. ` +
        "A confirmação existe para que ninguém aplique na base errada por engano.",
    );
  }

  return { host, database, isLocal, isProductionTarget };
}

/** `--apply` é obrigatório para escrever: dry-run é o padrão. */
export function hasApplyFlag(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--apply");
}
