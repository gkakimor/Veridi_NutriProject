import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { calcularTotaisFaturamento } from "@veridi/shared";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** O que o valor de um documento lê: o total congelado e as linhas gravadas. */
export interface FaturamentoParaValor {
  totalAmount: Prisma.Decimal | null;
  lines: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null }[];
}

/**
 * VALOR DE UM FATURAMENTO — a conta única do número que o documento mostra
 * (BILLED-VALUE-CANONICAL-01; decisão D1 do PO: `Billing.totalAmount` é a
 * autoridade do valor faturado).
 *
 * - `totalAmount` gravado É o valor. Congelado na emissão — soma das linhas já
 *   arredondadas, menos o desconto apropriado, mais o ajuste de fechamento
 *   (`PRODUCT_RULES.md` §34 e §55) — e nunca refeito a partir das linhas:
 *   `quantidade × preço` perde o desconto e o ajuste, e somar sem arredondar
 *   cada linha perde centavos.
 * - Sem `totalAmount`, a soma das linhas já arredondadas
 *   (`calcularTotaisFaturamento`) — a mesma que o documento e o resumo do
 *   Pedido mostram nesse caso. Emitido sem `totalAmount` e com preço completo é
 *   LEGADO: a migration `20260925093009_billing_commercial_reconciliation` criou
 *   as colunas sem preencher o passado, e antes dela o documento valia as suas
 *   linhas. Rascunho e cancelado também caem aqui; nenhum dos dois é faturado.
 * - Documento sem linha, ou com linha sem preço, não tem valor: `null`. Nunca
 *   soma parcial.
 *
 * É a regra de `toBillingDTO` para o emitido e de `toBillingSummaryDTO` no
 * Pedido; Painel, R-14 e R-15 (tela, CSV e PDF) passam a ler daqui.
 */
export function valorDoFaturamento(billing: FaturamentoParaValor): string | null {
  if (billing.totalAmount !== null) return billing.totalAmount.toFixed(2);
  return calcularTotaisFaturamento(
    billing.lines.map((line) => ({
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice !== null ? line.unitPrice.toString() : null,
    })),
  ).totalAmount;
}

export interface ResumoDoValorFaturado {
  /** Faturamentos EMITIDOS no recorte. */
  billingCount: number;
  /** Quantos deles têm valor (`valorDoFaturamento` não nulo). */
  billingsWithCompletePricing: number;
  /**
   * Soma dos valores dos documentos, em duas casas. `null` sem documento ou com
   * qualquer um sem valor: soma parcial nunca é apresentada como total (§30).
   */
  totalAmount: string | null;
}

/**
 * VALOR FATURADO de um recorte: a soma de `valorDoFaturamento` dos
 * faturamentos EMITIDOS que casam com `where`. "Valor faturado" do Painel e
 * total do filtro do R-15 saem daqui — uma implementação para o mesmo número
 * (§31).
 *
 * Agregado no banco: documento com `totalAmount` congelado entra pelo `SUM`, sem
 * ler documento nem linha. Só o que não tem valor congelado — legado ou preço
 * incompleto — vem com as linhas, para a mesma conta do documento. Cada parcela
 * já está em duas casas: a soma não arredonda nada no fim.
 *
 * As três leituras dispensam transação sem mentir. Emitido não volta a
 * rascunho, não cancela e não muda de valor, então o conjunto só cresce; um
 * documento emitido entre elas faz congelados + sem valor deixar de fechar com
 * a contagem, e o total sai `null` — nunca a soma de um conjunto diferente do
 * contado. Numa transação `RepeatableRead` (o Painel), as três veem o mesmo
 * retrato e sempre fecham.
 */
export async function resumirValorFaturado(
  prisma: PrismaOrTx,
  where: Prisma.BillingWhereInput,
): Promise<ResumoDoValorFaturado> {
  const emitidos: Prisma.BillingWhereInput = { AND: [where, { status: "ISSUED" }] };
  const [billingCount, congelados, semValorCongelado] = await Promise.all([
    prisma.billing.count({ where: emitidos }),
    prisma.billing.aggregate({
      where: { AND: [emitidos, { totalAmount: { not: null } }] },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.billing.findMany({
      where: { AND: [emitidos, { totalAmount: null }] },
      select: { totalAmount: true, lines: { select: { quantity: true, unitPrice: true } } },
    }),
  ]);

  const valores = semValorCongelado.map(valorDoFaturamento);
  const comValor = congelados._count._all + valores.filter((valor) => valor !== null).length;
  const fechaComAContagem = congelados._count._all + semValorCongelado.length === billingCount;
  const total = valores.reduce(
    (soma, valor) => (valor === null ? soma : soma.plus(valor)),
    congelados._sum.totalAmount ?? new Prisma.Decimal(0),
  );

  return {
    billingCount,
    billingsWithCompletePricing: comValor,
    totalAmount: billingCount > 0 && fechaComAContagem && comValor === billingCount ? total.toFixed(2) : null,
  };
}
