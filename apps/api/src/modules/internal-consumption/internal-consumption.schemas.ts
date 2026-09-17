import { z } from "zod";
import { ehDiaCivil } from "@veridi/shared";
import { quantityDecimalSchema } from "../../lib/decimal-schema.js";
import { diaCivilDeFiltroSchema, recusarPeriodoInvertido } from "../../lib/date-schema.js";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";

/**
 * Texto livre opcional e limpável: chave ausente = não mexe, `""` = sem valor.
 *
 * Destino/uso e observação são os dois campos em que o operador escreve o que
 * quiser. Guardar `""` no lugar de `null` faria a tela imprimir um traço vazio
 * onde deveria dizer "não informado".
 */
function textoLivreOpcional(maximo: number) {
  return z
    .string()
    .trim()
    .max(maximo, `Use no máximo ${maximo} caracteres`)
    .optional()
    .nullable()
    .transform((valor) => (valor === undefined ? undefined : valor === "" ? null : valor));
}

export const createInternalConsumptionSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  lotId: z.string().trim().min(1).optional(),
  quantity: quantityDecimalSchema(),
  /**
   * DIA CIVIL (`AAAA-MM-DD`), nunca um instante — a pessoa escolhe o dia num
   * `<input type="date">` e nunca escolhe hora. Quem o transforma no instante
   * gravado é o serviço, com o fuso da operação: materializar aqui a
   * meia-noite UTC faria o consumo do dia 15 nascer às 21h do dia 14 em São
   * Paulo, e a hierarquia de custo perguntaria pelo dia errado.
   *
   * Ausente = hoje.
   */
  occurredOn: z
    .string()
    .trim()
    .refine((valor) => ehDiaCivil(valor), { message: "Data inválida (use AAAA-MM-DD)" })
    .optional(),
  purpose: textoLivreOpcional(120),
  notes: textoLivreOpcional(500),
});

export type CreateInternalConsumptionBody = z.infer<typeof createInternalConsumptionSchema>;

export const listInternalConsumptionsQuerySchema = z
  .object({
    search: z.string().trim().min(1).optional(),
    itemId: z.string().trim().min(1).optional(),
    dateFrom: diaCivilDeFiltroSchema,
    dateTo: diaCivilDeFiltroSchema,
    page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
    pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
  })
  .superRefine(recusarPeriodoInvertido("dateFrom", "dateTo"));

export type ListInternalConsumptionsQuery = z.infer<typeof listInternalConsumptionsQuerySchema>;
