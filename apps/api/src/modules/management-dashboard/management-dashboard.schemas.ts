import { z } from "zod";
import { recusaDoPeriodoGerencial } from "@veridi/shared";
import { diaCivilDeFiltroSchema } from "../../lib/date-schema.js";

/**
 * Período do Painel Gerencial.
 *
 * Os atalhos viajam pelo NOME (`mes-atual`, `mes-anterior`, `acumulado-ano`):
 * quem decide que mês e que ano eles são é o servidor, no dia comercial do
 * instante da requisição, e é do nome que sai a comparação equivalente — o
 * mês em andamento não se compara como um intervalo qualquer. Só o
 * Personalizado leva datas, como DIAS (`YYYY-MM-DD`), nunca instantes, e com
 * as duas pontas (`recusaDoPeriodoGerencial`, a mesma regra da tela).
 *
 * A lista de atalhos repete `MANAGEMENT_PERIOD_PRESETS` porque o `z.enum` pede
 * a tupla literal; o teste da rota confere que as duas são a mesma.
 */
export const managementDashboardQuerySchema = z
  .object({
    period: z.enum(["mes-atual", "mes-anterior", "acumulado-ano", "custom"]).default("mes-atual"),
    dateFrom: diaCivilDeFiltroSchema,
    dateTo: diaCivilDeFiltroSchema,
  })
  .superRefine((query, ctx) => {
    const recusa = recusaDoPeriodoGerencial(query.period, query.dateFrom, query.dateTo);
    if (recusa) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [recusa.campo], message: recusa.mensagem });
  });

export type ManagementDashboardQuery = z.output<typeof managementDashboardQuerySchema>;
