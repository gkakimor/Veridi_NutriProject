import { Prisma } from "@prisma/client";
import type {
  FormulationTemplate,
  FormulationTemplateComponent,
  FormulationTemplateVersion,
  Item,
  UnitOfMeasure,
  User,
} from "@prisma/client";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateDiffDTO,
  FormulationTemplateDiffEntryDTO,
  FormulationTemplateListResponse,
  FormulationTemplateSummaryDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";
import { FORMULATION_TEMPLATE_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { isUomCompatible } from "../items/uom.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  ComponentItemNotFoundError,
  DuplicateComponentItemError,
  IncompatibleComponentUnitError,
  InactiveComponentItemError,
  InvalidComponentItemTypeError,
  InvalidComponentQuantityError,
} from "../formulations/formulations.errors.js";
import {
  FormulationTemplateNotFoundError,
  FormulationTemplateVersionNotFoundError,
  TemplateArchivedError,
  TemplateDosesRequiredError,
  TemplateDraftAlreadyExistsError,
  TemplateVersionNotDraftError,
  TemplateVersionWithoutComponentsError,
} from "./formulation-templates.errors.js";
import type {
  CreateFormulationTemplateInput,
  ListFormulationTemplatesQuery,
  UpdateFormulationTemplateInput,
  UpdateFormulationTemplateVersionInput,
} from "./formulation-templates.schemas.js";

/**
 * Biblioteca técnica de Formulações.
 *
 * Uma matriz reutilizável entre clientes. O template não é a formulação de
 * ninguém: usá-lo COPIA os dados para uma `FormulationVersion` do Produto, e a
 * partir daí as duas vidas seguem separadas.
 *
 * A alternativa — vários produtos apontando para a mesma formulação viva —
 * foi recusada de propósito: mexer na receita de um cliente reescreveria a de
 * outro, e ninguém descobriria antes da produção. Por isso não existe
 * sincronização, atualização em massa nem "aplicar em todos os produtos".
 */

const CODE_SEQUENCE = "formulation_template_code_seq";

type ComponentWithItem = FormulationTemplateComponent & { item: Item };
type VersionWithRelations = FormulationTemplateVersion & {
  formulationTemplate: FormulationTemplate;
  components: ComponentWithItem[];
  _count?: { derivedFormulationVersions: number };
};
type TemplateWithVersions = FormulationTemplate & {
  versions: VersionWithRelations[];
};

const versionInclude = {
  formulationTemplate: true,
  components: { include: { item: true }, orderBy: { position: "asc" as const } },
  _count: { select: { derivedFormulationVersions: true } },
} as const;

const templateInclude = {
  versions: {
    include: versionInclude,
    orderBy: { versionNumber: "asc" as const },
  },
} as const;

function toComponentDTO(component: ComponentWithItem): FormulationTemplateComponentDTO {
  return {
    id: component.id,
    itemId: component.itemId,
    itemCode: component.item.code,
    itemName: component.item.name,
    itemType: component.item.type,
    itemActive: component.item.active,
    quantity: component.quantity.toString(),
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    purityPercentApplied: component.purityPercentApplied
      ? component.purityPercentApplied.toString()
      : null,
    overagePercent: component.overagePercent ? component.overagePercent.toString() : null,
    notes: component.notes,
    position: component.position,
  };
}

export function toTemplateVersionDTO(
  version: VersionWithRelations,
): FormulationTemplateVersionDTO {
  return {
    id: version.id,
    formulationTemplateId: version.formulationTemplateId,
    templateCode: version.formulationTemplate.code,
    templateName: version.formulationTemplate.name,
    versionNumber: version.versionNumber,
    versionLabel: `V${version.versionNumber}`,
    status: version.status,
    basisQuantity: version.basisQuantity.toString(),
    calculationMode: version.calculationMode,
    dosesPerPackage: version.dosesPerPackage,
    outputUnitCode: version.outputUnitCode,
    notes: version.notes,
    components: version.components.map(toComponentDTO),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedBy: version.activatedBy,
    archivedAt: version.archivedAt ? version.archivedAt.toISOString() : null,
    sourceVersionId: version.sourceVersionId,
    sourceVersionNumber: version.sourceVersionNumber,
    usageCount: version._count?.derivedFormulationVersions ?? 0,
  };
}

