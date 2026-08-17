import { Prisma } from "@prisma/client";
import type { ProductionOrderDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextLotCode } from "../../lib/lot-code.js";
import { isLotExpired } from "../../lib/inventory-ledger.js";
import { suggestedExpiryDate } from "../../lib/date-months.js";
import { InvalidTransitionError, MissingFinishedItemError, ProductionOrderNotFoundError } from "./production-orders.errors.js";
import { createProductionOrderCostSnapshot } from "../industrial-cost-calculation/production-cost.service.js";
import { getProductionOrderById } from "./production-orders.service.js";
import {
  ExpiryBeforeProducedAtError,
  FinishedLotNotEligibleError,
  FinishedLotNotFoundError,
  FinishedLotWrongItemError,
  FinishedLotWrongOrderError,
  LotControlRequiredError,
  MissingBusinessLotNumberError,
  MissingCompletionReasonError,
  MissingFinishedExpiryDateError,
  NoProductionOutputsError,
  OutputExceedsPlannedError,
} from "./production.errors.js";
import type { CompleteProductionOrderSchema, RegisterProductionOutputSchema } from "./production.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

const PRODUCTION_COMPLETED_RELEASE_REASON = "PRODUCTION_COMPLETED";

/**
 * Registra um apontamento de producao (produção parcial ou total). Uma
 * unica transacao: trava a OP, valida IN_PRODUCTION, calcula o total ja
 * produzido a partir dos ProductionOutput existentes, valida o novo total
 * contra plannedQuantity (nunca ultrapassa), resolve o lote de destino
 * (novo ou existente da mesma OP) e cria exatamente 1 ProductionOutput +
 * 1 InventoryMovement FINISHED_GOOD_PRODUCTION. Rollback completo em
 * qualquer falha.
 */
export async function registerProductionOutput(
  productionOrderId: string,
  input: RegisterProductionOutputSchema,
  actor?: { id: string; name: string },
): Promise<ProductionOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    // Trava a OP inteira — serializa apontamentos concorrentes (dois
    // outputs simultaneos nunca ultrapassam plannedQuantity juntos).
    await tx.$queryRaw`SELECT id FROM production_orders WHERE id = ${productionOrderId} FOR UPDATE`;

    const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
    if (!order) throw new ProductionOrderNotFoundError(productionOrderId);
    if (order.status !== "IN_PRODUCTION") {
      throw new InvalidTransitionError(
        "Apontamento de produção só é permitido com a Ordem em Produção.",
      );
    }
    if (!order.finishedItemId) throw new MissingFinishedItemError();

    const finishedItem = await tx.item.findUnique({ where: { id: order.finishedItemId } });
    if (!finishedItem) throw new MissingFinishedItemError();
    if (!finishedItem.controlsLot) throw new LotControlRequiredError(finishedItem.code);

    const quantity = new Prisma.Decimal(input.quantity);
    const producedSoFar =
      (await tx.productionOutput.aggregate({
        where: { productionOrderId },
        _sum: { quantity: true },
      }))._sum.quantity ?? new Prisma.Decimal(0);

    const remaining = Prisma.Decimal.max(order.plannedQuantity.minus(producedSoFar), 0);
    if (quantity.greaterThan(remaining)) {
      throw new OutputExceedsPlannedError(remaining.toString());
    }

    const producedAt = input.producedAt ?? new Date();

    let lotId: string;
    if (input.destination === "NEW_LOT") {
      const businessLotNumber = input.businessLotNumber?.trim();
      if (!businessLotNumber) throw new MissingBusinessLotNumberError();

      let expiryDate: Date | null = null;
      if (finishedItem.controlsExpiry) {
        // Validade informada SEMPRE prevalece. Sem ela, a vida útil do
        // produto gera uma sugestão — o sistema nunca inventa validade
        // quando o produto não tem vida útil cadastrada.
        const product = await tx.product.findUnique({ where: { id: order.productId } });
        expiryDate =
          input.expiryDate ?? suggestedExpiryDate(producedAt, product?.shelfLifeMonths ?? null);
        if (!expiryDate) throw new MissingFinishedExpiryDateError();
        if (expiryDate.getTime() < producedAt.getTime()) throw new ExpiryBeforeProducedAtError();
      }

      const location = input.location?.trim() || null;
      const lotCode = await nextLotCode(tx, producedAt);
      const lot = await tx.lot.create({
        data: {
          code: lotCode,
          origin: "PRODUCTION",
          itemId: finishedItem.id,
          productionOrderId: order.id,
          businessLotNumber,
          expiryDate,
          initialReceivedQuantity: quantity,
          requiresCoaSnapshot: finishedItem.requiresCoa,
          coaStatus: finishedItem.requiresCoa ? "PENDING" : "NOT_REQUIRED",
          status:
            finishedItem.requiresQualityRelease || finishedItem.requiresCoa
              ? "AWAITING_RELEASE"
              : "AVAILABLE",
          location,
          createdBy: actor?.name ?? SYSTEM_ACTOR,
        },
      });
      lotId = lot.id;
    } else {
      const requestedLotId = input.lotId!;
      // Trava o lote de destino — protege contra dois outputs concorrentes
      // apontando pro mesmo lote existente.
      await tx.$queryRaw`SELECT id FROM lots WHERE id = ${requestedLotId} FOR UPDATE`;

      const lot = await tx.lot.findUnique({ where: { id: requestedLotId } });
      if (!lot) throw new FinishedLotNotFoundError(requestedLotId);
      if (lot.productionOrderId !== order.id) throw new FinishedLotWrongOrderError(lot.code);
      if (lot.itemId !== finishedItem.id) throw new FinishedLotWrongItemError(lot.code);
      if (lot.status === "BLOCKED") throw new FinishedLotNotEligibleError(lot.code);
      if (isLotExpired(lot)) throw new FinishedLotNotEligibleError(lot.code);
      if (finishedItem.requiresQualityRelease && lot.status === "AVAILABLE") {
        throw new FinishedLotNotEligibleError(lot.code);
      }
      lotId = lot.id;
    }

    const output = await tx.productionOutput.create({
      data: {
        productionOrderId: order.id,
        lotId,
        quantity,
        producedAt,
        producedBy: actor?.name ?? SYSTEM_ACTOR,
        notes: input.notes?.trim() || null,
      },
    });

    await tx.inventoryMovement.create({
      data: {
        itemId: finishedItem.id,
        lotId,
        type: "FINISHED_GOOD_PRODUCTION",
        quantity,
        occurredAt: producedAt,
        sourceType: "FINISHED_GOOD_PRODUCTION",
        sourceId: order.id,
        productionOutputId: output.id,
        createdBy: actor?.name ?? SYSTEM_ACTOR,
      },
    });
  });

  return (await getProductionOrderById(productionOrderId))!;
}

