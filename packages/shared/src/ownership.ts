/**
 * Propriedade de material — contratos compartilhados entre `apps/api` e
 * `apps/web`.
 *
 * Dois conceitos DIFERENTES, propositalmente separados:
 *
 * 1. `SupplyResponsibility` — quem DEVERIA fornecer o componente, conforme
 *    a formulação. É intenção/regra, congelada na versão e na necessidade
 *    da Ordem de Produção.
 * 2. `InventoryOwnerType` — de quem é o lote físico que está no estoque.
 *    É realidade física, característica histórica do lote.
 *
 * Dono é independente de Fornecedor: o cliente pode enviar material que ele
 * comprou de um fabricante qualquer — quem vendeu não é quem é dono.
 */

export type SupplyResponsibility = "VERIDI" | "CUSTOMER";

export const SUPPLY_RESPONSIBILITIES: readonly SupplyResponsibility[] = ["VERIDI", "CUSTOMER"];

export const SUPPLY_RESPONSIBILITY_LABELS: Record<SupplyResponsibility, string> = {
  VERIDI: "Veridi",
  CUSTOMER: "Cliente",
};

export type InventoryOwnerType = "VERIDI" | "CUSTOMER";

export const INVENTORY_OWNER_TYPES: readonly InventoryOwnerType[] = ["VERIDI", "CUSTOMER"];

export const INVENTORY_OWNER_TYPE_LABELS: Record<InventoryOwnerType, string> = {
  VERIDI: "Veridi",
  CUSTOMER: "Cliente",
};

/** Rótulo pronto para tela: "Veridi" ou "Cliente — Alpha Nutrition". */
export function ownerLabel(
  ownerType: InventoryOwnerType,
  ownerCustomerName: string | null,
): string {
  if (ownerType === "VERIDI") return INVENTORY_OWNER_TYPE_LABELS.VERIDI;
  return ownerCustomerName ? `Cliente — ${ownerCustomerName}` : INVENTORY_OWNER_TYPE_LABELS.CUSTOMER;
}
