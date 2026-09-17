import { z } from "zod";
import {
  LOT_STATUSES,
  STOCK_COUNT_DECISIONS,
  STOCK_COUNT_EXPIRY_FILTERS,
  STOCK_COUNT_FINDING_KINDS,
  STOCK_COUNT_KINDS,
  STOCK_COUNT_MAX_POSITIONS,
  STOCK_COUNT_MODES,
  STOCK_COUNT_STATUSES,
} from "@veridi/shared";
import { diaCivilDeFiltroSchema, recusarPeriodoInvertido } from "../../lib/date-schema.js";
import { optionalQuantityDecimalSchema, quantityDecimalSchema } from "../../lib/decimal-schema.js";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";
import { listaDeStatusSchema } from "../../lib/status-list-schema.js";

/** Enum de uma lista canônica do shared — nunca uma cópia à mão. */
function enumDe<T extends string>(valores: readonly T[]) {
  return z.enum(valores as unknown as [T, ...T[]]);
}

const idSchema = z.string().trim().min(1);
const motivoSchema = z.string().trim().min(3, "Motivo é obrigatório (mínimo de 3 caracteres)").max(500);

/**
 * Teto das listas do escopo. Maior que o limite de posições de propósito: o
 * filtro pode selecionar mais do que cabe, e quem responde "divida o escopo" é
 * o serviço, com o número real — não um 400 genérico de tamanho de lista.
 */
const TETO_DE_LISTA = 20_000;

const semRepeticao = (ids: string[]) => new Set(ids).size === ids.length;

