import type { ItemType, PrismaClient } from "@prisma/client";
import { ITEM_TYPE_PREFIXES } from "@veridi/shared";

/**
 * Uma sequence Postgres dedicada por tipo. `nextval` é atômico: seguro contra
 * concorrência sem depender de `MAX(code)+1` (vulnerável a corrida) nem de
 * lock explícito na tabela de itens.
 */
const ITEM_CODE_SEQUENCE: Record<ItemType, string> = {
  RAW_MATERIAL: "item_code_raw_material_seq",
  PACKAGING: "item_code_packaging_seq",
  FINISHED_PRODUCT: "item_code_finished_product_seq",
};

export async function nextItemCode(
  prisma: PrismaClient,
  type: ItemType,
): Promise<string> {
  const sequence = ITEM_CODE_SEQUENCE[type];
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('${sequence}') AS nextval`,
  );
  const value = rows[0]?.nextval;
  if (value === undefined) {
    throw new Error("Falha ao gerar código do item");
  }

  const prefix = ITEM_TYPE_PREFIXES[type];
  return `${prefix}-${value.toString().padStart(6, "0")}`;
}
