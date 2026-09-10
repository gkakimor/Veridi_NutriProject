import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  SupplierItemCostSourceDTO,
  SupplierItemDTO,
  SupplierItemDetailDTO,
  SupplierItemListResponse,
  SupplierItemOfferDTO,
  SupplierItemQualificationEventDTO,
  SupplierOfferEligibility,
} from "@veridi/shared";
import {
  DEFAULT_OFFER_CURRENCY,
  hojeComercial,
  isValidCurrencyCode,
  normalizeCurrencyCode,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { diaDaColunaDeData, marcadorDeHojeComercial } from "../../lib/business-day.js";
import { custoUnitario } from "../../lib/decimal-serialization.js";
import { offerValidityWhere, selectItemCostSource } from "../../lib/cost-source-selection.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  UomDimensionMismatchError,
  UomNotFoundError,
  convertUomDecimal,
} from "../items/uom.js";
import type { UnitOfMeasureDecimalLike } from "../items/uom.js";
import {
  IncompatibleOfferUomError,
  InactiveSupplierItemPartyError,
  InvalidCurrencyCodeError,
  InvalidMinimumOrderError,
  InvalidOfferValidityError,
  SupplierItemAlreadyExistsError,
  SupplierItemInvalidItemTypeError,
  SupplierItemItemNotFoundError,
  SupplierItemNotEligibleForPreferredError,
  SupplierItemNotFoundError,
  SupplierItemSupplierNotFoundError,
} from "./supplier-items.errors.js";
import type {
  ChangeQualificationInput,
  CreateOfferInput,
  CreateSupplierItemInput,
  ListSupplierItemsQuery,
  UpdateSupplierItemInput,
} from "./supplier-items.schemas.js";

/**
 * Item × Fornecedor.
 *
 * Três separações que a capacidade inteira depende:
 * 1. **relação × condição comercial**: a relação (existe, código no
 *    fornecedor, homologação, preferencial) é estável; preço e MOQ mudam e
 *    ficam em ofertas IMUTÁVEIS;
 * 2. **homologado × preferencial**: homologação é decisão da Qualidade por
 *    item; preferencial é decisão operacional de Compras — e nunca
 *    significa "mais barato";
 * 3. **oferta × custo real**: a oferta é referência comercial do
 *    fornecedor; o custo real de aquisição continua vindo do recebimento e
 *    a hierarquia de custo não é tocada.
 */

const supplierItemInclude = {
  item: true,
  supplier: true,
  offers: {
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] as PrismaTypes.SupplierItemOfferOrderByWithRelationInput[],
  },
} satisfies PrismaTypes.SupplierItemInclude;

type SupplierItemWithRelations = PrismaTypes.SupplierItemGetPayload<{
  include: typeof supplierItemInclude;
}>;

type OfferRow = SupplierItemWithRelations["offers"][number];

/**
 * Oferta vigente: precisa ter início de vigência real, já iniciado, e não
 * estar expirada. Observação histórica de preço (sem `effectiveAt`) NUNCA
 * é preço atual — é justamente o que a planilha legada tem.
 *
 * A comparação é de DIA CIVIL, a mesma do motor de custo: uma oferta que
 * passa a valer hoje já vale hoje, e uma que vale até hoje ainda vale hoje.
 * Antes disto a tela comparava contra o relógio — uma oferta com
 * `validUntil` no dia corrente (marcador de meia-noite UTC) aparecia como
 * vencida a partir do primeiro minuto do próprio dia impresso nela, e a
 * tela contradizia o cálculo.
 */
export function isOfferCurrent(offer: OfferRow, now = new Date()): boolean {
  return offerValidityToday(offer, now) === null;
}

