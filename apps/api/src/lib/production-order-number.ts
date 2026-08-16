import type { Prisma } from "@prisma/client";

/**
 * Numeração OFICIAL anual da Ordem de Produção — `023/26`.
 *
 * Convive com `ProductionOrder.code` (OP-000123), que continua sendo a
 * identidade interna. O número oficial é gasto só na primeira transição
 * para RELEASED: rascunho descartado nunca consome numeração.
 *
 * Concorrência: a linha do ano é criada e travada com `FOR UPDATE` dentro da
 * transação do RELEASE — nunca `MAX(numero) + 1`, que permitiria duas OPs
 * simultâneas receberem o mesmo número.
 */
export interface OfficialNumber {
  value: string;
  year: number;
  sequence: number;
}

export async function nextOfficialNumber(
  tx: Prisma.TransactionClient,
  releasedAt: Date,
): Promise<OfficialNumber> {
  const year = releasedAt.getFullYear();

  await tx.$executeRaw`
    INSERT INTO production_order_number_counters ("year", "lastNumber")
    VALUES (${year}, 0)
    ON CONFLICT ("year") DO NOTHING
  `;
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    SELECT "lastNumber" FROM production_order_number_counters
    WHERE "year" = ${year} FOR UPDATE
  `;

  const sequence = (rows[0]?.lastNumber ?? 0) + 1;
  await tx.$executeRaw`
    UPDATE production_order_number_counters
    SET "lastNumber" = ${sequence}
    WHERE "year" = ${year}
  `;

  // Mínimo de 3 dígitos, sem teto: o 1000º lote do ano vira 1000/26.
  const value = `${String(sequence).padStart(3, "0")}/${String(year).slice(-2)}`;
  return { value, year, sequence };
}
