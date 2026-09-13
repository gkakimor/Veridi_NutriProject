import { z } from "zod";
import { BULK_PDF_SELECTION_LIMIT } from "@veridi/shared";

/**
 * SELEÇÃO EM MASSA na fronteira da API — BULK-DOCUMENTS-01.
 *
 * A tela entrega um DESCRITOR, nunca a lista carregada: ou os ids escolhidos
 * um a um, ou o filtro da listagem com as exceções desmarcadas. Quem resolve o
 * conjunto é o servidor, no momento da ação, com a MESMA regra de filtro da
 * listagem — "todos os filtrados" é o filtro de agora, não uma fotografia dos
 * ids de quando a pessoa clicou.
 *
 * Aqui mora só a casca comum. Os filtros são de cada domínio, com o schema da
 * própria listagem (`filtrosDaListagem`).
 */

export { BULK_PDF_SELECTION_LIMIT };

export type BulkSelectionInput<F> =
  | { mode: "ids"; ids: string[] }
  | { mode: "filtered"; filters: F; excludedIds: string[] };

/** Id repetido vale uma vez: o conjunto é o mesmo, clicado duas vezes ou não. */
const listaDeIds = z.array(z.string().trim().min(1)).transform((ids) => [...new Set(ids)]);

export function bulkSelectionSchema<F extends z.ZodTypeAny>(filters: F) {
  return z.discriminatedUnion("mode", [
    z
      .object({
        mode: z.literal("ids"),
        ids: listaDeIds.refine((ids) => ids.length > 0, "Selecione ao menos um registro."),
      })
      .strict(),
    z
      .object({
        mode: z.literal("filtered"),
        filters,
        excludedIds: listaDeIds.default([]),
      })
      .strict(),
  ]);
}

/**
 * Os filtros chegam como a tela os guarda — lista de status é array, "sem
 * roteiro" é booleano — e passam pela MESMA validação da listagem, que lê
 * texto de URL. A conversão é a do botão de CSV: lista vira vírgula.
 *
 * Campo desconhecido é recusado: um filtro que o servidor ignorasse alargaria
 * a seleção para além do que a pessoa vê na tela.
 */
export function filtrosDaListagem<T extends z.AnyZodObject>(filtrosDaConsulta: T) {
  return z.preprocess(comoNaConsulta, filtrosDaConsulta.strict());
}

function comoNaConsulta(valor: unknown): unknown {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return valor;
  return Object.fromEntries(
    Object.entries(valor).map(([chave, campo]) => [
      chave,
      Array.isArray(campo)
        ? campo.join(",")
        : typeof campo === "boolean" || typeof campo === "number"
          ? String(campo)
          : campo,
    ]),
  );
}

// ---------------------------------------------------------------- recusas

/** Id escolhido que não existe mais: recusa, nunca documento a menos. */
export class SelectionNotFoundError extends Error {
  constructor(readonly missingIds: string[]) {
    super(
      missingIds.length === 1
        ? "1 registro da seleção não existe mais. Recarregue a lista e selecione de novo."
        : `${missingIds.length} registros da seleção não existem mais. Recarregue a lista e selecione de novo.`,
    );
    this.name = "SelectionNotFoundError";
  }
}

/** Acima do limite: recusa, nunca os primeiros N. */
export class SelectionTooLargeError extends Error {
  constructor(
    readonly total: number,
    readonly limit: number,
  ) {
    super(`A seleção contém mais de ${limit} documentos. Refine os filtros e tente novamente.`);
    this.name = "SelectionTooLargeError";
  }
}

/** O filtro não alcança mais nada — os registros mudaram depois da seleção. */
export class SelectionEmptyError extends Error {
  constructor() {
    super("Nenhum registro corresponde mais à seleção. Recarregue a lista e selecione de novo.");
    this.name = "SelectionEmptyError";
  }
}

export function selectionErrorResponse(
  error: unknown,
): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof SelectionNotFoundError) {
    return {
      status: 404,
      body: {
        error: "selection_not_found",
        message: error.message,
        total: error.missingIds.length,
        sample: error.missingIds.slice(0, 5),
      },
    };
  }
  if (error instanceof SelectionTooLargeError) {
    return {
      status: 400,
      body: { error: "selection_too_large", message: error.message, total: error.total, limit: error.limit },
    };
  }
  if (error instanceof SelectionEmptyError) {
    return { status: 404, body: { error: "selection_empty", message: error.message } };
  }
  return null;
}

// ---------------------------------------------------------------- resolução

type Onde = Record<string, unknown>;

/** O conjunto em `where`: os ids escolhidos, ou o filtro da listagem sem as exceções. */
export function ondeDaSelecao<F>(selecao: BulkSelectionInput<F>, ondeDoFiltro: (filtros: F) => Onde): Onde {
  if (selecao.mode === "ids") return { id: { in: selecao.ids } };
  const filtro = ondeDoFiltro(selecao.filters);
  return selecao.excludedIds.length === 0 ? filtro : { AND: [filtro, { id: { notIn: selecao.excludedIds } }] };
}

export interface FonteDaSelecao<L> {
  contar: (onde: Onde) => Promise<number>;
  /** Na ordem canônica da listagem; `take` só quando há limite a conferir. */
  buscar: (onde: Onde, take?: number) => Promise<L[]>;
}

/**
 * Resolve a seleção no banco e confere antes de devolver:
 *
 * - id escolhido que não existe é recusado com a amostra — nunca some calado;
 * - acima de `limite` é recusado — nunca os primeiros N (o CSV não passa limite);
 * - conjunto vazio é recusado.
 */
export async function resolverSelecao<F, L extends { id: string }>(
  selecao: BulkSelectionInput<F>,
  ondeDoFiltro: (filtros: F) => Onde,
  fonte: FonteDaSelecao<L>,
  limite?: number,
): Promise<L[]> {
  const onde = ondeDaSelecao(selecao, ondeDoFiltro);

  if (selecao.mode === "ids") {
    if (limite !== undefined && selecao.ids.length > limite) {
      throw new SelectionTooLargeError(selecao.ids.length, limite);
    }
    const linhas = await fonte.buscar(onde);
    const achados = new Set(linhas.map((linha) => linha.id));
    const faltando = selecao.ids.filter((id) => !achados.has(id));
    if (faltando.length > 0) throw new SelectionNotFoundError(faltando);
    return linhas;
  }

  if (limite !== undefined) {
    const total = await fonte.contar(onde);
    if (total > limite) throw new SelectionTooLargeError(total, limite);
  }
  const linhas = await fonte.buscar(onde, limite === undefined ? undefined : limite + 1);
  // Entre contar e buscar o universo pode ter crescido: a recusa continua valendo.
  if (limite !== undefined && linhas.length > limite) throw new SelectionTooLargeError(linhas.length, limite);
  if (linhas.length === 0) throw new SelectionEmptyError();
  return linhas;
}
