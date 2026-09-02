import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";
import { buildCsv, csvDecimal, csvFileName, csvMoney, sanitizeCsvValue } from "../../lib/csv.js";
import { csvExportPaths } from "./exports.routes.js";

const fixtureCustomerIds: string[] = [];
const fixtureSupplierIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureCustomerOrderIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];
const fixturePurchaseOrderIds: string[] = [];
const fixtureReceiptIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.billingLine.deleteMany({
      where: { billing: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.billing.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: fixtureCustomerOrderIds } } });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: fixtureCustomerOrderIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
    });
    const linked = await prisma.productionOrder.findMany({
      where: { customerOrderId: { in: fixtureCustomerOrderIds } },
      select: { id: true },
    });
    fixtureProductionOrderIds.push(...linked.map((order) => order.id));
  }
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOutput.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionConsumption.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.materialReservationLine.deleteMany({
      where: { reservation: { productionOrderId: { in: fixtureProductionOrderIds } } },
    });
    await prisma.materialReservation.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.lot.deleteMany({ where: { productionOrderId: { in: fixtureProductionOrderIds } } });
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureCustomerOrderIds.length > 0) {
    await prisma.customerOrder.deleteMany({ where: { id: { in: fixtureCustomerOrderIds } } });
  }
  if (fixtureReceiptIds.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: fixtureReceiptIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: fixtureReceiptIds } } });
  }
  if (fixturePurchaseOrderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: fixturePurchaseOrderIds } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: fixturePurchaseOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.lot.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  if (fixtureCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: fixtureCustomerIds } } });
  }
  if (fixtureSupplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixtureSupplierIds } } });
  }
});

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function downloadCsv(app: App, path: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await app.inject({ method: "GET", url: `${path}${query ? `?${query}` : ""}` });
  expect(response.statusCode).toBe(200);
  return response;
}

function csvLines(body: string): string[] {
  return body.replace(/^﻿/, "").split("\r\n").filter((line) => line.length > 0);
}

async function createCustomer(overrides: { legalName?: string; cnpj?: string; code?: string } = {}) {
  const prisma = getPrisma();
  const m = marker();
  const customer = await prisma.customer.create({
    data: {
      code: overrides.code ?? `CLI-EXP-${m}`,
      legalName: overrides.legalName ?? `Cliente Exportação ${m}`,
      active: true,
      ...(overrides.cnpj ? { cnpj: overrides.cnpj } : {}),
    },
  });
  fixtureCustomerIds.push(customer.id);
  return customer;
}

async function createSupplier() {
  const prisma = getPrisma();
  const m = marker();
  const supplier = await prisma.supplier.create({
    data: { code: `FOR-EXP-${m}`, legalName: `Fornecedor Exportação ${m}`, active: true },
  });
  fixtureSupplierIds.push(supplier.id);
  return supplier;
}