function toTemplateDTO(template: TemplateWithVersions): FormulationTemplateDTO {
  const versions = template.versions.map(toTemplateVersionDTO);
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

function toSummaryDTO(template: TemplateWithVersions): FormulationTemplateSummaryDTO {
  const ativa = template.versions.find((version) => version.status === "ACTIVE") ?? null;
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    archived: template.archivedAt !== null,
    activeVersionId: ativa?.id ?? null,
    activeVersionNumber: ativa?.versionNumber ?? null,
    basisQuantity: ativa ? ativa.basisQuantity.toString() : null,
    outputUnitCode: ativa?.outputUnitCode ?? null,
    calculationMode: ativa?.calculationMode ?? null,
    componentCount: ativa?.components.length ?? 0,
    componentItemCodes: ativa ? ativa.components.map((c) => c.item.code) : [],
    hasDraft: template.versions.some((version) => version.status === "DRAFT"),
    updatedAt: template.updatedAt.toISOString(),
  };
}

async function requireTemplate(id: string): Promise<TemplateWithVersions> {
  const template = await getPrisma().formulationTemplate.findUnique({
    where: { id },
    include: templateInclude,
  });
  if (!template) throw new FormulationTemplateNotFoundError(id);
  return template;
}

export async function requireTemplateVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().formulationTemplateVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new FormulationTemplateVersionNotFoundError(id);
  return version;
}

export async function getFormulationTemplate(id: string): Promise<FormulationTemplateDTO> {
  return toTemplateDTO(await requireTemplate(id));
}

export async function getFormulationTemplateVersion(
  id: string,
): Promise<FormulationTemplateVersionDTO> {
  return toTemplateVersionDTO(await requireTemplateVersion(id));
}

/**
 * Biblioteca pesquisável.
 *
 * A busca cobre código, nome e o CÓDIGO DOS COMPONENTES: quem procura uma
 * matriz costuma lembrar do princípio ativo antes do nome que alguém deu ao
 * template.
 */
export async function listFormulationTemplates(
  query: ListFormulationTemplatesQuery,
  pagination: Pagination,
): Promise<FormulationTemplateListResponse> {
  const prisma = getPrisma();
  const termo = query.search?.trim();

  const where: Prisma.FormulationTemplateWhereInput = {
    ...(query.archived === undefined
      ? // Arquivado sai da lista por padrão: a biblioteca mostra o que se usa.
        { archivedAt: null }
      : query.archived
        ? { archivedAt: { not: null } }
        : { archivedAt: null }),
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
                  components: {
                    some: {
                      item: {
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
    prisma.formulationTemplate.count({ where }),
    prisma.formulationTemplate.findMany({
      where,
      include: templateInclude,
      orderBy: { updatedAt: "desc" },
      ...pageArgs(pagination),
    }),
  ]);

  return {
    templates: templates.map(toSummaryDTO),
    ...pageMeta(pagination, total),
  };
}

/** Valida componentes com as MESMAS regras da formulação de produto. */
async function validateComponents(
  inputs: { itemId: string; quantity: string; unitCode: string }[],
  previousItemIds: ReadonlySet<string>,
  units: readonly UnitOfMeasure[],
): Promise<void> {
  const prisma = getPrisma();
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.itemId)) {
      const item = await prisma.item.findUnique({ where: { id: input.itemId } });
      throw new DuplicateComponentItemError(item?.code ?? input.itemId);
    }
    seen.add(input.itemId);
  }

  for (const input of inputs) {
    const item = await prisma.item.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ComponentItemNotFoundError(input.itemId);
    if (item.type === "FINISHED_PRODUCT") throw new InvalidComponentItemTypeError(item.code);
    // Item inativado depois só bloqueia se for linha genuinamente nova.
    if (!previousItemIds.has(input.itemId) && !item.active) {
      throw new InactiveComponentItemError(item.code);
    }
    if (new Prisma.Decimal(input.quantity).lessThanOrEqualTo(0)) {
      throw new InvalidComponentQuantityError(item.code);
    }
    if (!isUomCompatible(input.unitCode, item.unitCode, units)) {
      throw new IncompatibleComponentUnitError(item.code);
    }
  }
}

export async function createFormulationTemplate(
  input: CreateFormulationTemplateInput,
  actor: User,
): Promise<FormulationTemplateDTO> {
  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, FORMULATION_TEMPLATE_CODE_PREFIX);
  const modo = input.calculationMode ?? "FIXED_BASIS";
  if (modo === "PER_DOSE" && !input.dosesPerPackage) throw new TemplateDosesRequiredError();

  const created = await prisma.formulationTemplate.create({
    data: {
      code,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      createdBy: actor.name,
      // A matriz nasce com a V1 em rascunho: um template sem versão nenhuma
      // seria uma pasta vazia que ninguém sabe o que fazer com.
      versions: {
        create: {
          versionNumber: 1,
          status: "DRAFT",
          basisQuantity: new Prisma.Decimal(input.basisQuantity ?? "1"),
          calculationMode: modo,
          ...(input.dosesPerPackage ? { dosesPerPackage: input.dosesPerPackage } : {}),
          outputUnitCode: input.outputUnitCode ?? "un",
          createdBy: actor.name,
        },
      },
    },
  });

  return getFormulationTemplate(created.id);
}

