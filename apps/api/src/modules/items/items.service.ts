import type { Item, UnitOfMeasure } from "@prisma/client";
import type { ItemDTO, ItemListResponse } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextItemCode } from "./item-codes.js";
import {
  ItemNotFoundError,
  PackagingSubtypeNotApplicableError,
  StructuralFieldLockedError,
  UnitNotFoundError,
} from "./items.errors.js";
import type {
  CreateItemInput,
  ListItemsQuery,
  UpdateItemInput,
} from "./items.schemas.js";

type ItemWithUnit = Item & { unit: UnitOfMeasure };

function toItemDTO(item: ItemWithUnit, operationallyUsed: boolean): ItemDTO {
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
    requiresCoa: item.requiresCoa,
    sourceName: item.sourceName,
    declaredNutrient: item.declaredNutrient,
    family: item.family,
    // Decimal vira string: pureza nunca passa por float. `null` continua
    // `null` — pureza desconhecida jamais é apresentada como 100%.
    defaultPurityPercent: item.defaultPurityPercent ? item.defaultPurityPercent.toString() : null,
    packagingSubtype: item.packagingSubtype,
    externalBarcode: item.externalBarcode,
    active: item.active,
    operationallyUsed,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

/** Subtipo de embalagem só é aceito quando o item é PACKAGING. */
function assertPackagingSubtypeCoherent(
  type: string,
  packagingSubtype: string | null | undefined,
): void {
  if (packagingSubtype && type !== "PACKAGING") {
    throw new PackagingSubtypeNotApplicableError();
  }
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

/**
 * Um item "operacionalmente utilizado" já tem referência relevante em pelo
 * menos uma dessas tabelas — a partir daí, alterar tipo/unidade/controles
 * de lote/validade corromperia o significado de números já registrados.
 * Verificação mais simples e confiável para o modelo atual: existência
 * direta, não contagem.
 */
async function isItemOperationallyUsed(itemId: string): Promise<boolean> {
  const prisma = getPrisma();
  const [poLine, receiptLine, lot, movement] = await Promise.all([
    prisma.purchaseOrderLine.findFirst({ where: { itemId }, select: { id: true } }),
    prisma.receiptLine.findFirst({ where: { itemId }, select: { id: true } }),
    prisma.lot.findFirst({ where: { itemId }, select: { id: true } }),
    prisma.inventoryMovement.findFirst({ where: { itemId }, select: { id: true } }),
  ]);
  return poLine !== null || receiptLine !== null || lot !== null || movement !== null;
}

/** Versão em lote — evita N+1 ao listar itens. */
async function getOperationallyUsedItemIds(itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const prisma = getPrisma();
  const where = { itemId: { in: itemIds } };
  const [poLines, receiptLines, lots, movements] = await Promise.all([
    prisma.purchaseOrderLine.findMany({ where, select: { itemId: true }, distinct: ["itemId"] }),
    prisma.receiptLine.findMany({ where, select: { itemId: true }, distinct: ["itemId"] }),
    prisma.lot.findMany({ where, select: { itemId: true }, distinct: ["itemId"] }),
    prisma.inventoryMovement.findMany({ where, select: { itemId: true }, distinct: ["itemId"] }),
  ]);
  const used = new Set<string>();
  for (const row of [...poLines, ...receiptLines, ...lots, ...movements]) used.add(row.itemId);
  return used;
}

export async function listItems(
  query: ListItemsQuery,
  pagination: Pagination = query,
): Promise<ItemListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.type) where["type"] = query.type;
  if (query.family) where["family"] = query.family;
  if (query.active !== undefined) where["active"] = query.active;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      { externalBarcode: { contains: query.search, mode: "insensitive" } },
      { sourceName: { contains: query.search, mode: "insensitive" } },
      { declaredNutrient: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      include: { unit: true },
      orderBy: { code: "asc" },
      ...pageArgs(pagination),
    }),
    prisma.item.count({ where }),
  ]);

  const usedIds = await getOperationallyUsedItemIds(items.map((item) => item.id));

  return {
    items: items.map((item) => toItemDTO(item, usedIds.has(item.id))),
    ...pageMeta(pagination, total),
  };
}

export async function getItemById(id: string): Promise<ItemDTO | null> {
  const item = await getPrisma().item.findUnique({
    where: { id },
    include: { unit: true },
  });
  if (!item) return null;
  return toItemDTO(item, await isItemOperationallyUsed(id));
}

