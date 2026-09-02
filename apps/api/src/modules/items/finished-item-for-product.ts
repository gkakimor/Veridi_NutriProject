import type { Item, Prisma, PrismaClient } from "@prisma/client";
import { nextItemCode } from "./item-codes.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * O Item de produto acabado de um Produto.
 *
 * Existe uma única definição de "como nasce o PA de um Produto", e ela vive
 * aqui: tanto o cadastro direto de Produto quanto o produto nascido de
 * Projeto passam por esta função. Duas construções paralelas divergiriam com
 * o tempo — uma controlando lote e a outra não, por exemplo — e a diferença
 * só apareceria meses depois, num lote que não pôde ser rastreado.
 *
 * Os três controles são ligados de propósito: produto acabado da Veridi tem
 * lote, tem validade e passa pela Qualidade antes de sair. Quem precisar de
 * outro comportamento ajusta o item depois, no cadastro de Itens de estoque —
 * mas o padrão seguro é o padrão.
 *
 * Recebe a transação de quem chama: o código sai da mesma sequence oficial
 * (`PA-000123`) e, se a criação do Produto falhar em seguida, o item não fica
 * para trás.
 */
export async function createFinishedItemForProduct(
  tx: PrismaOrTx,
  input: { name: string; unitCode: string; requiresCoa?: boolean },
): Promise<Item> {
  const code = await nextItemCode(tx, "FINISHED_PRODUCT");

  return tx.item.create({
    data: {
      code,
      type: "FINISHED_PRODUCT",
      name: input.name,
      unitCode: input.unitCode,
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
      // O laudo é o único que varia: há produto que exige CoA aprovado
      // para liberar o lote e há produto que não. Ausente, segue desligado
      // — exigir laudo sem que ninguém tenha pedido travaria expedição.
      requiresCoa: input.requiresCoa ?? false,
      active: true,
    },
  });
}
