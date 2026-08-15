import type { PrismaClient } from "@prisma/client";

/**
 * Gera `PREFIXO-000001` a partir de uma sequence Postgres dedicada.
 * `nextval` é atômico: seguro contra concorrência, sem `MAX(code)+1`.
 * Reutilizado por Items, Suppliers e Customers — cada um com sua sequence.
 */
export async function nextSequenceCode(
  prisma: PrismaClient,
  sequenceName: string,
  prefix: string,
  padLength = 6,
): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('${sequenceName}') AS nextval`,
  );
  const value = rows[0]?.nextval;
  if (value === undefined) {
    throw new Error(`Falha ao gerar código (${sequenceName})`);
  }

  return `${prefix}-${value.toString().padStart(padLength, "0")}`;
}