export async function createItem(input: CreateItemInput): Promise<ItemDTO> {
  await assertUnitExists(input.unitCode);
  assertPackagingSubtypeCoherent(input.type, input.packagingSubtype);

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
      // Sem default por tipo: exigir laudo é decisão explícita do cadastro,
      // nunca inferida de `requiresQualityRelease`.
      requiresCoa: input.requiresCoa ?? false,
      ...(input.sourceName !== undefined ? { sourceName: input.sourceName } : {}),
      ...(input.declaredNutrient !== undefined
        ? { declaredNutrient: input.declaredNutrient }
        : {}),
      ...(input.family !== undefined ? { family: input.family } : {}),
      ...(input.defaultPurityPercent !== undefined
        ? { defaultPurityPercent: input.defaultPurityPercent }
        : {}),
      ...(input.packagingSubtype !== undefined
        ? { packagingSubtype: input.packagingSubtype }
        : {}),
      externalBarcode: input.externalBarcode ? input.externalBarcode : null,
    },
    include: { unit: true },
  });

  // Item recem-criado nunca pode ja estar operacionalmente utilizado.
  return toItemDTO(item, false);
}

export async function updateItem(
  id: string,
  input: UpdateItemInput,
): Promise<ItemDTO> {
  const current = await requireItem(id);
  if (input.unitCode) await assertUnitExists(input.unitCode);
  assertPackagingSubtypeCoherent(input.type ?? current.type, input.packagingSubtype);

  const structuralChange =
    (input.type !== undefined && input.type !== current.type) ||
    (input.unitCode !== undefined && input.unitCode !== current.unitCode) ||
    (input.controlsLot !== undefined && input.controlsLot !== current.controlsLot) ||
    (input.controlsExpiry !== undefined && input.controlsExpiry !== current.controlsExpiry);

  if (structuralChange && (await isItemOperationallyUsed(id))) {
    if (input.type !== undefined && input.type !== current.type) {
      throw new StructuralFieldLockedError("type");
    }
    if (input.unitCode !== undefined && input.unitCode !== current.unitCode) {
      throw new StructuralFieldLockedError("unitCode");
    }
    if (input.controlsLot !== undefined && input.controlsLot !== current.controlsLot) {
      throw new StructuralFieldLockedError("controlsLot");
    }
    throw new StructuralFieldLockedError("controlsExpiry");
  }

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
      ...(input.requiresCoa !== undefined ? { requiresCoa: input.requiresCoa } : {}),
      ...(input.requiresQualityRelease !== undefined
        ? { requiresQualityRelease: input.requiresQualityRelease }
        : {}),
      ...(input.sourceName !== undefined ? { sourceName: input.sourceName } : {}),
      ...(input.declaredNutrient !== undefined
        ? { declaredNutrient: input.declaredNutrient }
        : {}),
      ...(input.family !== undefined ? { family: input.family } : {}),
      // Alterar a pureza padrão NUNCA reescreve formulação/OP histórica:
      // a capacidade 34 congela `purityPercentApplied` no componente.
      ...(input.defaultPurityPercent !== undefined
        ? { defaultPurityPercent: input.defaultPurityPercent }
        : {}),
      ...(input.packagingSubtype !== undefined
        ? { packagingSubtype: input.packagingSubtype }
        : {}),
      ...(input.externalBarcode !== undefined
        ? { externalBarcode: input.externalBarcode ? input.externalBarcode : null }
        : {}),
    },
    include: { unit: true },
  });

  // requiresQualityRelease so afeta novos lotes recebidos — nunca reescreve
  // Lot.status de lotes ja existentes (nenhum UPDATE em Lot acontece aqui).
  return toItemDTO(item, await isItemOperationallyUsed(id));
}

export async function activateItem(id: string): Promise<ItemDTO> {
  await requireItem(id);
  const item = await getPrisma().item.update({
    where: { id },
    data: { active: true },
    include: { unit: true },
  });
  return toItemDTO(item, await isItemOperationallyUsed(id));
}

export async function deactivateItem(id: string): Promise<ItemDTO> {
  await requireItem(id);
  const item = await getPrisma().item.update({
    where: { id },
    data: { active: false },
    include: { unit: true },
  });
  return toItemDTO(item, await isItemOperationallyUsed(id));
}
