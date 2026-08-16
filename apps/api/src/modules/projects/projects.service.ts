import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, ProjectStatus, User } from "@prisma/client";
import type {
  ProjectDTO,
  ProjectListResponse,
  ProjectStatusHistoryDTO,
  ProjectVocabularyResponse,
  QuoteVersionDTO,
} from "@veridi/shared";
import { PROJECT_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  CustomerLockedError,
  InvalidStatusTransitionError,
  MissingAcceptedQuoteError,
  MissingCancelDetailsError,
  MissingFinishedUnitError,
  ProjectLockedError,
  ProjectNotFoundError,
} from "./projects.errors.js";
import type {
  ApproveProjectInput,
  CancelProjectInput,
  CreateProjectInput,
  ListProjectsQuery,
  UpdateProjectInput,
} from "./projects.schemas.js";
import { toQuoteVersionDTO } from "./quotes.service.js";

/**
 * Projetos private label — o funil comercial antes do produto existir.
 *
 * Regras estruturais desta capacidade:
 * - Project e Product são entidades distintas; a aprovação é o momento em
 *   que um vira o outro, nunca uma conversão automática no cadastro;
 * - o pipeline tem histórico próprio (`ProjectStatusHistory`) — `updatedAt`
 *   não conta história;
 * - projeto aprovado ou cancelado é histórico: não se reescreve depois.
 */

const CODE_SEQUENCE = "project_code_seq";

/** Transições permitidas. APPROVED e CANCELLED são terminais nesta fase. */
const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  WAITING: ["SAMPLE", "STAND_BY", "CANCELLED"],
  SAMPLE: ["STAND_BY", "CANCELLED", "WAITING"],
  STAND_BY: ["WAITING", "SAMPLE", "CANCELLED"],
  APPROVED: [],
  CANCELLED: [],
};

const projectInclude = {
  customer: true,
  product: true,
  responsibleUser: true,
  createdByUser: true,
  quoteVersions: { orderBy: { versionNumber: "asc" as const } },
  statusHistory: { orderBy: { changedAt: "asc" as const } },
} as const;

type ProjectWithRelations = PrismaTypes.ProjectGetPayload<{ include: typeof projectInclude }>;

function toStatusHistoryDTO(
  history: ProjectWithRelations["statusHistory"][number],
): ProjectStatusHistoryDTO {
  return {
    id: history.id,
    fromStatus: history.fromStatus,
    toStatus: history.toStatus,
    reason: history.reason,
    changedAt: history.changedAt.toISOString(),
    changedByName: history.changedByNameSnapshot,
  };
}

export function toProjectDTO(project: ProjectWithRelations): ProjectDTO {
  const quotes: QuoteVersionDTO[] = project.quoteVersions.map(toQuoteVersionDTO);
  const latest = quotes[quotes.length - 1] ?? null;
  const accepted = quotes.find((quote) => quote.status === "ACCEPTED") ?? null;

  return {
    id: project.id,
    code: project.code,
    externalCode: project.externalCode,
    customerId: project.customerId,
    customerCode: project.customer.code,
    customerName: project.customer.legalName,
    name: project.name,
    concept: project.concept,
    channel: project.channel,
    status: project.status,
    source: project.source,
    responsibleUserId: project.responsibleUserId,
    responsibleUserName: project.responsibleUser ? project.responsibleUser.name : null,
    entryDate: project.entryDate.toISOString(),
    notes: project.notes,
    cancelReason: project.cancelReason,
    cancelReasonDetails: project.cancelReasonDetails,
    cancelledAt: project.cancelledAt ? project.cancelledAt.toISOString() : null,
    approvedAt: project.approvedAt ? project.approvedAt.toISOString() : null,
    dosageForm: project.dosageForm,
    presentationType: project.presentationType,
    doseAmount: project.doseAmount ? project.doseAmount.toString() : null,
    doseUomCode: project.doseUomCode,
    dosesPerPackage: project.dosesPerPackage,
    targetAgeGroup: project.targetAgeGroup,
    minimumBatchQuantity: project.minimumBatchQuantity
      ? project.minimumBatchQuantity.toString()
      : null,
    shelfLifeMonths: project.shelfLifeMonths,
    productId: project.productId,
    productCode: project.product ? project.product.code : null,
    productName: project.product ? project.product.name : null,
    latestQuoteLabel: latest ? latest.versionLabel : null,
    latestQuoteStatus: latest ? latest.status : null,
    acceptedQuoteLabel: accepted ? accepted.versionLabel : null,
    quoteVersions: quotes,
    statusHistory: project.statusHistory.map(toStatusHistoryDTO),
    createdAt: project.createdAt.toISOString(),
    createdByName: project.createdByNameSnapshot,
    updatedAt: project.updatedAt.toISOString(),
  };
}

async function requireProject(id: string): Promise<ProjectWithRelations> {
  const project = await getPrisma().project.findUnique({ where: { id }, include: projectInclude });
  if (!project) throw new ProjectNotFoundError(id);
  return project;
}

