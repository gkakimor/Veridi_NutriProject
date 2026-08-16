import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { AttachmentType, User } from "@prisma/client";
import { ForbiddenError } from "../auth/auth.errors.js";
import { requireCurrentUser, requireRole } from "../../lib/current-user.js";
import { MAX_FILE_SIZE_BYTES, readFile, sanitizeFileName } from "../../lib/file-storage.js";
import { refreshCoaStatusAfterDocumentChange } from "../quality/quality.service.js";
import {
  AttachmentContextNotFoundError,
  AttachmentNotFoundError,
  FileTooLargeError,
  InvalidAttachmentTypeForContextError,
  MissingFileError,
  UnsupportedFileTypeError,
} from "./attachments.errors.js";
import type { AttachmentContext } from "./attachments.service.js";
import {
  archiveAttachment,
  listAttachments,
  requireAttachment,
  uploadAttachment,
} from "./attachments.service.js";

function mapDomainError(
  error: unknown,
): { status: number; body: { error: string; message: string } } | null {
  if (error instanceof ForbiddenError) {
    return { status: 403, body: { error: "forbidden", message: error.message } };
  }
  if (error instanceof AttachmentNotFoundError || error instanceof AttachmentContextNotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof InvalidAttachmentTypeForContextError) {
    return { status: 400, body: { error: "invalid_document_type", message: error.message } };
  }
  if (error instanceof UnsupportedFileTypeError) {
    return { status: 400, body: { error: "unsupported_file_type", message: error.message } };
  }
  if (error instanceof FileTooLargeError) {
    return { status: 400, body: { error: "file_too_large", message: error.message } };
  }
  if (error instanceof MissingFileError) {
    return { status: 400, body: { error: "missing_file", message: error.message } };
  }
  return null;
}

/** Lê o arquivo e o tipo de documento do multipart, com limite de tamanho. */
async function readUpload(
  request: FastifyRequest,
): Promise<{ documentType: AttachmentType; fileName: string; mimeType: string; content: Buffer }> {
  const part = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });
  if (!part) throw new MissingFileError();

  const content = await part.toBuffer();
  if (part.file.truncated) throw new FileTooLargeError(MAX_FILE_SIZE_BYTES);

  const documentTypeField = part.fields["documentType"];
  const documentType =
    documentTypeField && !Array.isArray(documentTypeField) && "value" in documentTypeField
      ? (String(documentTypeField.value) as AttachmentType)
      : ("OTHER" as AttachmentType);

  return { documentType, fileName: part.filename, mimeType: part.mimetype, content };
}

/**
 * `GET/POST /lots|receipts|products/:id/attachments`, download e arquivo.
 *
 * Upload de lote/recebimento: Compras, Qualidade ou ADMIN. Documentos de
 * produto (arte/ficha): Comercial, Qualidade ou ADMIN. Download: qualquer
 * usuário autenticado. Arquivar: Qualidade ou ADMIN.
 */
export const attachmentsRoutes: FastifyPluginAsync = async (app) => {
  const contexts: { path: string; kind: AttachmentContext["kind"]; uploadRoles: User["role"][] }[] =
    [
      { path: "lots", kind: "LOT", uploadRoles: ["PURCHASING", "QUALITY", "ADMIN"] },
      { path: "receipts", kind: "RECEIPT", uploadRoles: ["PURCHASING", "QUALITY", "ADMIN"] },
      { path: "products", kind: "PRODUCT", uploadRoles: ["COMMERCIAL", "QUALITY", "ADMIN"] },
      { path: "projects", kind: "PROJECT", uploadRoles: ["COMMERCIAL", "QUALITY", "ADMIN"] },
      // Resultado de teste de amostra vem de quem produziu ou de quem
      // avalia — Produção entra aqui, ao contrário do projeto comercial.
      {
        path: "project-samples",
        kind: "PROJECT_SAMPLE",
        uploadRoles: ["COMMERCIAL", "PRODUCTION", "QUALITY", "ADMIN"],
      },
    ];

  for (const context of contexts) {
    app.get(`/${context.path}/:id/attachments`, async (request, reply) => {
      const { id } = request.params as { id: string };
      const { includeArchived } = request.query as { includeArchived?: string };
      requireCurrentUser(request);

      const attachments = await listAttachments(
        { kind: context.kind, id },
        { includeArchived: includeArchived === "true" },
      );
      return reply.send({ attachments });
    });

    app.post(`/${context.path}/:id/attachments`, async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const actor = requireRole(request, ...context.uploadRoles);
        const upload = await readUpload(request);

        const attachment = await uploadAttachment(
          { kind: context.kind, id },
          upload.documentType,
          { fileName: upload.fileName, mimeType: upload.mimeType, content: upload.content },
          actor,
        );

        // Documento chegou: o estado documental do lote acompanha
        // (PENDING -> RECEIVED). Nunca aprova sozinho.
        if (context.kind === "LOT") await refreshCoaStatusAfterDocumentChange(id);

        return reply.status(201).send(attachment);
      } catch (error) {
        const mapped = mapDomainError(error);
        if (mapped) return reply.status(mapped.status).send(mapped.body);
        throw error;
      }
    });
  }

  app.get("/attachments/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      requireCurrentUser(request);
      const attachment = await requireAttachment(id);
      const content = await readFile(attachment.storageKey);

      return reply
        .header("content-type", attachment.mimeType)
        // Sem sniffing: o navegador não pode reinterpretar o conteúdo.
        .header("x-content-type-options", "nosniff")
        .header(
          "content-disposition",
          `inline; filename="${sanitizeFileName(attachment.originalFileName)}"`,
        )
        .send(content);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });

  app.post("/attachments/:id/archive", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const actor = requireRole(request, "QUALITY", "ADMIN");
      const attachment = await requireAttachment(id);
      const archived = await archiveAttachment(id, actor);

      // Sem documento ativo, o lote volta a ser pendência documental — mas
      // um CoA já aprovado nunca regride sozinho.
      if (attachment.lotId) await refreshCoaStatusAfterDocumentChange(attachment.lotId);

      return reply.send(archived);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return reply.status(mapped.status).send(mapped.body);
      throw error;
    }
  });
};
