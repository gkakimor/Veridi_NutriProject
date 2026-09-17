import { z } from "zod";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import {
  CASAS_PERCENTUAL_TECNICO,
  casasDecimais,
  mensagemCasasPercentualTecnico,
  quantityDecimalSchema,
} from "../../lib/decimal-schema.js";
import {
  optionalEnum,
  optionalPositiveDecimal,
  optionalPositiveInt,
  optionalPurityPercent,
} from "../../lib/industrial-schema.js";

/**
 * Overage: 0 é legítimo (declarar "sem perda"); negativo nunca é.
 *
 * Sem teto superior, de propósito — o domínio nunca definiu um, e o
 * `DECIMAL(9,6)` do PREC-MIG-C não é lugar de inventar regra de negócio. O
 * limite de casas é outra coisa: acima de seis o PostgreSQL arredondaria sem
 * avisar, e um overage de `0,000001%` viraria zero.
 */
const optionalOveragePercent = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  })
  .refine((value) => value === undefined || value === null || /^\d+(\.\d+)?$/.test(value), {
    message: "Overage inválido",
  })
  .refine(
    (value) =>
      value === undefined || value === null || casasDecimais(value) <= CASAS_PERCENTUAL_TECNICO,
    { message: mensagemCasasPercentualTecnico() },
  );

/**
 * Perda prevista de produção (%): premissa GLOBAL da versão.
 *
 * `0` é legítimo — declarar "sem perda" é uma decisão. O teto é EXCLUSIVO em
 * 100: com 100% de perda nada sai da produção e a quantidade bruta não existe
 * (divisão por zero), então recusar é a única resposta honesta. Casas
 * limitadas pelo mesmo motivo da pureza: acima de seis o PostgreSQL
 * arredondaria em silêncio.
 */
const optionalExpectedLossPercent = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  })
  .refine((value) => value === undefined || value === null || /^\d+(\.\d+)?$/.test(value), {
    message: "Perda prevista de produção inválida",
  })
  .refine((value) => value === undefined || value === null || Number(value) < 100, {
    message: "Perda prevista de produção deve ser menor que 100%",
  })
  .refine(
    (value) =>
      value === undefined || value === null || casasDecimais(value) <= CASAS_PERCENTUAL_TECNICO,
    { message: mensagemCasasPercentualTecnico() },
  );

const optionalLegacyDecimal = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  });

const formulationComponentInputSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  quantity: quantityDecimalSchema(),
  unitCode: z.string().trim().min(1, "Unidade é obrigatória"),
  /*
   * SEM `basis` (FORMULATION-COMPONENT-BASIS-AUTOMATION-01): a base é derivada
   * pelo serviço da seção do Item e do modo da receita. Um `basis` no corpo é
   * descartado aqui (o objeto não é estrito) — cliente antigo continua sendo
   * aceito, e nenhum consegue gravar embalagem por dose.
   */
  supplyResponsibility: z.enum(["VERIDI", "CUSTOMER"]).optional(),
  // Pureza: mesma regra do cadastro — 0 < x <= 100, null = desconhecida.
  purityPercentApplied: optionalPurityPercent,
  overagePercent: optionalOveragePercent,
  /*
   * O que a quantidade SIGNIFICA, e quais ajustes ela autoriza.
   *
   * Preencher a pureza deixou de aplicar a correção sozinho. Antes bastava o
   * campo ter valor, e o dado real tem componentes cuja quantidade já vem
   * corrigida de fora — neles, preencher a pureza aplicava a correção uma
   * segunda vez, em silêncio. Autorizar virou ato separado de registrar.
   *
   * Ausente = `PHYSICAL_DIRECT`, o default do domínio.
   */
  quantityMode: z.enum(["PHYSICAL_DIRECT", "THEORETICAL_WITH_ADJUSTMENTS"]).optional(),
  applyPurityAdjustment: z.boolean().optional(),
  applyOverageAdjustment: z.boolean().optional(),
  legacyTotalQuantity: optionalLegacyDecimal,
  legacyTotalUnitCode: z.string().trim().max(20).nullish(),
  legacyBatchUnits: optionalLegacyDecimal,
  notes: z.string().trim().max(500).optional(),
});

export const listFormulationsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
  pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
});

export const createFormulationVersionSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});

export const updateFormulationVersionSchema = z.object({
  basisQuantity: quantityDecimalSchema().optional(),
  calculationMode: z.enum(["FIXED_BASIS", "PER_DOSE"]).optional(),
  dosesPerPackage: optionalPositiveInt("Doses por embalagem deve ser maior que zero"),
  /*
   * PREMISSAS DA APRESENTAÇÃO — os mesmos validadores do cadastro do Produto:
   * enum (ou "" para limpar), inteiro positivo, decimal positivo.
   *
   * Nas formas cápsula e pó o serviço DERIVA `dosesPerPackage` destas premissas
   * (cápsulas por embalagem ÷ cápsulas por dose; conteúdo ÷ dose), e o número
   * que o cliente mandar não substitui a divisão: duas fontes para a mesma
   * premissa divergem no primeiro campo que alguém esquecer de atualizar.
   *
   * `capsulesPerPackage` é ENTRADA, não coluna — volta no DTO como produto de
   * cápsulas por dose e doses por embalagem.
   */
  dosageForm: optionalEnum(["CAPSULE", "POWDER", "TABLET", "LIQUID", "OTHER"]),
  presentationType: optionalEnum(["POT", "POUCH", "CARTON", "BULK", "BOTTLE", "OTHER"]),
  capsulesPerDose: optionalPositiveInt("Cápsulas por dose deve ser maior que zero"),
  capsulesPerPackage: optionalPositiveInt("Cápsulas por embalagem deve ser maior que zero"),
  doseAmount: optionalPositiveDecimal("Dose deve ser maior que zero"),
  doseUomCode: optionalNullableText(20),
  packageContentAmount: optionalPositiveDecimal("Conteúdo da embalagem deve ser maior que zero"),
  packageContentUomCode: optionalNullableText(20),
  /*
   * PERDA PREVISTA DE PRODUÇÃO — premissa da VERSÃO, não da linha.
   *
   * Distinta da reserva de matéria-prima (`overagePercent`), que continua por
   * componente: a reserva é de UM insumo, a perda é do processo inteiro.
   */
  expectedLossPercent: optionalExpectedLossPercent,
  notes: optionalNullableText(2000),
  components: z.array(formulationComponentInputSchema).optional(),
});

export type FormulationComponentInput = z.infer<typeof formulationComponentInputSchema>;
export type ListFormulationsQuery = z.infer<typeof listFormulationsQuerySchema>;
export type CreateFormulationVersionInput = z.infer<typeof createFormulationVersionSchema>;
export type UpdateFormulationVersionInput = z.infer<typeof updateFormulationVersionSchema>;
