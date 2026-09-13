import { ehDiaCivil } from "./business-timezone.js";

/**
 * Período de filtro com as duas pontas escolhidas (PERIOD-RANGE-VALIDATION-WAVE-01).
 *
 * "De 13/09 até 12/09" é pergunta inválida, não "zero resultados". Sem comparar
 * as pontas, `intervaloDeDiasComerciais` montava `gte 13/09` e `lt 13/09`, e a
 * lista respondia 200 vazia — lida como "nada aconteceu no período".
 *
 * A regra é a mesma na tela e no servidor, nas listas, nos Relatórios e nas
 * exportações:
 *
 * - nenhuma ponta, só a inicial ou só a final: consulta, com a ponta vazia
 *   ABERTA — "a partir de" e "até" são perguntas legítimas;
 * - as duas, a inicial antes da final ou no mesmo dia: consulta (o mesmo dia é
 *   um dia inteiro);
 * - as duas, a inicial depois da final: recusa.
 *
 * Ponta vazia nunca vira hoje aqui. Completar com hoje é contrato só do Painel
 * (`recusaDoPeriodoDoPainel`), que usa esta regra DEPOIS de completar.
 */

/** A frase da recusa — a mesma que a tela mostra e que o servidor devolve. */
export const MENSAGEM_DE_PERIODO_INVERTIDO = "A data inicial não pode ser posterior à data final.";

/**
 * Por que o período não se consulta — `null` quando pode.
 *
 * `de`/`ate` são dias `YYYY-MM-DD`, e dia bem formado se compara como texto.
 * Dia mal formado não é inversão: é a recusa do próprio campo, e somar esta
 * frase à dele diria duas coisas sobre um erro só.
 */
export function recusaDoPeriodo(
  de: string | null | undefined,
  ate: string | null | undefined,
): string | null {
  if (!de || !ate || !ehDiaCivil(de) || !ehDiaCivil(ate)) return null;
  return de > ate ? MENSAGEM_DE_PERIODO_INVERTIDO : null;
}
