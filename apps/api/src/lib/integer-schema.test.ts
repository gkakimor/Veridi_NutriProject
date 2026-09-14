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
import {
  createIndustrialResourceSchema,
  updateIndustrialResourceSchema,
} from "../modules/industrial-resources/industrial-resources.schemas.js";
import {
  createProductionCalendarExceptionSchema,
  updateProductionCalendarExceptionSchema,
  updateProductionCalendarWeekdaySchema,
} from "../modules/production-calendar/production-calendar.schemas.js";
import {
  createProductionOrderSchema,
  updateProductionOrderSchema,
} from "../modules/production-orders/production-orders.schemas.js";

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

/**
 * API-INT-COERCION-REMAINING-01 — os três inteiros de escrita que ficaram em
 * `z.coerce.number().int()`. Faixa, nulo e mensagens são os de antes; só a
 * leitura mudou.
 */
const RECUSADOS_DA_ONDA: unknown[] = [...NAO_INTEIROS, "1e1", "0b10", "10abc", false];

type Resultado = { success: boolean; data?: unknown; error?: { issues: { path: (string | number)[]; message: string }[] } };

function mensagemDe(resultado: Resultado, campo: string): string | undefined {
  return resultado.error?.issues.find((issue) => issue.path[0] === campo)?.message;
}

/**
 * Recusa com a mensagem do campo. Booleano e `NaN` param antes, na união
 * texto|número de `inteiroDecimalSchema`, com a mensagem genérica do zod —
 * recusados do mesmo jeito (antes, `true` gravava 1).
 */
function esperarRecusa(resultado: Resultado, campo: string, mensagem: string, valor: unknown) {
  expect(resultado.success).toBe(false);
  if (typeof valor === "string" || (typeof valor === "number" && !Number.isNaN(valor))) {
    expect(mensagemDe(resultado, campo)).toBe(mensagem);
  } else {
    expect(mensagemDe(resultado, campo)).toBeDefined();
  }
}

describe("Recurso industrial — capacityQuantity", () => {
  const criar = (valor: unknown) =>
    createIndustrialResourceSchema.safeParse({ name: "Misturador", type: "EQUIPMENT", capacityQuantity: valor });
  const editar = (valor: unknown) => updateIndustrialResourceSchema.safeParse({ capacityQuantity: valor });

  it.each([
    ["10", 10],
    ["007", 7],
    [" 3 ", 3],
    [10, 10],
    ["100000", 100000],
  ] as const)("%j grava %i", (valor, inteiro) => {
    expect(criar(valor)).toMatchObject({ success: true, data: { capacityQuantity: inteiro } });
    expect(editar(valor)).toMatchObject({ success: true, data: { capacityQuantity: inteiro } });
  });

  it("ausente não mexe e null volta a não cadastrada", () => {
    expect(criar(undefined)).toMatchObject({ success: true, data: { capacityQuantity: undefined } });
    expect(editar(null)).toMatchObject({ success: true, data: { capacityQuantity: null } });
  });

  it.each(["0", 0, "-1", -1])("mínimo: %j é recusado com a mensagem de antes", (valor) => {
    expect(mensagemDe(criar(valor), "capacityQuantity")).toBe("A capacidade começa em 1");
  });

  it("máximo: acima de 100000 é recusado com a mensagem de antes", () => {
    expect(mensagemDe(editar("100001"), "capacityQuantity")).toBe("Capacidade acima do razoável para um recurso");
  });

  it.each(RECUSADOS_DA_ONDA.map((valor) => [valor]))("%j é recusado como não inteiro", (valor) => {
    esperarRecusa(criar(valor), "capacityQuantity", "Informe um número inteiro", valor);
    esperarRecusa(editar(valor), "capacityQuantity", "Informe um número inteiro", valor);
  });
});

