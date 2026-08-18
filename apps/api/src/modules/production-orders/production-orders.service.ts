import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  ControlledDocumentRevision,
  Customer,
  CustomerOrder,
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
import { assertProductOperational } from "../../lib/product-lifecycle.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { computeRequirementAvailability } from "../../lib/requirement-availability.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { getConsumedByReservationLines, isLotExpired } from "../../lib/inventory-ledger.js";
import type { InventoryOwnerScope } from "../../lib/inventory-ledger.js";
import { getAllocationSuggestion } from "../inventory/allocation.service.js";
import { findCompatibleCostVersion } from "../industrial-cost-calculation/production-cost.service.js";
import { nextOfficialNumber } from "../../lib/production-order-number.js";
import { suggestBusinessLotNumber } from "../../lib/business-lot.js";
import { toControlledDocumentRevisionDTO } from "../controlled-documents/controlled-documents.service.js";
import { getActiveRevision } from "../controlled-documents/controlled-documents.service.js";
import { computeFormulationRequirements } from "./requirement-calc.js";
import {
  CustomerMismatchError,
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
  customer: Customer | null;
  productionOrderRevision: ControlledDocumentRevision | null;
  recipeSheetRevision: ControlledDocumentRevision | null;
  product: ProductWithRelations;
  formulationVersion: FormulationVersion | null;
  requirements: RequirementWithItem[];
  reservation: ReservationWithLines | null;
  consumptions: ConsumptionWithRelations[];
  outputs: OutputWithRelations[];
  finishedItem: Item | null;
  customerOrder: CustomerOrder | null;
};

const productionOrderInclude = {
  customer: true,
  productionOrderRevision: true,
  recipeSheetRevision: true,
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
  customerOrder: true,
} as const;

/**
 * Escopo de estoque elegivel para uma necessidade da OP. `VERIDI` so
 * enxerga estoque proprio; `CUSTOMER` so enxerga o estoque do cliente
 * DESTA OP — nunca de outro cliente, nunca da Veridi. Sem cliente definido
 * uma necessidade CUSTOMER nao tem escopo: fica sem cobertura possivel
 * (e o RELEASE e bloqueado com mensagem propria).
 */
export function requirementOwnerScope(
  supplyResponsibility: "VERIDI" | "CUSTOMER",
  orderCustomerId: string | null,
): InventoryOwnerScope | null {
  if (supplyResponsibility === "VERIDI") return { ownerType: "VERIDI" };
  return orderCustomerId ? { ownerType: "CUSTOMER", customerId: orderCustomerId } : null;
}

/**
 * Cliente da OP: vem do Pedido quando a OP nasceu de um, senao do Produto.
 * Se os dois existirem e forem diferentes, e inconsistencia real — nunca
 * se escolhe um silenciosamente.
 */
