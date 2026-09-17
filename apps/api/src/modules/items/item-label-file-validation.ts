import type { ItemLabelFileMimeType } from "@veridi/shared";
import {
  ITEM_LABEL_FILE_EXTENSIONS,
  ITEM_LABEL_FILE_MAX_SIZE_BYTES,
  ITEM_LABEL_FILE_MIME_TYPES,
  ITEM_LABEL_FILE_TYPE_LABELS,
  itemLabelFileMimeTypeByExtension,
} from "@veridi/shared";
import { detectFileTypeBySignature } from "../../lib/file-signature.js";
import {
  EmptyLabelFileError,
  LabelFileSignatureMismatchError,
  LabelFileTooLargeError,
  UnsupportedLabelFileTypeError,
} from "./item-label-files.errors.js";

/**
 * O arquivo do rótulo antes de chegar ao storage — LABEL-ATTACHMENTS-01.
 *
 * Três declarações têm de concordar: a extensão do nome, o tipo que o navegador
 * mandou e a assinatura do conteúdo. Qualquer uma fora de PDF, PNG e JPEG, ou
 * discordando das outras, recusa. O nome enviado é só metadado: limpo para
 * exibição e para o cabeçalho do download, nunca chave nem caminho.
 */

export interface LabelFileUpload {
  fileName: string;
  declaredMimeType: string;
  content: Buffer;
}

export interface ValidatedLabelFile {
  displayName: string;
  mimeType: ItemLabelFileMimeType;
  /** Extensão canônica do tipo, a da chave no storage (`.pdf`, `.png`, `.jpg`). */
  storageExtension: string;
  content: Buffer;
}

/**
 * Controles e marcas invisíveis de direção. As de direção (U+202E e vizinhas)
 * fazem `arte<U+202E>fdp.exe` aparecer como `arteexe.pdf` — some antes de a extensão
 * ser lida.
 */
const INVISIVEIS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const LIMITE_DO_NOME = 180;

/** Nome para exibição: sem pasta, sem controle, espaço único, até 180 caracteres com a extensão. */
export function nomeOriginalSeguro(bruto: string): string {
  const semPasta = bruto.replace(/\\/g, "/").split("/").pop() ?? "";
  const limpo = semPasta.replace(INVISIVEIS, "").replace(/\s+/g, " ").trim();
  if (limpo.length <= LIMITE_DO_NOME) return limpo;
  const ponto = limpo.lastIndexOf(".");
  const extensao = ponto > 0 && limpo.length - ponto <= 10 ? limpo.slice(ponto) : "";
  return `${limpo.slice(0, LIMITE_DO_NOME - extensao.length).trimEnd()}${extensao}`;
}

export function validarArquivoDoRotulo(upload: LabelFileUpload): ValidatedLabelFile {
  if (upload.content.byteLength === 0) throw new EmptyLabelFileError();
  if (upload.content.byteLength > ITEM_LABEL_FILE_MAX_SIZE_BYTES) throw new LabelFileTooLargeError();

  const nome = nomeOriginalSeguro(upload.fileName);
  const pelaExtensao = itemLabelFileMimeTypeByExtension(nome);
  if (!pelaExtensao) throw new UnsupportedLabelFileTypeError(nome ? `extensão de "${nome}"` : "arquivo sem nome");

  const declarado = (upload.declaredMimeType.split(";")[0] ?? "").trim().toLowerCase();
  if (!(ITEM_LABEL_FILE_MIME_TYPES as readonly string[]).includes(declarado)) {
    throw new UnsupportedLabelFileTypeError(declarado ? `tipo ${declarado}` : "tipo não informado");
  }
  if (declarado !== pelaExtensao) {
    throw new UnsupportedLabelFileTypeError(
      `o nome diz ${ITEM_LABEL_FILE_TYPE_LABELS[pelaExtensao]} e o tipo informado diz ${ITEM_LABEL_FILE_TYPE_LABELS[declarado as ItemLabelFileMimeType]}`,
    );
  }

  if (detectFileTypeBySignature(upload.content) !== pelaExtensao) {
    throw new LabelFileSignatureMismatchError(ITEM_LABEL_FILE_TYPE_LABELS[pelaExtensao]);
  }

  const ponto = nome.lastIndexOf(".");
  const displayName = ponto > 0 ? nome : `rotulo${nome.slice(ponto)}`;

  return {
    displayName,
    mimeType: pelaExtensao,
    storageExtension: ITEM_LABEL_FILE_EXTENSIONS[pelaExtensao][0] ?? "",
    content: upload.content,
  };
}

/**
 * `Content-Disposition` do download: `inline` (o navegador mostra PDF e imagem)
 * com o nome enviado. `filename` leva a versão ASCII, sem aspas nem barra;
 * `filename*` leva o nome em UTF-8 (RFC 6266/5987) — "Rótulo" continua
 * "Rótulo" no navegador que entende, e nada quebra o cabeçalho no que não
 * entende.
 */
export function contentDispositionInline(nome: string): string {
  const ascii =
    nome
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "rotulo";
  const utf8 = encodeURIComponent(nome).replace(
    /['()*]/g,
    (caractere) => `%${caractere.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
