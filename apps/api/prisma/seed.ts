import { PrismaClient } from "@prisma/client";
import type { ItemType, UomDimension } from "@prisma/client";
import { ITEM_TYPE_DEFAULTS } from "@veridi/shared";
import { nextItemCode } from "../src/modules/items/item-codes.js";

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

async function main(): Promise<void> {
  await seedUnits();
  await seedItems();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
