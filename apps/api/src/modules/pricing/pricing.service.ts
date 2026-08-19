import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  IndustrialCostCalculationDTO,
  IndustrialCostQuality,
  IndustrialCostWarningDTO,
  PricingRebaseChangeDTO,
  PricingRebasePreviewDTO,
  PricingRebaseTierDTO,
  PricingTierDTO,
  PricingVersionDTO,
  PricingVersionListResponse,
  PricingVersionSummaryDTO,
  ProductPricingResponse,
} from "@veridi/shared";
import { INDUSTRIAL_COST_QUALITY_LABELS } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getIndustrialCostCalculation } from "../industrial-cost-calculation/snapshot.service.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { isUomCompatible } from "../items/uom.js";
import {
  CalculationProductMismatchError,
  CalculationRequiredError,
  DuplicatedTierQuantityError,
  IncompleteCostActivationError,
  InvalidPricingPercentError,
  InvalidTierQuantityError,
  MissingTierPriceError,
  NoTiersToActivateError,
  OutdatedCostStructureError,
  PricingProductNotFoundError,
  PricingTierNotFoundError,
  PricingVersionLockedError,
  PricingVersionNotFoundError,
  TargetMarginWithoutPriceError,
} from "./pricing.errors.js";
import { costForOutputQuantity, pricingVersionInclude } from "./pricing-cost.js";
import type { CostVersionForPricing, TierCostResult } from "./pricing-cost.js";
import { computePrice } from "./pricing-math.js";
import type {
  ActivatePricingVersionInput,
  CreatePricingTierInput,
  CreatePricingVersionInput,
  ListPricingVersionsQuery,
  UpdatePricingTierInput,
  UpdatePricingVersionInput,
} from "./pricing.schemas.js";

/**
 * Precificação industrial.
 *
 * Três limites que sustentam a capacidade:
 *
 * 1. **proveniência**: uma precificação formal parte de um cálculo de custo
 *    SALVO. É ele que congela estrutura, formulação, referências de
 *    material, tarifas e data — sem isso não dá para dizer sobre qual custo
 *    o preço foi construído;
 * 2. **mesma base econômica para toda a versão**: as faixas de 300, 500 e
 *    1000 unidades são comparáveis porque compartilham o mesmo CALC. Custo
 *    novo exige CALC novo e versão nova;
 * 3. **o backend é a única fonte da matemática**: ativar recalcula tudo, e
 *    qualquer número enviado pela tela é ignorado.
 */

const CODE_SEQUENCE = "pricing_version_code_seq";
const CODE_PREFIX = "PREC";
const HUNDRED = new Prisma.Decimal(100);

const versionInclude = {
  product: { include: { customer: true, finishedProductItem: true } },
  industrialCostCalculation: true,
  // Nome atual da política de origem, só para o rótulo.
  originPricingPolicyVersion: { include: { pricingPolicyTemplate: true } },
  tiers: { orderBy: { quantity: "asc" } as PrismaTypes.PricingTierOrderByWithRelationInput },
} satisfies PrismaTypes.PricingVersionInclude;

type VersionWithRelations = PrismaTypes.PricingVersionGetPayload<{
  include: typeof versionInclude;
}>;
type TierRow = VersionWithRelations["tiers"][number];

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function unitMoney(value: Prisma.Decimal): string {
  return value.toFixed(6);
}

function percent(value: Prisma.Decimal): string {
  return value.toFixed(4);
}

/** Resultado congelado do CALC — a base econômica desta precificação. */
function calculationResult(version: VersionWithRelations): IndustrialCostCalculationDTO {
  return version.industrialCostCalculation.result as unknown as IndustrialCostCalculationDTO;
}

interface ComputedTier {
  tier: TierRow;
  cost: TierCostResult;
  price: ReturnType<typeof computePrice>;
}

