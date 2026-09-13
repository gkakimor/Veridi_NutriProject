import type { Prisma } from "@prisma/client";
import type {
  ProductionOrderPlanningSnapshot,
  ProductionOrderStatus,
  ProductionProfile,
  ProductionProfileVersion,
} from "@prisma/client";
import type {
  ProductionOrderAvailableProfileDTO,
  ProductionOrderPlanningDTO,
  ProductionOrderUnitFactorDTO,
  ProductionPlan,
  ProductionProfileSnapshot,
  ProductionRouteApplicationSource,
  ProductionRouteUomBlock,
  UomFactorLike,
} from "@veridi/shared";
import {
  ProductionPlanInputError,
  ProductionRouteUomError,
  ROUTE_CHANGE_STATUSES,
  compatibilidadeDoRoteiro,
  planProductionProfileSnapshotForOrder,
  productionProfileSnapshot,
  quantidadeNaUnidadeDoRoteiro,
  roteiroPendente,
} from "@veridi/shared";
import type { VersionWithRelations } from "../production-profiles/production-profiles.service.js";
import {
  toProductionProfileVersionDTO,
  verificarRoteiroCompativel,
} from "../production-profiles/production-profiles.service.js";

/**
 * ROTEIRO DE PRODUÇÃO da OP — PLANNING-OP-SNAPSHOT-01 e
 * PRODUCTION-ROUTE-ASSIGNMENT-01, `PRODUCT_RULES.md` §89.
 *
 * A OP recebe uma CÓPIA do roteiro e é dona dela a partir daí: ativar uma
 * versão nova depois não muda ordem nenhuma que já copiou, nem em rascunho. O
 * que muda com a quantidade é a PROJEÇÃO, refeita a cada leitura pelo motor
 * canônico — com a quantidade CONVERTIDA para a unidade de referência do roteiro.
 *
 * Sem roteiro a OP existe (o Pedido nunca cai por isso), mas não planeja, não
 * programa e não libera: é pendência de planejamento até alguém da Produção
 * aplicar um.
 */

export type ProductDefaultProfileVersion =
  | (ProductionProfileVersion & { productionProfile: ProductionProfile })
  | null;

/** O que a cópia guarda sobre a aplicação que ficou. */
export interface RouteApplication {
  source: ProductionRouteApplicationSource;
  reason: string | null;
  appliedBy: string | null;
}

/** A cópia por valor de uma versão que a autoridade já aprovou. */
export function copiaDaVersao(version: VersionWithRelations): ProductionProfileSnapshot {
  return productionProfileSnapshot(toProductionProfileVersionDTO(version));
}

/**
 * Substitui, atomicamente, a cópia da OP — dentro da transação de quem chama.
 * Uma linha por OP: a anterior sai, sem histórico de tentativas.
 */
export async function gravarRoteiroDaOrdem(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
  snapshot: ProductionProfileSnapshot,
  application: RouteApplication,
): Promise<void> {
  await tx.productionOrderPlanningSnapshot.deleteMany({ where: { productionOrderId } });
  await tx.productionOrderPlanningSnapshot.create({
    data: {
      productionOrderId,
      sourceProfileId: snapshot.sourceProfileId,
      sourceProfileCode: snapshot.sourceProfileCode,
      sourceProfileName: snapshot.sourceProfileName,
      sourceVersionId: snapshot.sourceVersionId,
      sourceVersionNumber: snapshot.sourceVersionNumber,
      referenceQuantity: snapshot.referenceQuantity,
      referenceUomCode: snapshot.referenceUomCode,
      steps: snapshot.steps as unknown as Prisma.InputJsonValue,
      appliedBy: application.appliedBy,
      applicationSource: application.source,
      applicationReason: application.reason,
    },
  });
}

/**
 * A aplicação AUTOMÁTICA do roteiro padrão do Produto: na criação da OP
 * (manual, Plano de Atendimento e saldo) e na troca de produto em rascunho.
 *
 * NUNCA lança por falta de roteiro. Produto sem padrão, padrão fora de ACTIVE ou
 * unidade que não converte deixam a OP SEM cópia — e isso é pendência, não erro:
 * o Plano de Atendimento corre na mesma transação, e um Pedido não pode cair
 * porque a Produção ainda não disse como fabricar. A cópia anterior sai sempre:
 * nunca fica a de outro produto.
 */
export async function aplicarRoteiroPadraoAutomatico(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
  productId: string,
  quantityUnitCode: string,
  appliedBy: string | null,
): Promise<ProductionProfileSnapshot | null> {
  await tx.productionOrderPlanningSnapshot.deleteMany({ where: { productionOrderId } });

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { defaultProductionProfileVersionId: true },
  });
  const versionId = product?.defaultProductionProfileVersionId;
  if (!versionId) return null;

  const { version, bloqueio } = await verificarRoteiroCompativel(tx, versionId, quantityUnitCode);
  if (!version || bloqueio !== null) return null;

  const snapshot = copiaDaVersao(version);
  await gravarRoteiroDaOrdem(tx, productionOrderId, snapshot, {
    source: "AUTO_PRODUCT_DEFAULT",
    reason: null,
    appliedBy,
  });
  return snapshot;
}

