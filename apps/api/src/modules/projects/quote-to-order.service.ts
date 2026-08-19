import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import type { CustomerOrderDTO, QuotePaymentScheduleDTO } from "@veridi/shared";
import { CUSTOMER_ORDER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { assertProductOperational } from "../../lib/product-lifecycle.js";
import { getCustomerOrderById } from "../customer-orders/customer-orders.service.js";
import {
  ProjectNotApprovedForOrderError,
  QuoteNotAcceptedForOrderError,
  QuoteNotFoundError,
  QuoteOrderUomMismatchError,
  QuoteWithoutOrderableLinesError,
} from "./projects.errors.js";
import { buildPaymentSchedule } from "./quote-payment.js";

/**
 * Proposta aceita → Pedido.
 *
 * O problema que isto fecha: o Pedido era digitado à parte e a proveniência
 * comercial morria no caminho. Meses depois, ninguém conseguia responder
 * "por que este pedido foi fechado por este valor" sem reconstruir a
 * negociação de memória.
 *
 * Três regras governam tudo aqui:
 *
 * 1. O Pedido NÃO recalcula preço, NÃO consulta a precificação vigente e NÃO
 *    usa o CMV atual. O que o cliente aceitou é histórico: precificação nova,
 *    cálculo de custo novo ou compra nova não reescrevem o acordo.
 * 2. O desconto é GLOBAL sobre o subtotal e não é rateado nas linhas. O
 *    sistema não tem essa regra, e distribuir criaria um preço por linha que
 *    ninguém acordou. Preservamos preços das linhas, desconto, subtotal e
 *    total — com isso o acordo se reproduz sem inventar nada.
 * 3. Uma proposta aceita gera no máximo um Pedido. O invariante vive no
 *    banco (índice único), não só aqui.
 */

const CODE_SEQUENCE = "customer_order_code_seq";

const quoteForOrderInclude = {
  project: { select: { id: true, code: true, status: true, customerId: true } },
  sourcedCustomerOrder: { select: { id: true } },
  lines: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      product: { include: { finishedProductItem: true } },
      projectProduct: { select: { status: true } },
      pricingVersion: { select: { id: true, code: true, versionNumber: true } },
      pricingTier: { select: { id: true, quantity: true, uomCode: true } },
    },
  },
} as const;

/**
 * O plano de pagamento como o cliente o viu, congelado no fechamento.
 *
 * Guardamos o RESULTADO, não os parâmetros. Os parâmetros já vivem na
 * proposta e não mudam depois do aceite — mas a aritmética que os traduz em
 * parcelas é código. Recalcular anos depois, com outra fórmula, produziria um
 * plano diferente do que foi assinado.
 */
function congelarPlano(
  quote: {
    discountPercent: Prisma.Decimal | null;
    paymentMethod: "CASH" | "INSTALLMENTS";
    downPaymentPercent: Prisma.Decimal | null;
    installmentCount: number | null;
    installmentIntervalDays: number | null;
    monthlyInterestPercent: Prisma.Decimal | null;
  },
  subtotal: Prisma.Decimal,
): QuotePaymentScheduleDTO {
  return buildPaymentSchedule({
    subtotal,
    discountPercent: quote.discountPercent,
    method: quote.paymentMethod,
    downPaymentPercent: quote.downPaymentPercent,
    installmentCount: quote.installmentCount,
    installmentIntervalDays: quote.installmentIntervalDays,
    monthlyInterestPercent: quote.monthlyInterestPercent,
  });
}

/**
 * Gera o Pedido da proposta aceita, ou devolve o que já existe.
 *
 * Idempotente por escolha de UX: clicar duas vezes em "Gerar pedido" abre o
 * mesmo pedido em vez de estourar um conflito que o usuário não causou.
 */
