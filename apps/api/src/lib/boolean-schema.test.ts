import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { booleanoDeConsultaSchema, lerBooleanoDeConsulta } from "./boolean-schema.js";
import {
  listCustomerMaterialsQuerySchema,
  listInventoryQuerySchema,
} from "../modules/inventory/inventory.schemas.js";
import * as relatorios from "../modules/reports/reports.schemas.js";

/**
 * INVENTORY-EXPORT-ONLY-WITH-STOCK-01 — booleano de query é `"true"` ou
 * `"false"`. `z.coerce.boolean()` lia `"false"` como `true`, e o CSV do
 * Estoque exportado com "Somente com estoque" DESMARCADO saía filtrado.
 */

/** Nada disto é booleano de URL: recusar é melhor que adivinhar. */
const NAO_BOOLEANOS: unknown[] = [
  "0",
  "1",
  "yes",
  "no",
  "on",
  "off",
  "abc",
  "",
  " ",
  "TRUE",
  "False",
  " true",
  "false ",
  0,
  1,
  null,
  ["true"],
  {},
];

describe("lerBooleanoDeConsulta", () => {
  it.each([
    ["true", true],
    ["false", false],
    [true, true],
    [false, false],
  ] as const)("%j é %j", (valor, booleano) => {
    expect(lerBooleanoDeConsulta(valor)).toBe(booleano);
  });

  it.each(NAO_BOOLEANOS.map((valor) => [valor]))("%j não é booleano", (valor) => {
    expect(lerBooleanoDeConsulta(valor)).toBeNull();
  });
});

describe("booleanoDeConsultaSchema", () => {
  const schema = booleanoDeConsultaSchema();

  it("a string da URL e o booleano de código", () => {
    expect(schema.parse("true")).toBe(true);
    expect(schema.parse("false")).toBe(false);
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
  });

  it.each(NAO_BOOLEANOS.filter((valor) => valor !== undefined).map((valor) => [valor]))(
    "%j é recusado",
    (valor) => {
      expect(schema.safeParse(valor).success).toBe(false);
    },
  );
});

describe("Estoque — onlyWithStock de listInventoryQuerySchema", () => {
  const filtro = (valor: unknown) => listInventoryQuerySchema.safeParse({ onlyWithStock: valor });

  it('"false" é false — o defeito', () => {
    expect(filtro("false")).toMatchObject({ success: true, data: { onlyWithStock: false } });
  });

  it('"true" é true, ausente continua ausente', () => {
    expect(filtro("true")).toMatchObject({ success: true, data: { onlyWithStock: true } });
    expect(listInventoryQuerySchema.parse({}).onlyWithStock).toBeUndefined();
  });

  it("booleano real, de quem chama o schema no código, continua valendo", () => {
    expect(filtro(true)).toMatchObject({ success: true, data: { onlyWithStock: true } });
    expect(filtro(false)).toMatchObject({ success: true, data: { onlyWithStock: false } });
  });

  it.each(NAO_BOOLEANOS.map((valor) => [valor]))("%j é recusado", (valor) => {
    const resultado = filtro(valor);
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(["onlyWithStock"]);
  });
});

/**
 * REPORTS-QUERY-BOOLEAN-PERMISSIVE-01 — `booleanFlag` e `all` de
 * `reports.schemas.ts` liam todo texto fora de `false`/`0`/`no`/vazio como
 * `true`: `?all=abc` pedia o relatório inteiro. Agora são o mesmo contrato,
 * com o padrão de cada relatório quando ausentes.
 */

/** Campos de um `z.object`, com ou sem `superRefine` por fora. */
function camposDe(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  let atual = schema;
  while (atual instanceof z.ZodEffects) atual = atual.innerType();
  return atual instanceof z.ZodObject ? (atual.shape as Record<string, ZodTypeAny>) : {};
}

type Flag = { nome: string; schema: ZodTypeAny; campo: string; padrao: boolean };

/** Todo schema de relatório com `all` — o relatório novo entra sozinho. */
const ALL_DOS_RELATORIOS: Flag[] = Object.entries(relatorios as Record<string, unknown>)
  .filter((entrada): entrada is [string, ZodTypeAny] => entrada[1] instanceof z.ZodType)
  .filter(([, schema]) => "all" in camposDe(schema))
  .map(([nome, schema]) => ({ nome: `${nome}.all`, schema, campo: "all", padrao: false }));

