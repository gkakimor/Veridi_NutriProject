import { z } from "zod";
import { requiredDateSchema } from "../../lib/date-schema.js";
import { limitesDeHojeComercial } from "@veridi/shared";
/**
 * O frontend envia SEMPRE os limites temporais explicitos (`from`/`to`),
 * para nao depender silenciosamente do timezone do servidor. Sem
 * parametros, o default e "hoje" resolvido no servidor.
 */
export const dashboardQuerySchema = z
  .object({
    from: requiredDateSchema.optional(),
    to: requiredDateSchema.optional(),
  })
  .transform((value) => {
    /*
     * "Hoje" é o dia civil da Veridi, de 00:00:00.000 a 23:59:59.999 em
     * `America/Sao_Paulo` — não o dia do relógio da máquina. Os componentes
     * locais de `new Date()` são os do servidor: em Railway, UTC, e o KPI do
     * dia passava a começar às 21h da véspera. O comentário acima já dizia
     * que o objetivo era não depender do fuso do servidor; a implementação
     * dependia.
     */
    const hoje = limitesDeHojeComercial();
    return {
      from: value.from ?? hoje.inicio,
      to: value.to ?? hoje.fim,
    };
  });

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
