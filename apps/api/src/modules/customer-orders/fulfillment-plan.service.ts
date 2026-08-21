import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  CustomerOrderDTO,
  FulfillmentLineSituation,
  FulfillmentPlanDTO,
  FulfillmentPlanLineDTO,
  MaterialImpactRowDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  getAvailableByItems,
  getOnHandByItems,
  getOnOrderByItems,
  getReservedByItems,
} from "../../lib/inventory-ledger.js";
import { getAllocationSuggestion } from "../inventory/allocation.service.js";
import { PRODUCTION_ORDER_CODE_PREFIX } from "@veridi/shared";
import { createDraftProductionOrderInTx } from "../production-orders/production-orders.service.js";
import { computeFormulationRequirements } from "../production-orders/requirement-calc.js";
import { CustomerOrderNotFoundError } from "./customer-orders.errors.js";
import { getCustomerOrderById } from "./customer-orders.service.js";
import {
  CustomerOrderNotConfirmedError,
  ExcessiveReserveError,
  IncompletePlanCoverageError,
  MissingPlanLineError,
  NoPendingProductionError,
  RemainderExceedsPendingError,
  ProductNoLongerValidForProductionError,
  UnknownPlanLineError,
} from "./fulfillment-plan.errors.js";
import type {
  ApplyFulfillmentPlanInput,
  CreateRemainderOrderInput,
} from "./fulfillment-plan.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";
const PRODUCTION_ORDER_CODE_SEQUENCE = "production_order_code_seq";

/** Reutilizado por `purchase-suggestion.service.ts` — nunca duplicar. */
export async function itemScopesFor(prisma: PrismaOrTx, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds } } });
  return items.map((item) => ({ id: item.id, controlsLot: item.controlsLot }));
}

/**
 * Agrega a necessidade de material (secao 30 do handoff) entre todos os
 * Products com deficit do Plano — mesmo material aparecendo em mais de uma
 * producao sugerida soma numa unica linha. Reutiliza EXATAMENTE
 * `computeFormulationRequirements` (nunca duplica a matematica de
 * formulacao/UOM em um segundo lugar).
 */
async function computeMaterialImpact(
  prisma: PrismaOrTx,
  needs: { productId: string; produceQuantity: Prisma.Decimal }[],
): Promise<MaterialImpactRowDTO[]> {
  if (needs.length === 0) return [];

  const aggregated = new Map<
    string,
    { itemCode: string; itemName: string; unitCode: string; required: Prisma.Decimal }
  >();

  for (const need of needs) {
    const version = await prisma.formulationVersion.findFirst({
      where: { productId: need.productId, status: "ACTIVE" },
    });
    if (!version) continue;

    const rows = await computeFormulationRequirements(prisma, version.id, need.produceQuantity);
    for (const row of rows) {
      const current = aggregated.get(row.itemId);
      if (current) {
        current.required = current.required.plus(row.requiredQuantity);
      } else {
        aggregated.set(row.itemId, {
          itemCode: row.itemCode,
          itemName: row.itemName,
          unitCode: row.stockUnitCode,
          required: row.requiredQuantity,
        });
      }
    }
  }

  if (aggregated.size === 0) return [];
  const itemIds = [...aggregated.keys()];
  const [onHandByItem, reservedByItem, onOrderByItem, availableByItem] = await Promise.all([
    getOnHandByItems(prisma, itemIds),
    getReservedByItems(prisma, itemIds),
    getOnOrderByItems(prisma, itemIds),
    getAvailableByItems(prisma, await itemScopesFor(prisma, itemIds)),
  ]);

  return itemIds.map((itemId) => {
    const info = aggregated.get(itemId)!;
    const onHand = onHandByItem.get(itemId) ?? new Prisma.Decimal(0);
    const reserved = reservedByItem.get(itemId) ?? new Prisma.Decimal(0);
    const onOrder = onOrderByItem.get(itemId) ?? new Prisma.Decimal(0);
    const available = availableByItem.get(itemId) ?? new Prisma.Decimal(0);
    // On Order nunca reduz o shortage fisico — mesmo principio da OP.
    const shortage = Prisma.Decimal.max(info.required.minus(available), 0);
    return {
      itemId,
      itemCode: info.itemCode,
      itemName: info.itemName,
      requiredQuantity: info.required.toString(),
      unitCode: info.unitCode,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      onOrder: onOrder.toString(),
      shortage: shortage.toString(),
    };
  });
}

