import { z } from "zod";
import { booleanoDeConsultaSchema } from "../../lib/boolean-schema.js";

/**
 * `GET /<contexto>/:id/attachments` — QUERY-BOOLEAN-PERMISSIVE-REMAINING-01.
 *
 * A rota lia `request.query` cru e comparava `includeArchived` com `"true"` à
 * mão: todo outro texto escondia o arquivado, calado. Agora é o contrato de
 * todo booleano de query: `"true"`/`"false"` exatos, o resto é 400. Ausente:
 * só os ativos. A tela manda `true` ou omite.
 */
export const listAttachmentsQuerySchema = z.object({
  includeArchived: booleanoDeConsultaSchema().default(false),
});
