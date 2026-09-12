import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  IndustrialResourceDTO,
  IndustrialResourceDetailDTO,
  IndustrialResourceListResponse,
  IndustrialResourceRateDTO,
  IndustrialResourceType,
} from "@veridi/shared";
import {
  DEFAULT_RESOURCE_RATE_CURRENCY,
  INDUSTRIAL_RESOURCE_CODE_PREFIX,
  isCapacityResourceType,
  isValidCurrencyCode,
  normalizeCurrencyCode,
  usageUomForResourceType,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { diaDaColunaDeData, marcadorDeHojeComercial } from "../../lib/business-day.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  IndustrialResourceNotFoundError,
  InvalidResourceCapacityError,
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
/*
 * O prefixo vive em `@veridi/shared`, com todos os outros. Cravado aqui, ele
 * colidiu com o do Recebimento sem ninguem notar por meses.
 */
const CODE_PREFIX = INDUSTRIAL_RESOURCE_CODE_PREFIX;

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
 * Tarifa vigente numa data de referência — DIA CIVIL, inclusivo nas duas
 * bordas.
 *
 * Exige `effectiveAt`: valor histórico sem vigência confiável (o caso do
 * legado) é referência, nunca tarifa vigente. `createdAt` sozinho não tem
 * significado econômico.
 *
 * `effectiveAt` e `validUntil` são DATAS CIVIS (§71, §72): quem cadastra
 * escolhe o dia num `<input type="date">` e nunca escolhe hora, e a coluna
 * guarda a meia-noite UTC como MARCADOR do dia. A pergunta do domínio é "este
 * DIA está dentro da vigência?" — uma tarifa que passa a valer no dia D vale
 * o dia D inteiro, e uma que vale até o dia D ainda vale o dia D inteiro.
 *
 * Antes disto os dois lados comparavam INSTANTES. O marcador de "válida até
 * 09/09" é 00:00:00.000, então qualquer relógio depois disso já a declarava
 * histórica: a tarifa morria durante o próprio dia impresso nela. É a mesma
 * assimetria que §76 corrigiu para a oferta do fornecedor, do outro lado do
 * custo, e a correção é a mesma — perguntar pelo dia.
 *
 * `reference` é a DATA da pergunta, não um relógio. Quem quer saber "está
 * vigente agora?" traduz o instante em dia comercial antes de chamar
 * (`marcadorDeHojeComercial`); às 22h de São Paulo o relógio cru já é o dia
 * seguinte em UTC, e a resposta sairia um dia adiantada.
 */
export function isRateCurrent(rate: RateRow, reference: Date): boolean {
  if (!rate.effectiveAt) return false;
  const dia = diaDaColunaDeData(reference);
  if (diaDaColunaDeData(rate.effectiveAt) > dia) return false;
  if (rate.validUntil && diaDaColunaDeData(rate.validUntil) < dia) return false;
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

/**
 * `reference` é obrigatória de propósito.
 *
 * Enquanto ela tinha `new Date()` por padrão, o DTO decidia vigência pelo
 * relógio do processo — em Railway, UTC — e podia responder um dia diferente
 * do motor sobre a mesma tarifa. Quem chama diz de que DIA está falando.
 */
export function toResourceDTO(
  resource: ResourceWithRates,
  reference: Date,
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
    // Capacidade não cadastrada continua `null` — e não se lê como zero.
    capacityQuantity: resource.capacityQuantity,
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

  // "Vigente agora" é uma pergunta sobre o DIA COMERCIAL da Veridi, nunca
  // sobre o relógio do processo.
  const reference = marcadorDeHojeComercial();
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

  const reference = marcadorDeHojeComercial();
  return {
    resources: rows.map((row) => toResourceDTO(row, reference)),
    ...pageMeta(pagination, total),
  };
}

/**
 * Capacidade só existe onde há capacidade a ocupar.
 *
 * Energia não entra em etapa de roteiro e não disputa recurso com ninguém:
 * guardar um número aqui criaria uma capacidade que nenhuma tela consulta e
 * que a primeira leitura distraída usaria como se valesse.
 */
function assertCapacity(type: string, capacity: number | null | undefined): void {
  if (capacity === null || capacity === undefined) return;
  if (!isCapacityResourceType(type as IndustrialResourceType)) {
    throw new InvalidResourceCapacityError(
      "Capacidade é informação de mão de obra e equipamento — energia não ocupa recurso.",
    );
  }
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
  assertCapacity(input.type, input.capacityQuantity);

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
      ...(input.capacityQuantity !== undefined && input.capacityQuantity !== null
        ? { capacityQuantity: input.capacityQuantity }
        : {}),
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
  if (input.capacityQuantity !== undefined && input.capacityQuantity !== null) {
    assertCapacity(resource.type, input.capacityQuantity);
  }

  await prisma.industrialResource.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.powerKw !== undefined
        ? { powerKw: input.powerKw === null ? null : new Prisma.Decimal(input.powerKw) }
        : {}),
      // `null` explícito APAGA a capacidade: voltar a "não cadastrada" é uma
      // resposta legítima, e diferente de deixar o campo de fora.
      ...(input.capacityQuantity !== undefined
        ? { capacityQuantity: input.capacityQuantity }
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

  /*
   * Tarifa manual vale a partir de HOJE, salvo vigência informada — e "hoje"
   * é o dia comercial, gravado como MARCADOR de dia civil, igual ao que o
   * `<input type="date">` manda quando a pessoa escolhe a data.
   *
   * Antes era `new Date()`, um instante no meio do dia. A coluna passava a
   * misturar duas codificações — marcador de dia e carimbo de tempo — e
   * nenhuma leitura estava certa para as duas: uma tarifa criada às 22h de
   * São Paulo era gravada com o dia seguinte em UTC e só valeria amanhã.
   */
  const effectiveAt =
    input.effectiveAt === undefined ? marcadorDeHojeComercial() : input.effectiveAt;
  const validUntil = input.validUntil ?? null;
  // A comparação é entre DIAS: encerrar a vigência no próprio dia em que ela
  // começa é legítimo — vale aquele dia inteiro.
  if (
    effectiveAt &&
    validUntil &&
    diaDaColunaDeData(validUntil) < diaDaColunaDeData(effectiveAt)
  ) {
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
