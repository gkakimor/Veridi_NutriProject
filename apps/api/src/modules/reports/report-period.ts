import { intervaloDeDiasComerciais } from "@veridi/shared";
import { intervaloDeDiasCivis } from "../../lib/business-day.js";

/**
 * O período dos relatórios, do dia escolhido ao filtro da consulta
 * (REPORTS-BUSINESS-DATE-01).
 *
 * A tela manda dois DIAS — `from`/`to` em `YYYY-MM-DD`, validados por
 * `diaCivilDeFiltroSchema` — e o serviço os abre UMA vez, aqui, pela espécie
 * da coluna. A escolha é do dado, nunca de gosto:
 *
 * - carimbo de tempo (`issuedAt`, `occurredAt`, `receivedAt`, `consumedAt`,
 *   `completedAt`, `CustomerOrder.orderDate`) → `periodoDeInstante`, os
 *   instantes que limitam o dia comercial em São Paulo;
 * - data de documento gravada como marcador de meia-noite UTC
 *   (`PurchaseOrder.orderDate`, `Lot.expiryDate`) → `periodoDeDataCivil`.
 *
 * Antes quem convertia era a TELA: `new Date(`${dia}T00:00:00`).toISOString()`
 * é a meia-noite do NAVEGADOR, e a mesma escolha de 12/09 virava um recorte em
 * UTC, outro em Vancouver e outro em São Paulo. O fim é exclusivo (`lt` o
 * começo do dia seguinte), nunca `23:59:59.999`.
 */

type PeriodoDoRelatorio = { from?: string | undefined; to?: string | undefined };

type FiltroDePeriodo = { gte?: Date; lt?: Date };

function comoFiltro(intervalo: { inicio?: Date; fimExclusivo?: Date }): FiltroDePeriodo | undefined {
  if (!intervalo.inicio && !intervalo.fimExclusivo) return undefined;
  return {
    ...(intervalo.inicio ? { gte: intervalo.inicio } : {}),
    ...(intervalo.fimExclusivo ? { lt: intervalo.fimExclusivo } : {}),
  };
}

/** Coluna de INSTANTE — o dia comercial inteiro, em São Paulo. */
export function periodoDeInstante(query: PeriodoDoRelatorio): FiltroDePeriodo | undefined {
  return comoFiltro(intervaloDeDiasComerciais(query.from, query.to));
}

/** Coluna de DATA CIVIL — os marcadores dos dias escolhidos. */
export function periodoDeDataCivil(query: PeriodoDoRelatorio): FiltroDePeriodo | undefined {
  return comoFiltro(intervaloDeDiasCivis(query.from, query.to));
}
