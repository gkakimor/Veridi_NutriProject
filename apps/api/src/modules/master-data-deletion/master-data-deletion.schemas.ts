import { z } from "zod";
import { MASTER_DATA_DELETION_REASON_MAX_LENGTH } from "@veridi/shared";

/**
 * Corpo de `DELETE <cadastro>/:id`. O motivo é OBRIGATÓRIO: o rastro existe
 * para responder "por que isto sumiu", e exclusão sem motivo não responde
 * nada. Só espaços é o mesmo que vazio.
 */
export const deleteMasterDataSchema = z.object(
  {
    reason: z
      .string({
        required_error: "Informe o motivo da exclusão.",
        invalid_type_error: "Informe o motivo da exclusão.",
      })
      .trim()
      .min(1, "Informe o motivo da exclusão.")
      .max(MASTER_DATA_DELETION_REASON_MAX_LENGTH),
  },
  {
    required_error: "Informe o motivo da exclusão.",
    invalid_type_error: "Informe o motivo da exclusão.",
  },
);
