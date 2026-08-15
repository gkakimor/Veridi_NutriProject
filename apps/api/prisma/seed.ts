import { PrismaClient } from "@prisma/client";
import type { ItemType, UomDimension } from "@prisma/client";
import {
  CUSTOMER_CODE_PREFIX,
  ITEM_TYPE_DEFAULTS,
  PRODUCT_CODE_PREFIX,
  PURCHASE_ORDER_CODE_PREFIX,
  SUPPLIER_CODE_PREFIX,
} from "@veridi/shared";
import { nextItemCode } from "../src/modules/items/item-codes.js";
import { nextSequenceCode } from "../src/lib/sequence-code.js";

const prisma = new PrismaClient();

interface SeedUnit {
  code: string;
  label: string;
  dimension: UomDimension;
  toBaseFactor: string;
}

const units: SeedUnit[] = [
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  { code: "mL", label: "Mililitro", dimension: "VOLUME", toBaseFactor: "0.001" },
  { code: "L", label: "Litro", dimension: "VOLUME", toBaseFactor: "1" },
];

interface SeedItem {
  type: ItemType;
  name: string;
  unitCode: string;
}

const items: SeedItem[] = [
  { type: "RAW_MATERIAL", name: "Vitamina C", unitCode: "kg" },
  { type: "RAW_MATERIAL", name: "Bisglicinato de Magnésio", unitCode: "kg" },
  { type: "PACKAGING", name: "Pote 500g", unitCode: "un" },
  { type: "PACKAGING", name: "Tampa Pote 500g", unitCode: "un" },
  { type: "FINISHED_PRODUCT", name: "Magnésio Quelato 60 cápsulas", unitCode: "un" },
  { type: "FINISHED_PRODUCT", name: "Vitamina C 1000mg 30 cápsulas", unitCode: "un" },
];

async function seedUnits(): Promise<void> {
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({
      where: { code: unit.code },
      update: {
        label: unit.label,
        dimension: unit.dimension,
        toBaseFactor: unit.toBaseFactor,
      },
      create: unit,
    });
  }
  console.log(`Unidades de medida: ${units.length} garantidas.`);
}

async function seedItems(): Promise<void> {
  for (const item of items) {
    const existing = await prisma.item.findFirst({
      where: { name: item.name, type: item.type },
    });
    if (existing) continue;

    const defaults = ITEM_TYPE_DEFAULTS[item.type];
    const code = await nextItemCode(prisma, item.type);

    await prisma.item.create({
      data: {
        type: item.type,
        code,
        name: item.name,
        unitCode: item.unitCode,
        controlsLot: defaults.controlsLot,
        controlsExpiry: defaults.controlsExpiry,
      },
    });
    console.log(`Item criado: ${code} — ${item.name}`);
  }
}

interface SeedSupplier {
  legalName: string;
  tradeName?: string;
  cnpj?: string;
}

const suppliers: SeedSupplier[] = [
  { legalName: "Nutrimax Ingredientes Ltda", tradeName: "Nutrimax", cnpj: "11222333000181" },
  { legalName: "Embalplast Industrial S.A.", tradeName: "Embalplast", cnpj: "44555666000122" },
];

async function seedSuppliers(): Promise<void> {
  for (const supplier of suppliers) {
    const existing = await prisma.supplier.findFirst({
      where: { legalName: supplier.legalName },
    });
    if (existing) continue;

    const code = await nextSequenceCode(prisma, "supplier_code_seq", SUPPLIER_CODE_PREFIX);
    await prisma.supplier.create({
      data: {
        code,
        legalName: supplier.legalName,
        tradeName: supplier.tradeName ?? null,
        cnpj: supplier.cnpj ?? null,
      },
    });
    console.log(`Fornecedor criado: ${code} — ${supplier.legalName}`);
  }
}

interface SeedCustomer {
  legalName: string;
  tradeName?: string;
  city?: string;
  state?: string;
}

const customers: SeedCustomer[] = [
  { legalName: "Vida Saudável Comércio de Suplementos Ltda", tradeName: "Vida Saudável", city: "São Paulo", state: "SP" },
  { legalName: "Farmácia Bem Estar Ltda", tradeName: "Bem Estar", city: "Curitiba", state: "PR" },
];

async function seedCustomers(): Promise<void> {
  for (const customer of customers) {
    const existing = await prisma.customer.findFirst({
      where: { legalName: customer.legalName },
    });
    if (existing) continue;

    const code = await nextSequenceCode(prisma, "customer_code_seq", CUSTOMER_CODE_PREFIX);
    await prisma.customer.create({
      data: {
        code,
        legalName: customer.legalName,
        tradeName: customer.tradeName ?? null,
        city: customer.city ?? null,
        state: customer.state ?? null,
      },
    });
    console.log(`Cliente criado: ${code} — ${customer.legalName}`);
  }
}

