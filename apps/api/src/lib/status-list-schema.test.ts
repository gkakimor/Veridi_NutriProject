import { describe, expect, it } from "vitest";
import { z } from "zod";
import { listaDeStatusSchema, statusDoWhere } from "./status-list-schema.js";

/**
 * O contrato de "vários status" das listagens (FILTER-OPERATIONS-WAVE-01,
 * levado a Pedidos e Ordens de Compra na -03). Um contrato só: se esta forma
 * mudar, muda para todas as listas de uma vez.
 */
const schema = listaDeStatusSchema(z.enum(["DRAFT", "ORDERED", "RECEIVED"]));

describe("listaDeStatusSchema", () => {
  it("um valor só continua valendo", () => {
    expect(schema.parse("ORDERED")).toEqual(["ORDERED"]);
  });

  it("vários, separados por vírgula, com espaço e vazio tolerados", () => {
    expect(schema.parse("DRAFT,ORDERED")).toEqual(["DRAFT", "ORDERED"]);
    expect(schema.parse(" DRAFT , ORDERED ,")).toEqual(["DRAFT", "ORDERED"]);
  });

  it("status que o domínio não tem é recusado — nunca vira filtro vazio", () => {
    expect(schema.safeParse("ORDERED,VOANDO").success).toBe(false);
  });

  it("lista vazia é recusada", () => {
    expect(schema.safeParse(",").success).toBe(false);
  });
});

describe("statusDoWhere", () => {
  it("um status é igualdade, vários são `in`, nenhum não filtra", () => {
    expect(statusDoWhere(["ORDERED"])).toBe("ORDERED");
    expect(statusDoWhere(["DRAFT", "ORDERED"])).toEqual({ in: ["DRAFT", "ORDERED"] });
    expect(statusDoWhere([])).toBeUndefined();
    expect(statusDoWhere(undefined)).toBeUndefined();
  });
});