/**
 * O que a VIGÊNCIA de uma oferta impede hoje — `null` quando não impede nada.
 *
 * Só datas. Moeda é condição separada de propósito: "vigente" responde se o
 * preço está no ar, e um preço em dólar vigente continua sendo o preço
 * vigente daquele fornecedor — o que ele não pode é virar custo em reais.
 * Misturar as duas faria a Sugestão de Compra deixar de enxergar a oferta
 * atual de um fornecedor estrangeiro, que é outra pergunta e outra tela.
 */
function offerValidityToday(offer: OfferRow, now: Date): SupplierOfferEligibility | null {
  if (!offer.effectiveAt) return "NO_VALIDITY";
  /*
   * "Hoje" é o dia de quem OPERA a Veridi, não o dia do relógio UTC do
   * servidor — às 23h de São Paulo os dois já discordam. O dia gravado na
   * oferta é lido em UTC porque é assim que um marcador de dia é gravado.
   * Duas leituras diferentes, de propósito: uma é instante, a outra é dia.
   */
  const dia = hojeComercial(now);
  if (diaDaColunaDeData(offer.effectiveAt) > dia) return "NOT_YET_EFFECTIVE";
  if (offer.validUntil && diaDaColunaDeData(offer.validUntil) < dia) return "EXPIRED";
  return null;
}

/**
 * O diagnóstico COMPLETO de uma oferta, do jeito que a tela precisa dizer.
 *
 * Percorre as mesmas condições de `resolveSupplierOfferCost`. A ordem
 * importa para a frase, não para o resultado: uma oferta em dólar sem
 * vigência tem dois problemas, e dizer "sem vigência" mandaria a pessoa
 * registrar outra oferta em dólar, que também não serviria. A moeda vem
 * primeiro porque é o impedimento que nenhuma oferta nova resolve.
 *
 * O que NÃO está aqui: a ambiguidade entre fornecedores. Ela é do item, e
 * uma oferta perfeitamente elegível continua elegível quando outra do mesmo
 * item também é — o que falta ali é uma escolha, não uma condição.
 */
function offerEligibility(
  offer: OfferRow,
  supplierItem: SupplierItemWithRelations,
  units: readonly UnitOfMeasureDecimalLike[],
  now: Date,
): SupplierOfferEligibility {
  if (offer.currencyCode !== DEFAULT_OFFER_CURRENCY) return "FOREIGN_CURRENCY";

  const porVigencia = offerValidityToday(offer, now);
  if (porVigencia) return porVigencia;

  const relacaoServe =
    supplierItem.active &&
    supplierItem.qualificationStatus === "APPROVED" &&
    supplierItem.supplier.active;
  if (!relacaoServe) return "SUPPLIER_NOT_APPROVED";

  if (convertPriceToUom(offer.unitPrice, offer.priceUomCode, supplierItem.item.unitCode, units) === null) {
    return "INCOMPATIBLE_UOM";
  }

  return "ELIGIBLE";
}

function toOfferDTO(
  offer: OfferRow,
  eligibility: SupplierOfferEligibility,
  now = new Date(),
): SupplierItemOfferDTO {
  return {
    eligibility,
    id: offer.id,
    supplierItemId: offer.supplierItemId,
    unitPrice: offer.unitPrice.toString(),
    currencyCode: offer.currencyCode,
    priceUomCode: offer.priceUomCode,
    minimumOrderQuantity: offer.minimumOrderQuantity
      ? offer.minimumOrderQuantity.toString()
      : null,
    minimumOrderUomCode: offer.minimumOrderUomCode,
    effectiveAt: offer.effectiveAt ? offer.effectiveAt.toISOString() : null,
    validUntil: offer.validUntil ? offer.validUntil.toISOString() : null,
    source: offer.source,
    notes: offer.notes,
    createdAt: offer.createdAt.toISOString(),
    createdByName: offer.createdByNameSnapshot,
    isCurrent: isOfferCurrent(offer, now),
  };
}

