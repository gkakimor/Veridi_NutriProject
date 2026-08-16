import type { Attachment, AttachmentType, Prisma, User } from "@prisma/client";
import type { AttachmentDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  MAX_FILE_SIZE_BYTES,
  deleteStoredFile,
  extensionMatchesMimeType,
  isAllowedMimeType,
  sanitizeFileName,
  storeFile,
} from "../../lib/file-storage.js";
import type { AllowedMimeType } from "../../lib/file-storage.js";
import {
  AttachmentContextNotFoundError,
  AttachmentNotFoundError,
  FileTooLargeError,
  InvalidAttachmentTypeForContextError,
  UnsupportedFileTypeError,
} from "./attachments.errors.js";

/**
 * Anexos: laudo/CoA do lote, NF do recebimento, arte e ficha técnica do
 * produto.
 *
 * Três regras estruturais:
 * 1. o arquivo nunca fica público — download passa pela API autenticada;
 * 2. o nome enviado pelo usuário nunca vira caminho de arquivo;
 * 3. anexo não é excluído pela operação — arquiva-se, preservando a
 *    evidência e quem a enviou.
 */

export type AttachmentContext =
  | { kind: "LOT"; id: string }
  | { kind: "RECEIPT"; id: string }
  | { kind: "PRODUCT"; id: string };

/** Cada contexto aceita um conjunto próprio de documentos. */
const ALLOWED_TYPES: Record<AttachmentContext["kind"], AttachmentType[]> = {
  LOT: ["COA", "OTHER"],
  RECEIPT: ["INVOICE", "OTHER"],
  PRODUCT: ["LABEL_ART", "TECHNICAL_SHEET", "OTHER"],
};

export function toAttachmentDTO(attachment: Attachment): AttachmentDTO {
  return {
    id: attachment.id,
    documentType: attachment.documentType,
    lotId: attachment.lotId,
    receiptId: attachment.receiptId,
    productId: attachment.productId,
    originalFileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt.toISOString(),
    uploadedByUserId: attachment.uploadedByUserId,
    uploadedByName: attachment.uploadedByNameSnapshot,
    archivedAt: attachment.archivedAt ? attachment.archivedAt.toISOString() : null,
    archivedByName: attachment.archivedByNameSnapshot,
    active: attachment.archivedAt === null,
  };
}

function contextWhere(context: AttachmentContext): Prisma.AttachmentWhereInput {
  switch (context.kind) {
    case "LOT":
      return { lotId: context.id };
    case "RECEIPT":
      return { receiptId: context.id };
    case "PRODUCT":
      return { productId: context.id };
  }
}

async function assertContextExists(context: AttachmentContext): Promise<void> {
  const prisma = getPrisma();
  const exists =
    context.kind === "LOT"
      ? await prisma.lot.findUnique({ where: { id: context.id }, select: { id: true } })
      : context.kind === "RECEIPT"
        ? await prisma.receipt.findUnique({ where: { id: context.id }, select: { id: true } })
        : await prisma.product.findUnique({ where: { id: context.id }, select: { id: true } });

  if (!exists) throw new AttachmentContextNotFoundError(context.kind, context.id);
}

export async function listAttachments(
  context: AttachmentContext,
  options: { includeArchived?: boolean } = {},
): Promise<AttachmentDTO[]> {
  const attachments = await getPrisma().attachment.findMany({
    where: {
      ...contextWhere(context),
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { uploadedAt: "desc" },
  });
  return attachments.map(toAttachmentDTO);
}

export interface UploadedFile {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

/**
 * Grava o arquivo e o registro. Se o banco falhar depois do arquivo já
 * salvo, o arquivo órfão é removido — nunca fica anexo ativo apontando
 * para arquivo inexistente, nem arquivo sem registro.
 */
export async function uploadAttachment(
  context: AttachmentContext,
  documentType: AttachmentType,
  file: UploadedFile,
  actor: User,
): Promise<AttachmentDTO> {
  if (!ALLOWED_TYPES[context.kind].includes(documentType)) {
    throw new InvalidAttachmentTypeForContextError(documentType, context.kind);
  }
  if (!isAllowedMimeType(file.mimeType)) throw new UnsupportedFileTypeError(file.mimeType);

  const mimeType: AllowedMimeType = file.mimeType;
  const displayName = sanitizeFileName(file.fileName);
  if (!extensionMatchesMimeType(displayName, mimeType)) {
    throw new UnsupportedFileTypeError(`${file.mimeType} / ${displayName}`);
  }
  if (file.content.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(MAX_FILE_SIZE_BYTES);
  }

  await assertContextExists(context);

  const stored = await storeFile(file.content, mimeType);
  try {
    const attachment = await getPrisma().attachment.create({
      data: {
        documentType,
        ...(context.kind === "LOT" ? { lotId: context.id } : {}),
        ...(context.kind === "RECEIPT" ? { receiptId: context.id } : {}),
        ...(context.kind === "PRODUCT" ? { productId: context.id } : {}),
        originalFileName: displayName,
        mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        storageKey: stored.storageKey,
        uploadedByUserId: actor.id,
        uploadedByNameSnapshot: actor.name,
      },
    });
    return toAttachmentDTO(attachment);
  } catch (error) {
    // Compensação: sem registro, o arquivo não pode ficar no storage.
    await deleteStoredFile(stored.storageKey).catch(() => undefined);
    throw error;
  }
}

export async function requireAttachment(id: string): Promise<Attachment> {
  const attachment = await getPrisma().attachment.findUnique({ where: { id } });
  if (!attachment) throw new AttachmentNotFoundError(id);
  return attachment;
}

/**
 * Arquivar é o "excluir" do sistema: o registro e o arquivo continuam,
 * com quem arquivou e quando. Documento já anexado é evidência.
 */
export async function archiveAttachment(id: string, actor: User): Promise<AttachmentDTO> {
  const attachment = await requireAttachment(id);
  if (attachment.archivedAt) return toAttachmentDTO(attachment);

  const updated = await getPrisma().attachment.update({
    where: { id },
    data: {
      archivedAt: new Date(),
      archivedByUserId: actor.id,
      archivedByNameSnapshot: actor.name,
    },
  });
  return toAttachmentDTO(updated);
}
