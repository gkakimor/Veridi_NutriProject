import { Prisma } from "@prisma/client";
import type {
  Item,
  Lot,
  PurchaseOrder,
  PurchaseOrderLine,
  Receipt,
  ReceiptLine,
} from "@prisma/client";
import type { ReceiptDTO, ReceiptLineDTO, ReceiptListResponse } from "@veridi/shared";
import { RECEIPT_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { nextLotCode } from "../../lib/lot-code.js";
import {
  EmptyReceiptError,
  InvalidExpiryDateError,
  InvalidPurchaseOrderStatusError,
  InvalidReceivedQuantityError,
  MissingExpiryDateError,
  MissingSupplierLotError,
  OverReceiptError,
  PurchaseOrderLineNotFoundError,
  PurchaseOrderNotFoundError,
} from "./receiving.errors.js";
import type { CreateReceiptInput, ListReceiptsQuery, ReceiptLineInput } from "./receiving.schemas.js";

const RECEIPT_CODE_SEQUENCE = "receipt_code_seq";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

type ReceiptLineWithRelations = ReceiptLine & {
  purchaseOrderLine: PurchaseOrderLine;
  lot: Lot | null;
};
type ReceiptWithRelations = Receipt & {
  purchaseOrder: PurchaseOrder;
  lines: ReceiptLineWithRelations[];
};

const receiptInclude = {
  purchaseOrder: true,
  lines: { include: { purchaseOrderLine: true, lot: true } },
} as const;

function toReceiptLineDTO(line: ReceiptLineWithRelations): ReceiptLineDTO {
  return {
    id: line.id,
    purchaseOrderLineId: line.purchaseOrderLineId,
    itemId: line.itemId,
    itemCode: line.purchaseOrderLine.itemCode,
    itemName: line.purchaseOrderLine.itemName,
    unitCode: line.unitCode,
    receivedQuantity: line.receivedQuantity.toString(),
    supplierLot: line.supplierLot,
    expiryDate: line.expiryDate ? line.expiryDate.toISOString() : null,
    location: line.location,
    lotId: line.lotId,
    lotCode: line.lot ? line.lot.code : null,
    // Preco previsto da OC — so referencia visual, nunca custo real.
    purchaseUnitPrice: line.purchaseOrderLine.unitPrice
      ? line.purchaseOrderLine.unitPrice.toFixed(4)
      : null,
    actualUnitCost: line.actualUnitCost ? line.actualUnitCost.toFixed(4) : null,
    costUpdatedAt: line.costUpdatedAt ? line.costUpdatedAt.toISOString() : null,
    costUpdatedBy: line.costUpdatedBy,
    costNote: line.costNote,
  };
}

function toReceiptDTO(receipt: ReceiptWithRelations): ReceiptDTO {
  return {
    id: receipt.id,
    code: receipt.code,
    purchaseOrderId: receipt.purchaseOrderId,
    purchaseOrderCode: receipt.purchaseOrder.code,
    supplierId: receipt.supplierId,
    supplierCode: receipt.purchaseOrder.supplierCode,
    supplierName: receipt.purchaseOrder.supplierName,
    receivedAt: receipt.receivedAt.toISOString(),
    invoiceNumber: receipt.invoiceNumber,
    documentReference: receipt.documentReference,
    notes: receipt.notes,
    lines: receipt.lines.map(toReceiptLineDTO),
    createdAt: receipt.createdAt.toISOString(),
    createdBy: receipt.createdBy,
  };
}

export async function listReceipts(query: ListReceiptsQuery): Promise<ReceiptListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.purchaseOrderId) where["purchaseOrderId"] = query.purchaseOrderId;
  if (query.supplierId) where["supplierId"] = query.supplierId;
  if (query.dateFrom || query.dateTo) {
    where["receivedAt"] = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { purchaseOrder: { is: { code: { contains: query.search, mode: "insensitive" } } } },
      { purchaseOrder: { is: { supplierName: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const [receipts, total] = await Promise.all([
    prisma.receipt.findMany({
      where,
      include: receiptInclude,
      orderBy: { code: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.receipt.count({ where }),
  ]);

  return {
    receipts: receipts.map(toReceiptDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getReceiptById(id: string): Promise<ReceiptDTO | null> {
  const receipt = await getPrisma().receipt.findUnique({ where: { id }, include: receiptInclude });
  return receipt ? toReceiptDTO(receipt) : null;
}

interface PreparedLine {
  poLine: PurchaseOrderLine;
  item: Item;
  input: ReceiptLineInput;
}

export async function createReceipt(
  purchaseOrderId: string,
  input: CreateReceiptInput,
): Promise<ReceiptDTO> {
  const prisma = getPrisma();

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  if (!po) throw new PurchaseOrderNotFoundError(purchaseOrderId);
  if (po.status !== "ORDERED" && po.status !== "PARTIALLY_RECEIVED") {
    throw new InvalidPurchaseOrderStatusError(po.status);
  }

  const linesById = new Map(po.lines.map((line) => [line.id, line]));

  // Validacoes de regra de item (lote/validade) independem de estado
  // concorrente — resolvidas antes de entrar na transacao.
  const prepared: PreparedLine[] = [];
  for (const lineInput of input.lines) {
    const poLine = linesById.get(lineInput.purchaseOrderLineId);
    if (!poLine) throw new PurchaseOrderLineNotFoundError(lineInput.purchaseOrderLineId);

    const item = await prisma.item.findUnique({ where: { id: poLine.itemId } });
    if (!item) throw new PurchaseOrderLineNotFoundError(lineInput.purchaseOrderLineId);

    if (item.controlsLot && !lineInput.supplierLot?.trim()) {
      throw new MissingSupplierLotError(item.code);
    }
    if (item.controlsExpiry) {
      if (!lineInput.expiryDate) throw new MissingExpiryDateError(item.code);
      if (lineInput.expiryDate.getTime() < input.receivedAt.getTime()) {
        throw new InvalidExpiryDateError(item.code);
      }
    }

    prepared.push({ poLine, item, input: lineInput });
  }

  if (prepared.length === 0) throw new EmptyReceiptError();

  const code = await nextSequenceCode(prisma, RECEIPT_CODE_SEQUENCE, RECEIPT_CODE_PREFIX);

  const receiptId = await prisma.$transaction(async (tx) => {
    // Trava a OC inteira: serializa recebimentos concorrentes da mesma OC
    // (protecao real contra over-receipt simultaneo) e reconfirma o status
    // sob lock, contra corrida com cancelamento/outro recebimento.
    const lockedRows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM purchase_orders WHERE id = ${purchaseOrderId} FOR UPDATE
    `;
    const lockedStatus = lockedRows[0]?.status;
    if (lockedStatus !== "ORDERED" && lockedStatus !== "PARTIALLY_RECEIVED") {
      throw new InvalidPurchaseOrderStatusError(lockedStatus ?? "DESCONHECIDO");
    }

    const receipt = await tx.receipt.create({
      data: {
        code,
        purchaseOrderId,
        supplierId: po.supplierId,
        receivedAt: input.receivedAt,
        ...(input.invoiceNumber !== undefined ? { invoiceNumber: input.invoiceNumber } : {}),
        ...(input.documentReference !== undefined
          ? { documentReference: input.documentReference }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdBy: SYSTEM_ACTOR,
      },
    });

    for (const line of prepared) {
      const alreadyReceived = await tx.receiptLine.aggregate({
        where: { purchaseOrderLineId: line.poLine.id },
        _sum: { receivedQuantity: true },
      });
      const receivedSoFar = alreadyReceived._sum.receivedQuantity ?? new Prisma.Decimal(0);
      const openQuantity = line.poLine.orderedQuantity.minus(receivedSoFar);
      const requestedQuantity = new Prisma.Decimal(line.input.receivedQuantity);

      if (requestedQuantity.lessThanOrEqualTo(0)) {
        throw new InvalidReceivedQuantityError(line.item.code);
      }
      if (requestedQuantity.greaterThan(openQuantity)) {
        throw new OverReceiptError(line.item.code);
      }

      const supplierLot = line.input.supplierLot?.trim() || null;
      const expiryDate = line.input.expiryDate ?? null;
      const location = line.input.location?.trim() || null;

      // Custo efetivo e SEMPRE opcional — o recebimento fisico nunca falha
      // por falta de custo, e o preco da OC nunca e copiado como real.
      const actualUnitCost =
        line.input.actualUnitCost !== undefined && line.input.actualUnitCost !== ""
          ? new Prisma.Decimal(line.input.actualUnitCost)
          : null;

      const receiptLine = await tx.receiptLine.create({
        data: {
          receiptId: receipt.id,
          purchaseOrderLineId: line.poLine.id,
          itemId: line.item.id,
          receivedQuantity: line.input.receivedQuantity,
          unitCode: line.poLine.unitCode,
          supplierLot,
          expiryDate,
          location,
          actualUnitCost,
          ...(actualUnitCost
            ? { costUpdatedAt: new Date(), costUpdatedBy: SYSTEM_ACTOR }
            : {}),
        },
      });

      let lotId: string | null = null;
      if (line.item.controlsLot) {
        const lotCode = await nextLotCode(tx, input.receivedAt);
        const lot = await tx.lot.create({
          data: {
            code: lotCode,
            itemId: line.item.id,
            supplierId: po.supplierId,
            supplierLot,
            expiryDate,
            initialReceivedQuantity: line.input.receivedQuantity,
            status: line.item.requiresQualityRelease ? "AWAITING_RELEASE" : "AVAILABLE",
            location,
            createdBy: SYSTEM_ACTOR,
          },
        });
        lotId = lot.id;
        await tx.receiptLine.update({ where: { id: receiptLine.id }, data: { lotId: lot.id } });
      }

      // Fonte de verdade do estoque fisico: sem este movimento a
      // confirmacao do recebimento inteiro reverte (mesma transacao).
      await tx.inventoryMovement.create({
        data: {
          itemId: line.item.id,
          lotId,
          type: "RECEIPT_IN",
          quantity: line.input.receivedQuantity,
          occurredAt: input.receivedAt,
          sourceType: "RECEIPT",
          sourceId: receiptLine.id,
          receiptLineId: receiptLine.id,
          createdBy: SYSTEM_ACTOR,
        },
      });
    }

    // Status da OC deriva 100% dos ReceiptLines reais — sem segunda fonte
    // de verdade mutavel em PurchaseOrderLine.
    const allLines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId },
      include: { receiptLines: true },
    });
    const allFullyReceived = allLines.every((poLine) => {
      const received = poLine.receiptLines.reduce(
        (sum, receiptLine) => sum.plus(receiptLine.receivedQuantity),
        new Prisma.Decimal(0),
      );
      return received.greaterThanOrEqualTo(poLine.orderedQuantity);
    });

    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: allFullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED" },
    });

    return receipt.id;
  });

  return (await getReceiptById(receiptId))!;
}
