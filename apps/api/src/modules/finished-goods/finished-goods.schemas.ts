import { z } from "zod";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";
import { diaCivilDeFiltroSchema, recusarPeriodoInvertido } from "../../lib/date-schema.js";

export const listFinishedGoodsQuerySchema = z
  .object({
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
    page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
    pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
  })
  .superRefine(recusarPeriodoInvertido("dateFrom", "dateTo"));

export type ListFinishedGoodsQuery = z.infer<typeof listFinishedGoodsQuerySchema>;
