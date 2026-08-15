import type { Item, UnitOfMeasure } from "@prisma/client";
import type { ItemDTO, ItemListResponse } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextItemCode } from "./item-codes.js";
import { ItemNotFoundError, UnitNotFoundError } from "./items.errors.js";
import type {
  CreateItemInput,
  ListItemsQuery,
  UpdateItemInput,
} from "./items.schemas.js";

type ItemWithUnit = Item & { unit: UnitOfMeasure };

function toItemDTO(item: ItemWithUnit): ItemDTO {
  return {
    id: item.id,
    code: item.code,
    type: item.type,
    name: item.name,
    unitCode: item.unitCode,
    unit: {
      code: item.unit.code,
      label: item.unit.label,
      dimension: item.unit.dimension,
    },
    controlsLot: item.controlsLot,
    controlsExpiry: item.controlsExpiry,
    requiresQualityRelease: item.requiresQualityRelease,
    externalBarcode: item.externalBarcode,
    active: item.active,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function assertUnitExists(unitCode: string): Promise<void> {
  const unit = await getPrisma().unitOfMeasure.findUnique({
    where: { code: unitCode },
  });
  if (!unit) throw new UnitNotFoundError(unitCode);
}

async function requireItem(id: string): Promise<Item> {
  const item = await getPrisma().item.findUnique({ where: { id } });
  if (!item) throw new ItemNotFoundError(id);
  return item;
}

export async function listItems(
  query: ListItemsQuery,
): Promise<ItemListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.type) where["type"] = query.type;
  if (query.active !== undefined) where["active"] = query.active;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      { externalBarcode: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      include: { unit: true },
      orderBy: { code: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.item.count({ where }),
  ]);

  return {
    items: items.map(toItemDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getItemById(id: string): Promise<ItemDTO | null> {
  const item = await getPrisma().item.findUnique({
    where: { id },
    include: { unit: true },
  });
  return item ? toItemDTO(item) : null;
}

export async function createItem(input: CreateItemInput): Promise<ItemDTO> {
  await assertUnitExists(input.unitCode);

  const defaults = ITEM_TYPE_DEFAULTS[input.type];
  const prisma = getPrisma();
  const code = await nextItemCode(prisma, input.type);

  const item = await prisma.item.create({
    data: {
      type: input.type,
      code,
      name: input.name,
      unitCode: input.unitCode,
      controlsLot: input.controlsLot ?? defaults.controlsLot,
      controlsExpiry: input.controlsExpiry ?? defaults.controlsExpiry,
      requiresQualityRelease:
        input.requiresQualityRelease ?? defaults.requiresQualityRelease,
      externalBarcode: input.externalBarcode ? input.externalBarcode : null,
    },
    include: { unit: true },
  });

  return toItemDTO(item);
}

export async function updateItem(
  id: string,
  input: UpdateItemInput,
): Promise<ItemDTO> {
  await requireItem(id);
  if (input.unitCode) await assertUnitExists(input.unitCode);

  const item = await getPrisma().item.update({
    where: { id },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.unitCode !== undefined ? { unitCode: input.unitCode } : {}),
      ...(input.controlsLot !== undefined
        ? { controlsLot: input.controlsLot }
        : {}),
      ...(input.controlsExpiry !== undefined
        ? { controlsExpiry: input.controlsExpiry }
        : {}),
      ...(input.requiresQualityRelease !== undefined
        ? { requiresQualityRelease: input.requiresQualityRelease }
        : {}),
      ...(input.externalBarcode !== undefined
        ? { externalBarcode: input.externalBarcode ? input.externalBarcode : null }
        : {}),
    },
    include: { unit: true },
  });

  return toItemDTO(item);
}

export async function activateItem(id: string): Promise<ItemDTO> {
  await requireItem(id);
  const item = await getPrisma().item.update({
    where: { id },
    data: { active: true },
    include: { unit: true },
  });
  return toItemDTO(item);
}

export async function deactivateItem(id: string): Promise<ItemDTO> {
  await requireItem(id);
  const item = await getPrisma().item.update({
    where: { id },
    data: { active: false },
    include: { unit: true },
  });
  return toItemDTO(item);
}