describe("Calendário de Produção — minuto do dia", () => {
  const dia = (valor: unknown) =>
    updateProductionCalendarWeekdaySchema.safeParse({ enabled: true, startMinuteOfDay: valor, endMinuteOfDay: 1020 });
  const excecao = (valor: unknown) =>
    createProductionCalendarExceptionSchema.safeParse({
      date: "2031-10-05",
      type: "OUTRO",
      operation: "HORARIO_ESPECIAL",
      startMinuteOfDay: 480,
      endMinuteOfDay: valor,
    });
  const editarExcecao = (valor: unknown) =>
    updateProductionCalendarExceptionSchema.safeParse({ operation: "HORARIO_ESPECIAL", breakEndMinuteOfDay: valor });

  it.each([
    ["480", 480],
    ["007", 7],
    [" 60 ", 60],
    [0, 0],
    ["1440", 1440],
  ] as const)("%j é o minuto %i", (valor, minuto) => {
    expect(dia(valor)).toMatchObject({ success: true, data: { startMinuteOfDay: minuto } });
    expect(excecao(valor)).toMatchObject({ success: true, data: { endMinuteOfDay: minuto } });
    expect(editarExcecao(valor)).toMatchObject({ success: true, data: { breakEndMinuteOfDay: minuto } });
  });

  it("em branco, null e ausente continuam 'não informado'", () => {
    for (const valor of ["", "  ", null, undefined]) {
      expect(dia(valor)).toMatchObject({ success: true, data: { startMinuteOfDay: null } });
    }
    expect(editarExcecao("")).toMatchObject({ success: true, data: { breakEndMinuteOfDay: null } });
    // Na edição, ausente é "campo não enviado", não nulo.
    const semCampo = updateProductionCalendarExceptionSchema.parse({ operation: "SEM_OPERACAO" });
    expect(semCampo.breakEndMinuteOfDay).toBeUndefined();
  });

  it("faixa de antes, com as mensagens de antes", () => {
    expect(mensagemDe(dia("-1"), "startMinuteOfDay")).toBe("O horário começa em 00:00");
    expect(mensagemDe(dia(1441), "startMinuteOfDay")).toBe("O horário termina em 24:00");
    expect(mensagemDe(excecao("1441"), "endMinuteOfDay")).toBe("O horário termina em 24:00");
  });

  it.each(RECUSADOS_DA_ONDA.map((valor) => [valor]))("%j é recusado como não inteiro", (valor) => {
    esperarRecusa(dia(valor), "startMinuteOfDay", "Informe minutos inteiros", valor);
    esperarRecusa(excecao(valor), "endMinuteOfDay", "Informe minutos inteiros", valor);
    esperarRecusa(editarExcecao(valor), "breakEndMinuteOfDay", "Informe minutos inteiros", valor);
  });
});

describe("Ordem de Produção — numberOfParts", () => {
  const criar = (valor: unknown) => createProductionOrderSchema.safeParse({ productId: "p", numberOfParts: valor });
  const editar = (valor: unknown) => updateProductionOrderSchema.safeParse({ numberOfParts: valor });

  it.each([
    ["10", 10],
    ["007", 7],
    [3, 3],
    ["99", 99],
    [1, 1],
  ] as const)("%j são %i partes", (valor, partes) => {
    expect(criar(valor)).toMatchObject({ success: true, data: { numberOfParts: partes } });
    expect(editar(valor)).toMatchObject({ success: true, data: { numberOfParts: partes } });
  });

  it("ausente continua ausente — o padrão é do serviço", () => {
    expect(criar(undefined)).toMatchObject({ success: true, data: { numberOfParts: undefined } });
  });

  it.each(["0", 0, "-1", -1])("mínimo: %j é recusado com a mensagem de antes", (valor) => {
    expect(mensagemDe(criar(valor), "numberOfParts")).toBe("A produção tem ao menos 1 parte");
    expect(mensagemDe(editar(valor), "numberOfParts")).toBe("A produção tem ao menos 1 parte");
  });

  it("máximo: 100 é recusado com a mensagem de antes", () => {
    expect(mensagemDe(criar(100), "numberOfParts")).toBe("Máximo de 99 partes");
    expect(mensagemDe(editar("100"), "numberOfParts")).toBe("Máximo de 99 partes");
  });

  it("vazio e null seguem recusados — zero partes não existe", () => {
    for (const valor of ["", null]) {
      expect(criar(valor).success).toBe(false);
      expect(editar(valor).success).toBe(false);
    }
  });

  it.each(RECUSADOS_DA_ONDA.map((valor) => [valor]))("%j é recusado como não inteiro", (valor) => {
    esperarRecusa(criar(valor), "numberOfParts", "Informe um número inteiro de partes", valor);
    esperarRecusa(editar(valor), "numberOfParts", "Informe um número inteiro de partes", valor);
  });
});
