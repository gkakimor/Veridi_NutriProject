import { Prisma } from "@prisma/client";
import type { PrismaClient, ItemType } from "@prisma/client";
import { computeComponentRequirement } from "../../lib/formulation-math.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export interface ComputedRequirementRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  formulaQuantity: Prisma.Decimal;
  formulaUnitCode: string;
  /** Antes de pureza/overage, na unidade de estoque. */
  theoreticalQuantity: Prisma.Decimal;
  purityPercentApplied: Prisma.Decimal | null;
  overagePercent: Prisma.Decimal | null;
  /** Depois de pureza/overage — o que realmente precisa ser separado. */
  requiredQuantity: Prisma.Decimal;
  stockUnitCode: string;
  position: number;
}

/**
 * Necessidade de material de uma versão de formulação. Única fonte desta
 * conta: usada para congelar `ProductionOrderRequirement` e para simular o
 * impacto de materiais do Plano de Atendimento (nunca persistido).
 *
 * A matemática por componente vive em `lib/formulation-math.ts` — aqui só
 * se resolve a versão, os itens e a ordem das linhas.
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
  const context = {
    basisQuantity: version.basisQuantity,
    dosesPerPackage: version.dosesPerPackage,
  };

  return version.components.map((component, index) => {
    const item = component.item;
    const requirement = computeComponentRequirement(
      {
        basis: component.basis,
        quantity: component.quantity,
        unitCode: component.unitCode,
        stockUnitCode: item.unitCode,
        purityPercentApplied: component.purityPercentApplied,
        overagePercent: component.overagePercent,
      },
      plannedQuantity,
      context,
      units,
    );

    return {
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      itemType: item.type,
      formulaQuantity: component.quantity,
      formulaUnitCode: component.unitCode,
      theoreticalQuantity: requirement.theoreticalQuantity,
      purityPercentApplied: requirement.purityPercentApplied,
      overagePercent: requirement.overagePercent,
      requiredQuantity: requirement.requiredQuantity,
      stockUnitCode: item.unitCode,
      position: index,
    };
  });
}
