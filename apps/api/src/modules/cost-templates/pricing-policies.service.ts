import { Prisma } from "@prisma/client";
import type {
  PricingPolicyTemplate,
  PricingPolicyTemplateTier,
  PricingPolicyTemplateVersion,
  User,
} from "@prisma/client";
import type {
  PricingPolicyDTO,
  PricingPolicyListResponse,
  PricingPolicyPreviewDTO,
  PricingPolicySummaryDTO,
  PricingPolicyVersionDTO,
  PricingVersionDTO,
  TemplateDiffDTO,
  TemplateDiffEntryDTO,
  TemplateUpdateAvailableDTO,
} from "@veridi/shared";
import { PRICING_POLICY_TEMPLATE_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { createPricingTier, createPricingVersion, getPricingVersion } from "../pricing/pricing.service.js";
import { PricingVersionNotFoundError } from "../pricing/pricing.errors.js";
import {
  PricingPolicyCalculationRequiredError,
  PricingPolicyEmptyError,
  PricingPolicyNotFoundError,
  PricingPolicyVersionNotFoundError,
  TemplateArchivedForUseError,
  TemplateDraftExistsError,
  TemplateNotActiveError,
  TemplateNotDraftError,
} from "./cost-templates.errors.js";
import type {
  CreatePolicyFromPricingInput,
  CreatePricingPolicyInput,
  ListTemplatesQuery,
  UpdatePricingPolicyVersionInput,
  UpdateTemplateIdentityInput,
} from "./cost-templates.schemas.js";

/**
 * Biblioteca comercial — Políticas de Precificação.
 *
 * Uma política responde "como normalmente COMERCIALIZAMOS este tipo de
 * produto": em que faixas de quantidade, com que margem alvo e que comissão.
 *
 * **Não é template de preço.** Preço depende do custo do produto: copiar
 * "R$ 44,90" de um produto para outro levaria o custo alheio disfarçado de
 * decisão comercial, e o erro só apareceria na margem real meses depois. A
 * política guarda REGRA; o preço nasce do motor de precificação sobre o
 * cálculo daquele produto, no momento em que a política é aplicada.
 */

const CODE_SEQUENCE = "pricing_policy_template_code_seq";

type VersionWithRelations = PricingPolicyTemplateVersion & {
  pricingPolicyTemplate: PricingPolicyTemplate;
  tiers: PricingPolicyTemplateTier[];
  _count?: { derivedPricingVersions: number };
};
type PolicyWithVersions = PricingPolicyTemplate & { versions: VersionWithRelations[] };

const versionInclude = {
  pricingPolicyTemplate: true,
  tiers: { orderBy: { quantity: "asc" as const } },
  _count: { select: { derivedPricingVersions: true } },
} as const;

const policyInclude = {
  versions: { include: versionInclude, orderBy: { versionNumber: "asc" as const } },
} as const;

export function toPolicyVersionDTO(version: VersionWithRelations): PricingPolicyVersionDTO {
  return {
    id: version.id,
    pricingPolicyTemplateId: version.pricingPolicyTemplateId,
    templateCode: version.pricingPolicyTemplate.code,
    templateName: version.pricingPolicyTemplate.name,
    versionNumber: version.versionNumber,
    versionLabel: `V${version.versionNumber}`,
    status: version.status,
    notes: version.notes,
    tiers: version.tiers.map((tier) => ({
      id: tier.id,
      quantity: tier.quantity.toString(),
      uomCode: tier.uomCode,
      priceMode: tier.priceMode,
      targetContributionMarginPercent: tier.targetContributionMarginPercent
        ? tier.targetContributionMarginPercent.toString()
        : null,
      commissionPercent: tier.commissionPercent.toString(),
      notes: tier.notes,
      sortOrder: tier.sortOrder,
    })),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedBy: version.activatedBy,
    archivedAt: version.archivedAt ? version.archivedAt.toISOString() : null,
    sourceVersionId: version.sourceVersionId,
    sourceVersionNumber: version.sourceVersionNumber,
    usageCount: version._count?.derivedPricingVersions ?? 0,
  };
}

function toPolicyDTO(policy: PolicyWithVersions): PricingPolicyDTO {
  const versions = policy.versions.map(toPolicyVersionDTO);
  return {
    id: policy.id,
    code: policy.code,
    name: policy.name,
    description: policy.description,
    archived: policy.archivedAt !== null,
    archivedAt: policy.archivedAt ? policy.archivedAt.toISOString() : null,
    activeVersion: versions.find((version) => version.status === "ACTIVE") ?? null,
    draftVersion: versions.find((version) => version.status === "DRAFT") ?? null,
    versions,
    createdAt: policy.createdAt.toISOString(),
    createdBy: policy.createdBy,
    updatedAt: policy.updatedAt.toISOString(),
  };
}

function toSummaryDTO(policy: PolicyWithVersions): PricingPolicySummaryDTO {
  const ativa = policy.versions.find((version) => version.status === "ACTIVE") ?? null;
  return {
    id: policy.id,
    code: policy.code,
    name: policy.name,
    description: policy.description,
    archived: policy.archivedAt !== null,
    activeVersionId: ativa?.id ?? null,
    activeVersionNumber: ativa?.versionNumber ?? null,
    tierCount: ativa?.tiers.length ?? 0,
    tierQuantities: ativa ? ativa.tiers.map((tier) => tier.quantity.toString()) : [],
    hasDraft: policy.versions.some((version) => version.status === "DRAFT"),
    updatedAt: policy.updatedAt.toISOString(),
  };
}

async function requirePolicy(id: string): Promise<PolicyWithVersions> {
  const policy = await getPrisma().pricingPolicyTemplate.findUnique({
    where: { id },
    include: policyInclude,
  });
  if (!policy) throw new PricingPolicyNotFoundError(id);
  return policy;
}

export async function requirePolicyVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().pricingPolicyTemplateVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new PricingPolicyVersionNotFoundError(id);
  return version;
}

