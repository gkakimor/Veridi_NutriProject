import type { Customer, CustomerOrder, CustomerOrderLine, CustomerOrderReservation, CustomerOrderReservationLine, Item, Product, ProductionOrder } from "@prisma/client";
import type {
  CustomerOrderDTO,
  CustomerOrderGeneratedProductionOrderDTO,
  CustomerOrderLineDTO,
  CustomerOrderListResponse,
  CustomerOrderReservationDTO,
  CustomerOrderReservationLineDTO,
} from "@veridi/shared";
import { CUSTOMER_ORDER_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  CancellationBlockedError,
  CustomerNotFoundError,
  CustomerOrderNotFoundError,
  DuplicateLineProductError,
  EmptyOrderError,
  InactiveCustomerError,
  InactiveLineProductError,
  InvalidTransitionError,
  LineProductNotFoundError,
  MissingFinishedItemError,
  OrderLockedError,
} from "./customer-orders.errors.js";
import type {
  CreateCustomerOrderInput,
  CustomerOrderLineInput,
  ListCustomerOrdersQuery,
  UpdateCustomerOrderInput,
} from "./customer-orders.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";
const CODE_SEQUENCE = "customer_order_code_seq";

type ProductWithFinishedItem = Product & { finishedProductItem: Item | null };
type LineWithProduct = CustomerOrderLine & { product: ProductWithFinishedItem };
type ReservationLineWithRelations = CustomerOrderReservationLine & { product: Product; item: Item; lot: { code: string; businessLotNumber: string | null } | null };
type ReservationWithLines = CustomerOrderReservation & { lines: ReservationLineWithRelations[] };
type GeneratedOrder = ProductionOrder & { product: Product };
type OrderWithRelations = CustomerOrder & {
  customer: Customer;
  lines: LineWithProduct[];
  reservations: ReservationWithLines[];
  productionOrders: GeneratedOrder[];
};