async function computeTiers(version: VersionWithRelations): Promise<ComputedTier[]> {
  const prisma = getPrisma();
  const calculation = calculationResult(version);
  const costVersion = (await prisma.industrialCostVersion.findUnique({
    where: { id: calculation.industrialCostVersionId },
    include: pricingVersionInclude,
  })) as CostVersionForPricing | null;

  const computed: ComputedTier[] = [];
  for (const tier of version.tiers) {
    if (!costVersion) {
      computed.push({
        tier,
        cost: {
          quantity: tier.quantity,
          batchCount: new Prisma.Decimal(1),
          total: null,
          perUnit: null,
          per1000: null,
          knownSubtotal: new Prisma.Decimal(0),
          quality: "NO_COST",
          warnings: [
            {
              code: "COST_STRUCTURE_UNAVAILABLE",
              message: "A estrutura de custos do cálculo não está mais disponível.",
            },
          ],
          hasCustomerSuppliedMaterials: false,
        },
        price: computePrice({
          priceMode: tier.priceMode,
          quantity: tier.quantity,
          costPerUnit: null,
          targetMarginPercent: tier.targetContributionMarginPercent,
          commissionPercent: tier.commissionPercent,
          manualUnitPrice: tier.manualUnitPrice,
        }),
      });
      continue;
    }

    const cost = await costForOutputQuantity(prisma, {
      costVersion,
      calculation,
      quantity: tier.quantity,
      quantityUomCode: tier.uomCode,
    });
    const price = computePrice({
      priceMode: tier.priceMode,
      quantity: tier.quantity,
      costPerUnit: cost.perUnit,
      targetMarginPercent: tier.targetContributionMarginPercent,
      commissionPercent: tier.commissionPercent,
      manualUnitPrice: tier.manualUnitPrice,
    });
    computed.push({ tier, cost, price });
  }
  return computed;
}

/**
 * Faixa ATIVA é lida pelo snapshot; rascunho é recalculado ao vivo.
 *
 * Depois de ativa, uma compra nova, uma tarifa reajustada ou uma estrutura
 * nova não podem reescrever o preço que já foi negociado.
 */
function toTierDTO(entry: ComputedTier, frozen: boolean): PricingTierDTO {
  const { tier, cost, price } = entry;

  if (frozen) {
    const warnings = (tier.warningsSnapshot as unknown as IndustrialCostWarningDTO[] | null) ?? [];
    return {
      id: tier.id,
      quantity: tier.quantity.toString(),
      uomCode: tier.uomCode,
      priceMode: tier.priceMode,
      targetContributionMarginPercent: tier.targetMarginSnapshot
        ? percent(tier.targetMarginSnapshot)
        : null,
      commissionPercent: percent(tier.commissionPercentSnapshot ?? tier.commissionPercent),
      manualUnitPrice: tier.manualUnitPrice ? unitMoney(tier.manualUnitPrice) : null,
      notes: tier.notes,
      sortOrder: tier.sortOrder,

      industrialCostTotal: tier.costTotalSnapshot ? money(tier.costTotalSnapshot) : null,
      industrialCostPerUnit: tier.costPerUnitSnapshot ? unitMoney(tier.costPerUnitSnapshot) : null,
      costPer1000: tier.costPer1000Snapshot ? money(tier.costPer1000Snapshot) : null,
      knownSubtotal: money(tier.knownSubtotalSnapshot ?? new Prisma.Decimal(0)),
      costQuality: (tier.costQualitySnapshot ?? "NO_COST") as IndustrialCostQuality,
      batchCount: String(tier.batchCountSnapshot ?? 1),

      suggestedUnitPrice: tier.suggestedPriceSnapshot ? unitMoney(tier.suggestedPriceSnapshot) : null,
      selectedUnitPrice: tier.selectedPriceSnapshot ? unitMoney(tier.selectedPriceSnapshot) : null,
      commissionPerUnit: tier.commissionPerUnitSnapshot
        ? unitMoney(tier.commissionPerUnitSnapshot)
        : null,
      commissionTotal: tier.commissionTotalSnapshot ? money(tier.commissionTotalSnapshot) : null,
      grossRevenue: tier.grossRevenueSnapshot ? money(tier.grossRevenueSnapshot) : null,
      contributionPerUnit: tier.contributionPerUnitSnapshot
        ? unitMoney(tier.contributionPerUnitSnapshot)
        : null,
      contributionTotal: tier.contributionTotalSnapshot
        ? money(tier.contributionTotalSnapshot)
        : null,
      contributionMarginPercent: tier.contributionMarginSnapshot
        ? percent(tier.contributionMarginSnapshot)
        : null,
      markupPercent: tier.markupSnapshot ? percent(tier.markupSnapshot) : null,
      warnings,
    };
  }

  return {
    id: tier.id,
    quantity: tier.quantity.toString(),
    uomCode: tier.uomCode,
    priceMode: tier.priceMode,
    targetContributionMarginPercent: tier.targetContributionMarginPercent
      ? percent(tier.targetContributionMarginPercent)
      : null,
    commissionPercent: percent(tier.commissionPercent),
    manualUnitPrice: tier.manualUnitPrice ? unitMoney(tier.manualUnitPrice) : null,
    notes: tier.notes,
    sortOrder: tier.sortOrder,

    industrialCostTotal: cost.total ? money(cost.total) : null,
    industrialCostPerUnit: cost.perUnit ? unitMoney(cost.perUnit) : null,
    costPer1000: cost.per1000 ? money(cost.per1000) : null,
    knownSubtotal: money(cost.knownSubtotal),
    costQuality: cost.quality,
    batchCount: cost.batchCount.toString(),

    suggestedUnitPrice: price.suggestedUnitPrice ? unitMoney(price.suggestedUnitPrice) : null,
    selectedUnitPrice: price.selectedUnitPrice ? unitMoney(price.selectedUnitPrice) : null,
    commissionPerUnit: price.commissionPerUnit ? unitMoney(price.commissionPerUnit) : null,
    commissionTotal: price.commissionTotal ? money(price.commissionTotal) : null,
    grossRevenue: price.grossRevenue ? money(price.grossRevenue) : null,
    contributionPerUnit: price.contributionPerUnit
      ? unitMoney(price.contributionPerUnit)
      : null,
    contributionTotal: price.contributionTotal ? money(price.contributionTotal) : null,
    contributionMarginPercent: price.contributionMarginPercent
      ? percent(price.contributionMarginPercent)
      : null,
    markupPercent: price.markupPercent ? percent(price.markupPercent) : null,
    warnings: [...cost.warnings, ...price.warnings],
  };
}