export async function getPricingPolicy(id: string): Promise<PricingPolicyDTO> {
  return toPolicyDTO(await requirePolicy(id));
}

export async function getPricingPolicyVersion(id: string): Promise<PricingPolicyVersionDTO> {
  return toPolicyVersionDTO(await requirePolicyVersion(id));
}

export async function listPricingPolicies(
  query: ListTemplatesQuery,
  pagination: Pagination,
): Promise<PricingPolicyListResponse> {
  const prisma = getPrisma();
  const termo = query.search?.trim();
  const where: Prisma.PricingPolicyTemplateWhereInput = {
    ...(query.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...(termo
      ? {
          OR: [
            { code: { contains: termo, mode: "insensitive" } },
            { name: { contains: termo, mode: "insensitive" } },
            { description: { contains: termo, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, policies] = await Promise.all([
    prisma.pricingPolicyTemplate.count({ where }),
    prisma.pricingPolicyTemplate.findMany({
      where,
      include: policyInclude,
      orderBy: { updatedAt: "desc" },
      ...pageArgs(pagination),
    }),
  ]);

  return { policies: policies.map(toSummaryDTO), ...pageMeta(pagination, total) };
}

export async function createPricingPolicy(
  input: CreatePricingPolicyInput,
  actor: User,
): Promise<PricingPolicyDTO> {
  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, PRICING_POLICY_TEMPLATE_CODE_PREFIX);
  const created = await prisma.pricingPolicyTemplate.create({
    data: {
      code,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      createdBy: actor.name,
      versions: { create: { versionNumber: 1, status: "DRAFT", createdBy: actor.name } },
    },
  });
  return getPricingPolicy(created.id);
}

export async function updatePricingPolicyIdentity(
  id: string,
  input: UpdateTemplateIdentityInput,
): Promise<PricingPolicyDTO> {
  await requirePolicy(id);
  await getPrisma().pricingPolicyTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return getPricingPolicy(id);
}

export async function setPricingPolicyArchived(
  id: string,
  archived: boolean,
  actor: User,
): Promise<PricingPolicyDTO> {
  await requirePolicy(id);
  await getPrisma().pricingPolicyTemplate.update({
    where: { id },
    data: archived
      ? { archivedAt: new Date(), archivedBy: actor.name }
      : { archivedAt: null, archivedBy: null },
  });
  return getPricingPolicy(id);
}

export async function updatePricingPolicyVersion(
  id: string,
  input: UpdatePricingPolicyVersionInput,
): Promise<PricingPolicyVersionDTO> {
  const current = await requirePolicyVersion(id);
  if (current.status !== "DRAFT") throw new TemplateNotDraftError(current.status);

  await getPrisma().$transaction(async (tx) => {
    await tx.pricingPolicyTemplateVersion.update({
      where: { id },
      data: { ...(input.notes !== undefined ? { notes: input.notes } : {}) },
    });

    if (input.tiers) {
      await tx.pricingPolicyTemplateTier.deleteMany({
        where: { pricingPolicyTemplateVersionId: id },
      });
      await tx.pricingPolicyTemplateTier.createMany({
        data: input.tiers.map((tier, index) => ({
          pricingPolicyTemplateVersionId: id,
          quantity: new Prisma.Decimal(tier.quantity),
          uomCode: tier.uomCode ?? "un",
          // Só margem alvo: preço manual é decisão de UMA negociação sobre UM
          // custo, e reutilizá-lo entre produtos transportaria o acordo de um
          // cliente para outro sem que ninguém tivesse decidido isso.
          priceMode: "TARGET_MARGIN",
          targetContributionMarginPercent: new Prisma.Decimal(
            tier.targetContributionMarginPercent,
          ),
          commissionPercent: new Prisma.Decimal(tier.commissionPercent ?? "0"),
          ...(tier.notes !== undefined ? { notes: tier.notes } : {}),
          sortOrder: index,
        })),
      });
    }

    await tx.pricingPolicyTemplate.update({
      where: { id: current.pricingPolicyTemplateId },
      data: { updatedAt: new Date() },
    });
  });

  return getPricingPolicyVersion(id);
}

export async function activatePricingPolicyVersion(
  id: string,
  actor: User,
): Promise<PricingPolicyVersionDTO> {
  const current = await requirePolicyVersion(id);
  if (current.status !== "DRAFT") throw new TemplateNotDraftError(current.status);
  if (current.tiers.length === 0) throw new PricingPolicyEmptyError();

  await getPrisma().$transaction(async (tx) => {
    await tx.pricingPolicyTemplateVersion.updateMany({
      where: {
        pricingPolicyTemplateId: current.pricingPolicyTemplateId,
        status: "ACTIVE",
        id: { not: id },
      },
      data: { status: "ARCHIVED", archivedAt: new Date(), archivedBy: actor.name },
    });
    await tx.pricingPolicyTemplateVersion.update({
      where: { id },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedBy: actor.name },
    });
    await tx.pricingPolicyTemplate.update({
      where: { id: current.pricingPolicyTemplateId },
      data: { updatedAt: new Date() },
    });
  });

  return getPricingPolicyVersion(id);
}

export async function createPolicyVersionFrom(
  sourceVersionId: string,
  actor: User,
): Promise<PricingPolicyVersionDTO> {
  const source = await requirePolicyVersion(sourceVersionId);
  const prisma = getPrisma();

  const aberto = await prisma.pricingPolicyTemplateVersion.findFirst({
    where: { pricingPolicyTemplateId: source.pricingPolicyTemplateId, status: "DRAFT" },
    select: { versionNumber: true },
  });
  if (aberto) throw new TemplateDraftExistsError(aberto.versionNumber);

  const criadaId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM pricing_policy_templates WHERE id = ${source.pricingPolicyTemplateId} FOR UPDATE`;
    const maior = await tx.pricingPolicyTemplateVersion.aggregate({
      where: { pricingPolicyTemplateId: source.pricingPolicyTemplateId },
      _max: { versionNumber: true },
    });
    const criada = await tx.pricingPolicyTemplateVersion.create({
      data: {
        pricingPolicyTemplateId: source.pricingPolicyTemplateId,
        versionNumber: (maior._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        notes: source.notes,
        createdBy: actor.name,
        sourceVersionId: source.id,
        sourceVersionNumber: source.versionNumber,
        tiers: {
          create: source.tiers.map((tier) => ({
            quantity: tier.quantity,
            uomCode: tier.uomCode,
            priceMode: tier.priceMode,
            targetContributionMarginPercent: tier.targetContributionMarginPercent,
            commissionPercent: tier.commissionPercent,
            notes: tier.notes,
            sortOrder: tier.sortOrder,
          })),
        },
      },
    });
    return criada.id;
  });

  return getPricingPolicyVersion(criadaId);
}

// ──────────────────────────────────────────────────── aplicação e previsão

async function assertPolicyUsable(version: VersionWithRelations): Promise<void> {
  if (version.status !== "ACTIVE") throw new TemplateNotActiveError(version.status);
  if (version.pricingPolicyTemplate.archivedAt !== null) {
    throw new TemplateArchivedForUseError(version.pricingPolicyTemplate.code);
  }
  if (version.tiers.length === 0) throw new PricingPolicyEmptyError();
}

/**
 * O que esta política produziria NESTE produto, sem gravar nada.
 *
 * Existe porque a mesma política dá preços diferentes em produtos diferentes —
 * é o ponto inteiro dela. Aplicar sem ver seria descobrir o preço depois de
 * ele já existir, e a decisão comercial merece acontecer antes.
 */
export async function previewPricingPolicy(
  productId: string,
  policyVersionId: string,
  calculationId: string,
): Promise<PricingPolicyPreviewDTO> {
  const prisma = getPrisma();
  const policy = await requirePolicyVersion(policyVersionId);
  await assertPolicyUsable(policy);

  const calculation = await prisma.industrialCostCalculation.findUnique({
    where: { id: calculationId },
    include: { product: true },
  });
  if (!calculation) throw new PricingPolicyCalculationRequiredError();
  if (calculation.productId !== productId) throw new PricingPolicyCalculationRequiredError();

  const { costForOutputQuantity, pricingVersionInclude } = await import(
    "../pricing/pricing-cost.js"
  );
  const { getIndustrialCostCalculation } = await import(
    "../industrial-cost-calculation/snapshot.service.js"
  );
  // MESMO motor que a precificação usa — a prévia não pode ter matemática própria.
  const { computePrice } = await import("../pricing/pricing-math.js");

  const costVersion = await prisma.industrialCostVersion.findUnique({
    where: { id: calculation.industrialCostVersionId },
    include: pricingVersionInclude,
  });
  const snapshot = await getIndustrialCostCalculation(calculation.id);

  const tiers = [];
  for (const tier of policy.tiers) {
    const custo =
      costVersion &&
      (await costForOutputQuantity(prisma, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        costVersion: costVersion as any,
        calculation: snapshot,
        quantity: tier.quantity,
        quantityUomCode: tier.uomCode,
      }));

    const margem = tier.targetContributionMarginPercent;
    const perUnit = custo?.perUnit ?? null;
    const resultado = computePrice({
      priceMode: "TARGET_MARGIN",
      quantity: tier.quantity,
      costPerUnit: perUnit,
      targetMarginPercent: margem,
      commissionPercent: tier.commissionPercent,
      manualUnitPrice: null,
    });
    const sugerido = resultado.suggestedUnitPrice;
    // Custo incompleto continua bloqueando preço sugerido: a política não
    // contorna uma regra que existe para não inventar margem.
    const aviso = sugerido === null ? (resultado.warnings[0]?.message ?? null) : null;

    tiers.push({
      quantity: tier.quantity.toString(),
      uomCode: tier.uomCode,
      targetContributionMarginPercent: margem ? margem.toString() : null,
      commissionPercent: tier.commissionPercent.toString(),
      costPerUnit: perUnit ? perUnit.toFixed(6) : null,
      suggestedUnitPrice: sugerido ? sugerido.toFixed(6) : null,
      costQuality: calculation.quality,
      warning: aviso,
    });
  }

  return {
    policyCode: policy.pricingPolicyTemplate.code,
    policyVersionLabel: `V${policy.versionNumber}`,
    productId,
    productCode: calculation.product.code,
    calculationId: calculation.id,
    calculationCode: calculation.code,
    costReferenceDate: calculation.costReferenceDate.toISOString(),
    costQuality: calculation.quality,
    tiers,
  };
}

/**
 * Aplica a política ao produto: nasce uma PricingVersion em rascunho.
 *
 * Cada faixa é criada pelo MOTOR de precificação existente, sobre o cálculo
 * escolhido. Nenhum valor vem da política — dela vêm quantidade, margem alvo
 * e comissão, que é a regra reutilizável.
 */
export async function applyPricingPolicyToProduct(
  productId: string,
  policyVersionId: string,
  calculationId: string,
  actor: User,
): Promise<PricingVersionDTO> {
  const prisma = getPrisma();
  const policy = await requirePolicyVersion(policyVersionId);
  await assertPolicyUsable(policy);

  const calculation = await prisma.industrialCostCalculation.findUnique({
    where: { id: calculationId },
    select: { id: true, productId: true },
  });
  if (!calculation || calculation.productId !== productId) {
    throw new PricingPolicyCalculationRequiredError();
  }

  // Reusa a criação normal — inclusive a regra de um rascunho por produto.
  const version = await createPricingVersion(
    productId,
    { industrialCostCalculationId: calculationId },
    actor,
  );

  await prisma.pricingVersion.update({
    where: { id: version.id },
    data: {
      originPricingPolicyVersionId: policy.id,
      originPricingPolicyCode: policy.pricingPolicyTemplate.code,
      originPricingPolicyVersionNumber: policy.versionNumber,
    },
  });

  /*
   * Faixas exatamente como a política declara — sem interpolar. Uma política
   * com 500/1000/3000 gera 500/1000/3000: inventar 750 criaria uma faixa que
   * ninguém aprovou, e o orçamento exige quantidade exata.
   */
  for (const tier of policy.tiers) {
    const existente = version.tiers.find(
      (atual) => Number(atual.quantity) === Number(tier.quantity),
    );
    if (existente) continue;
    await createPricingTier(
      version.id,
      {
        quantity: tier.quantity.toString(),
        uomCode: tier.uomCode,
        priceMode: "TARGET_MARGIN",
        targetContributionMarginPercent: tier.targetContributionMarginPercent
          ? tier.targetContributionMarginPercent.toString()
          : undefined,
        commissionPercent: tier.commissionPercent.toString(),
      } as Parameters<typeof createPricingTier>[1],
      actor,
    );
  }

  return getPricingVersion(version.id);
}

export async function getPricingPolicyUpdateAvailable(
  pricingVersionId: string,
): Promise<TemplateUpdateAvailableDTO | null> {
  const prisma = getPrisma();
  const version = await prisma.pricingVersion.findUnique({
    where: { id: pricingVersionId },
    select: { originPricingPolicyVersionId: true },
  });
  if (!version) throw new PricingVersionNotFoundError(pricingVersionId);
  if (!version.originPricingPolicyVersionId) return null;

  const origem = await requirePolicyVersion(version.originPricingPolicyVersionId);
  const ativa = await prisma.pricingPolicyTemplateVersion.findFirst({
    where: { pricingPolicyTemplateId: origem.pricingPolicyTemplateId, status: "ACTIVE" },
    select: { id: true, versionNumber: true },
  });
  if (!ativa || ativa.id === origem.id) return null;
  if (ativa.versionNumber <= origem.versionNumber) return null;

  return {
    templateId: origem.pricingPolicyTemplateId,
    templateCode: origem.pricingPolicyTemplate.code,
    templateName: origem.pricingPolicyTemplate.name,
    originVersionId: origem.id,
    originVersionNumber: origem.versionNumber,
    latestVersionId: ativa.id,
    latestVersionNumber: ativa.versionNumber,
  };
}

interface ComparavelPolitica {
  label: string;
  tiers: {
    quantity: string;
    uomCode: string;
    margin: string | null;
    commission: string;
  }[];
}

/**
 * Diff entre duas políticas.
 *
 * Compara REGRA, nunca preço resultante: mostrar "R$ 44,90 → R$ 41,20" faria
 * parecer que a política mudou quando só o custo do produto mudou.
 */
export function compararPoliticas(
  de: ComparavelPolitica,
  para: ComparavelPolitica,
): TemplateDiffDTO {
  const entries: TemplateDiffEntryDTO[] = [];
  const deFaixas = new Map(de.tiers.map((t) => [t.quantity, t]));
  const paraFaixas = new Map(para.tiers.map((t) => [t.quantity, t]));

  for (const faixa of para.tiers) {
    if (!deFaixas.has(faixa.quantity)) {
      entries.push({
        kind: "TIER_ADDED",
        label: `${faixa.quantity} ${faixa.uomCode}`,
        field: null,
        from: null,
        to: `margem ${faixa.margin ?? "—"}%`,
      });
    }
  }
  for (const faixa of de.tiers) {
    if (!paraFaixas.has(faixa.quantity)) {
      entries.push({
        kind: "TIER_REMOVED",
        label: `${faixa.quantity} ${faixa.uomCode}`,
        field: null,
        from: `margem ${faixa.margin ?? "—"}%`,
        to: null,
      });
    }
  }
  for (const faixa of para.tiers) {
    const anterior = deFaixas.get(faixa.quantity);
    if (!anterior) continue;
    const label = `${faixa.quantity} ${faixa.uomCode}`;
    if (anterior.margin !== faixa.margin) {
      entries.push({
        kind: "TIER_CHANGED",
        label,
        field: "Margem alvo",
        from: anterior.margin,
        to: faixa.margin,
      });
    }
    if (anterior.commission !== faixa.commission) {
      entries.push({
        kind: "TIER_CHANGED",
        label,
        field: "Comissão",
        from: anterior.commission,
        to: faixa.commission,
      });
    }
  }

  return { fromLabel: de.label, toLabel: para.label, entries };
}

function politicaComparavel(version: VersionWithRelations): ComparavelPolitica {
  return {
    label: `${version.pricingPolicyTemplate.code} · V${version.versionNumber}`,
    tiers: version.tiers.map((tier) => ({
      quantity: tier.quantity.toString(),
      uomCode: tier.uomCode,
      margin: tier.targetContributionMarginPercent
        ? tier.targetContributionMarginPercent.toString()
        : null,
      commission: tier.commissionPercent.toString(),
    })),
  };
}

export async function comparePricingPolicyVersions(
  fromId: string,
  toId: string,
): Promise<TemplateDiffDTO> {
  const [de, para] = await Promise.all([requirePolicyVersion(fromId), requirePolicyVersion(toId)]);
  return compararPoliticas(politicaComparavel(de), politicaComparavel(para));
}

/**
 * Salvar a precificação do produto como política da biblioteca.
 *
 * Copia SÓ a regra: quantidade, margem alvo e comissão. Preço, custo,
 * cálculo, produto e cliente ficam onde estão — levá-los transformaria uma
 * matriz reutilizável no acordo de um cliente específico.
 *
 * Faixas com preço manual não viram política: não há regra a extrair de um
 * número que alguém digitou para uma negociação.
 */
export async function createPolicyFromPricingVersion(
  pricingVersionId: string,
  input: CreatePolicyFromPricingInput,
  actor: User,
): Promise<PricingPolicyDTO> {
  const prisma = getPrisma();
  const version = await prisma.pricingVersion.findUnique({
    where: { id: pricingVersionId },
    include: { tiers: { orderBy: { quantity: "asc" } } },
  });
  if (!version) throw new PricingVersionNotFoundError(pricingVersionId);

  const comRegra = version.tiers.filter(
    (tier) => tier.priceMode === "TARGET_MARGIN" && tier.targetContributionMarginPercent !== null,
  );
  if (comRegra.length === 0) throw new PricingPolicyEmptyError();

  const policy = await createPricingPolicy(
    {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
    actor,
  );

  const rascunho = policy.draftVersion;
  if (rascunho) {
    await updatePricingPolicyVersion(rascunho.id, {
      tiers: comRegra.map((tier) => ({
        quantity: tier.quantity.toString(),
        uomCode: tier.uomCode,
        targetContributionMarginPercent: tier.targetContributionMarginPercent!.toString(),
        commissionPercent: tier.commissionPercent.toString(),
        notes: tier.notes,
      })),
    });
  }

  return getPricingPolicy(policy.id);
}
