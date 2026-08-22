import { Prisma } from "@prisma/client";
import type { ReceiptDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getReceiptById } from "../receiving/receiving.service.js";
import {
  CustomerSuppliedAcquisitionCostError,
  InvalidAcquisitionCostError,
  ReceiptLineNotFoundError,
} from "./costs.errors.js";
import type { SetAcquisitionCostInput } from "./costs.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

/**
 * Define/atualiza/limpa o CUSTO EFETIVO DE AQUISICAO de uma ReceiptLine ja
 * confirmada. E uma atualizacao de CUSTEIO, nunca do recebimento fisico:
 * jamais altera quantidade, item, lote ou fornecedor, jamais reabre o
 * Receipt e — crucialmente — jamais cria InventoryMovement nem altera On
 * Hand/Reserved/Available/On Order. Custo e quantidade fisica sao
 * dimensoes diferentes.
 *
 * `unitCost` vazio limpa o custo (volta a desconhecido = `null`). Zero e
 * um valor valido e explicitamente informado, nunca reinterpretado como
 * desconhecido. Negativo e rejeitado.
 */
export async function setAcquisitionCost(
  receiptLineId: string,
  input: SetAcquisitionCostInput,
): Promise<ReceiptDTO> {
  const prisma = getPrisma();

  const receiptId = await prisma.$transaction(async (tx) => {
    const line = await tx.receiptLine.findUnique({
      where: { id: receiptLineId },
      include: { receipt: { select: { sourceType: true } } },
    });
    if (!line) throw new ReceiptLineNotFoundError(receiptLineId);
    // A tela ja nao oferece a acao, mas a recusa precisa existir no dominio:
    // material do cliente nao tem custo de aquisicao Veridi para informar.
    if (line.receipt.sourceType === "CUSTOMER_SUPPLIED") {
      throw new CustomerSuppliedAcquisitionCostError();
    }

    const raw = input.unitCost.trim();
    const unitCost = raw === "" ? null : new Prisma.Decimal(raw);
    if (unitCost && unitCost.lessThan(0)) throw new InvalidAcquisitionCostError();

    await tx.receiptLine.update({
      where: { id: receiptLineId },
      data: {
        actualUnitCost: unitCost,
        costUpdatedAt: new Date(),
        costUpdatedBy: SYSTEM_ACTOR,
        costNote: input.note?.trim() || null,
      },
    });

    return line.receiptId;
  });

  return (await getReceiptById(receiptId))!;
}
