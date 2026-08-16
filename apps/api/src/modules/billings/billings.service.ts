import { Prisma } from "@prisma/client";
import type { Billing, BillingLine, PrismaClient } from "@prisma/client";
import type {
  AwaitingBillingListResponse,
  AwaitingBillingRowDTO,
  BillingDTO,
  BillingLineDTO,
  BillingListResponse,
  ShipmentBillingStatus,
} from "@veridi/shared";
import { BILLING_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  ActiveBillingAlreadyExistsError,
  BillingLineNotFoundError,
  BillingNotDraftError,
  BillingNotFoundError,
  EmptyShipmentForBillingError,
  ShipmentNotBillableError,
} from "./billings.errors.js";
import type { ListBillingsQuery, UpdateBillingInput } from "./billings.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";
const CODE_SEQUENCE = "billing_code_seq";

/** Um Billing "ativo" ocupa a vaga da Expedicao; CANCELLED libera a vaga. */
const ACTIVE_BILLING_STATUSES = ["DRAFT", "ISSUED"] as const;

type BillingWithLines = Billing & { lines: BillingLine[]; customerOrder: { customerId: string } };

const billingInclude = {
  lines: { orderBy: { position: "asc" as const } },
  customerOrder: { select: { customerId: true } },
} as const;

/** Dinheiro (BRL) sempre com 2 casas decimais na saida da API. */
function formatMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function toBillingLineDTO(line: BillingLine): BillingLineDTO {
  const lineTotal = line.unitPrice ? line.quantity.times(line.unitPrice) : null;
  return {
    id: line.id,
    shipmentLineId: line.shipmentLineId,
    customerOrderLineId: line.customerOrderLineId,
    productId: line.productId,
    productCode: line.productCode,
    productName: line.productName,
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    lotId: line.lotId,
    lotCode: line.lotCode,
    businessLotNumber: line.businessLotNumber,
    quantity: line.quantity.toString(),
    unitCode: line.unitCode,
    unitPrice: line.unitPrice ? formatMoney(line.unitPrice) : null,
    lineTotal: lineTotal ? formatMoney(lineTotal) : null,
    position: line.position,
  };
}

/**
 * Valor total so existe quando TODAS as linhas tem preco — somar apenas
 * algumas e apresentar como total do documento seria enganoso. Essa
 * semantica e o que permitira ao futuro Dashboard separar "quantidade
 * faturada" (sempre confiavel) de "valor faturado" (so com pricing
 * completo).
 */
function toBillingDTO(billing: BillingWithLines): BillingDTO {
  const totalQuantity = billing.lines.reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));
  const hasCompletePricing = billing.lines.length > 0 && billing.lines.every((line) => line.unitPrice !== null);
  const totalAmount = hasCompletePricing
    ? billing.lines.reduce((sum, line) => sum.plus(line.quantity.times(line.unitPrice!)), new Prisma.Decimal(0))
    : null;

  return {
    id: billing.id,
    code: billing.code,
    customerOrderId: billing.customerOrderId,
    customerOrderCode: billing.customerOrderCode ?? "",
    shipmentId: billing.shipmentId,
    shipmentCode: billing.shipmentCode ?? "",
    shipmentDate: billing.shipmentDate ? billing.shipmentDate.toISOString() : null,
    customerId: billing.customerOrder.customerId,
    customerCode: billing.customerCode,
    customerName: billing.customerName,
    customerTradeName: billing.customerTradeName,
    customerCnpj: billing.customerCnpj,
    status: billing.status,
    externalReference: billing.externalReference,
    notes: billing.notes,
    lines: billing.lines.map(toBillingLineDTO),
    totalQuantity: totalQuantity.toString(),
    totalAmount: totalAmount ? formatMoney(totalAmount) : null,
    hasCompletePricing,
    issuedAt: billing.issuedAt ? billing.issuedAt.toISOString() : null,
    issuedBy: billing.issuedBy,
    cancelledAt: billing.cancelledAt ? billing.cancelledAt.toISOString() : null,
    cancelledBy: billing.cancelledBy,
    cancelReason: billing.cancelReason,
    createdAt: billing.createdAt.toISOString(),
    createdBy: billing.createdBy,
    updatedAt: billing.updatedAt.toISOString(),
  };
}