export async function updateFormulationTemplate(
  id: string,
  input: UpdateFormulationTemplateInput,
): Promise<FormulationTemplateDTO> {
  await requireTemplate(id);
  await getPrisma().formulationTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return getFormulationTemplate(id);
}

/**
 * Arquivar/desarquivar.
 *
 * Arquivar tira da biblioteca de escolha sem apagar nada: formulações criadas
 * a partir dele continuam válidas e continuam mostrando a origem.
 */
export async function setFormulationTemplateArchived(
  id: string,
  archived: boolean,
  actor: User,
): Promise<FormulationTemplateDTO> {
  await requireTemplate(id);
  await getPrisma().formulationTemplate.update({
    where: { id },
    data: archived
      ? { archivedAt: new Date(), archivedBy: actor.name }
      : { archivedAt: null, archivedBy: null },
  });
  return getFormulationTemplate(id);
}

export async function updateFormulationTemplateVersion(
  id: string,
  input: UpdateFormulationTemplateVersionInput,
): Promise<FormulationTemplateVersionDTO> {
  const current = await requireTemplateVersion(id);
  // Versão ativa é histórica: para mudar, cria-se uma nova.
  if (current.status !== "DRAFT") throw new TemplateVersionNotDraftError(current.status);

  const modo = input.calculationMode ?? current.calculationMode;
  const doses = input.dosesPerPackage !== undefined ? input.dosesPerPackage : current.dosesPerPackage;
  if (modo === "PER_DOSE" && !doses) throw new TemplateDosesRequiredError();

  if (input.components) {
    const units = await getPrisma().unitOfMeasure.findMany();
    const anteriores = new Set(current.components.map((component) => component.itemId));
    await validateComponents(input.components, anteriores, units);
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.formulationTemplateVersion.update({
      where: { id },
      data: {
        ...(input.basisQuantity !== undefined
          ? { basisQuantity: new Prisma.Decimal(input.basisQuantity) }
          : {}),
        ...(input.outputUnitCode !== undefined ? { outputUnitCode: input.outputUnitCode } : {}),
        ...(input.calculationMode !== undefined ? { calculationMode: input.calculationMode } : {}),
        ...(input.dosesPerPackage !== undefined ? { dosesPerPackage: input.dosesPerPackage } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        // Modo FIXED_BASIS não carrega doses: deixá-las escondidas faria a
        // fórmula ressuscitar um número que ninguém está vendo.
        ...(modo === "FIXED_BASIS" ? { dosesPerPackage: null } : {}),
      },
    });

    if (input.components) {
      await tx.formulationTemplateComponent.deleteMany({
        where: { formulationTemplateVersionId: id },
      });
      await tx.formulationTemplateComponent.createMany({
        data: input.components.map((component, index) => ({
          formulationTemplateVersionId: id,
          itemId: component.itemId,
          quantity: new Prisma.Decimal(component.quantity),
          unitCode: component.unitCode,
          ...(component.basis ? { basis: component.basis } : {}),
          ...(component.supplyResponsibility
            ? { supplyResponsibility: component.supplyResponsibility }
            : {}),
          ...(component.purityPercentApplied
            ? { purityPercentApplied: new Prisma.Decimal(component.purityPercentApplied) }
            : {}),
          ...(component.overagePercent
            ? { overagePercent: new Prisma.Decimal(component.overagePercent) }
            : {}),
          ...(component.notes !== undefined ? { notes: component.notes } : {}),
          position: index,
        })),
      });
    }

    await tx.formulationTemplate.update({
      where: { id: current.formulationTemplateId },
      data: { updatedAt: new Date() },
    });
  });

  return getFormulationTemplateVersion(id);
}

/**
 * Ativar a versão.
 *
 * A versão anterior vai para ARCHIVED, não para "apagada": formulações que
 * nasceram dela continuam apontando para ela, e o rótulo "criada a partir de
 * V1" precisa continuar significando alguma coisa.
 */