async function toVersionDTO(version: VersionWithRelations): Promise<PricingVersionDTO> {
  const frozen = version.status !== "DRAFT";
  const computed = frozen
    ? version.tiers.map((tier) => ({
        tier,
        cost: null as unknown as TierCostResult,
        price: null as unknown as ReturnType<typeof computePrice>,
      }))
    : await computeTiers(version);

  const tiers = computed.map((entry) => toTierDTO(entry, frozen));
  const calculation = calculationResult(version);
  const warnings: IndustrialCostWarningDTO[] = [];

  const belowMinimum = version.product.minimumBatchQuantity
    ? tiers.filter((tier) =>
        new Prisma.Decimal(tier.quantity).lessThan(version.product.minimumBatchQuantity!),
      )
    : [];
  if (belowMinimum.length > 0) {
    // Não se corrige a quantidade do usuário — avisa-se.
    warnings.push({
      code: "BELOW_MINIMUM_BATCH",
      message: `Quantidade abaixo do lote mínimo cadastrado (${version.product.minimumBatchQuantity!.toString()}): ${belowMinimum
        .map((tier) => tier.quantity)
        .join(", ")}.`,
    });
  }

  return {
    id: version.id,
    code: version.code,
    label: `${version.code} · V${version.versionNumber}`,
    versionNumber: version.versionNumber,
    status: version.status,

    productId: version.productId,
    productCode: version.product.code,
    productName: version.product.name,
    customerName: version.product.customer?.legalName ?? null,

    industrialCostCalculationId: version.industrialCostCalculationId,
    calculationCode: version.calculationCodeSnapshot,
    industrialCostVersionLabel: version.industrialCostVersionLabelSnapshot,
    formulationVersionNumber: version.formulationVersionNumberSnapshot,
    costReferenceDate: version.costReferenceDateSnapshot.toISOString(),
    costQuality: version.costQualitySnapshot,
    referenceOutputQuantity: calculation.referenceOutputQuantity,
    referenceOutputUomCode: calculation.referenceOutputUomCode,
    minimumBatchQuantity: version.product.minimumBatchQuantity
      ? version.product.minimumBatchQuantity.toString()
      : null,

    tiers,
    pricingComplete: tiers.length > 0 && tiers.every((tier) => tier.selectedUnitPrice !== null),
    hasCustomerSuppliedMaterials: calculation.hasCustomerSuppliedMaterials,
    warnings,

    notes: version.notes,
    createdAt: version.createdAt.toISOString(),
    createdByName: version.createdByNameSnapshot,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedByName: version.activatedByNameSnapshot,
    // Proveniência na política — a política guarda regra, não preço.
    originPricingPolicyVersionId: version.originPricingPolicyVersionId,
    originPricingPolicyCode: version.originPricingPolicyCode,
    originPricingPolicyVersionNumber: version.originPricingPolicyVersionNumber,
    originPricingPolicyName:
      version.originPricingPolicyVersion?.pricingPolicyTemplate.name ?? null,
  };
}

