import { Prisma } from "@prisma/client";
import type {
  Customer,
  FormulationVersion,
  Item,
  Product,
  ProductionOrder,
  ProductionOrderRequirement,
} from "@prisma/client";
import type {
  ProductionOrderDTO,
  ProductionOrderListResponse,
  ProductionOrderMaterialsStatus,
  ProductionOrderRequirementDTO,
} from "@veridi/shared";
import { PRODUCTION_ORDER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { getAvailableByItems, getOnHandByItems, getOnOrderByItems } from "../../lib/inventory-ledger.js";
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
type POWithRelations = ProductionOrder & {
  product: ProductWithRelations;
  formulationVersion: FormulationVersion | null;
  requirements: RequirementWithItem[];
};

const productionOrderInclude = {
  product: { include: { customer: true, finishedProductItem: true } },
  formulationVersion: true,
  requirements: { include: { item: true }, orderBy: { position: "asc" as const } },
} as const;

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
): Promise<ProductionOrderRequirementDTO[]> {
  if (requirements.length === 0) return [];

  const prisma = getPrisma();
  const itemScopes = requirements.map((requirement) => ({
    id: requirement.itemId,
    controlsLot: requirement.item.controlsLot,
  }));
  const itemIds = itemScopes.map((scope) => scope.id);

  const [onHandByItem, availableByItem, onOrderByItem] = await Promise.all([
    getOnHandByItems(prisma, itemIds),
    getAvailableByItems(prisma, itemScopes),
    getOnOrderByItems(prisma, itemIds),
  ]);

  const results: ProductionOrderRequirementDTO[] = [];
  for (const requirement of requirements) {
    const onHand = onHandByItem.get(requirement.itemId) ?? new Prisma.Decimal(0);
    const available = availableByItem.get(requirement.itemId) ?? new Prisma.Decimal(0);
    const onOrder = onOrderByItem.get(requirement.itemId) ?? new Prisma.Decimal(0);
    const shortage = Prisma.Decimal.max(requirement.requiredQuantity.minus(available), 0);

    // On Order e so informativo — nunca reduz o shortage operacional.
    const suggestion = await getAllocationSuggestion(
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
      reserved: "0",
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
    });
  }
  return results;
}

async function toProductionOrderDTO(order: POWithRelations): Promise<ProductionOrderDTO> {
  const requirements = await attachRequirementAvailability(order.requirements);
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

export async function cancelProductionOrder(id: string, reason: string): Promise<ProductionOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    const current = await tx.productionOrder.findUnique({ where: { id } });
    if (!current) throw new ProductionOrderNotFoundError(id);
    if (current.status !== "DRAFT" && current.status !== "PLANNED") {
      throw new InvalidTransitionError("Somente rascunhos ou ordens planejadas podem ser canceladas.");
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
