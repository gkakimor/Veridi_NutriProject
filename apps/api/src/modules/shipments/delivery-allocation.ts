import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { AlocacaoDaEntrega, PromessaPendente } from "@veridi/shared";
import { alocarQuantidadeNasEntregasPendentes, saldoDaLinhaProgramada } from "@veridi/shared";

/**
 * Qual entrega programada cada linha de Expedição ATENDE.
 *
 * O vínculo é uma coluna, não uma dedução: duas Expedições do mesmo produto no
 * mesmo Pedido podem servir promessas diferentes, e adivinhar qual delas seria
 * inventar história. `ShipmentLine.customerOrderDeliveryLineId` responde a
 * pergunta, e é dele que sai todo o "atendido" do cronograma.
 *
 * Dois fluxos, duas regras:
 *
 * - **Separação aberta pela ENTREGA** (`Shipment.originDeliveryId` preenchido).
 *   Aquela Expedição representa aquela promessa. A proposta nasce limitada ao
 *   que ela pedia, e passar disso é RECUSA — nunca transbordo para a promessa
 *   seguinte. Quem quer expedir mais abre outra separação.
 * - **Separação aberta pelo PEDIDO** (sem origem). A quantidade atravessa
 *   promessas na ordem em que elas foram prometidas: 500 contra uma entrega de
 *   400 e outra de 600 atende 400 na primeira e 100 na segunda. O que sobrar
 *   depois de esgotá-las fica sem vínculo, e isso é legítimo — o Pedido pode
 *   ter saldo real sem promessa para ele.
 *
 * A ordem é `scheduledDate`, depois `sequence`, depois `id`. Os dois primeiros
 * são semânticos: a promessa mais antiga é servida primeiro, e duas promessas
 * do mesmo dia se desempatam pela ordem em que foram feitas. O `id` entra só
 * para o resultado ser estável, nunca como critério de negócio — e por isso
 * `createdAt` não aparece aqui: "quando alguém digitou" não decide quem o
 * cliente recebe primeiro.
 */

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

/** Uma promessa em aberto, com a linha do Pedido a que ela pertence. */
export interface PromessaEmAberto extends PromessaPendente {
  customerOrderLineId: string;
}

/**
 * As promessas em aberto de um Pedido, por linha do Pedido, na ordem em que
 * devem ser servidas.
 *
 * Só entregas NÃO canceladas: uma promessa cancelada não espera mais nada, e
 * uma expedição nova não pode ser atribuída a ela — o que ela já recebeu
 * continua ligado a ela, como história. Linha sem saldo pendente também sai da
 * fila: promessa cumprida não recebe duas vezes.
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
      shipmentLines: { include: { shipment: { select: { status: true } } } },
    },
    orderBy: [
      { delivery: { scheduledDate: "asc" } },
      { delivery: { sequence: "asc" } },
      { id: "asc" },
    ],
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

/** Uma linha a separar: um lote reservado e quanto sai dele. */
export interface LinhaASeparar {
  customerOrderLineId: string;
  quantity: Prisma.Decimal;
}

/** A mesma linha, repartida entre as promessas que ela atende. */
export interface LinhaRepartida<T> {
  origem: T;
  pedacos: AlocacaoDaEntrega[];
}

/**
 * Reparte as linhas de uma separação entre as promessas em aberto.
 *
 * Uma linha de lote pode virar DUAS linhas de Expedição quando a quantidade
 * atravessa promessas — mesmo lote, mesma reserva, mesma origem física, dois
 * compromissos atendidos. É a única representação possível com um vínculo por
 * linha, e o modelo já a suportava: nada impede duas linhas da mesma reserva na
 * mesma Expedição, e a confirmação já somava o teto por reserva em vez de por
 * linha.
 *
 * O saldo de cada promessa é consumido ao longo de TODAS as linhas: dois lotes
 * do mesmo produto disputam a mesma promessa, e servir os dois inteiros
 * prometeria duas vezes o que o cliente pediu uma.
 */
export function repartirNasPromessas<T extends LinhaASeparar>(
  linhas: T[],
  promessas: Map<string, PromessaEmAberto[]>,
): LinhaRepartida<T>[] {
  const restantePorPromessa = new Map<string, Prisma.Decimal>();
  for (const fila of promessas.values()) {
    for (const promessa of fila) {
      restantePorPromessa.set(promessa.deliveryLineId, promessa.remaining as Prisma.Decimal);
    }
  }

  return linhas.map((linha) => {
    const fila = (promessas.get(linha.customerOrderLineId) ?? []).map((promessa) => ({
      deliveryLineId: promessa.deliveryLineId,
      remaining: restantePorPromessa.get(promessa.deliveryLineId) ?? ZERO,
    }));

    const pedacos = alocarQuantidadeNasEntregasPendentes(linha.quantity, fila);
    for (const pedaco of pedacos) {
      if (!pedaco.deliveryLineId) continue;
      const restante = restantePorPromessa.get(pedaco.deliveryLineId) ?? ZERO;
      restantePorPromessa.set(pedaco.deliveryLineId, restante.minus(pedaco.quantity));
    }
    return { origem: linha, pedacos };
  });
}

/**
 * O teto que a programação impõe a uma linha do Pedido.
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
  return fila.reduce((soma, promessa) => soma.plus(promessa.remaining as Prisma.Decimal), ZERO);
}
