import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * `LT-YYYYMMDD-NNNNNN` — data do recebimento + sequence global Postgres
 * (`lot_code_seq`, nao reinicia por dia). `nextval` e atomico: seguro
 * contra concorrencia, mesmo padrao das demais sequences de codigo.
 * Aceita `PrismaClient` ou o client de uma transacao (`Prisma.TransactionClient`).
 */
export async function nextLotCode(
  prisma: PrismaClient | Prisma.TransactionClient,
  receivedAt: Date,
): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('lot_code_seq') AS nextval`;
  const value = rows[0]?.nextval;
  if (value === undefined) {
    throw new Error("Falha ao gerar código do lote");
  }

  const year = receivedAt.getUTCFullYear();
  const month = String(receivedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(receivedAt.getUTCDate()).padStart(2, "0");

  return `LT-${year}${month}${day}-${value.toString().padStart(6, "0")}`;
}