/**
 * Faturado por CustomerOrderLine — soma das BillingLine de Faturamentos
 * ISSUED. DRAFT e CANCELLED nunca contam. Sempre derivado, nunca uma coluna
 * mutavel na linha do Pedido.
 */
export async function getBilledByOrderLines(
  prisma: PrismaOrTx,
  customerOrderLineIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (customerOrderLineIds.length === 0) return new Map();
  const grouped = await prisma.billingLine.groupBy({
    by: ["customerOrderLineId"],
    where: {
      customerOrderLineId: { in: customerOrderLineIds },
      billing: { status: "ISSUED" },
    },
    _sum: { quantity: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const row of grouped) {
    map.set(row.customerOrderLineId, row._sum.quantity ?? new Prisma.Decimal(0));
  }
  return map;
}

/** Estado de faturamento derivado de cada Expedicao — CANCELLED nunca conta. */
export async function getBillingStatusByShipments(
  prisma: PrismaOrTx,
  shipmentIds: string[],
): Promise<Map<string, { status: ShipmentBillingStatus; billingId: string | null; billingCode: string | null }>> {
  const map = new Map<
    string,
    { status: ShipmentBillingStatus; billingId: string | null; billingCode: string | null }
  >();
  if (shipmentIds.length === 0) return map;

  const billings = await prisma.billing.findMany({
    where: { shipmentId: { in: shipmentIds }, status: { in: [...ACTIVE_BILLING_STATUSES] } },
    select: { id: true, code: true, shipmentId: true, status: true },
  });
  for (const shipmentId of shipmentIds) {
    map.set(shipmentId, { status: "PENDING", billingId: null, billingCode: null });
  }
  for (const billing of billings) {
    map.set(billing.shipmentId, {
      status: billing.status === "ISSUED" ? "ISSUED" : "DRAFT",
      billingId: billing.id,
      billingCode: billing.code,
    });
  }
  return map;
}

export async function listBillings(
  query: ListBillingsQuery,
  pagination: Pagination = query,): Promise<BillingListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.status) where["status"] = query.status;
  if (query.customerOrderId) where["customerOrderId"] = query.customerOrderId;
  if (query.shipmentId) where["shipmentId"] = query.shipmentId;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { customerOrderCode: { contains: query.search, mode: "insensitive" } },
      { shipmentCode: { contains: query.search, mode: "insensitive" } },
      { customerName: { contains: query.search, mode: "insensitive" } },
      { externalReference: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [billings, total] = await Promise.all([
    prisma.billing.findMany({
      where,
      include: billingInclude,
      orderBy: { code: "desc" },
      ...pageArgs(pagination),
    }),
    prisma.billing.count({ where }),
  ]);

  return {
    billings: billings.map(toBillingDTO),
    ...pageMeta(pagination, total),
  };
}

export async function getBillingById(id: string): Promise<BillingDTO | null> {
  const billing = await getPrisma().billing.findUnique({ where: { id }, include: billingInclude });
  return billing ? toBillingDTO(billing) : null;
}

/**
 * Read model de "Aguardando faturamento" — Expedicoes CONFIRMED sem
 * Billing ISSUED (inclui as que ja tem DRAFT, diferenciadas por
 * `billingStatus`). Base direta do futuro relatorio R-16 e do Dashboard,
 * sem nenhuma tabela agregada.
 */
export async function listAwaitingBilling(): Promise<AwaitingBillingListResponse> {
  const prisma = getPrisma();
  const shipments = await prisma.shipment.findMany({
    where: {
      status: "CONFIRMED",
      // Nenhum Billing ISSUED — DRAFT ainda aparece (em preparação).
      billings: { none: { status: "ISSUED" } },
    },
    include: { lines: true, customerOrder: { include: { customer: true } } },
    orderBy: { shipmentDate: "asc" },
  });

  const billingStatusByShipment = await getBillingStatusByShipments(
    prisma,
    shipments.map((shipment) => shipment.id),
  );

  const rows: AwaitingBillingRowDTO[] = shipments.map((shipment) => {
    const totalQuantity = shipment.lines.reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));
    const billingInfo = billingStatusByShipment.get(shipment.id)!;
    return {
      shipmentId: shipment.id,
      shipmentCode: shipment.code,
      shipmentDate: shipment.shipmentDate ? shipment.shipmentDate.toISOString() : null,
      customerOrderId: shipment.customerOrderId,
      customerOrderCode: shipment.customerOrder.code,
      customerName: shipment.customerOrder.customerName ?? shipment.customerOrder.customer.legalName,
      totalQuantity: totalQuantity.toString(),
      billingStatus: billingInfo.status,
      billingId: billingInfo.billingId,
      billingCode: billingInfo.billingCode,
    };
  });

  return { rows };
}