const customerOrderInclude = {
  customer: true,
  lines: { include: { product: { include: { finishedProductItem: true } } }, orderBy: { position: "asc" as const } },
  reservations: {
    include: { lines: { include: { product: true, item: true, lot: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  productionOrders: { include: { product: true }, orderBy: { createdAt: "asc" as const } },
} as const;

function toLineDTO(line: LineWithProduct): CustomerOrderLineDTO {
  const usingSnapshot = line.productCode !== null;
  return {
    id: line.id,
    productId: line.productId,
    productCode: usingSnapshot ? line.productCode! : line.product.code,
    productName: usingSnapshot ? line.productName! : line.product.name,
    finishedItemId: usingSnapshot ? line.finishedItemId : (line.product.finishedProductItem?.id ?? null),
    finishedItemCode: usingSnapshot ? line.finishedItemCode : (line.product.finishedProductItem?.code ?? null),
    finishedItemName: usingSnapshot ? line.finishedItemName : (line.product.finishedProductItem?.name ?? null),
    orderedQuantity: line.orderedQuantity.toString(),
    unitCode: line.unitCode,
    position: line.position,
  };
}

function toReservationLineDTO(line: ReservationLineWithRelations): CustomerOrderReservationLineDTO {
  return {
    id: line.id,
    customerOrderLineId: line.customerOrderLineId,
    productId: line.productId,
    productCode: line.product.code,
    productName: line.product.name,
    itemId: line.itemId,
    lotId: line.lotId,
    lotCode: line.lot ? line.lot.code : null,
    businessLotNumber: line.lot ? line.lot.businessLotNumber : null,
    quantity: line.quantity.toString(),
    unitCode: line.item.unitCode,
  };
}

function toReservationDTO(reservation: ReservationWithLines): CustomerOrderReservationDTO {
  return {
    id: reservation.id,
    status: reservation.status,
    createdAt: reservation.createdAt.toISOString(),
    createdBy: reservation.createdBy,
    releasedAt: reservation.releasedAt ? reservation.releasedAt.toISOString() : null,
    releasedBy: reservation.releasedBy,
    releaseReason: reservation.releaseReason,
    lines: reservation.lines.map(toReservationLineDTO),
  };
}

function toGeneratedProductionOrderDTO(order: GeneratedOrder): CustomerOrderGeneratedProductionOrderDTO {
  const usingSnapshot = order.productCode !== null;
  return {
    id: order.id,
    code: order.code,
    productId: order.productId,
    productCode: usingSnapshot ? order.productCode! : order.product.code,
    productName: usingSnapshot ? order.productName! : order.product.name,
    customerOrderLineId: order.customerOrderLineId!,
    plannedQuantity: order.plannedQuantity.toString(),
    outputUnitCode: order.outputUnitCode,
    status: order.status,
  };
}

function toCustomerOrderDTO(order: OrderWithRelations): CustomerOrderDTO {
  const usingSnapshot = order.customerCode !== null;
  // No maximo uma reserva e criada por Pedido nesta fase (nunca reaplica o
  // Plano) — a primeira (e unica) e a que importa.
  const reservation = order.reservations[0] ?? null;

  return {
    id: order.id,
    code: order.code,
    customerId: order.customerId,
    customerCode: usingSnapshot ? order.customerCode : order.customer.code,
    customerName: usingSnapshot ? order.customerName : order.customer.legalName,
    customerTradeName: usingSnapshot ? order.customerTradeName : order.customer.tradeName,
    customerCnpj: usingSnapshot ? order.customerCnpj : order.customer.cnpj,
    orderDate: order.orderDate.toISOString(),
    requestedDeliveryDate: order.requestedDeliveryDate ? order.requestedDeliveryDate.toISOString() : null,
    status: order.status,
    notes: order.notes,
    lines: order.lines.map(toLineDTO),
    reservation: reservation ? toReservationDTO(reservation) : null,
    generatedProductionOrders: order.productionOrders.map(toGeneratedProductionOrderDTO),
    confirmedAt: order.confirmedAt ? order.confirmedAt.toISOString() : null,
    confirmedBy: order.confirmedBy,
    cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    cancelledBy: order.cancelledBy,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt.toISOString(),
    createdBy: order.createdBy,
    updatedAt: order.updatedAt.toISOString(),
  };
}

async function assertCustomerActive(id: string): Promise<Customer> {
  const customer = await getPrisma().customer.findUnique({ where: { id } });
  if (!customer) throw new CustomerNotFoundError(id);
  if (!customer.active) throw new InactiveCustomerError(id);
  return customer;
}

/** Produto de linha: precisa existir, estar ativo e ter Finished Product Item valido/ativo. */
async function assertLineProductValid(id: string): Promise<ProductWithFinishedItem> {
  const product = await getPrisma().product.findUnique({
    where: { id },
    include: { finishedProductItem: true },
  });
  if (!product) throw new LineProductNotFoundError(id);
  if (!product.active) throw new InactiveLineProductError(id);
  if (
    !product.finishedProductItemId ||
    !product.finishedProductItem ||
    product.finishedProductItem.type !== "FINISHED_PRODUCT" ||
    !product.finishedProductItem.active
  ) {
    throw new MissingFinishedItemError(id);
  }
  return product;
}

interface ValidatedLine {
  input: CustomerOrderLineInput;
  product: ProductWithFinishedItem;
}

/** Valida duplicidade dentro do array e cada produto individualmente. */
async function validateLines(lines: CustomerOrderLineInput[]): Promise<ValidatedLine[]> {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.productId)) throw new DuplicateLineProductError(line.productId);
    seen.add(line.productId);
  }

  const validated: ValidatedLine[] = [];
  for (const line of lines) {
    const product = await assertLineProductValid(line.productId);
    validated.push({ input: line, product });
  }
  return validated;
}

function lineCreateData(customerOrderId: string, validated: ValidatedLine, position: number) {
  return {
    customerOrderId,
    productId: validated.product.id,
    orderedQuantity: validated.input.orderedQuantity,
    unitCode: validated.product.finishedProductItem!.unitCode,
    position,
  };
}

async function requireOrder(id: string): Promise<OrderWithRelations> {
  const order = await getPrisma().customerOrder.findUnique({ where: { id }, include: customerOrderInclude });
  if (!order) throw new CustomerOrderNotFoundError(id);
  return order;
}

export async function listCustomerOrders(query: ListCustomerOrdersQuery): Promise<CustomerOrderListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.status) where["status"] = query.status;
  if (query.customerId) where["customerId"] = query.customerId;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { customerName: { contains: query.search, mode: "insensitive" } },
      { customer: { is: { legalName: { contains: query.search, mode: "insensitive" } } } },
      { customer: { is: { code: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.customerOrder.findMany({
      where,
      include: customerOrderInclude,
      orderBy: { code: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.customerOrder.count({ where }),
  ]);

  return {
    customerOrders: orders.map(toCustomerOrderDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getCustomerOrderById(id: string): Promise<CustomerOrderDTO | null> {
  const order = await getPrisma().customerOrder.findUnique({ where: { id }, include: customerOrderInclude });
  return order ? toCustomerOrderDTO(order) : null;
}

export async function createCustomerOrder(input: CreateCustomerOrderInput): Promise<CustomerOrderDTO> {
  const customer = await assertCustomerActive(input.customerId);
  const validatedLines = input.lines ? await validateLines(input.lines) : [];

  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, CUSTOMER_ORDER_CODE_PREFIX);

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.create({
      data: {
        code,
        customerId: customer.id,
        ...(input.requestedDeliveryDate !== undefined
          ? { requestedDeliveryDate: input.requestedDeliveryDate }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdBy: SYSTEM_ACTOR,
      },
    });

    if (validatedLines.length > 0) {
      await tx.customerOrderLine.createMany({
        data: validatedLines.map((line, index) => lineCreateData(order.id, line, index)),
      });
    }

    return order;
  });

  return (await getCustomerOrderById(created.id))!;
}

export async function updateCustomerOrder(
  id: string,
  input: UpdateCustomerOrderInput,
): Promise<CustomerOrderDTO> {
  const current = await requireOrder(id);

  const touchesLockedFields = input.customerId !== undefined || input.lines !== undefined;
  const touchesAnyField =
    touchesLockedFields || input.requestedDeliveryDate !== undefined || input.notes !== undefined;

  if (current.status === "CANCELLED" || current.status === "IN_FULFILLMENT") {
    if (touchesAnyField) {
      throw new OrderLockedError(
        current.status === "CANCELLED"
          ? "Pedido cancelado é somente leitura."
          : "Pedido em atendimento é somente leitura — produtos e reservas já foram aplicados.",
      );
    }
  } else if (current.status !== "DRAFT" && touchesLockedFields) {
    throw new OrderLockedError(
      "Após confirmado, o pedido só permite alterar previsão de entrega e observações.",
    );
  }

  let customer: Customer | null = null;
  if (current.status === "DRAFT" && input.customerId !== undefined) {
    customer = await assertCustomerActive(input.customerId);
  }

  let validatedLines: ValidatedLine[] | null = null;
  if (current.status === "DRAFT" && input.lines !== undefined) {
    validatedLines = await validateLines(input.lines);
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.customerOrder.update({
      where: { id },
      data: {
        ...(customer ? { customerId: customer.id } : {}),
        ...(input.requestedDeliveryDate !== undefined
          ? { requestedDeliveryDate: input.requestedDeliveryDate }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (validatedLines !== null) {
      await tx.customerOrderLine.deleteMany({ where: { customerOrderId: id } });
      if (validatedLines.length > 0) {
        await tx.customerOrderLine.createMany({
          data: validatedLines.map((line, index) => lineCreateData(id, line, index)),
        });
      }
    }
  });

  return (await getCustomerOrderById(id))!;
}

/**
 * DRAFT -> CONFIRMED: revalida cliente/produtos no momento da confirmacao
 * (nunca confia so na validacao de saves anteriores) e congela snapshot
 * historico no Pedido e em cada linha. Nunca reserva estoque — so habilita
 * o Plano de Atendimento.
 */
export async function confirmCustomerOrder(id: string): Promise<CustomerOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    const current = await tx.customerOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!current) throw new CustomerOrderNotFoundError(id);
    if (current.status !== "DRAFT") {
      throw new InvalidTransitionError("Somente rascunhos podem ser confirmados.");
    }
    if (current.lines.length === 0) throw new EmptyOrderError();

    const customer = await tx.customer.findUnique({ where: { id: current.customerId } });
    if (!customer) throw new CustomerNotFoundError(current.customerId);
    if (!customer.active) throw new InactiveCustomerError(current.customerId);

    const seen = new Set<string>();
    for (const line of current.lines) {
      if (seen.has(line.productId)) throw new DuplicateLineProductError(line.productId);
      seen.add(line.productId);
    }

    const productByLineId = new Map<string, ProductWithFinishedItem>();
    for (const line of current.lines) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
        include: { finishedProductItem: true },
      });
      if (!product) throw new LineProductNotFoundError(line.productId);
      if (!product.active) throw new InactiveLineProductError(line.productId);
      if (
        !product.finishedProductItemId ||
        !product.finishedProductItem ||
        product.finishedProductItem.type !== "FINISHED_PRODUCT" ||
        !product.finishedProductItem.active
      ) {
        throw new MissingFinishedItemError(line.productId);
      }
      productByLineId.set(line.id, product);
    }

    await tx.customerOrder.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        confirmedBy: SYSTEM_ACTOR,
        customerCode: customer.code,
        customerName: customer.legalName,
        customerTradeName: customer.tradeName,
        customerCnpj: customer.cnpj,
      },
    });

    for (const line of current.lines) {
      const product = productByLineId.get(line.id)!;
      await tx.customerOrderLine.update({
        where: { id: line.id },
        data: {
          productCode: product.code,
          productName: product.name,
          finishedItemId: product.finishedProductItem!.id,
          finishedItemCode: product.finishedProductItem!.code,
          finishedItemName: product.finishedProductItem!.name,
        },
      });
    }
  });

  return (await getCustomerOrderById(id))!;
}

