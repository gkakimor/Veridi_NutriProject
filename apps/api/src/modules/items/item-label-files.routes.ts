import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodError } from "zod";
import {
  ITEM_LABEL_FILE_MAX_SIZE_BYTES,
  ITEM_LABEL_FILE_RESTORE_ROLES,
  ITEM_LABEL_FILE_UPLOAD_ROLES,
  ITEM_LABEL_FILE_VOID_ROLES,
} from "@veridi/shared";
import { exigirPerfil } from "../../lib/current-user.js";
import {
  StorageObjectAlreadyExistsError,
  StorageUnavailableError,
  armazenamentoPara,
  provedorDeArmazenamentoAtivo,
} from "../../lib/storage/index.js";
import type { LabelFileUpload } from "./item-label-file-validation.js";
import { contentDispositionInline } from "./item-label-file-validation.js";
import {
  EmptyLabelFileError,
  ItemInactiveForLabelFileError,
  ItemLabelFileIntegrityError,
  ItemLabelFileObjectMissingError,
  ItemLabelFileVersionAlreadyVoidedError,
  ItemLabelFileVersionIsCurrentError,
  ItemLabelFileVersionNotFoundError,
  ItemNotLabelError,
  LabelFileSignatureMismatchError,
  LabelFileTooLargeError,
  MissingLabelFileError,
  TooManyLabelFilesError,
  UnsupportedLabelFileTypeError,
} from "./item-label-files.errors.js";
import {
  labelFileNoteSchema,
  restoreLabelFileVersionSchema,
  voidLabelFileVersionSchema,
} from "./item-label-files.schemas.js";
import type { DependenciasDoArquivoDoRotulo } from "./item-label-files.service.js";
import {
  addItemLabelFileVersion,
  assertItemAcceptsLabelFileVersion,
  getItemLabelFile,
  openItemLabelFileVersion,
  restoreItemLabelFileVersion,
  voidItemLabelFileVersion,
} from "./item-label-files.service.js";
import { ItemNotFoundError } from "./items.errors.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/** Erros do `@fastify/multipart`, pelo código — a classe mora na instância do plugin. */
const MULTIPART_INVALIDO = new Set([
  "FST_INVALID_MULTIPART_CONTENT_TYPE",
  "FST_PARTS_LIMIT",
  "FST_FIELDS_LIMIT",
  "FST_PROTO_VIOLATION",
  "FST_MP_PREMATURE_CLOSE",
  // Corpo interrompido no meio (cliente caiu, terceiro arquivo no formulário).
  "ERR_STREAM_PREMATURE_CLOSE",
]);

