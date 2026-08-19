import { Prisma } from "@prisma/client";
import type {
  IndustrialCostTemplate,
  IndustrialCostTemplateAdditionalCost,
  IndustrialCostTemplateResourceUsage,
  IndustrialCostTemplateVersion,
  IndustrialResource,
  User,
} from "@prisma/client";
import type {
  CostTemplateDTO,
  CostTemplateListResponse,
  CostTemplateSummaryDTO,
  CostTemplateVersionDTO,
  TemplateDiffDTO,
  TemplateDiffEntryDTO,
} from "@veridi/shared";
import { INDUSTRIAL_COST_TEMPLATE_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  CostTemplateEmptyError,
  CostTemplateEnergyResourceRequiredError,
  CostTemplateNotFoundError,
  CostTemplateVersionNotFoundError,
  TemplateDraftExistsError,
  TemplateNotDraftError,
} from "./cost-templates.errors.js";
import type {
  CreateCostTemplateInput,
  ListTemplatesQuery,
  UpdateCostTemplateVersionInput,
  UpdateTemplateIdentityInput,
} from "./cost-templates.schemas.js";

/**
 * Biblioteca técnica de Estruturas de Custo.
 *
 * Responde "como normalmente produzimos este TIPO de produto": base de
 * produção, quais recursos e por quanto tempo, modo de energia, serviços e
 * rateios.
 *
 * O que NÃO vive aqui é a parte mais importante: tarifa, preço/hora e custo
 * calculado. O template diz "usar o misturador por 4 horas"; quanto vale essa
 * hora é resolvido pelo motor, na data de referência, pela tarifa vigente.
 * Congelar tarifa na matriz faria a biblioteca envelhecer sem ninguém
 * perceber — e um produto novo nasceria com o preço de energia de dois anos
 * atrás.
 */

const CODE_SEQUENCE = "industrial_cost_template_code_seq";

type UsageWithResource = IndustrialCostTemplateResourceUsage & {
  industrialResource: IndustrialResource;
};
type VersionWithRelations = IndustrialCostTemplateVersion & {
  industrialCostTemplate: IndustrialCostTemplate;
  resourceUsages: UsageWithResource[];
  additionalCosts: IndustrialCostTemplateAdditionalCost[];
  energyResource?: IndustrialResource | null;
  _count?: { derivedCostVersions: number };
};
type TemplateWithVersions = IndustrialCostTemplate & { versions: VersionWithRelations[] };

const versionInclude = {
  industrialCostTemplate: true,
  energyResource: true,
  resourceUsages: {
    include: { industrialResource: true },
    orderBy: { sortOrder: "asc" as const },
  },
  additionalCosts: { orderBy: { sortOrder: "asc" as const } },
  _count: { select: { derivedCostVersions: true } },
} as const;

const templateInclude = {
  versions: { include: versionInclude, orderBy: { versionNumber: "asc" as const } },
} as const;

export function toCostTemplateVersionDTO(version: VersionWithRelations): CostTemplateVersionDTO {
  return {
    id: version.id,
    industrialCostTemplateId: version.industrialCostTemplateId,
    templateCode: version.industrialCostTemplate.code,
    templateName: version.industrialCostTemplate.name,
    versionNumber: version.versionNumber,
    versionLabel: `V${version.versionNumber}`,
    status: version.status,
    referenceOutputQuantity: version.referenceOutputQuantity.toString(),
    referenceOutputUomCode: version.referenceOutputUomCode,
    energyCalculationMode: version.energyCalculationMode,
    energyResourceId: version.energyResourceId,
    energyResourceName: version.energyResource?.name ?? null,
    notes: version.notes,
    resourceUsages: version.resourceUsages.map((usage) => ({
      id: usage.id,
      industrialResourceId: usage.industrialResourceId,
      resourceCode: usage.industrialResource.code,
      resourceName: usage.industrialResource.name,
      resourceType: usage.industrialResource.type,
      usageBasis: usage.usageBasis,
      usageQuantity: usage.usageQuantity.toString(),
      usageUom: usage.usageUom,
      notes: usage.notes,
      sortOrder: usage.sortOrder,
    })),
    additionalCosts: version.additionalCosts.map((cost) => ({
      id: cost.id,
      category: cost.category,
      description: cost.description,
      calculationBasis: cost.calculationBasis,
      rateValue: cost.rateValue ? cost.rateValue.toString() : null,
      notes: cost.notes,
      sortOrder: cost.sortOrder,
    })),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedBy: version.activatedBy,
    archivedAt: version.archivedAt ? version.archivedAt.toISOString() : null,
    sourceVersionId: version.sourceVersionId,
    sourceVersionNumber: version.sourceVersionNumber,
    usageCount: version._count?.derivedCostVersions ?? 0,
  };
}

