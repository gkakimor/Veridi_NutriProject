/**
 * Proteção do ambiente para qualquer operação destrutiva do harness.
 *
 * O reset/seed só existe para a base LOCAL de desenvolvimento. Qualquer
 * indício de produção ou banco remoto ABORTA — nunca se cria um caminho
 * que possa apagar produção por acidente.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export interface EnvironmentCheck {
  databaseUrl: string;
  host: string;
  database: string;
}

export function assertLocalDevEnvironment(): EnvironmentCheck {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  if (nodeEnv === "production") {
    throw new Error("ABORTADO: NODE_ENV=production. Este comando é exclusivo de desenvolvimento.");
  }

  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("ABORTADO: DATABASE_URL ausente.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("ABORTADO: DATABASE_URL inválida.");
  }

  const host = parsed.hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `ABORTADO: banco remoto detectado (${host}). O harness só opera em banco local.`,
    );
  }

  const database = parsed.pathname.replace(/^\//, "");
  // Um banco chamado "prod"/"production" é indício suficiente para parar.
  if (/prod/i.test(database)) {
    throw new Error(`ABORTADO: nome de banco suspeito de produção (${database}).`);
  }

  return { databaseUrl, host, database };
}
