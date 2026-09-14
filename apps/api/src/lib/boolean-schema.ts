import { z } from "zod";

/**
 * Booleano de query string — INVENTORY-EXPORT-ONLY-WITH-STOCK-01.
 *
 * `z.coerce.boolean()` é `Boolean(valor)`: toda string não vazia vira `true`,
 * `"false"` inclusive. O `ExportCsvButton` manda o filtro desmarcado como
 * `onlyWithStock=false`, e o CSV do Estoque saía só com os itens com saldo.
 *
 * O contrato é o literal da URL: `"true"` e `"false"`, exatos. `"0"`, `"1"`,
 * `"yes"`, `"on"`, maiúsculas, espaço e vazio são recusados em vez de
 * adivinhados. Booleano de verdade vale para quem chama o schema no código.
 */
export function lerBooleanoDeConsulta(valor: unknown): boolean | null {
  if (typeof valor === "boolean") return valor;
  if (valor === "true") return true;
  if (valor === "false") return false;
  return null;
}

export function booleanoDeConsultaSchema(message = 'Use "true" ou "false"') {
  return z.union([z.boolean(), z.string()]).transform((valor, ctx) => {
    const booleano = lerBooleanoDeConsulta(valor);
    if (booleano === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return booleano;
  });
}
