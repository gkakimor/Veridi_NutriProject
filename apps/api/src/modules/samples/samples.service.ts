import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  ProjectSampleDTO,
  ProjectSampleListResponse,
  SampleConsumptionDTO,
} from "@veridi/shared";
import { SAMPLE_CODE_PREFIX, SAMPLE_QR_PREFIX, normalizeLotLookupCode } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  getOnHand,
  getReservedByLots,
  isLotAvailableForUse,
} from "../../lib/inventory-ledger.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { convertUomDecimal } from "../items/uom.js";
import { ProjectNotFoundError } from "../projects/projects.errors.js";
import {
  InsufficientSampleStockError,
  InvalidSampleQuantityError,
  InvalidSampleTransitionError,
  LotNotEligibleForSampleError,
  LotOwnerNotAllowedError,
  MissingDecisionNotesError,
  MissingSampleLotError,
  MissingSampleOutputError,
  ProjectNotOpenForSamplesError,
  SampleClosedError,
  SampleItemNotFoundError,
  SampleLotNotFoundError,
  SampleNotFoundError,
  SampleWithoutConsumptionError,
  SampleProductNotInProjectError,
  SampleProductRequiredError,
} from "./samples.errors.js";
import type {
  CreateSampleInput,
  ListSamplesQuery,
  ProduceSampleInput,
  RegisterSampleConsumptionInput,
  SampleDecisionInput,
} from "./samples.schemas.js";

/**
 * Amostras / pilotos / testes Tn.
 *
 * Decisões estruturais desta capacidade:
 * - amostra NÃO é `Lot` nem `ProductionOrder`. O projeto entra em amostra
 *   antes de existir Product/Item/formulação, e criar um Product artificial
 *   só para fabricar amostra seria mentira no cadastro;
 * - o material consumido é real e sai do MESMO ledger, com tipo próprio
 *   (`SAMPLE_CONSUMPTION`) — nunca disfarçado de ajuste;
 * - a saída da amostra NUNCA entra no estoque comercial de produto acabado.
 */

const CODE_SEQUENCE = "project_sample_code_seq";

const sampleInclude = {
  project: { include: { customer: true } },
  consumptions: {
    orderBy: { executedAt: "asc" as const },
    include: { item: true, lot: { include: { ownerCustomer: true } } },
  },
} as const;

type SampleWithRelations = PrismaTypes.ProjectSampleGetPayload<{ include: typeof sampleInclude }>;

function toConsumptionDTO(
  consumption: SampleWithRelations["consumptions"][number],
): SampleConsumptionDTO {
  return {
    id: consumption.id,
    itemId: consumption.itemId,
    itemCode: consumption.item.code,
    itemName: consumption.item.name,
    lotId: consumption.lotId,
    lotCode: consumption.lot ? consumption.lot.code : null,
    supplierLot: consumption.lot ? consumption.lot.supplierLot : null,
    ownerType: consumption.lot ? consumption.lot.ownerType : "VERIDI",
    ownerCustomerName: consumption.lot?.ownerCustomer?.legalName ?? null,
    quantity: consumption.quantity.toString(),
    uomCode: consumption.uomCode,
    executedAt: consumption.executedAt.toISOString(),
    executedByName: consumption.executedByNameSnapshot,
    notes: consumption.notes,
  };
}

export function toSampleDTO(sample: SampleWithRelations): ProjectSampleDTO {
  return {
    id: sample.id,
    code: sample.code,
    externalCode: sample.externalCode,
    projectId: sample.projectId,
    projectCode: sample.project.code,
    projectName: sample.project.name,
    customerId: sample.project.customerId,
    customerName: sample.project.customer.legalName,
    testSequence: sample.testSequence,
    testLabel: `T${sample.testSequence}`,
    status: sample.status,
    source: sample.source,
    description: sample.description,
    productionNotes: sample.productionNotes,
    decisionNotes: sample.decisionNotes,
    outputQuantity: sample.outputQuantity ? sample.outputQuantity.toString() : null,
    outputUomCode: sample.outputUomCode,
    customerNameSnapshot: sample.customerNameSnapshot,
    projectCodeSnapshot: sample.projectCodeSnapshot,
    projectNameSnapshot: sample.projectNameSnapshot,
    // QR próprio: amostra não é lote, então o payload nunca usa `LOT:`.
    qrPayload: `${SAMPLE_QR_PREFIX}${sample.code}`,
    consumptions: sample.consumptions.map(toConsumptionDTO),
    createdAt: sample.createdAt.toISOString(),
    createdByName: sample.createdByNameSnapshot,
    startedAt: sample.startedAt ? sample.startedAt.toISOString() : null,
    startedByName: sample.startedByNameSnapshot,
    producedAt: sample.producedAt ? sample.producedAt.toISOString() : null,
    producedByName: sample.producedByNameSnapshot,
    approvedAt: sample.approvedAt ? sample.approvedAt.toISOString() : null,
    approvedByName: sample.approvedByNameSnapshot,
    rejectedAt: sample.rejectedAt ? sample.rejectedAt.toISOString() : null,
    rejectedByName: sample.rejectedByNameSnapshot,
    cancelledAt: sample.cancelledAt ? sample.cancelledAt.toISOString() : null,
    cancelledByName: sample.cancelledByNameSnapshot,
  };
}

