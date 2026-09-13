import type { ItemType } from "@prisma/client";

/**
 * Os tipos de Item que entram como material ENVIADO PELO CLIENTE: matéria-prima
 * e embalagem. Produto acabado não é insumo que o cliente manda para a fábrica.
 *
 * Mora num lugar só porque duas perguntas precisam dar a mesma resposta
 * (CUSTOMER-MATERIAL-ITEM-CUTOFF-01): `createCustomerSuppliedReceipt` recusa o
 * item fora deste conjunto, e o seletor do Receber material do cliente
 * (`GET /items?customerSupplied=true`) só oferece item de dentro dele. Se
 * divergissem, a tela ofereceria item que o servidor recusa — ou esconderia
 * item que ele aceita.
 *
 * Item não tem dono: o catálogo é um só, e quem é dono é o LOTE, que nasce com
 * o cliente do recebimento. Por isso o conjunto não depende de cliente.
 */
export const TIPOS_DE_MATERIAL_DO_CLIENTE: readonly ItemType[] = ["RAW_MATERIAL", "PACKAGING"];

/** Um item deste tipo pode ser recebido como material do cliente? */
export function tipoAceitaMaterialDoCliente(type: string): boolean {
  return TIPOS_DE_MATERIAL_DO_CLIENTE.some((aceito) => aceito === type);
}
