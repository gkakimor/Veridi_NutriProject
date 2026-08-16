import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  Customer,
  FormulationVersion,
  Item,
  Lot,
  MaterialReservation,
  MaterialReservationLine,
  Product,
  ProductionConsumption,
  ProductionOrder,
  ProductionOrderRequirement,
  ProductionOutput,
} from "@prisma/client";
import type {
  EligibleFinishedLotDTO,
  MaterialReservationDTO,
  MaterialReservationLineDTO,
  ProductionConsumptionDTO,
  ProductionOrderDTO,
  ProductionOrderListResponse,
  ProductionOrderMaterialsStatus,
  ProductionOrderRequirementDTO,
  ProductionOutputDTO,
} from "@veridi/shared";
import { PRODUCTION_ORDER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  getAvailableByItems,
  getConsumedByReservationLines,
  getOnHandByItems,
  getOnOrderByItems,
  getReservedByItems,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
import { convertUomDecimal } from "../items/uom.js";
import { getAllocationSuggestion } from "../inventory/allocation.service.js";
import {
  FormulationVersionNotFoundError,
  FormulationVersionProductMismatchError,
  InactiveProductError,
  InvalidTransitionError,
  MissingFinishedItemError,
  OrderLockedError,
  PlanValidationError,
  ProductNotFoundError,
  ProductionOrderNotFoundError,
  ReleaseValidationError,
} from "./production-orders.errors.js";
import type {
  CreateProductionOrderInput,
  ListProductionOrdersQuery,
  UpdateProductionOrderInput,
} from "./production-orders.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";
const CODE_SEQUENCE = "production_order_code_seq";

type ProductWithRelations = Product & { customer: Customer | null; finishedProductItem: Item | null };
type RequirementWithItem = ProductionOrderRequirement & { item: Item };
type ReservationLineWithRelations = MaterialReservationLine & { item: Item; lot: Lot | null };
type ReservationWithLines = MaterialReservation & { lines: ReservationLineWithRelations[] };
type ConsumptionWithRelations = ProductionConsumption & { item: Item; lot: Lot | null };
type OutputWithRelations = ProductionOutput & { lot: Lot | null };
type POWithRelations = ProductionOrder & {
  product: ProductWithRelations;
  formulationVersion: FormulationVersion | null;
  requirements: RequirementWithItem[];
  reservation: ReservationWithLines | null;
  consumptions: ConsumptionWithRelations[];
  outputs: OutputWithRelations[];
  finishedItem: Item | null;
};

const productionOrderInclude = {
  product: { include: { customer: true, finishedProductItem: true } },
  formulationVersion: true,
  requirements: { include: { item: true }, orderBy: { position: "asc" as const } },
  reservation: { include: { lines: { include: { item: true, lot: true } } } },
  consumptions: {
    include: { item: true, lot: true },
    orderBy: { createdAt: "asc" as const },
  },
  outputs: {
    include: { lot: true },
    orderBy: { createdAt: "asc" as const },
  },
  finishedItem: true,
} as const;

/** Soma dos ProductionOutput da OP — nunca uma segunda coluna manual. Aceita `tx` para uso dentro de transacao. */
export async function getProducedQuantity(
  prisma: PrismaClient | Prisma.TransactionClient,
  productionOrderId: string,
): Promise<Prisma.Decimal> {
  const result = await prisma.productionOutput.aggregate({
    where: { productionOrderId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? new Prisma.Decimal(0);
}

function toOutputDTO(output: OutputWithRelations): ProductionOutputDTO {
  return {
    id: output.id,
    quantity: output.quantity.toString(),
    lotId: output.lotId,
    lotCode: output.lot ? output.lot.code : null,
    businessLotNumber: output.lot ? output.lot.businessLotNumber : null,
    producedAt: output.producedAt.toISOString(),
    producedBy: output.producedBy,
    notes: output.notes,
  };
}

function toReservationLineDTO(
  line: ReservationLineWithRelations,
  consumedByLine: Map<string, Prisma.Decimal>,
): MaterialReservationLineDTO {
  const consumed = consumedByLine.get(line.id) ?? new Prisma.Decimal(0);
  const remaining = Prisma.Decimal.max(line.quantity.minus(consumed), 0);
  return {
    id: line.id,
    itemId: line.itemId,
    itemCode: line.item.code,
    itemName: line.item.name,
    lotId: line.lotId,
    lotCode: line.lot ? line.lot.code : null,
    supplierLot: line.lot ? line.lot.supplierLot : null,
    expiryDate: line.lot?.expiryDate ? line.lot.expiryDate.toISOString() : null,
    location: line.lot ? line.lot.location : null,
    lotStatus: line.lot ? line.lot.status : null,
    quantity: line.quantity.toString(),
    unitCode: line.item.unitCode,
    consumedQuantity: consumed.toString(),
    remainingQuantity: remaining.toString(),
    pickingStatus: line.pickedAt ? "CONFIRMED" : "PENDING",
    pickedAt: line.pickedAt ? line.pickedAt.toISOString() : null,
    pickedBy: line.pickedBy,
    releasedAt: line.releasedAt ? line.releasedAt.toISOString() : null,
    releasedBy: line.releasedBy,
    releaseReason: line.releaseReason,
    replacesLineId: line.replacesLineId,
  };
}

function toReservationDTO(
  reservation: ReservationWithLines,
  consumedByLine: Map<string, Prisma.Decimal>,
): MaterialReservationDTO {
  return {
    id: reservation.id,
    productionOrderId: reservation.productionOrderId,
    status: reservation.status,
    createdAt: reservation.createdAt.toISOString(),
    createdBy: reservation.createdBy,
    releasedAt: reservation.releasedAt ? reservation.releasedAt.toISOString() : null,
    releasedBy: reservation.releasedBy,
    releaseReason: reservation.releaseReason,
    lines: reservation.lines.map((line) => toReservationLineDTO(line, consumedByLine)),
  };
}

function toConsumptionDTO(consumption: ConsumptionWithRelations): ProductionConsumptionDTO {
  return {
    id: consumption.id,
    itemId: consumption.itemId,
    itemCode: consumption.item.code,
    itemName: consumption.item.name,
    lotId: consumption.lotId,
    lotCode: consumption.lot ? consumption.lot.code : null,
    quantity: consumption.quantity.toString(),
    unitCode: consumption.item.unitCode,
    consumedAt: consumption.consumedAt.toISOString(),
    consumedBy: consumption.consumedBy,
  };
}

async function requireOrder(id: string): Promise<POWithRelations> {
  const order = await getPrisma().productionOrder.findUnique({
    where: { id },
    include: productionOrderInclude,
  });
  if (!order) throw new ProductionOrderNotFoundError(id);
  return order;
}

/** Product precisa existir, estar ativo e ter um Finished Product Item valido — gate de "nova OP". */
async function assertActiveProductWithFinishedItem(id: string): Promise<ProductWithRelations> {
  const product = await getPrisma().product.findUnique({
    where: { id },
    include: { customer: true, finishedProductItem: true },
  });
  if (!product) throw new ProductNotFoundError(id);
  if (!product.active) throw new InactiveProductError(id);
  if (!product.finishedProductItemId || !product.finishedProductItem) {
    throw new MissingFinishedItemError();
  }
  return product;
}

/** Explicita: versao precisa pertencer ao produto. Omitida: usa a ACTIVE atual do produto (ou null). */
async function resolveFormulationVersion(
  productId: string,
  explicitVersionId: string | undefined,
): Promise<FormulationVersion | null> {
  const prisma = getPrisma();
  if (explicitVersionId) {
    const version = await prisma.formulationVersion.findUnique({ where: { id: explicitVersionId } });
    if (!version) throw new FormulationVersionNotFoundError(explicitVersionId);
    if (version.productId !== productId) {
      throw new FormulationVersionProductMismatchError(explicitVersionId, productId);
    }
    return version;
  }
  return prisma.formulationVersion.findFirst({ where: { productId, status: "ACTIVE" } });
}

/**
 * Regenera Requirements (delete+recreate) a partir da versao de formulacao
 * e quantidade planejada atuais — nunca deixa Requirement orfao/desatualizado
 * enquanto a OP e DRAFT. Sem formulacao selecionada: nenhum Requirement.
 */
async function regenerateRequirements(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
  formulationVersionId: string | null,
  plannedQuantity: Prisma.Decimal,
): Promise<void> {
  await tx.productionOrderRequirement.deleteMany({ where: { productionOrderId } });
  if (!formulationVersionId) return;

  const version = await tx.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    include: { components: { include: { item: true }, orderBy: { position: "asc" } } },
  });
  if (!version || version.components.length === 0) return;

  const units = await tx.unitOfMeasure.findMany();
  const factor = plannedQuantity.dividedBy(version.basisQuantity);

  await tx.productionOrderRequirement.createMany({
    data: version.components.map((component, index) => {
      const item = component.item;
      const formulaResult = component.quantity.times(factor);
      const requiredQuantity = convertUomDecimal(formulaResult, component.unitCode, item.unitCode, units);
      return {
        productionOrderId,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        itemType: item.type,
        formulaQuantity: component.quantity,
        formulaUnitCode: component.unitCode,
        requiredQuantity,
        stockUnitCode: item.unitCode,
        position: index,
      };
    }),
  });
}

/**
 * Disponibilidade calculada AO VIVO a partir do Inventory Ledger — nunca
 * lida de coluna persistida no Requirement. Reutiliza exatamente a mesma
 * interpretacao de On Hand/Available/On Order da Visao Geral do Estoque, e
 * a mesma sugestao FEFO/FIFO do modulo de alocacao — nunca um calculo
 * paralelo.
 */
async function attachRequirementAvailability(
  requirements: RequirementWithItem[],
  reservationLinesByRequirement: Map<string, ReservationLineWithRelations[]>,
  consumedByLine: Map<string, Prisma.Decimal>,
): Promise<ProductionOrderRequirementDTO[]> {
  if (requirements.length === 0) return [];

  const prisma = getPrisma();
  const itemScopes = requirements.map((requirement) => ({
    id: requirement.itemId,
    controlsLot: requirement.item.controlsLot,
  }));
  const itemIds = itemScopes.map((scope) => scope.id);

  const [onHandByItem, availableByItem, onOrderByItem, reservedByItem] = await Promise.all([
    getOnHandByItems(prisma, itemIds),
    getAvailableByItems(prisma, itemScopes),
    getOnOrderByItems(prisma, itemIds),
    getReservedByItems(prisma, itemIds),
  ]);

  const results: ProductionOrderRequirementDTO[] = [];
  for (const requirement of requirements) {
    const linesForRequirement = reservationLinesByRequirement.get(requirement.id) ?? [];
    // So linhas ainda ativas (nao substituidas no Picking) contam como a
    // alocacao atual desta OP para este Requirement.
    const activeLines = linesForRequirement.filter((line) => line.releasedAt === null);
    const allocatedQuantity = activeLines.reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));
    const lineConsumedQuantity = activeLines.reduce(
      (sum, line) => sum.plus(consumedByLine.get(line.id) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    const remainingReservedQuantity = Prisma.Decimal.max(allocatedQuantity.minus(lineConsumedQuantity), 0);

    const onHand = onHandByItem.get(requirement.itemId) ?? new Prisma.Decimal(0);
    const onOrder = onOrderByItem.get(requirement.itemId) ?? new Prisma.Decimal(0);
    const reserved = reservedByItem.get(requirement.itemId) ?? new Prisma.Decimal(0);
    // A propria OP nunca compete contra si mesma: "Disponivel para esta OP"
    // soma de volta o que ela mesma ainda tem reservado (liquido de
    // consumo) daquele item — nunca conta a propria reserva como shortage.
    const available = (availableByItem.get(requirement.itemId) ?? new Prisma.Decimal(0)).plus(
      remainingReservedQuantity,
    );
    const shortage = Prisma.Decimal.max(requirement.requiredQuantity.minus(available), 0);

    // On Order e so informativo — nunca reduz o shortage operacional.
    const suggestion = await getAllocationSuggestion(
      prisma,
      requirement.itemId,
      requirement.requiredQuantity.toString(),
    );

    results.push({
      id: requirement.id,
      itemId: requirement.itemId,
      itemCode: requirement.itemCode,
      itemName: requirement.itemName,
      itemType: requirement.itemType,
      formulaQuantity: requirement.formulaQuantity.toString(),
      formulaUnitCode: requirement.formulaUnitCode,
      requiredQuantity: requirement.requiredQuantity.toString(),
      stockUnitCode: requirement.stockUnitCode,
      position: requirement.position,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      onOrder: onOrder.toString(),
      shortage: shortage.toString(),
      availabilityStatus: shortage.greaterThan(0) ? "SHORTAGE" : "AVAILABLE",
      suggestedAllocations: suggestion.allocations.map((allocation) => ({
        lotId: allocation.lotId,
        lotCode: allocation.lotCode,
        expiryDate: allocation.expiryDate,
        location: allocation.location,
        suggestedQuantity: allocation.suggestedQuantity,
      })),
      allocatedQuantity: allocatedQuantity.toString(),
      consumedQuantity: lineConsumedQuantity.toString(),
      remainingReservedQuantity: remainingReservedQuantity.toString(),
      reservationLines: linesForRequirement.map((line) => toReservationLineDTO(line, consumedByLine)),
    });
  }
  return results;
}

async function toProductionOrderDTO(order: POWithRelations): Promise<ProductionOrderDTO> {
  const allLines = order.reservation && order.reservation.status === "ACTIVE" ? order.reservation.lines : [];
  const consumedByLine = await getConsumedByReservationLines(
    getPrisma(),
    allLines.map((line) => line.id),
  );

  const reservationLinesByRequirement = new Map<string, ReservationLineWithRelations[]>();
  for (const line of allLines) {
    const list = reservationLinesByRequirement.get(line.productionOrderRequirementId) ?? [];
    list.push(line);
    reservationLinesByRequirement.set(line.productionOrderRequirementId, list);
  }

  const requirements = await attachRequirementAvailability(
    order.requirements,
    reservationLinesByRequirement,
    consumedByLine,
  );
  const shortageItemCount = requirements.filter((r) => r.availabilityStatus === "SHORTAGE").length;
  const materialsStatus: ProductionOrderMaterialsStatus =
    shortageItemCount > 0 ? "MATERIAL_SHORTAGE" : "MATERIALS_AVAILABLE";

  const versionNumber = order.formulationVersionNumber ?? order.formulationVersion?.versionNumber ?? null;
  const productionFactor = order.formulationVersion
    ? order.plannedQuantity.dividedBy(order.formulationVersion.basisQuantity).toString()
    : null;

  // Snapshot so existe a partir do planejamento — antes disso (DRAFT), le
  // Product/Item/Customer ao vivo via join.
  const usingSnapshot = order.productCode !== null;

  // producedQuantity e sempre a soma dos ProductionOutput — nunca uma
  // segunda coluna manual. remainingQuantity nunca fica negativo (Output
  // acima do planejado e bloqueado no service).
  const producedQuantity = order.outputs.reduce(
    (sum, output) => sum.plus(output.quantity),
    new Prisma.Decimal(0),
  );
  const remainingQuantity = Prisma.Decimal.max(order.plannedQuantity.minus(producedQuantity), 0);

  // Lotes PRODUCTION desta OP elegiveis para receber um novo Output — so
  // existem lotes que ja tiveram ao menos um Output (nunca uma consulta
  // separada: deriva do proprio order.outputs, ja incluido).
  const producedByLot = new Map<string, Prisma.Decimal>();
  const lotsById = new Map<string, NonNullable<OutputWithRelations["lot"]>>();
  for (const output of order.outputs) {
    if (!output.lot) continue;
    lotsById.set(output.lot.id, output.lot);
    producedByLot.set(output.lot.id, (producedByLot.get(output.lot.id) ?? new Prisma.Decimal(0)).plus(output.quantity));
  }
  const eligibleFinishedLots: EligibleFinishedLotDTO[] = [...lotsById.values()]
    .filter((lot) => {
      if (lot.status === "BLOCKED") return false;
      if (isLotExpired(lot)) return false;
      if (order.finishedItem?.requiresQualityRelease && lot.status === "AVAILABLE") return false;
      return true;
    })
    .map((lot) => ({
      id: lot.id,
      code: lot.code,
      businessLotNumber: lot.businessLotNumber,
      status: lot.status,
      producedQuantity: (producedByLot.get(lot.id) ?? new Prisma.Decimal(0)).toString(),
    }));

  return {
    id: order.id,
    code: order.code,
    productId: order.productId,
    productCode: usingSnapshot ? order.productCode! : order.product.code,
    productName: usingSnapshot ? order.productName! : order.product.name,
    finishedItemId: usingSnapshot ? order.finishedItemId : (order.product.finishedProductItem?.id ?? null),
    finishedItemCode: usingSnapshot
      ? order.finishedItemCode
      : (order.product.finishedProductItem?.code ?? null),
    finishedItemName: usingSnapshot
      ? order.finishedItemName
      : (order.product.finishedProductItem?.name ?? null),
    formulationVersionId: order.formulationVersionId,
    formulationVersionNumber: versionNumber,
    formulationVersionLabel: versionNumber ? `V${versionNumber}` : null,
    plannedQuantity: order.plannedQuantity.toString(),
    outputUnitCode: order.outputUnitCode,
    productionFactor,
    status: order.status,
    origin: order.origin,
    materialsStatus,
    shortageItemCount,
    notes: order.notes,
    customerCode: usingSnapshot ? order.customerCode : (order.product.customer?.code ?? null),
    customerName: usingSnapshot ? order.customerName : (order.product.customer?.legalName ?? null),
    customerCnpj: usingSnapshot ? order.customerCnpj : (order.product.customer?.cnpj ?? null),
    requirements,
    plannedAt: order.plannedAt ? order.plannedAt.toISOString() : null,
    plannedBy: order.plannedBy,
    releasedAt: order.releasedAt ? order.releasedAt.toISOString() : null,
    releasedBy: order.releasedBy,
    reservation: order.reservation ? toReservationDTO(order.reservation, consumedByLine) : null,
    startedAt: order.startedAt ? order.startedAt.toISOString() : null,
    startedBy: order.startedBy,
    consumptions: order.consumptions.map(toConsumptionDTO),
    producedQuantity: producedQuantity.toString(),
    remainingQuantity: remainingQuantity.toString(),
    outputs: order.outputs.map(toOutputDTO),
    eligibleFinishedLots,
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
    completedBy: order.completedBy,
    completionReason: order.completionReason,
    cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    cancelledBy: order.cancelledBy,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt.toISOString(),
    createdBy: order.createdBy,
    updatedAt: order.updatedAt.toISOString(),
  };
}

export async function listProductionOrders(
  query: ListProductionOrdersQuery,
): Promise<ProductionOrderListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.status) where["status"] = query.status;
  if (query.productId) where["productId"] = query.productId;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { productName: { contains: query.search, mode: "insensitive" } },
      { product: { is: { name: { contains: query.search, mode: "insensitive" } } } },
      { product: { is: { code: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      include: productionOrderInclude,
      orderBy: { code: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.productionOrder.count({ where }),
  ]);

  return {
    productionOrders: await Promise.all(orders.map(toProductionOrderDTO)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getProductionOrderById(id: string): Promise<ProductionOrderDTO | null> {
  const order = await getPrisma().productionOrder.findUnique({
    where: { id },
    include: productionOrderInclude,
  });
  return order ? toProductionOrderDTO(order) : null;
}

export async function createProductionOrder(
  input: CreateProductionOrderInput,
): Promise<ProductionOrderDTO> {
  const product = await assertActiveProductWithFinishedItem(input.productId);
  const formulationVersion = await resolveFormulationVersion(product.id, input.formulationVersionId);
  const plannedQuantity = new Prisma.Decimal(input.plannedQuantity ?? "1");
  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, PRODUCTION_ORDER_CODE_PREFIX);

  const orderId = await prisma.$transaction(async (tx) => {
    const created = await tx.productionOrder.create({
      data: {
        code,
        productId: product.id,
        formulationVersionId: formulationVersion?.id ?? null,
        plannedQuantity,
        outputUnitCode: product.finishedProductItem!.unitCode,
        origin: input.origin ?? "MANUAL",
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdBy: SYSTEM_ACTOR,
      },
    });

    await regenerateRequirements(tx, created.id, formulationVersion?.id ?? null, plannedQuantity);
    return created.id;
  });

  return (await getProductionOrderById(orderId))!;
}

export async function updateProductionOrder(
  id: string,
  input: UpdateProductionOrderInput,
): Promise<ProductionOrderDTO> {
  const current = await requireOrder(id);

  if (current.status === "CANCELLED") {
    throw new OrderLockedError("Ordem de produção cancelada é somente leitura.");
  }

  const touchesStructural =
    input.productId !== undefined ||
    input.formulationVersionId !== undefined ||
    input.plannedQuantity !== undefined;

  if (current.status !== "DRAFT" && touchesStructural) {
    throw new OrderLockedError(
      "Após planejada, a ordem de produção só permite alterar observações.",
    );
  }

  let effectiveProduct: ProductWithRelations = current.product;
  const productChanging = input.productId !== undefined && input.productId !== current.productId;
  if (productChanging) {
    effectiveProduct = await assertActiveProductWithFinishedItem(input.productId!);
  }

  let formulationVersion: FormulationVersion | null = current.formulationVersion;
  const formulationExplicitlySet = input.formulationVersionId !== undefined;
  if (productChanging) {
    // Troca de produto: nunca herda a formulacao do produto anterior —
    // resolve explicitamente para o novo produto (ACTIVE atual, ou a
    // versao explicita informada, que precisa pertencer ao novo produto).
    formulationVersion = await resolveFormulationVersion(effectiveProduct.id, input.formulationVersionId);
  } else if (formulationExplicitlySet) {
    formulationVersion = await resolveFormulationVersion(effectiveProduct.id, input.formulationVersionId);
  }

  const plannedQuantity =
    input.plannedQuantity !== undefined ? new Prisma.Decimal(input.plannedQuantity) : current.plannedQuantity;

  const regenerate = productChanging || formulationExplicitlySet || input.plannedQuantity !== undefined;

  await getPrisma().$transaction(async (tx) => {
    await tx.productionOrder.update({
      where: { id },
      data: {
        ...(productChanging ? { productId: effectiveProduct.id } : {}),
        ...(regenerate
          ? {
              formulationVersionId: formulationVersion?.id ?? null,
              outputUnitCode: effectiveProduct.finishedProductItem!.unitCode,
            }
          : {}),
        ...(input.plannedQuantity !== undefined ? { plannedQuantity } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (regenerate) {
      await regenerateRequirements(tx, id, formulationVersion?.id ?? null, plannedQuantity);
    }
  });

  return (await getProductionOrderById(id))!;
}

export async function planProductionOrder(id: string): Promise<ProductionOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM production_orders WHERE id = ${id} FOR UPDATE
    `;
    if (lockedRows.length === 0) throw new ProductionOrderNotFoundError(id);
    if (lockedRows[0]?.status !== "DRAFT") {
      throw new InvalidTransitionError("Somente rascunhos podem ser planejados.");
    }

    const order = await tx.productionOrder.findUniqueOrThrow({
      where: { id },
      include: {
        product: { include: { customer: true, finishedProductItem: true } },
        formulationVersion: { include: { components: true } },
      },
    });

    const reasons: string[] = [];
    if (!order.product.active) reasons.push("o produto está inativo");
    if (!order.product.finishedProductItemId || !order.product.finishedProductItem) {
      reasons.push("o produto não possui item de produto acabado válido");
    } else {
      if (!order.product.finishedProductItem.active) reasons.push("o item de produto acabado está inativo");
      if (order.product.finishedProductItem.type !== "FINISHED_PRODUCT") {
        reasons.push("o item de saída não é mais um produto acabado");
      }
    }
    if (!order.formulationVersion) {
      reasons.push("nenhuma formulação selecionada — escolha a versão ativa do produto");
    } else if (order.formulationVersion.status !== "ACTIVE") {
      reasons.push(
        `a formulação selecionada (V${order.formulationVersion.versionNumber}) não está mais ativa — atualize para a versão ativa atual`,
      );
    }
    if (order.plannedQuantity.lessThanOrEqualTo(0)) {
      reasons.push("a quantidade planejada deve ser maior que zero");
    }

    if (reasons.length > 0) {
      throw new PlanValidationError(`Não é possível planejar esta ordem: ${reasons.join("; ")}.`);
    }

    // Regenera uma ultima vez antes de congelar — seguranca contra qualquer
    // drift entre o ultimo save do DRAFT e o momento do planejamento.
    await regenerateRequirements(tx, id, order.formulationVersionId, order.plannedQuantity);

    const requirementCount = await tx.productionOrderRequirement.count({ where: { productionOrderId: id } });
    if (requirementCount === 0) {
      throw new PlanValidationError(
        "Não é possível planejar esta ordem: a formulação selecionada não tem nenhum componente.",
      );
    }

    await tx.productionOrder.update({
      where: { id },
      data: {
        status: "PLANNED",
        plannedAt: new Date(),
        plannedBy: SYSTEM_ACTOR,
        productCode: order.product.code,
        productName: order.product.name,
        finishedItemId: order.product.finishedProductItem!.id,
        finishedItemCode: order.product.finishedProductItem!.code,
        finishedItemName: order.product.finishedProductItem!.name,
        formulationVersionNumber: order.formulationVersion!.versionNumber,
        ...(order.product.customer
          ? {
              customerCode: order.product.customer.code,
              customerName: order.product.customer.legalName,
              customerCnpj: order.product.customer.cnpj,
            }
          : {}),
      },
    });
  });

  return (await getProductionOrderById(id))!;
}

/**
 * PLANNED -> RELEASED: valida disponibilidade ATUAL (recalculada, nunca a
 * sugestao antiga da UI), aloca FEFO/FIFO e reserva. Tudo ou nada — se
 * qualquer Requirement nao puder ser 100% atendido por estoque Available
 * real, a transacao inteira reverte (nenhuma reserva parcial). On Order
 * nunca satisfaz a exigencia. Nao exige RELEASED -> mais nada nesta
 * entrega (Picking/Consumo ficam para o proximo modulo).
 */
export async function releaseProductionOrder(id: string): Promise<ProductionOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM production_orders WHERE id = ${id} FOR UPDATE
    `;
    if (lockedRows.length === 0) throw new ProductionOrderNotFoundError(id);
    if (lockedRows[0]?.status !== "PLANNED") {
      throw new InvalidTransitionError("Somente ordens planejadas podem ser liberadas.");
    }

    const order = await tx.productionOrder.findUniqueOrThrow({
      where: { id },
      include: { requirements: { include: { item: true }, orderBy: { position: "asc" } } },
    });

    if (order.requirements.length === 0) {
      throw new ReleaseValidationError(
        "Não é possível liberar esta ordem: nenhuma necessidade de material calculada.",
      );
    }

    // Trava os Items envolvidos em ordem deterministica (id ascendente) —
    // serializa RELEASEs concorrentes que disputam o mesmo item e evita
    // deadlock entre travas cruzadas de duas OPs. Consultas de
    // disponibilidade fora de RELEASE (GET da OP, Visao Geral) nao
    // precisam desse lock — sao so leitura, snapshot da query.
    const itemIds = [...new Set(order.requirements.map((requirement) => requirement.itemId))].sort();
    await tx.$queryRaw`SELECT id FROM items WHERE id IN (${Prisma.join(itemIds)}) ORDER BY id FOR UPDATE`;

    const shortages: string[] = [];
    const linesToCreate: {
      requirementId: string;
      itemId: string;
      lotId: string | null;
      quantity: Prisma.Decimal;
    }[] = [];

    for (const requirement of order.requirements) {
      // Recalcula FEFO/FIFO agora, sob lock — nunca reutiliza a sugestao
      // antiga exibida na UI antes do RELEASE.
      const suggestion = await getAllocationSuggestion(
        tx,
        requirement.itemId,
        requirement.requiredQuantity.toString(),
      );

      if (new Prisma.Decimal(suggestion.shortageQuantity).greaterThan(0)) {
        shortages.push(
          `${requirement.itemCode} (falta ${suggestion.shortageQuantity} ${requirement.stockUnitCode})`,
        );
        continue;
      }

      if (requirement.item.controlsLot) {
        for (const allocation of suggestion.allocations) {
          linesToCreate.push({
            requirementId: requirement.id,
            itemId: requirement.itemId,
            lotId: allocation.lotId,
            quantity: new Prisma.Decimal(allocation.suggestedQuantity),
          });
        }
      } else {
        linesToCreate.push({
          requirementId: requirement.id,
          itemId: requirement.itemId,
          lotId: null,
          quantity: requirement.requiredQuantity,
        });
      }
    }

    if (shortages.length > 0) {
      throw new ReleaseValidationError(
        `Não é possível liberar: estoque disponível insuficiente para ${shortages.join(", ")}.`,
      );
    }

    const reservation = await tx.materialReservation.create({
      data: { productionOrderId: id, status: "ACTIVE", createdBy: SYSTEM_ACTOR },
    });
    await tx.materialReservationLine.createMany({
      data: linesToCreate.map((line) => ({
        reservationId: reservation.id,
        productionOrderRequirementId: line.requirementId,
        itemId: line.itemId,
        lotId: line.lotId,
        quantity: line.quantity,
      })),
    });

    await tx.productionOrder.update({
      where: { id },
      data: { status: "RELEASED", releasedAt: new Date(), releasedBy: SYSTEM_ACTOR },
    });
  });

  return (await getProductionOrderById(id))!;
}

export async function cancelProductionOrder(id: string, reason: string): Promise<ProductionOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    const current = await tx.productionOrder.findUnique({ where: { id } });
    if (!current) throw new ProductionOrderNotFoundError(id);
    if (current.status === "IN_PRODUCTION") {
      throw new InvalidTransitionError(
        "Ordem em produção não pode ser cancelada — já houve consumo real de material.",
      );
    }
    if (current.status !== "DRAFT" && current.status !== "PLANNED" && current.status !== "RELEASED") {
      throw new InvalidTransitionError(
        "Somente rascunhos, ordens planejadas ou liberadas podem ser canceladas.",
      );
    }

    if (current.status === "RELEASED") {
      // Libera a reserva na MESMA transacao — Reserved passa a considerar
      // so reservas ACTIVE, entao a disponibilidade volta automaticamente.
      // Nunca cria InventoryMovement: On Hand nunca mudou (fisicamente
      // nada aconteceu). Historico preservado — nunca deletada.
      await tx.materialReservation.updateMany({
        where: { productionOrderId: id, status: "ACTIVE" },
        data: {
          status: "RELEASED",
          releasedAt: new Date(),
          releasedBy: SYSTEM_ACTOR,
          releaseReason: reason,
        },
      });
    }

    await tx.productionOrder.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: SYSTEM_ACTOR,
        cancelReason: reason,
      },
    });
  });

  return (await getProductionOrderById(id))!;
}
