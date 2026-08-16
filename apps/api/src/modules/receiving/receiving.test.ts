import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

const createdPurchaseOrderIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureItemIds: string[] = [];

let supplierId: string;
let rawMaterialItemId: string; // controlsLot=true, controlsExpiry=true, requiresQualityRelease=true (defaults)
let packagingItemId: string; // controlsLot=true, controlsExpiry=false, requiresQualityRelease=false (defaults)
let noLotItemId: string; // controlsLot=false

type App = ReturnType<typeof buildTestApp>;

/** Vencimento futuro generico para linhas de RAW_MATERIAL (controlsExpiry=true). */
const FUTURE_EXPIRY = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

beforeAll(async () => {
  const prisma = getPrisma();

  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: 1000 },
  });
  await prisma.unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: 1 },
  });

  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const supplier = await prisma.supplier.create({
    data: { code: `FOR-REC-${marker}`, legalName: `Fornecedor Recebimento Teste ${marker}` },
  });
  supplierId = supplier.id;
  fixtureSupplierIds.push(supplier.id);

  // prisma.item.create direto NAO aplica ITEM_TYPE_DEFAULTS (isso e feito
  // pelo service) — precisa setar cada flag explicitamente aqui.
  const rawMaterial = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-REC-${marker}`,
      name: `Materia Prima Recebimento Teste ${marker}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
    },
  });
  rawMaterialItemId = rawMaterial.id;
  fixtureItemIds.push(rawMaterial.id);

  const packaging = await prisma.item.create({
    data: {
      type: "PACKAGING",
      code: `ME-REC-${marker}`,
      name: `Embalagem Recebimento Teste ${marker}`,
      unitCode: "un",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  packagingItemId = packaging.id;
  fixtureItemIds.push(packaging.id);

  const noLotItem = await prisma.item.create({
    data: {
      type: "PACKAGING",
      code: `ME-SEMLOTE-${marker}`,
      name: `Embalagem Sem Lote Teste ${marker}`,
      unitCode: "un",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  noLotItemId = noLotItem.id;
  fixtureItemIds.push(noLotItem.id);
});

afterEach(async () => {
  if (createdPurchaseOrderIds.length === 0) return;
  const prisma = getPrisma();

  // Receipt tem FK RESTRICT para PurchaseOrder — precisa limpar na ordem
  // certa: Lots orfaos, depois Receipts (cascata para ReceiptLines), so
  // entao a propria OC (cascata para PurchaseOrderLines).
  const receipts = await prisma.receipt.findMany({
    where: { purchaseOrderId: { in: createdPurchaseOrderIds } },
    include: { lines: { select: { lotId: true } } },
  });
  const lotIds = receipts
    .flatMap((receipt) => receipt.lines.map((line) => line.lotId))
    .filter((lotId): lotId is string => lotId !== null);

  if (receipts.length > 0) {
    await prisma.receipt.deleteMany({ where: { id: { in: receipts.map((r) => r.id) } } });
  }
  if (lotIds.length > 0) {
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
  }

  await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPurchaseOrderIds } } });
  createdPurchaseOrderIds.length = 0;
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

/** Cria uma OC DRAFT com as linhas informadas e confirma (→ ORDERED). */
async function createOrderedPurchaseOrder(
  app: App,
  lines: { itemId: string; orderedQuantity: string }[],
) {
  const created = await app.inject({
    method: "POST",
    url: "/purchase-orders",
    payload: {
      supplierId,
      orderDate: new Date().toISOString(),
      lines,
    },
  });
  createdPurchaseOrderIds.push(created.json().id);

  const confirmed = await app.inject({
    method: "POST",
    url: `/purchase-orders/${created.json().id}/confirm`,
  });

  return confirmed.json();
}

describe("Receiving", () => {
  it("recebe materiais de uma OC ORDERED e gera Receipt + Lot", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "100" },
    ]);
    const poLineId = po.lines[0].id;

    const receiptDate = new Date().toISOString();
    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: receiptDate,
        invoiceNumber: "NF 12345",
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "60",
            supplierLot: "ABC-98765",
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            location: "MP / B / 03",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^REC-\d{6}$/);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].receivedQuantity).toBe("60");
    expect(body.lines[0].lotId).not.toBeNull();
    expect(body.lines[0].lotCode).toMatch(/^LT-\d{8}-\d{6}$/);

    await app.close();
  });

  it("recebimento parcial deixa OC como PARTIALLY_RECEIVED com received/open corretos", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "100" },
    ]);
    const poLineId = po.lines[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "60",
            supplierLot: "LOTE-1",
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    });

    const fetched = await app.inject({ method: "GET", url: `/purchase-orders/${po.id}` });
    expect(fetched.json().status).toBe("PARTIALLY_RECEIVED");
    expect(fetched.json().lines[0].receivedQuantity).toBe("60");
    expect(fetched.json().lines[0].openQuantity).toBe("40");

    await app.close();
  });

  it("múltiplos recebimentos completam a OC e ela vira RECEIVED", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "100" },
    ]);
    const poLineId = po.lines[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "60",
            supplierLot: "LOTE-A",
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    });

    const second = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "40",
            supplierLot: "LOTE-B",
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    });
    expect(second.statusCode).toBe(201);

    const fetched = await app.inject({ method: "GET", url: `/purchase-orders/${po.id}` });
    expect(fetched.json().status).toBe("RECEIVED");
    expect(fetched.json().lines[0].receivedQuantity).toBe("100");
    expect(fetched.json().lines[0].openQuantity).toBe("0");

    await app.close();
  });

  it("recebe OC PARTIALLY_RECEIVED (não só ORDERED)", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "100" },
    ]);
    const poLineId = po.lines[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "30",
            supplierLot: "L1",
            expiryDate: FUTURE_EXPIRY,
          },
        ],
      },
    });

    const poAfterFirst = await app.inject({ method: "GET", url: `/purchase-orders/${po.id}` });
    expect(poAfterFirst.json().status).toBe("PARTIALLY_RECEIVED");

    const second = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "20",
            supplierLot: "L2",
            expiryDate: FUTURE_EXPIRY,
          },
        ],
      },
    });
    expect(second.statusCode).toBe(201);

    await app.close();
  });

  it("rejeita recebimento de OC DRAFT", async () => {
    const app = buildTestApp();
    await app.ready();

    const draft = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: rawMaterialItemId, orderedQuantity: "10" }],
      },
    });
    createdPurchaseOrderIds.push(draft.json().id);
    const poLineId = draft.json().lines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${draft.json().id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "5", supplierLot: "L1" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_purchase_order_status");

    await app.close();
  });

  it("rejeita recebimento de OC CANCELLED", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/cancel`,
      payload: { reason: "Cancelado para teste de recebimento" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "5", supplierLot: "L1" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_purchase_order_status");

    await app.close();
  });

  it("rejeita recebimento de OC já RECEIVED", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "10",
            supplierLot: "L1",
            expiryDate: FUTURE_EXPIRY,
          },
        ],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "1", supplierLot: "L2" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_purchase_order_status");

    await app.close();
  });

  it("não excede a quantidade em aberto (over-receipt)", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "100" },
    ]);
    const poLineId = po.lines[0].id;

    await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "60",
            supplierLot: "L1",
            expiryDate: FUTURE_EXPIRY,
          },
        ],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "41",
            supplierLot: "L2",
            expiryDate: FUTURE_EXPIRY,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("over_receipt");

    await app.close();
  });

  it("não permite quantidade recebida <= 0", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "0", supplierLot: "L1" }],
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("gera código de lote LT-YYYYMMDD-NNNNNN único a cada recebimento", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "100" },
    ]);
    const poLineId = po.lines[0].id;

    const first = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "50",
            supplierLot: "L1",
            expiryDate: FUTURE_EXPIRY,
          },
        ],
      },
    });
    const second = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "50",
            supplierLot: "L2",
            expiryDate: FUTURE_EXPIRY,
          },
        ],
      },
    });

    const code1 = first.json().lines[0].lotCode;
    const code2 = second.json().lines[0].lotCode;
    expect(code1).toMatch(/^LT-\d{8}-\d{6}$/);
    expect(code2).toMatch(/^LT-\d{8}-\d{6}$/);
    expect(code1).not.toBe(code2);

    await app.close();
  });

  it("exige supplierLot quando o item controla lote", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "5" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("missing_supplier_lot");

    await app.close();
  });

  it("exige expiryDate quando o item controla validade", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "5", supplierLot: "L1" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("missing_expiry_date");

    await app.close();
  });

  it("rejeita validade anterior à data do recebimento", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "5",
            supplierLot: "L1",
            expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_expiry_date");

    await app.close();
  });

  it("não cria Lot quando o item não controla lote", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: noLotItemId, orderedQuantity: "200" },
    ]);
    const poLineId = po.lines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "200" }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().lines[0].lotId).toBeNull();

    await app.close();
  });

  it("lote nasce AWAITING_RELEASE quando requiresQualityRelease=true e AVAILABLE quando false", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
      { itemId: packagingItemId, orderedQuantity: "10" },
    ]);
    const rawLineId = po.lines.find((l: { itemId: string }) => l.itemId === rawMaterialItemId).id;
    const packagingLineId = po.lines.find(
      (l: { itemId: string }) => l.itemId === packagingItemId,
    ).id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: rawLineId,
            receivedQuantity: "10",
            supplierLot: "L1",
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
          { purchaseOrderLineId: packagingLineId, receivedQuantity: "10", supplierLot: "L2" },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const rawLot = response.json().lines[0];
    const packagingLot = response.json().lines[1];

    const rawLotFetched = await app.inject({ method: "GET", url: `/lots/${rawLot.lotId}` });
    expect(rawLotFetched.json().status).toBe("AWAITING_RELEASE");

    const packagingLotFetched = await app.inject({
      method: "GET",
      url: `/lots/${packagingLot.lotId}`,
    });
    expect(packagingLotFetched.json().status).toBe("AVAILABLE");

    await app.close();
  });

  it("libera lote explicitamente", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    const receipt = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "10",
            supplierLot: "L1",
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    });
    const lotId = receipt.json().lines[0].lotId;

    const released = await app.inject({ method: "POST", url: `/lots/${lotId}/release` });
    expect(released.statusCode).toBe(200);
    expect(released.json().status).toBe("AVAILABLE");
    expect(released.json().releasedAt).not.toBeNull();
    expect(released.json().releasedBy).not.toBeNull();

    await app.close();
  });

  it("bloqueio de lote exige motivo", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    const receipt = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "10",
            supplierLot: "L1",
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    });
    const lotId = receipt.json().lines[0].lotId;

    const withoutReason = await app.inject({
      method: "POST",
      url: `/lots/${lotId}/block`,
      payload: {},
    });
    expect(withoutReason.statusCode).toBe(400);

    const blocked = await app.inject({
      method: "POST",
      url: `/lots/${lotId}/block`,
      payload: { reason: "Divergência na inspeção visual" },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json().status).toBe("BLOCKED");
    expect(blocked.json().blockReason).toBe("Divergência na inspeção visual");
    expect(blocked.json().blockedBy).not.toBeNull();

    await app.close();
  });

  it("atomicidade: falha em uma linha não deixa Receipt/Lot parcial", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
      { itemId: packagingItemId, orderedQuantity: "5" },
    ]);
    const rawLineId = po.lines.find((l: { itemId: string }) => l.itemId === rawMaterialItemId).id;
    const packagingLineId = po.lines.find(
      (l: { itemId: string }) => l.itemId === packagingItemId,
    ).id;

    const beforeCount = await app.inject({
      method: "GET",
      url: `/receipts?purchaseOrderId=${po.id}`,
    });
    expect(beforeCount.json().total).toBe(0);

    // segunda linha excede o aberto (5 pedido, pedindo 999) — deve reverter tudo.
    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: rawLineId,
            receivedQuantity: "10",
            supplierLot: "L1",
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
          { purchaseOrderLineId: packagingLineId, receivedQuantity: "999", supplierLot: "L-PKG" },
        ],
      },
    });
    expect(response.statusCode).toBe(400);

    const afterCount = await app.inject({
      method: "GET",
      url: `/receipts?purchaseOrderId=${po.id}`,
    });
    expect(afterCount.json().total).toBe(0);

    const poAfter = await app.inject({ method: "GET", url: `/purchase-orders/${po.id}` });
    expect(poAfter.json().status).toBe("ORDERED");
    expect(poAfter.json().lines[0].receivedQuantity).toBe("0");

    await app.close();
  });

  it("gera exatamente um InventoryMovement RECEIPT_IN por ReceiptLine, ligado ao lote", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
    ]);
    const poLineId = po.lines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: poLineId,
            receivedQuantity: "10",
            supplierLot: "L1",
            expiryDate: FUTURE_EXPIRY,
          },
        ],
      },
    });

    const receiptLineId = response.json().lines[0].id;
    const lotId = response.json().lines[0].lotId;

    const movements = await prisma.inventoryMovement.findMany({ where: { receiptLineId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe("RECEIPT_IN");
    expect(movements[0]?.quantity.toString()).toBe("10");
    expect(movements[0]?.lotId).toBe(lotId);
    expect(movements[0]?.sourceType).toBe("RECEIPT");

    await app.close();
  });

  it("recebimento sem lote gera InventoryMovement com lotId null", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: noLotItemId, orderedQuantity: "50" },
    ]);
    const poLineId = po.lines[0].id;

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: "50" }],
      },
    });

    const receiptLineId = response.json().lines[0].id;
    const movements = await prisma.inventoryMovement.findMany({ where: { receiptLineId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.lotId).toBeNull();

    await app.close();
  });

  it("falha transacional (over-receipt em uma linha) não deixa InventoryMovement órfão", async () => {
    const app = buildTestApp();
    await app.ready();
    const prisma = getPrisma();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "10" },
      { itemId: packagingItemId, orderedQuantity: "5" },
    ]);
    const rawLineId = po.lines.find((l: { itemId: string }) => l.itemId === rawMaterialItemId).id;
    const packagingLineId = po.lines.find(
      (l: { itemId: string }) => l.itemId === packagingItemId,
    ).id;

    const beforeMovements = await prisma.inventoryMovement.count({
      where: { itemId: { in: [rawMaterialItemId, packagingItemId] } },
    });

    const response = await app.inject({
      method: "POST",
      url: `/purchase-orders/${po.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: rawLineId,
            receivedQuantity: "10",
            supplierLot: "L1",
            expiryDate: FUTURE_EXPIRY,
          },
          { purchaseOrderLineId: packagingLineId, receivedQuantity: "999", supplierLot: "L-PKG" },
        ],
      },
    });
    expect(response.statusCode).toBe(400);

    const afterMovements = await prisma.inventoryMovement.count({
      where: { itemId: { in: [rawMaterialItemId, packagingItemId] } },
    });
    expect(afterMovements).toBe(beforeMovements);

    await app.close();
  });

  it("concorrência: duas tentativas simultâneas não permitem over-receipt combinado", async () => {
    const app = buildTestApp();
    await app.ready();

    const po = await createOrderedPurchaseOrder(app, [
      { itemId: rawMaterialItemId, orderedQuantity: "100" },
    ]);
    const poLineId = po.lines[0].id;

    const attempt = () =>
      app.inject({
        method: "POST",
        url: `/purchase-orders/${po.id}/receipts`,
        payload: {
          receivedAt: new Date().toISOString(),
          lines: [
            {
              purchaseOrderLineId: poLineId,
              receivedQuantity: "60",
              supplierLot: `CONC-${Math.random()}`,
              expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ],
        },
      });

    const [first, second] = await Promise.all([attempt(), attempt()]);
    const statuses = [first.statusCode, second.statusCode].sort();

    // as duas pedem 60 de um total de 100: no maximo uma pode passar.
    expect(statuses).toEqual([201, 400]);

    const poAfter = await app.inject({ method: "GET", url: `/purchase-orders/${po.id}` });
    expect(Number(poAfter.json().lines[0].receivedQuantity)).toBeLessThanOrEqual(100);

    await app.close();
  });
});
