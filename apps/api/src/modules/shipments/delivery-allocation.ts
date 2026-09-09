import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { saldoDaLinhaProgramada } from "@veridi/shared";

/**
 * Qual entrega programada cada linha de Expedição ATENDE.
 *
 * O vínculo é uma coluna, não uma dedução: duas Expedições do mesmo produto no
 * mesmo Pedido podem servir promessas diferentes, e adivinhar qual delas seria
 * inventar história. `ShipmentLine.customerOrderDeliveryLineId` responde a
 * pergunta, e é dele que sai todo o "atendido" do cronograma.
 *
 * A ALOCAÇÃO é cronológica: a promessa mais antiga em aberto é servida
 * primeiro. Isso não é uma regra comercial nova — é a única leitura que mantém
 * as duas contas do Pedido coerentes. Sem ela, expedir 250 por fora do
 * cronograma deixaria "falta expedir 150" convivendo com "prometido 400 em
 * aberto", e o saldo programável ficaria preso em zero para sempre.
 *
 * Expedição preparada a partir de UMA entrega serve só aquela entrega: o
 * `deliveryId` restringe a fila, e a pessoa recebe exatamente o que a promessa
 * daquele dia pedia.
 */

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

/** Uma promessa em aberto, na ordem em que ela deve ser servida. */
export interface PromessaEmAberto {
  deliveryLineId: string;
  customerOrderLineId: string;
  /** Quanto ainda falta atender desta linha programada. */
  remaining: Prisma.Decimal;
}

/**
 * As promessas em aberto de um Pedido, por linha do Pedido, em ordem
 * cronológica de entrega.
 *
 * Só entregas NÃO canceladas: uma promessa cancelada não espera mais nada, e
 * uma expedição nova não pode ser atribuída a ela.
 */
export async function promessasEmAberto(
  prisma: PrismaOrTx,
  customerOrderId: string,
  deliveryIds?: string[],
): Promise<Map<string, PromessaEmAberto[]>> {
  const linhas = await prisma.customerOrderDeliveryLine.findMany({
    where: {
      delivery: {
        customerOrderId,
        cancelledAt: null,
        ...(deliveryIds && deliveryIds.length > 0 ? { id: { in: deliveryIds } } : {}),
      },
    },
    include: {
      delivery: { select: { scheduledDate: true, sequence: true } },
      shipmentLines: { include: { shipment: { select: { status: true } } } },
    },
    orderBy: [{ delivery: { scheduledDate: "asc" } }, { delivery: { sequence: "asc" } }],
  });

  const porOrderLine = new Map<string, PromessaEmAberto[]>();
  for (const linha of linhas) {
    const atendido = linha.shipmentLines.reduce(
      (soma, shipmentLine) =>
        shipmentLine.shipment.status === "CONFIRMED" ? soma.plus(shipmentLine.quantity) : soma,
      ZERO,
    );
    const remaining = saldoDaLinhaProgramada(linha.quantity, atendido);
    if (remaining.lessThanOrEqualTo(0)) continue;

    const fila = porOrderLine.get(linha.customerOrderLineId) ?? [];
    fila.push({
      deliveryLineId: linha.id,
      customerOrderLineId: linha.customerOrderLineId,
      remaining,
    });
    porOrderLine.set(linha.customerOrderLineId, fila);
  }
  return porOrderLine;
}

/**
 * Distribui as quantidades de uma Expedição entre as promessas em aberto.
 *
 * Devolve, para cada linha da Expedição, a linha programada que ela atende —
 * ou `null` quando não há promessa em aberto para aquele produto. Sem promessa
 * o vínculo fica nulo, e é a leitura certa: a Expedição existe, o cronograma
 * não a esperava, e nenhuma entrega ganha um atendimento que não recebeu.
 *
 * A quantidade da linha NÃO é dividida entre duas promessas: uma linha de
 * Expedição é uma quantidade de um lote, e parti-la aqui criaria uma linha que
 * o operador não separou. Quando a linha é maior que a promessa mais antiga, o
 * excesso fica sem vínculo — e a validação da confirmação recusa o que passar
 * do prometido.
 */
export function alocarPromessas<T extends { customerOrderLineId: string; quantity: Prisma.Decimal }>(
  linhas: T[],
  promessas: Map<string, PromessaEmAberto[]>,
): (string | null)[] {
  const restantePorPromessa = new Map<string, Prisma.Decimal>();
  for (const fila of promessas.values()) {
    for (const promessa of fila) restantePorPromessa.set(promessa.deliveryLineId, promessa.remaining);
  }

  return linhas.map((linha) => {
    const fila = promessas.get(linha.customerOrderLineId) ?? [];
    for (const promessa of fila) {
      const restante = restantePorPromessa.get(promessa.deliveryLineId) ?? ZERO;
      if (restante.greaterThanOrEqualTo(linha.quantity) && linha.quantity.greaterThan(0)) {
        restantePorPromessa.set(promessa.deliveryLineId, restante.minus(linha.quantity));
        return promessa.deliveryLineId;
      }
    }
    return null;
  });
}

/**
 * O teto que a programação impõe a uma linha do Pedido nesta Expedição.
 *
 * Usado quando a Expedição nasce a partir de UMA entrega: propor mais do que
 * aquela promessa pedia transformaria "preparar a entrega de outubro" em
 * "expedir o pedido inteiro".
 */
export function tetoDaPromessa(
  promessas: Map<string, PromessaEmAberto[]>,
  customerOrderLineId: string,
): Prisma.Decimal {
  const fila = promessas.get(customerOrderLineId) ?? [];
  return fila.reduce((soma, promessa) => soma.plus(promessa.remaining), ZERO);
}