/**
 * Conclui a OP (IN_PRODUCTION -> COMPLETED). Exige ao menos um
 * ProductionOutput. Nao exige producedQuantity == plannedQuantity
 * (conclusao parcial permitida) — quando ha variacao, exige
 * completionReason. Libera qualquer reserva ACTIVE ainda nao consumida
 * (On Hand nunca muda, Available aumenta) — nunca cria InventoryMovement
 * para a liberacao, nunca apaga a Reservation/Lines.
 */
export async function completeProductionOrder(
  productionOrderId: string,
  input: CompleteProductionOrderSchema,
  actor?: { id: string; name: string },
): Promise<ProductionOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM production_orders WHERE id = ${productionOrderId} FOR UPDATE`;

    const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
    if (!order) throw new ProductionOrderNotFoundError(productionOrderId);
    if (order.status !== "IN_PRODUCTION") {
      throw new InvalidTransitionError("Somente ordens em produção podem ser concluídas.");
    }

    const producedQuantity =
      (await tx.productionOutput.aggregate({
        where: { productionOrderId },
        _sum: { quantity: true },
      }))._sum.quantity ?? new Prisma.Decimal(0);

    if (producedQuantity.lessThanOrEqualTo(0)) throw new NoProductionOutputsError();

    const variance = Prisma.Decimal.max(order.plannedQuantity.minus(producedQuantity), 0);
    const completionReason = input.completionReason?.trim() || null;
    if (variance.greaterThan(0) && !completionReason) {
      throw new MissingCompletionReasonError();
    }

    // Libera a reserva ainda ativa na MESMA transacao — nunca deleta,
    // nunca mexe em On Hand (fisicamente nada muda, so deixa de estar
    // reservado).
    await tx.materialReservation.updateMany({
      where: { productionOrderId, status: "ACTIVE" },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
        releasedBy: actor?.name ?? SYSTEM_ACTOR,
        releaseReason: PRODUCTION_COMPLETED_RELEASE_REASON,
      },
    });

    await tx.productionOrder.update({
      where: { id: productionOrderId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedBy: actor?.name ?? SYSTEM_ACTOR,
        completionReason: variance.greaterThan(0) ? completionReason : null,
      },
    });

    // Congela o custo industrial desta producao na MESMA transacao:
    // informar custo de recebimento ou reajustar tarifa depois nunca
    // reescreve o que esta OP custou.
    await createProductionOrderCostSnapshot(tx, productionOrderId);
  });

  return (await getProductionOrderById(productionOrderId))!;
}
