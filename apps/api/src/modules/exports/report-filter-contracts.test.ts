import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { REPORT_FILTER_CONTRACTS } from "@veridi/shared";
import { paginationFields } from "../reports/reports.schemas.js";
import { reportCsvExports } from "./report-exports.js";

/**
 * REPORTS-PRINT-FILTER-KEYS-DRIFT-01 — o contrato de filtros do PDF é o schema
 * da rota.
 *
 * O PDF de relatório escreve "Filtros aplicados" só com as chaves de
 * `REPORT_FILTER_CONTRACTS` (shared). Antes a lista era copiada à mão na web, e
 * nada a ligava ao schema: filtro novo na API sumia do papel sem aviso. Aqui
 * cada contrato é comparado com as chaves do schema da rota `csvPath` — a mesma
 * rota que o PDF lê. Chave acrescentada ou removida de um lado só reprova.
 */

/** Paginação não é filtro: nunca entra no contrato. */
const PAGINACAO = new Set(Object.keys(paginationFields));

/** Chaves de filtro de um `z.object`, com ou sem `superRefine` por fora. */
function chavesDeFiltro(schema: ZodTypeAny): string[] {
  let atual: ZodTypeAny = schema;
  while (atual instanceof z.ZodEffects) atual = atual.innerType();
  if (!(atual instanceof z.ZodObject)) throw new Error("schema de relatório sem z.object");
  return Object.keys(atual.shape as Record<string, unknown>).filter((chave) => !PAGINACAO.has(chave));
}

/** O que só existe de um lado — vazio nos dois é contrato em dia. */
function divergencia(schema: ZodTypeAny, filterKeys: readonly string[]) {
  const doSchema = chavesDeFiltro(schema);
  return {
    soNoSchema: doSchema.filter((chave) => !filterKeys.includes(chave)).sort(),
    soNoContrato: filterKeys.filter((chave) => !doSchema.includes(chave)).sort(),
  };
}

describe("contrato de filtros dos relatórios × schema da rota", () => {
  it("toda exportação de relatório tem contrato, e todo contrato aponta para uma exportação", () => {
    const rotas = reportCsvExports.map((rota) => rota.path).sort();
    const contratos = Object.values(REPORT_FILTER_CONTRACTS)
      .map((contrato) => contrato.csvPath)
      .sort();
    expect(contratos).toEqual(rotas);
  });

  it.each(Object.entries(REPORT_FILTER_CONTRACTS))(
    "%s: as chaves do contrato são exatamente as do schema da rota",
    (_codigo, contrato) => {
      const rota = reportCsvExports.find((candidata) => candidata.path === contrato.csvPath);
      expect(rota, contrato.csvPath).toBeDefined();
      expect(divergencia(rota!.schema, contrato.filterKeys)).toEqual({ soNoSchema: [], soNoContrato: [] });
      for (const chave of PAGINACAO) expect(contrato.filterKeys, chave).not.toContain(chave);
    },
  );

  it("a guarda pega filtro acrescentado na API e filtro removido da API", () => {
    const base = z.object({
      search: z.string().optional(),
      customerId: z.string().optional(),
      ...paginationFields,
    });
    const contrato = ["search", "customerId"];
    expect(divergencia(base, contrato)).toEqual({ soNoSchema: [], soNoContrato: [] });

    // Filtro novo na API, com `superRefine` por fora como os de período.
    const comStatus = base.extend({ status: z.string().optional() }).superRefine(() => {});
    expect(divergencia(comStatus, contrato)).toEqual({ soNoSchema: ["status"], soNoContrato: [] });

    // Filtro que saiu da API e ficou no contrato.
    const semCliente = base.omit({ customerId: true });
    expect(divergencia(semCliente, contrato)).toEqual({ soNoSchema: [], soNoContrato: ["customerId"] });
  });
});
