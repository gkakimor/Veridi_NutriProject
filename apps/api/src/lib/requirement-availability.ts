import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  getAvailableByItems,
  getOnHandByItems,
  getOnOrderByItems,
  getReservedByItems,
} from "./inventory-ledger.js";
import type { InventoryOwnerScope } from "./inventory-ledger.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export interface RequirementScope {
  requirementId: string;
  itemId: string;
  controlsLot: boolean;
  requiredQuantity: Prisma.Decimal;
  /**
   * Dono elegivel do estoque para esta necessidade. Omitido = todo o
   * estoque (comportamento historico). `null` = NENHUM estoque elegivel
   * (ex.: material do cliente numa OP sem cliente definido) — a falta e a
   * necessidade inteira, nunca coberta por estoque de outro dono.
   */
  ownerScope?: InventoryOwnerScope | null;
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

  // Uma resolucao por ESCOPO DE PROPRIEDADE: necessidades da Veridi e do
  // cliente enxergam estoques diferentes, entao nao podem compartilhar o
  // mesmo mapa de disponibilidade. Sem escopo continua sendo uma unica
  // resolucao, como antes.
  const noEligibleStock = requirements.filter((requirement) => requirement.ownerScope === null);
  for (const requirement of noEligibleStock) {
    const remainingReserved = remainingReservedOf(requirement, consumedByReservationLine);
    result.set(requirement.requirementId, {
      onHand: new Prisma.Decimal(0),
      reserved: new Prisma.Decimal(0),
      available: remainingReserved,
      onOrder: new Prisma.Decimal(0),
      shortage: Prisma.Decimal.max(requirement.requiredQuantity.minus(remainingReserved), 0),
      remainingReserved,
    });
  }

  const groups = new Map<string, { scope?: InventoryOwnerScope; requirements: RequirementScope[] }>();
  for (const requirement of requirements) {
    if (requirement.ownerScope === null) continue;
    const key = requirement.ownerScope
      ? requirement.ownerScope.ownerType === "VERIDI"
        ? "VERIDI"
        : `CUSTOMER:${requirement.ownerScope.customerId}`
      : "ALL";
    const group = groups.get(key) ?? {
      ...(requirement.ownerScope ? { scope: requirement.ownerScope } : {}),
      requirements: [],
    };
    group.requirements.push(requirement);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    await computeForScope(prisma, group.requirements, consumedByReservationLine, result, group.scope);
  }

  return result;
}

/** Reserva propria remanescente (alocado menos consumido), nunca negativa. */
function remainingReservedOf(
  requirement: RequirementScope,
  consumedByReservationLine: Map<string, Prisma.Decimal>,
): Prisma.Decimal {
  const allocated = requirement.activeReservationLines.reduce(
    (sum, line) => sum.plus(line.quantity),
    new Prisma.Decimal(0),
  );
  const consumed = requirement.activeReservationLines.reduce(
    (sum, line) => sum.plus(consumedByReservationLine.get(line.id) ?? new Prisma.Decimal(0)),
    new Prisma.Decimal(0),
  );
  return Prisma.Decimal.max(allocated.minus(consumed), 0);
}

async function computeForScope(
  prisma: PrismaOrTx,
  requirements: RequirementScope[],
  consumedByReservationLine: Map<string, Prisma.Decimal>,
  result: Map<string, RequirementAvailability>,
  scope: InventoryOwnerScope | undefined,
): Promise<void> {
  const itemScopes = [
    ...new Map(
      requirements.map((requirement) => [
        requirement.itemId,
        { id: requirement.itemId, controlsLot: requirement.controlsLot },
      ]),
    ).values(),
  ];
  const itemIds = itemScopes.map((itemScope) => itemScope.id);

  const [onHandByItem, availableByItem, onOrderByItem, reservedByItem] = await Promise.all([
    getOnHandByItems(prisma, itemIds, scope),
    getAvailableByItems(prisma, itemScopes, scope),
    // Ordem de Compra e compromisso da Veridi: nunca cobre necessidade de
    // material do cliente.
    scope?.ownerType === "CUSTOMER"
      ? Promise.resolve(new Map<string, Prisma.Decimal>())
      : getOnOrderByItems(prisma, itemIds),
    getReservedByItems(prisma, itemIds, scope),
  ]);

  for (const requirement of requirements) {
    const remainingReserved = remainingReservedOf(requirement, consumedByReservationLine);

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
}
