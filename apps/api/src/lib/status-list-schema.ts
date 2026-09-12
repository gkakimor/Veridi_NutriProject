import { z } from "zod";

/**
 * Filtro de listagem por status: um, ou vários separados por vírgula —
 * `status=RELEASED,IN_PRODUCTION`.
 *
 * Nasceu na fila do Picking/Consumo (FILTER-OPERATIONS-WAVE-01), que é "OP
 * ainda atendível" — dois status. A tela pedia um de cada vez com `pageSize:
 * 100` e concatenava as respostas no navegador: da 101ª ordem de qualquer
 * lado a fila perdia linhas sem dizer nada, e o rodapé contava o que sobrou
 * como se fosse o total.
 *
 * FILTER-OPERATIONS-WAVE-03 levou o mesmo contrato para Pedidos e Ordens de
 * Compra, cujas filas abrem em "Em aberto" — também um conjunto de status.
 * É UM contrato para todas as listas, e por isso mora aqui e não em cada
 * schema: uma segunda forma de pedir vários status seria uma segunda
 * interpretação do mesmo filtro.
 *
 * Não é breaking change: um valor só continua valendo, e o `where` que ele
 * produz é o mesmo de antes (`statusDoWhere`).
 */
export function listaDeStatusSchema<T extends [string, ...string[]]>(statusEnum: z.ZodEnum<T>) {
  return z
    .string()
    .trim()
    .transform((valor) =>
      valor
        .split(",")
        .map((parte) => parte.trim())
        .filter(Boolean),
    )
    .pipe(z.array(statusEnum).min(1, "Informe ao menos um status"));
}

/** Um status vira igualdade; vários viram `in`. Lista vazia não filtra. */
export function statusDoWhere<T extends string>(
  statuses: readonly T[] | undefined,
): T | { in: T[] } | undefined {
  if (!statuses || statuses.length === 0) return undefined;
  return statuses.length === 1 ? (statuses[0] as T) : { in: [...statuses] };
}