function codigoDoErro(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

type Resposta = { status: number; body: { error: string; message: string } };

/**
 * Recusa de domínio → status e código. Objeto ausente é 404 no download (o
 * arquivo pedido não está lá) e 409 na restauração (a versão existe, mas não
 * pode originar outra).
 */
function mapearErro(
  error: unknown,
  request: FastifyRequest,
  objetoAusente: 404 | 409 = 404,
): Resposta | null {
  const recusa = (status: number, codigo: string, mensagem: string): Resposta => ({
    status,
    body: { error: codigo, message: mensagem },
  });

  if (error instanceof ItemNotFoundError || error instanceof ItemLabelFileVersionNotFoundError) {
    return recusa(404, "not_found", error.message);
  }
  if (error instanceof ItemNotLabelError) return recusa(409, "item_not_label", error.message);
  if (error instanceof ItemInactiveForLabelFileError) return recusa(409, "item_inactive", error.message);
  if (error instanceof ItemLabelFileVersionAlreadyVoidedError) {
    return recusa(409, "version_already_voided", error.message);
  }
  if (error instanceof ItemLabelFileVersionIsCurrentError) {
    return recusa(409, "version_is_current", error.message);
  }
  if (error instanceof MissingLabelFileError) return recusa(400, "missing_file", error.message);
  if (error instanceof EmptyLabelFileError) return recusa(400, "empty_file", error.message);
  if (error instanceof TooManyLabelFilesError || codigoDoErro(error) === "FST_FILES_LIMIT") {
    return recusa(400, "too_many_files", new TooManyLabelFilesError().message);
  }
  if (error instanceof LabelFileTooLargeError || codigoDoErro(error) === "FST_REQ_FILE_TOO_LARGE") {
    return recusa(413, "file_too_large", new LabelFileTooLargeError().message);
  }
  if (error instanceof UnsupportedLabelFileTypeError) {
    return recusa(400, "unsupported_file_type", error.message);
  }
  if (error instanceof LabelFileSignatureMismatchError) {
    return recusa(400, "file_signature_mismatch", error.message);
  }
  if (MULTIPART_INVALIDO.has(codigoDoErro(error) ?? "")) {
    return recusa(400, "invalid_multipart", "Envie um arquivo e, se quiser, a observação, como formulário.");
  }
  if (error instanceof ItemLabelFileObjectMissingError) {
    request.log.error({ labelFile: error.message }, "objeto do arquivo do rótulo ausente no storage");
    return recusa(objetoAusente, "storage_object_missing", error.message);
  }
  if (error instanceof ItemLabelFileIntegrityError) {
    request.log.error({ labelFile: error.message }, "objeto do arquivo do rótulo não confere");
    return recusa(500, "storage_integrity_error", error.message);
  }
  if (error instanceof StorageUnavailableError) {
    // `detail` diz operação, nome do erro e status — nunca endereço nem credencial.
    request.log.error({ storage: error.provider, detail: error.detail }, "armazenamento indisponível");
    return recusa(503, "storage_unavailable", error.message);
  }
  if (error instanceof StorageObjectAlreadyExistsError) {
    request.log.error({ labelFile: "chave ocupada" }, "colisão de chave no storage");
    return recusa(500, "storage_conflict", "Não foi possível gravar o arquivo. Envie de novo.");
  }
  return null;
}

function dependenciasDa(request: FastifyRequest): DependenciasDoArquivoDoRotulo {
  return {
    armazenamentoPara,
    provedorAtivo: provedorDeArmazenamentoAtivo,
    registrarFalhaDeCompensacao: (detalhe) =>
      request.log.error({ labelFile: detalhe }, "compensação do arquivo do rótulo"),
  };
}

/**
 * O formulário do envio: um arquivo e, opcionalmente, `note`. Lê as partes em
 * qualquer ordem. O arquivo é recebido até o limite de 25 MB — acima disso o
 * plugin interrompe a leitura e nada chega ao storage.
 *
 * O segundo arquivo é recusado aqui, e não pelo limite `files: 1` do plugin: ao
 * bater nesse limite o plugin destrói o arquivo que ainda está sendo lido, e a
 * leitura do PRIMEIRO cai com "Premature close" — um 500 que não diz o que houve.
 */
async function lerEnvio(
  request: FastifyRequest,
): Promise<{ upload: LabelFileUpload; note: string | undefined }> {
  let upload: LabelFileUpload | null = null;
  let note: string | undefined;

  const partes = request.parts({
    limits: { fileSize: ITEM_LABEL_FILE_MAX_SIZE_BYTES, files: 2, fields: 4, fieldSize: 8 * 1024 },
  });
  for await (const parte of partes) {
    if (parte.type === "file") {
      if (upload) {
        // Descarta o resto sem acumular: a recusa já está decidida.
        parte.file.resume();
        throw new TooManyLabelFilesError();
      }
      const content = await parte.toBuffer();
      upload = { fileName: parte.filename, declaredMimeType: parte.mimetype, content };
    } else if (parte.fieldname === "note") {
      note = typeof parte.value === "string" ? parte.value : String(parte.value ?? "");
    }
  }

  if (!upload) throw new MissingLabelFileError();
  return { upload, note };
}

/**
 * Arquivo do Item Rótulo — LABEL-ATTACHMENTS-01.
 *
 * - `GET /items/:id/label-file` — vigente e histórico. Toda sessão.
 * - `POST /items/:id/label-file/versions` — nova versão (multipart: `file`,
 *   `note`). `ITEM_LABEL_FILE_UPLOAD_ROLES`.
 * - `GET /items/:id/label-file/versions/:versionId/download` — o arquivo, em
 *   streaming, pela API autenticada. Toda sessão.
 * - `POST /items/:id/label-file/versions/:versionId/void` — anular com motivo.
 *   `ITEM_LABEL_FILE_VOID_ROLES`.
 * - `POST /items/:id/label-file/versions/:versionId/restore` — nova versão a
 *   partir de uma antiga. `ITEM_LABEL_FILE_RESTORE_ROLES`.
 *
 * O perfil é conferido antes do corpo e antes de olhar se o Item existe (§100).
 * No envio, o Item é conferido ANTES de ler o arquivo: item que não aceita
 * versão recusa sem receber bytes.
 */
export const itemLabelFilesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/items/:id/label-file", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await getItemLabelFile(id));
    } catch (error) {
      const mapeado = mapearErro(error, request);
      if (mapeado) return reply.status(mapeado.status).send(mapeado.body);
      throw error;
    }
  });

  app.post("/items/:id/label-file/versions", async (request, reply) => {
    const actor = exigirPerfil(request, reply, ITEM_LABEL_FILE_UPLOAD_ROLES);
    if (!actor) return reply;

    const { id } = request.params as { id: string };
    try {
      await assertItemAcceptsLabelFileVersion(id);
      const envio = await lerEnvio(request);

      const note = labelFileNoteSchema.safeParse(envio.note);
      if (!note.success) {
        return reply.status(400).send({
          error: "validation_error",
          issues: formatZodError(note.error).map((issue) => ({ ...issue, path: "note" })),
        });
      }

      const estado = await addItemLabelFileVersion(
        id,
        envio.upload,
        note.data,
        actor,
        dependenciasDa(request),
      );
      return reply.status(201).send(estado);
    } catch (error) {
      const mapeado = mapearErro(error, request);
      if (mapeado) return reply.status(mapeado.status).send(mapeado.body);
      throw error;
    }
  });

  app.get("/items/:id/label-file/versions/:versionId/download", async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    try {
      const { versao, objeto } = await openItemLabelFileVersion(id, versionId, dependenciasDa(request));
      reply
        .header("content-type", versao.mimeType)
        // Sem sniffing: o navegador não reinterpreta o conteúdo.
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .header("content-disposition", contentDispositionInline(versao.originalFileName));
      if (objeto.contentLength !== null) reply.header("content-length", String(objeto.contentLength));
      return reply.send(objeto.body);
    } catch (error) {
      const mapeado = mapearErro(error, request, 404);
      if (mapeado) return reply.status(mapeado.status).send(mapeado.body);
      throw error;
    }
  });

  app.post("/items/:id/label-file/versions/:versionId/void", async (request, reply) => {
    const actor = exigirPerfil(request, reply, ITEM_LABEL_FILE_VOID_ROLES);
    if (!actor) return reply;

    const { id, versionId } = request.params as { id: string; versionId: string };
    const parsed = voidLabelFileVersionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      return reply.send(await voidItemLabelFileVersion(id, versionId, parsed.data.reason, actor));
    } catch (error) {
      const mapeado = mapearErro(error, request);
      if (mapeado) return reply.status(mapeado.status).send(mapeado.body);
      throw error;
    }
  });

  app.post("/items/:id/label-file/versions/:versionId/restore", async (request, reply) => {
    const actor = exigirPerfil(request, reply, ITEM_LABEL_FILE_RESTORE_ROLES);
    if (!actor) return reply;

    const { id, versionId } = request.params as { id: string; versionId: string };
    const parsed = restoreLabelFileVersionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "validation_error", issues: formatZodError(parsed.error) });
    }

    try {
      const estado = await restoreItemLabelFileVersion(
        id,
        versionId,
        parsed.data.note,
        actor,
        dependenciasDa(request),
      );
      return reply.status(201).send(estado);
    } catch (error) {
      const mapeado = mapearErro(error, request, 409);
      if (mapeado) return reply.status(mapeado.status).send(mapeado.body);
      throw error;
    }
  });
};
