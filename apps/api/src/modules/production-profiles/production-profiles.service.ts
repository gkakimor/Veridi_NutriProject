import { Prisma } from "@prisma/client";
import type {
  IndustrialResource,
  ProductionProfile,
  ProductionProfileStep,
  ProductionProfileStepResource,
  ProductionProfileVersion,
  User,
} from "@prisma/client";
import type {
  ProductProductionProfileDTO,
  ProductionPlan,
  ProductionProfileDTO,
  ProductionProfileDefaultProductDTO,
  ProductionProfileListResponse,
  ProductionProfileSummaryDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";
import {
  PRODUCTION_PROFILE_CODE_PREFIX,
  isCapacityResourceType,
  planProductionProfile,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  CapacityResourceNotAllowedError,
  DuplicateStepResourceError,
  ProductWithoutUnitError,
  ProductionProfileDraftExistsError,
  ProductionProfileEmptyError,
  ProductionProfileNotFoundError,
  ProductionProfileProductNotFoundError,
  ProductionProfileUomIncompatibleError,
  ProductionProfileUomNotFoundError,
  ProductionProfileVersionNotActiveError,
  ProductionProfileVersionNotDraftError,
  ProductionProfileVersionNotFoundError,
  StepResourceInactiveError,
  StepResourceNotFoundError,
} from "./production-profiles.errors.js";
import type {
  CreateProductionProfileParsed,
  ListProductionProfilesQuery,
  UpdateProductionProfileIdentityParsed,
  UpdateProductionProfileVersionParsed,
} from "./production-profiles.schemas.js";

/**
 * PLANEJAMENTO — Perfis de Produção (`PRODUCT_RULES.md` §89).
 *
 * Roteiro reutilizável de COMO um produto é produzido: etapas sequenciais,
 * preparação e execução separadas, e os recursos que cada etapa ocupa ao mesmo
 * tempo. Planejamento não toca custo, formulação nem Ordem de Produção: o
 * produto só aponta para uma versão ativa como padrão, e a OP futura vai
 * receber CÓPIA (PLANNING-OP-SNAPSHOT-01), nunca vínculo vivo.
 */

const CODE_SEQUENCE = "production_profile_code_seq";

type StepResourceWithResource = ProductionProfileStepResource & {
  industrialResource: IndustrialResource;
};
type StepWithResources = ProductionProfileStep & { resources: StepResourceWithResource[] };
type VersionWithRelations = ProductionProfileVersion & {
  productionProfile: ProductionProfile;
  steps: StepWithResources[];
  _count?: { defaultForProducts: number };
};
type ProfileWithVersions = ProductionProfile & { versions: VersionWithRelations[] };

const versionInclude = {
  productionProfile: true,
  steps: {
    orderBy: { sequence: "asc" as const },
    include: {
      resources: { orderBy: { sortOrder: "asc" as const }, include: { industrialResource: true } },
    },
  },
  _count: { select: { defaultForProducts: true } },
} as const;

const profileInclude = {
  versions: { include: versionInclude, orderBy: { versionNumber: "asc" as const } },
} as const;

export function toProductionProfileVersionDTO(
  version: VersionWithRelations,
): ProductionProfileVersionDTO {
  return {
    id: version.id,
    productionProfileId: version.productionProfileId,
    profileCode: version.productionProfile.code,
    profileName: version.productionProfile.name,
    versionNumber: version.versionNumber,
    versionLabel: `V${version.versionNumber}`,
    status: version.status,
    referenceQuantity: version.referenceQuantity.toString(),
    referenceUomCode: version.referenceUomCode,
    notes: version.notes,
    steps: version.steps.map((step) => ({
      id: step.id,
      sequence: step.sequence,
      name: step.name,
      description: step.description,
      setupDurationMinutes: step.setupDurationMinutes,
      runDurationMinutes: step.runDurationMinutes,
      scalingMode: step.scalingMode,
      resources: step.resources.map((resource) => ({
        id: resource.id,
        industrialResourceId: resource.industrialResourceId,
        resourceCode: resource.industrialResource.code,
        resourceName: resource.industrialResource.name,
        resourceType: resource.industrialResource.type,
        resourceActive: resource.industrialResource.active,
        resourceQuantity: resource.resourceQuantity,
        notes: resource.notes,
        sortOrder: resource.sortOrder,
      })),
    })),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedBy: version.activatedBy,
    archivedAt: version.archivedAt ? version.archivedAt.toISOString() : null,
    sourceVersionId: version.sourceVersionId,
    sourceVersionNumber: version.sourceVersionNumber,
  };
}

function toSummaryDTO(profile: ProfileWithVersions): ProductionProfileSummaryDTO {
  const ativa = profile.versions.find((version) => version.status === "ACTIVE") ?? null;
  return {
    id: profile.id,
    code: profile.code,
    name: profile.name,
    description: profile.description,
    activeVersionId: ativa?.id ?? null,
    activeVersionNumber: ativa?.versionNumber ?? null,
    referenceQuantity: ativa ? ativa.referenceQuantity.toString() : null,
    referenceUomCode: ativa?.referenceUomCode ?? null,
    stepNames: ativa ? ativa.steps.map((step) => step.name) : [],
    hasDraft: profile.versions.some((version) => version.status === "DRAFT"),
    defaultProductCount: profile.versions.reduce(
      (soma, version) => soma + (version._count?.defaultForProducts ?? 0),
      0,
    ),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

async function requireProfile(id: string): Promise<ProfileWithVersions> {
  const profile = await getPrisma().productionProfile.findUnique({
    where: { id },
    include: profileInclude,
  });
  if (!profile) throw new ProductionProfileNotFoundError(id);
  return profile;
}

async function requireVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().productionProfileVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new ProductionProfileVersionNotFoundError(id);
  return version;
}

/** Produtos que têm uma versão deste perfil como padrão — de qualquer situação. */
async function defaultProductsOf(profileId: string): Promise<ProductionProfileDefaultProductDTO[]> {
  const products = await getPrisma().product.findMany({
    where: { defaultProductionProfileVersion: { productionProfileId: profileId } },
    select: {
      id: true,
      code: true,
      name: true,
      defaultProductionProfileVersion: { select: { id: true, versionNumber: true, status: true } },
    },
    orderBy: { code: "asc" },
  });
  return products.flatMap((product) => {
    const version = product.defaultProductionProfileVersion;
    if (!version) return [];
    return [
      {
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        versionId: version.id,
        versionNumber: version.versionNumber,
        versionStatus: version.status,
      },
    ];
  });
}

export async function getProductionProfile(id: string): Promise<ProductionProfileDTO> {
  const profile = await requireProfile(id);
  const versions = profile.versions.map(toProductionProfileVersionDTO);
  return {
    id: profile.id,
    code: profile.code,
    name: profile.name,
    description: profile.description,
    activeVersion: versions.find((version) => version.status === "ACTIVE") ?? null,
    draftVersion: versions.find((version) => version.status === "DRAFT") ?? null,
    versions,
    defaultProducts: await defaultProductsOf(profile.id),
    createdAt: profile.createdAt.toISOString(),
    createdBy: profile.createdBy,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export async function getProductionProfileVersion(id: string): Promise<ProductionProfileVersionDTO> {
  return toProductionProfileVersionDTO(await requireVersion(id));
}

export async function listProductionProfiles(
  query: ListProductionProfilesQuery,
  pagination: Pagination,
): Promise<ProductionProfileListResponse> {
  const prisma = getPrisma();
  const termo = query.search?.trim();
  const where: Prisma.ProductionProfileWhereInput = {
    archivedAt: null,
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

  const [total, profiles] = await Promise.all([
    prisma.productionProfile.count({ where }),
    prisma.productionProfile.findMany({
      where,
      include: profileInclude,
      orderBy: { updatedAt: "desc" },
      ...pageArgs(pagination),
    }),
  ]);

  return { profiles: profiles.map(toSummaryDTO), ...pageMeta(pagination, total) };
}

async function exigirUnidade(code: string): Promise<void> {
  const unit = await getPrisma().unitOfMeasure.findUnique({ where: { code } });
  if (!unit) throw new ProductionProfileUomNotFoundError(code);
}

interface EtapaComRecursos {
  name: string;
  resources: readonly { industrialResourceId: string }[];
}

/**
 * Recurso de etapa é CAPACIDADE: mão de obra ou equipamento, do cadastro,
 * ativo, uma linha por recurso. Energia é recusada nomeando o recurso — ela
 * continua na Estrutura de Custos.
 */
async function exigirRecursosDeCapacidade(etapas: readonly EtapaComRecursos[]): Promise<void> {
  const ids = [
    ...new Set(etapas.flatMap((etapa) => etapa.resources.map((r) => r.industrialResourceId))),
  ];
  if (ids.length === 0) return;
  const recursos = await getPrisma().industrialResource.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, type: true, active: true },
  });
  const porId = new Map(recursos.map((recurso) => [recurso.id, recurso]));

  for (const etapa of etapas) {
    const vistos = new Set<string>();
    for (const linha of etapa.resources) {
      const recurso = porId.get(linha.industrialResourceId);
      if (!recurso) throw new StepResourceNotFoundError(linha.industrialResourceId);
      if (!isCapacityResourceType(recurso.type)) throw new CapacityResourceNotAllowedError(recurso.name);
      if (!recurso.active) throw new StepResourceInactiveError(recurso.name);
      if (vistos.has(recurso.id)) throw new DuplicateStepResourceError(etapa.name, recurso.name);
      vistos.add(recurso.id);
    }
  }
}

/**
 * Trava a linha da versão e confere, DENTRO da transação, que ela ainda é
 * rascunho. Sem isso uma edição que leu "rascunho" antes de uma ativação
 * concorrente regravaria as etapas de uma versão já congelada.
 */
async function travarRascunho(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const linhas = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text AS status FROM production_profile_versions WHERE id = ${id} FOR UPDATE`;
  const status = linhas[0]?.status;
  if (!status) throw new ProductionProfileVersionNotFoundError(id);
  if (status !== "DRAFT") throw new ProductionProfileVersionNotDraftError(status);
}

export async function createProductionProfile(
  input: CreateProductionProfileParsed,
  actor: User,
): Promise<ProductionProfileDTO> {
  const prisma = getPrisma();
  const unidade = input.referenceUomCode ?? "un";
  await exigirUnidade(unidade);
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, PRODUCTION_PROFILE_CODE_PREFIX);

  const created = await prisma.productionProfile.create({
    data: {
      code,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      createdBy: actor.name,
      // Nasce com a V1 em rascunho: perfil sem versão seria uma pasta vazia.
      versions: {
        create: {
          versionNumber: 1,
          status: "DRAFT",
          referenceQuantity: new Prisma.Decimal(input.referenceQuantity ?? "1000"),
          referenceUomCode: unidade,
          createdBy: actor.name,
        },
      },
    },
  });

  return getProductionProfile(created.id);
}

export async function updateProductionProfileIdentity(
  id: string,
  input: UpdateProductionProfileIdentityParsed,
): Promise<ProductionProfileDTO> {
  await requireProfile(id);
  await getPrisma().productionProfile.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return getProductionProfile(id);
}

/**
 * Salva o rascunho. As etapas chegam INTEIRAS, na ordem de execução, e
 * substituem as anteriores: a posição vira a sequência (1, 2, 3…).
 */
export async function updateProductionProfileVersion(
  id: string,
  input: UpdateProductionProfileVersionParsed,
): Promise<ProductionProfileVersionDTO> {
  const current = await requireVersion(id);
  if (current.status !== "DRAFT") throw new ProductionProfileVersionNotDraftError(current.status);
  if (input.referenceUomCode !== undefined) await exigirUnidade(input.referenceUomCode);
  if (input.steps) await exigirRecursosDeCapacidade(input.steps);

  await getPrisma().$transaction(async (tx) => {
    await travarRascunho(tx, id);
    await tx.productionProfileVersion.update({
      where: { id },
      data: {
        ...(input.referenceQuantity !== undefined
          ? { referenceQuantity: new Prisma.Decimal(input.referenceQuantity) }
          : {}),
        ...(input.referenceUomCode !== undefined ? { referenceUomCode: input.referenceUomCode } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (input.steps) {
      // Apagar a etapa apaga os recursos dela (cascade) — só no rascunho.
      await tx.productionProfileStep.deleteMany({ where: { productionProfileVersionId: id } });
      for (const [indice, etapa] of input.steps.entries()) {
        await tx.productionProfileStep.create({
          data: {
            productionProfileVersionId: id,
            sequence: indice + 1,
            name: etapa.name,
            ...(etapa.description !== undefined ? { description: etapa.description } : {}),
            setupDurationMinutes: etapa.setupDurationMinutes,
            runDurationMinutes: etapa.runDurationMinutes,
            scalingMode: etapa.scalingMode,
            resources: {
              create: etapa.resources.map((recurso, ordem) => ({
                industrialResourceId: recurso.industrialResourceId,
                resourceQuantity: recurso.resourceQuantity,
                ...(recurso.notes !== undefined ? { notes: recurso.notes } : {}),
                sortOrder: ordem,
              })),
            },
          },
        });
      }
    }

    await tx.productionProfile.update({
      where: { id: current.productionProfileId },
      data: { updatedAt: new Date() },
    });
  });

  return getProductionProfileVersion(id);
}

/**
 * Ativa o rascunho: ele fica congelado e a ativa anterior é ARQUIVADA, nunca
 * apagada — produtos que a escolheram como padrão continuam apontando para
 * ela, e ativar não move esse ponteiro sozinho (§89).
 */
export async function activateProductionProfileVersion(
  id: string,
  actor: User,
): Promise<ProductionProfileVersionDTO> {
  const current = await requireVersion(id);
  if (current.status !== "DRAFT") throw new ProductionProfileVersionNotDraftError(current.status);
  if (current.steps.length === 0) throw new ProductionProfileEmptyError();
  // O cadastro pode ter mudado desde o salvamento (recurso inativado).
  await exigirRecursosDeCapacidade(current.steps);

  await getPrisma().$transaction(async (tx) => {
    await travarRascunho(tx, id);
    const agora = new Date();

    const anteriores = await tx.productionProfileVersion.findMany({
      where: { productionProfileId: current.productionProfileId, status: "ACTIVE", id: { not: id } },
      select: { id: true },
    });
    const idsAnteriores = anteriores.map((versao) => versao.id);

    await tx.productionProfileVersion.updateMany({
      where: { id: { in: idsAnteriores } },
      data: { status: "ARCHIVED", archivedAt: agora, archivedBy: actor.name },
    });
    await tx.productionProfileVersion.update({
      where: { id },
      data: { status: "ACTIVE", activatedAt: agora, activatedBy: actor.name },
    });

    /*
     * O perfil padrão é a configuração que as PRÓXIMAS ordens devem usar:
     * quem apontava para a versão recém-arquivada avança com ela, na MESMA
     * transação. Produto de outro perfil, ou sem perfil, não é tocado — o
     * sistema só acompanha um padrão que alguém já escolheu. Ordem existente
     * não muda: ela receberá cópia (PLANNING-OP-SNAPSHOT-01).
     */
    if (idsAnteriores.length > 0) {
      await tx.product.updateMany({
        where: { defaultProductionProfileVersionId: { in: idsAnteriores } },
        data: { defaultProductionProfileVersionId: id },
      });
    }

    await tx.productionProfile.update({
      where: { id: current.productionProfileId },
      data: { updatedAt: agora },
    });
  });

  return getProductionProfileVersion(id);
}

/** Nova versão em rascunho, copiada inteira de uma versão congelada. */
export async function createProductionProfileVersionFrom(
  sourceVersionId: string,
  actor: User,
): Promise<ProductionProfileVersionDTO> {
  const source = await requireVersion(sourceVersionId);

  const criadaId = await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM production_profiles WHERE id = ${source.productionProfileId} FOR UPDATE`;
    const aberto = await tx.productionProfileVersion.findFirst({
      where: { productionProfileId: source.productionProfileId, status: "DRAFT" },
      select: { versionNumber: true },
    });
    if (aberto) throw new ProductionProfileDraftExistsError(aberto.versionNumber);

    const maior = await tx.productionProfileVersion.aggregate({
      where: { productionProfileId: source.productionProfileId },
      _max: { versionNumber: true },
    });

    const criada = await tx.productionProfileVersion.create({
      data: {
        productionProfileId: source.productionProfileId,
        versionNumber: (maior._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        referenceQuantity: source.referenceQuantity,
        referenceUomCode: source.referenceUomCode,
        notes: source.notes,
        createdBy: actor.name,
        sourceVersionId: source.id,
        sourceVersionNumber: source.versionNumber,
        steps: {
          create: source.steps.map((etapa) => ({
            sequence: etapa.sequence,
            name: etapa.name,
            description: etapa.description,
            setupDurationMinutes: etapa.setupDurationMinutes,
            runDurationMinutes: etapa.runDurationMinutes,
            scalingMode: etapa.scalingMode,
            resources: {
              create: etapa.resources.map((recurso) => ({
                industrialResourceId: recurso.industrialResourceId,
                resourceQuantity: recurso.resourceQuantity,
                notes: recurso.notes,
                sortOrder: recurso.sortOrder,
              })),
            },
          })),
        },
      },
    });

    await tx.productionProfile.update({
      where: { id: source.productionProfileId },
      data: { updatedAt: new Date() },
    });
    return criada.id;
  });

  return getProductionProfileVersion(criadaId);
}

/**
 * Prévia para uma quantidade, na unidade da base. Leitura pura: nada é
 * gravado — nem a simulação, nem carimbo de atualização.
 */
export async function previewProductionProfileVersion(
  id: string,
  quantity: string,
): Promise<ProductionPlan> {
  const version = await requireVersion(id);
  return planProductionProfile(
    {
      referenceQuantity: version.referenceQuantity.toString(),
      steps: version.steps.map((etapa) => ({
        sequence: etapa.sequence,
        name: etapa.name,
        setupDurationMinutes: etapa.setupDurationMinutes,
        runDurationMinutes: etapa.runDurationMinutes,
        scalingMode: etapa.scalingMode,
        resources: etapa.resources.map((recurso) => ({
          industrialResourceId: recurso.industrialResourceId,
          resourceName: recurso.industrialResource.name,
          resourceType: recurso.industrialResource.type,
          resourceQuantity: recurso.resourceQuantity,
        })),
      })),
    },
    quantity,
  );
}

// ─────────────────────────────────────────────── Produto → perfil padrão

export async function getProductProductionProfile(
  productId: string,
): Promise<ProductProductionProfileDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      finishedProductItem: { select: { unitCode: true } },
      defaultProductionProfileVersion: { include: { productionProfile: true } },
    },
  });
  if (!product) throw new ProductionProfileProductNotFoundError(productId);

  const version = product.defaultProductionProfileVersion;

  return {
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    productUomCode: product.finishedProductItem?.unitCode ?? null,
    version: version
      ? {
          id: version.id,
          productionProfileId: version.productionProfileId,
          profileCode: version.productionProfile.code,
          profileName: version.productionProfile.name,
          versionNumber: version.versionNumber,
          status: version.status,
          referenceQuantity: version.referenceQuantity.toString(),
          referenceUomCode: version.referenceUomCode,
        }
      : null,
  };
}

