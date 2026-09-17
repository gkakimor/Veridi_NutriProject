import { ITEM_LABEL_FILE_MAX_SIZE_BYTES } from "@veridi/shared";

/** Nova versão só para Item de embalagem com subtipo Rótulo. */
export class ItemNotLabelError extends Error {
  constructor() {
    super(
      "Arquivo de rótulo só existe para Item de embalagem com subtipo Rótulo. Confira o tipo e o subtipo do item.",
    );
    this.name = "ItemNotLabelError";
  }
}

/** Item inativo guarda o histórico, mas não recebe versão nova. */
export class ItemInactiveForLabelFileError extends Error {
  constructor() {
    super("Item inativo não recebe nova versão do arquivo do rótulo. O histórico continua disponível.");
    this.name = "ItemInactiveForLabelFileError";
  }
}

export class ItemLabelFileVersionNotFoundError extends Error {
  constructor() {
    super("Versão do arquivo do rótulo não encontrada neste item.");
    this.name = "ItemLabelFileVersionNotFoundError";
  }
}

export class ItemLabelFileVersionAlreadyVoidedError extends Error {
  constructor(versionNumber: number) {
    super(`A V${versionNumber} já está anulada.`);
    this.name = "ItemLabelFileVersionAlreadyVoidedError";
  }
}

/** Restaurar a vigente criaria uma cópia dela mesma no topo. */
export class ItemLabelFileVersionIsCurrentError extends Error {
  constructor(versionNumber: number) {
    super(`A V${versionNumber} já é a versão vigente — não há o que restaurar.`);
    this.name = "ItemLabelFileVersionIsCurrentError";
  }
}

/** A linha existe e o objeto sumiu do storage: nada é criado a partir dela. */
export class ItemLabelFileObjectMissingError extends Error {
  constructor(versionNumber: number) {
    super(
      `O arquivo da V${versionNumber} não foi encontrado no armazenamento. Avise o administrador do sistema.`,
    );
    this.name = "ItemLabelFileObjectMissingError";
  }
}

/** O objeto existe, mas não tem o tamanho que o banco registrou. Não é servido. */
export class ItemLabelFileIntegrityError extends Error {
  constructor(versionNumber: number) {
    super(
      `O arquivo da V${versionNumber} no armazenamento não confere com o registrado. Avise o administrador do sistema.`,
    );
    this.name = "ItemLabelFileIntegrityError";
  }
}

export class MissingLabelFileError extends Error {
  constructor() {
    super("Nenhum arquivo enviado.");
    this.name = "MissingLabelFileError";
  }
}

export class TooManyLabelFilesError extends Error {
  constructor() {
    super("Envie um arquivo por vez.");
    this.name = "TooManyLabelFilesError";
  }
}

export class EmptyLabelFileError extends Error {
  constructor() {
    super("O arquivo enviado está vazio.");
    this.name = "EmptyLabelFileError";
  }
}

export class LabelFileTooLargeError extends Error {
  constructor() {
    super(
      `Arquivo acima do limite de ${Math.round(ITEM_LABEL_FILE_MAX_SIZE_BYTES / (1024 * 1024))} MB.`,
    );
    this.name = "LabelFileTooLargeError";
  }
}

/** Extensão ou tipo declarado fora de PDF, PNG e JPEG — ou os dois discordando. */
export class UnsupportedLabelFileTypeError extends Error {
  constructor(detalhe: string) {
    super(`Tipo de arquivo não aceito${detalhe ? ` (${detalhe})` : ""}. Envie PDF, PNG ou JPEG.`);
    this.name = "UnsupportedLabelFileTypeError";
  }
}

/** Nome e tipo dizem uma coisa; o conteúdo, outra. */
export class LabelFileSignatureMismatchError extends Error {
  constructor(tipoEsperado: string) {
    super(
      `O conteúdo do arquivo não é um ${tipoEsperado} válido. Exporte o arquivo de novo e envie outra vez.`,
    );
    this.name = "LabelFileSignatureMismatchError";
  }
}