export async function getProjectById(id: string): Promise<ProjectDTO | null> {
  const project = await getPrisma().project.findUnique({ where: { id }, include: projectInclude });
  return project ? toProjectDTO(project) : null;
}

export async function listProjects(
  query: ListProjectsQuery,
  pagination: Pagination = query,
): Promise<ProjectListResponse> {
  const prisma = getPrisma();
  const where: PrismaTypes.ProjectWhereInput = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.concept ? { concept: query.concept } : {}),
    ...(query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {}),
    ...(query.entryFrom || query.entryTo
      ? {
          entryDate: {
            ...(query.entryFrom ? { gte: query.entryFrom } : {}),
            ...(query.entryTo ? { lte: query.entryTo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { externalCode: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
            { customer: { is: { legalName: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      include: projectInclude,
      orderBy: [{ entryDate: "desc" }, { code: "desc" }],
      ...pageArgs(pagination),
    }),
    prisma.project.count({ where }),
  ]);

  return { projects: projects.map(toProjectDTO), ...pageMeta(pagination, total) };
}

/**
 * Vocabulário já usado — alimenta o autocomplete de conceito/canal sem
 * transformar texto livre em enum nem criar tabela de domínio.
 */
export async function getProjectVocabulary(): Promise<ProjectVocabularyResponse> {
  const prisma = getPrisma();
  const [concepts, channels] = await Promise.all([
    prisma.project.findMany({
      where: { concept: { not: null } },
      distinct: ["concept"],
      select: { concept: true },
      orderBy: { concept: "asc" },
    }),
    prisma.project.findMany({
      where: { channel: { not: null } },
      distinct: ["channel"],
      select: { channel: true },
      orderBy: { channel: "asc" },
    }),
  ]);

  return {
    concepts: concepts.map((row) => row.concept!).filter(Boolean),
    channels: channels.map((row) => row.channel!).filter(Boolean),
  };
}

function technicalBriefData(input: CreateProjectInput | UpdateProjectInput) {
  return {
    ...(input.dosageForm !== undefined ? { dosageForm: input.dosageForm } : {}),
    ...(input.presentationType !== undefined ? { presentationType: input.presentationType } : {}),
    ...(input.doseAmount !== undefined ? { doseAmount: input.doseAmount } : {}),
    ...(input.doseUomCode !== undefined ? { doseUomCode: input.doseUomCode } : {}),
    ...(input.dosesPerPackage !== undefined ? { dosesPerPackage: input.dosesPerPackage } : {}),
    ...(input.targetAgeGroup !== undefined ? { targetAgeGroup: input.targetAgeGroup } : {}),
    ...(input.minimumBatchQuantity !== undefined
      ? { minimumBatchQuantity: input.minimumBatchQuantity }
      : {}),
    ...(input.shelfLifeMonths !== undefined ? { shelfLifeMonths: input.shelfLifeMonths } : {}),
  };
}

export async function createProject(input: CreateProjectInput, actor: User): Promise<ProjectDTO> {
  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, PROJECT_CODE_PREFIX);

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        code,
        customerId: input.customerId,
        name: input.name,
        ...(input.externalCode !== undefined ? { externalCode: input.externalCode } : {}),
        ...(input.concept !== undefined ? { concept: input.concept } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.responsibleUserId !== undefined
          ? { responsibleUserId: input.responsibleUserId }
          : {}),
        entryDate: input.entryDate ?? new Date(),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...technicalBriefData(input),
        // Projeto sempre nasce aguardando: aprovar é ação explícita.
        status: "WAITING",
        source: "MANUAL",
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
    });

    await tx.projectStatusHistory.create({
      data: {
        projectId: created.id,
        fromStatus: null,
        toStatus: "WAITING",
        changedByUserId: actor.id,
        changedByNameSnapshot: actor.name,
      },
    });

    return created;
  });

  return (await getProjectById(project.id))!;
}

export async function updateProject(
  id: string,
  input: UpdateProjectInput,
  _actor: User,
): Promise<ProjectDTO> {
  const project = await requireProject(id);
  // Aprovado/cancelado é histórico comercial — não se reescreve o contexto.
  if (project.status === "APPROVED" || project.status === "CANCELLED") {
    throw new ProjectLockedError(project.status);
  }

  if (input.customerId !== undefined && input.customerId !== project.customerId) {
    // Trocar o cliente depois de uma proposta formal reescreveria história.
    const formalQuote = project.quoteVersions.some((quote) =>
      ["SENT", "ACCEPTED", "SUPERSEDED", "REJECTED"].includes(quote.status),
    );
    if (formalQuote) throw new CustomerLockedError();
  }

  await getPrisma().project.update({
    where: { id },
    data: {
      ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.externalCode !== undefined ? { externalCode: input.externalCode } : {}),
      ...(input.concept !== undefined ? { concept: input.concept } : {}),
      ...(input.channel !== undefined ? { channel: input.channel } : {}),
      ...(input.responsibleUserId !== undefined
        ? { responsibleUserId: input.responsibleUserId }
        : {}),
      ...(input.entryDate !== undefined ? { entryDate: input.entryDate } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...technicalBriefData(input),
    },
  });

  return (await getProjectById(id))!;
}

