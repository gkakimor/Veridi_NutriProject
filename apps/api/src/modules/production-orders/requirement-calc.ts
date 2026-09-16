import { Prisma } from "@prisma/client";
import type { PrismaClient, ItemType, SupplyResponsibility } from "@prisma/client";
import { computeComponentRequirement } from "../../lib/formulation-math.js";
import { componenteSegueQuantidadeProduzida, quantidadeBrutaPlanejada } from "@veridi/shared";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export interface ComputedRequirementRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  formulaQuantity: Prisma.Decimal;
  formulaUnitCode: string;
  /** Snapshot da intenção da fórmula — quem deve fornecer este material. */
  supplyResponsibility: SupplyResponsibility;
  /** Antes de pureza/overage, na unidade de estoque. */
  theoreticalQuantity: Prisma.Decimal;
  purityPercentApplied: Prisma.Decimal | null;
  overagePercent: Prisma.Decimal | null;
  /** Depois de pureza/overage — o que realmente precisa ser separado. */
  requiredQuantity: Prisma.Decimal;
  stockUnitCode: string;
  position: number;
  /**
   * A perda prevista da versão entrou na quantidade desta linha?
   *
   * Só quem pediu `aplicarPerdaPrevista` vê `true` aqui, e só nas linhas
   * consumidas proporcionalmente ao que entra no processo. Existe para a tela
   * poder DIZER quais linhas carregam a premissa e quais não — um custo que
   * subiu sem a lista de quem subiu é um número sem auditoria.
   */
  expectedLossApplied: boolean;
}

/**
 * Opções de quem CHAMA o motor — nunca do motor.
 *
 * A perda prevista é premissa de PLANEJAMENTO e de CUSTO ESTIMADO. Aplicá-la
 * por padrão mudaria em silêncio o que a Ordem de Produção congela e o que o
 * picking separa, e nada nesta rodada autorizou isso. Por isso ela é opt-in:
 * quem quer a quantidade bruta pede.
 */
export interface RequirementCalcOptions {
  /**
   * Escalar para a quantidade BRUTA planejada as linhas consumidas
   * proporcionalmente ao que ENTRA no processo — as que a base declara
   * (`PER_DOSE`, `FIXED_BASIS`) e as de Item marcado como consumido na
   * produção, que é o caso da cápsula vazia.
   *
   * Embalagem comercial continua na quantidade vendável: um pote por pote
   * vendido, e a perda não vende pote.
   */
  aplicarPerdaPrevista?: boolean;
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
  options: RequirementCalcOptions = {},
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

  /*
   * A quantidade BRUTA planejada, quando pedida: líquida ÷ (1 − perda/100),
   * pela mesma função que a tela usa. Perda não declarada devolve a própria
   * líquida — ausência de premissa não inventa correção. Percentual fora de
   * faixa não passa pela validação da API, e aqui degrada para a líquida em
   * vez de derrubar o cálculo inteiro.
   */
  const bruta = options.aplicarPerdaPrevista
    ? quantidadeBrutaPlanejada(
        plannedQuantity.toString(),
        version.expectedLossPercent ? version.expectedLossPercent.toString() : null,
      )
    : null;
  const quantidadeBruta =
    bruta === null || typeof bruta === "string"
      ? plannedQuantity
      : new Prisma.Decimal(bruta.toString());

  return version.components.map((component, index) => {
    const item = component.item;
    // Quem acompanha o que é PRODUZIDO usa a bruta; quem acompanha a unidade
    // VENDÁVEL continua na líquida.
    const segueProducao = componenteSegueQuantidadeProduzida({
      basis: component.basis,
      consumedInProduction: item.consumedInProduction,
    });
    const quantidadeDaLinha = segueProducao ? quantidadeBruta : plannedQuantity;
    const requirement = computeComponentRequirement(
      {
        basis: component.basis,
        quantity: component.quantity,
        unitCode: component.unitCode,
        stockUnitCode: item.unitCode,
        purityPercentApplied: component.purityPercentApplied,
        overagePercent: component.overagePercent,
        quantityMode: component.quantityMode,
        applyPurityAdjustment: component.applyPurityAdjustment,
        applyOverageAdjustment: component.applyOverageAdjustment,
      },
      quantidadeDaLinha,
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
      supplyResponsibility: component.supplyResponsibility,
      theoreticalQuantity: requirement.theoreticalQuantity,
      purityPercentApplied: requirement.purityPercentApplied,
      overagePercent: requirement.overagePercent,
      requiredQuantity: requirement.requiredQuantity,
      stockUnitCode: item.unitCode,
      position: index,
      expectedLossApplied: segueProducao && !quantidadeDaLinha.equals(plannedQuantity),
    };
  });
}