interface SeedProduct {
  name: string;
  customerLegalName?: string;
  finishedItemName?: string;
  externalCode?: string;
}

const products: SeedProduct[] = [
  {
    name: "Magnésio Quelato 60 cápsulas",
    customerLegalName: "Vida Saudável Comércio de Suplementos Ltda",
    finishedItemName: "Magnésio Quelato 60 cápsulas",
    externalCode: "VS-MG-60",
  },
  {
    name: "Vitamina C 1000mg 30 cápsulas",
    finishedItemName: "Vitamina C 1000mg 30 cápsulas",
  },
];

async function seedProducts(): Promise<void> {
  for (const product of products) {
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    if (existing) continue;

    const customer = product.customerLegalName
      ? await prisma.customer.findFirst({ where: { legalName: product.customerLegalName } })
      : null;
    const finishedItem = product.finishedItemName
      ? await prisma.item.findFirst({
          where: { name: product.finishedItemName, type: "FINISHED_PRODUCT" },
        })
      : null;

    const code = await nextSequenceCode(prisma, "product_code_seq", PRODUCT_CODE_PREFIX);
    await prisma.product.create({
      data: {
        code,
        name: product.name,
        customerId: customer?.id ?? null,
        finishedProductItemId: finishedItem?.id ?? null,
        externalCode: product.externalCode ?? null,
      },
    });
    console.log(`Produto criado: ${code} — ${product.name}`);
  }
}

interface SeedPurchaseOrderLine {
  itemName: string;
  itemType: ItemType;
  quantity: string;
  unitPrice?: string;
}

interface SeedPurchaseOrder {
  supplierLegalName: string;
  notes: string;
  confirm: boolean;
  lines: SeedPurchaseOrderLine[];
}

const purchaseOrders: SeedPurchaseOrder[] = [
  {
    supplierLegalName: "Nutrimax Ingredientes Ltda",
    notes: "Seed dev — rascunho de reposição de Vitamina C",
    confirm: false,
    lines: [{ itemName: "Vitamina C", itemType: "RAW_MATERIAL", quantity: "50" }],
  },
  {
    supplierLegalName: "Embalplast Industrial S.A.",
    notes: "Seed dev — pedido confirmado de potes",
    confirm: true,
    lines: [{ itemName: "Pote 500g", itemType: "PACKAGING", quantity: "1000", unitPrice: "2.50" }],
  },
];

async function seedPurchaseOrders(): Promise<void> {
  for (const po of purchaseOrders) {
    const existing = await prisma.purchaseOrder.findFirst({ where: { notes: po.notes } });
    if (existing) continue;

    const supplier = await prisma.supplier.findFirst({
      where: { legalName: po.supplierLegalName },
    });
    if (!supplier) continue;

    const lineItems: { item: { id: string; code: string; name: string; unitCode: string }; quantity: string; unitPrice?: string }[] = [];
    for (const line of po.lines) {
      const item = await prisma.item.findFirst({
        where: { name: line.itemName, type: line.itemType },
      });
      if (!item) continue;
      lineItems.push({ item, quantity: line.quantity, unitPrice: line.unitPrice });
    }
    if (lineItems.length === 0) continue;

    const code = await nextSequenceCode(
      prisma,
      "purchase_order_code_seq",
      PURCHASE_ORDER_CODE_PREFIX,
    );

    const created = await prisma.purchaseOrder.create({
      data: {
        code,
        supplierId: supplier.id,
        supplierCode: supplier.code,
        supplierName: supplier.legalName,
        supplierCnpj: supplier.cnpj,
        orderDate: new Date(),
        notes: po.notes,
        lines: {
          create: lineItems.map((line) => ({
            itemId: line.item.id,
            itemCode: line.item.code,
            itemName: line.item.name,
            unitCode: line.item.unitCode,
            orderedQuantity: line.quantity,
            unitPrice: line.unitPrice ?? null,
          })),
        },
      },
    });

    if (po.confirm) {
      await prisma.purchaseOrder.update({
        where: { id: created.id },
        data: { status: "ORDERED", orderedAt: new Date(), orderedBy: "Ambiente local" },
      });
    }

    console.log(
      `Ordem de compra criada: ${code} — ${po.supplierLegalName}${po.confirm ? " (confirmada)" : " (rascunho)"}`,
    );
  }
}

async function main(): Promise<void> {
  await seedUnits();
  await seedItems();
  await seedSuppliers();
  await seedCustomers();
  await seedProducts();
  await seedPurchaseOrders();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
