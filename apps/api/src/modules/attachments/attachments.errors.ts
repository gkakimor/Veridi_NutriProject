export class AttachmentNotFoundError extends Error {
  constructor(id: string) {
    super(`Documento não encontrado: ${id}`);
    this.name = "AttachmentNotFoundError";
  }
}

export class AttachmentContextNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`Registro de destino do documento não encontrado (${kind}: ${id}).`);
    this.name = "AttachmentContextNotFoundError";
  }
}

/** Ex.: CoA só existe em lote; arte de rótulo só em produto. */
export class InvalidAttachmentTypeForContextError extends Error {
  constructor(documentType: string, kind: string) {
    super(`Tipo de documento ${documentType} não é aceito neste contexto (${kind}).`);
    this.name = "InvalidAttachmentTypeForContextError";
  }
}

export class UnsupportedFileTypeError extends Error {
  constructor(mimeType: string) {
    super(`Tipo de arquivo não aceito (${mimeType}). Envie PDF, PNG ou JPEG.`);
    this.name = "UnsupportedFileTypeError";
  }
}

export class FileTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Arquivo acima do limite de ${Math.round(limitBytes / (1024 * 1024))} MB.`);
    this.name = "FileTooLargeError";
  }
}

export class MissingFileError extends Error {
  constructor() {
    super("Nenhum arquivo enviado.");
    this.name = "MissingFileError";
  }
}
