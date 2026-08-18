import { Prisma } from "@prisma/client";
import type { CustomerOrder, Item, PurchaseOrder, PurchaseOrderLine, ReceiptLine, Supplier } from "@prisma/client";
import type { PurchaseOrderDTO, PurchaseOrderLineDTO, PurchaseOrderListResponse } from "@veridi/shared";
import { PURCHASE_ORDER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  DuplicateLineItemError,
  EmptyOrderError,
  InactiveLineItemError,
  InactiveSupplierError,
  InvalidLineItemTypeError,
  InvalidTransitionError,
  LineItemNotFoundError,
  OrderLockedError,
  PurchaseOrderNotFoundError,
  SupplierNotFoundError,
} from "./purchase-orders.errors.js";
import type {
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  PurchaseOrderLineInput,
  UpdatePurchaseOrderInput,
} from "./purchase-orders.schemas.js";

const CODE_SEQUENCE = "purchase_order_code_seq";

/**
 * Nao ha autenticacao/Usuarios no MVP ainda. Mesma string ja exibida na
 * topbar ("Ambiente local") — nao inventa um usuario fake, so registra a
 * identidade de sessao que a UI ja usa.
 */
const SYSTEM_ACTOR = "Ambiente local";

type LineWithReceipts = PurchaseOrderLine & { receiptLines: ReceiptLine[] };
type ReceiptWithLines = {
  id: string;
  code: string;
  receivedAt: Date;
  invoiceNumber: string | null;
  lines: { receivedQuantity: Prisma.Decimal; lotId: string | null }[];
};
type PurchaseOrderWithLines = PurchaseOrder & {
  lines: LineWithReceipts[];
  customerOrder: CustomerOrder | null;
  receipts: ReceiptWithLines[];
};

/** Include padrao para carregar uma OC com o suficiente para o DTO (linhas + recebido). */
const purchaseOrderInclude = {
  lines: { include: { receiptLines: true } },
  customerOrder: true,
  // O que de fato chegou contra o que foi pedido: a OC sem os recebimentos
  // obriga a sair para a lista geral e procurar pelo codigo da ordem.
  receipts: {
    orderBy: { receivedAt: "asc" as const },
    select: {
      id: true,
      code: true,
      receivedAt: true,
      invoiceNumber: true,
      lines: { select: { receivedQuantity: true, lotId: true } },
    },
  },
} as const;

/** Dinheiro (BRL) sempre com 2 casas decimais na saida da API. */
function formatMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function toLineDTO(line: LineWithReceipts): PurchaseOrderLineDTO {
  const lineTotal = line.unitPrice ? line.orderedQuantity.times(line.unitPrice) : null;
  const receivedQuantity = line.receiptLines.reduce(
    (sum, receiptLine) => sum.plus(receiptLine.receivedQuantity),
    new Prisma.Decimal(0),
  );
  const openQuantity = line.orderedQuantity.minus(receivedQuantity);
  return {
    id: line.id,
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    unitCode: line.unitCode,
    orderedQuantity: line.orderedQuantity.toString(),
    unitPrice: line.unitPrice ? formatMoney(line.unitPrice) : null,
    lineTotal: lineTotal ? formatMoney(lineTotal) : null,
    receivedQuantity: receivedQuantity.toString(),
    openQuantity: openQuantity.toString(),
  };
}

function toPurchaseOrderDTO(po: PurchaseOrderWithLines): PurchaseOrderDTO {
  const lines = po.lines.map(toLineDTO);

  let orderTotal: Prisma.Decimal | null = null;
  for (const line of po.lines) {
    if (!line.unitPrice) continue;
    const lineTotal = line.orderedQuantity.times(line.unitPrice);
    orderTotal = orderTotal ? orderTotal.plus(lineTotal) : lineTotal;
  }

  return {
    id: po.id,
    code: po.code,
    supplierId: po.supplierId,
    supplierCode: po.supplierCode,
    supplierName: po.supplierName,
    supplierCnpj: po.supplierCnpj,
    orderDate: po.orderDate.toISOString(),
    expectedDeliveryDate: po.expectedDeliveryDate ? po.expectedDeliveryDate.toISOString() : null,
    status: po.status,
    notes: po.notes,
    lines,
    orderTotal: orderTotal ? formatMoney(orderTotal) : null,
    origin: po.origin,
    customerOrderId: po.customerOrderId,
    customerOrderCode: po.customerOrder ? po.customerOrder.code : null,
    orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
    orderedBy: po.orderedBy,
    cancelledAt: po.cancelledAt ? po.cancelledAt.toISOString() : null,
    cancelledBy: po.cancelledBy,
    cancelReason: po.cancelReason,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    receipts: po.receipts.map((receipt) => ({
      id: receipt.id,
      code: receipt.code,
      receivedAt: receipt.receivedAt.toISOString(),
      invoiceNumber: receipt.invoiceNumber,
      lineCount: receipt.lines.length,
      receivedQuantity: receipt.lines
        .reduce((total, line) => total.plus(line.receivedQuantity), new Prisma.Decimal(0))
        .toString(),
      lotCount: receipt.lines.filter((line) => line.lotId !== null).length,
    })),
  };
}

