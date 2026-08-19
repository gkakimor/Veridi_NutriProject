import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import type {
  IndustrialCostCalculationDTO,
  IndustrialCostCalculationSnapshotDTO,
  IndustrialCostCalculationSummaryDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { calculateIndustrialCost } from "./calculation.service.js";
import {
  CalculationInUseError,
  IndustrialCostCalculationNotFoundError,
} from "./calculation.errors.js";

const CODE_SEQUENCE = "industrial_cost_calculation_code_seq";
const CODE_PREFIX = "CALC";

/**
 * Congela um cálculo.
 *
 * O backend RECALCULA na hora de salvar: o frontend nunca é fonte da
 * matemática econômica, então o payload que ele exibiu não é aceito como
 * verdade. O que se persiste é a análise inteira — daqui a três meses a
 * média de 30 dias será outra, e a decisão de preço tomada hoje precisa
 * continuar explicável.
 */
export async function saveIndustrialCostCalculation(
  versionId: string,
  input: { costReferenceDate?: Date; notes?: string | null },
  actor: User,
): Promise<IndustrialCostCalculationSnapshotDTO> {
  const prisma = getPrisma();
  const referenceDate = input.costReferenceDate ?? new Date();
  const result = await calculateIndustrialCost(versionId, referenceDate);

  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, CODE_PREFIX);
  const created = await prisma.industrialCostCalculation.create({
    data: {
      code,
      industrialCostVersionId: versionId,
      productId: result.productId,
      costReferenceDate: referenceDate,
      structureStatusAtCalculation: result.structureStatus,
      quality: result.quality,
      directIndustrialCost: result.directIndustrialCost
        ? new Prisma.Decimal(result.directIndustrialCost)
        : null,
      overheadCost: new Prisma.Decimal(result.overheadSubtotalKnown),
      totalIndustrialCost: result.totalIndustrialCost
        ? new Prisma.Decimal(result.totalIndustrialCost)
        : null,
      knownSubtotal: new Prisma.Decimal(result.knownSubtotal),
      costPerUnit: result.costPerUnit ? new Prisma.Decimal(result.costPerUnit) : null,
      costPer1000: result.costPer1000 ? new Prisma.Decimal(result.costPer1000) : null,
      referenceOutputQuantity: new Prisma.Decimal(result.referenceOutputQuantity),
      referenceOutputUomCode: result.referenceOutputUomCode,
      productCodeSnapshot: result.productCode,
      productNameSnapshot: result.productName,
      customerNameSnapshot: result.customerName,
      formulationVersionNumber: result.formulationVersionNumber,
      result: result as unknown as Prisma.InputJsonValue,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      calculatedByUserId: actor.id,
      calculatedByNameSnapshot: actor.name,
    },
  });

  return toSnapshotDTO(created);
}

type CalculationRow = Awaited<
  ReturnType<ReturnType<typeof getPrisma>["industrialCostCalculation"]["findUniqueOrThrow"]>
>;

/**
 * Snapshot salvo NUNCA recalcula: o documento impresso amanhã precisa
 * mostrar o que embasou a decisão de ontem, e não o custo de hoje.
 */
function toSnapshotDTO(row: CalculationRow): IndustrialCostCalculationSnapshotDTO {
  const stored = row.result as unknown as IndustrialCostCalculationDTO;
  return {
    ...stored,
    id: row.id,
    code: row.code,
    calculatedAt: row.calculatedAt.toISOString(),
    calculatedByName: row.calculatedByNameSnapshot,
    structureStatusAtCalculation: row.structureStatusAtCalculation,
    notes: row.notes,
  };
}

export async function getIndustrialCostCalculation(
  id: string,
): Promise<IndustrialCostCalculationSnapshotDTO> {
  const row = await getPrisma().industrialCostCalculation.findUnique({ where: { id } });
  if (!row) throw new IndustrialCostCalculationNotFoundError(id);
  return toSnapshotDTO(row);
}

function toSummaryDTO(
  row: CalculationRow & { industrialCostVersion: { code: string; versionNumber: number } },
): IndustrialCostCalculationSummaryDTO {
  return {
    id: row.id,
    code: row.code,
    industrialCostVersionId: row.industrialCostVersionId,
    industrialCostVersionLabel: `${row.industrialCostVersion.code} · V${row.industrialCostVersion.versionNumber}`,
    structureStatusAtCalculation: row.structureStatusAtCalculation,
    costReferenceDate: row.costReferenceDate.toISOString(),
    calculatedAt: row.calculatedAt.toISOString(),
    calculatedByName: row.calculatedByNameSnapshot,
    quality: row.quality,
    totalIndustrialCost: row.totalIndustrialCost ? row.totalIndustrialCost.toFixed(2) : null,
    knownSubtotal: row.knownSubtotal.toFixed(2),
    costPerUnit: row.costPerUnit ? row.costPerUnit.toFixed(6) : null,
    costPer1000: row.costPer1000 ? row.costPer1000.toFixed(2) : null,
  };
}

export async function listProductCostCalculations(
  productId: string,
): Promise<IndustrialCostCalculationSummaryDTO[]> {
  const rows = await getPrisma().industrialCostCalculation.findMany({
    where: { productId },
    include: { industrialCostVersion: { select: { code: true, versionNumber: true } } },
    orderBy: { calculatedAt: "desc" },
    take: 50,
  });
  return rows.map(toSummaryDTO);
}

/** Último cálculo salvo por produto — base do relatório gerencial. */
export async function latestCalculationsByProduct(
  productIds: string[],
): Promise<Map<string, IndustrialCostCalculationSummaryDTO>> {
  if (productIds.length === 0) return new Map();

  const rows = await getPrisma().industrialCostCalculation.findMany({
    where: { productId: { in: productIds } },
    include: { industrialCostVersion: { select: { code: true, versionNumber: true } } },
    orderBy: { calculatedAt: "desc" },
  });

  const latest = new Map<string, IndustrialCostCalculationSummaryDTO>();
  for (const row of rows) {
    if (latest.has(row.productId)) continue;
    latest.set(row.productId, toSummaryDTO(row));
  }
  return latest;
}

/**
 * Descarta um cálculo salvo que ninguém cita.
 *
 * Congelar existe para proteger COMPROMISSO. Enquanto o produto está sendo
 * definido e nenhuma precificação apontou para o documento, ele é só um
 * retrato provisório — e obrigar a conviver com um retrato errado para
 * sempre não protege nada, só polui o histórico.
 *
 * Editar o cálculo continua fora de questão: um documento citado que muda de
 * conteúdo é pior que um documento a mais. Aqui ou ele some inteiro, ou fica
 * como está.
 */
export async function discardIndustrialCostCalculation(id: string): Promise<void> {
  const prisma = getPrisma();
  const calculation = await prisma.industrialCostCalculation.findUnique({ where: { id } });
  if (!calculation) throw new IndustrialCostCalculationNotFoundError(id);

  const pricing = await prisma.pricingVersion.findMany({
    where: { industrialCostCalculationId: id },
    select: { code: true, versionNumber: true },
  });
  if (pricing.length > 0) {
    throw new CalculationInUseError(pricing.map((p) => `${p.code} · V${p.versionNumber}`));
  }

  await prisma.industrialCostCalculation.delete({ where: { id } });
}
