import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  getAvailableByItems,
  getOnHandByItems,
  getOnOrderByItems,
  getReservedByItems,
} from "./inventory-ledger.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export interface RequirementScope {
  requirementId: string;
  itemId: string;
  controlsLot: boolean;
  requiredQuantity: Prisma.Decimal;
  /** Linhas de reserva AINDA ATIVAS desta OP para este requirement. */
  activeReservationLines: { id: string; quantity: Prisma.Decimal }[];
}

export interface RequirementAvailability {
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  /** Disponível PARA ESTA OP — inclui de volta a reserva própria remanescente. */
  available: Prisma.Decimal;
  onOrder: Prisma.Decimal;
  shortage: Prisma.Decimal;
  /** Reserva própria líquida do que já foi consumido. */
  remainingReserved: Prisma.Decimal;
}

/**
 * Disponibilidade e falta de material de Requirements de Ordem de Produção —
 * **cálculo único**, usado tanto pelo documento da OP quanto pelos
 * relatórios. Nunca existe uma segunda interpretação de shortage.
 *
 * Regra central: a própria OP nunca compete contra si mesma. O disponível
 * soma de volta o que ela já tem reservado (líquido de consumo), senão o
 * próprio compromisso viraria falta falsa. `On Order` é informativo e nunca
 * reduz a falta.
 *
 * Resolve estoque uma única vez para todos os itens envolvidos — sem N+1
 * por linha.
 */
export async function computeRequirementAvailability(
  prisma: PrismaOrTx,
  requirements: RequirementScope[],
  consumedByReservationLine: Map<string, Prisma.Decimal>,
): Promise<Map<string, RequirementAvailability>> {
  const result = new Map<string, RequirementAvailability>();
  if (requirements.length === 0) return result;

  const itemScopes = [
    ...new Map(
      requirements.map((requirement) => [
        requirement.itemId,
        { id: requirement.itemId, controlsLot: requirement.controlsLot },
      ]),
    ).values(),
  ];
  const itemIds = itemScopes.map((scope) => scope.id);

  const [onHandByItem, availableByItem, onOrderByItem, reservedByItem] = await Promise.all([
    getOnHandByItems(prisma, itemIds),
    getAvailableByItems(prisma, itemScopes),
    getOnOrderByItems(prisma, itemIds),
    getReservedByItems(prisma, itemIds),
  ]);

  for (const requirement of requirements) {
    const allocated = requirement.activeReservationLines.reduce(
      (sum, line) => sum.plus(line.quantity),
      new Prisma.Decimal(0),
    );
    const consumed = requirement.activeReservationLines.reduce(
      (sum, line) => sum.plus(consumedByReservationLine.get(line.id) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    const remainingReserved = Prisma.Decimal.max(allocated.minus(consumed), 0);

    const available = (availableByItem.get(requirement.itemId) ?? new Prisma.Decimal(0)).plus(
      remainingReserved,
    );

    result.set(requirement.requirementId, {
      onHand: onHandByItem.get(requirement.itemId) ?? new Prisma.Decimal(0),
      reserved: reservedByItem.get(requirement.itemId) ?? new Prisma.Decimal(0),
      available,
      onOrder: onOrderByItem.get(requirement.itemId) ?? new Prisma.Decimal(0),
      shortage: Prisma.Decimal.max(requirement.requiredQuantity.minus(available), 0),
      remainingReserved,
    });
  }

  return result;
}
