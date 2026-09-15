import type { IntervaloDeDias } from "@veridi/shared";

/**
 * Destinos do Painel Gerencial — só para telas que filtram de verdade o que o
 * número conta (§5.11; discovery, §6.15). Indicador sem destino que filtre fica
 * sem link: "Pedidos confirmados" não tem lista por data de confirmação, e um
 * link para a lista inteira seria enganoso.
 */

/** Faturamentos EMITIDOS do intervalo — a lista lê status, período e cliente da URL. */
export function linkDosFaturamentos(intervalo: IntervaloDeDias, customerId?: string): string {
  const query = new URLSearchParams({
    status: "ISSUED",
    period: "custom",
    dateFrom: intervalo.from,
    dateTo: intervalo.to,
  });
  if (customerId) query.set("customerId", customerId);
  return `/comercial/faturamento?${query.toString()}`;
}

/** Ordens de Compra contratadas no intervalo, pela data do pedido. */
export function linkDasComprasContratadas(intervalo: IntervaloDeDias): string {
  const query = new URLSearchParams({
    status: "contratadas",
    period: "custom",
    dateFrom: intervalo.from,
    dateTo: intervalo.to,
  });
  return `/compras/ordens?${query.toString()}`;
}

/** A carteira: Pedidos com saldo a expedir. */
export const LINK_DA_CARTEIRA = "/comercial/pedidos?status=carteira";

/** R-16: Expedições confirmadas sem faturamento emitido — o mesmo conjunto do A faturar. */
export const LINK_A_FATURAR = "/relatorios/faturamento/pendentes";

export function linkDaVisaoDoClienteFaturamentos(customerId: string): string {
  return `/consultas/clientes/${customerId}/faturamentos`;
}

export function linkDaVisaoDoClienteProduto(customerId: string, productId: string): string {
  return `/consultas/clientes/${customerId}/produtos/${productId}`;
}
