/**
 * Arquivo do Item Rótulo — LABEL-ATTACHMENTS-01.
 *
 * Rótulo é o Item de embalagem com subtipo Rótulo (`type = PACKAGING`,
 * `packagingSubtype = LABEL`) — nunca decidido pelo nome do Item. O arquivo
 * dele (a arte que vai para a gráfica) tem VERSÕES imutáveis: V1, V2, V3...
 *
 * - enviar arquivo novo cria a versão seguinte; nada é sobrescrito;
 * - a versão vigente é a de maior número que não foi anulada;
 * - anular exige motivo, tira a versão de vigência e não apaga os bytes;
 * - restaurar uma versão antiga cria uma versão NOVA no topo, com o mesmo
 *   arquivo — a antiga continua como estava, anulada ou não.
 *
 * Não confundir com `AttachmentType.LABEL_ART` do Produto: aquele é documento
 * anexado ao Produto, sem versão; este é o arquivo do Item Rótulo.
 */

import type { ItemType, PackagingSubtype } from "./items.js";
import type { UserRole } from "./users.js";

/** O Item é Rótulo? Pelo tipo e pelo subtipo — nunca pelo nome. */
export function isLabelItem(item: {
  type: ItemType;
  packagingSubtype: PackagingSubtype | null;
}): boolean {
  return item.type === "PACKAGING" && item.packagingSubtype === "LABEL";
}

/**
 * Quem ENVIA nova versão do arquivo do rótulo. Lista própria, decidida no
 * handoff de LABEL-ATTACHMENTS-01: não é `ITEM_EDIT_ROLES` (a Produção edita o
 * Item e não envia arte; o Comercial não edita o Item e envia) nem
 * `PRODUCT_DOCUMENT_UPLOAD_ROLES` (Compras entra aqui — é quem fala com a
 * gráfica).
 */
export const ITEM_LABEL_FILE_UPLOAD_ROLES: readonly UserRole[] = [
  "PURCHASING",
  "QUALITY",
  "COMMERCIAL",
  "ADMIN",
];

/** Quem RESTAURA versão antiga como nova versão — os mesmos que enviam. */
export const ITEM_LABEL_FILE_RESTORE_ROLES: readonly UserRole[] = [
  "PURCHASING",
  "QUALITY",
  "COMMERCIAL",
  "ADMIN",
];

/**
 * Quem ANULA versão. A mesma autoridade que arquiva documento anexado
 * (`ATTACHMENT_ARCHIVE_ROLES`): tirar um arquivo de circulação é decisão da
 * Qualidade.
 */
export const ITEM_LABEL_FILE_VOID_ROLES: readonly UserRole[] = ["QUALITY", "ADMIN"];

export type ItemLabelFileMimeType = "application/pdf" | "image/png" | "image/jpeg";

export const ITEM_LABEL_FILE_MIME_TYPES: readonly ItemLabelFileMimeType[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];

/** Extensões aceitas para cada tipo — o nome, o tipo declarado e o conteúdo têm de concordar. */
export const ITEM_LABEL_FILE_EXTENSIONS: Record<ItemLabelFileMimeType, readonly string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

export const ITEM_LABEL_FILE_TYPE_LABELS: Record<ItemLabelFileMimeType, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
};

/** 25 MB por arquivo. */
export const ITEM_LABEL_FILE_MAX_SIZE_BYTES = 25 * 1024 * 1024;

export const ITEM_LABEL_FILE_NOTE_MAX_LENGTH = 500;
export const ITEM_LABEL_FILE_VOID_REASON_MAX_LENGTH = 500;

/** O `accept` do campo de arquivo — derivado das mesmas listas que a API aplica. */
export const ITEM_LABEL_FILE_ACCEPT = [
  ...ITEM_LABEL_FILE_MIME_TYPES,
  ...ITEM_LABEL_FILE_MIME_TYPES.flatMap((tipo) => ITEM_LABEL_FILE_EXTENSIONS[tipo]),
].join(",");

/** Tipo aceito pela extensão do nome — `null` quando a extensão não é aceita. */
export function itemLabelFileMimeTypeByExtension(fileName: string): ItemLabelFileMimeType | null {
  const ponto = fileName.lastIndexOf(".");
  if (ponto < 0) return null;
  const extensao = fileName.slice(ponto).toLowerCase();
  return (
    ITEM_LABEL_FILE_MIME_TYPES.find((tipo) => ITEM_LABEL_FILE_EXTENSIONS[tipo].includes(extensao)) ??
    null
  );
}

/**
 * Situação da versão, derivada — nunca gravada:
 * - `CURRENT`: a de maior número entre as não anuladas;
 * - `HISTORICAL`: não anulada, mas com versão vigente acima dela;
 * - `VOIDED`: anulada.
 */
export type ItemLabelFileVersionStatus = "CURRENT" | "HISTORICAL" | "VOIDED";

export const ITEM_LABEL_FILE_VERSION_STATUS_LABELS: Record<ItemLabelFileVersionStatus, string> = {
  CURRENT: "Vigente",
  HISTORICAL: "Histórica",
  VOIDED: "Anulada",
};

export interface ItemLabelFileVersionDTO {
  id: string;
  itemId: string;
  /** V1, V2... sequencial por Item. */
  versionNumber: number;
  status: ItemLabelFileVersionStatus;
  /** Nome enviado, só para exibição e download — nunca identidade nem caminho. */
  originalFileName: string;
  mimeType: ItemLabelFileMimeType;
  sizeBytes: number;
  note: string | null;
  /** Versão de origem quando esta nasceu de uma restauração; `null` quando foi enviada. */
  restoredFromVersionNumber: number | null;
  createdAt: string;
  /** Nome de quem enviou (ou restaurou) no momento — renomear o usuário não reescreve. */
  createdByName: string;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
}

export interface ItemLabelFileResponse {
  itemId: string;
  /** O Item é Rótulo (embalagem com subtipo Rótulo). */
  labelItem: boolean;
  itemActive: boolean;
  /** Recebe nova versão (envio ou restauração) agora: Rótulo e ativo. */
  acceptsNewVersion: boolean;
  /** A versão vigente; `null` = sem arquivo vigente. */
  current: ItemLabelFileVersionDTO | null;
  /** Todas as versões, da mais nova para a mais antiga. */
  versions: ItemLabelFileVersionDTO[];
}

export interface VoidItemLabelFileVersionInput {
  reason: string;
}

export interface RestoreItemLabelFileVersionInput {
  note?: string;
}
