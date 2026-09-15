import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * PONTE PROVISÓRIA do valor faturado — existe só até BILLED-VALUE-CANONICAL-01
 * chegar à `main` (MANAGEMENT-DASHBOARD-V1-01).
 *
 * O contrato é o da decisão D1: o valor de um faturamento emitido é o
 * `Billing.totalAmount` congelado na emissão — bruto das linhas arredondadas,
 * menos o desconto apropriado, mais o ajuste de fechamento. Nunca
 * `quantidade × preço`. Esta ponte lê SÓ o valor congelado: documento emitido
 * sem ele fica sem valor, e o recorte que o contém fica incompleto.
 *
 * As assinaturas são as da implementação canônica que a outra capability
 * introduz (`valorDoFaturamento` e `resumirValorFaturado`). Antes do merge
 * este arquivo SAI, e o Painel Gerencial importa a canônica — que acrescenta a
 * leitura do legado sem `totalAmount` pela soma das linhas arredondadas. Duas
 * implementações da mesma regra na `main`, nunca.
 */

/** O que o valor de um documento lê: o total congelado e as linhas gravadas. */
export interface FaturamentoParaValor {
  totalAmount: Prisma.Decimal | null;
  lines: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null }[];
}

/** O valor do documento emitido: o `totalAmount` congelado, ou nenhum. */
export function valorDoFaturamento(billing: FaturamentoParaValor): string | null {
  return billing.totalAmount === null ? null : billing.totalAmount.toFixed(2);
}

export interface ResumoDoValorFaturado {
  billingCount: number;
  billingsWithCompletePricing: number;
  /** `null` sem documento ou com qualquer um sem valor: soma parcial nunca é total (§30). */
  totalAmount: string | null;
}

/** Valor faturado dos faturamentos EMITIDOS que casam com `where`, agregado no banco. */
export async function resumirValorFaturado(
  prisma: PrismaOrTx,
  where: Prisma.BillingWhereInput,
): Promise<ResumoDoValorFaturado> {
  const agregado = await prisma.billing.aggregate({
    where: { AND: [where, { status: "ISSUED" }] },
    _count: { _all: true, totalAmount: true },
    _sum: { totalAmount: true },
  });
  const billingCount = agregado._count._all;
  const comValor = agregado._count.totalAmount;
  return {
    billingCount,
    billingsWithCompletePricing: comValor,
    totalAmount:
      billingCount > 0 && comValor === billingCount
        ? (agregado._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2)
        : null,
  };
}