/**
 * Cria o Billing DRAFT copiando fielmente as linhas da Expedicao
 * CONFIRMED. Nunca altera estoque, Expedicao ou Pedido. No maximo um
 * Billing ativo por Expedicao (validado sob lock + indice unico parcial no
 * banco). A quantidade vem SEMPRE da ShipmentLine — nunca recalculada a
 * partir do Pedido, nunca editavel depois.
 */
export async function createBilling(shipmentId: string): Promise<BillingDTO> {
  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, BILLING_CODE_PREFIX);

  const billingId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${shipmentId} FOR UPDATE`;

    const shipment = await tx.shipment.findUnique({
      where: { id: shipmentId },
      include: { lines: { orderBy: { position: "asc" } }, customerOrder: { include: { customer: true } } },
    });
    if (!shipment) throw new ShipmentNotBillableError(`Expedição não encontrada: ${shipmentId}`);
    if (shipment.status !== "CONFIRMED") {
      throw new ShipmentNotBillableError(
        "Somente expedições confirmadas podem ser faturadas — a saída física precisa ter acontecido.",
      );
    }

    const existing = await tx.billing.findFirst({
      where: { shipmentId, status: { in: [...ACTIVE_BILLING_STATUSES] } },
    });
    if (existing) throw new ActiveBillingAlreadyExistsError(existing.code);

    if (shipment.lines.length === 0) throw new EmptyShipmentForBillingError();

    const order = shipment.customerOrder;
    const billing = await tx.billing.create({
      data: {
        code,
        customerOrderId: shipment.customerOrderId,
        shipmentId: shipment.id,
        status: "DRAFT",
        customerCode: order.customerCode ?? order.customer.code,
        customerName: order.customerName ?? order.customer.legalName,
        customerTradeName: order.customerTradeName ?? order.customer.tradeName,
        customerCnpj: order.customerCnpj ?? order.customer.cnpj,
        customerOrderCode: order.code,
        shipmentCode: shipment.code,
        shipmentDate: shipment.shipmentDate,
        createdBy: SYSTEM_ACTOR,
      },
    });

    await tx.billingLine.createMany({
      data: shipment.lines.map((line, index) => ({
        billingId: billing.id,
        shipmentLineId: line.id,
        customerOrderLineId: line.customerOrderLineId,
        productId: line.productId,
        itemId: line.itemId,
        lotId: line.lotId,
        // Snapshot da Expedicao (ja congelado na confirmacao dela).
        productCode: line.productCode ?? "",
        productName: line.productName ?? "",
        itemCode: line.finishedItemCode ?? "",
        itemName: line.finishedItemName ?? "",
        lotCode: line.lotCode,
        businessLotNumber: line.businessLotNumber,
        quantity: line.quantity,
        unitCode: line.unitCode,
        unitPrice: null,
        position: index,
      })),
    });

    return billing.id;
  });

  return (await getBillingById(billingId))!;
}

/**
 * Enquanto DRAFT so `unitPrice`/`notes`/`externalReference` sao editaveis.
 * Nunca adiciona/remove linha, nunca muda quantidade/lote/unidade — o
 * Billing representa a Expedicao, nao um documento livre.
 */
export async function updateBilling(id: string, input: UpdateBillingInput): Promise<BillingDTO> {
  await getPrisma().$transaction(async (tx) => {
    const billing = await tx.billing.findUnique({ where: { id }, include: { lines: true } });
    if (!billing) throw new BillingNotFoundError(id);
    if (billing.status !== "DRAFT") {
      throw new BillingNotDraftError(
        "Somente faturamentos em rascunho podem ser editados — um faturamento emitido é histórico.",
      );
    }

    if (input.lines !== undefined) {
      const lineIds = new Set(billing.lines.map((line) => line.id));
      for (const line of input.lines) {
        if (!lineIds.has(line.billingLineId)) throw new BillingLineNotFoundError(line.billingLineId);
        if (line.unitPrice === undefined) continue;

        await tx.billingLine.update({
          where: { id: line.billingLineId },
          data: { unitPrice: line.unitPrice === "" ? null : new Prisma.Decimal(line.unitPrice) },
        });
      }
    }

    await tx.billing.update({
      where: { id },
      data: {
        ...(input.externalReference !== undefined ? { externalReference: input.externalReference } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
  });

  return (await getBillingById(id))!;
}

/**
 * DRAFT -> ISSUED. Preco NUNCA e gate: o MVP precisa suportar faturamento
 * operacional mesmo quando os valores comerciais ainda sao controlados
 * fora do sistema. Nunca altera estoque, Expedicao ou o status do Pedido
 * (o estado de faturamento do Pedido e sempre derivado).
 */
export async function issueBilling(id: string): Promise<BillingDTO> {
  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM billings WHERE id = ${id} FOR UPDATE`;

    const billing = await tx.billing.findUnique({ where: { id }, include: { lines: true } });
    if (!billing) throw new BillingNotFoundError(id);
    if (billing.status !== "DRAFT") {
      throw new BillingNotDraftError("Somente faturamentos em rascunho podem ser emitidos.");
    }
    if (billing.lines.length === 0) throw new EmptyShipmentForBillingError();

    // Revalida a Expedicao no momento da emissao — nunca confia so na
    // validacao feita na criacao do rascunho.
    const shipment = await tx.shipment.findUnique({ where: { id: billing.shipmentId } });
    if (!shipment || shipment.status !== "CONFIRMED") {
      throw new ShipmentNotBillableError(
        "A expedição deste faturamento não está mais confirmada — não é possível emitir.",
      );
    }

    await tx.billing.update({
      where: { id },
      data: { status: "ISSUED", issuedAt: new Date(), issuedBy: SYSTEM_ACTOR },
    });
  });

  return (await getBillingById(id))!;
}

/**
 * DRAFT -> CANCELLED, motivo obrigatorio. Nenhum efeito em estoque,
 * Expedicao ou Pedido — a Expedicao simplesmente volta a aparecer como
 * faturavel e um novo rascunho pode ser criado.
 */
export async function cancelBilling(id: string, reason: string): Promise<BillingDTO> {
  await getPrisma().$transaction(async (tx) => {
    const billing = await tx.billing.findUnique({ where: { id } });
    if (!billing) throw new BillingNotFoundError(id);
    if (billing.status !== "DRAFT") {
      throw new BillingNotDraftError(
        "Somente faturamentos em rascunho podem ser cancelados — um faturamento emitido é histórico nesta fase.",
      );
    }

    await tx.billing.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: SYSTEM_ACTOR,
        cancelReason: reason,
      },
    });
  });

  return (await getBillingById(id))!;
}
