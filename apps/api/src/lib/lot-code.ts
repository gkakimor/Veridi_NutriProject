import type { Prisma, PrismaClient } from "@prisma/client";
import { diaComercialCompacto } from "@veridi/shared";
/**
 * `LT-YYYYMMDD-NNNNNN` — data do recebimento + sequence global Postgres
 * (`lot_code_seq`, nao reinicia por dia). `nextval` e atomico: seguro
 * contra concorrencia, mesmo padrao das demais sequences de codigo.
 * Aceita `PrismaClient` ou o client de uma transacao (`Prisma.TransactionClient`).
 */
/** O dia do código — o dia em que o material entrou NA VERIDI. */
export function lotCodeDay(receivedAt: Date): string {
  return diaComercialCompacto(receivedAt);
}

export async function nextLotCode(
  prisma: PrismaClient | Prisma.TransactionClient,
  receivedAt: Date,
): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('lot_code_seq') AS nextval`;
  const value = rows[0]?.nextval;
  if (value === undefined) {
    throw new Error("Falha ao gerar código do lote");
  }

  /*
   * A data do código é o dia em que o material entrou NA VERIDI. Lido em UTC,
   * um recebimento lançado às 21h de 31/12 saía como `LT-20270101-...`: a
   * etiqueta afirmava um dia em que o galpão nem tinha aberto.
   */
  return `LT-${lotCodeDay(receivedAt)}-${value.toString().padStart(6, "0")}`;
}
