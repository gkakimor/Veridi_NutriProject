import { z } from "zod";
import { requiredDateSchema } from "../../lib/date-schema.js";

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
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return {
      from: value.from ?? startOfToday,
      to: value.to ?? now,
    };
  });

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