async function resolveOrderCustomerId(
  tx: Prisma.TransactionClient,
  productCustomerId: string | null,
  customerOrderId: string | null,
): Promise<string | null> {
  if (!customerOrderId) return productCustomerId;

  const customerOrder = await tx.customerOrder.findUnique({
    where: { id: customerOrderId },
    include: { customer: true },
  });
  if (!customerOrder) return productCustomerId;

  if (productCustomerId && productCustomerId !== customerOrder.customerId) {
    const productCustomer = await tx.customer.findUnique({ where: { id: productCustomerId } });
    throw new CustomerMismatchError(
      productCustomer?.legalName ?? productCustomerId,
      customerOrder.customer.legalName,
    );
  }
  return customerOrder.customerId;
}

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
  // Amostra de desenvolvimento tem domínio próprio (capacidade 39); OP
  // comercial exige produto aprovado.
  assertProductOperational(product, id);
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

  const rows = await computeFormulationRequirements(tx, formulationVersionId, plannedQuantity);
  if (rows.length === 0) return;

  await tx.productionOrderRequirement.createMany({
    data: rows.map((row) => ({
      productionOrderId,
      itemId: row.itemId,
      itemCode: row.itemCode,
      itemName: row.itemName,
      itemType: row.itemType,
      formulaQuantity: row.formulaQuantity,
      formulaUnitCode: row.formulaUnitCode,
      // Congela de quem o material deve vir: depois disso a OP nunca mais
      // consulta a formulacao atual para decidir isso.
      supplyResponsibility: row.supplyResponsibility,
      // Congela tambem o teorico e os fatores aplicados: a OP guarda o
      // "porque" do peso, nao so o numero final.
      theoreticalQuantity: row.theoreticalQuantity,
      purityPercentApplied: row.purityPercentApplied,
      overagePercent: row.overagePercent,
      requiredQuantity: row.requiredQuantity,
      stockUnitCode: row.stockUnitCode,
      position: row.position,
    })),
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
  /** Consumo registrado por item — vale quando a reserva já foi liberada. */
  consumidoPorItem: Map<string, Prisma.Decimal>,
  orderCustomer: { id: string; name: string } | null,
): Promise<ProductionOrderRequirementDTO[]> {
  if (requirements.length === 0) return [];

  const prisma = getPrisma();
  const scopeOf = (requirement: RequirementWithItem): InventoryOwnerScope | null =>
    requirementOwnerScope(requirement.supplyResponsibility, orderCustomer?.id ?? null);

  // Mesma matematica de disponibilidade/falta usada pelos relatorios —
  // calculo unico, nunca uma segunda interpretacao de shortage.
  const availabilityByRequirement = await computeRequirementAvailability(
    prisma,
    requirements.map((requirement) => ({
      requirementId: requirement.id,
      itemId: requirement.itemId,
      controlsLot: requirement.item.controlsLot,
      requiredQuantity: requirement.requiredQuantity,
      // Material do cliente sem cliente definido: nenhum estoque e
      // elegivel, entao a falta e a necessidade inteira — nunca o estoque
      // da Veridi cobrindo por engano.
      ownerScope: scopeOf(requirement),
      activeReservationLines: (reservationLinesByRequirement.get(requirement.id) ?? [])
        .filter((line) => line.releasedAt === null)
        .map((line) => ({ id: line.id, quantity: line.quantity })),
    })),
    consumedByLine,
  );

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
    const availability = availabilityByRequirement.get(requirement.id)!;
    const { onHand, reserved, available, onOrder, shortage } = availability;
    const remainingReservedQuantity = availability.remainingReserved;

    // On Order e so informativo — nunca reduz o shortage operacional.
    const scope = scopeOf(requirement);
    const suggestion = scope
      ? await getAllocationSuggestion(
          prisma,
          requirement.itemId,
          requirement.requiredQuantity.toString(),
          scope,
        )
      : null;

    results.push({
      id: requirement.id,
      itemId: requirement.itemId,
      itemCode: requirement.itemCode,
      itemName: requirement.itemName,
      itemType: requirement.itemType,
      formulaQuantity: requirement.formulaQuantity.toString(),
      formulaUnitCode: requirement.formulaUnitCode,
      supplyResponsibility: requirement.supplyResponsibility,
      eligibleOwnerType: requirement.supplyResponsibility === "CUSTOMER" ? "CUSTOMER" : "VERIDI",
      eligibleOwnerCustomerId:
        requirement.supplyResponsibility === "CUSTOMER" ? (orderCustomer?.id ?? null) : null,
      eligibleOwnerCustomerName:
        requirement.supplyResponsibility === "CUSTOMER" ? (orderCustomer?.name ?? null) : null,
      requiredQuantity: requirement.requiredQuantity.toString(),
      stockUnitCode: requirement.stockUnitCode,
      position: requirement.position,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      onOrder: onOrder.toString(),
      shortage: shortage.toString(),
      availabilityStatus: shortage.greaterThan(0) ? "SHORTAGE" : "AVAILABLE",
      suggestedAllocations: (suggestion?.allocations ?? []).map((allocation) => ({
        lotId: allocation.lotId,
        lotCode: allocation.lotCode,
        expiryDate: allocation.expiryDate,
        location: allocation.location,
        suggestedQuantity: allocation.suggestedQuantity,
      })),
      allocatedQuantity: allocatedQuantity.toString(),
      // Reserva ativa: o consumo desta OP para este item. Reserva liberada
      // (ordem encerrada): o consumo registrado, que continua valendo.
      consumedQuantity: (linesForRequirement.length > 0
        ? lineConsumedQuantity
        : (consumidoPorItem.get(requirement.itemId) ?? new Prisma.Decimal(0))
      ).toString(),
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

  // Cliente da OP: snapshot proprio quando existir, senao o cliente atual
  // do Produto (DRAFT ainda le ao vivo, como o resto do documento).
  const orderCustomer = order.customer
    ? { id: order.customer.id, name: order.customer.legalName }
    : order.product.customer
      ? { id: order.product.customer.id, name: order.product.customer.legalName }
      : null;

  /*
   * O que foi CONSUMIDO é história e não depende de a reserva continuar ativa.
   *
   * Concluir a OP libera a reserva; lendo o consumo só pelas linhas de
   * reserva ativas, toda ordem concluída passava a declarar consumo zero em
   * todos os materiais — inclusive a que consumiu tudo. O ledger de
   * `ProductionConsumption` é a fonte, e ele não é apagado.
   */
  const consumidoPorItem = new Map<string, Prisma.Decimal>();
  for (const consumption of order.consumptions) {
    const atual = consumidoPorItem.get(consumption.itemId) ?? new Prisma.Decimal(0);
    consumidoPorItem.set(consumption.itemId, atual.plus(consumption.quantity));
  }

  const requirements = await attachRequirementAvailability(
    order.requirements,
    reservationLinesByRequirement,
    consumedByLine,
    consumidoPorItem,
    orderCustomer,
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
    customerId: order.customerId ?? orderCustomer?.id ?? null,
    hasCustomerSuppliedRequirements: order.requirements.some(
      (requirement) => requirement.supplyResponsibility === "CUSTOMER",
    ),
    // Antes do RELEASE não há snapshot: vale o cadastro atual. A ordem
    // própria vem primeiro porque uma OP nascida de pedido já sabe para quem
    // produz mesmo quando o Produto não tem cliente amarrado — sem isso a
    // lista mostra "—" no cliente de uma ordem que existe justamente por ele.
    customerCode: usingSnapshot
      ? order.customerCode
      : (order.customer?.code ?? order.product.customer?.code ?? null),
    customerName: usingSnapshot
      ? order.customerName
      : (order.customer?.legalName ?? order.product.customer?.legalName ?? null),
    customerCnpj: usingSnapshot
      ? order.customerCnpj
      : (order.customer?.cnpj ?? order.product.customer?.cnpj ?? null),
    // Endereço: snapshot congelado quando existir; antes do RELEASE, o
    // cadastro atual (o documento oficial ainda não foi emitido).
    customerTradeName: order.customerTradeName ?? order.product.customer?.tradeName ?? null,
    customerZipCode: order.customerZipCode ?? order.product.customer?.zipCode ?? null,
    customerStreet: order.customerStreet ?? order.product.customer?.street ?? null,
    customerNumber: order.customerNumber ?? order.product.customer?.number ?? null,
    customerComplement: order.customerComplement ?? order.product.customer?.complement ?? null,
    customerDistrict: order.customerDistrict ?? order.product.customer?.district ?? null,
    customerCity: order.customerCity ?? order.product.customer?.city ?? null,
    customerState: order.customerState ?? order.product.customer?.state ?? null,
    officialNumber: order.officialNumber,
    numberOfParts: order.numberOfParts,
    labelInstructions: order.labelInstructions,
    shelfLifeMonths: order.product.shelfLifeMonths,
    // Sugestão de lote comercial — nunca obrigatória, nunca substitui o
    // código interno do lote.
    suggestedBusinessLotNumber: suggestBusinessLotNumber({
      producedAt: new Date(),
      productBusinessLotCode: order.product.businessLotCode,
      customerBusinessLotSuffix: orderCustomer ? (order.customer?.businessLotSuffix ?? order.product.customer?.businessLotSuffix ?? null) : null,
    }),
    productionOrderRevision: order.productionOrderRevision
      ? toControlledDocumentRevisionDTO(order.productionOrderRevision)
      : null,
    recipeSheetRevision: order.recipeSheetRevision
      ? toControlledDocumentRevisionDTO(order.recipeSheetRevision)
      : null,
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
    customerOrderId: order.customerOrderId,
    customerOrderCode: order.customerOrder ? order.customerOrder.code : null,
    customerOrderLineId: order.customerOrderLineId,
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
  pagination: Pagination = query,
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
      ...pageArgs(pagination),
    }),
    prisma.productionOrder.count({ where }),
  ]);

  return {
    productionOrders: await Promise.all(orders.map(toProductionOrderDTO)),
    ...pageMeta(pagination, total),
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
  actor?: { id: string; name: string },
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
        // OP manual herda o cliente do Produto. Mudar Product.customerId
        // depois nunca reescreve esta OP.
        ...(product.customerId ? { customerId: product.customerId } : {}),
        ...(input.numberOfParts !== undefined ? { numberOfParts: input.numberOfParts } : {}),
        ...(input.labelInstructions !== undefined
          ? { labelInstructions: input.labelInstructions }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdBy: actor?.name ?? SYSTEM_ACTOR,
      },
    });

    await regenerateRequirements(tx, created.id, formulationVersion?.id ?? null, plannedQuantity);
    return created.id;
  });

  return (await getProductionOrderById(orderId))!;
}

