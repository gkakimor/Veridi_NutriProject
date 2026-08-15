import type { ItemType, PrismaClient } from "@prisma/client";
import { ITEM_TYPE_PREFIXES } from "@veridi/shared";
import { nextSequenceCode } from "../../lib/sequence-code.js";

/** Uma sequence Postgres dedicada por tipo de item — ver `lib/sequence-code.ts`. */
const ITEM_CODE_SEQUENCE: Record<ItemType, string> = {
  RAW_MATERIAL: "item_code_raw_material_seq",
  PACKAGING: "item_code_packaging_seq",
  FINISHED_PRODUCT: "item_code_finished_product_seq",
};

export async function nextItemCode(
  prisma: PrismaClient,
  type: ItemType,
): Promise<string> {
  return nextSequenceCode(
    prisma,
    ITEM_CODE_SEQUENCE[type],
    ITEM_TYPE_PREFIXES[type],
  );
}
