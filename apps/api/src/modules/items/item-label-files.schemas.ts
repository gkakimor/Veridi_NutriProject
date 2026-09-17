import { z } from "zod";
import {
  ITEM_LABEL_FILE_NOTE_MAX_LENGTH,
  ITEM_LABEL_FILE_VOID_REASON_MAX_LENGTH,
} from "@veridi/shared";

/**
 * Corpos do arquivo do rótulo — LABEL-ATTACHMENTS-01.
 *
 * Observação é opcional: espaço em branco vira ausência (`null`). Motivo de
 * anulação é obrigatório: espaço em branco é motivo nenhum.
 */

export const labelFileNoteSchema = z
  .string()
  .trim()
  .max(ITEM_LABEL_FILE_NOTE_MAX_LENGTH, `Observação com até ${ITEM_LABEL_FILE_NOTE_MAX_LENGTH} caracteres.`)
  .nullish()
  .transform((valor) => (valor ? valor : null));

export const voidLabelFileVersionSchema = z.object({
  reason: z
    .string({ required_error: "Informe o motivo da anulação." })
    .trim()
    .min(1, "Informe o motivo da anulação.")
    .max(
      ITEM_LABEL_FILE_VOID_REASON_MAX_LENGTH,
      `Motivo com até ${ITEM_LABEL_FILE_VOID_REASON_MAX_LENGTH} caracteres.`,
    ),
});

export const restoreLabelFileVersionSchema = z.object({
  note: labelFileNoteSchema,
});