/** A linha gravada, de volta ao contrato por valor do `@veridi/shared`. */
export function readPlanningSnapshot(
  row: ProductionOrderPlanningSnapshot,
): ProductionProfileSnapshot {
  return {
    sourceProfileId: row.sourceProfileId,
    sourceProfileCode: row.sourceProfileCode,
    sourceProfileName: row.sourceProfileName,
    sourceVersionId: row.sourceVersionId,
    sourceVersionNumber: row.sourceVersionNumber,
    referenceQuantity: row.referenceQuantity.toString(),
    referenceUomCode: row.referenceUomCode,
    steps: row.steps as unknown as ProductionProfileSnapshot["steps"],
  };
}

export interface PlanningSource {
  status: ProductionOrderStatus;
  plannedQuantity: Prisma.Decimal;
  outputUnitCode: string;
  planningSnapshot: ProductionOrderPlanningSnapshot | null;
  product: { defaultProductionProfileVersion: ProductDefaultProfileVersion };
}

/** Só os fatores que a tela precisa para repetir a conversão enquanto se digita. */
function fatoresUsados(
  units: readonly UomFactorLike[],
  codes: readonly (string | null | undefined)[],
): ProductionOrderUnitFactorDTO[] {
  const pedidos = new Set(codes.filter((code): code is string => Boolean(code)));
  return units
    .filter((unit) => pedidos.has(unit.code))
    .map((unit) => ({
      code: unit.code,
      dimension: unit.dimension,
      toBaseFactor: String(unit.toBaseFactor),
    }));
}

export function toPlanningDTO(
  order: PlanningSource,
  units: readonly UomFactorLike[],
): ProductionOrderPlanningDTO {
  const row = order.planningSnapshot;
  const snapshot = row ? readPlanningSnapshot(row) : null;

  /*
   * Projeção para a quantidade da ordem, convertida para a unidade do roteiro.
   * Unidade sem conversão segura vira motivo explícito; quantidade ilegível ou
   * cópia corrompida viram travessão — nunca 500 nem zero disfarçado de número.
   */
  let plan: ProductionPlan | null = null;
  let quantityInReferenceUom: string | null = null;
  let planBlockedReason: ProductionRouteUomBlock | null = null;
  if (snapshot) {
    const pedido = { quantity: order.plannedQuantity.toString(), unitCode: order.outputUnitCode };
    try {
      quantityInReferenceUom = quantidadeNaUnidadeDoRoteiro(snapshot.referenceUomCode, pedido, units);
      plan = planProductionProfileSnapshotForOrder(snapshot, pedido, units);
    } catch (error) {
      if (error instanceof ProductionRouteUomError) planBlockedReason = error.motivo;
      else if (!(error instanceof ProductionPlanInputError)) throw error;
    }
  }

  const padrao = order.product.defaultProductionProfileVersion;
  const productDefaultProfile: ProductionOrderAvailableProfileDTO | null =
    padrao && padrao.status === "ACTIVE"
      ? {
          versionId: padrao.id,
          profileId: padrao.productionProfileId,
          profileCode: padrao.productionProfile.code,
          profileName: padrao.productionProfile.name,
          versionNumber: padrao.versionNumber,
          referenceQuantity: padrao.referenceQuantity.toString(),
          referenceUomCode: padrao.referenceUomCode,
        }
      : null;
  const productDefaultCompatible =
    padrao !== null && compatibilidadeDoRoteiro(padrao, order.outputUnitCode, units) === null;

  /*
   * O que a ordem ainda aceita. Sem roteiro: a PRIMEIRA aplicação, em DRAFT, e
   * em PLANNED/RELEASED como regularização. Com roteiro: troca só em DRAFT —
   * fora dele a cópia congela, mesmo existindo versão mais nova.
   */
  const temRoteiro = snapshot !== null;
  const primeira = roteiroPendente(order.status, temRoteiro);
  const troca = temRoteiro && ROUTE_CHANGE_STATUSES.includes(order.status);
  const padraoAplicavel = productDefaultProfile !== null && productDefaultCompatible;
  const canApply = primeira && padraoAplicavel;
  const canUpdate =
    troca && padraoAplicavel && productDefaultProfile.versionId !== snapshot.sourceVersionId;

  return {
    snapshot,
    plan,
    quantityInReferenceUom,
    conversionUnits: fatoresUsados(units, [
      order.outputUnitCode,
      snapshot?.referenceUomCode,
      productDefaultProfile?.referenceUomCode,
    ]),
    planBlockedReason,
    appliedAt: row ? row.appliedAt.toISOString() : null,
    appliedBy: row?.appliedBy ?? null,
    applicationSource: row?.applicationSource ?? null,
    applicationReason: row?.applicationReason ?? null,
    productDefaultProfile,
    productDefaultCompatible,
    availableProfile: canApply || canUpdate ? productDefaultProfile : null,
    canApply,
    canChoose: primeira || troca,
    canUpdate,
    requiresLegacyRepair: primeira && order.status !== "DRAFT",
    routePending: primeira,
  };
}