function toSummaryDTO(version: VersionWithRelations): PricingVersionSummaryDTO {
  return {
    id: version.id,
    code: version.code,
    label: `${version.code} · V${version.versionNumber}`,
    versionNumber: version.versionNumber,
    status: version.status,
    productId: version.productId,
    productCode: version.product.code,
    productName: version.product.name,
    customerName: version.product.customer?.legalName ?? null,
    calculationCode: version.calculationCodeSnapshot,
    industrialCostVersionLabel: version.industrialCostVersionLabelSnapshot,
    costReferenceDate: version.costReferenceDateSnapshot.toISOString(),
    costQuality: version.costQualitySnapshot,
    tierCount: version.tiers.length,
    updatedAt: version.updatedAt.toISOString(),
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
  };
}

async function requireVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().pricingVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new PricingVersionNotFoundError(id);
  return version;
}

async function requireDraft(id: string): Promise<VersionWithRelations> {
  const version = await requireVersion(id);
  if (version.status !== "DRAFT") throw new PricingVersionLockedError(version.status);
  return version;
}

export async function getPricingVersion(id: string): Promise<PricingVersionDTO> {
  return toVersionDTO(await requireVersion(id));
}

/**
 * O que mudaria ao refazer esta precificação sobre o custo vigente.
 *
 * Só leitura — a versão atual não é tocada. Serve para quem decide ver a
 * diferença antes: trocar de base pode mexer só na data do cálculo ou pode
 * dobrar o custo por unidade, e a tela não tinha como distinguir os dois.
 *
 * O alvo é o cálculo salvo MAIS RECENTE do produto. Se for o mesmo que a
 * versão já usa, não há o que prever e `targetCalculationId` volta nulo.
 */
export async function getPricingRebasePreview(id: string): Promise<PricingRebasePreviewDTO> {
  const prisma = getPrisma();
  const version = await requireVersion(id);

  const atual = await prisma.industrialCostCalculation.findUnique({
    where: { id: version.industrialCostCalculationId },
    include: { industrialCostVersion: { select: { code: true, versionNumber: true } } },
  });
  const alvo = await prisma.industrialCostCalculation.findFirst({
    where: { productId: version.productId },
    orderBy: [{ costReferenceDate: "desc" }, { calculatedAt: "desc" }],
    include: { industrialCostVersion: { select: { code: true, versionNumber: true } } },
  });

  const base: PricingRebasePreviewDTO = {
    pricingVersionId: version.id,
    pricingVersionLabel: `${version.code} · V${version.versionNumber}`,
    mode: version.status === "DRAFT" ? "IN_PLACE" : "NEW_VERSION",
    targetQuality: null,
    targetCalculationId: null,
    targetCalculationCode: null,
    changes: [],
    tiers: [],
  };
  if (!alvo || !atual || alvo.id === atual.id) return base;

  const changes: PricingRebaseChangeDTO[] = [];
  const anotar = (label: string, from: string, to: string) => {
    if (from !== to) changes.push({ label, from, to });
  };
  anotar("Cálculo de custo", atual.code, alvo.code);
  anotar(
    "Estrutura de custos",
    `${atual.industrialCostVersion.code} · V${atual.industrialCostVersion.versionNumber}`,
    `${alvo.industrialCostVersion.code} · V${alvo.industrialCostVersion.versionNumber}`,
  );
  anotar(
    "Formulação",
    `V${atual.formulationVersionNumber}`,
    `V${alvo.formulationVersionNumber}`,
  );
  anotar(
    "Data de referência do custo",
    atual.costReferenceDate.toISOString(),
    alvo.costReferenceDate.toISOString(),
  );
  anotar(
    "Qualidade do custo",
    INDUSTRIAL_COST_QUALITY_LABELS[atual.quality],
    INDUSTRIAL_COST_QUALITY_LABELS[alvo.quality],
  );

  /*
   * Custo por faixa nas DUAS bases, pelo mesmo motor da precificação: dizer
   * "o cálculo mudou" sem dizer o que acontece com o custo de cada faixa
   * deixaria a decisão sem o número que importa.
   */
  const [versaoAtual, versaoAlvo, snapshotAtual, snapshotAlvo] = await Promise.all([
    prisma.industrialCostVersion.findUnique({
      where: { id: atual.industrialCostVersionId },
      include: pricingVersionInclude,
    }),
    prisma.industrialCostVersion.findUnique({
      where: { id: alvo.industrialCostVersionId },
      include: pricingVersionInclude,
    }),
    getIndustrialCostCalculation(atual.id),
    getIndustrialCostCalculation(alvo.id),
  ]);

  const tiers: PricingRebaseTierDTO[] = [];
  for (const tier of version.tiers) {
    const de =
      versaoAtual &&
      (await costForOutputQuantity(prisma, {
        costVersion: versaoAtual as CostVersionForPricing,
        calculation: snapshotAtual,
        quantity: tier.quantity,
        quantityUomCode: tier.uomCode,
      }));
    const para =
      versaoAlvo &&
      (await costForOutputQuantity(prisma, {
        costVersion: versaoAlvo as CostVersionForPricing,
        calculation: snapshotAlvo,
        quantity: tier.quantity,
        quantityUomCode: tier.uomCode,
      }));
    tiers.push({
      quantity: tier.quantity.toString(),
      uomCode: tier.uomCode,
      costPerUnitFrom: de && de.perUnit ? de.perUnit.toFixed(4) : null,
      costPerUnitTo: para && para.perUnit ? para.perUnit.toFixed(4) : null,
      unitPrice: tier.selectedPriceSnapshot
        ? tier.selectedPriceSnapshot.toFixed(4)
        : tier.manualUnitPrice
          ? tier.manualUnitPrice.toFixed(4)
          : null,
    });
  }

  return {
    ...base,
    targetQuality: alvo.quality,
    targetCalculationId: alvo.id,
    targetCalculationCode: alvo.code,
    changes,
    tiers,
  };
}