function toCostTemplateDTO(template: TemplateWithVersions): CostTemplateDTO {
  const versions = template.versions.map(toCostTemplateVersionDTO);
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    archived: template.archivedAt !== null,
    archivedAt: template.archivedAt ? template.archivedAt.toISOString() : null,
    activeVersion: versions.find((version) => version.status === "ACTIVE") ?? null,
    draftVersion: versions.find((version) => version.status === "DRAFT") ?? null,
    versions,
    createdAt: template.createdAt.toISOString(),
    createdBy: template.createdBy,
    updatedAt: template.updatedAt.toISOString(),
  };
}

function toSummaryDTO(template: TemplateWithVersions): CostTemplateSummaryDTO {
  const ativa = template.versions.find((version) => version.status === "ACTIVE") ?? null;
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    archived: template.archivedAt !== null,
    activeVersionId: ativa?.id ?? null,
    activeVersionNumber: ativa?.versionNumber ?? null,
    referenceOutputQuantity: ativa ? ativa.referenceOutputQuantity.toString() : null,
    referenceOutputUomCode: ativa?.referenceOutputUomCode ?? null,
    resourceCount: ativa?.resourceUsages.length ?? 0,
    additionalCostCount: ativa?.additionalCosts.length ?? 0,
    resourceNames: ativa ? ativa.resourceUsages.map((usage) => usage.industrialResource.name) : [],
    hasDraft: template.versions.some((version) => version.status === "DRAFT"),
    updatedAt: template.updatedAt.toISOString(),
  };
}

async function requireTemplate(id: string): Promise<TemplateWithVersions> {
  const template = await getPrisma().industrialCostTemplate.findUnique({
    where: { id },
    include: templateInclude,
  });
  if (!template) throw new CostTemplateNotFoundError(id);
  return template;
}

export async function requireCostTemplateVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().industrialCostTemplateVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new CostTemplateVersionNotFoundError(id);
  return version;
}

export async function getCostTemplate(id: string): Promise<CostTemplateDTO> {
  return toCostTemplateDTO(await requireTemplate(id));
}

export async function getCostTemplateVersion(id: string): Promise<CostTemplateVersionDTO> {
  return toCostTemplateVersionDTO(await requireCostTemplateVersion(id));
}

/**
 * Biblioteca pesquisável.
 *
 * A busca cobre código, nome e o NOME DO RECURSO: quem procura uma matriz
 * industrial costuma lembrar do equipamento antes do nome dado à configuração.
 */