/**
 * Analise/projecao — nunca persiste reserva ou OP. `Reserve = min(Ordered,
 * Available)` e `Produce = Ordered - Reserve` (estoque primeiro, secao 9-10
 * do handoff). So disponivel para pedidos CONFIRMED (e antes de aplicado —
 * apos IN_FULFILLMENT a tela usa `reservation`/`generatedProductionOrders`
 * do proprio CustomerOrderDTO, nunca recalcula o plano de novo).
 */
export async function getFulfillmentPlan(customerOrderId: string): Promise<FulfillmentPlanDTO> {
  const prisma = getPrisma();
  const order = await prisma.customerOrder.findUnique({
    where: { id: customerOrderId },
    include: { lines: true },
  });
  if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
  if (order.status !== "CONFIRMED") {
    throw new CustomerOrderNotConfirmedError(
      "Plano de Atendimento só está disponível para pedidos confirmados.",
    );
  }

  const finishedItemIds = [...new Set(order.lines.map((line) => line.finishedItemId!))];
  const [onHandByItem, reservedByItem, availableByItem] = await Promise.all([
    getOnHandByItems(prisma, finishedItemIds),
    getReservedByItems(prisma, finishedItemIds),
    getAvailableByItems(prisma, await itemScopesFor(prisma, finishedItemIds)),
  ]);

  const lines: FulfillmentPlanLineDTO[] = [];
  const productionNeeds: { productId: string; produceQuantity: Prisma.Decimal }[] = [];

  for (const line of order.lines) {
    const finishedItemId = line.finishedItemId!;
    const onHand = onHandByItem.get(finishedItemId) ?? new Prisma.Decimal(0);
    const reserved = reservedByItem.get(finishedItemId) ?? new Prisma.Decimal(0);
    const available = availableByItem.get(finishedItemId) ?? new Prisma.Decimal(0);

    const ordered = line.orderedQuantity;
    const suggestedReserve = Prisma.Decimal.min(ordered, available);
    const suggestedProduce = Prisma.Decimal.max(ordered.minus(suggestedReserve), 0);

    let situation: FulfillmentLineSituation = "ESTOQUE_SUFICIENTE";
    if (suggestedProduce.greaterThan(0)) {
      const activeVersion = await prisma.formulationVersion.findFirst({
        where: { productId: line.productId, status: "ACTIVE" },
      });
      situation = activeVersion ? "REQUER_PRODUCAO" : "SEM_FORMULACAO_ATIVA";
      if (activeVersion) {
        productionNeeds.push({ productId: line.productId, produceQuantity: suggestedProduce });
      }
    }

    lines.push({
      customerOrderLineId: line.id,
      productId: line.productId,
      productCode: line.productCode!,
      productName: line.productName!,
      orderedQuantity: ordered.toString(),
      unitCode: line.unitCode,
      finishedGoodsOnHand: onHand.toString(),
      finishedGoodsReserved: reserved.toString(),
      finishedGoodsAvailable: available.toString(),
      suggestedReserveQuantity: suggestedReserve.toString(),
      suggestedProductionQuantity: suggestedProduce.toString(),
      situation,
    });
  }

  const materialImpact = await computeMaterialImpact(prisma, productionNeeds);

  return { customerOrderId, lines, materialImpact };
}

/**
 * Aplica o Plano — transacional (secao 24 do handoff). Reserva Produto
 * Acabado (FEFO/FIFO via o MESMO `allocation.service.ts`, nunca um servico
 * duplicado) e cria OP DRAFT para o deficit de cada linha, no maximo uma
 * por linha. Tudo ou nada: qualquer falha reverte a transacao inteira.
 * `CustomerOrder` so vira `IN_FULFILLMENT` no fim, se tudo aplicar.
 */