export async function activateFormulationTemplateVersion(
  id: string,
  actor: User,
): Promise<FormulationTemplateVersionDTO> {
  const current = await requireTemplateVersion(id);
  if (current.status !== "DRAFT") throw new TemplateVersionNotDraftError(current.status);
  if (current.components.length === 0) throw new TemplateVersionWithoutComponentsError();

  await getPrisma().$transaction(async (tx) => {
    // Uma ativa por template — o índice único parcial no banco garante o
    // invariante; este update é o caminho normal para chegar lá.
    await tx.formulationTemplateVersion.updateMany({
      where: {
        formulationTemplateId: current.formulationTemplateId,
        status: "ACTIVE",
        id: { not: id },
      },
      data: { status: "ARCHIVED", archivedAt: new Date(), archivedBy: actor.name },
    });
    await tx.formulationTemplateVersion.update({
      where: { id },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedBy: actor.name },
    });
    await tx.formulationTemplate.update({
      where: { id: current.formulationTemplateId },
      data: { updatedAt: new Date() },
    });
  });

  return getFormulationTemplateVersion(id);
}

/**
 * Nova versão a partir da ativa.
 *
 * Copia tudo para um rascunho. A ativa continua ativa até alguém ativar a
 * nova explicitamente — trocar a matriz da biblioteca no meio da edição
 * mudaria o que os outros estão escolhendo agora.
 */
