import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseCsv, cleanText, safeDecimal } from "../veridi-data/corpus.js";
import { nextLotCode } from "../../apps/api/src/lib/lot-code.js";
import { assertImportEnvironment, hasApplyFlag } from "./environment.js";
import { OUT_DIR, ensureOutputDirs } from "./sources.js";

/**
 * Saldo físico de abertura da migração.
 *
 * Processo SEPARADO do import de master data, e deliberadamente manual na
 * parte que importa: a planilha traz saldo agregado por item, e o ERP
 * controla estoque por item **e lote**. Inventar lote para "fechar" o saldo
 * destruiria a rastreabilidade que o sistema inteiro existe para garantir —
 * então quem conferiu o estoque físico preenche os lotes no template, e o
 * comando só confere e aplica.
 *
 *   pnpm veridi:opening-stock:validate
 *   pnpm veridi:opening-stock:apply
 *
 * O evento gravado é `OPENING_BALANCE`: não é recebimento de compra (não
 * houve OC nem nota), não é produção e não é ajuste de inventário.
 */

const TEMPLATE_FILE = "opening-inventory-template.csv";
const ACTOR = "Abertura de estoque (migração)";
/** Tolerância de reconciliação: diferença de arredondamento, nunca de contagem. */
const TOLERANCE = new Prisma.Decimal("0.000001");

export interface TemplateRow {
  lineNumber: number;
  cutoverDate: string | null;
  itemCode: string;
  expectedLegacyTotal: Prisma.Decimal | null;
  internalLotCode: string | null;
  supplierLot: string | null;
  businessLotNumber: string | null;
  ownerType: string;
  ownerCustomerCode: string | null;
  quantity: Prisma.Decimal | null;
  expiryDate: string | null;
  location: string | null;
  qualityStatus: string | null;
  coaStatus: string | null;
  notes: string | null;
}

function readTemplate(): TemplateRow[] {
  const filePath = path.join(OUT_DIR, TEMPLATE_FILE);
  if (!fs.existsSync(filePath)) {
    console.error(`ABORTADO: template ausente (${filePath}). Rode pnpm veridi:import:plan antes.`);
    process.exit(1);
  }

  const parsed = parseCsv(fs.readFileSync(filePath, "utf8"));
  const [header, ...body] = parsed;
  if (!header) {
    console.error("ABORTADO: template sem cabeçalho.");
    process.exit(1);
  }

  const index = (column: string): number => header.findIndex((cell) => cell.trim() === column);
  const columns = {
    cutoverDate: index("cutoverDate"),
    itemCode: index("itemCode"),
    expectedLegacyTotal: index("expectedLegacyTotal"),
    internalLotCode: index("internalLotCode"),
    supplierLot: index("supplierLot"),
    businessLotNumber: index("businessLotNumber"),
    ownerType: index("ownerType"),
    ownerCustomerCode: index("ownerCustomerCode"),
    quantity: index("quantity"),
    expiryDate: index("expiryDate"),
    location: index("location"),
    qualityStatus: index("qualityStatus"),
    coaStatus: index("coaStatus"),
    notes: index("notes"),
  };

  const rows: TemplateRow[] = [];
  body.forEach((cells, position) => {
    if (!cells.some((cell) => cell.trim().length > 0)) return;
    const value = (column: number): string | null =>
      column >= 0 ? cleanText(cells[column]) : null;

    const itemCode = value(columns.itemCode);
    if (!itemCode) return;

    rows.push({
      lineNumber: position + 2,
      cutoverDate: value(columns.cutoverDate),
      itemCode,
      expectedLegacyTotal: safeDecimal(cells[columns.expectedLegacyTotal] ?? ""),
      internalLotCode: value(columns.internalLotCode),
      supplierLot: value(columns.supplierLot),
      businessLotNumber: value(columns.businessLotNumber),
      ownerType: (value(columns.ownerType) ?? "VERIDI").toUpperCase(),
      ownerCustomerCode: value(columns.ownerCustomerCode),
      quantity: safeDecimal(cells[columns.quantity] ?? ""),
      expiryDate: value(columns.expiryDate),
      location: value(columns.location),
      qualityStatus: value(columns.qualityStatus)?.toUpperCase() ?? null,
      coaStatus: value(columns.coaStatus)?.toUpperCase() ?? null,
      notes: value(columns.notes),
    });
  });

  return rows;
}