/**
 * Vinculo a um Supplier (create, ou troca em DRAFT): precisa existir e
 * estar ativo. Exportado — reutilizado pela Sugestão de Compra
 * (`purchase-suggestion.service.ts`) para validar o Supplier escolhido
 * pelo usuário antes de gerar a OC DRAFT, mesma regra, nunca duplicada.
 */
export async function assertSupplierActive(id: string): Promise<Supplier> {
  const supplier = await getPrisma().supplier.findUnique({ where: { id } });
  if (!supplier) throw new SupplierNotFoundError(id);
  if (!supplier.active) throw new InactiveSupplierError(id);
  return supplier;
}

/**
 * Item de linha: precisa existir, ser RAW_MATERIAL/PACKAGING e estar
 * ativo. Exportado pelo mesmo motivo de `assertSupplierActive`.
 */
export async function assertLineItemValid(id: string): Promise<Item> {
  const item = await getPrisma().item.findUnique({ where: { id } });
  if (!item) throw new LineItemNotFoundError(id);
  if (item.type !== "RAW_MATERIAL" && item.type !== "PACKAGING") {
    throw new InvalidLineItemTypeError(id);
  }
  if (!item.active) throw new InactiveLineItemError(id);
  return item;
}

interface ValidatedLine {
  input: PurchaseOrderLineInput;
  item: Item;
}

/** Valida duplicidade dentro do array e cada item individualmente. */
async function validateLines(lines: PurchaseOrderLineInput[]): Promise<ValidatedLine[]> {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.itemId)) throw new DuplicateLineItemError(line.itemId);
    seen.add(line.itemId);
  }

  const validated: ValidatedLine[] = [];
  for (const line of lines) {
    const item = await assertLineItemValid(line.itemId);
    validated.push({ input: line, item });
  }
  return validated;
}

function lineCreateData(purchaseOrderId: string, validated: ValidatedLine) {
  return {
    purchaseOrderId,
    itemId: validated.item.id,
    itemCode: validated.item.code,
    itemName: validated.item.name,
    unitCode: validated.item.unitCode,
    orderedQuantity: validated.input.orderedQuantity,
    unitPrice: validated.input.unitPrice ?? null,
  };
}

async function requirePurchaseOrder(id: string): Promise<PurchaseOrderWithLines> {
  const po = await getPrisma().purchaseOrder.findUnique({
    where: { id },
    include: purchaseOrderInclude,
  });
  if (!po) throw new PurchaseOrderNotFoundError(id);
  return po;
}

export async function listPurchaseOrders(
  query: ListPurchaseOrdersQuery,
  pagination: Pagination = query,
): Promise<PurchaseOrderListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.status) where["status"] = query.status;
  if (query.supplierId) where["supplierId"] = query.supplierId;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { supplierName: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [purchaseOrders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: purchaseOrderInclude,
      orderBy: { code: "desc" },
      ...pageArgs(pagination),
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return {
    purchaseOrders: purchaseOrders.map(toPurchaseOrderDTO),
    ...pageMeta(pagination, total),
  };
}

export async function getPurchaseOrderById(id: string): Promise<PurchaseOrderDTO | null> {
  const po = await getPrisma().purchaseOrder.findUnique({
    where: { id },
    include: purchaseOrderInclude,
  });
  return po ? toPurchaseOrderDTO(po) : null;
}

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrderDTO> {
  const supplier = await assertSupplierActive(input.supplierId);
  const validatedLines = input.lines ? await validateLines(input.lines) : [];

  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, PURCHASE_ORDER_CODE_PREFIX);

  const created = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        code,
        supplierId: supplier.id,
        supplierCode: supplier.code,
        supplierName: supplier.legalName,
        supplierCnpj: supplier.cnpj,
        orderDate: input.orderDate,
        ...(input.expectedDeliveryDate !== undefined
          ? { expectedDeliveryDate: input.expectedDeliveryDate }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (validatedLines.length > 0) {
      await tx.purchaseOrderLine.createMany({
        data: validatedLines.map((line) => lineCreateData(po.id, line)),
      });
    }

    return po;
  });

  return (await getPurchaseOrderById(created.id))!;
}

/**
 * Cria uma OC DRAFT dentro de uma transacao ja aberta — usado pela
 * Sugestao de Compra (efeito colateral atomico de gerar rascunhos
 * agrupados por fornecedor). Nunca ORDERED — a OC nasce DRAFT e segue o
 * fluxo normal (usuario revisa/preenche preco/confirma manualmente).
 * `code` ja deve ter sido gerado (sequence) antes de entrar na transacao.
 */
