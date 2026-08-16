import { Prisma } from "@prisma/client";
import type { ControlledDocumentRevision, ControlledDocumentType, PrismaClient } from "@prisma/client";
import type {
  ControlledDocumentRevisionDTO,
  ControlledDocumentRevisionListResponse,
} from "@veridi/shared";
import { CONTROLLED_DOCUMENT_CODES, CONTROLLED_DOCUMENT_TYPE_LABELS } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { RevisionAlreadyExistsError, RevisionNotFoundError } from "./controlled-documents.errors.js";
import type { CreateRevisionInput } from "./controlled-documents.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export function toControlledDocumentRevisionDTO(revision: ControlledDocumentRevision): ControlledDocumentRevisionDTO {
  return {
    id: revision.id,
    type: revision.type,
    documentCode: revision.documentCode,
    title: revision.title,
    revision: revision.revision,
    revisionDate: revision.revisionDate ? revision.revisionDate.toISOString() : null,
    preparedByUserId: revision.preparedByUserId,
    preparedByName: revision.preparedByNameSnapshot,
    approvedByUserId: revision.approvedByUserId,
    approvedByName: revision.approvedByNameSnapshot,
    active: revision.active,
    createdAt: revision.createdAt.toISOString(),
  };
}

export async function listRevisions(): Promise<ControlledDocumentRevisionListResponse> {
  const revisions = await getPrisma().controlledDocumentRevision.findMany({
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
  });
  return { revisions: revisions.map(toControlledDocumentRevisionDTO) };
}

/** Revisão ACTIVE de um tipo — é ela que a OP congela ao ser liberada. */
export async function getActiveRevision(
  type: ControlledDocumentType,
  prisma: PrismaOrTx = getPrisma(),
): Promise<ControlledDocumentRevision | null> {
  return prisma.controlledDocumentRevision.findFirst({ where: { type, active: true } });
}

export async function getActiveRevisionDTO(
  type: ControlledDocumentType,
): Promise<ControlledDocumentRevisionDTO | null> {
  const revision = await getActiveRevision(type);
  return revision ? toControlledDocumentRevisionDTO(revision) : null;
}

/**
 * Cria uma revisão. Revisão existente NUNCA é editada: documento operacional
 * já impresso com ela precisa continuar lendo igual para sempre. Ativar uma
 * revisão inativa a anterior do mesmo tipo, sob lock, preservando o
 * histórico completo.
 */
export async function createRevision(
  input: CreateRevisionInput,
  actor: { id: string; name: string },
): Promise<ControlledDocumentRevisionDTO> {
  const prisma = getPrisma();

  const duplicate = await prisma.controlledDocumentRevision.findFirst({
    where: { type: input.type, revision: input.revision },
  });
  if (duplicate) throw new RevisionAlreadyExistsError(input.type, input.revision);

  const preparedBy = input.preparedByUserId
    ? await prisma.user.findUnique({ where: { id: input.preparedByUserId } })
    : { id: actor.id, name: actor.name };
  const approvedBy = input.approvedByUserId
    ? await prisma.user.findUnique({ where: { id: input.approvedByUserId } })
    : null;

  const created = await prisma.$transaction(async (tx) => {
    const revision = await tx.controlledDocumentRevision.create({
      data: {
        type: input.type,
        documentCode: CONTROLLED_DOCUMENT_CODES[input.type],
        title: input.title ?? CONTROLLED_DOCUMENT_TYPE_LABELS[input.type],
        revision: input.revision,
        ...(input.revisionDate ? { revisionDate: input.revisionDate } : {}),
        // Snapshot do nome junto do id: inativar/renomear depois não pode
        // reescrever o documento histórico.
        ...(preparedBy
          ? { preparedByUserId: preparedBy.id, preparedByNameSnapshot: preparedBy.name }
          : {}),
        ...(approvedBy
          ? { approvedByUserId: approvedBy.id, approvedByNameSnapshot: approvedBy.name }
          : {}),
        active: false,
      },
    });

    if (input.activate) await activateInTx(tx, revision.id);
    return revision.id;
  });

  const revision = await prisma.controlledDocumentRevision.findUniqueOrThrow({
    where: { id: created },
  });
  return toControlledDocumentRevisionDTO(revision);
}

async function activateInTx(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const revision = await tx.controlledDocumentRevision.findUnique({ where: { id } });
  if (!revision) throw new RevisionNotFoundError(id);

  // Serializa duas ativações concorrentes do mesmo tipo — só uma revisão
  // ACTIVE por tipo, sempre.
  await tx.$queryRaw`
    SELECT id FROM controlled_document_revisions
    WHERE "type" = ${revision.type}::"ControlledDocumentType" FOR UPDATE
  `;

  await tx.controlledDocumentRevision.updateMany({
    where: { type: revision.type, active: true },
    data: { active: false },
  });
  await tx.controlledDocumentRevision.update({ where: { id }, data: { active: true } });
}

export async function activateRevision(id: string): Promise<ControlledDocumentRevisionDTO> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => activateInTx(tx, id));
  const revision = await prisma.controlledDocumentRevision.findUniqueOrThrow({ where: { id } });
  return toControlledDocumentRevisionDTO(revision);
}