/**
 * Troca a base econômica desta precificação pelo cálculo indicado.
 *
 * O caminho depende do status, e é por isso que existe como operação própria
 * em vez de "criar versão": `createPricingVersion` devolve o rascunho já
 * aberto do produto quando existe um — comportamento correto para não
 * multiplicar negociação paralela, mas que engolia em silêncio o cálculo
 * pedido. Quem clicava em refazer a base de um rascunho recebia de volta o
 * mesmo rascunho, com a mesma base, e a tela reaparecia idêntica.
 *
 * Rascunho troca a base no lugar. Versão ativa é preço acordado: nasce um
 * rascunho novo com as faixas copiadas, e a ativa fica intacta.
 */
export async function rebasePricingVersion(
  id: string,
  calculationId: string,
  actor: User,
): Promise<PricingVersionDTO> {
  const prisma = getPrisma();
  const version = await requireVersion(id);

  const calculation = await prisma.industrialCostCalculation.findUnique({
    where: { id: calculationId },
    include: { industrialCostVersion: { select: { code: true, versionNumber: true } } },
  });
  if (!calculation) throw new CalculationRequiredError();
  if (calculation.productId !== version.productId) throw new CalculationProductMismatchError();

  if (version.status !== "DRAFT") {
    /*
     * Versão ativa não se reescreve. Mas o produto admite UM rascunho: se já
     * houver um aberto, é nele que a base entra — criar outro esbarraria na
     * mesma porta e devolveria o rascunho com a base antiga.
     */
    const aberto = await prisma.pricingVersion.findFirst({
      where: { productId: version.productId, status: "DRAFT" },
      select: { id: true },
    });
    if (aberto) return rebasePricingVersion(aberto.id, calculationId, actor);
    return createPricingVersion(
      version.productId,
      { industrialCostCalculationId: calculationId },
      actor,
    );
  }

  /*
   * As faixas seguem sem tocar: elas guardam o PLANO (quantidade, margem,
   * comissão, preço manual). Os números econômicos de faixa só nascem na
   * ativação, então não há snapshot velho para limpar aqui.
   */
  await prisma.pricingVersion.update({
    where: { id },
    data: {
      industrialCostCalculationId: calculation.id,
      calculationCodeSnapshot: calculation.code,
      industrialCostVersionLabelSnapshot: `${calculation.industrialCostVersion.code} · V${calculation.industrialCostVersion.versionNumber}`,
      formulationVersionNumberSnapshot: calculation.formulationVersionNumber,
      costReferenceDateSnapshot: calculation.costReferenceDate,
      costQualitySnapshot: calculation.quality,
    },
  });
  return getPricingVersion(id);
}

export async function getProductPricing(productId: string): Promise<ProductPricingResponse> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new PricingProductNotFoundError(productId);

  const versions = await prisma.pricingVersion.findMany({
    where: { productId },
    include: versionInclude,
    orderBy: { versionNumber: "desc" },
  });

  const draft = versions.find((version) => version.status === "DRAFT") ?? null;
  const current = versions.find((version) => version.status === "ACTIVE") ?? null;

  return {
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    draft: draft ? await toVersionDTO(draft) : null,
    current: current ? await toVersionDTO(current) : null,
    versions: versions.map(toSummaryDTO),
  };
}

