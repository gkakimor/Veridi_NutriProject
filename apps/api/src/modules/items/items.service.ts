import type { Item, UnitOfMeasure, User } from "@prisma/client";
import type { ItemDTO, ItemListResponse } from "@veridi/shared";
import { ITEM_QUALITY_CONTROL_FIELDS, ITEM_TYPE_DEFAULTS } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextItemCode } from "./item-codes.js";
import { TIPOS_DE_MATERIAL_DO_CLIENTE } from "./item-customer-supplied.js";
import { insertItemCostReference } from "./item-cost-references.service.js";
import {
  autoridadeNoItem,
  controlesAlterados,
  recusaDoConsumoNaProducao,
  recusaDoCustoInicial,
  recusaDosControles,
} from "./item-permissions.js";
import {
  InvalidItemStatusTransitionError,
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
      toBaseFactor: item.unit.toBaseFactor.toString(),
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
    consumedInProduction: item.consumedInProduction,
    externalBarcode: item.externalBarcode,
    externalCode: item.externalCode,
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
  /*
   * "Pode entrar como material do cliente" é resposta do servidor, com o mesmo
   * conjunto que o recebimento aplica ao gravar. Em `AND` para compor com
   * `type`: junto dele, restringe — nunca amplia o que foi pedido.
   */
  if (query.customerSupplied) {
    where["AND"] = [{ type: { in: [...TIPOS_DE_MATERIAL_DO_CLIENTE] } }];
  }
  if (query.family) where["family"] = query.family;
  if (query.active !== undefined) where["active"] = query.active;
  if (query.ids && query.ids.length > 0) where["id"] = { in: query.ids };
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

/**
 * Cria o Item. Quem cria já passou pelo gate da rota (`ITEM_EDIT_ROLES`); aqui
 * se julga o que o perfil pediu DENTRO do cadastro, antes de qualquer leitura:
 * referência de custo inicial, controles fora do padrão do tipo e a marca
 * "Consumido na produção" — cada um com o seu dono (`item-permissions.ts`).
 */
export async function createItem(
  input: CreateItemInput,
  actor: Pick<User, "id" | "name" | "role">,
): Promise<ItemDTO> {
  const autoridade = autoridadeNoItem(actor.role);
  const defaults = ITEM_TYPE_DEFAULTS[input.type];

  if (input.initialCostReference && !autoridade.custoDeReferencia) {
    throw recusaDoCustoInicial();
  }
  if (!autoridade.controles) {
    // Igual ao padrão do tipo passa — é o que a tela manda para quem não
    // decide os controles. Diferente, em qualquer direção, é recusa.
    const foraDoPadrao = controlesAlterados(defaults, input);
    if (foraDoPadrao.length > 0) throw recusaDosControles(foraDoPadrao, "criacao");
  }
  // A marca nasce `false` pelo default da coluna.
  if (input.consumedInProduction === true && !autoridade.consumoNaProducao) {
    throw recusaDoConsumoNaProducao();
  }

  await assertUnitExists(input.unitCode);
  assertPackagingSubtypeCoherent(input.type, input.packagingSubtype);

  const prisma = getPrisma();

  // Item e referência inicial nascem juntos ou não nascem: uma referência
  // recusada (unidade incompatível, valor negativo) não pode deixar para
  // trás um item que o usuário acha que tem custo.
  const item = await prisma.$transaction(async (tx) => {
    const code = await nextItemCode(tx, input.type);
    const created = await tx.item.create({
    data: {
      type: input.type,
      code,
      name: input.name,
      unitCode: input.unitCode,
      controlsLot: input.controlsLot ?? defaults.controlsLot,
      controlsExpiry: input.controlsExpiry ?? defaults.controlsExpiry,
      requiresQualityRelease:
        input.requiresQualityRelease ?? defaults.requiresQualityRelease,
      // `false` em todo tipo: exigir laudo é decisão explícita da Qualidade,
      // nunca inferida de `requiresQualityRelease`.
      requiresCoa: input.requiresCoa ?? defaults.requiresCoa,
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
      // Ausente é `false` pelo default da coluna: não declarar não é declarar
      // que o material entra no processo.
      ...(input.consumedInProduction !== undefined
        ? { consumedInProduction: input.consumedInProduction }
        : {}),
      externalBarcode: input.externalBarcode ? input.externalBarcode : null,
    },
    include: { unit: true },
    });
    if (input.initialCostReference) {
      await insertItemCostReference(tx, created, input.initialCostReference, actor);
    }
    return created;
  });

  // Item recem-criado nunca pode ja estar operacionalmente utilizado.
  return toItemDTO(item, false);
}

/**
 * Altera o Item. O gate da rota já recusou quem não edita Item; aqui se julga,
 * contra o GRAVADO, o que tem dono mais estreito.
 *
 * Quem não decide os controles (ou a marca de consumo) salva com os valores
 * gravados, e eles NÃO são regravados: uma alteração da Qualidade que chegue
 * entre esta leitura e a escrita não é desfeita por quem não pode alterá-la.
 */
export async function updateItem(
  id: string,
  pedido: UpdateItemInput,
  actor: Pick<User, "role">,
): Promise<ItemDTO> {
  const current = await requireItem(id);
  const autoridade = autoridadeNoItem(actor.role);

  const input: UpdateItemInput = { ...pedido };
  if (!autoridade.controles) {
    const mudados = controlesAlterados(current, pedido);
    if (mudados.length > 0) throw recusaDosControles(mudados, "edicao");
    for (const campo of ITEM_QUALITY_CONTROL_FIELDS) delete input[campo];
  }
  if (!autoridade.consumoNaProducao) {
    if (
      pedido.consumedInProduction !== undefined &&
      pedido.consumedInProduction !== current.consumedInProduction
    ) {
      throw recusaDoConsumoNaProducao();
    }
    delete input.consumedInProduction;
  }

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
      // Corrigir a classificação NUNCA é bloqueada por uso operacional: ela
      // não reescreve documento nenhum — a estimativa de custo é recalculada a
      // cada leitura, e a Ordem de Produção não aplica a perda prevista.
      ...(input.consumedInProduction !== undefined
        ? { consumedInProduction: input.consumedInProduction }
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

/**
 * Inativar e reativar: a gravação só acontece se o Item estiver na situação
 * de partida, e a condição mora no próprio UPDATE. Dois pedidos concorrentes
 * não partem da mesma situação — o segundo não casa linha nenhuma e cai no
 * 409, em vez de "confirmar" uma transição que não fez.
 */
async function mudarSituacaoDoItem(id: string, active: boolean): Promise<ItemDTO> {
  const prisma = getPrisma();
  const { count } = await prisma.item.updateMany({
    where: { id, active: !active },
    data: { active },
  });
  if (count === 0) {
    await requireItem(id);
    throw new InvalidItemStatusTransitionError(active);
  }
  const item = await prisma.item.findUniqueOrThrow({ where: { id }, include: { unit: true } });
  return toItemDTO(item, await isItemOperationallyUsed(id));
}

export async function activateItem(id: string): Promise<ItemDTO> {
  return mudarSituacaoDoItem(id, true);
}

export async function deactivateItem(id: string): Promise<ItemDTO> {
  return mudarSituacaoDoItem(id, false);
}