/** Vigente mais recente por `effectiveAt` e, no empate, por criação. */
export function pickCurrentOffer(offers: readonly OfferRow[], now = new Date()): OfferRow | null {
  const current = offers.filter((offer) => isOfferCurrent(offer, now));
  if (current.length === 0) return null;

  return current.reduce((best, offer) => {
    const bestAt = best.effectiveAt!.getTime();
    const offerAt = offer.effectiveAt!.getTime();
    if (offerAt !== bestAt) return offerAt > bestAt ? offer : best;
    return offer.createdAt.getTime() > best.createdAt.getTime() ? offer : best;
  });
}

/** Última referência SEM vigência — exibida como histórico, nunca como preço atual. */
function pickLatestLegacyOffer(offers: readonly OfferRow[]): OfferRow | null {
  const withoutValidity = offers.filter((offer) => !offer.effectiveAt);
  if (withoutValidity.length === 0) return null;
  return withoutValidity.reduce((best, offer) =>
    offer.createdAt.getTime() > best.createdAt.getTime() ? offer : best,
  );
}

/**
 * Contexto que a linha sozinha não conhece.
 *
 * `units` para responder compatibilidade de unidade sem uma consulta por
 * oferta; `ambiguousItemIds` para responder a ambiguidade do item sem uma
 * consulta por linha. Os dois são resolvidos uma vez por requisição — a
 * grade de Item × Fornecedor lista 20 relações e não pode pagar 20 vezes
 * pela mesma pergunta.
 */
interface DTOContext {
  now: Date;
  units: readonly UnitOfMeasureDecimalLike[];
  ambiguousItemIds: ReadonlySet<string>;
}

export function toSupplierItemDTO(
  supplierItem: SupplierItemWithRelations,
  context: DTOContext,
): SupplierItemDTO {
  const { now, units } = context;
  const current = pickCurrentOffer(supplierItem.offers, now);
  const legacy = pickLatestLegacyOffer(supplierItem.offers);
  const eligibilityOf = (offer: OfferRow) => offerEligibility(offer, supplierItem, units, now);

  return {
    id: supplierItem.id,
    itemId: supplierItem.itemId,
    itemCode: supplierItem.item.code,
    itemName: supplierItem.item.name,
    itemExternalCode: supplierItem.item.externalCode,
    itemUnitCode: supplierItem.item.unitCode,
    itemType: supplierItem.item.type,
    itemFamily: supplierItem.item.family,
    supplierId: supplierItem.supplierId,
    supplierCode: supplierItem.supplier.code,
    supplierName: supplierItem.supplier.legalName,
    supplierActive: supplierItem.supplier.active,
    supplierItemCode: supplierItem.supplierItemCode,
    qualificationStatus: supplierItem.qualificationStatus,
    preferred: supplierItem.preferred,
    active: supplierItem.active,
    commercialNotes: supplierItem.commercialNotes,
    currentOffer: current ? toOfferDTO(current, eligibilityOf(current), now) : null,
    latestLegacyOffer: legacy ? toOfferDTO(legacy, eligibilityOf(legacy), now) : null,
    offerCount: supplierItem.offers.length,
    costSourceAmbiguous: context.ambiguousItemIds.has(supplierItem.itemId),
    createdAt: supplierItem.createdAt.toISOString(),
    createdByName: supplierItem.createdByNameSnapshot,
    updatedAt: supplierItem.updatedAt.toISOString(),
    updatedByName: supplierItem.updatedByNameSnapshot,
  };
}

/**
 * Quais destes itens têm mais de um fornecedor com oferta elegível e nenhum
 * preferencial — o estado em que o motor devolve custo DESCONHECIDO.
 *
 * É a mesma condição de `resolveSupplierOfferCost`, feita de uma vez para o
 * conjunto de itens da página: elegibilidade da relação e da vigência no
 * `where`, compatibilidade de unidade em memória (o registro de UOM não
 * cabe num filtro SQL). Uma consulta por página, nunca uma por linha.
 *
 * A pergunta é do ITEM, e não do fornecedor: o mesmo fornecedor pode ter a
 * relação impecável e ainda assim o item ficar sem custo porque o vizinho
 * também tem oferta.
 */
