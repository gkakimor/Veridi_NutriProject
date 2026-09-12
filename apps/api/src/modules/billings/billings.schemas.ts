import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { diaCivilDeFiltroSchema } from "../../lib/date-schema.js";
import {
  CASAS_PRECO_COMERCIAL,
  casasDecimais,
  mensagemCasasPrecoComercial,
} from "../../lib/decimal-schema.js";

/**
 * Teto de casas do preco COMERCIAL — `PRODUCT_RULES.md` §58 e §60.
 *
 * `BillingLine.unitPrice` e `DECIMAL(14,4)`, e continua sendo: preco faturado
 * e valor de documento. Antes deste teto, `4,05318` era aceito e o PostgreSQL
 * gravava `4,0532` sem dizer que trocou o numero — a pessoa via um preco na
 * tela e outro na nota.
 *
 * Fica aqui, e nao em `decimalStringSchema`, porque estes dois campos tem
 * forma propria: string vazia LIMPA o valor, zero e bonificacao legitima e
 * distinta de ausente. A mensagem, essa, e a mesma do resto do sistema.
 */
function precisaoComercialOk(value: string | undefined): boolean {
  if (value === undefined || value === "") return true;
  return casasDecimais(value) <= CASAS_PRECO_COMERCIAL;
}

export const createBillingSchema = z.object({
  shipmentId: z.string().trim().min(1, "Expedição é obrigatória"),
});

/**
 * `unitPrice` opcional e limpavel: chave ausente = nao mexe; "" = null
 * (limpa); valor = seta. Mesmo idiom de `optionalNullableText`. Preco
 * negativo e rejeitado; zero e aceito (brinde/bonificacao).
 */
const updateBillingLineSchema = z.object({
  billingLineId: z.string().trim().min(1, "Linha de faturamento é obrigatória"),
  unitPrice: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined ? undefined : String(value).trim()))
    .refine((value) => value === undefined || value === "" || /^\d+(\.\d+)?$/.test(value), {
      message: "Preço unitário inválido (não pode ser negativo)",
    })
    .refine(precisaoComercialOk, { message: mensagemCasasPrecoComercial() }),
});

export const updateBillingSchema = z.object({
  externalReference: optionalNullableText(200),
  notes: optionalNullableText(1000),
  lines: z.array(updateBillingLineSchema).optional(),
});

/**
 * Sobreposicao do preco faturado. Nao e "editar o campo": e um ato
 * proprio, com motivo obrigatorio, que preserva o preco acordado ao lado.
 * Zero e aceito (bonificacao); negativo, nao.
 */
export const overrideBillingPriceSchema = z.object({
  unitPrice: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => /^\d+(\.\d+)?$/.test(value), {
      message: "Preço unitário inválido (não pode ser negativo)",
    })
    .refine(precisaoComercialOk, { message: mensagemCasasPrecoComercial() }),
  reason: z.string().trim().min(3, "Motivo da alteração é obrigatório").max(500),
});

export const cancelBillingSchema = z.object({
  reason: z.string().trim().min(3, "Motivo do cancelamento é obrigatório").max(500),
});

export const listBillingsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  /** "Quero ver só os faturamentos do cliente X" é a pergunta desta tela. */
  customerId: z.string().trim().min(1).optional(),
  customerOrderId: z.string().trim().min(1).optional(),
  shipmentId: z.string().trim().min(1).optional(),
  status: z.enum(["DRAFT", "ISSUED", "CANCELLED"]).optional(),
  /*
   * Período = DIA COMERCIAL, não instante UTC digitado. As duas pontas
   * viajam como `YYYY-MM-DD` e só viram instante em `listBillings`, por
   * `intervaloDeDiasComerciais`. Sobre a troca de `z.coerce.date()`, ver
   * `diaCivilDeFiltroSchema`.
   */
  dateFrom: diaCivilDeFiltroSchema,
  dateTo: diaCivilDeFiltroSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateBillingInput = z.infer<typeof createBillingSchema>;
export type UpdateBillingLineInput = z.infer<typeof updateBillingLineSchema>;
export type UpdateBillingInput = z.infer<typeof updateBillingSchema>;
export type OverrideBillingPriceInput = z.infer<typeof overrideBillingPriceSchema>;
export type CancelBillingInput = z.infer<typeof cancelBillingSchema>;
export type ListBillingsQuery = z.infer<typeof listBillingsQuerySchema>;
