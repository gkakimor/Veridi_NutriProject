import { Prisma } from "@prisma/client";
import type {
  Customer,
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
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { nextLotCode } from "../../lib/lot-code.js";
import {
  CustomerMaterialRequiresLotControlError,
  CustomerNotFoundError,
  EmptyReceiptError,
  InactiveCustomerError,
  InvalidCustomerSuppliedItemTypeError,
  ReceiptItemNotFoundError,
  InvalidExpiryDateError,
  InvalidPurchaseOrderStatusError,
  InvalidReceivedQuantityError,
  MissingExpiryDateError,
  MissingSupplierLotError,
  OverReceiptError,
  PurchaseOrderLineNotFoundError,
  PurchaseOrderNotFoundError,
} from "./receiving.errors.js";
import type {
  CreateCustomerSuppliedReceiptInput,
  CreateReceiptInput,
  CustomerSuppliedLineInput,
  ListReceiptsQuery,
  ReceiptLineInput,
} from "./receiving.schemas.js";

const RECEIPT_CODE_SEQUENCE = "receipt_code_seq";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

type ReceiptLineWithRelations = ReceiptLine & {
  purchaseOrderLine: PurchaseOrderLine | null;
  item: Item;
  lot: Lot | null;
};
type ReceiptWithRelations = Receipt & {
  purchaseOrder: PurchaseOrder | null;
  supplier: { code: string; legalName: string } | null;
  customer: Customer | null;
  lines: ReceiptLineWithRelations[];
};

const receiptInclude = {
  purchaseOrder: true,
  supplier: true,
  customer: true,
  lines: { include: { purchaseOrderLine: true, item: true, lot: true } },
} as const;

function toReceiptLineDTO(line: ReceiptLineWithRelations): ReceiptLineDTO {
  return {
    id: line.id,
    purchaseOrderLineId: line.purchaseOrderLineId,
    itemId: line.itemId,
    // Snapshot proprio da linha quando existir (linha direta de material do
    // cliente); linhas antigas de OC continuam lendo o snapshot da OC.
    itemCode: line.itemCode ?? line.purchaseOrderLine?.itemCode ?? line.item.code,
    itemName: line.itemName ?? line.purchaseOrderLine?.itemName ?? line.item.name,
    unitCode: line.unitCode,
    receivedQuantity: line.receivedQuantity.toString(),
    supplierLot: line.supplierLot,
    expiryDate: line.expiryDate ? line.expiryDate.toISOString() : null,
    location: line.location,
    lotId: line.lotId,
    lotCode: line.lot ? line.lot.code : null,
    ownerType: line.lot ? line.lot.ownerType : "VERIDI",
    // Preco previsto da OC — so referencia visual, nunca custo real.
    purchaseUnitPrice: line.purchaseOrderLine?.unitPrice
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
    sourceType: receipt.sourceType,
    purchaseOrderId: receipt.purchaseOrderId,
    purchaseOrderCode: receipt.purchaseOrder?.code ?? null,
    supplierId: receipt.supplierId,
    supplierCode: receipt.purchaseOrder?.supplierCode ?? receipt.supplier?.code ?? null,
    supplierName: receipt.purchaseOrder?.supplierName ?? receipt.supplier?.legalName ?? null,
    customerId: receipt.customerId,
    customerCode: receipt.customer ? receipt.customer.code : null,
    customerName: receipt.customer ? receipt.customer.legalName : null,
    receivedAt: receipt.receivedAt.toISOString(),
    invoiceNumber: receipt.invoiceNumber,
    documentReference: receipt.documentReference,
    notes: receipt.notes,
    lines: receipt.lines.map(toReceiptLineDTO),
    createdAt: receipt.createdAt.toISOString(),
    createdBy: receipt.createdBy,
  };
}

export async function listReceipts(
  query: ListReceiptsQuery,
  pagination: Pagination = query,): Promise<ReceiptListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.purchaseOrderId) where["purchaseOrderId"] = query.purchaseOrderId;
  if (query.supplierId) where["supplierId"] = query.supplierId;
  if (query.sourceType) where["sourceType"] = query.sourceType;
  if (query.customerId) where["customerId"] = query.customerId;
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
      { customer: { is: { legalName: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const [receipts, total] = await Promise.all([
    prisma.receipt.findMany({
      where,
      include: receiptInclude,
      orderBy: { code: "desc" },
      ...pageArgs(pagination),
    }),
    prisma.receipt.count({ where }),
  ]);

  return {
    receipts: receipts.map(toReceiptDTO),
    ...pageMeta(pagination, total),
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
          itemCode: line.item.code,
          itemName: line.item.name,
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

/**
 * Recebimento de material ENVIADO PELO CLIENTE — sem Ordem de Compra e sem
 * Fornecedor fake. Mesma infraestrutura do recebimento normal: Receipt,
 * ReceiptLine, Lot e o mesmo movimento RECEIPT_IN no ledger — nunca um
 * segundo estoque paralelo.
 *
 * A diferença é a PROPRIEDADE: o lote nasce `ownerType=CUSTOMER` do
 * cliente informado. Qualidade continua valendo igual: item que exige
 * liberação entra `AWAITING_RELEASE`.
 */
export async function createCustomerSuppliedReceipt(
  input: CreateCustomerSuppliedReceiptInput,
): Promise<ReceiptDTO> {
  const prisma = getPrisma();

  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new CustomerNotFoundError(input.customerId);
  if (!customer.active) throw new InactiveCustomerError(input.customerId);

  const prepared: { item: Item; input: CustomerSuppliedLineInput }[] = [];
  for (const lineInput of input.lines) {
    const item = await prisma.item.findUnique({ where: { id: lineInput.itemId } });
    if (!item) throw new ReceiptItemNotFoundError(lineInput.itemId);
    if (item.type !== "RAW_MATERIAL" && item.type !== "PACKAGING") {
      throw new InvalidCustomerSuppliedItemTypeError(item.code);
    }
    // Sem lote não existe saldo de terceiro identificável — bloqueia em vez
    // de criar estoque de cliente indistinguível do próprio.
    if (!item.controlsLot) throw new CustomerMaterialRequiresLotControlError(item.code);
    if (new Prisma.Decimal(lineInput.receivedQuantity).lessThanOrEqualTo(0)) {
      throw new InvalidReceivedQuantityError(item.code);
    }
    if (item.controlsExpiry) {
      if (!lineInput.expiryDate) throw new MissingExpiryDateError(item.code);
      if (lineInput.expiryDate.getTime() < input.receivedAt.getTime()) {
        throw new InvalidExpiryDateError(item.code);
      }
    }
    prepared.push({ item, input: lineInput });
  }

  if (prepared.length === 0) throw new EmptyReceiptError();

  const code = await nextSequenceCode(prisma, RECEIPT_CODE_SEQUENCE, RECEIPT_CODE_PREFIX);

  const receiptId = await prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.create({
      data: {
        code,
        sourceType: "CUSTOMER_SUPPLIED",
        customerId: customer.id,
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
      const supplierLot = line.input.supplierLot?.trim() || null;
      const expiryDate = line.input.expiryDate ?? null;
      const location = line.input.location?.trim() || null;

      const receiptLine = await tx.receiptLine.create({
        data: {
          receiptId: receipt.id,
          itemId: line.item.id,
          // Linha direta: o snapshot do item vive nela mesma, sem depender
          // de PurchaseOrderLine.
          itemCode: line.item.code,
          itemName: line.item.name,
          receivedQuantity: line.input.receivedQuantity,
          unitCode: line.item.unitCode,
          supplierLot,
          expiryDate,
          location,
          // Material do cliente não tem custo de aquisição da Veridi —
          // `null` é desconhecido/inexistente, nunca zero.
          actualUnitCost: null,
        },
      });

      const lotCode = await nextLotCode(tx, input.receivedAt);
      const lot = await tx.lot.create({
        data: {
          code: lotCode,
          itemId: line.item.id,
          // Fornecedor fica null: quem enviou é o dono, e dono não é
          // fornecedor. O lote do fabricante, quando informado, continua em
          // supplierLot.
          ownerType: "CUSTOMER",
          ownerCustomerId: customer.id,
          supplierLot,
          expiryDate,
          initialReceivedQuantity: line.input.receivedQuantity,
          status: line.item.requiresQualityRelease ? "AWAITING_RELEASE" : "AVAILABLE",
          location,
          createdBy: SYSTEM_ACTOR,
        },
      });
      await tx.receiptLine.update({ where: { id: receiptLine.id }, data: { lotId: lot.id } });

      await tx.inventoryMovement.create({
        data: {
          itemId: line.item.id,
          lotId: lot.id,
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

    return receipt.id;
  });

  return (await getReceiptById(receiptId))!;
}
