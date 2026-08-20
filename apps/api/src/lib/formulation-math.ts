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
  /** Doses por embalagem — obrigatório para qualquer componente PER_DOSE. */
  dosesPerPackage: number | null;
}

/**
 * Premissa obrigatória ausente.
 *
 * Existe porque a versão anterior desta matemática fazia
 * `dosesPerPackage ?? 0`: uma premissa em branco virava zero, zero
 * multiplicava toda a fórmula, e o custo de material saía R$ 0,00 sendo
 * anunciado como completo. Ausência de premissa é cálculo inválido, não
 * resultado barato.
 */
export class FormulationContextIncompleteError extends Error {
  constructor(readonly missing: "DOSES_PER_PACKAGE") {
    super(
      "Informe as doses por embalagem antes de calcular esta formulação. Há componentes calculados por dose.",
    );
    this.name = "FormulationContextIncompleteError";
  }
}

/**
 * A base do componente depende de doses por embalagem?
 *
 * A pergunta é sobre a BASE DO COMPONENTE, nunca sobre o modo da versão.
 * O caso que originou este hotfix era exatamente uma versão `FIXED_BASIS`
 * com quatro componentes `PER_DOSE`: olhar só o modo deixava passar.
 */
export function basisRequiresDosesPerPackage(basis: FormulationComponentBasis): boolean {
  return basis === "PER_DOSE";
}

/** Doses por embalagem utilizável: inteiro presente e positivo. */
export function hasUsableDosesPerPackage(dosesPerPackage: number | null | undefined): boolean {
  return (
    typeof dosesPerPackage === "number" && Number.isFinite(dosesPerPackage) && dosesPerPackage > 0
  );
}

/**
 * A versão pode ser calculada com o contexto que tem?
 *
 * Serve às barreiras que precisam DECIDIR antes de calcular — ativação da
 * formulação, pendências da estrutura de custos — sem provocar a exceção
 * só para ler a resposta.
 */
export function missingFormulationContext(
  components: readonly { basis: FormulationComponentBasis }[],
  context: Pick<VersionCalculationContext, "dosesPerPackage">,
): "DOSES_PER_PACKAGE" | null {
  const dependsOnDoses = components.some((component) =>
    basisRequiresDosesPerPackage(component.basis),
  );
  if (dependsOnDoses && !hasUsableDosesPerPackage(context.dosesPerPackage)) {
    return "DOSES_PER_PACKAGE";
  }
  return null;
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
      //
      // Sem doses por embalagem não existe fator: `?? 0` daria zero e o
      // chamador receberia um número que parece custo e não é.
      if (!hasUsableDosesPerPackage(context.dosesPerPackage)) {
        throw new FormulationContextIncompleteError("DOSES_PER_PACKAGE");
      }
      const doses = new Prisma.Decimal(context.dosesPerPackage!);
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

/**
 * Mesma conta, para quem só EXIBE.
 *
 * A tela da formulação em rascunho precisa continuar abrindo mesmo com
 * premissa faltando — é lá que a pessoa vai informar a premissa. Devolve
 * `null` em vez de explodir, e `null` é o que a coluna mostra como "—".
 * Nenhum caminho financeiro usa esta função.
 */
export function tryComputeComponentRequirement(
  component: ComponentCalculationInput,
  producedQuantity: Prisma.Decimal,
  context: VersionCalculationContext,
  units: UnitOfMeasure[],
): ComponentRequirement | null {
  try {
    return computeComponentRequirement(component, producedQuantity, context, units);
  } catch (error) {
    if (error instanceof FormulationContextIncompleteError) return null;
    throw error;
  }
}