export const stockCountScopeSchema = z
  .object({
    itemTypes: z.array(z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_PRODUCT"])).max(3).optional(),
    balance: z.enum(["WITH_BALANCE", "ANY"]),
    owner: z.enum(["ALL", "VERIDI", "CUSTOMER"]).default("ALL"),
    customerId: idSchema.optional(),
    itemIds: z.array(idSchema).min(1).max(TETO_DE_LISTA).optional(),
    lotIds: z.array(idSchema).min(1).max(TETO_DE_LISTA).optional(),
    // Filtros de lote (Fatia 2B): local, situação e validade.
    locationContains: z.string().trim().min(1).max(100).optional(),
    lotStatuses: z.array(enumDe(LOT_STATUSES)).max(LOT_STATUSES.length).optional(),
    expiry: enumDe(STOCK_COUNT_EXPIRY_FILTERS).optional(),
    expiringWithinDays: z.number().int().min(1).max(3650).optional(),
  })
  .refine((scope) => !scope.customerId || scope.owner === "CUSTOMER", {
    message: "Cliente específico só com propriedade de cliente",
    path: ["customerId"],
  })
  .refine((scope) => (scope.expiry === "EXPIRING") === (scope.expiringWithinDays !== undefined), {
    message: "\"Vence em até\" pede o número de dias, e o número de dias só vale com ele",
    path: ["expiringWithinDays"],
  });

export const previewStockCountSchema = z.object({
  mode: enumDe(STOCK_COUNT_MODES),
  scope: stockCountScopeSchema,
  excludedPositionKeys: z.array(z.string().min(1)).max(TETO_DE_LISTA).optional(),
});

export const startStockCountSchema = previewStockCountSchema.extend({
  description: z.string().trim().max(200).optional(),
  expectedPositionKeys: z.array(z.string().min(1)).max(STOCK_COUNT_MAX_POSITIONS).optional(),
});

/*
 * Lista dos inventários (Fatia 2A, só acréscimos): `status` aceita vários
 * separados por vírgula — "Em aberto" é `IN_PROGRESS,IN_REVIEW` —, com o
 * contrato das outras listas (`listaDeStatusSchema`); `search` procura no
 * código `INV-` e na descrição; `mode` separa cega de com saldo; o período é o
 * dia de início, em dia civil, e invertido é recusa.
 */
export const listStockCountsQuerySchema = z
  .object({
    status: listaDeStatusSchema(enumDe(STOCK_COUNT_STATUSES)).optional(),
    kind: enumDe(STOCK_COUNT_KINDS).optional(),
    mode: enumDe(STOCK_COUNT_MODES).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    dateFrom: diaCivilDeFiltroSchema,
    dateTo: diaCivilDeFiltroSchema,
    page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
    pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
  })
  .superRefine(recusarPeriodoInvertido("dateFrom", "dateTo"));

export const stockCountDetailQuerySchema = z.object({
  view: z.enum(["review", "counting"]).default("review"),
});

export const registerStockCountEntrySchema = z.object({
  round: z.number().int().min(1),
  expectedLastEntryId: idSchema.nullable(),
  countedQuantity: quantityDecimalSchema({ allowZero: true }),
  clientRequestId: z.string().uuid("Identificador do envio inválido"),
  note: z.string().trim().max(500).optional(),
});

export const addStockCountPositionSchema = z.object({
  itemId: idSchema,
  lotId: idSchema.optional(),
  reason: motivoSchema,
});

export const removeStockCountPositionSchema = z.object({
  reason: motivoSchema,
});

export const requestStockCountRecountSchema = z.object({
  positionIds: z
    .array(idSchema)
    .min(1)
    .max(STOCK_COUNT_MAX_POSITIONS)
    .refine(semRepeticao, { message: "Posição repetida na lista" }),
});

export const decideStockCountSchema = z.object({
  decisions: z
    .array(
      z.object({
        positionId: idSchema,
        decision: enumDe(STOCK_COUNT_DECISIONS),
        reason: motivoSchema,
        confirmConcurrentMovement: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(STOCK_COUNT_MAX_POSITIONS)
    .refine((decisoes) => semRepeticao(decisoes.map((d) => d.positionId)), {
      message: "Posição repetida na lista",
    }),
});

export const cancelStockCountSchema = z.object({
  reason: motivoSchema,
});

/*
 * Encerramento (Fatia 2B). `expectedAdjustments` é o conjunto de ajustes que o
 * diálogo mostrou; ausente, o encerramento segue o contrato da Fatia 1.
 */
export const completeStockCountSchema = z.object({
  expectedAdjustments: z
    .array(z.object({ positionId: idSchema, entryId: idSchema }))
    .max(STOCK_COUNT_MAX_POSITIONS)
    .refine((ajustes) => semRepeticao(ajustes.map((ajuste) => ajuste.positionId)), {
      message: "Posição repetida na lista",
    })
    .optional(),
});

export const createStockCountFindingSchema = z
  .object({
    kind: enumDe(STOCK_COUNT_FINDING_KINDS),
    itemId: idSchema.optional(),
    identification: z.string().trim().min(1, "Identificação é obrigatória").max(200),
    quantity: optionalQuantityDecimalSchema(),
    unitCode: idSchema.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((finding) => finding.kind !== "UNREGISTERED_LOT" || Boolean(finding.itemId), {
    message: "Lote sem cadastro exige o item do ERP",
    path: ["itemId"],
  })
  .refine((finding) => finding.kind !== "UNREGISTERED_ITEM" || !finding.itemId, {
    message: "Item sem cadastro não aponta item do ERP",
    path: ["itemId"],
  });

export type StockCountScopeQuery = z.infer<typeof stockCountScopeSchema>;
export type PreviewStockCountQuery = z.infer<typeof previewStockCountSchema>;
export type StartStockCountQuery = z.infer<typeof startStockCountSchema>;
export type ListStockCountsQuery = z.infer<typeof listStockCountsQuerySchema>;
export type RegisterStockCountEntryBody = z.infer<typeof registerStockCountEntrySchema>;
export type AddStockCountPositionBody = z.infer<typeof addStockCountPositionSchema>;
export type DecideStockCountBody = z.infer<typeof decideStockCountSchema>;
export type CompleteStockCountBody = z.infer<typeof completeStockCountSchema>;
export type CreateStockCountFindingBody = z.infer<typeof createStockCountFindingSchema>;