/**
 * Cria uma OP DRAFT dentro de uma transacao ja aberta (usado pelo Plano de
 * Atendimento — a OP e um dos efeitos colaterais atomicos de aplicar o
 * Plano). Nunca PLAN/RELEASE automatico — a OP nasce DRAFT e segue o fluxo
 * normal, mesmo comportamento de `createProductionOrder`. `code` ja deve
 * ter sido gerado (sequence) antes de entrar na transacao.
 */
export async function createDraftProductionOrderInTx(
  tx: Prisma.TransactionClient,
  params: {
    code: string;
    productId: string;
    outputUnitCode: string;
    formulationVersionId: string | null;
    plannedQuantity: Prisma.Decimal;
    customerOrderId: string;
    customerOrderLineId: string;
    /** Quem aplicou o plano de atendimento — a OP não nasce de ninguém. */
    createdBy?: string;
  },
): Promise<string> {
  const product = await tx.product.findUniqueOrThrow({ where: { id: params.productId } });
  const customerId = await resolveOrderCustomerId(tx, product.customerId, params.customerOrderId);

  const created = await tx.productionOrder.create({
    data: {
      code: params.code,
      productId: params.productId,
      formulationVersionId: params.formulationVersionId,
      plannedQuantity: params.plannedQuantity,
      outputUnitCode: params.outputUnitCode,
      origin: "CUSTOMER_ORDER",
      customerOrderId: params.customerOrderId,
      customerOrderLineId: params.customerOrderLineId,
      ...(customerId ? { customerId } : {}),
      createdBy: params.createdBy ?? SYSTEM_ACTOR,
    },
  });
  await regenerateRequirements(tx, created.id, params.formulationVersionId, params.plannedQuantity);
  return created.id;
}

