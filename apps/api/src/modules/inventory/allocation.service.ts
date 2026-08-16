import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { AllocationSuggestionDTO, AllocationStrategy, LotAllocationDTO } from "@veridi/shared";
import {
  getOnHand,
  getOnHandByLots,
  getReservedByItems,
  getReservedByLots,
  isLotAvailableForUse,
  lotOwnerWhere,
} from "../../lib/inventory-ledger.js";
import type { InventoryOwnerScope } from "../../lib/inventory-ledger.js";
import { ItemNotFoundError } from "./inventory.errors.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * `receivedAt` real do lote vem do Receipt (via ReceiptLine), nao de
 * `Lot.createdAt` — a data de negocio pode ser retroativa em relacao ao
 * momento em que a linha foi gravada. Fallback para `createdAt` cobre o
 * caso defensivo de um lote sem ReceiptLine.
 */
const lotWithReceivedAtInclude = {
  receiptLine: { include: { receipt: true } },
} as const;

type LotWithReceivedAt = Prisma.LotGetPayload<{ include: typeof lotWithReceivedAtInclude }>;

function receivedAtOf(lot: LotWithReceivedAt): Date {
  return lot.receiptLine?.receipt.receivedAt ?? lot.createdAt;
}

/**
 * Sugestao de alocacao de lotes — FEFO (validade) para itens com
 * `controlsExpiry`, FIFO (recebimento mais antigo) como fallback para
 * itens com `controlsLot` sem validade, `NO_LOT` quando o item nao
 * controla lote. Nunca reserva/baixa estoque/cria InventoryMovement —
 * puro calculo sob demanda, sempre a partir das mesmas regras de
 * disponibilidade do ledger (nunca uma segunda interpretacao de
 * On Hand/Available/elegibilidade de lote). Disponibilidade considera
 * Reserved real (`Available = On Hand - Reserved`) — a mesma alocacao
 * usada para exibicao na UI (fora de transacao) e para o RELEASE de OP
 * (dentro de transacao, recebendo o `tx` como `prisma`).
 */
export async function getAllocationSuggestion(
  prisma: PrismaOrTx,
  itemId: string,
  requiredQuantity: string,
  /**
   * Escopo de propriedade. Omitido = comportamento historico (todo o
   * estoque). Informado = so lotes daquele dono sao elegiveis; dono e mais
   * um criterio de elegibilidade, ao lado de Qualidade e validade — nunca
   * substitui FEFO/FIFO.
   */
  ownerScope?: InventoryOwnerScope,
): Promise<AllocationSuggestionDTO> {
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) throw new ItemNotFoundError(itemId);

  const required = new Prisma.Decimal(requiredQuantity);

  if (!item.controlsLot) {
    // Material de cliente exige controle de lote: sem lote nao ha saldo de
    // terceiro identificavel, entao o disponivel do escopo e zero.
    if (ownerScope?.ownerType === "CUSTOMER") {
      return {
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        unitCode: item.unitCode,
        strategy: "NO_LOT",
        requiredQuantity: required.toString(),
        availableQuantity: "0",
        allocatedQuantity: "0",
        shortageQuantity: required.toString(),
        allocations: [],
      };
    }
    const onHand = await getOnHand(prisma, { itemId: item.id });
    const reserved = (await getReservedByItems(prisma, [item.id])).get(item.id) ?? new Prisma.Decimal(0);
    const available = Prisma.Decimal.max(onHand.minus(reserved), 0);
    const allocated = Prisma.Decimal.min(required, available);
    const shortage = Prisma.Decimal.max(required.minus(allocated), 0);

    return {
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      unitCode: item.unitCode,
      strategy: "NO_LOT",
      requiredQuantity: required.toString(),
      availableQuantity: available.toString(),
      allocatedQuantity: allocated.toString(),
      shortageQuantity: shortage.toString(),
      allocations: [],
    };
  }

  const strategy: AllocationStrategy = item.controlsExpiry ? "FEFO" : "FIFO";

  const lots = await prisma.lot.findMany({
    where: { itemId: item.id, ...(ownerScope ? lotOwnerWhere(ownerScope) : {}) },
    include: lotWithReceivedAtInclude,
  });
  const lotIds = lots.map((lot) => lot.id);
  const [onHandByLot, reservedByLot] = await Promise.all([
    getOnHandByLots(prisma, lotIds),
    getReservedByLots(prisma, lotIds),
  ]);

  const eligible = lots
    .map((lot) => {
      const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
      const reserved = reservedByLot.get(lot.id) ?? new Prisma.Decimal(0);
      const available = Prisma.Decimal.max(onHand.minus(reserved), 0);
      return { lot, onHand, reserved, available };
    })
    .filter(({ lot, available }) => isLotAvailableForUse(lot) && available.greaterThan(0));

  // Determinismo: mesma comparacao para FEFO (validade) e FIFO
  // (recebimento) — desempate sempre por recebimento mais antigo e depois
  // por codigo do lote, nunca aleatorio entre requisicoes.
  eligible.sort((a, b) => {
    if (strategy === "FEFO") {
      const expiryA = a.lot.expiryDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const expiryB = b.lot.expiryDate?.getTime() ?? Number.POSITIVE_INFINITY;
      if (expiryA !== expiryB) return expiryA - expiryB;
    }
    const receivedA = receivedAtOf(a.lot).getTime();
    const receivedB = receivedAtOf(b.lot).getTime();
    if (receivedA !== receivedB) return receivedA - receivedB;
    return a.lot.code.localeCompare(b.lot.code);
  });

  const availableQuantity = eligible.reduce((sum, entry) => sum.plus(entry.available), new Prisma.Decimal(0));

  let remaining = required;
  const allocations: LotAllocationDTO[] = [];
  for (const entry of eligible) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const suggested = Prisma.Decimal.min(remaining, entry.available);
    if (suggested.lessThanOrEqualTo(0)) continue;

    allocations.push({
      lotId: entry.lot.id,
      lotCode: entry.lot.code,
      supplierLot: entry.lot.supplierLot,
      expiryDate: entry.lot.expiryDate ? entry.lot.expiryDate.toISOString() : null,
      location: entry.lot.location,
      availableQuantity: entry.available.toString(),
      suggestedQuantity: suggested.toString(),
    });
    remaining = remaining.minus(suggested);
  }

  const allocatedQuantity = required.minus(remaining);
  const shortageQuantity = Prisma.Decimal.max(remaining, 0);

  return {
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    unitCode: item.unitCode,
    strategy,
    requiredQuantity: required.toString(),
    availableQuantity: availableQuantity.toString(),
    allocatedQuantity: allocatedQuantity.toString(),
    shortageQuantity: shortageQuantity.toString(),
    allocations,
  };
}
