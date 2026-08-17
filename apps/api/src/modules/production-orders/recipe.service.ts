import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  RecipeSheetDTO,
  RecipeSheetPartDTO,
  RecipeSheetRequirementDTO,
  RecipeWeighingDTO,
} from "@veridi/shared";
import { normalizeLotLookupCode } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { toControlledDocumentRevisionDTO } from "../controlled-documents/controlled-documents.service.js";
import { isLotAvailableForUse } from "../../lib/inventory-ledger.js";
import { partShare } from "../../lib/part-split.js";
import {
  AlternateLotOwnerMismatchError,
  ConsumptionLotNotEligibleError,
  LotNotFoundByCodeError,
  ProductionOrderNotReleasedError,
  ReservationLineNotFoundError,
} from "./picking.errors.js";
import { recordConsumptionInTx } from "./picking.service.js";
import { ProductionOrderNotFoundError } from "./production-orders.errors.js";
import { requirementOwnerScope } from "./production-orders.service.js";
import {
  PartAlreadyCompletedError,
  PartNotFoundError,
  RequirementNotWeighableError,
  UnweighedRequirementError,
  WeighingNotFoundError,
} from "./recipe.errors.js";
import type { RegisterWeighingInput } from "./recipe.schemas.js";

/**
 * Folha de Receita (R.COQ.003) — execução da produção por parte/fração.
 *
 * Papéis, deliberadamente separados:
 * - a Folha de Receita é a ORIGEM e a auditoria da execução (quem pesou,
 *   quanto, de qual lote, quando);
 * - o ledger continua sendo a única fonte quantitativa: a baixa é sempre
 *   `ProductionConsumption` -> `InventoryMovement`, reutilizando o mesmo
 *   serviço do consumo direto. Nenhum movimento paralelo é criado aqui.
 */

const recipeInclude = {
  product: true,
  customer: true,
  requirements: { include: { item: true }, orderBy: { position: "asc" as const } },
  parts: {
    orderBy: { partNumber: "asc" as const },
    include: {
      weighings: {
        orderBy: { executedAt: "asc" as const },
        include: { lot: true, productionOrderRequirement: true },
      },
    },
  },
  reservation: { include: { lines: { include: { lot: true } } } },
  productionOrderRevision: true,
  recipeSheetRevision: true,
} as const;

type OrderWithRecipe = PrismaTypes.ProductionOrderGetPayload<{ include: typeof recipeInclude }>;

function toWeighingDTO(
  weighing: OrderWithRecipe["parts"][number]["weighings"][number],
): RecipeWeighingDTO {
  return {
    id: weighing.id,
    productionOrderPartId: weighing.productionOrderPartId,
    productionOrderRequirementId: weighing.productionOrderRequirementId,
    itemId: weighing.productionOrderRequirement.itemId,
    itemCode: weighing.productionOrderRequirement.itemCode,
    itemName: weighing.productionOrderRequirement.itemName,
    lotId: weighing.lotId,
    lotCode: weighing.lot ? weighing.lot.code : null,
    supplierLot: weighing.lot ? weighing.lot.supplierLot : null,
    ownerType: weighing.lot ? weighing.lot.ownerType : "VERIDI",
    plannedQuantity: weighing.plannedQuantitySnapshot.toString(),
    actualQuantity: weighing.actualQuantity.toString(),
    uomCode: weighing.uomCode,
    executedByUserId: weighing.executedByUserId,
    executedByName: weighing.executedByNameSnapshot,
    executedAt: weighing.executedAt.toISOString(),
    productionConsumptionId: weighing.productionConsumptionId,
    notes: weighing.notes,
  };
}

async function requireOrder(id: string): Promise<OrderWithRecipe> {
  const order = await getPrisma().productionOrder.findUnique({
    where: { id },
    include: recipeInclude,
  });
  if (!order) throw new ProductionOrderNotFoundError(id);
  return order;
}