export async function updateProductionOrder(
  id: string,
  input: UpdateProductionOrderInput,
): Promise<ProductionOrderDTO> {
  const current = await requireOrder(id);

  if (current.status === "CANCELLED") {
    throw new OrderLockedError("Ordem de produção cancelada é somente leitura.");
  }

  // numberOfParts e instruções de rótulo congelam no RELEASE: folha de
  // receita, partes geradas e documento impresso dependem deles.
  const touchesStructural =
    input.productId !== undefined ||
    input.formulationVersionId !== undefined ||
    input.plannedQuantity !== undefined ||
    input.numberOfParts !== undefined ||
    input.labelInstructions !== undefined;

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
        ...(productChanging
          ? {
              productId: effectiveProduct.id,
              // Trocar de produto troca o dono do material esperado —
              // manter o cliente antigo seria abrir mao de estoque errado.
              customerId: await resolveOrderCustomerId(
                tx,
                effectiveProduct.customerId,
                current.customerOrderId,
              ),
            }
          : {}),
        ...(regenerate
          ? {
              formulationVersionId: formulationVersion?.id ?? null,
              outputUnitCode: effectiveProduct.finishedProductItem!.unitCode,
            }
          : {}),
        ...(input.plannedQuantity !== undefined ? { plannedQuantity } : {}),
        ...(input.numberOfParts !== undefined ? { numberOfParts: input.numberOfParts } : {}),
        ...(input.labelInstructions !== undefined
          ? { labelInstructions: input.labelInstructions }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (regenerate) {
      await regenerateRequirements(tx, id, formulationVersion?.id ?? null, plannedQuantity);
    }
  });

  return (await getProductionOrderById(id))!;
}