export async function listPricingVersions(
  query: ListPricingVersionsQuery,
  pagination: Pagination = query,
): Promise<PricingVersionListResponse> {
  const prisma = getPrisma();
  const where: PrismaTypes.PricingVersionWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.quality ? { costQualitySnapshot: query.quality } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.customerId ? { product: { customerId: query.customerId } } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { calculationCodeSnapshot: { contains: query.search, mode: "insensitive" } },
            { product: { code: { contains: query.search, mode: "insensitive" } } },
            { product: { name: { contains: query.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.pricingVersion.findMany({
      where,
      include: versionInclude,
      orderBy: [{ updatedAt: "desc" }],
      ...pageArgs(pagination),
    }),
    prisma.pricingVersion.count({ where }),
  ]);

  return { pricingVersions: rows.map(toSummaryDTO), ...pageMeta(pagination, total) };
}

/**
 * Cria (ou reabre) o rascunho de precificação de um produto.
 *
 * Com rascunho aberto, devolve o existente: manter dois rascunhos por
 * produto seria multiplicar negociação paralela sem dono.
 */
export async function createPricingVersion(
  productId: string,
  input: CreatePricingVersionInput,
  actor: User,
): Promise<PricingVersionDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new PricingProductNotFoundError(productId);

  const existingDraft = await prisma.pricingVersion.findFirst({
    where: { productId, status: "DRAFT" },
  });
  if (existingDraft) return getPricingVersion(existingDraft.id);

  if (!input.industrialCostCalculationId) throw new CalculationRequiredError();
  const calculation = await prisma.industrialCostCalculation.findUnique({
    where: { id: input.industrialCostCalculationId },
    include: { industrialCostVersion: { select: { code: true, versionNumber: true } } },
  });
  if (!calculation) throw new CalculationRequiredError();
  if (calculation.productId !== productId) throw new CalculationProductMismatchError();

  const previous = await prisma.pricingVersion.findFirst({
    where: { productId, status: "ACTIVE" },
    include: { tiers: { orderBy: { quantity: "asc" } } },
  });

  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, CODE_PREFIX);

  const createdId = await prisma.$transaction(async (tx) => {
    // Sequencial por produto sob lock — nunca MAX(versionNumber)+1 solto.
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
    const last = await tx.pricingVersion.findFirst({
      where: { productId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });

    const created = await tx.pricingVersion.create({
      data: {
        code,
        productId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        status: "DRAFT",
        industrialCostCalculationId: calculation.id,
        calculationCodeSnapshot: calculation.code,
        industrialCostVersionLabelSnapshot: `${calculation.industrialCostVersion.code} · V${calculation.industrialCostVersion.versionNumber}`,
        formulationVersionNumberSnapshot: calculation.formulationVersionNumber,
        costReferenceDateSnapshot: calculation.costReferenceDate,
        costQualitySnapshot: calculation.quality,
        ...(input.notes !== undefined ? { notes: input.notes } : { notes: previous?.notes ?? null }),
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
    });

    // Copia o PLANO comercial (faixas, margens, comissões); os snapshots
    // econômicos e a auditoria de ativação ficam para trás.
    if (previous && previous.tiers.length > 0) {
      await tx.pricingTier.createMany({
        data: previous.tiers.map((tier) => ({
          pricingVersionId: created.id,
          quantity: tier.quantity,
          uomCode: tier.uomCode,
          priceMode: tier.priceMode,
          targetContributionMarginPercent: tier.targetContributionMarginPercent,
          commissionPercent: tier.commissionPercent,
          manualUnitPrice: tier.manualUnitPrice,
          notes: tier.notes,
          sortOrder: tier.sortOrder,
        })),
      });
    }

    return created.id;
  });

  return getPricingVersion(createdId);
}

export async function updatePricingVersion(
  id: string,
  input: UpdatePricingVersionInput,
  _actor: User,
): Promise<PricingVersionDTO> {
  await requireDraft(id);
  await getPrisma().pricingVersion.update({
    where: { id },
    data: { ...(input.notes !== undefined ? { notes: input.notes } : {}) },
  });
  return getPricingVersion(id);
}

function assertPercents(
  targetMargin: Prisma.Decimal | null,
  commission: Prisma.Decimal,
): void {
  if (commission.lessThan(0) || commission.greaterThanOrEqualTo(HUNDRED)) {
    throw new InvalidPricingPercentError("A comissão deve ficar entre 0% e 100%.");
  }
  if (!targetMargin) return;
  if (targetMargin.lessThan(0) || targetMargin.greaterThanOrEqualTo(HUNDRED)) {
    throw new InvalidPricingPercentError("A margem desejada deve ficar entre 0% e 100%.");
  }
  if (targetMargin.plus(commission).greaterThanOrEqualTo(HUNDRED)) {
    // Denominador zero ou negativo: nenhum preço satisfaz a conta.
    throw new InvalidPricingPercentError(
      "Margem somada à comissão atinge 100% — não existe preço que satisfaça.",
    );
  }
}

export async function createPricingTier(
  versionId: string,
  input: CreatePricingTierInput,
  _actor: User,
): Promise<PricingVersionDTO> {
  const prisma = getPrisma();
  const version = await requireDraft(versionId);

  const quantity = new Prisma.Decimal(input.quantity);
  if (quantity.lessThanOrEqualTo(0)) throw new InvalidTierQuantityError();

  const finishedUnit = version.product.finishedProductItem?.unitCode ?? "un";
  const uomCode = input.uomCode ?? finishedUnit;
  const units = await prisma.unitOfMeasure.findMany();
  if (!isUomCompatible(uomCode, finishedUnit, units)) {
    throw new InvalidTierQuantityError(
      `Unidade ${uomCode} não é compatível com a unidade do produto acabado (${finishedUnit}).`,
    );
  }

  const duplicated = version.tiers.find((tier) => tier.quantity.equals(quantity));
  if (duplicated) throw new DuplicatedTierQuantityError(quantity.toString());

  const targetMargin =
    input.targetContributionMarginPercent != null
      ? new Prisma.Decimal(input.targetContributionMarginPercent)
      : null;
  const commission = new Prisma.Decimal(input.commissionPercent ?? "0");
  assertPercents(input.priceMode === "TARGET_MARGIN" ? targetMargin : null, commission);

  await prisma.pricingTier.create({
    data: {
      pricingVersionId: versionId,
      quantity,
      uomCode,
      priceMode: input.priceMode,
      ...(targetMargin ? { targetContributionMarginPercent: targetMargin } : {}),
      commissionPercent: commission,
      ...(input.manualUnitPrice != null
        ? { manualUnitPrice: new Prisma.Decimal(input.manualUnitPrice) }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      sortOrder: version.tiers.length,
    },
  });

  return getPricingVersion(versionId);
}

export async function updatePricingTier(
  tierId: string,
  input: UpdatePricingTierInput,
  _actor: User,
): Promise<PricingVersionDTO> {
  const prisma = getPrisma();
  const tier = await prisma.pricingTier.findUnique({ where: { id: tierId } });
  if (!tier) throw new PricingTierNotFoundError(tierId);
  const version = await requireDraft(tier.pricingVersionId);

  const quantity = input.quantity ? new Prisma.Decimal(input.quantity) : tier.quantity;
  if (quantity.lessThanOrEqualTo(0)) throw new InvalidTierQuantityError();
  if (
    input.quantity &&
    version.tiers.some((other) => other.id !== tierId && other.quantity.equals(quantity))
  ) {
    throw new DuplicatedTierQuantityError(quantity.toString());
  }

  const priceMode = input.priceMode ?? tier.priceMode;
  const targetMargin =
    input.targetContributionMarginPercent !== undefined
      ? input.targetContributionMarginPercent === null
        ? null
        : new Prisma.Decimal(input.targetContributionMarginPercent)
      : tier.targetContributionMarginPercent;
  const commission =
    input.commissionPercent !== undefined
      ? new Prisma.Decimal(input.commissionPercent)
      : tier.commissionPercent;
  assertPercents(priceMode === "TARGET_MARGIN" ? targetMargin : null, commission);

  await prisma.pricingTier.update({
    where: { id: tierId },
    data: {
      quantity,
      priceMode,
      targetContributionMarginPercent: targetMargin,
      commissionPercent: commission,
      ...(input.manualUnitPrice !== undefined
        ? {
            manualUnitPrice:
              input.manualUnitPrice === null ? null : new Prisma.Decimal(input.manualUnitPrice),
          }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  return getPricingVersion(tier.pricingVersionId);
}

export async function deletePricingTier(tierId: string, _actor: User): Promise<PricingVersionDTO> {
  const prisma = getPrisma();
  const tier = await prisma.pricingTier.findUnique({ where: { id: tierId } });
  if (!tier) throw new PricingTierNotFoundError(tierId);
  await requireDraft(tier.pricingVersionId);

  await prisma.pricingTier.delete({ where: { id: tierId } });
  return getPricingVersion(tier.pricingVersionId);
}

/**
 * Ativa a precificação congelando TODOS os números.
 *
 * O backend recalcula do zero: preço, comissão e contribuição enviados pela
 * tela são ignorados. A versão ativa anterior vira inativa na mesma
 * transação — nunca duas ativas para o mesmo produto.
 */
export async function activatePricingVersion(
  id: string,
  input: ActivatePricingVersionInput,
  actor: User,
): Promise<PricingVersionDTO> {
  const prisma = getPrisma();
  const version = await requireDraft(id);

  if (version.tiers.length === 0) throw new NoTiersToActivateError();

  const computed = await computeTiers(version);

  const withoutPrice = computed.filter((entry) => entry.price.selectedUnitPrice === null);
  const targetWithoutPrice = withoutPrice.filter(
    (entry) => entry.tier.priceMode === "TARGET_MARGIN",
  );
  if (targetWithoutPrice.length > 0) {
    throw new TargetMarginWithoutPriceError(
      targetWithoutPrice.map((entry) => entry.tier.quantity.toString()),
    );
  }
  if (withoutPrice.length > 0) {
    throw new MissingTierPriceError(withoutPrice.map((entry) => entry.tier.quantity.toString()));
  }

  const incompleteCost = computed.filter(
    (entry) => entry.cost.quality === "PARTIAL" || entry.cost.quality === "NO_COST",
  );
  if (incompleteCost.length > 0 && !input.confirmIncompleteCost) {
    throw new IncompleteCostActivationError(
      incompleteCost.map((entry) => entry.tier.quantity.toString()),
    );
  }

  // A EC do cálculo pode não ser mais a ativa do produto: o CALC continua
  // sendo um snapshot histórico válido, mas ativar preço sobre estrutura
  // superada é decisão explícita.
  const calculation = calculationResult(version);
  const activeStructure = await prisma.industrialCostVersion.findFirst({
    where: { productId: version.productId, status: "ACTIVE" },
    select: { id: true },
  });
  if (
    activeStructure &&
    activeStructure.id !== calculation.industrialCostVersionId &&
    !input.confirmOutdatedStructure
  ) {
    throw new OutdatedCostStructureError(version.industrialCostVersionLabelSnapshot);
  }

  await prisma.$transaction(async (tx) => {
    await tx.pricingVersion.updateMany({
      where: { productId: version.productId, status: "ACTIVE" },
      data: { status: "INACTIVE" },
    });

    for (const entry of computed) {
      await tx.pricingTier.update({
        where: { id: entry.tier.id },
        data: {
          costTotalSnapshot: entry.cost.total,
          costPerUnitSnapshot: entry.cost.perUnit,
          costPer1000Snapshot: entry.cost.per1000,
          knownSubtotalSnapshot: entry.cost.knownSubtotal,
          costQualitySnapshot: entry.cost.quality,
          batchCountSnapshot: entry.cost.batchCount.toNumber(),
          targetMarginSnapshot: entry.tier.targetContributionMarginPercent,
          commissionPercentSnapshot: entry.tier.commissionPercent,
          suggestedPriceSnapshot: entry.price.suggestedUnitPrice,
          selectedPriceSnapshot: entry.price.selectedUnitPrice,
          commissionPerUnitSnapshot: entry.price.commissionPerUnit,
          commissionTotalSnapshot: entry.price.commissionTotal,
          grossRevenueSnapshot: entry.price.grossRevenue,
          contributionPerUnitSnapshot: entry.price.contributionPerUnit,
          contributionTotalSnapshot: entry.price.contributionTotal,
          contributionMarginSnapshot: entry.price.contributionMarginPercent,
          markupSnapshot: entry.price.markupPercent,
          warningsSnapshot: [
            ...entry.cost.warnings,
            ...entry.price.warnings,
          ] as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await tx.pricingVersion.update({
      where: { id },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
        activatedByUserId: actor.id,
        activatedByNameSnapshot: actor.name,
      },
    });
  });

  return getPricingVersion(id);
}

/**
 * Read model para a integração da próxima capacidade: precificação ATIVA de
 * um produto com suas faixas. Escolher a faixa para uma quantidade cotada é
 * decisão da 47 — aqui só se entrega o que existe.
 */
export async function getActivePricingForProduct(
  productId: string,
): Promise<PricingVersionDTO | null> {
  const version = await getPrisma().pricingVersion.findFirst({
    where: { productId, status: "ACTIVE" },
    include: versionInclude,
  });
  return version ? toVersionDTO(version) : null;
}
