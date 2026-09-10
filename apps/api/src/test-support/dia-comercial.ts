import { hojeComercial, limitesDoDiaComercial } from "@veridi/shared";
import { marcadorDoDiaCivil } from "../lib/business-day.js";

/**
 * O dia comercial numa fixture — para os campos que são DATA CIVIL.
 *
 * Existe porque `new Date()` responde a outra pergunta. Um campo como
 * `SupplierItemOffer.effectiveAt`, `IndustrialResourceRate.effectiveAt`,
 * `ItemCostReference.effectiveFrom` ou a validade de um lote é uma data civil:
 * a tela oferece um `<input type="date">`, o valor viaja como `2026-09-15` e a
 * coluna guarda a meia-noite UTC como MARCADOR daquele dia. O domínio lê de
 * volta com `diaDaColunaDeData` (em UTC) e compara contra `hojeComercial`
 * (em São Paulo).
 *
 * Uma fixture que grava `new Date().toISOString()` grava um INSTANTE. Entre
 * 00:00 e 03:00 UTC — 21:00 às 23:59 em São Paulo — o dia UTC já virou e o
 * comercial não, então o instante "de agora" é lido como o marcador de AMANHÃ:
 * a oferta criada para valer hoje volta `NOT_YET_EFFECTIVE`, e o lote vencido
 * "ontem" ainda está válido. A suíte ficava vermelha por três horas por dia e
 * verde nas outras vinte e uma, o que é pior que falhar sempre.
 *
 * Não há calendário novo aqui: `hojeComercial` e `marcadorDoDiaCivil` são os
 * mesmos que o runtime usa. A fixture só passou a falar a língua do domínio.
 *
 * Instante continua sendo instante: `createdAt`, `receivedAt`, `orderDate`,
 * `activatedAt` e afins seguem com `new Date()`, e nada aqui os toca.
 */

/**
 * `YYYY-MM-DD` do dia comercial, deslocado em dias civis. `-1` é ontem, `1` é
 * amanhã.
 *
 * O deslocamento é feito sobre o DIA, nunca sobre o relógio: `Date.now()` mais
 * 24 horas atravessa a meia-noite comercial na hora errada e, em mudança de
 * horário de verão, pula ou repete um dia.
 */
export function diaComercialDeTeste(deslocamentoEmDias = 0, agora: Date = new Date()): string {
  const [ano, mes, dia] = hojeComercial(agora).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, mes - 1, dia + deslocamentoEmDias)).toISOString().slice(0, 10);
}

/** O valor que uma coluna de data civil guarda para esse dia. */
export function marcadorDoDiaComercialDeTeste(
  deslocamentoEmDias = 0,
  agora: Date = new Date(),
): Date {
  return marcadorDoDiaCivil(diaComercialDeTeste(deslocamentoEmDias, agora));
}

/**
 * Um INSTANTE dentro de um dia comercial — o primeiro dele.
 *
 * Diferente dos dois acima: `receivedAt`, `occurredAt` e `entryDate` são
 * carimbos de tempo de verdade, e continuam sendo. O que muda é a ESCOLHA do
 * instante: uma fixture que quer dizer "esta compra foi recebida hoje" não
 * pode usar `new Date()`, porque aí o significado do teste passa a depender da
 * hora em que ele roda — a mesma compra cai num dia comercial de manhã e em
 * outro às 22h. Ancorar no começo do dia comercial deixa a fixture dizer a
 * mesma coisa em qualquer horário.
 *
 * O primeiro instante do dia vem de `limitesDoDiaComercial`, que resolve o
 * deslocamento pela base do `Intl` e acerta também em mudança de horário de
 * verão.
 */
export function instanteNoDiaComercialDeTeste(
  deslocamentoEmDias = 0,
  agora: Date = new Date(),
): Date {
  return limitesDoDiaComercial(diaComercialDeTeste(deslocamentoEmDias, agora)).inicio;
}
