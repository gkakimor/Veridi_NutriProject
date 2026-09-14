export class CoaNotRequiredError extends Error {
  constructor(lotCode: string) {
    super(`O lote ${lotCode} não exige laudo/CoA.`);
    this.name = "CoaNotRequiredError";
  }
}

/** Aprovar sem documento anexado seria aprovar o nada. */
export class MissingCoaDocumentError extends Error {
  constructor() {
    super("Anexe o CoA antes de aprovar.");
    this.name = "MissingCoaDocumentError";
  }
}

export class MissingRejectionReasonError extends Error {
  constructor() {
    super("Informe o motivo da rejeição do CoA.");
    this.name = "MissingRejectionReasonError";
  }
}

export class CoaAlreadyApprovedError extends Error {
  constructor(lotCode: string) {
    super(
      `O CoA do lote ${lotCode} já está aprovado — para substituir o documento, anexe um novo laudo.`,
    );
    this.name = "CoaAlreadyApprovedError";
  }
}

/**
 * O recorte inteiro da fila (`all=true`) passa do teto: recusa, nunca os
 * primeiros N (PAGED-DOCUMENT-SNAPSHOT-01).
 */
export class QualityQueueTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(
      `A fila tem mais de ${new Intl.NumberFormat("pt-BR").format(limit)} lotes neste recorte — acima do limite de um documento. Trate parte das pendências em Qualidade → Documentos / CoA e gere de novo.`,
    );
    this.name = "QualityQueueTooLargeError";
  }
}

/** Liberação da Qualidade barrada por pendência documental. */
export class CoaNotApprovedError extends Error {
  constructor() {
    super("CoA deste lote ainda não foi aprovado.");
    this.name = "CoaNotApprovedError";
  }
}