const FLAGS_DOS_RELATORIOS: Flag[] = [
  {
    nome: "inventoryPositionQuerySchema.onlyWithBalance",
    schema: relatorios.inventoryPositionQuerySchema,
    campo: "onlyWithBalance",
    padrao: true,
  },
  {
    nome: "expiryQuerySchema.onlyWithBalance",
    schema: relatorios.expiryQuerySchema,
    campo: "onlyWithBalance",
    padrao: true,
  },
  {
    nome: "requirementsQuerySchema.onlyShortage",
    schema: relatorios.requirementsQuerySchema,
    campo: "onlyShortage",
    padrao: false,
  },
  {
    nome: "plannedActualQuerySchema.includeCost",
    schema: relatorios.plannedActualQuerySchema,
    campo: "includeCost",
    padrao: false,
  },
  ...ALL_DOS_RELATORIOS,
];

it("a matriz dos relatórios leva o `all` de todo relatório paginado", () => {
  expect(ALL_DOS_RELATORIOS.map(({ nome }) => nome)).toEqual(
    expect.arrayContaining(
      [
        "inventoryPositionQuerySchema",
        "expiryQuerySchema",
        "movementsQuerySchema",
        "requirementsQuerySchema",
        "plannedActualQuerySchema",
        "consumptionQuerySchema",
        "purchaseOrdersQuerySchema",
        "receiptsQuerySchema",
        "onOrderQuerySchema",
        "customerOrdersQuerySchema",
        "fulfillmentQuerySchema",
        "billingPeriodQuerySchema",
        "awaitingBillingQuerySchema",
        "industrialCostByProductQuerySchema",
        "pricingByProductQuerySchema",
        "quotePricingAuditQuerySchema",
      ].map((nome) => `${nome}.all`),
    ),
  );
});

describe.each(FLAGS_DOS_RELATORIOS)("Relatórios — $nome", ({ schema, campo, padrao }) => {
  const ler = (valor: unknown) => schema.safeParse({ [campo]: valor });

  it("ausente é o padrão do relatório", () => {
    expect(schema.safeParse({})).toMatchObject({ success: true, data: { [campo]: padrao } });
  });

  it('"true" é true e "false" é false', () => {
    expect(ler("true")).toMatchObject({ success: true, data: { [campo]: true } });
    expect(ler("false")).toMatchObject({ success: true, data: { [campo]: false } });
  });

  it("booleano real, de quem chama o schema no código, continua valendo", () => {
    expect(ler(true)).toMatchObject({ success: true, data: { [campo]: true } });
    expect(ler(false)).toMatchObject({ success: true, data: { [campo]: false } });
  });

  it.each(NAO_BOOLEANOS.map((valor) => [valor]))("%j é recusado", (valor) => {
    const resultado = ler(valor);
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual([campo]);
  });
});

/**
 * CUSTOMER-MATERIALS-ONLY-WITH-BALANCE-PERMISSIVE-01 — o schema lia todo texto
 * fora de `"true"` como `false`, calado: `?onlyWithBalance=1` listava o lote
 * zerado.
 */
describe("Materiais de clientes — onlyWithBalance de listCustomerMaterialsQuerySchema", () => {
  const filtro = (valor: unknown) => listCustomerMaterialsQuerySchema.safeParse({ onlyWithBalance: valor });

  it('"1" é recusado — o defeito: era false calado', () => {
    expect(filtro("1").success).toBe(false);
  });

  it("ausente continua false: todos os lotes, com e sem saldo", () => {
    expect(listCustomerMaterialsQuerySchema.parse({}).onlyWithBalance).toBe(false);
  });

  it('"true" é true e "false" é false', () => {
    expect(filtro("true")).toMatchObject({ success: true, data: { onlyWithBalance: true } });
    expect(filtro("false")).toMatchObject({ success: true, data: { onlyWithBalance: false } });
  });

  it("booleano real, de quem chama o schema no código, continua valendo", () => {
    expect(filtro(true)).toMatchObject({ success: true, data: { onlyWithBalance: true } });
    expect(filtro(false)).toMatchObject({ success: true, data: { onlyWithBalance: false } });
  });

  it.each(NAO_BOOLEANOS.map((valor) => [valor]))("%j é recusado", (valor) => {
    const resultado = filtro(valor);
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(["onlyWithBalance"]);
  });
});
