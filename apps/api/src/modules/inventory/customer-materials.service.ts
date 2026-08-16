import { Prisma } from "@prisma/client";
import type { CustomerMaterialRowDTO, CustomerMaterialsResponse } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  getOnHandByLots,
  getReservedByLots,
  isLotAvailableForUse,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageMeta, slicePage } from "../../lib/pagination.js";
import type { ListCustomerMaterialsQuery } from "./inventory.schemas.js";

/**
 * Materiais de clientes — READ MODEL puro sobre `Lot` (dono CUSTOMER) +
 * Inventory Ledger. Nenhuma entidade nova, nenhum saldo persistido: mesma
 * matematica de On Hand/Reserved/Available do resto do sistema.
 *
 * Responde a pergunta operacional: "quanto material de cada cliente esta
 * fisicamente dentro da Veridi?".
 */
export async function listCustomerMaterials(
  query: ListCustomerMaterialsQuery,
  pagination: Pagination = query,
): Promise<CustomerMaterialsResponse> {
  const prisma = getPrisma();

  const lots = await prisma.lot.findMany({
    where: {
      // A visao e, por definicao, so de material de cliente — estoque da
      // Veridi nunca aparece aqui.
      ownerType: "CUSTOMER",
      ...(query.customerId ? { ownerCustomerId: query.customerId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: "insensitive" } },
              { supplierLot: { contains: query.search, mode: "insensitive" } },
              { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
              { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
              {
                ownerCustomer: {
                  is: { legalName: { contains: query.search, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    },
    include: { item: true, ownerCustomer: true },
    orderBy: [{ ownerCustomer: { legalName: "asc" } }, { item: { code: "asc" } }, { code: "asc" }],
  });

  const lotIds = lots.map((lot) => lot.id);
  const [onHandByLot, reservedByLot] = await Promise.all([
    getOnHandByLots(prisma, lotIds),
    getReservedByLots(prisma, lotIds),
  ]);

  const rows: CustomerMaterialRowDTO[] = [];
  for (const lot of lots) {
    const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const reserved = reservedByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const available = isLotAvailableForUse(lot)
      ? Prisma.Decimal.max(onHand.minus(reserved), 0)
      : new Prisma.Decimal(0);
    if (query.onlyWithBalance && onHand.lessThanOrEqualTo(0)) continue;

    rows.push({
      customerId: lot.ownerCustomerId!,
      customerCode: lot.ownerCustomer?.code ?? "",
      customerName: lot.ownerCustomer?.legalName ?? "",
      itemId: lot.itemId,
      itemCode: lot.item.code,
      itemName: lot.item.name,
      lotId: lot.id,
      lotCode: lot.code,
      supplierLot: lot.supplierLot,
      expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
      isExpired: isLotExpired(lot),
      location: lot.location,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      unitCode: lot.item.unitCode,
      status: lot.status,
      coaStatus: lot.coaStatus,
    });
  }

  return { rows: slicePage(rows, pagination), ...pageMeta(pagination, rows.length) };
}
