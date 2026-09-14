import { describe, expect, it } from "vitest";
import { LIMITES_INTEIROS_DAS_CONDICOES } from "@veridi/shared";
import { lerInteiroDecimal } from "./integer-schema.js";
import { optionalPositiveInt } from "./industrial-schema.js";
import {
  updateProjectSchema,
  updateQuoteVersionSchema,
} from "../modules/projects/projects.schemas.js";
import {
  createFormulationTemplateSchema,
  updateFormulationTemplateVersionSchema,
} from "../modules/formulation-templates/formulation-templates.schemas.js";

/**
 * API-INT-COERCION-01 — inteiro da API é representação decimal inteira.
 *
 * `Number()` gravava `"1e2"` como 100, `"0x1E"` como 30 e `"+1"`/`"1.0"` como
 * 1. O contrato agora é o mesmo nos três lugares que liam inteiro de escrita:
 * Projeto e condições do Orçamento (`projects.schemas.ts`), cadastros
 * industriais e Formulação (`lib/industrial-schema.ts`) e Modelo de Formulação
 * (que usava `z.coerce.number()`, o mesmo `Number()`). Faixa, opcional e nulo
 * continuam os de cada campo.
 */

/** Não é inteiro decimal canônico — nenhum destes pode virar número. */
const NAO_INTEIROS: unknown[] = [
  "1e2",
  "1E2",
  "0x10",
  "0x1E",
  "0b11",
  "12.5",
  "12,5",
  "1.0",
  "1.234",
  "+1",
  "1 000",
  "Infinity",
  "-Infinity",
  "NaN",
  "12abc",
  "abc",
  "9007199254740993",
  12.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  2 ** 53,
  true,
];

describe("lerInteiroDecimal", () => {
  it.each([
    ["123", 123],
    ["0", 0],
    ["-5", -5],
    [" 42 ", 42],
    ["007", 7],
    [123, 123],
    [0, 0],
    [-5, -5],
  ] as const)("%j é %i", (valor, inteiro) => {
    expect(lerInteiroDecimal(valor)).toBe(inteiro);
  });

  it.each(NAO_INTEIROS.map((valor) => [valor]))("%j não é inteiro", (valor) => {
    expect(lerInteiroDecimal(valor)).toBeNull();
  });

  it("nada que não seja texto ou número", () => {
    for (const valor of [null, undefined, {}, [], ""]) expect(lerInteiroDecimal(valor)).toBeNull();
  });
});

describe("Projeto e Orçamento — optionalPositiveInt de projects.schemas", () => {
  const doses = (valor: unknown) => updateProjectSchema.safeParse({ dosesPerPackage: valor });

  it("decimal inteiro grava, em texto ou número", () => {
    expect(doses("123")).toMatchObject({ success: true, data: { dosesPerPackage: 123 } });
    expect(doses(60)).toMatchObject({ success: true, data: { dosesPerPackage: 60 } });
  });

  it("opcional e nulo continuam como eram: ausente não mexe, null e vazio limpam", () => {
    expect(updateProjectSchema.parse({}).dosesPerPackage).toBeUndefined();
    expect(doses(null)).toMatchObject({ success: true, data: { dosesPerPackage: null } });
    expect(doses("")).toMatchObject({ success: true, data: { dosesPerPackage: null } });
  });

  it.each(["0", 0, "-1", -1])("mínimo: %j é recusado (maior que zero)", (valor) => {
    expect(doses(valor).success).toBe(false);
  });

  it.each([...NAO_INTEIROS, " "].map((valor) => [valor]))("%j é recusado", (valor) => {
    expect(doses(valor).success).toBe(false);
  });

  it("máximo das condições comerciais preservado, com leitura estrita", () => {
    const { installmentCount, installmentIntervalDays } = LIMITES_INTEIROS_DAS_CONDICOES;
    const condicoes = (payload: Record<string, unknown>) => updateQuoteVersionSchema.safeParse(payload);

    expect(condicoes({ installmentCount: String(installmentCount.maximo) })).toMatchObject({
      success: true,
      data: { installmentCount: installmentCount.maximo },
    });
    expect(condicoes({ installmentCount: installmentCount.maximo + 1 }).success).toBe(false);
    expect(condicoes({ installmentIntervalDays: installmentIntervalDays.maximo }).success).toBe(true);
    expect(condicoes({ installmentIntervalDays: String(installmentIntervalDays.maximo + 1) }).success).toBe(false);
    // Expoente não é caminho para dentro nem para fora da faixa.
    expect(condicoes({ installmentCount: "1e1" }).success).toBe(false);
    expect(condicoes({ leadTimeDays: "0x1E" }).success).toBe(false);
  });
});

describe("Cadastros industriais e Formulação — optionalPositiveInt de lib/industrial-schema", () => {
  const schema = optionalPositiveInt("Doses por embalagem deve ser maior que zero");

  it("decimal inteiro grava, em texto ou número", () => {
    expect(schema.parse("123")).toBe(123);
    expect(schema.parse(" 30 ")).toBe(30);
    expect(schema.parse(30)).toBe(30);
  });

  it("opcional e nulo continuam como eram: ausente não mexe, null e vazio limpam", () => {
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse("")).toBeNull();
    expect(schema.parse("  ")).toBeNull();
  });

  it.each(["0", 0, "-1", -1])("mínimo: %j é recusado com a mensagem do campo", (valor) => {
    const resultado = schema.safeParse(valor);
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.message).toBe("Doses por embalagem deve ser maior que zero");
  });

  it.each(NAO_INTEIROS.map((valor) => [valor]))("%j é recusado como não inteiro", (valor) => {
    const resultado = schema.safeParse(valor);
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.message).toBe("Informe um número inteiro");
  });
});

describe("Modelo de Formulação — dosesPerPackage", () => {
  const criar = (valor: unknown) =>
    createFormulationTemplateSchema.safeParse({ name: "Modelo", dosesPerPackage: valor });
  const editar = (valor: unknown) =>
    updateFormulationTemplateVersionSchema.safeParse({ dosesPerPackage: valor });

  it("decimal inteiro grava, em texto ou número", () => {
    expect(criar("30")).toMatchObject({ success: true, data: { dosesPerPackage: 30 } });
    expect(editar(60)).toMatchObject({ success: true, data: { dosesPerPackage: 60 } });
  });

  it("opcional e nulo continuam como eram: ausente e null passam, vazio segue recusado", () => {
    expect(criar(undefined)).toMatchObject({ success: true, data: { dosesPerPackage: undefined } });
    expect(editar(null)).toMatchObject({ success: true, data: { dosesPerPackage: null } });
    expect(criar("").success).toBe(false);
  });

  it.each(["0", 0, "-1", -1])("mínimo: %j é recusado", (valor) => {
    expect(criar(valor).success).toBe(false);
    expect(editar(valor).success).toBe(false);
  });

  it.each(NAO_INTEIROS.map((valor) => [valor]))("%j é recusado", (valor) => {
    expect(criar(valor).success).toBe(false);
    expect(editar(valor).success).toBe(false);
  });
});