export async function createDraftPurchaseOrderInTx(
  tx: Prisma.TransactionClient,
  params: {
    code: string;
    supplier: Supplier;
    orderDate: Date;
    customerOrderId: string;
    /**
     * `unitPrice` é o preço de referência já resolvido pelo chamador
     * (oferta vigente do fornecedor). A linha é um SNAPSHOT do preço
     * esperado: alterar a oferta depois nunca muda uma OC existente.
     */
    lines: { item: Item; orderedQuantity: Prisma.Decimal; unitPrice?: Prisma.Decimal | null }[];
  },
): Promise<string> {
  const po = await tx.purchaseOrder.create({
    data: {
      code: params.code,
      supplierId: params.supplier.id,
      supplierCode: params.supplier.code,
      supplierName: params.supplier.legalName,
      supplierCnpj: params.supplier.cnpj,
      orderDate: params.orderDate,
      origin: "CUSTOMER_ORDER",
      customerOrderId: params.customerOrderId,
    },
  });

  if (params.lines.length > 0) {
    await tx.purchaseOrderLine.createMany({
      data: params.lines.map((line) => ({
        purchaseOrderId: po.id,
        itemId: line.item.id,
        itemCode: line.item.code,
        itemName: line.item.name,
        unitCode: line.item.unitCode,
        orderedQuantity: line.orderedQuantity,
        unitPrice: line.unitPrice ?? null,
      })),
    });
  }

  return po.id;
}

export async function updatePurchaseOrder(
  id: string,
  input: UpdatePurchaseOrderInput,
): Promise<PurchaseOrderDTO> {
  const current = await requirePurchaseOrder(id);

  const touchesLockedFields =
    input.supplierId !== undefined || input.orderDate !== undefined || input.lines !== undefined;
  const touchesAnyField =
    touchesLockedFields || input.expectedDeliveryDate !== undefined || input.notes !== undefined;

  if (current.status === "CANCELLED") {
    if (touchesAnyField) {
      throw new OrderLockedError("Ordem de compra cancelada é somente leitura.");
    }
  } else if (current.status !== "DRAFT") {
    // ORDERED / PARTIALLY_RECEIVED / RECEIVED: so previsao de entrega e observacoes.
    if (touchesLockedFields) {
      throw new OrderLockedError(
        "Após confirmada, a ordem de compra só permite alterar previsão de entrega e observações.",
      );
    }
  }

  let supplierSnapshot: { id: string; code: string; legalName: string; cnpj: string | null } | null =
    null;
  if (current.status === "DRAFT" && input.supplierId !== undefined) {
    const supplier = await assertSupplierActive(input.supplierId);
    supplierSnapshot = {
      id: supplier.id,
      code: supplier.code,
      legalName: supplier.legalName,
      cnpj: supplier.cnpj,
    };
  }

  let validatedLines: ValidatedLine[] | null = null;
  if (current.status === "DRAFT" && input.lines !== undefined) {
    validatedLines = await validateLines(input.lines);
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(supplierSnapshot
          ? {
              supplierId: supplierSnapshot.id,
              supplierCode: supplierSnapshot.code,
              supplierName: supplierSnapshot.legalName,
              supplierCnpj: supplierSnapshot.cnpj,
            }
          : {}),
        ...(input.orderDate !== undefined ? { orderDate: input.orderDate } : {}),
        ...(input.expectedDeliveryDate !== undefined
          ? { expectedDeliveryDate: input.expectedDeliveryDate }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (validatedLines !== null) {
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      if (validatedLines.length > 0) {
        await tx.purchaseOrderLine.createMany({
          data: validatedLines.map((line) => lineCreateData(id, line)),
        });
      }
    }
  });

  return (await getPurchaseOrderById(id))!;
}

export async function confirmPurchaseOrder(id: string): Promise<PurchaseOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    const current = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!current) throw new PurchaseOrderNotFoundError(id);
    if (current.status !== "DRAFT") {
      throw new InvalidTransitionError("Somente rascunhos podem ser confirmados.");
    }
    if (current.lines.length === 0) {
      throw new EmptyOrderError();
    }

    // Revalida tudo no momento da confirmacao — nao confia apenas na
    // validacao ja feita em saves anteriores do rascunho.
    await assertSupplierActive(current.supplierId);
    const seen = new Set<string>();
    for (const line of current.lines) {
      if (seen.has(line.itemId)) throw new DuplicateLineItemError(line.itemId);
      seen.add(line.itemId);
      await assertLineItemValid(line.itemId);
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "ORDERED", orderedAt: new Date(), orderedBy: SYSTEM_ACTOR },
    });
  });

  return (await getPurchaseOrderById(id))!;
}

export async function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    const current = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!current) throw new PurchaseOrderNotFoundError(id);
    if (current.status !== "DRAFT" && current.status !== "ORDERED") {
      throw new InvalidTransitionError(
        "Somente rascunhos ou pedidos confirmados podem ser cancelados.",
      );
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: SYSTEM_ACTOR,
        cancelReason: reason,
      },
    });
  });

  return (await getPurchaseOrderById(id))!;
}
