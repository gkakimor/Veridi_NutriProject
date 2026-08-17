import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  IndustrialResourceDTO,
  IndustrialResourceDetailDTO,
  IndustrialResourceListResponse,
  IndustrialResourceRateDTO,
} from "@veridi/shared";
import {
  DEFAULT_RESOURCE_RATE_CURRENCY,
  isValidCurrencyCode,
  normalizeCurrencyCode,
  usageUomForResourceType,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  IndustrialResourceNotFoundError,
  InvalidResourcePowerError,
  InvalidResourceRateError,
  InvalidResourceRateUomError,
} from "./industrial-resources.errors.js";
import type {
  CreateIndustrialResourceInput,
  CreateResourceRateInput,
  ListResourcesQuery,
  UpdateIndustrialResourceInput,
} from "./industrial-resources.schemas.js";

/**
 * Recursos industriais e suas tarifas.
 *
 * Duas separações estruturais:
 * 1. **recurso ≠ pessoa**: um recurso `LABOR` é a categoria econômica
 *    ("operador de produção"), não um colaborador. `User` continua sendo
 *    quem executou/auditou um ato, e os dois nunca se ligam sozinhos;
 * 2. **recurso ≠ tarifa**: a tarifa é histórica e IMUTÁVEL. Não existe
 *    `currentRate` gravado no recurso — a vigente é derivada de uma data de
 *    referência, e por isso uma estrutura antiga nunca muda de valor porque
 *    alguém reajustou a hora hoje.
 */

const CODE_SEQUENCE = "industrial_resource_code_seq";
const CODE_PREFIX = "REC";

const resourceInclude = {
  rates: {
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] as PrismaTypes.IndustrialResourceRateOrderByWithRelationInput[],
  },
} satisfies PrismaTypes.IndustrialResourceInclude;

type ResourceWithRates = PrismaTypes.IndustrialResourceGetPayload<{
  include: typeof resourceInclude;
}>;

type RateRow = ResourceWithRates["rates"][number];

/**
 * Tarifa vigente numa data de referência.
 *
 * Exige `effectiveAt`: valor histórico sem vigência confiável (o caso do
 * legado) é referência, nunca tarifa vigente. `createdAt` sozinho não tem
 * significado econômico.
 */
export function isRateCurrent(rate: RateRow, reference: Date): boolean {
  if (!rate.effectiveAt) return false;
  if (rate.effectiveAt.getTime() > reference.getTime()) return false;
  if (rate.validUntil && rate.validUntil.getTime() < reference.getTime()) return false;
  return true;
}

export function pickCurrentRate(rates: readonly RateRow[], reference: Date): RateRow | null {
  const candidates = rates.filter((rate) => isRateCurrent(rate, reference));
  if (candidates.length === 0) return null;

  return candidates.reduce((best, rate) => {
    const bestAt = best.effectiveAt!.getTime();
    const rateAt = rate.effectiveAt!.getTime();
    if (rateAt !== bestAt) return rateAt > bestAt ? rate : best;
    return rate.createdAt.getTime() > best.createdAt.getTime() ? rate : best;
  });
}

export function toRateDTO(rate: RateRow, reference: Date): IndustrialResourceRateDTO {
  return {
    id: rate.id,
    rateValue: rate.rateValue.toString(),
    currencyCode: rate.currencyCode,
    rateUom: rate.rateUom,
    effectiveAt: rate.effectiveAt ? rate.effectiveAt.toISOString() : null,
    validUntil: rate.validUntil ? rate.validUntil.toISOString() : null,
    source: rate.source,
    notes: rate.notes,
    createdAt: rate.createdAt.toISOString(),
    createdByName: rate.createdByNameSnapshot,
    isCurrent: isRateCurrent(rate, reference),
  };
}

export function toResourceDTO(
  resource: ResourceWithRates,
  reference = new Date(),
): IndustrialResourceDTO {
  const current = pickCurrentRate(resource.rates, reference);
  return {
    id: resource.id,
    code: resource.code,
    name: resource.name,
    type: resource.type,
    description: resource.description,
    defaultUsageUom: resource.defaultUsageUom,
    // Potência desconhecida continua `null` — nunca zero.
    powerKw: resource.powerKw ? resource.powerKw.toString() : null,
    notes: resource.notes,
    active: resource.active,
    currentRate: current ? toRateDTO(current, reference) : null,
    rateCount: resource.rates.length,
    createdAt: resource.createdAt.toISOString(),
    createdByName: resource.createdByNameSnapshot,
    updatedAt: resource.updatedAt.toISOString(),
    updatedByName: resource.updatedByNameSnapshot,
  };
}

export async function getIndustrialResource(
  id: string,
): Promise<IndustrialResourceDetailDTO | null> {
  const resource = await getPrisma().industrialResource.findUnique({
    where: { id },
    include: resourceInclude,
  });
  if (!resource) return null;

  const reference = new Date();
  return {
    ...toResourceDTO(resource, reference),
    rates: resource.rates.map((rate) => toRateDTO(rate, reference)),
  };
}