/**
 * Read model da Folha de Receita. Só matérias-primas são pesadas por
 * fração: embalagem continua no fluxo de Picking/Consumo, com a quantidade
 * total da OP — dividir "1/3 de pote" não existe no chão de fábrica.
 */
export async function getRecipeSheet(id: string): Promise<RecipeSheetDTO> {
  const order = await requireOrder(id);

  const rawMaterials = order.requirements.filter(
    (requirement) => requirement.itemType === "RAW_MATERIAL",
  );
  const packaging = order.requirements.filter(
    (requirement) => requirement.itemType !== "RAW_MATERIAL",
  );

  const parts: RecipeSheetPartDTO[] = order.parts.map((part) => {
    const weighings = part.weighings.map(toWeighingDTO);

    const requirements: RecipeSheetRequirementDTO[] = rawMaterials.map((requirement) => {
      const planned = partShare(
        requirement.requiredQuantity,
        order.numberOfParts,
        part.partNumber,
      );
      const weighed = part.weighings
        .filter((weighing) => weighing.productionOrderRequirementId === requirement.id)
        .reduce((sum, weighing) => sum.plus(weighing.actualQuantity), new Prisma.Decimal(0));

      const reservedLots = (order.reservation?.lines ?? [])
        .filter((line) => line.productionOrderRequirementId === requirement.id && line.releasedAt === null)
        .map((line) => ({
          lotId: line.lotId,
          lotCode: line.lot ? line.lot.code : null,
          quantity: line.quantity.toString(),
        }));

      return {
        requirementId: requirement.id,
        itemId: requirement.itemId,
        itemCode: requirement.itemCode,
        itemName: requirement.itemName,
        sourceName: requirement.item.sourceName,
        declaredNutrient: requirement.item.declaredNutrient,
        supplyResponsibility: requirement.supplyResponsibility,
        expectedOwnerCustomerName:
          requirement.supplyResponsibility === "CUSTOMER"
            ? (order.customer?.legalName ?? order.customerName ?? null)
            : null,
        plannedQuantity: planned.toString(),
        weighedQuantity: weighed.toString(),
        // Diferença é REGISTRADA, nunca escondida e nunca bloqueada por uma
        // tolerância inventada — regra de tolerância virá da Qualidade.
        differenceQuantity: weighed.minus(planned).toString(),
        unitCode: requirement.stockUnitCode,
        reservedLots,
      };
    });

    return {
      id: part.id,
      partNumber: part.partNumber,
      status: part.status,
      startedAt: part.startedAt ? part.startedAt.toISOString() : null,
      startedByName: part.startedByNameSnapshot,
      completedAt: part.completedAt ? part.completedAt.toISOString() : null,
      completedByName: part.completedByNameSnapshot,
      requirements,
      weighings,
    };
  });

  return {
    productionOrderId: order.id,
    recipeSheetRevision: order.recipeSheetRevision
      ? toControlledDocumentRevisionDTO(order.recipeSheetRevision)
      : null,
    productionOrderCode: order.code,
    officialNumber: order.officialNumber,
    productId: order.productId,
    productCode: order.productCode ?? order.product.code,
    productName: order.productName ?? order.product.name,
    customerName: order.customerName ?? order.customer?.legalName ?? null,
    formulationVersionLabel: order.formulationVersionNumber
      ? `V${order.formulationVersionNumber}`
      : null,
    plannedQuantity: order.plannedQuantity.toString(),
    outputUnitCode: order.outputUnitCode,
    numberOfParts: order.numberOfParts,
    status: order.status,
    parts,
    packagingRequirements: packaging.map((requirement) => ({
      requirementId: requirement.id,
      itemId: requirement.itemId,
      itemCode: requirement.itemCode,
      itemName: requirement.itemName,
      supplyResponsibility: requirement.supplyResponsibility,
      totalQuantity: requirement.requiredQuantity.toString(),
      unitCode: requirement.stockUnitCode,
    })),
  };
}

