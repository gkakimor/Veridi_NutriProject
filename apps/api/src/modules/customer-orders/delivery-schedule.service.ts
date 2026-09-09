import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  CreateDeliveryScheduleInput,
  CustomerOrderDeliveryScheduleDTO,
  DeliveryScheduleDTO,
  DeliveryScheduleLineDTO,
  DeliveryScheduleShipmentDTO,
  RescheduleDeliveryInput,
  SchedulableLineDTO,
} from "@veridi/shared";
import {
  hojeComercial,
  saldoDaLinhaProgramada,
  saldoProgramavel,
  situacaoDaEntrega,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { diaDaColunaDeData, marcadorDoDiaCivil } from "../../lib/business-day.js";
import { getShippedByOrderLines } from "../shipments/shipments.service.js";
import { CustomerOrderNotFoundError } from "./customer-orders.errors.js";
import {
  DeliveryAlreadyCancelledError,
  DeliveryAlreadyFulfilledError,
  DeliveryHasDraftShipmentError,
  DeliveryNotFoundError,
  DuplicateDeliveryLineError,
  EmptyDeliveryError,
  ExceedsSchedulableQuantityError,
  OrderNotSchedulableError,
  UnknownDeliveryLineError,
} from "./delivery-schedule.errors.js";

/**
 * Entregas programadas de um Pedido — a promessa de QUANDO cada parte sai.
 *
 * Este serviço só escreve `customer_order_deliveries` e as suas linhas.
 * NUNCA toca em reserva, lote, movimento de estoque, Ordem de Produção,
 * Expedição ou Faturamento: programar é um compromisso comercial, e a
 * execução continua inteira nos motores que já existem.
 *
 * Situação é sempre DERIVADA (`@veridi/shared/customer-order-deliveries`). O
 * único estado gravado é o cancelamento — e a relação de substituição, que é
 * o que faz uma reprogramação continuar contando a história da promessa
 * anterior.
 */

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** Pedido já confirmado: antes disso não existe compromisso a programar. */
const SCHEDULABLE_ORDER_STATUSES = [
  "CONFIRMED",
  "IN_FULFILLMENT",
  "PARTIALLY_SHIPPED",
] as const;

const ZERO = new Prisma.Decimal(0);

type DeliveryRow = Prisma.CustomerOrderDeliveryGetPayload<{
  include: {
    lines: {
      include: {
        customerOrderLine: { include: { product: true } };
        shipmentLines: { include: { shipment: true } };
      };
    };
    replacesDelivery: { select: { id: true; sequence: true } };
    replacedByDelivery: { select: { id: true; sequence: true } };
  };
}>;

const DELIVERY_INCLUDE = {
  lines: {
    include: {
      customerOrderLine: { include: { product: true } },
      shipmentLines: { include: { shipment: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  replacesDelivery: { select: { id: true, sequence: true } },
  replacedByDelivery: { select: { id: true, sequence: true } },
} satisfies Prisma.CustomerOrderDeliveryInclude;

/**
 * O que uma linha programada JÁ RECEBEU.
 *
 * Fonte única e explícita: linhas de Expedição ligadas a esta linha da
 * entrega, e só de Expedição CONFIRMED. DRAFT é separação em curso e não
 * entregou nada; CANCELLED nunca entregou. Produto igual noutra Expedição sem
 * vínculo não conta — atendimento não se infere.
 */
function atendidoDaLinha(linha: DeliveryRow["lines"][number]): Prisma.Decimal {
  return linha.shipmentLines.reduce(
    (soma, shipmentLine) =>
      shipmentLine.shipment.status === "CONFIRMED" ? soma.plus(shipmentLine.quantity) : soma,
    ZERO,
  );
}

/**
 * As Expedições em RASCUNHO que já estão separando esta entrega.
 *
 * Elas não atendem nada — só a confirmação atende —, mas trancam a promessa:
 * alterar o compromisso por baixo de uma separação em andamento deixaria quem
 * está conferindo lote apontando para uma promessa que mudou de forma.
 */
function separacoesEmAndamento(delivery: DeliveryRow): string[] {
  const codigos = new Set<string>();
  for (const linha of delivery.lines) {
    for (const shipmentLine of linha.shipmentLines) {
      if (shipmentLine.shipment.status === "DRAFT") codigos.add(shipmentLine.shipment.code);
    }
  }
  return [...codigos].sort();
}

function toLineDTO(linha: DeliveryRow["lines"][number]): DeliveryScheduleLineDTO {
  const atendido = atendidoDaLinha(linha);
  const orderLine = linha.customerOrderLine;
  return {
    id: linha.id,
    customerOrderLineId: linha.customerOrderLineId,
    productId: orderLine.productId,
    productCode: orderLine.productCode ?? orderLine.product.code,
    productName: orderLine.productName ?? orderLine.product.name,
    unitCode: orderLine.unitCode,
    quantity: linha.quantity.toString(),
    fulfilledQuantity: atendido.toString(),
    remainingQuantity: saldoDaLinhaProgramada(linha.quantity, atendido).toString(),
  };
}

/**
 * As Expedições que tocaram esta entrega, agregadas por documento.
 *
 * DRAFT aparece de propósito: quem abriu a entrega precisa saber que já existe
 * uma separação em andamento para ela — mas o número dela nunca entra no
 * atendido.
 */
function toShipmentDTOs(delivery: DeliveryRow): DeliveryScheduleShipmentDTO[] {
  const porExpedicao = new Map<string, DeliveryScheduleShipmentDTO>();
  for (const linha of delivery.lines) {
    for (const shipmentLine of linha.shipmentLines) {
      const shipment = shipmentLine.shipment;
      const atual = porExpedicao.get(shipment.id);
      if (atual) {
        atual.quantity = new Prisma.Decimal(atual.quantity).plus(shipmentLine.quantity).toString();
        continue;
      }
      porExpedicao.set(shipment.id, {
        shipmentId: shipment.id,
        shipmentCode: shipment.code,
        status: shipment.status,
        shipmentDate: shipment.shipmentDate ? shipment.shipmentDate.toISOString() : null,
        quantity: shipmentLine.quantity.toString(),
      });
    }
  }
  return [...porExpedicao.values()].sort((a, b) => a.shipmentCode.localeCompare(b.shipmentCode));
}

function toDeliveryDTO(delivery: DeliveryRow, hojeISO: string): DeliveryScheduleDTO {
  const lines = delivery.lines.map(toLineDTO);
  const soma = (campo: keyof Pick<DeliveryScheduleLineDTO, "quantity" | "fulfilledQuantity" | "remainingQuantity">) =>
    lines.reduce((total, linha) => total.plus(linha[campo]), ZERO).toString();

  return {
    id: delivery.id,
    customerOrderId: delivery.customerOrderId,
    sequence: delivery.sequence,
    scheduledDate: diaDaColunaDeData(delivery.scheduledDate),
    notes: delivery.notes,
    status: situacaoDaEntrega({
      cancelada: delivery.cancelledAt !== null,
      scheduledDateISO: diaDaColunaDeData(delivery.scheduledDate),
      hojeISO,
      linhas: delivery.lines.map((linha) => ({
        prometido: linha.quantity,
        atendido: atendidoDaLinha(linha),
      })),
    }),
    lines,
    shipments: toShipmentDTOs(delivery),
    totalQuantity: soma("quantity"),
    totalFulfilledQuantity: soma("fulfilledQuantity"),
    totalRemainingQuantity: soma("remainingQuantity"),
    cancelledAt: delivery.cancelledAt ? delivery.cancelledAt.toISOString() : null,
    cancelledBy: delivery.cancelledBy,
    cancelReason: delivery.cancelReason,
    replacesDeliveryId: delivery.replacesDelivery?.id ?? null,
    replacesDeliverySequence: delivery.replacesDelivery?.sequence ?? null,
    // 1:N no schema (um saldo pode virar várias datas), mas o fluxo de
    // reprogramação cria UMA substituta — a primeira é a que a tela mostra.
    replacedByDeliveryId: delivery.replacedByDelivery[0]?.id ?? null,
    replacedByDeliverySequence: delivery.replacedByDelivery[0]?.sequence ?? null,
    createdAt: delivery.createdAt.toISOString(),
    createdBy: delivery.createdBy,
  };
}

/**
 * O saldo programável de cada linha do Pedido.
 *
 * `pedido − expedido − pendente das entregas ativas`.
 *
 * O expedido vem de `getShippedByOrderLines`, a MESMA função que a Expedição e
 * o Pedido usam — programação não inaugura uma segunda contagem do que saiu.
 *
 * Entrega cancelada entra nas duas contas de formas opostas, e é isso que faz
 * o cancelamento parcial fechar: o que ela expediu continua descontado, o que
 * restava dela deixa de ocupar programação.
 */
export async function calcularProgramavel(
  prisma: PrismaOrTx,
  customerOrderId: string,
): Promise<{ porLinha: Map<string, Prisma.Decimal>; dto: SchedulableLineDTO[] }> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: customerOrderId },
    include: { lines: { include: { product: true }, orderBy: { position: "asc" } } },
  });
  if (!order) throw new CustomerOrderNotFoundError(customerOrderId);

  const shippedByLine = await getShippedByOrderLines(
    prisma,
    order.lines.map((line) => line.id),
  );

  const pendentes = await prisma.customerOrderDeliveryLine.findMany({
    where: {
      delivery: { customerOrderId, cancelledAt: null },
    },
    include: { shipmentLines: { include: { shipment: { select: { status: true } } } } },
  });

  const pendenteAtivoPorLinha = new Map<string, Prisma.Decimal>();
  for (const linha of pendentes) {
    const atendido = linha.shipmentLines.reduce(
      (soma, shipmentLine) =>
        shipmentLine.shipment.status === "CONFIRMED" ? soma.plus(shipmentLine.quantity) : soma,
      ZERO,
    );
    const pendente = saldoDaLinhaProgramada(linha.quantity, atendido);
    const atual = pendenteAtivoPorLinha.get(linha.customerOrderLineId) ?? ZERO;
    pendenteAtivoPorLinha.set(linha.customerOrderLineId, atual.plus(pendente));
  }

  const porLinha = new Map<string, Prisma.Decimal>();
  const dto: SchedulableLineDTO[] = [];
  for (const line of order.lines) {
    const expedido = shippedByLine.get(line.id) ?? ZERO;
    const pendenteAtivo = pendenteAtivoPorLinha.get(line.id) ?? ZERO;
    const programavel = saldoProgramavel({
      pedido: line.orderedQuantity,
      expedido,
      pendenteEmEntregasAtivas: pendenteAtivo,
    });
    porLinha.set(line.id, programavel);
    dto.push({
      customerOrderLineId: line.id,
      productId: line.productId,
      productCode: line.productCode ?? line.product.code,
      productName: line.productName ?? line.product.name,
      unitCode: line.unitCode,
      orderedQuantity: line.orderedQuantity.toString(),
      shippedQuantity: expedido.toString(),
      scheduledPendingQuantity: pendenteAtivo.toString(),
      schedulableQuantity: programavel.toString(),
    });
  }

  return { porLinha, dto };
}

export async function getDeliverySchedule(
  customerOrderId: string,
  agora: Date = new Date(),
): Promise<CustomerOrderDeliveryScheduleDTO> {
  const prisma = getPrisma();
  const hojeISO = hojeComercial(agora);

  const [deliveries, programavel] = await Promise.all([
    prisma.customerOrderDelivery.findMany({
      where: { customerOrderId },
      include: DELIVERY_INCLUDE,
      orderBy: [{ scheduledDate: "asc" }, { sequence: "asc" }],
    }),
    calcularProgramavel(prisma, customerOrderId),
  ]);

  return {
    deliveries: deliveries.map((delivery) => toDeliveryDTO(delivery, hojeISO)),
    schedulable: programavel.dto,
  };
}

async function carregarEntrega(prisma: PrismaOrTx, id: string): Promise<DeliveryRow> {
  const delivery = await prisma.customerOrderDelivery.findUnique({
    where: { id },
    include: DELIVERY_INCLUDE,
  });
  if (!delivery) throw new DeliveryNotFoundError(id);
  return delivery;
}

/**
 * Grava a entrega e as suas linhas, validando o saldo programável DENTRO da
 * transação.
 *
 * O `SELECT ... FOR UPDATE` no Pedido é o mesmo lock que o Plano de
 * Atendimento e a criação de Expedição já tomam, e na mesma ordem: sem ele
 * duas pessoas programando ao mesmo tempo leriam o mesmo saldo e as duas
 * passariam. Validar só no navegador deixaria o banco aceitar 600 + 600
 * contra 1.000.
 */
async function criarEntregaNaTransacao(
  tx: Prisma.TransactionClient,
  customerOrderId: string,
  input: CreateDeliveryScheduleInput,
  actor: { id: string; name: string } | undefined,
  replacesDeliveryId: string | null,
): Promise<string> {
  await tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${customerOrderId} FOR UPDATE`;

  const order = await tx.customerOrder.findUnique({
    where: { id: customerOrderId },
    include: { lines: { include: { product: true } } },
  });
  if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
  if (!SCHEDULABLE_ORDER_STATUSES.includes(order.status as (typeof SCHEDULABLE_ORDER_STATUSES)[number])) {
    throw new OrderNotSchedulableError(
      "Somente pedidos confirmados ou em atendimento aceitam entregas programadas.",
    );
  }

  const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
  const vistas = new Set<string>();
  const linhas = input.lines
    .map((linha) => ({ ...linha, quantidade: new Prisma.Decimal(linha.quantity) }))
    .filter((linha) => linha.quantidade.greaterThan(0));

  if (linhas.length === 0) throw new EmptyDeliveryError();

  for (const linha of linhas) {
    const orderLine = orderLinesById.get(linha.customerOrderLineId);
    if (!orderLine) throw new UnknownDeliveryLineError(linha.customerOrderLineId);
    if (vistas.has(linha.customerOrderLineId)) {
      throw new DuplicateDeliveryLineError(orderLine.productCode ?? orderLine.product.code);
    }
    vistas.add(linha.customerOrderLineId);
  }

  const { porLinha } = await calcularProgramavel(tx, customerOrderId);
  for (const linha of linhas) {
    const orderLine = orderLinesById.get(linha.customerOrderLineId)!;
    const programavel = porLinha.get(linha.customerOrderLineId) ?? ZERO;
    if (linha.quantidade.greaterThan(programavel)) {
      throw new ExceedsSchedulableQuantityError(
        orderLine.productCode ?? orderLine.product.code,
        programavel.toString(),
      );
    }
  }

  const ultima = await tx.customerOrderDelivery.findFirst({
    where: { customerOrderId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });

  const delivery = await tx.customerOrderDelivery.create({
    data: {
      customerOrderId,
      sequence: (ultima?.sequence ?? 0) + 1,
      scheduledDate: marcadorDoDiaCivil(input.scheduledDate),
      notes: input.notes ?? null,
      createdBy: actor?.name ?? null,
      replacesDeliveryId,
    },
  });

  await tx.customerOrderDeliveryLine.createMany({
    data: linhas.map((linha) => ({
      deliveryId: delivery.id,
      customerOrderLineId: linha.customerOrderLineId,
      quantity: linha.quantidade,
    })),
  });

  return delivery.id;
}

export async function createDeliverySchedule(
  customerOrderId: string,
  input: CreateDeliveryScheduleInput,
  actor?: { id: string; name: string },
): Promise<CustomerOrderDeliveryScheduleDTO> {
  const prisma = getPrisma();
  await prisma.$transaction((tx) =>
    criarEntregaNaTransacao(tx, customerOrderId, input, actor, null),
  );
  return getDeliverySchedule(customerOrderId);
}

/**
 * Cancela a entrega. Motivo obrigatório.
 *
 * O que o cancelamento faz: tira o SALDO PENDENTE da conta de programação.
 * O que ele NÃO faz: mexer em Expedição, movimento de estoque, Ordem de
 * Produção ou Faturamento. As quantidades já expedidas continuam ligadas a
 * esta entrega e continuam visíveis nela — cancelar não é dizer que a entrega
 * nunca existiu.
 */
export async function cancelDeliverySchedule(
  deliveryId: string,
  reason: string,
  actor?: { id: string; name: string },
): Promise<CustomerOrderDeliveryScheduleDTO> {
  const prisma = getPrisma();
  const customerOrderId = await prisma.$transaction(async (tx) => {
    const delivery = await carregarEntrega(tx, deliveryId);
    if (delivery.cancelledAt) throw new DeliveryAlreadyCancelledError(delivery.sequence);

    const emAndamento = separacoesEmAndamento(delivery);
    if (emAndamento.length > 0) {
      throw new DeliveryHasDraftShipmentError(delivery.sequence, emAndamento);
    }

    const pendente = delivery.lines.reduce(
      (soma, linha) => soma.plus(saldoDaLinhaProgramada(linha.quantity, atendidoDaLinha(linha))),
      ZERO,
    );
    if (delivery.lines.length > 0 && pendente.isZero()) {
      throw new DeliveryAlreadyFulfilledError(delivery.sequence, "cancelar");
    }

    await tx.customerOrderDelivery.update({
      where: { id: deliveryId },
      data: {
        cancelledAt: new Date(),
        cancelledBy: actor?.name ?? null,
        cancelReason: reason,
      },
    });
    return delivery.customerOrderId;
  });

  return getDeliverySchedule(customerOrderId);
}

/**
 * Reprograma: cancela a entrega atual e cria uma substituta com os SALDOS
 * AINDA PENDENTES, na data nova.
 *
 * Não existe `PATCH scheduledDate`. Editar a data no lugar apagaria a
 * evidência de que 15/10 foi prometido antes de 15/11, e é justamente essa
 * evidência que explica o atraso ao cliente. A cadeia A → B → C fica inteira,
 * cada elo com o seu motivo.
 *
 * Linha já inteiramente atendida não é copiada: ela cumpriu a promessa e não
 * tem nada a reprogramar.
 */
export async function rescheduleDelivery(
  deliveryId: string,
  input: RescheduleDeliveryInput,
  actor?: { id: string; name: string },
): Promise<CustomerOrderDeliveryScheduleDTO> {
  const prisma = getPrisma();

  const customerOrderId = await prisma.$transaction(async (tx) => {
    const delivery = await carregarEntrega(tx, deliveryId);
    if (delivery.cancelledAt) throw new DeliveryAlreadyCancelledError(delivery.sequence);

    const emAndamento = separacoesEmAndamento(delivery);
    if (emAndamento.length > 0) {
      throw new DeliveryHasDraftShipmentError(delivery.sequence, emAndamento);
    }

    const pendentes = delivery.lines
      .map((linha) => ({
        customerOrderLineId: linha.customerOrderLineId,
        quantity: saldoDaLinhaProgramada(linha.quantity, atendidoDaLinha(linha)),
      }))
      .filter((linha) => linha.quantity.greaterThan(0));

    if (pendentes.length === 0) {
      throw new DeliveryAlreadyFulfilledError(delivery.sequence, "reprogramar");
    }

    /*
     * Cancelar ANTES de criar: é o cancelamento que devolve o saldo pendente
     * ao programável, e é sobre esse saldo que a substituta é validada. Na
     * ordem inversa a substituta disputaria espaço com a original e a
     * reprogramação de uma entrega que ocupa todo o saldo seria recusada.
     */
    await tx.customerOrderDelivery.update({
      where: { id: deliveryId },
      data: {
        cancelledAt: new Date(),
        cancelledBy: actor?.name ?? null,
        cancelReason: input.reason,
      },
    });

    await criarEntregaNaTransacao(
      tx,
      delivery.customerOrderId,
      {
        scheduledDate: input.scheduledDate,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        lines: pendentes.map((linha) => ({
          customerOrderLineId: linha.customerOrderLineId,
          quantity: linha.quantity.toString(),
        })),
      },
      actor,
      deliveryId,
    );

    return delivery.customerOrderId;
  });

  return getDeliverySchedule(customerOrderId);
}