/**
 * Define (ou tira) o Perfil de Produção padrão do produto.
 *
 * Só versão ATIVA, e só com a base na mesma dimensão da unidade do produto —
 * nada se converte entre dimensões. `null` tira o padrão: produto sem perfil
 * continua válido. Formulação, custo e OP não são tocados. Depois disso o
 * ponteiro acompanha sozinho as versões novas do MESMO perfil (§89, ativação).
 */
export async function setProductProductionProfile(
  productId: string,
  versionId: string | null,
): Promise<ProductProductionProfileDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { finishedProductItem: { include: { unit: true } } },
  });
  if (!product) throw new ProductionProfileProductNotFoundError(productId);

  if (versionId !== null) {
    const version = await prisma.productionProfileVersion.findUnique({
      where: { id: versionId },
      include: { referenceUom: true },
    });
    if (!version) throw new ProductionProfileVersionNotFoundError(versionId);
    if (version.status !== "ACTIVE") throw new ProductionProfileVersionNotActiveError(version.status);

    const unidadeDoProduto = product.finishedProductItem?.unit;
    if (!unidadeDoProduto) throw new ProductWithoutUnitError(product.code);
    if (unidadeDoProduto.dimension !== version.referenceUom.dimension) {
      throw new ProductionProfileUomIncompatibleError(version.referenceUomCode, unidadeDoProduto.code);
    }
  }

  await prisma.product.update({
    where: { id: productId },
    data: { defaultProductionProfileVersionId: versionId },
  });
  return getProductProductionProfile(productId);
}
