import { z } from "zod";
import { requiredDateSchema } from "../../lib/date-schema.js";
import {
  CASAS_CUSTO_UNITARIO,
  casasDecimais,
  mensagemCasasCustoUnitario,
} from "../../lib/decimal-schema.js";

/**
 * `unitCost` aceita string vazia (limpa o custo, volta a desconhecido) ou
 * decimal >= 0. Negativo e rejeitado aqui e tambem no service. Zero e
 * valido — nunca confundido com desconhecido.
 */
export const setAcquisitionCostSchema = z.object({
  unitCost: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => value === "" || /^\d+(\.\d+)?$/.test(value), {
      message: "Custo unitário inválido (não pode ser negativo)",
    })
    // A coluna guarda 8 casas (`DECIMAL(20,8)`, PREC-MIG-B). Acima disso o
    // PostgreSQL arredondaria em silêncio, e este é o custo real que alimenta
    // média ponderada, estoque e CMV: a fronteira recusa e diz por quê.
    .refine((value) => value === "" || casasDecimais(value) <= CASAS_CUSTO_UNITARIO, {
      message: mensagemCasasCustoUnitario(),
    }),
  note: z.string().trim().max(500).optional(),
});

export const costReferenceQuerySchema = z.object({
  referenceDate: requiredDateSchema.optional(),
});

export type SetAcquisitionCostInput = z.infer<typeof setAcquisitionCostSchema>;
export type CostReferenceQuery = z.infer<typeof costReferenceQuerySchema>;
