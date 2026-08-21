import { Prisma } from "@prisma/client";
import type { ProductionOrderDTO } from "@veridi/shared";
import { normalizeLotLookupCode } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  getConsumedByReservationLines,
  getOnHand,
  getReservedByLots,
  isLotAvailableForUse,
} from "../../lib/inventory-ledger.js";
import { ProductionOrderNotFoundError } from "./production-orders.errors.js";
import { getProductionOrderById, requirementOwnerScope } from "./production-orders.service.js";
import {
  AlternateLotItemMismatchError,
  AlternateLotOwnerMismatchError,
  ConsumptionExceedsReservedError,
  ConsumptionLotNotEligibleError,
  EmptyConsumptionBatchError,
  ExtraReservationLotItemMismatchError,
  ExtraReservationReasonRequiredError,
  InsufficientAlternateLotError,
  InsufficientOnHandError,
  InvalidConsumptionQuantityError,
  ItemDoesNotControlLotError,
  LineAlreadyPickedError,
  LineNotActiveError,
  LotMismatchError,
  LotNoLongerEligibleError,
  LotNotFoundByCodeError,
  MissingLotCodeError,
  NoUnreservedStockError,
  PickingRequiredError,
  ProductionOrderNotReleasedError,
  ReservationLineNotFoundError,
  SameLotSubstitutionError,
  SubstitutionAfterConsumptionError,
} from "./picking.errors.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

