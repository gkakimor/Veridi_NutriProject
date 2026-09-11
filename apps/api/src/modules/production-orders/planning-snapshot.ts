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
  ProductionPlan,
  ProductionProfileSnapshot,
} from "@veridi/shared";
import {
  ProductionPlanInputError,
  planProductionProfileSnapshot,
  productionProfileSnapshot,
} from "@veridi/shared";
import { toProductionProfileVersionDTO } from "../production-profiles/production-profiles.service.js";

/**
 * PLANEJAMENTO PREVISTO da OP — PLANNING-OP-SNAPSHOT-01, `PRODUCT_RULES.md` §89.
 *
 * A OP recebe uma CÓPIA do Perfil de Produção padrão do Produto na criação, e
 * é dona dela a partir daí: ativar uma versão nova do perfil depois não muda
 * ordem nenhuma que já copiou, nem em rascunho. O que muda com a quantidade é
 * a PROJEÇÃO, refeita a cada leitura pelo motor canônico — a cópia fica.
 *
 * Produto sem perfil padrão é situação legítima: a OP nasce sem cópia, e isso
 * não bloqueia criação nem liberação.
 */

/** O mesmo formato que `toProductionProfileVersionDTO` sabe ler. */
const profileVersionInclude = {
  productionProfile: true,
  steps: {
    orderBy: { sequence: "asc" as const },
    include: {
      resources: { orderBy: { sortOrder: "asc" as const }, include: { industrialResource: true } },
    },
  },
} as const;

export type ProductDefaultProfileVersion =
  | (ProductionProfileVersion & { productionProfile: ProductionProfile })
  | null;

/** O que o `include` da OP precisa trazer para montar o Planejamento previsto. */
export const planningSnapshotInclude = {
  planningSnapshot: true,
  product: {
    include: { defaultProductionProfileVersion: { include: { productionProfile: true } } },
  },
} as const;

/**
 * A cópia do Perfil padrão do Produto AGORA, ou `null` quando não há o que
 * copiar. Só versão ATIVA: rascunho ninguém aprovou, e arquivada já foi
 * substituída — o padrão acompanha sozinho a versão nova do mesmo perfil.
 */
export async function defaultProfileSnapshot(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<ProductionProfileSnapshot | null> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { defaultProductionProfileVersionId: true },
  });
  const versionId = product?.defaultProductionProfileVersionId;
  if (!versionId) return null;

  const version = await tx.productionProfileVersion.findUnique({
    where: { id: versionId },
    include: profileVersionInclude,
  });
  if (!version || version.status !== "ACTIVE") return null;

  return productionProfileSnapshot(toProductionProfileVersionDTO(version));
}

/**
 * Substitui, atomicamente, a cópia da OP pelo Perfil padrão atual do Produto.
 * Sem perfil padrão, a OP fica SEM cópia — nunca com a do produto anterior.
 */
export async function writePlanningSnapshot(
  tx: Prisma.TransactionClient,
  productionOrderId: string,
  productId: string,
  appliedBy: string | null,
): Promise<ProductionProfileSnapshot | null> {
  const snapshot = await defaultProfileSnapshot(tx, productId);

  await tx.productionOrderPlanningSnapshot.deleteMany({ where: { productionOrderId } });
  if (!snapshot) return null;

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
      appliedBy,
    },
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

/**
 * Projeção para a quantidade da OP. Quantidade ilegível ou cópia corrompida
 * viram travessão na tela, nunca 500 nem zero disfarçado de número.
 */
function projetar(
  snapshot: ProductionProfileSnapshot,
  plannedQuantity: string,
): ProductionPlan | null {
  try {
    return planProductionProfileSnapshot(snapshot, plannedQuantity);
  } catch (error) {
    if (error instanceof ProductionPlanInputError) return null;
    throw error;
  }
}

export interface PlanningSource {
  status: ProductionOrderStatus;
  plannedQuantity: Prisma.Decimal;
  planningSnapshot: ProductionOrderPlanningSnapshot | null;
  product: { defaultProductionProfileVersion: ProductDefaultProfileVersion };
}

export function toPlanningDTO(order: PlanningSource): ProductionOrderPlanningDTO {
  const row = order.planningSnapshot;
  const snapshot = row ? readPlanningSnapshot(row) : null;
  const plan = snapshot ? projetar(snapshot, order.plannedQuantity.toString()) : null;

  /*
   * Fora de DRAFT a cópia é imutável: nada de aplicar, atualizar ou
   * substituir, mesmo existindo versão mais nova. Então a tela nem recebe o
   * que o produto aponta hoje — não há ação possível para oferecer.
   */
  const versao = order.status === "DRAFT" ? order.product.defaultProductionProfileVersion : null;
  const availableProfile: ProductionOrderAvailableProfileDTO | null =
    versao && versao.status === "ACTIVE"
      ? {
          versionId: versao.id,
          profileId: versao.productionProfileId,
          profileCode: versao.productionProfile.code,
          profileName: versao.productionProfile.name,
          versionNumber: versao.versionNumber,
        }
      : null;

  return {
    snapshot,
    plan,
    appliedAt: row ? row.appliedAt.toISOString() : null,
    appliedBy: row?.appliedBy ?? null,
    availableProfile,
    canApply: availableProfile !== null && snapshot === null,
    canUpdate:
      availableProfile !== null &&
      snapshot !== null &&
      availableProfile.versionId !== snapshot.sourceVersionId,
  };
}
