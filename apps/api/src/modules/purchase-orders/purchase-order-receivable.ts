import type { PurchaseOrderStatus } from "@prisma/client";

/**
 * Os status em que uma Ordem de Compra recebe material: confirmada ao
 * fornecedor, ou já recebida em parte. Rascunho ainda não foi pedido;
 * recebida e cancelada estão encerradas.
 *
 * Mora num lugar só porque duas perguntas precisam dar a mesma resposta
 * (RECEIVING-OPEN-PO-CUTOFF-01): `createReceipt` recusa a OC fora deste
 * conjunto, e o seletor do Recebimento (`GET /purchase-orders?receivable=true`)
 * só oferece OC de dentro dele. Se divergissem, a tela ofereceria OC que o
 * servidor recusa — ou esconderia OC que ele aceita.
 */
export const STATUS_QUE_RECEBEM: readonly PurchaseOrderStatus[] = ["ORDERED", "PARTIALLY_RECEIVED"];

/** A OC neste status pode receber material agora? */
export function ordemDeCompraRecebe(status: string | undefined): boolean {
  return STATUS_QUE_RECEBEM.some((recebe) => recebe === status);
}
