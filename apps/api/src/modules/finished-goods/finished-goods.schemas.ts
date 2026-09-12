import { z } from "zod";
import { diaCivilDeFiltroSchema } from "../../lib/date-schema.js";

export const listFinishedGoodsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: z.enum(["AWAITING_RELEASE", "AVAILABLE", "BLOCKED", "EXPIRED"]).optional(),
  productId: z.string().trim().min(1).optional(),
  productionOrderId: z.string().trim().min(1).optional(),
  /*
   * Período = DIA COMERCIAL. `ProductionOutput.producedAt` é INSTANTE, e o
   * filtro é um dia de calendário. A tela mandava
   * `new Date(`${dia}T00:00:00`)` — componentes LOCAIS do navegador —, então
   * o mesmo filtro devolvia conjuntos diferentes em São Paulo, em Vancouver e
   * em Tóquio. Agora chega o dia, e quem o abre em instantes é
   * `intervaloDeDiasComerciais`.
   */
  dateFrom: diaCivilDeFiltroSchema,
  dateTo: diaCivilDeFiltroSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListFinishedGoodsQuery = z.infer<typeof listFinishedGoodsQuerySchema>;