/** Mudança de pipeline com histórico — aprovar/cancelar têm ação própria. */
export async function changeProjectStatus(
  id: string,
  status: ProjectStatus,
  reason: string | undefined,
  actor: User,
): Promise<ProjectDTO> {
  const project = await requireProject(id);

  if (status === "APPROVED" || status === "CANCELLED") {
    throw new InvalidStatusTransitionError(project.status, status);
  }
  if (!ALLOWED_TRANSITIONS[project.status].includes(status)) {
    throw new InvalidStatusTransitionError(project.status, status);
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.project.update({ where: { id }, data: { status } });
    await tx.projectStatusHistory.create({
      data: {
        projectId: id,
        fromStatus: project.status,
        toStatus: status,
        ...(reason ? { reason } : {}),
        changedByUserId: actor.id,
        changedByNameSnapshot: actor.name,
      },
    });
  });

  return (await getProjectById(id))!;
}

export async function cancelProject(
  id: string,
  input: CancelProjectInput,
  actor: User,
): Promise<ProjectDTO> {
  const project = await requireProject(id);
  if (!ALLOWED_TRANSITIONS[project.status].includes("CANCELLED")) {
    throw new InvalidStatusTransitionError(project.status, "CANCELLED");
  }
  if (input.cancelReason === "OTHER" && !input.cancelReasonDetails?.trim()) {
    throw new MissingCancelDetailsError();
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.project.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelReason: input.cancelReason,
        ...(input.cancelReasonDetails
          ? { cancelReasonDetails: input.cancelReasonDetails }
          : {}),
        cancelledAt: new Date(),
      },
    });

    // Propostas ainda abertas deixam de valer, mas nada é apagado.
    await tx.quoteVersion.updateMany({
      where: { projectId: id, status: { in: ["DRAFT", "SENT"] } },
      data: { status: "SUPERSEDED" },
    });

    await tx.projectStatusHistory.create({
      data: {
        projectId: id,
        fromStatus: project.status,
        toStatus: "CANCELLED",
        reason: input.cancelReasonDetails ?? input.cancelReason,
        changedByUserId: actor.id,
        changedByNameSnapshot: actor.name,
      },
    });
  });

  return (await getProjectById(id))!;
}

/**
 * Aprovação do projeto: transacional e idempotente por construção — o
 * projeto é travado, a versão aceita é revalidada e o Product é
 * criado/vinculado no mesmo passo. Se qualquer etapa falhar, o projeto NÃO
 * fica aprovado.
 *
 * A formulação criada aqui nasce DRAFT: o comercial aprova o negócio, não
 * a receita. Só a engenharia ativa uma versão.
 */
export async function approveProject(
  id: string,
  input: ApproveProjectInput,
  actor: User,
): Promise<ProjectDTO> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${id} FOR UPDATE`;

    const project = await tx.project.findUnique({
      where: { id },
      include: { quoteVersions: true, customer: true },
    });
    if (!project) throw new ProjectNotFoundError(id);
    if (project.status === "APPROVED") {
      // Segunda chamada não cria um segundo Product.
      throw new InvalidStatusTransitionError(project.status, "APPROVED");
    }
    if (project.status === "CANCELLED") {
      throw new InvalidStatusTransitionError(project.status, "APPROVED");
    }

    const accepted = project.quoteVersions.find((quote) => quote.status === "ACCEPTED");
    if (!accepted) throw new MissingAcceptedQuoteError();

    let productId = project.productId;
    if (!productId) {
      // Unidade do produto acabado: vem do orçamento aceito quando fizer
      // sentido; caso contrário o usuário precisa informar — nunca se
      // inventa unidade.
      const finishedUnitCode = input.finishedUnitCode ?? accepted.uomCode ?? null;
      if (!finishedUnitCode) throw new MissingFinishedUnitError();

      const unit = await tx.unitOfMeasure.findUnique({ where: { code: finishedUnitCode } });
      if (!unit) throw new MissingFinishedUnitError();

      const itemCodeRows = await tx.$queryRawUnsafe<{ nextval: bigint }[]>(
        "SELECT nextval('item_code_finished_product_seq') AS nextval",
      );
      const itemCode = `PA-${(itemCodeRows[0]?.nextval ?? 1n).toString().padStart(6, "0")}`;

      const finishedItem = await tx.item.create({
        data: {
          code: itemCode,
          type: "FINISHED_PRODUCT",
          name: project.name,
          unitCode: finishedUnitCode,
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
          // Brief do projeto vira ponto de partida do produto; a partir daqui
          // as duas entidades seguem vidas separadas.
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
      productId = product.id;

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
    }

    await tx.project.update({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date(), productId },
    });
    await tx.projectStatusHistory.create({
      data: {
        projectId: id,
        fromStatus: project.status,
        toStatus: "APPROVED",
        changedByUserId: actor.id,
        changedByNameSnapshot: actor.name,
      },
    });
  });

  return (await getProjectById(id))!;
}