/**
 * DRAFT/CONFIRMED podem cancelar livremente. IN_FULFILLMENT so cancela se
 * nao houver Finished Goods Reservation ACTIVE nem OP gerada — ja existem
 * compromissos operacionais, resolver as dependencias primeiro (nunca
 * cancela/libera nada em cascata automaticamente).
 */
export async function cancelCustomerOrder(id: string, reason: string): Promise<CustomerOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    const current = await tx.customerOrder.findUnique({ where: { id } });
    if (!current) throw new CustomerOrderNotFoundError(id);
    if (current.status === "CANCELLED") {
      throw new InvalidTransitionError("Pedido já está cancelado.");
    }

    if (current.status === "IN_FULFILLMENT") {
      const [activeReservation, generatedOrderCount] = await Promise.all([
        tx.customerOrderReservation.findFirst({ where: { customerOrderId: id, status: "ACTIVE" } }),
        tx.productionOrder.count({ where: { customerOrderId: id } }),
      ]);
      if (activeReservation || generatedOrderCount > 0) {
        throw new CancellationBlockedError(
          "Pedido em atendimento possui reserva de produto acabado e/ou Ordens de Produção geradas — resolva essas dependências antes de cancelar.",
        );
      }
    }

    await tx.customerOrder.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: SYSTEM_ACTOR,
        cancelReason: reason,
      },
    });
  });

  return (await getCustomerOrderById(id))!;
}