export async function getSampleById(id: string): Promise<ProjectSampleDTO | null> {
  const sample = await getPrisma().projectSample.findUnique({
    where: { id },
    include: sampleInclude,
  });
  return sample ? toSampleDTO(sample) : null;
}

/** Resolve `AM-000001` ou o payload `SAMPLE:AM-000001`. */
export async function lookupSampleByCode(rawCode: string): Promise<ProjectSampleDTO | null> {
  const normalized = rawCode.trim().toUpperCase().startsWith(SAMPLE_QR_PREFIX)
    ? rawCode.trim().slice(SAMPLE_QR_PREFIX.length).trim().toUpperCase()
    : rawCode.trim().toUpperCase();
  if (!normalized) return null;

  const sample = await getPrisma().projectSample.findUnique({
    where: { code: normalized },
    include: sampleInclude,
  });
  return sample ? toSampleDTO(sample) : null;
}

export async function listSamples(
  query: ListSamplesQuery,
  pagination: Pagination = query,
): Promise<ProjectSampleListResponse> {
  const prisma = getPrisma();
  const where: PrismaTypes.ProjectSampleWhereInput = {
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerId ? { project: { is: { customerId: query.customerId } } } : {}),
    ...(query.producedFrom || query.producedTo
      ? {
          producedAt: {
            ...(query.producedFrom ? { gte: query.producedFrom } : {}),
            ...(query.producedTo ? { lte: query.producedTo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { externalCode: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
            { project: { is: { name: { contains: query.search, mode: "insensitive" } } } },
            { project: { is: { code: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [samples, total] = await Promise.all([
    prisma.projectSample.findMany({
      where,
      include: sampleInclude,
      orderBy: [{ createdAt: "desc" }],
      ...pageArgs(pagination),
    }),
    prisma.projectSample.count({ where }),
  ]);

  return { samples: samples.map(toSampleDTO), ...pageMeta(pagination, total) };
}

/**
 * Cria a próxima amostra do projeto. O número Tn é sequencial POR PROJETO e
 * gerado sob lock — duas criações simultâneas nunca recebem o mesmo número,
 * e o legado importado nunca é renumerado (o contador continua depois do
 * maior Tn existente).
 */
export async function createSample(
  projectId: string,
  input: CreateSampleInput,
  actor: User,
): Promise<ProjectSampleDTO> {
  const prisma = getPrisma();
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ProjectNotFoundError(projectId);
  if (project.status === "APPROVED" || project.status === "CANCELLED") {
    throw new ProjectNotOpenForSamplesError(project.status);
  }

  /*
   * Qual produto a amostra testa.
   *
   * Com um produto só não há ambiguidade e o vínculo é automático. Com vários,
   * quem cria escolhe: a associação errada contamina rastreabilidade e
   * decisão técnica, e ninguém consegue reconstruir isso depois.
   */
  const links = await prisma.projectProduct.findMany({ where: { projectId } });
  let projectProductId: string | null = null;
  if (input.projectProductId) {
    const chosen = links.find((link) => link.id === input.projectProductId);
    if (!chosen) throw new SampleProductNotInProjectError();
    projectProductId = chosen.id;
  } else if (links.length === 1) {
    projectProductId = links[0]!.id;
  } else if (links.length > 1) {
    throw new SampleProductRequiredError();
  }

  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, SAMPLE_CODE_PREFIX);

  const sampleId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;

    const maxTest = await tx.projectSample.aggregate({
      where: { projectId },
      _max: { testSequence: true },
    });

    const created = await tx.projectSample.create({
      data: {
        code,
        projectId,
        testSequence: (maxTest._max.testSequence ?? 0) + 1,
        status: "DRAFT",
        source: "MANUAL",
        ...(projectProductId ? { projectProductId } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.productionNotes !== undefined
          ? { productionNotes: input.productionNotes }
          : {}),
        ...(input.outputUomCode !== undefined ? { outputUomCode: input.outputUomCode } : {}),
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
    });

    // Primeira amostra move o projeto para o estágio de amostra — com
    // evento no histórico, nunca silenciosamente.
    if (project.status === "WAITING" || project.status === "STAND_BY") {
      await tx.project.update({ where: { id: projectId }, data: { status: "SAMPLE" } });
      await tx.projectStatusHistory.create({
        data: {
          projectId,
          fromStatus: project.status,
          toStatus: "SAMPLE",
          reason: `Amostra ${created.code} criada`,
          changedByUserId: actor.id,
          changedByNameSnapshot: actor.name,
        },
      });
    }

    return created.id;
  });

  return (await getSampleById(sampleId))!;
}

/**
 * Registra consumo real de material. Reutiliza as MESMAS regras de
 * elegibilidade do resto do sistema (qualidade, validade, CoA,
 * proprietário) e nunca come estoque reservado para outra operação.
 */
export async function registerSampleConsumption(
  sampleId: string,
  input: RegisterSampleConsumptionInput,
  actor: User,
): Promise<ProjectSampleDTO> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM project_samples WHERE id = ${sampleId} FOR UPDATE`;

    const sample = await tx.projectSample.findUnique({
      where: { id: sampleId },
      include: { project: true },
    });
    if (!sample) throw new SampleNotFoundError(sampleId);
    if (sample.status !== "DRAFT" && sample.status !== "IN_PROGRESS") {
      throw new SampleClosedError(sample.status);
    }

    const item = await tx.item.findUnique({ where: { id: input.itemId } });
    if (!item) throw new SampleItemNotFoundError(input.itemId);

    const quantity = new Prisma.Decimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) throw new InvalidSampleQuantityError();

    // Item controlado por lote SEMPRE exige lote: sem isso não há
    // rastreabilidade, e amostra também é material real saindo do estoque.
    let lotId: string | null = null;
    if (item.controlsLot) {
      if (!input.lotCode?.trim()) throw new MissingSampleLotError(item.code);

      const lot = await tx.lot.findUnique({
        where: { code: normalizeLotLookupCode(input.lotCode) },
      });
      if (!lot) throw new SampleLotNotFoundError(input.lotCode);
      if (lot.itemId !== item.id) throw new SampleLotNotFoundError(input.lotCode);
      // Qualidade, validade e CoA valem igual — não existe bypass "porque
      // é amostra".
      if (!isLotAvailableForUse(lot)) throw new LotNotEligibleForSampleError(lot.code);

      // Material do cliente só pode ser usado no projeto DAQUELE cliente.
      if (lot.ownerType === "CUSTOMER" && lot.ownerCustomerId !== sample.project.customerId) {
        throw new LotOwnerNotAllowedError(lot.code);
      }

      await tx.$queryRaw`SELECT id FROM items WHERE id = ${item.id} FOR UPDATE`;

      const onHand = await getOnHand(tx, { itemId: item.id, lotId: lot.id });
      const reserved = (await getReservedByLots(tx, [lot.id])).get(lot.id) ?? new Prisma.Decimal(0);
      // Amostra nunca consome o que está reservado para OP/Pedido.
      const available = Prisma.Decimal.max(onHand.minus(reserved), 0);
      if (quantity.greaterThan(available)) {
        throw new InsufficientSampleStockError(lot.code, available.toString());
      }
      lotId = lot.id;
    } else {
      await tx.$queryRaw`SELECT id FROM items WHERE id = ${item.id} FOR UPDATE`;
      const onHand = await getOnHand(tx, { itemId: item.id, lotId: null });
      if (quantity.greaterThan(onHand)) {
        throw new InsufficientSampleStockError(item.code, onHand.toString());
      }
    }

    const consumption = await tx.sampleConsumption.create({
      data: {
        projectSampleId: sampleId,
        itemId: item.id,
        lotId,
        quantity,
        uomCode: item.unitCode,
        executedByUserId: actor.id,
        executedByNameSnapshot: actor.name,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    // A baixa é do ledger — nunca uma segunda contabilidade paralela.
    const movement = await tx.inventoryMovement.create({
      data: {
        itemId: item.id,
        lotId,
        type: "SAMPLE_CONSUMPTION",
        quantity,
        occurredAt: new Date(),
        sourceType: "PROJECT_SAMPLE",
        sourceId: sampleId,
        createdBy: actor.name,
      },
    });
    await tx.sampleConsumption.update({
      where: { id: consumption.id },
      data: { inventoryMovementId: movement.id },
    });

    // O primeiro consumo É o início real da preparação.
    if (sample.status === "DRAFT") {
      await tx.projectSample.update({
        where: { id: sampleId },
        data: {
          status: "IN_PROGRESS",
          startedAt: new Date(),
          startedByUserId: actor.id,
          startedByNameSnapshot: actor.name,
        },
      });
    }
  });

  return (await getSampleById(sampleId))!;
}

/** Conclui a amostra e congela o snapshot que a etiqueta usa. */
export async function produceSample(
  sampleId: string,
  input: ProduceSampleInput,
  actor: User,
): Promise<ProjectSampleDTO> {
  const prisma = getPrisma();
  const sample = await prisma.projectSample.findUnique({
    where: { id: sampleId },
    include: { project: { include: { customer: true } }, consumptions: true },
  });
  if (!sample) throw new SampleNotFoundError(sampleId);
  if (sample.status !== "DRAFT" && sample.status !== "IN_PROGRESS") {
    throw new SampleClosedError(sample.status);
  }

  const outputQuantity = new Prisma.Decimal(input.outputQuantity);
  if (outputQuantity.lessThanOrEqualTo(0)) throw new MissingSampleOutputError();

  const unit = await prisma.unitOfMeasure.findUnique({ where: { code: input.outputUomCode } });
  if (!unit) throw new MissingSampleOutputError();
  // Toca a conversão só para validar que a unidade é utilizável.
  convertUomDecimal(outputQuantity, unit.code, unit.code, [unit]);

  // Amostra sem nenhum consumo é possível (montagem/embalagem, histórico),
  // mas exige confirmação consciente — o sistema nunca inventa consumo.
  if (sample.consumptions.length === 0 && !input.confirmWithoutConsumption) {
    throw new SampleWithoutConsumptionError();
  }

  await prisma.projectSample.update({
    where: { id: sampleId },
    data: {
      status: "PRODUCED",
      outputQuantity,
      outputUomCode: unit.code,
      ...(input.productionNotes !== undefined
        ? { productionNotes: input.productionNotes }
        : {}),
      producedAt: new Date(),
      producedByUserId: actor.id,
      producedByNameSnapshot: actor.name,
      // Snapshot da etiqueta: editar cliente/projeto depois não reescreve
      // o que já foi impresso e enviado.
      customerCodeSnapshot: sample.project.customer.code,
      customerNameSnapshot: sample.project.customer.legalName,
      projectCodeSnapshot: sample.project.code,
      projectNameSnapshot: sample.project.name,
    },
  });

  return (await getSampleById(sampleId))!;
}

/**
 * Decisão sobre o RESULTADO da amostra. Aprovar a amostra nunca aprova o
 * projeto — isso continua exigindo orçamento aceito e ação comercial
 * explícita (capacidade 38). Reprovar/cancelar também nunca estorna
 * material: o que foi consumido fisicamente continua consumido.
 */
export async function decideSample(
  sampleId: string,
  decision: "APPROVED" | "REJECTED" | "CANCELLED",
  input: SampleDecisionInput,
  actor: User,
): Promise<ProjectSampleDTO> {
  const prisma = getPrisma();
  const sample = await prisma.projectSample.findUnique({ where: { id: sampleId } });
  if (!sample) throw new SampleNotFoundError(sampleId);

  if (decision === "CANCELLED") {
    if (sample.status !== "DRAFT" && sample.status !== "IN_PROGRESS") {
      throw new InvalidSampleTransitionError(sample.status, decision);
    }
  } else if (sample.status !== "PRODUCED") {
    throw new InvalidSampleTransitionError(sample.status, decision);
  }

  if (decision === "REJECTED" && !input.decisionNotes?.trim()) {
    throw new MissingDecisionNotesError();
  }

  const now = new Date();
  await prisma.projectSample.update({
    where: { id: sampleId },
    data: {
      status: decision,
      ...(input.decisionNotes ? { decisionNotes: input.decisionNotes.trim() } : {}),
      ...(decision === "APPROVED"
        ? { approvedAt: now, approvedByUserId: actor.id, approvedByNameSnapshot: actor.name }
        : {}),
      ...(decision === "REJECTED"
        ? { rejectedAt: now, rejectedByUserId: actor.id, rejectedByNameSnapshot: actor.name }
        : {}),
      ...(decision === "CANCELLED"
        ? { cancelledAt: now, cancelledByUserId: actor.id, cancelledByNameSnapshot: actor.name }
        : {}),
    },
  });

  return (await getSampleById(sampleId))!;
}