async function resolveAmbiguousItems(
  itemIds: readonly string[],
  units: readonly UnitOfMeasureDecimalLike[],
  now: Date,
): Promise<Set<string>> {
  const ambiguous = new Set<string>();
  if (itemIds.length === 0) return ambiguous;

  const relations = await getPrisma().supplierItem.findMany({
    where: {
      itemId: { in: [...new Set(itemIds)] },
      active: true,
      qualificationStatus: "APPROVED",
      supplier: { active: true },
      offers: { some: offerValidityWhere(now) },
    },
    select: {
      itemId: true,
      preferred: true,
      item: { select: { unitCode: true } },
      offers: {
        where: offerValidityWhere(now),
        select: { unitPrice: true, priceUomCode: true },
      },
    },
  });

  const porItem = new Map<string, { candidatos: number; preferenciais: number }>();
  for (const relation of relations) {
    const temOfertaUsavel = relation.offers.some(
      (offer) =>
        convertPriceToUom(offer.unitPrice, offer.priceUomCode, relation.item.unitCode, units) !== null,
    );
    if (!temOfertaUsavel) continue;
    const atual = porItem.get(relation.itemId) ?? { candidatos: 0, preferenciais: 0 };
    atual.candidatos += 1;
    if (relation.preferred) atual.preferenciais += 1;
    porItem.set(relation.itemId, atual);
  }

  for (const [itemId, contagem] of porItem) {
    // Um candidato só nunca é ambíguo — `SUPPLIER_OFFER_SINGLE_APPROVED`
    // continua respondendo sem exigir preferencial. Mais de um preferencial
    // é dado inconsistente e o motor trata igual a nenhum: ambíguo.
    if (contagem.candidatos > 1 && contagem.preferenciais !== 1) ambiguous.add(itemId);
  }
  return ambiguous;
}

export async function getSupplierItemById(id: string): Promise<SupplierItemDetailDTO | null> {
  const prisma = getPrisma();
  const supplierItem = await prisma.supplierItem.findUnique({
    where: { id },
    include: supplierItemInclude,
  });
  if (!supplierItem) return null;

  const now = new Date();
  const [history, units] = await Promise.all([
    prisma.supplierItemQualificationHistory.findMany({
      where: { supplierItemId: id },
      orderBy: { changedAt: "asc" },
    }),
    prisma.unitOfMeasure.findMany(),
  ]);

  const [ambiguousItemIds, automatic] = await Promise.all([
    resolveAmbiguousItems([supplierItem.itemId], units, now),
    /*
     * A fonte que o motor usaria HOJE para este item.
     *
     * Aqui e não na grade: é uma resolução por item, e responder isso por
     * linha numa listagem seria o N+1 que a auditoria pediu para evitar. No
     * detalhe é uma pergunta só, e é exatamente onde ela é feita — quem
     * acabou de cadastrar uma oferta válida precisa entender por que o custo
     * do item continua vindo de uma compra real de duas semanas atrás.
     */
    selectItemCostSource(
      prisma,
      {
        itemId: supplierItem.itemId,
        itemUnitCode: supplierItem.item.unitCode,
        // O motor pergunta por DIA CIVIL, e `now` é instante: às 22:30 de São
        // Paulo passar o relógio faria a seleção enxergar o dia seguinte.
        referenceDate: marcadorDeHojeComercial(now),
      },
      units,
    ),
  ]);

  const qualificationHistory: SupplierItemQualificationEventDTO[] = history.map((event) => ({
    id: event.id,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    note: event.note,
    changedAt: event.changedAt.toISOString(),
    changedByName: event.changedByNameSnapshot,
  }));

  const context: DTOContext = { now, units, ambiguousItemIds };
  const costSourceToday: SupplierItemCostSourceDTO = {
    source: automatic.source,
    unitCost: automatic.unitCost ? custoUnitario(automatic.unitCost) : null,
    unitCode: supplierItem.item.unitCode,
    details: automatic.details,
    referenceDate: now.toISOString(),
  };

  return {
    ...toSupplierItemDTO(supplierItem, context),
    offers: supplierItem.offers.map((offer) =>
      toOfferDTO(offer, offerEligibility(offer, supplierItem, units, now), now),
    ),
    qualificationHistory,
    costSourceToday,
  };
}