export async function createOrderFromAcceptedQuote(
  quoteVersionId: string,
  actor: User,
): Promise<{ order: CustomerOrderDTO; alreadyExisted: boolean }> {
  const prisma = getPrisma();

  const quote = await prisma.quoteVersion.findUnique({
    where: { id: quoteVersionId },
    include: quoteForOrderInclude,
  });
  if (!quote) throw new QuoteNotFoundError(quoteVersionId);

  // Já gerado: devolve o existente sem tocar em nada.
  if (quote.sourcedCustomerOrder) {
    return {
      order: (await getCustomerOrderById(quote.sourcedCustomerOrder.id))!,
      alreadyExisted: true,
    };
  }

  if (quote.status !== "ACCEPTED") throw new QuoteNotAcceptedForOrderError(quote.status);
  // Não contornar o lifecycle: produto técnico só vira operacional na aprovação.
  if (quote.project.status !== "APPROVED") {
    throw new ProjectNotApprovedForOrderError(quote.project.status);
  }

  /*
   * Só entra o que a proposta aceita contém. Produto marcado OUT_OF_SCOPE na
   * aprovação ficou fora do acordo comercial e não pode voltar por aqui.
   */
  const linhas = quote.lines.filter(
    (line) =>
      line.unitPrice !== null &&
      line.quotedQuantity !== null &&
      line.projectProduct?.status !== "OUT_OF_SCOPE",
  );
  if (linhas.length === 0) throw new QuoteWithoutOrderableLinesError();

  for (const line of linhas) {
    assertProductOperational(line.product, line.product.code);
    const unidadeDoProduto = line.product.finishedProductItem?.unitCode;
    if (!unidadeDoProduto) {
      throw new QuoteOrderUomMismatchError(line.product.code, line.uomCode ?? "—", "—");
    }
    /*
     * Unidades têm de coincidir. Converter mudaria a quantidade sem mudar o
     * preço unitário acordado, e o Pedido deixaria de representar o acordo.
     */
    if (line.uomCode !== unidadeDoProduto) {
      throw new QuoteOrderUomMismatchError(
        line.product.code,
        line.uomCode ?? "—",
        unidadeDoProduto,
      );
    }
  }

  const subtotal = linhas.reduce(
    (soma, line) => soma.plus(line.quotedQuantity!.times(line.unitPrice!)),
    new Prisma.Decimal(0),
  );
  const plano = congelarPlano(quote, subtotal);
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, CUSTOMER_ORDER_CODE_PREFIX);
  const proposta = quote;

  const gravar = (): Promise<string> =>
    prisma.$transaction(async (tx) => {
      const order = await tx.customerOrder.create({
        data: {
          code,
          customerId: proposta.project.customerId,
          sourceQuoteVersionId: proposta.id,
          sourceQuoteCode: proposta.code,
          sourceQuoteVersionNumber: proposta.versionNumber,
          sourceProjectId: proposta.projectId,
          sourceProjectCode: proposta.project.code,
          agreedSubtotalAmount: new Prisma.Decimal(plano.subtotal),
          ...(proposta.discountPercent
            ? { agreedDiscountPercent: proposta.discountPercent }
            : {}),
          agreedTotalAmount: new Prisma.Decimal(plano.total),
          agreedPaymentSchedule: plano as unknown as Prisma.InputJsonValue,
          ...(proposta.leadTimeDays
            ? {
                requestedDeliveryDate: new Date(
                  Date.now() + proposta.leadTimeDays * 24 * 60 * 60 * 1000,
                ),
              }
            : {}),
          createdBy: actor.name,
        },
      });

      await tx.customerOrderLine.createMany({
        data: linhas.map((line, index) => ({
          customerOrderId: order.id,
          productId: line.productId,
          orderedQuantity: line.quotedQuantity!,
          unitCode: line.uomCode!,
          position: index,
          sourceQuoteLineId: line.id,
          agreedUnitPrice: line.unitPrice!,
          agreedPriceSource: line.priceSource,
          /*
           * MANUAL permanece MANUAL: não se procura uma precificação
           * correspondente retroativamente, porque ela não existiu na
           * negociação. Os campos de faixa ficam nulos, e isso é a verdade.
           */
          ...(line.priceSource === "PRICING_TIER"
            ? {
                agreedPricingVersionId: line.pricingVersionId,
                agreedPricingTierId: line.pricingTierId,
                agreedPricingCode: line.pricingCodeSnapshot ?? line.pricingVersion?.code ?? null,
                agreedPricingVersionNumber:
                  line.pricingVersionNumberSnapshot ?? line.pricingVersion?.versionNumber ?? null,
                agreedPricingTierQuantity:
                  line.pricingTierQuantitySnapshot ?? line.pricingTier?.quantity ?? null,
                agreedPricingTierUom:
                  line.pricingTierUomSnapshot ?? line.pricingTier?.uomCode ?? null,
              }
            : {}),
        })),
      });

      return order.id;
    });

  try {
    const criadoId = await gravar();
    return { order: (await getCustomerOrderById(criadoId))!, alreadyExisted: false };
  } catch (error) {
    /*
     * Duas requisições simultâneas: o índice único deixa só uma passar. Quem
     * perde não estourou nada — o pedido existe, e é o dela também.
     */
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      String(error.meta?.target ?? "").includes("sourceQuoteVersionId")
    ) {
      const existente = await prisma.customerOrder.findUnique({
        where: { sourceQuoteVersionId: proposta.id },
        select: { id: true },
      });
      if (existente) {
        return { order: (await getCustomerOrderById(existente.id))!, alreadyExisted: true };
      }
    }
    throw error;
  }
}