export async function createTemplateVersionFrom(
  sourceVersionId: string,
  actor: User,
): Promise<FormulationTemplateVersionDTO> {
  const source = await requireTemplateVersion(sourceVersionId);
  const prisma = getPrisma();

  const rascunhoAberto = await prisma.formulationTemplateVersion.findFirst({
    where: { formulationTemplateId: source.formulationTemplateId, status: "DRAFT" },
    select: { versionNumber: true },
  });
  if (rascunhoAberto) throw new TemplateDraftAlreadyExistsError(rascunhoAberto.versionNumber);

  const criadaId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM formulation_templates WHERE id = ${source.formulationTemplateId} FOR UPDATE`;
    const maior = await tx.formulationTemplateVersion.aggregate({
      where: { formulationTemplateId: source.formulationTemplateId },
      _max: { versionNumber: true },
    });

    const criada = await tx.formulationTemplateVersion.create({
      data: {
        formulationTemplateId: source.formulationTemplateId,
        versionNumber: (maior._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        basisQuantity: source.basisQuantity,
        calculationMode: source.calculationMode,
        dosesPerPackage: source.dosesPerPackage,
        outputUnitCode: source.outputUnitCode,
        notes: source.notes,
        createdBy: actor.name,
        sourceVersionId: source.id,
        sourceVersionNumber: source.versionNumber,
        components: {
          create: source.components.map((component) => ({
            itemId: component.itemId,
            quantity: component.quantity,
            unitCode: component.unitCode,
            basis: component.basis,
            supplyResponsibility: component.supplyResponsibility,
            purityPercentApplied: component.purityPercentApplied,
            overagePercent: component.overagePercent,
            notes: component.notes,
            position: component.position,
          })),
        },
      },
    });
    return criada.id;
  });

  return getFormulationTemplateVersion(criadaId);
}

/** Uma versão pronta para uso — ativa e de template não arquivado. */
export async function assertUsableTemplateVersion(
  version: VersionWithRelations,
): Promise<void> {
  if (version.formulationTemplate.archivedAt !== null) {
    throw new TemplateArchivedError(version.formulationTemplate.code);
  }
}

const MODO_LABEL: Record<string, string> = {
  FIXED_BASIS: "Base fixa",
  PER_DOSE: "Por dose",
};

const BASE_LABEL: Record<string, string> = {
  FIXED_BASIS: "Base da fórmula",
  PER_DOSE: "Por dose",
  PER_FINISHED_UNIT: "Por unidade acabada",
};

const FORNECIMENTO_LABEL: Record<string, string> = {
  VERIDI: "Veridi",
  CUSTOMER: "Cliente",
};

interface ComparavelComponente {
  itemCode: string;
  itemName: string;
  quantity: string;
  unitCode: string;
  basis: string;
  supplyResponsibility: string;
  purityPercentApplied: string | null;
  overagePercent: string | null;
}

export interface ComparavelVersao {
  label: string;
  basisQuantity: string;
  calculationMode: string;
  dosesPerPackage: number | null;
  outputUnitCode: string;
  components: ComparavelComponente[];
}

/**
 * Diff entre duas composições.
 *
 * Específico e pequeno de propósito: as coisas que mudam numa fórmula são
 * conhecidas e contáveis. Um framework genérico de comparação custaria mais
 * do que resolver o problema, e produziria diferenças que ninguém precisa ler.
 */
export function compararComposicoes(
  de: ComparavelVersao,
  para: ComparavelVersao,
): FormulationTemplateDiffDTO {
  const entries: FormulationTemplateDiffEntryDTO[] = [];
  const anotar = (
    kind: FormulationTemplateDiffEntryDTO["kind"],
    label: string,
    field: string | null,
    from: string | null,
    to: string | null,
  ) => {
    if (from !== to) entries.push({ kind, label, field, from, to });
  };

  anotar("BASIS", "Base da formulação", null, de.basisQuantity, para.basisQuantity);
  anotar(
    "MODE",
    "Modo de cálculo",
    null,
    MODO_LABEL[de.calculationMode] ?? de.calculationMode,
    MODO_LABEL[para.calculationMode] ?? para.calculationMode,
  );
  anotar(
    "DOSES",
    "Doses por embalagem",
    null,
    de.dosesPerPackage === null ? "—" : String(de.dosesPerPackage),
    para.dosesPerPackage === null ? "—" : String(para.dosesPerPackage),
  );
  anotar("OUTPUT_UOM", "Unidade da base", null, de.outputUnitCode, para.outputUnitCode);

  const porItemDe = new Map(de.components.map((c) => [c.itemCode, c]));
  const porItemPara = new Map(para.components.map((c) => [c.itemCode, c]));
  const rotulo = (c: ComparavelComponente) => `${c.itemName} (${c.itemCode})`;

  for (const componente of para.components) {
    if (!porItemDe.has(componente.itemCode)) {
      entries.push({
        kind: "COMPONENT_ADDED",
        label: rotulo(componente),
        field: null,
        from: null,
        to: `${componente.quantity} ${componente.unitCode}`,
      });
    }
  }
  for (const componente of de.components) {
    if (!porItemPara.has(componente.itemCode)) {
      entries.push({
        kind: "COMPONENT_REMOVED",
        label: rotulo(componente),
        field: null,
        from: `${componente.quantity} ${componente.unitCode}`,
        to: null,
      });
    }
  }
  for (const componente of para.components) {
    const anterior = porItemDe.get(componente.itemCode);
    if (!anterior) continue;
    const label = rotulo(componente);
    const campos: [string, string | null, string | null][] = [
      ["Quantidade", anterior.quantity, componente.quantity],
      ["Unidade", anterior.unitCode, componente.unitCode],
      [
        "Base",
        BASE_LABEL[anterior.basis] ?? anterior.basis,
        BASE_LABEL[componente.basis] ?? componente.basis,
      ],
      [
        "Fornecimento",
        FORNECIMENTO_LABEL[anterior.supplyResponsibility] ?? anterior.supplyResponsibility,
        FORNECIMENTO_LABEL[componente.supplyResponsibility] ?? componente.supplyResponsibility,
      ],
      ["Pureza", anterior.purityPercentApplied, componente.purityPercentApplied],
      ["Overage", anterior.overagePercent, componente.overagePercent],
    ];
    for (const [campo, antes, depois] of campos) {
      if (antes !== depois) {
        entries.push({
          kind: "COMPONENT_CHANGED",
          label,
          field: campo,
          from: antes ?? "—",
          to: depois ?? "—",
        });
      }
    }
  }

  return { fromLabel: de.label, toLabel: para.label, entries };
}

/** Uma versão de template no formato comparável. */
export function versaoComparavel(version: VersionWithRelations): ComparavelVersao {
  return {
    label: `${version.formulationTemplate.code} · V${version.versionNumber}`,
    basisQuantity: version.basisQuantity.toString(),
    calculationMode: version.calculationMode,
    dosesPerPackage: version.dosesPerPackage,
    outputUnitCode: version.outputUnitCode,
    components: version.components.map((component) => ({
      itemCode: component.item.code,
      itemName: component.item.name,
      quantity: component.quantity.toString(),
      unitCode: component.unitCode,
      basis: component.basis,
      supplyResponsibility: component.supplyResponsibility,
      purityPercentApplied: component.purityPercentApplied
        ? component.purityPercentApplied.toString()
        : null,
      overagePercent: component.overagePercent ? component.overagePercent.toString() : null,
    })),
  };
}

export async function compareTemplateVersions(
  fromId: string,
  toId: string,
): Promise<FormulationTemplateDiffDTO> {
  const [de, para] = await Promise.all([
    requireTemplateVersion(fromId),
    requireTemplateVersion(toId),
  ]);
  return compararComposicoes(versaoComparavel(de), versaoComparavel(para));
}