export async function listSupplierItems(
  query: ListSupplierItemsQuery,
  pagination: Pagination = query,
): Promise<SupplierItemListResponse> {
  const prisma = getPrisma();

  // Montado dinamicamente: `exactOptionalPropertyTypes` nao aceita spread
  // condicional direto sobre campos de enum do Prisma.
  const itemWhere = {
    ...(query.itemFamily ? { family: query.itemFamily } : {}),
    ...(query.itemType ? { type: query.itemType } : {}),
  } as PrismaTypes.ItemWhereInput;

  const where: PrismaTypes.SupplierItemWhereInput = {
    ...(query.itemId ? { itemId: query.itemId } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.qualificationStatus ? { qualificationStatus: query.qualificationStatus } : {}),
    ...(query.preferred !== undefined ? { preferred: query.preferred } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(Object.keys(itemWhere).length > 0 ? { item: { is: itemWhere } } : {}),
    ...(query.search
      ? {
          OR: [
            { supplierItemCode: { contains: query.search, mode: "insensitive" } },
            { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
            { item: { is: { externalCode: { contains: query.search, mode: "insensitive" } } } },
            { supplier: { is: { legalName: { contains: query.search, mode: "insensitive" } } } },
            { supplier: { is: { code: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.supplierItem.findMany({
      where,
      include: supplierItemInclude,
      orderBy: [{ item: { code: "asc" } }, { preferred: "desc" }, { supplier: { code: "asc" } }],
      ...pageArgs(pagination),
    }),
    prisma.supplierItem.count({ where }),
  ]);

  const now = new Date();
  const units = await prisma.unitOfMeasure.findMany();
  const ambiguousItemIds = await resolveAmbiguousItems(
    rows.map((row) => row.itemId),
    units,
    now,
  );
  const context: DTOContext = { now, units, ambiguousItemIds };
  return {
    supplierItems: rows.map((row) => toSupplierItemDTO(row, context)),
    ...pageMeta(pagination, total),
  };
}

async function requireSupplierItem(id: string): Promise<SupplierItemWithRelations> {
  const supplierItem = await getPrisma().supplierItem.findUnique({
    where: { id },
    include: supplierItemInclude,
  });
  if (!supplierItem) throw new SupplierItemNotFoundError(id);
  return supplierItem;
}

export async function createSupplierItem(
  input: CreateSupplierItemInput,
  actor: User,
): Promise<SupplierItemDetailDTO> {
  const prisma = getPrisma();

  const [item, supplier] = await Promise.all([
    prisma.item.findUnique({ where: { id: input.itemId } }),
    prisma.supplier.findUnique({ where: { id: input.supplierId } }),
  ]);
  if (!item) throw new SupplierItemItemNotFoundError(input.itemId);
  if (!supplier) throw new SupplierItemSupplierNotFoundError(input.supplierId);
  // Produto acabado é produzido, não comprado de fornecedor.
  if (item.type !== "RAW_MATERIAL" && item.type !== "PACKAGING") {
    throw new SupplierItemInvalidItemTypeError();
  }
  if (!item.active) throw new InactiveSupplierItemPartyError("item");
  if (!supplier.active) throw new InactiveSupplierItemPartyError("supplier");

  const existing = await prisma.supplierItem.findUnique({
    where: { supplierId_itemId: { supplierId: input.supplierId, itemId: input.itemId } },
  });
  if (existing) throw new SupplierItemAlreadyExistsError();

  /*
   * Tudo o que pode ser recusado é recusado ANTES de escrever.
   *
   * Preço em moeda inexistente ou unidade incompatível não pode deixar
   * para trás uma relação criada sem a oferta que a justificava — o
   * usuário pediu uma coisa só.
   */
  const qualificationStatus = input.qualificationStatus ?? "PENDING";
  const preferred = input.preferred === true;
  if (preferred && qualificationStatus !== "APPROVED") {
    throw new SupplierItemNotEligibleForPreferredError();
  }

  let preparedOffer: ReturnType<typeof prepareOffer> | null = null;
  if (input.initialOffer) {
    const units = await prisma.unitOfMeasure.findMany();
    preparedOffer = prepareOffer(input.initialOffer, item.unitCode, units);
  }

  const id = await prisma.$transaction(async (tx) => {
    // Preferencial é único por Item: o lock é o mesmo que `setPreferred` usa.
    if (preferred) {
      await tx.$queryRaw`SELECT id FROM items WHERE id = ${input.itemId} FOR UPDATE`;
      await tx.supplierItem.updateMany({
        where: { itemId: input.itemId, preferred: true },
        data: { preferred: false, updatedByUserId: actor.id, updatedByNameSnapshot: actor.name },
      });
    }

    const created = await tx.supplierItem.create({
      data: {
        itemId: input.itemId,
        supplierId: input.supplierId,
        ...(input.supplierItemCode !== undefined
          ? { supplierItemCode: input.supplierItemCode }
          : {}),
        ...(input.commercialNotes !== undefined
          ? { commercialNotes: input.commercialNotes }
          : {}),
        qualificationStatus,
        preferred,
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
        updatedByUserId: actor.id,
        updatedByNameSnapshot: actor.name,
      },
    });

    /*
     * O histórico registra o que aconteceu, não o que o formulário parecia.
     *
     * Nascer já homologado é UM evento `null → APPROVED`, com a observação
     * de quem decidiu. Inventar um `PENDING` intermediário que nunca
     * existiu seria escrever ficção no histórico da Qualidade.
     */
    await tx.supplierItemQualificationHistory.create({
      data: {
        supplierItemId: created.id,
        fromStatus: null,
        toStatus: qualificationStatus,
        ...(input.qualificationNote !== undefined ? { note: input.qualificationNote } : {}),
        changedByUserId: actor.id,
        changedByNameSnapshot: actor.name,
      },
    });

    if (preparedOffer) {
      await tx.supplierItemOffer.create({
        data: {
          supplierItemId: created.id,
          ...preparedOffer,
          createdByUserId: actor.id,
          createdByNameSnapshot: actor.name,
        },
      });
    }

    return created.id;
  });

  return (await getSupplierItemById(id))!;
}

/**
 * Atualiza o que é comercial/administrativo. Homologação e preferencial
 * têm rotas próprias — nunca são efeito colateral de um PATCH.
 */
export async function updateSupplierItem(
  id: string,
  input: UpdateSupplierItemInput,
  actor: User,
): Promise<SupplierItemDetailDTO> {
  const prisma = getPrisma();
  const current = await requireSupplierItem(id);

  // Relação inativa nunca continua preferencial.
  const losesPreferred = input.active === false && current.preferred;

  await prisma.supplierItem.update({
    where: { id },
    data: {
      ...(input.supplierItemCode !== undefined
        ? { supplierItemCode: input.supplierItemCode }
        : {}),
      ...(input.commercialNotes !== undefined ? { commercialNotes: input.commercialNotes } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(losesPreferred ? { preferred: false } : {}),
      updatedByUserId: actor.id,
      updatedByNameSnapshot: actor.name,
    },
  });

  return (await getSupplierItemById(id))!;
}

/**
 * Homologa/bloqueia/devolve para pendente, sempre com evento imutável.
 * Bloquear derruba o preferencial na MESMA transação: fornecedor bloqueado
 * jamais fica como preferencial do item.
 */
export async function changeQualification(
  id: string,
  input: ChangeQualificationInput,
  actor: User,
): Promise<SupplierItemDetailDTO> {
  const prisma = getPrisma();
  const current = await requireSupplierItem(id);

  if (current.qualificationStatus === input.status) return (await getSupplierItemById(id))!;

  const losesPreferred = input.status !== "APPROVED" && current.preferred;

  await prisma.$transaction(async (tx) => {
    await tx.supplierItem.update({
      where: { id },
      data: {
        qualificationStatus: input.status,
        ...(losesPreferred ? { preferred: false } : {}),
        updatedByUserId: actor.id,
        updatedByNameSnapshot: actor.name,
      },
    });
    await tx.supplierItemQualificationHistory.create({
      data: {
        supplierItemId: id,
        fromStatus: current.qualificationStatus,
        toStatus: input.status,
        ...(input.note !== undefined ? { note: input.note } : {}),
        changedByUserId: actor.id,
        changedByNameSnapshot: actor.name,
      },
    });
  });

  return (await getSupplierItemById(id))!;
}

/**
 * Marca/desmarca o fornecedor preferencial do item. O anterior é desmarcado
 * na mesma transação, sob lock do Item — o índice parcial único no banco é
 * a garantia final contra dois preferenciais simultâneos.
 *
 * Preferencial é decisão operacional: nunca muda automaticamente porque
 * outra oferta ficou mais barata.
 */
export async function setPreferred(
  id: string,
  preferred: boolean,
  actor: User,
): Promise<SupplierItemDetailDTO> {
  const prisma = getPrisma();
  const current = await requireSupplierItem(id);

  if (preferred && (!current.active || current.qualificationStatus !== "APPROVED")) {
    throw new SupplierItemNotEligibleForPreferredError();
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM items WHERE id = ${current.itemId} FOR UPDATE`;

    if (preferred) {
      await tx.supplierItem.updateMany({
        where: { itemId: current.itemId, preferred: true, id: { not: id } },
        data: { preferred: false, updatedByUserId: actor.id, updatedByNameSnapshot: actor.name },
      });
    }

    await tx.supplierItem.update({
      where: { id },
      data: { preferred, updatedByUserId: actor.id, updatedByNameSnapshot: actor.name },
    });
  });

  return (await getSupplierItemById(id))!;
}

/**
 * Registra uma nova oferta. Oferta é IMUTÁVEL: corrigir preço, MOQ, moeda
 * ou vigência é sempre registrar outra — o histórico nunca é reescrito.
 */
export async function createOffer(
  supplierItemId: string,
  input: CreateOfferInput,
  actor: User,
): Promise<SupplierItemDetailDTO> {
  const prisma = getPrisma();
  const supplierItem = await requireSupplierItem(supplierItemId);

  const units = await prisma.unitOfMeasure.findMany();
  const prepared = prepareOffer(input, supplierItem.item.unitCode, units);

  await prisma.supplierItemOffer.create({
    data: {
      supplierItemId,
      ...prepared,
      createdByUserId: actor.id,
      createdByNameSnapshot: actor.name,
    },
  });

  return (await getSupplierItemById(supplierItemId))!;
}

/**
 * Valida e normaliza uma oferta ANTES de qualquer escrita.
 *
 * Vive fora da transação de propósito: moeda inválida, unidade
 * incompatível ou vigência invertida devem impedir a relação de nascer, e
 * não derrubar metade dela depois de criada.
 */
function prepareOffer(
  input: CreateOfferInput,
  itemUnitCode: string,
  units: readonly UnitOfMeasureDecimalLike[],
) {
  const currencyCode = normalizeCurrencyCode(input.currencyCode ?? DEFAULT_OFFER_CURRENCY);
  if (!isValidCurrencyCode(currencyCode)) throw new InvalidCurrencyCodeError(currencyCode);

  assertUomCompatibleWithItem(input.priceUomCode, itemUnitCode, units);

  if (input.minimumOrderQuantity !== undefined) {
    if (!input.minimumOrderUomCode) {
      throw new InvalidMinimumOrderError("Informe a unidade do pedido mínimo.");
    }
    assertUomCompatibleWithItem(input.minimumOrderUomCode, itemUnitCode, units);
  } else if (input.minimumOrderUomCode) {
    throw new InvalidMinimumOrderError("Informe a quantidade do pedido mínimo.");
  }

  /*
   * A vigência vem de fora, sempre. O servidor não inventa "agora".
   *
   * Antes: `input.effectiveAt === undefined ? new Date() : …`. Uma oferta
   * cadastrada sem data nascia valendo a partir do INSTANTE do POST, e a
   * data comercial daquele preço passava a ser o relógio de quem gravou —
   * um "hoje implícito" dentro do domínio, na única fronteira que não pode
   * ter um. A tela pré-preenche a data de hoje de forma visível e
   * editável; a schema exige que ela chegue.
   */
  const effectiveAt = input.effectiveAt;
  const validUntil = input.validUntil ?? null;
  if (validUntil && validUntil.getTime() < effectiveAt.getTime()) {
    throw new InvalidOfferValidityError();
  }

  return {
    unitPrice: new Prisma.Decimal(input.unitPrice),
    currencyCode,
    priceUomCode: input.priceUomCode,
    ...(input.minimumOrderQuantity !== undefined
      ? {
          minimumOrderQuantity: new Prisma.Decimal(input.minimumOrderQuantity),
          minimumOrderUomCode: input.minimumOrderUomCode!,
        }
      : {}),
    effectiveAt,
    validUntil,
    source: "MANUAL" as const,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
}

function assertUomCompatibleWithItem(
  uomCode: string,
  itemUnitCode: string,
  units: readonly UnitOfMeasureDecimalLike[],
): void {
  try {
    convertUomDecimal(new Prisma.Decimal(1), uomCode, itemUnitCode, units);
  } catch (error) {
    if (error instanceof UomNotFoundError || error instanceof UomDimensionMismatchError) {
      throw new IncompatibleOfferUomError(uomCode, itemUnitCode);
    }
    throw error;
  }
}

/**
 * Converte um preço "por unidade X" para "por unidade do item".
 *
 * `R$ 0,10/g` vira `R$ 100,00/kg` porque 1 kg contém 1000 g. Devolve `null`
 * quando as unidades não são convertíveis — nesse caso o preço é mostrado
 * na unidade original e nada é pré-preenchido, nunca um número inventado.
 */
export function convertPriceToUom(
  unitPrice: Prisma.Decimal,
  priceUomCode: string,
  targetUomCode: string,
  units: readonly UnitOfMeasureDecimalLike[],
): Prisma.Decimal | null {
  if (priceUomCode === targetUomCode) return unitPrice;
  try {
    // Quanto de `priceUom` cabe em 1 `targetUom`.
    const factor = convertUomDecimal(new Prisma.Decimal(1), targetUomCode, priceUomCode, units);
    return unitPrice.times(factor);
  } catch (error) {
    if (error instanceof UomNotFoundError || error instanceof UomDimensionMismatchError) {
      return null;
    }
    throw error;
  }
}

/** Converte uma quantidade (MOQ) para a unidade do item; `null` se incompatível. */
export function convertQuantityToUom(
  quantity: Prisma.Decimal,
  fromUomCode: string,
  targetUomCode: string,
  units: readonly UnitOfMeasureDecimalLike[],
): Prisma.Decimal | null {
  try {
    return convertUomDecimal(quantity, fromUomCode, targetUomCode, units);
  } catch (error) {
    if (error instanceof UomNotFoundError || error instanceof UomDimensionMismatchError) {
      return null;
    }
    throw error;
  }
}
