import { Prisma } from "@prisma/client";
import type { PrismaClient, ItemType } from "@prisma/client";
import { convertUomDecimal } from "../items/uom.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export interface ComputedRequirementRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  formulaQuantity: Prisma.Decimal;
  formulaUnitCode: string;
  requiredQuantity: Prisma.Decimal;
  stockUnitCode: string;
  position: number;
}

/**
 * Matemática de necessidade de material — `component.quantity ×
 * (plannedQuantity / basisQuantity)`, convertida para a unidade de estoque
 * do item. Única fonte desta conta: usada tanto para congelar
 * `ProductionOrderRequirement` (`regenerateRequirements`) quanto para
 * simular o impacto de materiais do Plano de Atendimento (nunca persistido)
 * — nunca duplicar esta matemática em outro módulo.
 */
export async function computeFormulationRequirements(
  tx: PrismaOrTx,
  formulationVersionId: string,
  plannedQuantity: Prisma.Decimal,
): Promise<ComputedRequirementRow[]> {
  const version = await tx.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    include: { components: { include: { item: true }, orderBy: { position: "asc" } } },
  });
  if (!version || version.components.length === 0) return [];

  const units = await tx.unitOfMeasure.findMany();
  const factor = plannedQuantity.dividedBy(version.basisQuantity);

  return version.components.map((component, index) => {
    const item = component.item;
    const formulaResult = component.quantity.times(factor);
    const requiredQuantity = convertUomDecimal(formulaResult, component.unitCode, item.unitCode, units);
    return {
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
  });
}
