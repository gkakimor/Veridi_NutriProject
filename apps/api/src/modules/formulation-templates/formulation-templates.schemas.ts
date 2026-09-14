import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import {
  CASAS_PERCENTUAL_TECNICO,
  casasDecimais,
  mensagemCasasPercentualTecnico,
} from "../../lib/decimal-schema.js";
import { optionalPurityPercent } from "../../lib/industrial-schema.js";
import { inteiroDecimalSchema } from "../../lib/integer-schema.js";

/** Doses por embalagem: inteiro estrito (API-INT-COERCION-01), maior que zero. */
const dosesPerPackage = inteiroDecimalSchema().pipe(z.number().int().positive()).nullish();

const decimalString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d+)?$/.test(value), { message: "Valor inválido" });

/**
 * Overage do template — `DECIMAL(9,6)` desde o PREC-MIG-C.
 *
 * O template é a origem de uma versão de Formulação: um valor cortado aqui
 * chegaria cortado lá, e a perda apareceria como divergência entre o template
 * e a receita gerada dele. O limite de casas é o mesmo dos demais percentuais
 * técnicos.
 */
const percentualTecnicoDoTemplate = decimalString.refine(
  (value) => casasDecimais(value) <= CASAS_PERCENTUAL_TECNICO,
  { message: mensagemCasasPercentualTecnico() },
);

const componentSchema = z.object({
  itemId: z.string().trim().min(1),
  quantity: decimalString,
  unitCode: z.string().trim().min(1).max(20),
  basis: z.enum(["FIXED_BASIS", "PER_DOSE", "PER_FINISHED_UNIT"]).optional(),
  supplyResponsibility: z.enum(["VERIDI", "CUSTOMER"]).optional(),
  /*
   * Pureza: a MESMA regra do componente da Formulação — `0 < x <= 100`, até seis
   * casas, vazio/null = desconhecida (FORMULATION-TEMPLATE-PURITY-RANGE-01).
   * O Modelo aceitava 0 e acima de 100, e a pureza que ele guardava era recusada
   * na Formulação que nascesse dele.
   */
  purityPercentApplied: optionalPurityPercent,
  overagePercent: percentualTecnicoDoTemplate.nullish(),
  /*
   * A MESMA configuração técnica do componente da Formulação real (§52): o que
   * a quantidade significa e quais ajustes ela autoriza. Sem isto o Modelo
   * guardava pureza e overage mas não a intenção — e aplicar o Modelo sempre
   * produzia física direta. Ausente = física direta sem ajuste, que é o que
   * todo Modelo anterior a estes campos significa.
   */
  quantityMode: z.enum(["PHYSICAL_DIRECT", "THEORETICAL_WITH_ADJUSTMENTS"]).optional(),
  applyPurityAdjustment: z.boolean().optional(),
  applyOverageAdjustment: z.boolean().optional(),
  notes: optionalNullableText(500),
});

export const createFormulationTemplateSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do template").max(200),
  description: optionalNullableText(1000),
  basisQuantity: decimalString.optional(),
  outputUnitCode: z.string().trim().min(1).max(20).optional(),
  calculationMode: z.enum(["FIXED_BASIS", "PER_DOSE"]).optional(),
  dosesPerPackage,
});

export const updateFormulationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalNullableText(1000),
});

export const updateFormulationTemplateVersionSchema = z.object({
  basisQuantity: decimalString.optional(),
  outputUnitCode: z.string().trim().min(1).max(20).optional(),
  calculationMode: z.enum(["FIXED_BASIS", "PER_DOSE"]).optional(),
  dosesPerPackage,
  notes: optionalNullableText(1000),
  components: z.array(componentSchema).optional(),
});

export const archiveFormulationTemplateSchema = z.object({
  archived: z.boolean(),
});

/** Aplicar template ao produto — sempre cópia, nunca vínculo. */
export const applyFormulationTemplateSchema = z.object({
  formulationTemplateVersionId: z.string().trim().min(1),
});

export const createTemplateFromFormulationSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do template").max(200),
  description: optionalNullableText(1000),
});

export const listFormulationTemplatesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  archived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === true || value === "true",
    ),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateFormulationTemplateInput = z.infer<typeof createFormulationTemplateSchema>;
export type UpdateFormulationTemplateInput = z.infer<typeof updateFormulationTemplateSchema>;
export type UpdateFormulationTemplateVersionInput = z.infer<
  typeof updateFormulationTemplateVersionSchema
>;
export type ApplyFormulationTemplateInput = z.infer<typeof applyFormulationTemplateSchema>;
export type CreateTemplateFromFormulationInput = z.infer<
  typeof createTemplateFromFormulationSchema
>;
export type ListFormulationTemplatesQuery = z.infer<typeof listFormulationTemplatesQuerySchema>;