async function lockOrderAndAssertReleasable(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM production_orders WHERE id = ${productionOrderId} FOR UPDATE
  `;
  if (rows.length === 0) throw new ProductionOrderNotFoundError(productionOrderId);
  const status = rows[0]!.status;
  if (status !== "RELEASED" && status !== "IN_PRODUCTION") {
    throw new ProductionOrderNotReleasedError();
  }
  return status;
}

/**
 * Confirma fisicamente a ReservationLine inteira (sem partial picking
 * nesta fase). Nunca cria InventoryMovement, nunca recalcula/reserva de
 * novo — so marca pickedAt/pickedBy. Revalida elegibilidade do lote
 * reservado no momento do Picking (pode ter vencido/sido bloqueado entre
 * o RELEASE e agora).
 */
export async function confirmPicking(
  productionOrderId: string,
  reservationLineId: string,
  lotCode: string | undefined,
  actor?: { id: string; name: string },
): Promise<ProductionOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    await lockOrderAndAssertReleasable(tx, productionOrderId);

    await tx.$queryRaw`SELECT id FROM material_reservation_lines WHERE id = ${reservationLineId} FOR UPDATE`;

    const line = await tx.materialReservationLine.findUnique({
      where: { id: reservationLineId },
      include: { item: true, lot: true, reservation: true },
    });
    if (!line || line.reservation.productionOrderId !== productionOrderId) {
      throw new ReservationLineNotFoundError(reservationLineId);
    }
    if (line.releasedAt !== null) throw new LineNotActiveError();
    if (line.pickedAt !== null) throw new LineAlreadyPickedError();

    if (line.item.controlsLot) {
      if (!line.lot) throw new ReservationLineNotFoundError(reservationLineId);
      if (!isLotAvailableForUse(line.lot)) {
        throw new LotNoLongerEligibleError(line.lot.code);
      }
      if (!lotCode) throw new MissingLotCodeError();

      const normalized = normalizeLotLookupCode(lotCode);
      const scannedLot = await tx.lot.findUnique({ where: { code: normalized } });
      if (!scannedLot) throw new LotNotFoundByCodeError(lotCode);
      if (scannedLot.id !== line.lotId) {
        throw new LotMismatchError(line.lot.code, scannedLot.code);
      }
    }

    await tx.materialReservationLine.update({
      where: { id: reservationLineId },
      data: { pickedAt: new Date(), pickedBy: actor?.name ?? SYSTEM_ACTOR },
    });
  });

  return (await getProductionOrderById(productionOrderId))!;
}

/**
 * Substituicao explicita de lote no Picking (mismatch) — so antes de
 * qualquer Picking/Consumo confirmado nesta linha, e so quando um UNICO
 * lote alternativo comporta a quantidade inteira reservada. Nunca
 * sobrescreve a linha original: marca-a como liberada (releasedAt) e cria
 * uma linha nova apontando de volta via replacesLineId — preserva a
 * genealogia completa. A linha nova ja nasce com Picking confirmado (o
 * proprio ato de "usar lote diferente" e a confirmacao fisica).
 */
export async function substituteReservationLine(
  productionOrderId: string,
  reservationLineId: string,
  lotCode: string,
  actor?: { id: string; name: string },
): Promise<ProductionOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    await lockOrderAndAssertReleasable(tx, productionOrderId);

    await tx.$queryRaw`SELECT id FROM material_reservation_lines WHERE id = ${reservationLineId} FOR UPDATE`;

    const line = await tx.materialReservationLine.findUnique({
      where: { id: reservationLineId },
      include: {
        item: true,
        lot: true,
        reservation: { include: { productionOrder: true } },
        productionOrderRequirement: true,
      },
    });
    if (!line || line.reservation.productionOrderId !== productionOrderId) {
      throw new ReservationLineNotFoundError(reservationLineId);
    }
    if (!line.item.controlsLot) throw new ItemDoesNotControlLotError();
    if (line.releasedAt !== null) throw new LineNotActiveError();
    if (line.pickedAt !== null) throw new LineAlreadyPickedError();

    const consumedSoFar =
      (await getConsumedByReservationLines(tx, [line.id])).get(line.id) ?? new Prisma.Decimal(0);
    if (consumedSoFar.greaterThan(0)) throw new SubstitutionAfterConsumptionError();

    // Trava o Item — mesmo padrao de concorrencia do RELEASE. Serializa
    // qualquer disputa de disponibilidade envolvendo este item, inclusive
    // outra substituicao tentando usar o mesmo lote alternativo.
    await tx.$queryRaw`SELECT id FROM items WHERE id = ${line.itemId} FOR UPDATE`;

    const normalized = normalizeLotLookupCode(lotCode);
    const newLot = await tx.lot.findUnique({ where: { code: normalized } });
    if (!newLot) throw new LotNotFoundByCodeError(lotCode);
    if (newLot.id === line.lotId) throw new SameLotSubstitutionError();
    if (newLot.itemId !== line.itemId) throw new AlternateLotItemMismatchError();

    // Proprietario e criterio de elegibilidade tanto quanto Item,
    // Qualidade e validade — mesmo Item nao basta.
    const scope = requirementOwnerScope(
      line.productionOrderRequirement.supplyResponsibility,
      line.reservation.productionOrder.customerId,
    );
    const ownerMatches =
      scope !== null &&
      (scope.ownerType === "VERIDI"
        ? newLot.ownerType === "VERIDI"
        : newLot.ownerType === "CUSTOMER" && newLot.ownerCustomerId === scope.customerId);
    if (!ownerMatches) {
      const expectedOwner =
        line.productionOrderRequirement.supplyResponsibility === "CUSTOMER"
          ? "cliente desta OP"
          : "Veridi";
      throw new AlternateLotOwnerMismatchError(newLot.code, expectedOwner);
    }

    if (!isLotAvailableForUse(newLot)) throw new LotNoLongerEligibleError(newLot.code);

    const onHand = await getOnHand(tx, { itemId: line.itemId, lotId: newLot.id });
    const reserved = (await getReservedByLots(tx, [newLot.id])).get(newLot.id) ?? new Prisma.Decimal(0);
    const available = Prisma.Decimal.max(onHand.minus(reserved), 0);
    if (available.lessThan(line.quantity)) throw new InsufficientAlternateLotError(newLot.code);

    await tx.materialReservationLine.update({
      where: { id: line.id },
      data: {
        releasedAt: new Date(),
        releasedBy: actor?.name ?? SYSTEM_ACTOR,
        releaseReason: "Substituição de lote no Picking",
      },
    });

    await tx.materialReservationLine.create({
      data: {
        reservationId: line.reservationId,
        productionOrderRequirementId: line.productionOrderRequirementId,
        itemId: line.itemId,
        lotId: newLot.id,
        quantity: line.quantity,
        replacesLineId: line.id,
        pickedAt: new Date(),
        pickedBy: actor?.name ?? SYSTEM_ACTOR,
      },
    });
  });

  return (await getProductionOrderById(productionOrderId))!;
}

/**
 * AMPLIA EXPLICITAMENTE A RESERVA DE UMA OP.
 *
 * O consumo real continua limitado ao reservado — esse limite e o que
 * impede uma OP de se servir sozinha do estoque livre e do estoque
 * alheio. O que faltava era o caminho legitimo para o desvio mais comum
 * do chao de fabrica: pesou-se um pouco mais do que a formulacao previa.
 *
 * Antes, esse evento simplesmente nao tinha como ser registrado, e as
 * unicas saidas falsificavam o registro (apontar menos do que se
 * consumiu, ou nao apontar). Agora ele tem um ato proprio: o operador
 * pede mais material, diz por que, o sistema confere o saldo REALMENTE
 * livre e cria uma linha de reserva NOVA.
 *
 * O que esta funcao deliberadamente NAO faz:
 *
 *   * nao toca a linha original — planejado, reservado e ampliacao ficam
 *     lado a lado, e ninguem precisa deduzir o que mudou;
 *   * nao movimenta estoque — ampliar reserva nao e consumir. O consumo
 *     continua sendo um segundo ato, pelo caminho de sempre;
 *   * nao usa saldo reservado por outra OP, nem lote vencido, bloqueado
 *     ou aguardando Qualidade — reusa a mesma nocao de disponibilidade do
 *     RELEASE, sem criar um conceito paralelo de "quase disponivel";
 *   * nao escolhe lote sozinho. Sem `lotCode`, amplia no proprio lote da
 *     linha; com `lotCode`, no lote que o operador confirmou.
 *
 * A linha nova ja nasce com Picking confirmado: pedir material adicional
 * de um lote identificado E a conferencia fisica dele.
 */
export async function addExtraReservation(
  productionOrderId: string,
  reservationLineId: string,
  input: { quantity: string; reason: string; lotCode?: string | undefined },
  actor?: { id: string; name: string },
): Promise<ProductionOrderDTO> {
  const reason = input.reason.trim();
  if (reason.length === 0) throw new ExtraReservationReasonRequiredError();

  const quantity = new Prisma.Decimal(input.quantity);
  if (quantity.lessThanOrEqualTo(0)) throw new InvalidConsumptionQuantityError();

  await getPrisma().$transaction(async (tx) => {
    await lockOrderAndAssertReleasable(tx, productionOrderId);

    await tx.$queryRaw`SELECT id FROM material_reservation_lines WHERE id = ${reservationLineId} FOR UPDATE`;

    const line = await tx.materialReservationLine.findUnique({
      where: { id: reservationLineId },
      include: {
        item: true,
        lot: true,
        reservation: { include: { productionOrder: true } },
        productionOrderRequirement: true,
      },
    });
    if (!line || line.reservation.productionOrderId !== productionOrderId) {
      throw new ReservationLineNotFoundError(reservationLineId);
    }
    if (line.releasedAt !== null) throw new LineNotActiveError();

    // Trava o Item — mesmo padrao de concorrencia do RELEASE e da
    // substituicao. Duas OPs disputando o mesmo saldo livre serializam
    // aqui: a segunda le o `reserved` ja atualizado pela primeira e e
    // recusada, em vez de ambas passarem no mesmo teste.
    await tx.$queryRaw`SELECT id FROM items WHERE id = ${line.itemId} FOR UPDATE`;

    let targetLotId = line.lotId;

    if (line.item.controlsLot) {
      if (input.lotCode) {
        const normalized = normalizeLotLookupCode(input.lotCode);
        const lot = await tx.lot.findUnique({ where: { code: normalized } });
        if (!lot) throw new LotNotFoundByCodeError(input.lotCode);
        if (lot.itemId !== line.itemId) throw new ExtraReservationLotItemMismatchError(lot.code);

        // Proprietario e criterio de elegibilidade tanto quanto Qualidade
        // e validade: material do cliente A nunca entra na OP do cliente B.
        const scope = requirementOwnerScope(
          line.productionOrderRequirement.supplyResponsibility,
          line.reservation.productionOrder.customerId,
        );
        const ownerMatches =
          scope !== null &&
          (scope.ownerType === "VERIDI"
            ? lot.ownerType === "VERIDI"
            : lot.ownerType === "CUSTOMER" && lot.ownerCustomerId === scope.customerId);
        if (!ownerMatches) {
          const expectedOwner =
            line.productionOrderRequirement.supplyResponsibility === "CUSTOMER"
              ? "cliente desta OP"
              : "Veridi";
          throw new AlternateLotOwnerMismatchError(lot.code, expectedOwner);
        }

        if (!isLotAvailableForUse(lot)) throw new LotNoLongerEligibleError(lot.code);
        targetLotId = lot.id;
      } else {
        if (!line.lot) throw new ReservationLineNotFoundError(line.id);
        // O lote original pode ter vencido ou sido bloqueado entre o
        // RELEASE e agora — ampliar nele seria reservar o que ninguem
        // pode usar.
        if (!isLotAvailableForUse(line.lot)) throw new LotNoLongerEligibleError(line.lot.code);
      }
    }

    const onHand = await getOnHand(tx, { itemId: line.itemId, lotId: targetLotId });
    const reserved =
      targetLotId === null
        ? new Prisma.Decimal(0)
        : (await getReservedByLots(tx, [targetLotId])).get(targetLotId) ?? new Prisma.Decimal(0);
    const available = Prisma.Decimal.max(onHand.minus(reserved), 0);
    if (quantity.greaterThan(available)) {
      const lotCode = targetLotId === null ? line.item.code : (line.lot?.code ?? input.lotCode ?? "");
      throw new NoUnreservedStockError(lotCode, available.toString());
    }

    const requestedAt = new Date();
    await tx.materialReservationLine.create({
      data: {
        reservationId: line.reservationId,
        productionOrderRequirementId: line.productionOrderRequirementId,
        itemId: line.itemId,
        lotId: targetLotId,
        quantity,
        // Pedir material adicional de um lote identificado ja e a
        // conferencia fisica dele — nao ha um segundo Picking a fazer.
        pickedAt: requestedAt,
        pickedBy: actor?.name ?? SYSTEM_ACTOR,
        extraReason: reason,
        extraRequestedBy: actor?.name ?? SYSTEM_ACTOR,
        extraRequestedAt: requestedAt,
      },
    });
  });

  return (await getProductionOrderById(productionOrderId))!;
}

/**
 * Registra consumo real — pode ser parcial, multiplas vezes, ate o limite
 * do que ainda resta reservado na linha (nunca overconsumption nesta
 * fase). Exige Picking confirmado. Cada entrada gera exatamente 1
 * ProductionConsumption + 1 InventoryMovement PRODUCTION_CONSUMPTION.
 * Lote e revalidado no momento do consumo (pode ter mudado desde o
 * Picking). Primeiro consumo real da OP: RELEASED -> IN_PRODUCTION,
 * registra startedAt/startedBy. Tudo em uma unica transacao — qualquer
 * falha reverte o lote inteiro de entradas.
 */
export async function recordConsumption(
  productionOrderId: string,
  entries: readonly { reservationLineId: string; quantity: string }[],
  actor?: { id: string; name: string },
): Promise<ProductionOrderDTO> {
  if (entries.length === 0) throw new EmptyConsumptionBatchError();

  await getPrisma().$transaction(async (tx) => {
    await recordConsumptionInTx(tx, productionOrderId, entries, actor);
  });

  return (await getProductionOrderById(productionOrderId))!;
}

/**
 * Mesmo consumo real, executado DENTRO de uma transacao ja aberta. E o
 * unico caminho de baixa de estoque de producao: a Folha de Receita
 * (capacidade 36) chama esta funcao em vez de criar um movimento paralelo.
 * Devolve os ids dos ProductionConsumption criados, na ordem das entradas.
 */
export async function recordConsumptionInTx(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
  entries: readonly { reservationLineId: string; quantity: string }[],
  actor?: { id: string; name: string },
): Promise<string[]> {
  const consumedBy = actor?.name ?? SYSTEM_ACTOR;
  const createdConsumptionIds: string[] = [];
  {
    const currentStatus = await lockOrderAndAssertReleasable(tx, productionOrderId);

    const lineIds = [...new Set(entries.map((entry) => entry.reservationLineId))].sort();
    // Trava as linhas de reserva envolvidas em ordem deterministica —
    // protege contra duas requisicoes consumindo simultaneamente o
    // restante da mesma linha.
    await tx.$queryRaw`SELECT id FROM material_reservation_lines WHERE id IN (${Prisma.join(lineIds)}) ORDER BY id FOR UPDATE`;

    const lines = await tx.materialReservationLine.findMany({
      where: { id: { in: lineIds } },
      include: { item: true, lot: true, reservation: true },
    });
    const linesById = new Map(lines.map((line) => [line.id, line]));
    for (const lineId of lineIds) {
      const line = linesById.get(lineId);
      if (!line || line.reservation.productionOrderId !== productionOrderId) {
        throw new ReservationLineNotFoundError(lineId);
      }
    }

    // Trava os Items envolvidos em ordem deterministica — mesmo padrao do
    // RELEASE, evita deadlock entre consumos concorrentes cruzados.
    const itemIds = [...new Set(lines.map((line) => line.itemId))].sort();
    await tx.$queryRaw`SELECT id FROM items WHERE id IN (${Prisma.join(itemIds)}) ORDER BY id FOR UPDATE`;

    const consumedByLine = await getConsumedByReservationLines(tx, lineIds);

    const toCreate: {
      requirementId: string;
      reservationLineId: string;
      itemId: string;
      lotId: string | null;
      quantity: Prisma.Decimal;
    }[] = [];

    for (const entry of entries) {
      const line = linesById.get(entry.reservationLineId)!;
      const quantity = new Prisma.Decimal(entry.quantity);
      if (quantity.lessThanOrEqualTo(0)) throw new InvalidConsumptionQuantityError();
      if (line.releasedAt !== null) throw new LineNotActiveError();
      if (line.pickedAt === null) throw new PickingRequiredError();

      const consumedSoFar = consumedByLine.get(line.id) ?? new Prisma.Decimal(0);
      const remaining = Prisma.Decimal.max(line.quantity.minus(consumedSoFar), 0);
      if (quantity.greaterThan(remaining)) {
        throw new ConsumptionExceedsReservedError(remaining.toString());
      }
      // Acumula localmente — cobre duas entradas do mesmo submit
      // consumindo a mesma linha em sequencia, sem dupla-conta o restante.
      consumedByLine.set(line.id, consumedSoFar.plus(quantity));

      if (line.item.controlsLot) {
        if (!line.lot) throw new ReservationLineNotFoundError(line.id);
        if (!isLotAvailableForUse(line.lot)) {
          throw new ConsumptionLotNotEligibleError(line.lot.code);
        }
      }

      const onHand = await getOnHand(tx, { itemId: line.itemId, lotId: line.lotId });
      if (quantity.greaterThan(onHand)) throw new InsufficientOnHandError(line.item.code);

      toCreate.push({
        requirementId: line.productionOrderRequirementId,
        reservationLineId: line.id,
        itemId: line.itemId,
        lotId: line.lotId,
        quantity,
      });
    }

    const consumedAt = new Date();
    for (const entry of toCreate) {
      const consumption = await tx.productionConsumption.create({
        data: {
          productionOrderId,
          productionOrderRequirementId: entry.requirementId,
          reservationLineId: entry.reservationLineId,
          itemId: entry.itemId,
          lotId: entry.lotId,
          quantity: entry.quantity,
          consumedAt,
          consumedBy,
        },
      });

      createdConsumptionIds.push(consumption.id);

      await tx.inventoryMovement.create({
        data: {
          itemId: entry.itemId,
          lotId: entry.lotId,
          type: "PRODUCTION_CONSUMPTION",
          quantity: entry.quantity,
          occurredAt: consumedAt,
          sourceType: "PRODUCTION_CONSUMPTION",
          sourceId: productionOrderId,
          productionConsumptionId: consumption.id,
          createdBy: consumedBy,
        },
      });
    }

    if (currentStatus === "RELEASED") {
      await tx.productionOrder.update({
        where: { id: productionOrderId },
        data: { status: "IN_PRODUCTION", startedAt: consumedAt, startedBy: consumedBy },
      });
    }
  }

  return createdConsumptionIds;
}
