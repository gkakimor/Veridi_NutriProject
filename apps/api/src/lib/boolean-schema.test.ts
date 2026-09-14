import { describe, expect, it } from "vitest";
import { booleanoDeConsultaSchema, lerBooleanoDeConsulta } from "./boolean-schema.js";
import { listInventoryQuerySchema } from "../modules/inventory/inventory.schemas.js";

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
