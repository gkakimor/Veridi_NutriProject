import { hojeComercial, limitesDoDiaComercial } from "@veridi/shared";

/**
 * O recebimento na tela é DATA CIVIL ("Data do recebimento"); no servidor é
 * INSTANTE — `Receipt.receivedAt` continua carimbo de tempo (§81) —, e o código
 * do lote (`LT-YYYYMMDD-…`), o movimento de estoque e a janela de custo leem o
 * DIA COMERCIAL desse instante (§72).
 *
 * `new Date("2026-09-11").toISOString()` é a meia-noite UTC: 21h do dia 10 em
 * São Paulo. Enviado assim, todo lote recebido pela interface nascia com o dia
 * anterior no código, e o movimento de estoque caía na véspera.
 */

/** O dia que o campo mostra ao abrir: o da Veridi — nem o do navegador, nem o UTC. */
export function diaDoRecebimentoPadrao(agora: Date = new Date()): string {
  return hojeComercial(agora);
}

/**
 * O instante que representa a data escolhida.
 *
 * Hoje é agora: o recebimento acontece quando é lançado. Outro dia é o início
 * daquele dia comercial — um instante que pertence ao dia escolhido, sem
 * inventar hora.
 */
export function instanteDoRecebimento(dia: string, agora: Date = new Date()): string {
  return dia === hojeComercial(agora)
    ? agora.toISOString()
    : limitesDoDiaComercial(dia).inicio.toISOString();
}
