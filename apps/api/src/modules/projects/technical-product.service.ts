import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, ProductLifecycle, Project, User } from "@prisma/client";
import type { ProjectCostingSummaryDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";

type PrismaOrTx = PrismaTypes.TransactionClient;

/**
 * Produto TÉCNICO do projeto.
 *
 * Antes desta capacidade o Produto só nascia na aprovação do projeto — mas
 * custo e preço exigem Produto, e o orçamento precisa de preço. O ciclo se
 * resolve com lifecycle explícito: o projeto pode preparar um produto em
 * DESENVOLVIMENTO para engenharia e custeio, e a aprovação PROMOVE o mesmo
 * produto, sem criar um segundo nem trocar código, formulação ou custo.
 */

export class ProjectProductAlreadyExistsError extends Error {
  constructor(code: string) {
    super(`Este projeto já tem um produto técnico preparado (${code}).`);
    this.name = "ProjectProductAlreadyExistsError";
  }
}

export class ProjectNotPreparableError extends Error {
  constructor(status: string) {
    super(
      status === "CANCELLED"
        ? "Projeto cancelado não prepara produto técnico."
        : `Projeto em ${status} não permite preparar produto técnico.`,
    );
    this.name = "ProjectNotPreparableError";
  }
}

export interface TechnicalProductInput {
  /** Unidade do produto acabado — nunca inventada a partir do brief. */
  finishedUnitCode: string;
  lifecycle: ProductLifecycle;
}

/**
 * Cria Produto + Item de produto acabado + Formulação V1 DRAFT.
 *
 * Mesma construção usada pela preparação técnica e pela aprovação do
 * projeto: existe UMA definição de "produto nascido de projeto", e o que
 * muda entre os dois caminhos é só o lifecycle.
 */
export async function createProjectProduct(
  tx: PrismaOrTx,
  project: Project,
  input: TechnicalProductInput,
  actor: User,
): Promise<{ id: string; code: string }> {
  const unit = await tx.unitOfMeasure.findUnique({ where: { code: input.finishedUnitCode } });
  if (!unit) throw new Error(`Unidade não encontrada: ${input.finishedUnitCode}`);

  const itemCodeRows = await tx.$queryRawUnsafe<{ nextval: bigint }[]>(
    "SELECT nextval('item_code_finished_product_seq') AS nextval",
  );
  const itemCode = `PA-${(itemCodeRows[0]?.nextval ?? 1n).toString().padStart(6, "0")}`;

  const finishedItem = await tx.item.create({
    data: {
      code: itemCode,
      type: "FINISHED_PRODUCT",
      name: project.name,
      unitCode: input.finishedUnitCode,
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
      active: true,
    },
  });

  const productCodeRows = await tx.$queryRawUnsafe<{ nextval: bigint }[]>(
    "SELECT nextval('product_code_seq') AS nextval",
  );
  const productCode = `PROD-${(productCodeRows[0]?.nextval ?? 1n).toString().padStart(6, "0")}`;

  const product = await tx.product.create({
    data: {
      code: productCode,
      name: project.name,
      customerId: project.customerId,
      finishedProductItemId: finishedItem.id,
      lifecycle: input.lifecycle,
      // Só o produto nascido desta ação carrega a origem: produto legado
      // nunca é afetado pelo cancelamento de um projeto.
      ...(input.lifecycle === "DEVELOPMENT" ? { originProjectId: project.id } : {}),
      // Brief do projeto vira ponto de partida; a partir daqui as duas
      // entidades seguem vidas separadas.
      ...(project.dosageForm ? { dosageForm: project.dosageForm } : {}),
      ...(project.presentationType ? { presentationType: project.presentationType } : {}),
      ...(project.doseAmount ? { doseAmount: project.doseAmount } : {}),
      ...(project.doseUomCode ? { doseUomCode: project.doseUomCode } : {}),
      ...(project.dosesPerPackage ? { dosesPerPackage: project.dosesPerPackage } : {}),
      ...(project.targetAgeGroup ? { targetAgeGroup: project.targetAgeGroup } : {}),
      ...(project.minimumBatchQuantity
        ? { minimumBatchQuantity: project.minimumBatchQuantity }
        : {}),
      ...(project.shelfLifeMonths ? { shelfLifeMonths: project.shelfLifeMonths } : {}),
      ...(project.externalCode ? { externalCode: project.externalCode } : {}),
      active: true,
    },
  });

  // Formulação V1 DRAFT: pronta para a engenharia, nunca ACTIVE.
  await tx.formulationVersion.create({
    data: {
      productId: product.id,
      versionNumber: 1,
      status: "DRAFT",
      basisQuantity: new Prisma.Decimal(1),
      outputItemId: finishedItem.id,
      outputItemCode: finishedItem.code,
      outputItemName: finishedItem.name,
      outputUnitCode: finishedItem.unitCode,
      createdBy: actor.name,
    },
  });

  return { id: product.id, code: product.code };
}

/**
 * Cadeia econômica de um produto: formulação → estrutura → cálculo →
 * precificação. Read model puro, montado sob demanda — nada persistido.
 */
export async function getProjectCostingSummary(
  productId: string | null,
): Promise<ProjectCostingSummaryDTO | null> {
  if (!productId) return null;
  const prisma = getPrisma();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      formulationVersions: { orderBy: { versionNumber: "desc" }, take: 5 },
      industrialCostVersions: { orderBy: { versionNumber: "desc" }, take: 5 },
      industrialCostCalculations: { orderBy: { calculatedAt: "desc" }, take: 1 },
      pricingVersions: {
        where: { status: "ACTIVE" },
        include: { tiers: { orderBy: { quantity: "asc" } } },
        take: 1,
      },
    },
  });
  if (!product) return null;

  const activeFormulation =
    product.formulationVersions.find((version) => version.status === "ACTIVE") ??
    product.formulationVersions[0] ??
    null;
  const activeStructure =
    product.industrialCostVersions.find((version) => version.status === "ACTIVE") ??
    product.industrialCostVersions[0] ??
    null;
  const latestCalculation = product.industrialCostCalculations[0] ?? null;
  const activePricing = product.pricingVersions[0] ?? null;

  return {
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    lifecycle: product.lifecycle,
    productActive: product.active,

    formulationVersionId: activeFormulation?.id ?? null,
    formulationVersionNumber: activeFormulation?.versionNumber ?? null,
    formulationStatus: activeFormulation?.status ?? null,

    industrialCostVersionId: activeStructure?.id ?? null,
    industrialCostVersionLabel: activeStructure
      ? `${activeStructure.code} · V${activeStructure.versionNumber}`
      : null,
    industrialCostVersionStatus: activeStructure?.status ?? null,

    calculationId: latestCalculation?.id ?? null,
    calculationCode: latestCalculation?.code ?? null,
    calculationQuality: latestCalculation?.quality ?? null,
    costReferenceDate: latestCalculation ? latestCalculation.costReferenceDate.toISOString() : null,

    pricingVersionId: activePricing?.id ?? null,
    pricingLabel: activePricing ? `${activePricing.code} · V${activePricing.versionNumber}` : null,
    pricingTierCount: activePricing ? activePricing.tiers.length : 0,
  };
}

/** Projeto que ainda não passou pela aprovação pode preparar produto técnico. */
export function assertPreparable(status: string): void {
  if (status === "CANCELLED" || status === "APPROVED") {
    throw new ProjectNotPreparableError(status);
  }
}