export async function listCostTemplates(
  query: ListTemplatesQuery,
  pagination: Pagination,
): Promise<CostTemplateListResponse> {
  const prisma = getPrisma();
  const termo = query.search?.trim();

  const where: Prisma.IndustrialCostTemplateWhereInput = {
    ...(query.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...(termo
      ? {
          OR: [
            { code: { contains: termo, mode: "insensitive" } },
            { name: { contains: termo, mode: "insensitive" } },
            { description: { contains: termo, mode: "insensitive" } },
            {
              versions: {
                some: {
                  status: "ACTIVE",
                  resourceUsages: {
                    some: {
                      industrialResource: {
                        OR: [
                          { code: { contains: termo, mode: "insensitive" } },
                          { name: { contains: termo, mode: "insensitive" } },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [total, templates] = await Promise.all([
    prisma.industrialCostTemplate.count({ where }),
    prisma.industrialCostTemplate.findMany({
      where,
      include: templateInclude,
      orderBy: { updatedAt: "desc" },
      ...pageArgs(pagination),
    }),
  ]);

  return { templates: templates.map(toSummaryDTO), ...pageMeta(pagination, total) };
}

export async function createCostTemplate(
  input: CreateCostTemplateInput,
  actor: User,
): Promise<CostTemplateDTO> {
  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, INDUSTRIAL_COST_TEMPLATE_CODE_PREFIX);

  const created = await prisma.industrialCostTemplate.create({
    data: {
      code,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      createdBy: actor.name,
      // A matriz nasce com a V1 em rascunho — um template sem versão nenhuma
      // seria uma pasta vazia que ninguém sabe o que fazer com.
      versions: {
        create: {
          versionNumber: 1,
          status: "DRAFT",
          referenceOutputQuantity: new Prisma.Decimal(input.referenceOutputQuantity ?? "1000"),
          referenceOutputUomCode: input.referenceOutputUomCode ?? "un",
          createdBy: actor.name,
        },
      },
    },
  });

  return getCostTemplate(created.id);
}

export async function updateCostTemplateIdentity(
  id: string,
  input: UpdateTemplateIdentityInput,
): Promise<CostTemplateDTO> {
  await requireTemplate(id);
  await getPrisma().industrialCostTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return getCostTemplate(id);
}

export async function setCostTemplateArchived(
  id: string,
  archived: boolean,
  actor: User,
): Promise<CostTemplateDTO> {
  await requireTemplate(id);
  await getPrisma().industrialCostTemplate.update({
    where: { id },
    data: archived
      ? { archivedAt: new Date(), archivedBy: actor.name }
      : { archivedAt: null, archivedBy: null },
  });
  return getCostTemplate(id);
}

export async function updateCostTemplateVersion(
  id: string,
  input: UpdateCostTemplateVersionInput,
): Promise<CostTemplateVersionDTO> {
  const current = await requireCostTemplateVersion(id);
  if (current.status !== "DRAFT") throw new TemplateNotDraftError(current.status);

  const modo = input.energyCalculationMode ?? current.energyCalculationMode;
  const recursoEnergia =
    input.energyResourceId !== undefined ? input.energyResourceId : current.energyResourceId;
  // Mesma regra da estrutura operacional: energia derivada precisa de um
  // recurso declarado — escolher sozinho seria inventar premissa econômica.
  if (modo === "FROM_EQUIPMENT" && !recursoEnergia) {
    throw new CostTemplateEnergyResourceRequiredError();
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.industrialCostTemplateVersion.update({
      where: { id },
      data: {
        ...(input.referenceOutputQuantity !== undefined
          ? { referenceOutputQuantity: new Prisma.Decimal(input.referenceOutputQuantity) }
          : {}),
        ...(input.referenceOutputUomCode !== undefined
          ? { referenceOutputUomCode: input.referenceOutputUomCode }
          : {}),
        ...(input.energyCalculationMode !== undefined
          ? { energyCalculationMode: input.energyCalculationMode }
          : {}),
        ...(input.energyResourceId !== undefined
          ? { energyResourceId: input.energyResourceId }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        // Sair do modo derivado solta o recurso: deixá-lo escondido faria a
        // premissa ressuscitar sozinha quando alguém voltasse ao modo.
        ...(modo !== "FROM_EQUIPMENT" ? { energyResourceId: null } : {}),
      },
    });

    if (input.resourceUsages) {
      await tx.industrialCostTemplateResourceUsage.deleteMany({
        where: { industrialCostTemplateVersionId: id },
      });
      await tx.industrialCostTemplateResourceUsage.createMany({
        data: input.resourceUsages.map((usage, index) => ({
          industrialCostTemplateVersionId: id,
          industrialResourceId: usage.industrialResourceId,
          ...(usage.usageBasis ? { usageBasis: usage.usageBasis } : {}),
          usageQuantity: new Prisma.Decimal(usage.usageQuantity),
          usageUom: usage.usageUom,
          ...(usage.notes !== undefined ? { notes: usage.notes } : {}),
          sortOrder: index,
        })),
      });
    }

    if (input.additionalCosts) {
      await tx.industrialCostTemplateAdditionalCost.deleteMany({
        where: { industrialCostTemplateVersionId: id },
      });
      await tx.industrialCostTemplateAdditionalCost.createMany({
        data: input.additionalCosts.map((cost, index) => ({
          industrialCostTemplateVersionId: id,
          category: cost.category,
          description: cost.description,
          calculationBasis: cost.calculationBasis,
          ...(cost.rateValue ? { rateValue: new Prisma.Decimal(cost.rateValue) } : {}),
          ...(cost.notes !== undefined ? { notes: cost.notes } : {}),
          sortOrder: index,
        })),
      });
    }

    await tx.industrialCostTemplate.update({
      where: { id: current.industrialCostTemplateId },
      data: { updatedAt: new Date() },
    });
  });

  return getCostTemplateVersion(id);
}

export async function activateCostTemplateVersion(
  id: string,
  actor: User,
): Promise<CostTemplateVersionDTO> {
  const current = await requireCostTemplateVersion(id);
  if (current.status !== "DRAFT") throw new TemplateNotDraftError(current.status);
  if (current.resourceUsages.length === 0 && current.additionalCosts.length === 0) {
    throw new CostTemplateEmptyError();
  }

  await getPrisma().$transaction(async (tx) => {
    // A anterior é ARQUIVADA, não apagada: estruturas que nasceram dela
    // continuam apontando para ela e o rótulo precisa continuar significando.
    await tx.industrialCostTemplateVersion.updateMany({
      where: {
        industrialCostTemplateId: current.industrialCostTemplateId,
        status: "ACTIVE",
        id: { not: id },
      },
      data: { status: "ARCHIVED", archivedAt: new Date(), archivedBy: actor.name },
    });
    await tx.industrialCostTemplateVersion.update({
      where: { id },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedBy: actor.name },
    });
    await tx.industrialCostTemplate.update({
      where: { id: current.industrialCostTemplateId },
      data: { updatedAt: new Date() },
    });
  });

  return getCostTemplateVersion(id);
}

export async function createCostTemplateVersionFrom(
  sourceVersionId: string,
  actor: User,
): Promise<CostTemplateVersionDTO> {
  const source = await requireCostTemplateVersion(sourceVersionId);
  const prisma = getPrisma();

  const aberto = await prisma.industrialCostTemplateVersion.findFirst({
    where: { industrialCostTemplateId: source.industrialCostTemplateId, status: "DRAFT" },
    select: { versionNumber: true },
  });
  if (aberto) throw new TemplateDraftExistsError(aberto.versionNumber);

  const criadaId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM industrial_cost_templates WHERE id = ${source.industrialCostTemplateId} FOR UPDATE`;
    const maior = await tx.industrialCostTemplateVersion.aggregate({
      where: { industrialCostTemplateId: source.industrialCostTemplateId },
      _max: { versionNumber: true },
    });

    const criada = await tx.industrialCostTemplateVersion.create({
      data: {
        industrialCostTemplateId: source.industrialCostTemplateId,
        versionNumber: (maior._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        referenceOutputQuantity: source.referenceOutputQuantity,
        referenceOutputUomCode: source.referenceOutputUomCode,
        energyCalculationMode: source.energyCalculationMode,
        energyResourceId: source.energyResourceId,
        notes: source.notes,
        createdBy: actor.name,
        sourceVersionId: source.id,
        sourceVersionNumber: source.versionNumber,
        resourceUsages: {
          create: source.resourceUsages.map((usage) => ({
            industrialResourceId: usage.industrialResourceId,
            usageBasis: usage.usageBasis,
            usageQuantity: usage.usageQuantity,
            usageUom: usage.usageUom,
            notes: usage.notes,
            sortOrder: usage.sortOrder,
          })),
        },
        additionalCosts: {
          create: source.additionalCosts.map((cost) => ({
            category: cost.category,
            description: cost.description,
            calculationBasis: cost.calculationBasis,
            rateValue: cost.rateValue,
            notes: cost.notes,
            sortOrder: cost.sortOrder,
          })),
        },
      },
    });
    return criada.id;
  });

  return getCostTemplateVersion(criadaId);
}

// ─────────────────────────────────────────────────────────────── comparação

const MODO_ENERGIA: Record<string, string> = {
  NONE: "Não estruturada",
  DIRECT: "Informada diretamente",
  FROM_EQUIPMENT: "Derivada dos equipamentos",
};

const BASE_USO: Record<string, string> = {
  FIXED_PER_REFERENCE_BATCH: "Fixo por lote",
  PER_OUTPUT_UNIT: "Por unidade",
  PER_1000_OUTPUT_UNITS: "Por 1.000 unidades",
};

const BASE_CUSTO: Record<string, string> = {
  FIXED_PER_BATCH: "Fixo por lote",
  PER_OUTPUT_UNIT: "Por unidade",
  PER_1000_OUTPUT_UNITS: "Por 1.000 unidades",
  PER_SHIPPING_BOX: "Por caixa de expedição",
  PERCENT_OF_DIRECT_INDUSTRIAL_COST: "% do custo industrial direto",
};

export interface ComparavelEstrutura {
  label: string;
  referenceOutputQuantity: string;
  referenceOutputUomCode: string;
  energyCalculationMode: string;
  energyResourceName: string | null;
  resources: {
    name: string;
    usageQuantity: string;
    usageUom: string;
    usageBasis: string;
  }[];
  costs: {
    description: string;
    category: string;
    calculationBasis: string;
    rateValue: string | null;
  }[];
}

/**
 * Diff entre duas configurações industriais.
 *
 * Compara CONFIGURAÇÃO, nunca dinheiro resolvido por tarifa: mostrar "R$ 88 →
 * R$ 110" faria parecer que o template mudou quando só a tarifa do cadastro
 * mudou, e a decisão de comparar versões ficaria contaminada.
 */
export function compararEstruturas(
  de: ComparavelEstrutura,
  para: ComparavelEstrutura,
): TemplateDiffDTO {
  const entries: TemplateDiffEntryDTO[] = [];
  const anotar = (
    kind: TemplateDiffEntryDTO["kind"],
    label: string,
    field: string | null,
    from: string | null,
    to: string | null,
  ) => {
    if (from !== to) entries.push({ kind, label, field, from, to });
  };

  anotar(
    "BASIS",
    "Base de produção",
    null,
    `${de.referenceOutputQuantity} ${de.referenceOutputUomCode}`,
    `${para.referenceOutputQuantity} ${para.referenceOutputUomCode}`,
  );
  anotar(
    "ENERGY_MODE",
    "Modo de energia",
    null,
    MODO_ENERGIA[de.energyCalculationMode] ?? de.energyCalculationMode,
    MODO_ENERGIA[para.energyCalculationMode] ?? para.energyCalculationMode,
  );
  anotar("ENERGY_RESOURCE", "Recurso de energia", null, de.energyResourceName, para.energyResourceName);

  const deRecursos = new Map(de.resources.map((r) => [r.name, r]));
  const paraRecursos = new Map(para.resources.map((r) => [r.name, r]));
  for (const recurso of para.resources) {
    if (!deRecursos.has(recurso.name)) {
      entries.push({
        kind: "RESOURCE_ADDED",
        label: recurso.name,
        field: null,
        from: null,
        to: `${recurso.usageQuantity} ${recurso.usageUom}`,
      });
    }
  }
  for (const recurso of de.resources) {
    if (!paraRecursos.has(recurso.name)) {
      entries.push({
        kind: "RESOURCE_REMOVED",
        label: recurso.name,
        field: null,
        from: `${recurso.usageQuantity} ${recurso.usageUom}`,
        to: null,
      });
    }
  }
  for (const recurso of para.resources) {
    const anterior = deRecursos.get(recurso.name);
    if (!anterior) continue;
    if (anterior.usageQuantity !== recurso.usageQuantity) {
      entries.push({
        kind: "RESOURCE_CHANGED",
        label: recurso.name,
        field: "Uso",
        from: `${anterior.usageQuantity} ${anterior.usageUom}`,
        to: `${recurso.usageQuantity} ${recurso.usageUom}`,
      });
    }
    if (anterior.usageBasis !== recurso.usageBasis) {
      entries.push({
        kind: "RESOURCE_CHANGED",
        label: recurso.name,
        field: "Modo de uso",
        from: BASE_USO[anterior.usageBasis] ?? anterior.usageBasis,
        to: BASE_USO[recurso.usageBasis] ?? recurso.usageBasis,
      });
    }
  }

  const deCustos = new Map(de.costs.map((c) => [c.description, c]));
  const paraCustos = new Map(para.costs.map((c) => [c.description, c]));
  for (const custo of para.costs) {
    if (!deCustos.has(custo.description)) {
      entries.push({
        kind: "COST_ADDED",
        label: custo.description,
        field: null,
        from: null,
        to: custo.rateValue,
      });
    }
  }
  for (const custo of de.costs) {
    if (!paraCustos.has(custo.description)) {
      entries.push({
        kind: "COST_REMOVED",
        label: custo.description,
        field: null,
        from: custo.rateValue,
        to: null,
      });
    }
  }
  for (const custo of para.costs) {
    const anterior = deCustos.get(custo.description);
    if (!anterior) continue;
    if (anterior.rateValue !== custo.rateValue) {
      entries.push({
        kind: "COST_CHANGED",
        label: custo.description,
        field: "Valor",
        from: anterior.rateValue,
        to: custo.rateValue,
      });
    }
    if (anterior.calculationBasis !== custo.calculationBasis) {
      entries.push({
        kind: "COST_CHANGED",
        label: custo.description,
        field: "Base de cálculo",
        from: BASE_CUSTO[anterior.calculationBasis] ?? anterior.calculationBasis,
        to: BASE_CUSTO[custo.calculationBasis] ?? custo.calculationBasis,
      });
    }
  }

  return { fromLabel: de.label, toLabel: para.label, entries };
}

export function estruturaComparavel(version: VersionWithRelations): ComparavelEstrutura {
  return {
    label: `${version.industrialCostTemplate.code} · V${version.versionNumber}`,
    referenceOutputQuantity: version.referenceOutputQuantity.toString(),
    referenceOutputUomCode: version.referenceOutputUomCode,
    energyCalculationMode: version.energyCalculationMode,
    energyResourceName: version.energyResource?.name ?? null,
    resources: version.resourceUsages.map((usage) => ({
      name: usage.industrialResource.name,
      usageQuantity: usage.usageQuantity.toString(),
      usageUom: usage.usageUom,
      usageBasis: usage.usageBasis,
    })),
    costs: version.additionalCosts.map((cost) => ({
      description: cost.description,
      category: cost.category,
      calculationBasis: cost.calculationBasis,
      rateValue: cost.rateValue ? cost.rateValue.toString() : null,
    })),
  };
}

export async function compareCostTemplateVersions(
  fromId: string,
  toId: string,
): Promise<TemplateDiffDTO> {
  const [de, para] = await Promise.all([
    requireCostTemplateVersion(fromId),
    requireCostTemplateVersion(toId),
  ]);
  return compararEstruturas(estruturaComparavel(de), estruturaComparavel(para));
}
