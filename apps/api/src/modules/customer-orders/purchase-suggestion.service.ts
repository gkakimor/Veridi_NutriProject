import { Prisma } from "@prisma/client";
import type { Item, PrismaClient, Supplier } from "@prisma/client";
import type {
  CustomerOrderDTO,
  CustomerSuppliedMaterialRowDTO,
  PendingProductionOrderDTO,
  PurchaseSuggestionDTO,
  PurchaseSuggestionRowDTO,
} from "@veridi/shared";
import { PURCHASE_ORDER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { getAvailableByItems, getConsumedByReservationLines, getOnOrderByItems, getReservedByItems } from "../../lib/inventory-ledger.js";
import {
  InactiveLineItemError,
  InactiveSupplierError,
  LineItemNotFoundError,
  SupplierNotFoundError,
  InvalidLineItemTypeError,
} from "../purchase-orders/purchase-orders.errors.js";
import { createDraftPurchaseOrderInTx } from "../purchase-orders/purchase-orders.service.js";
import { CustomerOrderNotFoundError } from "./customer-orders.errors.js";
import { getCustomerOrderById } from "./customer-orders.service.js";
import { itemScopesFor } from "./fulfillment-plan.service.js";
import {
  CustomerOrderNotInFulfillmentError,
  CustomerSuppliedItemPurchaseError,
  EmptyPurchaseDraftsError,
} from "./purchase-suggestion.errors.js";
import type { GeneratePurchaseDraftsInput } from "./purchase-suggestion.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const PURCHASE_ORDER_CODE_SEQUENCE = "purchase_order_code_seq";

async function computeDraftPurchaseQuantityByItem(
  prisma: PrismaOrTx,
  customerOrderId: string,
  itemIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (itemIds.length === 0) return new Map();
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { itemId: { in: itemIds }, purchaseOrder: { customerOrderId, status: "DRAFT" } },
    select: { itemId: true, orderedQuantity: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const current = map.get(line.itemId) ?? new Prisma.Decimal(0);
    map.set(line.itemId, current.plus(line.orderedQuantity));
  }
  return map;
}

/**
 * Análise dinâmica — nunca persiste nada. Necessidade vem dos
 * `ProductionOrderRequirement` REAIS das OPs `CUSTOMER_ORDER` deste
 * Pedido (nunca recalcula fórmula em paralelo — Requirement já é a
 * necessidade técnica oficial da OP). Só participam OPs não `CANCELLED`/
 * `COMPLETED` (§30-32). OPs sem Requirement ainda (sem Formulação ACTIVE)
 * viram pendência de planejamento, fora da agregação quantitativa (§29).
 */
async function buildPurchaseSuggestion(
  prisma: PrismaOrTx,
  customerOrderId: string,
): Promise<PurchaseSuggestionDTO> {
  const productionOrders = await prisma.productionOrder.findMany({
    where: { customerOrderId, status: { notIn: ["CANCELLED", "COMPLETED"] } },
    include: { requirements: true, product: true, customer: true },
    orderBy: { createdAt: "asc" },
  });

  const pendingProductionOrders: PendingProductionOrderDTO[] = [];
  const orderByRequirement = new Map<string, (typeof productionOrders)[number]>();
  const requirementRows: (typeof productionOrders)[number]["requirements"] = [];
  for (const order of productionOrders) {
    if (order.requirements.length === 0) {
      const usingSnapshot = order.productCode !== null;
      pendingProductionOrders.push({
        id: order.id,
        code: order.code,
        productCode: usingSnapshot ? order.productCode! : order.product.code,
        productName: usingSnapshot ? order.productName! : order.product.name,
      });
      continue;
    }
    requirementRows.push(...order.requirements);
    for (const requirement of order.requirements) {
      orderByRequirement.set(requirement.id, order);
    }
  }

  if (requirementRows.length === 0) {
    return { customerOrderId, rows: [], customerSuppliedRows: [], pendingProductionOrders };
  }

  const requirementIds = requirementRows.map((requirement) => requirement.id);
  const [consumedRows, reservationLines] = await Promise.all([
    prisma.productionConsumption.groupBy({
      by: ["productionOrderRequirementId"],
      where: { productionOrderRequirementId: { in: requirementIds } },
      _sum: { quantity: true },
    }),
    prisma.materialReservationLine.findMany({
      where: {
        productionOrderRequirementId: { in: requirementIds },
        releasedAt: null,
        reservation: { status: "ACTIVE" },
      },
      select: { id: true, productionOrderRequirementId: true, quantity: true },
    }),
  ]);

  const consumedByRequirement = new Map<string, Prisma.Decimal>();
  for (const row of consumedRows) {
    consumedByRequirement.set(row.productionOrderRequirementId, row._sum.quantity ?? new Prisma.Decimal(0));
  }

  // "Reserva propria da OP" — mesma logica de remainingReservedQuantity ja
  // usada na leitura da OP (liquida do que ja foi efetivamente consumido).
  const consumedByLine = await getConsumedByReservationLines(prisma, reservationLines.map((line) => line.id));
  const ownReservedByRequirement = new Map<string, Prisma.Decimal>();
  for (const line of reservationLines) {
    const consumed = consumedByLine.get(line.id) ?? new Prisma.Decimal(0);
    const remaining = Prisma.Decimal.max(line.quantity.minus(consumed), 0);
    const current = ownReservedByRequirement.get(line.productionOrderRequirementId) ?? new Prisma.Decimal(0);
    ownReservedByRequirement.set(line.productionOrderRequirementId, current.plus(remaining));
  }

  // Agrega por Item — o mesmo material pode aparecer em mais de uma
  // OP/Product deste Pedido (§8). Material do cliente e agregado a parte:
  // ele nunca pode virar sugestao de compra da Veridi.
  interface AggregatedRow {
    itemCode: string;
    itemName: string;
    unitCode: string;
    remainingRequired: Prisma.Decimal;
    ownReserved: Prisma.Decimal;
    customerId: string | null;
    customerName: string | null;
  }
  const aggregated = new Map<string, AggregatedRow>();
  const customerSupplied = new Map<string, AggregatedRow>();

  for (const requirement of requirementRows) {
    const consumed = consumedByRequirement.get(requirement.id) ?? new Prisma.Decimal(0);
    const remainingRequired = Prisma.Decimal.max(requirement.requiredQuantity.minus(consumed), 0);
    const ownReserved = ownReservedByRequirement.get(requirement.id) ?? new Prisma.Decimal(0);
    const isCustomerSupplied = requirement.supplyResponsibility === "CUSTOMER";
    const bucket = isCustomerSupplied ? customerSupplied : aggregated;
    const order = orderByRequirement.get(requirement.id);

    const current = bucket.get(requirement.itemId) ?? {
      itemCode: requirement.itemCode,
      itemName: requirement.itemName,
      unitCode: requirement.stockUnitCode,
      remainingRequired: new Prisma.Decimal(0),
      ownReserved: new Prisma.Decimal(0),
      customerId: isCustomerSupplied ? (order?.customerId ?? null) : null,
      customerName: isCustomerSupplied
        ? (order?.customer?.legalName ?? order?.customerName ?? null)
        : null,
    };
    current.remainingRequired = current.remainingRequired.plus(remainingRequired);
    current.ownReserved = current.ownReserved.plus(ownReserved);
    bucket.set(requirement.itemId, current);
  }

  const itemIds = [...aggregated.keys()];
  const [globalReservedByItem, availableByItem, onOrderByItem, draftQuantityByItem] = await Promise.all([
    getReservedByItems(prisma, itemIds),
    getAvailableByItems(prisma, await itemScopesFor(prisma, itemIds)),
    getOnOrderByItems(prisma, itemIds),
    computeDraftPurchaseQuantityByItem(prisma, customerOrderId, itemIds),
  ]);

  const rows: PurchaseSuggestionRowDTO[] = itemIds.map((itemId) => {
    const info = aggregated.get(itemId)!;
    const globalReserved = globalReservedByItem.get(itemId) ?? new Prisma.Decimal(0);
    // Available global ja e liquido de TODAS as reservas (inclusive a
    // propria) — somamos ownReserved de volta como cobertura ja garantida
    // desta necessidade (§6), nunca tratando-a como indisponivel para si
    // mesma.
    const available = availableByItem.get(itemId) ?? new Prisma.Decimal(0);
    const onOrder = onOrderByItem.get(itemId) ?? new Prisma.Decimal(0);
    const draftPurchaseQuantity = draftQuantityByItem.get(itemId) ?? new Prisma.Decimal(0);

    const operationalShortage = Prisma.Decimal.max(
      info.remainingRequired.minus(info.ownReserved).minus(available),
      0,
    );
    // On Order nunca reduz a falta fisica — so a recomendacao de compra
    // adicional (§10-11).
    const suggestedAdditionalPurchase = Prisma.Decimal.max(operationalShortage.minus(onOrder), 0);
    const newSuggestedPurchase = Prisma.Decimal.max(suggestedAdditionalPurchase.minus(draftPurchaseQuantity), 0);

    return {
      itemId,
      itemCode: info.itemCode,
      itemName: info.itemName,
      unitCode: info.unitCode,
      remainingRequired: info.remainingRequired.toString(),
      ownReserved: info.ownReserved.toString(),
      globalReserved: globalReserved.toString(),
      available: available.toString(),
      onOrder: onOrder.toString(),
      operationalShortage: operationalShortage.toString(),
      draftPurchaseQuantity: draftPurchaseQuantity.toString(),
      suggestedAdditionalPurchase: suggestedAdditionalPurchase.toString(),
      newSuggestedPurchase: newSuggestedPurchase.toString(),
    };
  });

  const customerSuppliedRows = await buildCustomerSuppliedRows(prisma, customerSupplied);

  return { customerOrderId, rows, customerSuppliedRows, pendingProductionOrders };
}

/**
 * Linhas de material do cliente. Disponibilidade vem SO do estoque daquele
 * cliente — estoque Veridi e estoque de outro cliente nunca reduzem a
 * falta. Falta aqui nao gera Ordem de Compra: e "aguardando material do
 * cliente".
 */
async function buildCustomerSuppliedRows(
  prisma: PrismaOrTx,
  aggregated: Map<
    string,
    {
      itemCode: string;
      itemName: string;
      unitCode: string;
      remainingRequired: Prisma.Decimal;
      ownReserved: Prisma.Decimal;
      customerId: string | null;
      customerName: string | null;
    }
  >,
): Promise<CustomerSuppliedMaterialRowDTO[]> {
  const rows: CustomerSuppliedMaterialRowDTO[] = [];
  for (const [itemId, info] of aggregated) {
    const available = info.customerId
      ? ((
          await getAvailableByItems(prisma, await itemScopesFor(prisma, [itemId]), {
            ownerType: "CUSTOMER",
            customerId: info.customerId,
          })
        ).get(itemId) ?? new Prisma.Decimal(0))
      : new Prisma.Decimal(0);

    rows.push({
      itemId,
      itemCode: info.itemCode,
      itemName: info.itemName,
      unitCode: info.unitCode,
      customerId: info.customerId,
      customerName: info.customerName,
      remainingRequired: info.remainingRequired.toString(),
      ownReserved: info.ownReserved.toString(),
      available: available.toString(),
      shortage: Prisma.Decimal.max(
        info.remainingRequired.minus(info.ownReserved).minus(available),
        0,
      ).toString(),
    });
  }
  return rows;
}

export async function getPurchaseSuggestion(customerOrderId: string): Promise<PurchaseSuggestionDTO> {
  const prisma = getPrisma();
  const order = await prisma.customerOrder.findUnique({ where: { id: customerOrderId } });
  if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
  if (order.status !== "IN_FULFILLMENT") {
    throw new CustomerOrderNotInFulfillmentError(
      "Sugestão de Compra só está disponível para pedidos em atendimento.",
    );
  }
  return buildPurchaseSuggestion(prisma, customerOrderId);
}

/** Mesma regra de `assertSupplierActive`, so que sob a transacao ja travada. */
async function assertSupplierActiveInTx(tx: Prisma.TransactionClient, id: string): Promise<Supplier> {
  const supplier = await tx.supplier.findUnique({ where: { id } });
  if (!supplier) throw new SupplierNotFoundError(id);
  if (!supplier.active) throw new InactiveSupplierError(id);
  return supplier;
}

/** Mesma regra de `assertLineItemValid`, so que sob a transacao ja travada. */
async function assertLineItemValidInTx(tx: Prisma.TransactionClient, id: string): Promise<Item> {
  const item = await tx.item.findUnique({ where: { id } });
  if (!item) throw new LineItemNotFoundError(id);
  if (item.type !== "RAW_MATERIAL" && item.type !== "PACKAGING") {
    throw new InvalidLineItemTypeError(id);
  }
  if (!item.active) throw new InactiveLineItemError(id);
  return item;
}

/**
 * Gera OC(s) DRAFT agrupadas por Supplier (§21). Nunca confia em
 * shortage/available enviado pelo client — só usa `itemId`/`supplierId`/
 * `quantity` do payload, revalidando tudo sob lock do CustomerOrder
 * (serializa duas gerações concorrentes — §26). Nunca cria OC `ORDERED`.
 */
export async function generatePurchaseDrafts(
  customerOrderId: string,
  input: GeneratePurchaseDraftsInput,
): Promise<CustomerOrderDTO> {
  const nonZeroLines = input.lines.filter((line) => new Prisma.Decimal(line.quantity).greaterThan(0));
  if (nonZeroLines.length === 0) throw new EmptyPurchaseDraftsError();

  const prisma = getPrisma();

  // Codigos de OC gerados fora da transacao — mesmo padrao ja usado em
  // Recebimento/OC/OP/Plano de Atendimento. Uma OC no maximo por Supplier
  // distinto do payload.
  const supplierIds = [...new Set(nonZeroLines.map((line) => line.supplierId))];
  const purchaseOrderCodes = new Map<string, string>();
  for (const supplierId of supplierIds) {
    purchaseOrderCodes.set(
      supplierId,
      await nextSequenceCode(prisma, PURCHASE_ORDER_CODE_SEQUENCE, PURCHASE_ORDER_CODE_PREFIX),
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${customerOrderId} FOR UPDATE`;

    const order = await tx.customerOrder.findUnique({ where: { id: customerOrderId } });
    if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
    if (order.status !== "IN_FULFILLMENT") {
      throw new CustomerOrderNotInFulfillmentError(
        "Só é possível gerar Ordens de Compra para um pedido em atendimento.",
      );
    }

    // Material do cliente nunca vira compra da Veridi, mesmo que o payload
    // peca — a decisao e do dominio, nao da tela.
    const itemIds = [...new Set(nonZeroLines.map((line) => line.itemId))];
    const customerSuppliedRequirements = await tx.productionOrderRequirement.findMany({
      where: {
        itemId: { in: itemIds },
        supplyResponsibility: "CUSTOMER",
        productionOrder: { customerOrderId, status: { notIn: ["CANCELLED", "COMPLETED"] } },
      },
      select: { itemId: true, itemCode: true },
    });
    const veridiRequirementItems = new Set(
      (
        await tx.productionOrderRequirement.findMany({
          where: {
            itemId: { in: itemIds },
            supplyResponsibility: "VERIDI",
            productionOrder: { customerOrderId, status: { notIn: ["CANCELLED", "COMPLETED"] } },
          },
          select: { itemId: true },
        })
      ).map((requirement) => requirement.itemId),
    );
    for (const requirement of customerSuppliedRequirements) {
      if (!veridiRequirementItems.has(requirement.itemId)) {
        throw new CustomerSuppliedItemPurchaseError(requirement.itemCode);
      }
    }

    // Trava os Suppliers envolvidos em ordem deterministica — mesmo
    // padrao de concorrencia do RELEASE de OP/Aplicar Plano.
    const sortedSupplierIds = [...supplierIds].sort();
    await tx.$queryRaw`SELECT id FROM suppliers WHERE id IN (${Prisma.join(sortedSupplierIds)}) ORDER BY id FOR UPDATE`;

    const linesBySupplier = new Map<string, { itemId: string; quantity: Prisma.Decimal }[]>();
    for (const line of nonZeroLines) {
      const list = linesBySupplier.get(line.supplierId) ?? [];
      list.push({ itemId: line.itemId, quantity: new Prisma.Decimal(line.quantity) });
      linesBySupplier.set(line.supplierId, list);
    }

    for (const [supplierId, lines] of linesBySupplier) {
      const supplier = await assertSupplierActiveInTx(tx, supplierId);

      const validatedLines: { item: Item; orderedQuantity: Prisma.Decimal }[] = [];
      for (const line of lines) {
        const item = await assertLineItemValidInTx(tx, line.itemId);
        validatedLines.push({ item, orderedQuantity: line.quantity });
      }

      await createDraftPurchaseOrderInTx(tx, {
        code: purchaseOrderCodes.get(supplierId)!,
        supplier,
        orderDate: new Date(),
        customerOrderId,
        lines: validatedLines,
      });
    }
  });

  return (await getCustomerOrderById(customerOrderId))!;
}