/**
 * Registra uma pesagem real e confirma o consumo correspondente na MESMA
 * transação. O usuário vem sempre da sessão — o frontend nunca escolhe
 * quem executou.
 */
export async function registerWeighing(
  productionOrderId: string,
  partNumber: number,
  input: RegisterWeighingInput,
  actor: User,
): Promise<RecipeSheetDTO> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM production_orders WHERE id = ${productionOrderId} FOR UPDATE
    `;
    if (rows.length === 0) throw new ProductionOrderNotFoundError(productionOrderId);
    const status = rows[0]!.status;
    if (status !== "RELEASED" && status !== "IN_PRODUCTION") {
      throw new ProductionOrderNotReleasedError();
    }

    const order = await tx.productionOrder.findUniqueOrThrow({ where: { id: productionOrderId } });
    const part = await tx.productionOrderPart.findFirst({
      where: { productionOrderId, partNumber },
    });
    if (!part) throw new PartNotFoundError(partNumber);
    if (part.status === "COMPLETED") throw new PartAlreadyCompletedError(partNumber);

    const requirement = await tx.productionOrderRequirement.findFirst({
      where: { id: input.requirementId, productionOrderId },
      include: { item: true },
    });
    if (!requirement) throw new ReservationLineNotFoundError(input.requirementId);
    // Embalagem não é pesada por fração — continua no Picking/Consumo.
    if (requirement.itemType !== "RAW_MATERIAL") {
      throw new RequirementNotWeighableError(requirement.itemCode);
    }

    const normalized = normalizeLotLookupCode(input.lotCode);
    const lot = await tx.lot.findUnique({ where: { code: normalized } });
    if (!lot) throw new LotNotFoundByCodeError(input.lotCode);
    if (lot.itemId !== requirement.itemId) {
      throw new ReservationLineNotFoundError(input.requirementId);
    }
    // Qualidade e validade: mesma regra do consumo, sem segunda interpretação.
    if (!isLotAvailableForUse(lot)) throw new ConsumptionLotNotEligibleError(lot.code);

    // Propriedade: material do cliente A nunca abastece a OP do cliente B.
    const scope = requirementOwnerScope(requirement.supplyResponsibility, order.customerId);
    const ownerMatches =
      scope !== null &&
      (scope.ownerType === "VERIDI"
        ? lot.ownerType === "VERIDI"
        : lot.ownerType === "CUSTOMER" && lot.ownerCustomerId === scope.customerId);
    if (!ownerMatches) {
      throw new AlternateLotOwnerMismatchError(
        lot.code,
        requirement.supplyResponsibility === "CUSTOMER" ? "cliente desta OP" : "Veridi",
      );
    }

    const line = await tx.materialReservationLine.findFirst({
      where: {
        productionOrderRequirementId: requirement.id,
        lotId: lot.id,
        releasedAt: null,
        reservation: { productionOrderId, status: "ACTIVE" },
      },
    });
    if (!line) throw new ReservationLineNotFoundError(`${requirement.itemCode} / ${lot.code}`);

    // Escanear o lote na pesagem É a conferência física da linha.
    if (line.pickedAt === null) {
      await tx.materialReservationLine.update({
        where: { id: line.id },
        data: { pickedAt: new Date(), pickedBy: actor.name },
      });
    }

    const planned = partShare(requirement.requiredQuantity, order.numberOfParts, partNumber);

    const weighing = await tx.recipeWeighing.create({
      data: {
        productionOrderPartId: part.id,
        productionOrderRequirementId: requirement.id,
        materialReservationLineId: line.id,
        lotId: lot.id,
        plannedQuantitySnapshot: planned,
        actualQuantity: input.actualQuantity,
        uomCode: requirement.stockUnitCode,
        // Quem executou vem da SESSÃO — nunca de campo enviado pelo cliente.
        executedByUserId: actor.id,
        executedByNameSnapshot: actor.name,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    const [consumptionId] = await recordConsumptionInTx(
      tx,
      productionOrderId,
      [{ reservationLineId: line.id, quantity: input.actualQuantity }],
      { id: actor.id, name: actor.name },
    );
    await tx.recipeWeighing.update({
      where: { id: weighing.id },
      data: { productionConsumptionId: consumptionId ?? null },
    });

    if (part.status === "PENDING") {
      await tx.productionOrderPart.update({
        where: { id: part.id },
        data: {
          status: "IN_PROGRESS",
          startedAt: new Date(),
          startedByUserId: actor.id,
          startedByNameSnapshot: actor.name,
        },
      });
    }
  });

  return getRecipeSheet(productionOrderId);
}

/**
 * Confirmação idempotente: uma pesagem já ligada a um consumo nunca gera um
 * segundo. Existe para o caso de a UI reenviar a confirmação.
 */
export async function confirmWeighing(
  productionOrderId: string,
  weighingId: string,
  actor: User,
): Promise<RecipeSheetDTO> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const weighing = await tx.recipeWeighing.findUnique({
      where: { id: weighingId },
      include: { productionOrderPart: true },
    });
    if (!weighing || weighing.productionOrderPart.productionOrderId !== productionOrderId) {
      throw new WeighingNotFoundError(weighingId);
    }
    // Já confirmada: nada acontece. Nunca uma segunda baixa de estoque.
    if (weighing.productionConsumptionId) return;
    if (!weighing.materialReservationLineId) throw new WeighingNotFoundError(weighingId);

    const [consumptionId] = await recordConsumptionInTx(
      tx,
      productionOrderId,
      [
        {
          reservationLineId: weighing.materialReservationLineId,
          quantity: weighing.actualQuantity.toString(),
        },
      ],
      { id: actor.id, name: actor.name },
    );
    await tx.recipeWeighing.update({
      where: { id: weighing.id },
      data: { productionConsumptionId: consumptionId ?? null },
    });
  });

  return getRecipeSheet(productionOrderId);
}

/**
 * Conclui uma parte. Bloqueia quando existe matéria-prima planejada sem
 * nenhuma pesagem — mas nunca exige igualdade exata com o planejado: a
 * diferença real é registrada, não corrigida.
 */
export async function completePart(
  productionOrderId: string,
  partNumber: number,
  actor: User,
): Promise<RecipeSheetDTO> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM production_orders WHERE id = ${productionOrderId} FOR UPDATE
    `;
    if (rows.length === 0) throw new ProductionOrderNotFoundError(productionOrderId);
    const status = rows[0]!.status;
    if (status !== "RELEASED" && status !== "IN_PRODUCTION") {
      throw new ProductionOrderNotReleasedError();
    }

    const order = await tx.productionOrder.findUniqueOrThrow({ where: { id: productionOrderId } });
    const part = await tx.productionOrderPart.findFirst({
      where: { productionOrderId, partNumber },
      include: { weighings: true },
    });
    if (!part) throw new PartNotFoundError(partNumber);
    if (part.status === "COMPLETED") throw new PartAlreadyCompletedError(partNumber);

    const requirements = await tx.productionOrderRequirement.findMany({
      where: { productionOrderId, itemType: "RAW_MATERIAL" },
    });

    const missing = requirements.filter((requirement) => {
      const planned = partShare(requirement.requiredQuantity, order.numberOfParts, partNumber);
      if (planned.lessThanOrEqualTo(0)) return false;
      const weighed = part.weighings
        .filter((weighing) => weighing.productionOrderRequirementId === requirement.id)
        .reduce((sum, weighing) => sum.plus(weighing.actualQuantity), new Prisma.Decimal(0));
      return weighed.lessThanOrEqualTo(0);
    });
    if (missing.length > 0) {
      throw new UnweighedRequirementError(missing.map((requirement) => requirement.itemCode));
    }

    await tx.productionOrderPart.update({
      where: { id: part.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedByUserId: actor.id,
        completedByNameSnapshot: actor.name,
      },
    });
  });

  return getRecipeSheet(productionOrderId);
}