export async function planProductionOrder(
  id: string,
  actor?: { id: string; name: string },
): Promise<ProductionOrderDTO> {
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

    const plannedCustomerId =
      order.customerId ??
      (await resolveOrderCustomerId(tx, order.product.customerId, order.customerOrderId));
    const plannedCustomer = plannedCustomerId
      ? await tx.customer.findUnique({ where: { id: plannedCustomerId } })
      : null;

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
        plannedBy: actor?.name ?? SYSTEM_ACTOR,
        productCode: order.product.code,
        productName: order.product.name,
        finishedItemId: order.product.finishedProductItem!.id,
        finishedItemCode: order.product.finishedProductItem!.code,
        finishedItemName: order.product.finishedProductItem!.name,
        formulationVersionNumber: order.formulationVersion!.versionNumber,
        // Cliente congelado junto com o resto do snapshot — a OP nunca
        // volta a perguntar ao Produto de quem ela e.
        ...(plannedCustomerId ? { customerId: plannedCustomerId } : {}),
        ...(plannedCustomer
          ? {
              customerCode: plannedCustomer.code,
              customerName: plannedCustomer.legalName,
              customerCnpj: plannedCustomer.cnpj,
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
export async function releaseProductionOrder(
  id: string,
  /** Usuário da sessão — o RELEASE é ação auditada. */
  actor?: { id: string; name: string },
): Promise<ProductionOrderDTO> {
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

    // Material do cliente exige saber INEQUIVOCAMENTE de qual cliente esta
    // OP e — sem isso nao existe estoque elegivel, e liberar seria operar
    // no escuro.
    const hasCustomerSupplied = order.requirements.some(
      (requirement) => requirement.supplyResponsibility === "CUSTOMER",
    );
    if (hasCustomerSupplied && !order.customerId) {
      throw new ReleaseValidationError(
        "Esta OP possui materiais fornecidos pelo cliente, mas não possui cliente definido.",
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
      // Dono e criterio de elegibilidade: necessidade da Veridi so olha
      // lote proprio, necessidade do cliente so olha lote DESTE cliente.
      const scope = requirementOwnerScope(requirement.supplyResponsibility, order.customerId);
      const suggestion = await getAllocationSuggestion(
        tx,
        requirement.itemId,
        requirement.requiredQuantity.toString(),
        scope ?? { ownerType: "VERIDI" },
      );

      if (new Prisma.Decimal(suggestion.shortageQuantity).greaterThan(0)) {
        const missing =
          requirement.supplyResponsibility === "CUSTOMER"
            ? `${requirement.itemCode} (aguardando material do cliente: ${suggestion.shortageQuantity} ${requirement.stockUnitCode})`
            : `${requirement.itemCode} (falta ${suggestion.shortageQuantity} ${requirement.stockUnitCode})`;
        shortages.push(missing);
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

    const releasedAt = new Date();

    // Estrutura de custos congelada aqui: precisa ser ACTIVE e apontar para
    // a MESMA formulação que esta OP executa. Vincular a EC de outra receita
    // atribuiria à produção premissas que não são dela — sem compatível, a
    // OP segue normalmente e o custo industrial fica material-only.
    const costVersion = await findCompatibleCostVersion(tx, {
      productId: order.productId,
      formulationVersionId: order.formulationVersionId,
    });

    // Numeração OFICIAL do documento — só agora, na primeira liberação:
    // rascunho descartado nunca gasta numeração. Concurrency-safe (linha do
    // ano travada dentro desta transação).
    const official = await nextOfficialNumber(tx, releasedAt);

    // Congela as revisões dos documentos controlados vigentes: mudar a
    // revisão ativa depois nunca reescreve esta OP.
    const [productionOrderRevision, recipeSheetRevision] = await Promise.all([
      getActiveRevision("PRODUCTION_ORDER", tx),
      getActiveRevision("RECIPE_SHEET", tx),
    ]);

    // Snapshot do cliente para o documento impresso — endereço incluído.
    const customer = order.customerId
      ? await tx.customer.findUnique({ where: { id: order.customerId } })
      : null;

    const reservation = await tx.materialReservation.create({
      data: { productionOrderId: id, status: "ACTIVE", createdBy: actor?.name ?? SYSTEM_ACTOR },
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

    // Partes/frações da execução nascem aqui, a partir de numberOfParts.
    await tx.productionOrderPart.createMany({
      data: Array.from({ length: order.numberOfParts }, (_, index) => ({
        productionOrderId: id,
        partNumber: index + 1,
        status: "PENDING" as const,
      })),
    });

    await tx.productionOrder.update({
      where: { id },
      data: {
        status: "RELEASED",
        releasedAt,
        releasedBy: actor?.name ?? SYSTEM_ACTOR,
        ...(costVersion ? { industrialCostVersionId: costVersion.id } : {}),
        officialNumber: official.value,
        officialNumberYear: official.year,
        officialNumberSequence: official.sequence,
        ...(productionOrderRevision
          ? { productionOrderRevisionId: productionOrderRevision.id }
          : {}),
        ...(recipeSheetRevision ? { recipeSheetRevisionId: recipeSheetRevision.id } : {}),
        ...(customer
          ? {
              customerCode: customer.code,
              customerName: customer.legalName,
              customerCnpj: customer.cnpj,
              customerTradeName: customer.tradeName,
              customerZipCode: customer.zipCode,
              customerStreet: customer.street,
              customerNumber: customer.number,
              customerComplement: customer.complement,
              customerDistrict: customer.district,
              customerCity: customer.city,
              customerState: customer.state,
            }
          : {}),
      },
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
