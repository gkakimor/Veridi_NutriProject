import { z } from "zod";
import { requiredDateSchema } from "../../lib/date-schema.js";

export const createRevisionSchema = z.object({
  type: z.enum(["PRODUCTION_ORDER", "RECIPE_SHEET"]),
  title: z.string().trim().min(3).max(200).optional(),
  revision: z.string().trim().min(1, "Revisão é obrigatória").max(20),
  // Data da revisão é opcional: quando a data real do documento não é
  // conhecida com certeza, não se inventa uma.
  revisionDate: requiredDateSchema.optional(),
  preparedByUserId: z.string().trim().min(1).nullish(),
  approvedByUserId: z.string().trim().min(1).nullish(),
  activate: z.boolean().optional(),
});

export type CreateRevisionInput = z.infer<typeof createRevisionSchema>;
