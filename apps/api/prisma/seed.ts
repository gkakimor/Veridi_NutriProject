import { PrismaClient } from "@prisma/client";
import type { ItemType, UomDimension } from "@prisma/client";
import { CUSTOMER_CODE_PREFIX, ITEM_TYPE_DEFAULTS, SUPPLIER_CODE_PREFIX } from "@veridi/shared";
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

async function main(): Promise<void> {
  await seedUnits();
  await seedItems();
  await seedSuppliers();
  await seedCustomers();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