export async function applyFulfillmentPlan(
  customerOrderId: string,
  input: ApplyFulfillmentPlanInput,
  actor?: { id: string; name: string },
): Promise<CustomerOrderDTO> {
  const prisma = getPrisma();

  // Codigos de OP gerados fora da transacao (mesmo padrao ja usado em
  // Recebimento/OC/OP) — nextval e atomico por si so, seguro mesmo fora do
  // lock. No maximo 1 OP por linha com produceQuantity > 0.
  const linesNeedingProduction = input.lines.filter((line) => new Prisma.Decimal(line.produceQuantity).greaterThan(0));
  const productionOrderCodes = new Map<string, string>();
  for (const line of linesNeedingProduction) {
    productionOrderCodes.set(
      line.customerOrderLineId,
      await nextSequenceCode(prisma, PRODUCTION_ORDER_CODE_SEQUENCE, PRODUCTION_ORDER_CODE_PREFIX),
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${customerOrderId} FOR UPDATE`;

    const order = await tx.customerOrder.findUnique({
      where: { id: customerOrderId },
      include: { lines: true },
    });
    if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
    if (order.status !== "CONFIRMED") {
      throw new CustomerOrderNotConfirmedError(
        "Só é possível aplicar o Plano de Atendimento de um pedido confirmado (um pedido em atendimento não pode reaplicar o plano).",
      );
    }

    const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
    const payloadByLineId = new Map(input.lines.map((line) => [line.customerOrderLineId, line]));

    for (const line of order.lines) {
      if (!payloadByLineId.has(line.id)) throw new MissingPlanLineError(line.id);
    }
    for (const payloadLine of input.lines) {
      const orderLine = orderLinesById.get(payloadLine.customerOrderLineId);
      if (!orderLine) throw new UnknownPlanLineError(payloadLine.customerOrderLineId);

      const reserveQuantity = new Prisma.Decimal(payloadLine.reserveQuantity);
      const produceQuantity = new Prisma.Decimal(payloadLine.produceQuantity);
      if (!reserveQuantity.plus(produceQuantity).equals(orderLine.orderedQuantity)) {
        throw new IncompletePlanCoverageError(orderLine.id);
      }
    }

    // Trava os Finished Product Items envolvidos em ordem deterministica —
    // serializa Pedidos concorrentes disputando o mesmo Produto Acabado
    // (mesmo padrao do RELEASE de OP).
    const finishedItemIds = [...new Set(order.lines.map((line) => line.finishedItemId!))].sort();
    await tx.$queryRaw`SELECT id FROM items WHERE id IN (${Prisma.join(finishedItemIds)}) ORDER BY id FOR UPDATE`;

    const items = await tx.item.findMany({ where: { id: { in: finishedItemIds } } });
    const itemsById = new Map(items.map((item) => [item.id, item]));

    const reservationLinesToCreate: {
      customerOrderLineId: string;
      productId: string;
      itemId: string;
      lotId: string | null;
      quantity: Prisma.Decimal;
    }[] = [];
    const productionOrdersToCreate: {
      customerOrderLineId: string;
      productId: string;
      outputUnitCode: string;
      plannedQuantity: Prisma.Decimal;
      code: string;
    }[] = [];

    for (const orderLine of order.lines) {
      const payloadLine = payloadByLineId.get(orderLine.id)!;
      const reserveQuantity = new Prisma.Decimal(payloadLine.reserveQuantity);
      const produceQuantity = new Prisma.Decimal(payloadLine.produceQuantity);
      const item = itemsById.get(orderLine.finishedItemId!)!;

      if (reserveQuantity.greaterThan(0)) {
        // Recalcula FEFO/FIFO AGORA, sob lock — nunca reaproveita a
        // sugestao antiga exibida na UI antes de aplicar.
        const suggestion = await getAllocationSuggestion(tx, item.id, reserveQuantity.toString());
        if (new Prisma.Decimal(suggestion.shortageQuantity).greaterThan(0)) {
          throw new ExcessiveReserveError(orderLine.productCode ?? orderLine.productId, suggestion.availableQuantity);
        }

        if (item.controlsLot) {
          for (const allocation of suggestion.allocations) {
            reservationLinesToCreate.push({
              customerOrderLineId: orderLine.id,
              productId: orderLine.productId,
              itemId: item.id,
              lotId: allocation.lotId,
              quantity: new Prisma.Decimal(allocation.suggestedQuantity),
            });
          }
        } else {
          reservationLinesToCreate.push({
            customerOrderLineId: orderLine.id,
            productId: orderLine.productId,
            itemId: item.id,
            lotId: null,
            quantity: reserveQuantity,
          });
        }
      }

      if (produceQuantity.greaterThan(0)) {
        // Revalida o Product no momento da aplicacao — se foi inativado
        // depois da confirmacao do Pedido, bloqueia (secao 46 do handoff).
        const product = await tx.product.findUnique({
          where: { id: orderLine.productId },
          include: { finishedProductItem: true },
        });
        if (
          !product ||
          !product.active ||
          !product.finishedProductItem ||
          !product.finishedProductItem.active ||
          product.finishedProductItem.type !== "FINISHED_PRODUCT"
        ) {
          throw new ProductNoLongerValidForProductionError(orderLine.productCode ?? orderLine.productId);
        }

        productionOrdersToCreate.push({
          customerOrderLineId: orderLine.id,
          productId: product.id,
          outputUnitCode: product.finishedProductItem.unitCode,
          plannedQuantity: produceQuantity,
          code: productionOrderCodes.get(orderLine.id)!,
        });
      }
    }

    if (reservationLinesToCreate.length > 0) {
      const reservation = await tx.customerOrderReservation.create({
        data: { customerOrderId, status: "ACTIVE", createdBy: SYSTEM_ACTOR },
      });
      await tx.customerOrderReservationLine.createMany({
        data: reservationLinesToCreate.map((line) => ({
          reservationId: reservation.id,
          customerOrderLineId: line.customerOrderLineId,
          productId: line.productId,
          itemId: line.itemId,
          lotId: line.lotId,
          quantity: line.quantity,
        })),
      });
    }

    for (const toCreate of productionOrdersToCreate) {
      // OP nasce DRAFT — nunca PLAN/RELEASE automatico. Formulacao ACTIVE
      // atual e usada como selecao inicial quando existir; sem ela a OP
      // ainda nasce (secao 22 do handoff), so fica sem Requirements ate o
      // usuario resolver a formulacao manualmente.
      const activeVersion = await tx.formulationVersion.findFirst({
        where: { productId: toCreate.productId, status: "ACTIVE" },
      });
      await createDraftProductionOrderInTx(tx, {
        code: toCreate.code,
        productId: toCreate.productId,
        outputUnitCode: toCreate.outputUnitCode,
        formulationVersionId: activeVersion?.id ?? null,
        plannedQuantity: toCreate.plannedQuantity,
        customerOrderId,
        customerOrderLineId: toCreate.customerOrderLineId,
        ...(actor ? { createdBy: actor.name } : {}),
      });
    }

    await tx.customerOrder.update({
      where: { id: customerOrderId },
      data: { status: "IN_FULFILLMENT" },
    });
  });

  return (await getCustomerOrderById(customerOrderId))!;
}


/**
 * OP PARA O SALDO RESTANTE de uma linha do Pedido.
 *
 * Produção real abaixo do planejado é normal, e o VAL-LEG-01 terminou
 * exatamente assim: 98 de 100. O Pedido representava a pendência
 * corretamente em toda parte — falta expedir 2, falta reservar 2, status
 * parcial — e mesmo assim não havia como continuar. O Plano de
 * Atendimento só existe enquanto o Pedido está CONFIRMED e cobre a
 * quantidade pedida inteira; ele não serve para um saldo.
 *
 * Esta função é o caminho estreito que faltava: uma OP, uma linha, o
 * saldo que ainda precisa ser PRODUZIDO — não o que falta expedir. Um
 * saldo já coberto por estoque reservado ou por OP aberta não é
 * pendência de produção, e pedir OP para ele produziria o dobro.
 *
 * Nunca automática: expedir parcialmente não gera ordem nenhuma sozinho.
 * Quem decide continuar é o operador.
 */
export async function createRemainderProductionOrder(
  customerOrderId: string,
  input: CreateRemainderOrderInput,
  actor?: { id: string; name: string },
): Promise<CustomerOrderDTO> {
  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, PRODUCTION_ORDER_CODE_SEQUENCE, PRODUCTION_ORDER_CODE_PREFIX);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${customerOrderId} FOR UPDATE`;

    const order = await tx.customerOrder.findUnique({
      where: { id: customerOrderId },
      include: {
        lines: true,
        reservations: { include: { lines: true } },
        productionOrders: { include: { outputs: { select: { quantity: true } } } },
        shipments: { include: { lines: true } },
      },
    });
    if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
    if (order.status !== "IN_FULFILLMENT" && order.status !== "PARTIALLY_SHIPPED") {
      throw new CustomerOrderNotConfirmedError(
        "Só um pedido em atendimento tem saldo restante — antes disso o caminho é o Plano de Atendimento.",
      );
    }

    const orderLine = order.lines.find((line) => line.id === input.customerOrderLineId);
    if (!orderLine) throw new UnknownPlanLineError(input.customerOrderLineId);

    /*
     * Mesmo cálculo que o Pedido publica em `pendingProductionQuantity`,
     * refeito aqui sob lock: o que a tela leu pode ter envelhecido entre
     * o carregamento e o clique.
     */
    const expedido = order.shipments
      .filter((shipment) => shipment.status === "CONFIRMED")
      .flatMap((shipment) => shipment.lines)
      .filter((line) => line.customerOrderLineId === orderLine.id)
      .reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));

    const enviadoPorLinhaDeReserva = new Map<string, Prisma.Decimal>();
    for (const shipment of order.shipments) {
      if (shipment.status !== "CONFIRMED") continue;
      for (const line of shipment.lines) {
        if (!line.customerOrderReservationLineId) continue;
        const atual = enviadoPorLinhaDeReserva.get(line.customerOrderReservationLineId) ?? new Prisma.Decimal(0);
        enviadoPorLinhaDeReserva.set(line.customerOrderReservationLineId, atual.plus(line.quantity));
      }
    }

    const reservadoRestante = order.reservations
      .filter((reservation) => reservation.status === "ACTIVE")
      .flatMap((reservation) => reservation.lines)
      .filter((line) => line.customerOrderLineId === orderLine.id)
      .reduce((sum, line) => {
        const enviado = enviadoPorLinhaDeReserva.get(line.id) ?? new Prisma.Decimal(0);
        return sum.plus(Prisma.Decimal.max(line.quantity.minus(enviado), 0));
      }, new Prisma.Decimal(0));

    const ordensDaLinha = order.productionOrders.filter(
      (po) => po.customerOrderLineId === orderLine.id && po.status !== "CANCELLED",
    );
    const produzidoNoTotal = ordensDaLinha.reduce(
      (sum, po) => sum.plus(po.outputs.reduce((t, o) => t.plus(o.quantity), new Prisma.Decimal(0))),
      new Prisma.Decimal(0),
    );
    // `planejado - produzido` de uma ordem CONCLUÍDA é variação de
    // produção, não promessa: ela não vai produzir mais nada.
    const aindaVaiProduzir = ordensDaLinha
      .filter((po) => po.status !== "COMPLETED")
      .reduce((sum, po) => {
        const produzido = po.outputs.reduce((t, o) => t.plus(o.quantity), new Prisma.Decimal(0));
        return sum.plus(Prisma.Decimal.max(po.plannedQuantity.minus(produzido), 0));
      }, new Prisma.Decimal(0));
    // O intervalo entre concluir a produção e reservar o lote.
    const produzidoEmEspera = Prisma.Decimal.max(
      produzidoNoTotal.minus(expedido).minus(reservadoRestante),
      0,
    );

    const pendente = Prisma.Decimal.max(
      orderLine.orderedQuantity
        .minus(expedido)
        .minus(reservadoRestante)
        .minus(aindaVaiProduzir)
        .minus(produzidoEmEspera),
      0,
    );
    if (pendente.lessThanOrEqualTo(0)) {
      throw new NoPendingProductionError(orderLine.productCode ?? orderLine.productId);
    }

    const quantidade = input.quantity ? new Prisma.Decimal(input.quantity) : pendente;
    if (quantidade.lessThanOrEqualTo(0)) throw new NoPendingProductionError(orderLine.productCode ?? orderLine.productId);
    if (quantidade.greaterThan(pendente)) throw new RemainderExceedsPendingError(pendente.toString());

    // Mesma revalidação da aplicação do plano: produto inativado depois
    // da confirmação não volta a produzir por uma porta lateral.
    const product = await tx.product.findUnique({
      where: { id: orderLine.productId },
      include: { finishedProductItem: true },
    });
    if (
      !product ||
      !product.active ||
      !product.finishedProductItem ||
      !product.finishedProductItem.active ||
      product.finishedProductItem.type !== "FINISHED_PRODUCT"
    ) {
      throw new ProductNoLongerValidForProductionError(orderLine.productCode ?? orderLine.productId);
    }

    const activeVersion = await tx.formulationVersion.findFirst({
      where: { productId: orderLine.productId, status: "ACTIVE" },
    });

    await createDraftProductionOrderInTx(tx, {
      code,
      productId: product.id,
      outputUnitCode: product.finishedProductItem.unitCode,
      formulationVersionId: activeVersion?.id ?? null,
      plannedQuantity: quantidade,
      customerOrderId,
      // A proveniência é a mesma da primeira OP: quem auditar vê as duas
      // ordens penduradas na mesma linha do mesmo Pedido.
      customerOrderLineId: orderLine.id,
      ...(actor ? { createdBy: actor.name } : {}),
    });
  });

  return (await getCustomerOrderById(customerOrderId))!;
}