/** Chave estável da linha de abertura — idempotência entre execuções. */
function openingSourceKey(row: TemplateRow): string {
  const payload = [
    "opening",
    row.itemCode,
    row.internalLotCode ?? "",
    row.supplierLot ?? "",
    row.businessLotNumber ?? "",
    row.expiryDate ?? "",
    row.location ?? "",
    row.quantity?.toString() ?? "",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export interface OpeningItemContext {
  controlsLot: boolean;
}

/**
 * Regras da abertura, isoladas do banco para poderem ser testadas e lidas
 * sem ruído: quantidade positiva, lote obrigatório quando o item é
 * loteado, dono explícito, laudo nunca aprovado por texto e soma dos lotes
 * batendo com o saldo legado.
 */
export function validateOpeningRows(
  item: OpeningItemContext,
  rows: readonly TemplateRow[],
  expected: Prisma.Decimal | null,
): string[] {
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.quantity || row.quantity.lessThanOrEqualTo(0)) {
      // Saldo zerado ou negativo nunca vira abertura.
      errors.push(`linha ${row.lineNumber}: quantidade deve ser maior que zero`);
    }
    if (item.controlsLot && !row.supplierLot && !row.businessLotNumber && !row.internalLotCode) {
      errors.push(
        `linha ${row.lineNumber}: item controla lote — informe lote do fornecedor, lote Veridi ou lote interno`,
      );
    }
    if (row.ownerType !== "VERIDI" && row.ownerType !== "CUSTOMER") {
      errors.push(`linha ${row.lineNumber}: ownerType inválido (${row.ownerType})`);
    }
    if (row.ownerType === "CUSTOMER" && !row.ownerCustomerCode) {
      // Material de cliente nunca é inferido pelo produto.
      errors.push(`linha ${row.lineNumber}: material de cliente exige ownerCustomerCode`);
    }
    if (row.coaStatus === "APPROVED") {
      // Laudo aprovado exige documento no sistema (capacidade 37).
      errors.push(
        `linha ${row.lineNumber}: coaStatus APPROVED não é aceito na abertura — anexe o laudo e aprove pela Qualidade`,
      );
    }
    if (
      row.qualityStatus &&
      !["AWAITING_RELEASE", "AVAILABLE", "BLOCKED"].includes(row.qualityStatus)
    ) {
      errors.push(`linha ${row.lineNumber}: qualityStatus inválido (${row.qualityStatus})`);
    }
  }

  const total = rows.reduce(
    (sum, row) => sum.plus(row.quantity ?? new Prisma.Decimal(0)),
    new Prisma.Decimal(0),
  );
  if (expected && total.minus(expected).abs().greaterThan(TOLERANCE)) {
    errors.push(
      `soma dos lotes ${total.toString()} ≠ saldo legado ${expected.toString()} (diferença ${total.minus(expected).toString()})`,
    );
  }

  return errors;
}

export interface OpeningApplyTarget {
  itemId: string;
  itemCode: string;
  requiresCoa: boolean;
}

/**
 * Aplica UMA linha de abertura: cria o lote físico e o movimento
 * `OPENING_BALANCE` na mesma transação.
 *
 * Idempotente pela chave estável da linha — reaplicar o template nunca
 * duplica estoque. O código interno do lote é gerado pelo ERP; o template
 * jamais fabrica identidade de lote.
 */
export async function applyOpeningRow(
  prisma: PrismaClient,
  target: OpeningApplyTarget,
  row: TemplateRow,
): Promise<"CREATED" | "ALREADY_APPLIED" | "CUSTOMER_NOT_FOUND"> {
  const sourceKey = openingSourceKey(row);
  const existing = await prisma.inventoryMovement.findFirst({
    where: { sourceType: "OPENING_BALANCE", sourceId: sourceKey },
  });
  if (existing) return "ALREADY_APPLIED";

  const ownerCustomer = row.ownerCustomerCode
    ? await prisma.customer.findUnique({ where: { code: row.ownerCustomerCode } })
    : null;
  if (row.ownerType === "CUSTOMER" && !ownerCustomer) return "CUSTOMER_NOT_FOUND";

  const cutover = row.cutoverDate ? new Date(`${row.cutoverDate}T12:00:00`) : new Date();

  await prisma.$transaction(async (tx) => {
    const lot = await tx.lot.create({
      data: {
        code: await nextLotCode(tx, cutover),
        origin: "OPENING_BALANCE",
        itemId: target.itemId,
        ownerType: row.ownerType === "CUSTOMER" ? "CUSTOMER" : "VERIDI",
        ...(ownerCustomer ? { ownerCustomerId: ownerCustomer.id } : {}),
        supplierLot: row.supplierLot,
        businessLotNumber: row.businessLotNumber,
        ...(row.expiryDate ? { expiryDate: new Date(`${row.expiryDate}T12:00:00`) } : {}),
        initialReceivedQuantity: row.quantity!,
        // Sem evidência de liberação, o lote nasce aguardando a Qualidade —
        // nunca disponível por omissão.
        status: (row.qualityStatus ?? "AWAITING_RELEASE") as "AWAITING_RELEASE",
        location: row.location,
        requiresCoaSnapshot: target.requiresCoa,
        // Laudo aprovado exige documento no sistema (capacidade 37).
        coaStatus: target.requiresCoa ? ((row.coaStatus ?? "PENDING") as "PENDING") : "NOT_REQUIRED",
        createdBy: ACTOR,
      },
    });

    await tx.inventoryMovement.create({
      data: {
        itemId: target.itemId,
        lotId: lot.id,
        type: "OPENING_BALANCE",
        quantity: row.quantity!,
        occurredAt: cutover,
        sourceType: "OPENING_BALANCE",
        sourceId: sourceKey,
        reason: row.notes ?? "Saldo físico de abertura da migração",
        createdBy: ACTOR,
      },
    });
  });

  return "CREATED";
}