export async function listIndustrialResources(
  query: ListResourcesQuery,
  pagination: Pagination = query,
): Promise<IndustrialResourceListResponse> {
  const prisma = getPrisma();
  const where: PrismaTypes.IndustrialResourceWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.industrialResource.findMany({
      where,
      include: resourceInclude,
      orderBy: [{ type: "asc" }, { code: "asc" }],
      ...pageArgs(pagination),
    }),
    prisma.industrialResource.count({ where }),
  ]);

  const reference = new Date();
  return {
    resources: rows.map((row) => toResourceDTO(row, reference)),
    ...pageMeta(pagination, total),
  };
}

/** Potência só faz sentido em equipamento, e nunca é inventada. */
function assertPower(type: string, powerKw: string | null | undefined): void {
  if (powerKw === null || powerKw === undefined) return;
  if (type !== "EQUIPMENT") {
    throw new InvalidResourcePowerError("Potência é informação de equipamento.");
  }
  if (new Prisma.Decimal(powerKw).lessThanOrEqualTo(0)) {
    throw new InvalidResourcePowerError("A potência informada deve ser maior que zero.");
  }
}

export async function createIndustrialResource(
  input: CreateIndustrialResourceInput,
  actor: User,
): Promise<IndustrialResourceDetailDTO> {
  const prisma = getPrisma();
  assertPower(input.type, input.powerKw);

  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, CODE_PREFIX);
  const created = await prisma.industrialResource.create({
    data: {
      code,
      name: input.name,
      type: input.type,
      // A unidade de consumo acompanha o tipo: operador não se mede em kWh.
      defaultUsageUom: usageUomForResourceType(input.type),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.powerKw ? { powerKw: new Prisma.Decimal(input.powerKw) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      createdByUserId: actor.id,
      createdByNameSnapshot: actor.name,
      updatedByUserId: actor.id,
      updatedByNameSnapshot: actor.name,
    },
  });

  return (await getIndustrialResource(created.id))!;
}

export async function updateIndustrialResource(
  id: string,
  input: UpdateIndustrialResourceInput,
  actor: User,
): Promise<IndustrialResourceDetailDTO> {
  const prisma = getPrisma();
  const resource = await prisma.industrialResource.findUnique({ where: { id } });
  if (!resource) throw new IndustrialResourceNotFoundError(id);

  if (input.powerKw !== undefined && input.powerKw !== null) {
    assertPower(resource.type, input.powerKw);
  }

  await prisma.industrialResource.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.powerKw !== undefined
        ? { powerKw: input.powerKw === null ? null : new Prisma.Decimal(input.powerKw) }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      updatedByUserId: actor.id,
      updatedByNameSnapshot: actor.name,
    },
  });

  return (await getIndustrialResource(id))!;
}

/**
 * Registra uma tarifa. Tarifa é IMUTÁVEL: reajuste é uma nova tarifa, e a
 * anterior continua no histórico para explicar estruturas antigas.
 */
export async function createResourceRate(
  resourceId: string,
  input: CreateResourceRateInput,
  actor: User,
): Promise<IndustrialResourceDetailDTO> {
  const prisma = getPrisma();
  const resource = await prisma.industrialResource.findUnique({ where: { id: resourceId } });
  if (!resource) throw new IndustrialResourceNotFoundError(resourceId);

  const currencyCode = normalizeCurrencyCode(input.currencyCode ?? DEFAULT_RESOURCE_RATE_CURRENCY);
  if (!isValidCurrencyCode(currencyCode)) {
    throw new InvalidResourceRateError(`Moeda inválida: ${currencyCode}.`);
  }

  // A unidade da tarifa acompanha o tipo do recurso: hora para mão de obra
  // e equipamento, kWh para energia. Não existe operador por quilo.
  const expectedUom = usageUomForResourceType(resource.type);
  const rateUom = input.rateUom ?? expectedUom;
  if (rateUom !== expectedUom) {
    throw new InvalidResourceRateUomError(rateUom, expectedUom);
  }

  // Tarifa manual vale a partir de agora, salvo vigência informada.
  const effectiveAt = input.effectiveAt === undefined ? new Date() : input.effectiveAt;
  const validUntil = input.validUntil ?? null;
  if (effectiveAt && validUntil && validUntil.getTime() < effectiveAt.getTime()) {
    throw new InvalidResourceRateError("A validade não pode ser anterior ao início da vigência.");
  }

  await prisma.industrialResourceRate.create({
    data: {
      industrialResourceId: resourceId,
      rateValue: new Prisma.Decimal(input.rateValue),
      currencyCode,
      rateUom,
      effectiveAt,
      validUntil,
      source: "MANUAL",
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      createdByUserId: actor.id,
      createdByNameSnapshot: actor.name,
    },
  });

  return (await getIndustrialResource(resourceId))!;
}