async function createItem(type: "RAW_MATERIAL" | "FINISHED_PRODUCT") {
  const prisma = getPrisma();
  const m = marker();
  const item = await prisma.item.create({
    data: {
      type,
      code: `${type === "RAW_MATERIAL" ? "MP" : "PA"}-EXP-${m}`,
      name: `Item Exportação ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function stockLot(itemId: string, quantity: string) {
  const prisma = getPrisma();
  const lot = await prisma.lot.create({
    data: {
      code: `LT-EXP-${marker()}`.toUpperCase(),
      origin: "RECEIPT",
      itemId,
      initialReceivedQuantity: quantity,
      status: "AVAILABLE",
    },
  });
  await prisma.inventoryMovement.create({
    data: {
      itemId,
      lotId: lot.id,
      type: "FINISHED_GOOD_PRODUCTION",
      quantity,
      occurredAt: new Date(),
      sourceType: "FINISHED_GOOD_PRODUCTION",
      createdBy: "Teste",
    },
  });
  return lot;
}

describe("Exportação CSV — formato base", () => {
  it("gera UTF-8 com BOM, separador ponto e vírgula, CRLF e escapes corretos", () => {
    const csv = buildCsv(
      [
        { header: "Código", value: (row: { code: string; note: string }) => row.code },
        { header: "Observação", value: (row: { code: string; note: string }) => row.note },
      ],
      [
        { code: "PED-000001", note: 'Contém ; ponto e vírgula e "aspas"' },
        { code: "PED-000002", note: "Duas\nlinhas com acentuação: ração" },
      ],
    );

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    const [header, ...rest] = csv.replace(/^﻿/, "").split("\r\n");
    expect(header).toBe("Código;Observação");
    // Separador e aspas dentro da célula ficam protegidos por aspas duplas.
    expect(rest[0]).toBe('PED-000001;"Contém ; ponto e vírgula e ""aspas"""');
    // Quebra de linha permanece dentro da célula citada.
    expect(csv).toContain('"Duas\nlinhas com acentuação: ração"');
  });

  it("neutraliza fórmula de planilha sem alterar o valor persistido", () => {
    expect(sanitizeCsvValue("=1+1")).toBe("'=1+1");
    expect(sanitizeCsvValue("+55 11 99999-0000")).toBe("'+55 11 99999-0000");
    expect(sanitizeCsvValue("@usuario")).toBe("'@usuario");
    expect(sanitizeCsvValue("-10")).toBe("'-10");
    expect(sanitizeCsvValue("Ração premium")).toBe("Ração premium");
  });

  it("preserva Decimal sem passar por float e deixa vazio o que é desconhecido", () => {
    // Passa por Prisma.Decimal, nunca por float: 19.000000 continua exato.
    expect(csvDecimal("19.000000")).toBe("19");
    expect(csvDecimal("0.1")).toBe("0,1");
    expect(csvDecimal("1234.567891")).toBe("1234,567891");
    expect(csvDecimal("0.30000000000000004")).toBe("0,30000000000000004");
    expect(csvMoney("1234.5")).toBe("1234,50");
    // Custo/preço desconhecido nunca vira zero.
    expect(csvMoney(null)).toBe("");
    expect(csvDecimal(null)).toBe("");
  });

  it("usa nome de arquivo legível e determinístico, nunca UUID", () => {
    expect(csvFileName("clientes")).toMatch(/^veridi_clientes_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(
      csvFileName("movimentacoes", {
        from: new Date("2026-08-01T00:00:00Z"),
        to: new Date("2026-08-16T00:00:00Z"),
      }),
    ).toBe("veridi_movimentacoes_2026-08-01_2026-08-16.csv");
  });
});

describe("Exportação CSV — listagens", () => {
  it("devolve cabeçalho HTTP de download e o resultado FILTRADO COMPLETO, além da página", async () => {
    const app = buildTestApp();
    await app.ready();

    // 30 clientes com o mesmo prefixo de busca: mais do que cabe numa página.
    const prefix = `EXPCSV${marker()}`.replace(/-/g, "").toUpperCase();
    for (let index = 0; index < 30; index += 1) {
      await createCustomer({ legalName: `${prefix} Cliente ${index}` });
    }

    const page = (
      await app.inject({ method: "GET", url: `/customers?search=${prefix}&page=1&pageSize=10` })
    ).json();
    expect(page.customers).toHaveLength(10);
    expect(page.total).toBe(30);

    const response = await downloadCsv(app, "/customers/export.csv", { search: prefix });
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain("veridi_clientes_");

    const lines = csvLines(response.body);
    // Cabeçalho + 30 registros: a paginação da tela não limita a exportação.
    expect(lines).toHaveLength(31);
    expect(lines[0]).toContain("Razão social");

    await app.close();
  });

  it("respeita o mesmo filtro da tela — nenhuma linha fora do conjunto", async () => {
    const app = buildTestApp();
    await app.ready();

    const prefix = `FILTRO${marker()}`.replace(/-/g, "").toUpperCase();
    await createCustomer({ legalName: `${prefix} Dentro A` });
    await createCustomer({ legalName: `${prefix} Dentro B` });
    await createCustomer({ legalName: `Fora do filtro ${marker()}` });

    const page = (await app.inject({ method: "GET", url: `/customers?search=${prefix}` })).json();
    const csv = await downloadCsv(app, "/customers/export.csv", { search: prefix });
    const lines = csvLines(csv.body);

    expect(page.total).toBe(2);
    expect(lines).toHaveLength(3);
    expect(lines.every((line, index) => index === 0 || line.includes(prefix))).toBe(true);

    await app.close();
  });

  it("preserva códigos de negócio e CNPJ como texto, nunca UUID", async () => {
    const app = buildTestApp();
    await app.ready();

    const code = `CLI-EXP-CODE-${marker()}`;
    const customer = await createCustomer({ code, cnpj: "11222333000181", legalName: `Cod ${code}` });

    const csv = await downloadCsv(app, "/customers/export.csv", { search: code });
    const lines = csvLines(csv.body);
    expect(lines[1]).toContain(code);
    expect(lines[1]).toContain("11222333000181");
    expect(lines[1]).not.toContain(customer.id);

    await app.close();
  });

  it("exporta lotes com código de lote e saldo do ledger", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await createItem("FINISHED_PRODUCT");
    const lot = await stockLot(item.id, "250");

    const csv = await downloadCsv(app, "/lots/export.csv", { search: lot.code });
    const lines = csvLines(csv.body);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(lot.code);
    expect(lines[1]).toContain("250");

    await app.close();
  });
});

describe("Exportação CSV — relatórios", () => {
  it("registra endpoint para todas as listagens e relatórios tabulares", () => {
    // R-06 e R-14 são consultas de documento único: a saída deles é impressão.
    for (const path of [
      "/reports/inventory/position/export.csv",
      "/reports/inventory/expiry/export.csv",
      "/reports/inventory/movements/export.csv",
      "/reports/production/requirements/export.csv",
      "/reports/production/planned-actual/export.csv",
      "/reports/production/consumption/export.csv",
      "/reports/purchasing/orders/export.csv",
      "/reports/purchasing/receipts/export.csv",
      "/reports/purchasing/on-order/export.csv",
      "/reports/purchasing/late/export.csv",
      "/reports/commercial/orders/export.csv",
      "/reports/commercial/fulfillment/export.csv",
      "/reports/billing/period/export.csv",
      "/reports/billing/awaiting/export.csv",
      "/reports/billing/order-delivered-billed/export.csv",
    ]) {
      expect(csvExportPaths).toContain(path);
    }
    for (const path of [
      "/customers/export.csv",
      "/suppliers/export.csv",
      "/items/export.csv",
      "/products/export.csv",
      "/purchase-orders/export.csv",
      "/receipts/export.csv",
      "/inventory/export.csv",
      "/lots/export.csv",
      "/inventory-movements/export.csv",
      "/formulations/export.csv",
      "/production-orders/export.csv",
      "/finished-goods/export.csv",
      "/customer-orders/export.csv",
      "/shipments/export.csv",
      "/billings/export.csv",
    ]) {
      expect(csvExportPaths).toContain(path);
    }
  });

  it("R-01 exporta o mesmo conjunto do relatório, com saldo do ledger", async () => {
    const app = buildTestApp();
    await app.ready();

    const item = await createItem("FINISHED_PRODUCT");
    await stockLot(item.id, "700");

    const report = (
      await app.inject({ method: "GET", url: `/reports/inventory/position?itemId=${item.id}` })
    ).json();
    const csv = await downloadCsv(app, "/reports/inventory/position/export.csv", { itemId: item.id });
    const lines = csvLines(csv.body);

    expect(report.total).toBe(1);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("700");
    expect(lines[0]).toContain("On Hand");
    expect(lines[0]).toContain("Qualidade");

    await app.close();
  });

  it("R-15 mantém a semântica de precificação incompleta: valor vazio, nunca zero", async () => {
    const app = buildTestApp();
    await app.ready();

    const finishedItem = await createItem("FINISHED_PRODUCT");
    await stockLot(finishedItem.id, "100");
    const product = (
      await app.inject({
        method: "POST",
        url: "/products",
        payload: { customerId: await fixtureCustomerId(), name: `Produto Exportação ${marker()}`, finishedProductItemId: finishedItem.id },
      })
    ).json();
    fixtureProductIds.push(product.id);

    const customer = await createCustomer();
    const order = (
      await app.inject({
        method: "POST",
        url: "/customer-orders",
        payload: {
          customerId: customer.id,
          lines: [{ productId: product.id, orderedQuantity: "100" }],
        },
      })
    ).json();
    fixtureCustomerOrderIds.push(order.id);
    const confirmed = (
      await app.inject({ method: "POST", url: `/customer-orders/${order.id}/confirm` })
    ).json();
    await app.inject({
      method: "POST",
      url: `/customer-orders/${order.id}/apply-fulfillment-plan`,
      payload: {
        lines: [
          { customerOrderLineId: confirmed.lines[0].id, reserveQuantity: "100", produceQuantity: "0" },
        ],
      },
    });

    const draft = (
      await app.inject({ method: "POST", url: `/customer-orders/${order.id}/shipments` })
    ).json();
    for (const line of draft.lines) {
      await app.inject({
        method: "POST",
        url: `/shipments/${draft.id}/lines/${line.id}/verify`,
        payload: { lotCode: line.lotCode },
      });
    }
    const shipment = (
      await app.inject({ method: "POST", url: `/shipments/${draft.id}/confirm` })
    ).json();

    // Faturamento emitido SEM preço.
    const billing = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: shipment.id } })
    ).json();
    await app.inject({ method: "POST", url: `/billings/${billing.id}/issue` });

    const csv = await downloadCsv(app, "/reports/billing/period/export.csv", {
      customerOrderId: order.id,
    });
    const lines = csvLines(csv.body);
    const header = lines[0]!.split(";");
    const row = lines[1]!.split(";");
    expect(row[header.indexOf("Faturamento")]).toBe(billing.code);
    // Valor vazio + precificação explicitamente incompleta.
    expect(row[header.indexOf("Valor")]).toBe("");
    expect(row[header.indexOf("Precificação")]).toBe("Incompleta");

    // R-17: expedido sem faturar aparece com o mesmo conjunto de filtros.
    const r17 = await downloadCsv(app, "/reports/billing/order-delivered-billed/export.csv", {
      customerOrderId: order.id,
    });
    const r17Lines = csvLines(r17.body);
    const r17Header = r17Lines[0]!.split(";");
    const r17Row = r17Lines[1]!.split(";");
    // Quantidade faturada é confiável mesmo sem preço — o que falta é o VALOR.
    expect(r17Row[r17Header.indexOf("Expedido")]).toBe("100");
    expect(r17Row[r17Header.indexOf("Faturado")]).toBe("100");
    expect(r17Row[r17Header.indexOf("Expedido sem faturar")]).toBe("0");

    await app.close();
  });

  it("R-05 exporta o custo com a qualidade explícita e sem total artificial", async () => {
    const app = buildTestApp();
    await app.ready();

    const supplier = await createSupplier();
    const rawMaterial = await createItem("RAW_MATERIAL");
    const po = (
      await app.inject({
        method: "POST",
        url: "/purchase-orders",
        payload: {
          supplierId: supplier.id,
          orderDate: new Date().toISOString(),
          lines: [{ itemId: rawMaterial.id, orderedQuantity: "500" }],
        },
      })
    ).json();
    fixturePurchaseOrderIds.push(po.id);
    await app.inject({ method: "POST", url: `/purchase-orders/${po.id}/confirm` });
    const receipt = (
      await app.inject({
        method: "POST",
        url: `/purchase-orders/${po.id}/receipts`,
        payload: {
          receivedAt: new Date().toISOString(),
          // Recebido SEM custo: a OP fica NO_COST.
          lines: [
            {
              purchaseOrderLineId: po.lines[0].id,
              receivedQuantity: "500",
              supplierLot: `SUP-${marker()}`,
            },
          ],
        },
      })
    ).json();
    fixtureReceiptIds.push(receipt.id);

    const finishedItem = await createItem("FINISHED_PRODUCT");
    const product = (
      await app.inject({
        method: "POST",
        url: "/products",
        payload: { customerId: await fixtureCustomerId(), name: `Produto Custo ${marker()}`, finishedProductItemId: finishedItem.id },
      })
    ).json();
    fixtureProductIds.push(product.id);
    const versionId = (
      await app.inject({ method: "POST", url: `/products/${product.id}/formulation-versions`, payload: {} })
    ).json().id;
    await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${versionId}`,
      payload: {
        basisQuantity: "1",
        components: [{ itemId: rawMaterial.id, quantity: "1", unitCode: "kg" }],
      },
    });
    await app.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` });

    const orderId = (
      await app.inject({
        method: "POST",
        url: "/production-orders",
        payload: { productId: product.id, plannedQuantity: "100" },
      })
    ).json().id;
    fixtureProductionOrderIds.push(orderId);
    await app.inject({ method: "POST", url: `/production-orders/${orderId}/plan` });
    const released = (
      await app.inject({ method: "POST", url: `/production-orders/${orderId}/release` })
    ).json();
    for (const requirement of released.requirements) {
      for (const line of requirement.reservationLines) {
        await app.inject({
          method: "POST",
          url: `/production-orders/${orderId}/picking/${line.id}/confirm`,
          payload: line.lotCode ? { lotCode: line.lotCode } : {},
        });
        await app.inject({
          method: "POST",
          url: `/production-orders/${orderId}/consumptions`,
          payload: { entries: [{ reservationLineId: line.id, quantity: line.quantity }] },
        });
      }
    }
    await app.inject({
      method: "POST",
      url: `/production-orders/${orderId}/outputs`,
      payload: { quantity: "100", destination: "NEW_LOT", businessLotNumber: `VD-EXP-${marker()}` },
    });
    await app.inject({ method: "POST", url: `/production-orders/${orderId}/complete` });

    const csv = await downloadCsv(app, "/reports/production/planned-actual/export.csv", {
      productionOrderId: orderId,
      includeCost: "true",
    });
    const lines = csvLines(csv.body);
    const header = lines[0]!.split(";");
    const row = lines[1]!.split(";");

    expect(row[header.indexOf("Planejado")]).toBe("100");
    expect(row[header.indexOf("Produzido")]).toBe("100");
    // Sem custo conhecido: célula vazia e qualidade explícita — nunca 0.
    expect(row[header.indexOf("Custo material unitário")]).toBe("");
    expect(row[header.indexOf("Qualidade do custo")]).toBe("NO_COST");

    // R-07 do mesmo consumo mantém a origem do custo visível.
    const consumption = await downloadCsv(app, "/reports/production/consumption/export.csv", {
      productionOrderId: orderId,
    });
    const consumptionLines = csvLines(consumption.body);
    const consumptionHeader = consumptionLines[0]!.split(";");
    const consumptionRow = consumptionLines[1]!.split(";");
    expect(consumptionRow[consumptionHeader.indexOf("Custo unitário")]).toBe("");
    expect(consumptionRow[consumptionHeader.indexOf("Origem do custo")]).toBe("Sem custo");

    await app.close();
  });

  it("impressão de relatório recebe o resultado completo, não a página", async () => {
    const app = buildTestApp();
    await app.ready();

    const prefix = `PRINT${marker()}`.replace(/-/g, "").toUpperCase();
    for (let index = 0; index < 8; index += 1) {
      const customer = await createCustomer({ legalName: `${prefix} Cliente ${index}` });
      const order = (
        await app.inject({
          method: "POST",
          url: "/customer-orders",
          payload: { customerId: customer.id, lines: [] },
        })
      ).json();
      fixtureCustomerOrderIds.push(order.id);
    }

    const paged = (
      await app.inject({ method: "GET", url: `/reports/commercial/orders?search=${prefix}&pageSize=3` })
    ).json();
    expect(paged.rows).toHaveLength(3);
    expect(paged.total).toBe(8);

    // `all=true` é o caminho explícito da impressão — sem pageSize gigante.
    const full = (
      await app.inject({ method: "GET", url: `/reports/commercial/orders?search=${prefix}&all=true` })
    ).json();
    expect(full.rows).toHaveLength(8);
    expect(full.total).toBe(8);

    await app.close();
  });
});