interface ItemPlan {
  itemCode: string;
  itemId: string;
  itemName: string;
  unitCode: string;
  controlsLot: boolean;
  requiresCoa: boolean;
  expected: Prisma.Decimal | null;
  rows: TemplateRow[];
  errors: string[];
}

async function buildItemPlans(prisma: PrismaClient): Promise<ItemPlan[]> {
  const template = readTemplate();
  const byItem = new Map<string, TemplateRow[]>();
  for (const row of template) {
    byItem.set(row.itemCode, [...(byItem.get(row.itemCode) ?? []), row]);
  }

  const plans: ItemPlan[] = [];
  for (const [itemCode, rows] of byItem) {
    const item = await prisma.item.findUnique({ where: { code: itemCode } });
    const errors: string[] = [];
    if (!item) {
      plans.push({
        itemCode,
        itemId: "",
        itemName: "",
        unitCode: "",
        controlsLot: false,
        requiresCoa: false,
        expected: null,
        rows,
        errors: [`item ${itemCode} não existe na base`],
      });
      continue;
    }

    const expected = rows.find((row) => row.expectedLegacyTotal)?.expectedLegacyTotal ?? null;
    const informed = rows.filter((row) => row.quantity !== null);

    if (informed.length === 0) {
      // Linha ainda não reconciliada: não é erro, é trabalho pendente.
      plans.push({
        itemCode,
        itemId: item.id,
        itemName: item.name,
        unitCode: item.unitCode,
        controlsLot: item.controlsLot,
        requiresCoa: item.requiresCoa,
        expected,
        rows: [],
        errors: [],
      });
      continue;
    }

    errors.push(...validateOpeningRows({ controlsLot: item.controlsLot }, informed, expected));

    plans.push({
      itemCode,
      itemId: item.id,
      itemName: item.name,
      unitCode: item.unitCode,
      controlsLot: item.controlsLot,
      requiresCoa: item.requiresCoa,
      expected,
      rows: informed,
      errors,
    });
  }

  return plans;
}

async function main(): Promise<void> {
  const write = hasApplyFlag();
  const environment = assertImportEnvironment({ write });
  ensureOutputDirs();

  const prisma = new PrismaClient();
  try {
    const plans = await buildItemPlans(prisma);
    const pending = plans.filter((plan) => plan.rows.length === 0 && plan.errors.length === 0);
    const invalid = plans.filter((plan) => plan.errors.length > 0);
    const ready = plans.filter((plan) => plan.rows.length > 0 && plan.errors.length === 0);

    console.log(
      `ABERTURA DE ESTOQUE — banco ${environment.database}@${environment.host} (${write ? "APPLY" : "validação"})\n`,
    );
    console.log(`  Itens prontos: ${ready.length}`);
    console.log(`  Itens ainda sem lotes preenchidos: ${pending.length}`);
    console.log(`  Itens bloqueados por inconsistência: ${invalid.length}`);

    for (const plan of invalid) {
      console.log(`\n  ${plan.itemCode} — não aplicado:`);
      for (const error of plan.errors) console.log(`    - ${error}`);
    }

    if (!write) {
      console.log("\n  Nada foi escrito. Para aplicar: pnpm veridi:opening-stock:apply");
      return;
    }

    let lotsCreated = 0;
    let movementsCreated = 0;
    let alreadyApplied = 0;

    for (const plan of ready) {
      for (const row of plan.rows) {
        const outcome = await applyOpeningRow(prisma, plan, row);
        if (outcome === "ALREADY_APPLIED") alreadyApplied += 1;
        else if (outcome === "CUSTOMER_NOT_FOUND") {
          console.log(
            `  ${plan.itemCode} linha ${row.lineNumber}: cliente ${row.ownerCustomerCode} não encontrado — linha ignorada`,
          );
        } else {
          lotsCreated += 1;
          movementsCreated += 1;
        }
      }
    }

    console.log(
      `\n  Lotes criados ${lotsCreated} · movimentos OPENING_BALANCE ${movementsCreated} · linhas já aplicadas antes ${alreadyApplied}`,
    );
    console.log("  Correções posteriores usam Inventário Físico/Ajuste — abertura não se repete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
