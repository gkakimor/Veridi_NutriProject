import { PrismaClient } from "@prisma/client";

let client: PrismaClient | null = null;

/**
 * Cliente Prisma unico da aplicacao (inicializacao preguicosa).
 *
 * A construcao e adiada para que uma falha de inicializacao (por exemplo,
 * `prisma generate` ainda nao executado) apareca como banco indisponivel em
 * `GET /health`, em vez de derrubar o processo no import.
 */
export function getPrisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

/**
 * Checagem de conectividade: executa uma query real no PostgreSQL atraves do
 * Prisma. Usada por `GET /health` para comprovar API -> Prisma -> PostgreSQL.
 */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Encerra a conexao, se houver. Usado no shutdown. */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
