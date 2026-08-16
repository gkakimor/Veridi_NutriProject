import { Prisma } from "@prisma/client";
import type { FormulationComponentBasis, UnitOfMeasure } from "@prisma/client";
import { convertUomDecimal } from "../modules/items/uom.js";

/**
 * Matemática da Formulação Industrial v2 — **fonte única** do cálculo de
 * necessidade física de material.
 *
 * A fábrica não pesa a quantidade teórica: pesa a quantidade teórica
 * corrigida pela pureza do insumo e pelo overage de processo.
 *
 * ```
 * teórico  = quantidade da base × fator da base
 * físico   = teórico ÷ (pureza/100) × (1 + overage/100)
 * ```
 *
 * Regras inegociáveis:
 * - **pureza `null` = desconhecida**: nenhuma correção é aplicada. Nunca se
 *   assume 100% implicitamente, nem se "descobre" pureza para o número
 *   fechar com um total histórico;
 * - **overage `null` = não informado**: idem, nada é inferido;
 * - pureza e overage usados aqui são SNAPSHOT do componente — mudar o Item
 *   depois não altera formulação nem OP já existente;
 * - tudo em `Prisma.Decimal`; nenhum float participa da conta.
 */

export interface ComponentCalculationInput {
  basis: FormulationComponentBasis;
  /** Significado depende de `basis` (base da versão, por dose, por unidade). */
  quantity: Prisma.Decimal;
  /** Unidade em que a quantidade foi declarada. */
  unitCode: string;
  /** Unidade de estoque do item — destino da conversão. */
  stockUnitCode: string;
  purityPercentApplied: Prisma.Decimal | null;
  overagePercent: Prisma.Decimal | null;
}

export interface VersionCalculationContext {
  /** Base da versão no modo FIXED_BASIS. */
  basisQuantity: Prisma.Decimal;
  /** Doses por embalagem — obrigatório no modo PER_DOSE. */
  dosesPerPackage: number | null;
}

export interface ComponentRequirement {
  /** Antes de pureza/overage, já na unidade de estoque. */
  theoreticalQuantity: Prisma.Decimal;
  /** Depois de pureza/overage — o que a fábrica realmente separa. */
  requiredQuantity: Prisma.Decimal;
  purityPercentApplied: Prisma.Decimal | null;
  overagePercent: Prisma.Decimal | null;
}

const HUNDRED = new Prisma.Decimal(100);

/**
 * Quantas vezes a quantidade declarada do componente entra na produção
 * pedida. É a única parte que depende da base escolhida.
 */
function basisFactor(
  basis: FormulationComponentBasis,
  producedQuantity: Prisma.Decimal,
  context: VersionCalculationContext,
): Prisma.Decimal {
  switch (basis) {
    case "FIXED_BASIS":
      // "Estas quantidades produzem `basisQuantity`" — modelo original.
      return producedQuantity.dividedBy(context.basisQuantity);
    case "PER_DOSE": {
      // mg por dose → por embalagem → pela quantidade produzida.
      const doses = new Prisma.Decimal(context.dosesPerPackage ?? 0);
      return doses.times(producedQuantity);
    }
    case "PER_FINISHED_UNIT":
      // Embalagem: uma tampa por pote, independentemente da dose.
      return producedQuantity;
  }
}

/**
 * Aplica pureza e overage sobre a quantidade teórica.
 *
 * Um insumo com 98% de pureza exige MAIS massa para entregar o mesmo teor;
 * um overage de 10% adiciona a perda esperada de processo.
 */
export function applyPurityAndOverage(
  theoretical: Prisma.Decimal,
  purityPercentApplied: Prisma.Decimal | null,
  overagePercent: Prisma.Decimal | null,
): Prisma.Decimal {
  let physical = theoretical;

  if (purityPercentApplied !== null && purityPercentApplied.greaterThan(0)) {
    physical = physical.dividedBy(purityPercentApplied.dividedBy(HUNDRED));
  }
  if (overagePercent !== null && overagePercent.greaterThanOrEqualTo(0)) {
    physical = physical.times(HUNDRED.plus(overagePercent).dividedBy(HUNDRED));
  }
  return physical;
}

/**
 * Necessidade de UM componente para produzir `producedQuantity` unidades do
 * produto acabado. Conversão de unidade acontece antes da correção física,
 * para que pureza/overage operem sempre na unidade de estoque.
 */
export function computeComponentRequirement(
  component: ComponentCalculationInput,
  producedQuantity: Prisma.Decimal,
  context: VersionCalculationContext,
  units: UnitOfMeasure[],
): ComponentRequirement {
  const factor = basisFactor(component.basis, producedQuantity, context);
  const declared = component.quantity.times(factor);
  const theoreticalQuantity = convertUomDecimal(
    declared,
    component.unitCode,
    component.stockUnitCode,
    units,
  );

  return {
    theoreticalQuantity,
    requiredQuantity: applyPurityAndOverage(
      theoreticalQuantity,
      component.purityPercentApplied,
      component.overagePercent,
    ),
    purityPercentApplied: component.purityPercentApplied,
    overagePercent: component.overagePercent,
  };
}
