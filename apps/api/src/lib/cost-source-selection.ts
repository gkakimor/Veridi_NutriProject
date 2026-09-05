import { Prisma } from "@prisma/client";
import type { PrismaClient, UomDimension } from "@prisma/client";
import type { IndustrialMaterialCostSource } from "@veridi/shared";
import { getItemCostReference } from "./cost-reference.js";
import { convertUomDecimal, isUomCompatible } from "../modules/items/uom.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

type UnitLike = { code: string; dimension: UomDimension; toBaseFactor: Prisma.Decimal };

/**
 * SELEÇÃO AUTOMÁTICA DA FONTE DE CUSTO — implementação CANÔNICA.
 *
 * Ordem durável (PRODUCT_RULES §53), sem atalho e sem exceção:
 *
 *   1. compra real dos últimos 30 dias (média ponderada por quantidade);
 *   2. compra real dos últimos 90 dias (idem);
 *   3. última compra real;
 *   4. oferta válida de fornecedor homologado;
 *   5. referência manual de custo do Item;
 *   6. desconhecido.
 *
 * Os passos 1–3 vivem em `getItemCostReference` (fundação de custos) e são
 * REUSADOS aqui, nunca reescritos: a média continua ponderada, a
 * `referenceDate` continua explícita. Este módulo só acrescenta os passos
 * 4 e 5 e é o único lugar que conhece a ordem inteira — cálculo de custo,
 * CMV e tela do item chamam `selectItemCostSource` em vez de repetir a
 * regra. A prioridade é entre categorias: ambiguidade dentro de uma
 * categoria de prioridade maior (ofertas válidas sem preferencial) nunca
 * pula em silêncio para a seguinte.
 *
 * O que sai daqui é PROSPECTIVO: custo de material realmente consumido numa
 * OP continua com `getConsumedLotCostReference` (custo do lote real primeiro).
 */
export const COST_SOURCE_PRIORITY: readonly IndustrialMaterialCostSource[] = [
  "WEIGHTED_AVG_30D",
  "WEIGHTED_AVG_90D",
  "LAST_REAL",
  "SUPPLIER_OFFER_PREFERRED",
  "SUPPLIER_OFFER_SINGLE_APPROVED",
  // Ainda é a categoria "oferta válida": ofertas existem, falta escolher.
  "AMBIGUOUS_SUPPLIER_REFERENCE",
  "MANUAL_REFERENCE",
  "NO_COST",
];

export interface CostSourceResolution {
  /** `null` sempre que o custo é desconhecido — nunca zero. */
  unitCost: Prisma.Decimal | null;
  source: IndustrialMaterialCostSource;
  details: string | null;
}

export interface ItemCostSelectionParams {
  itemId: string;
  /** Unidade de estoque do item — tudo é convertido para ela. */
  itemUnitCode: string;
  /** Dia de calendário da pergunta. Nunca "hoje" implícito no domínio. */
  referenceDate: Date;
}

/** `referenceDate` é dia de calendário: o dia inteiro conta. */
function fimDoDia(date: Date): Date {
  const fim = new Date(date);
  fim.setUTCHours(23, 59, 59, 999);
  return fim;
}

/**
 * Ordem CANÔNICA de vigência das referências de um item — a mais recente
 * primeiro. Uma só, usada pela seleção e pelo histórico da tela.
 *
 * Duas referências podem ter o mesmo "válido desde" (corrigir um valor
 * digitado errado no mesmo dia é o caso normal), então o desempate é
 * explícito e testado: a criada por último vence; no empate de `createdAt`
 * (mesmo milissegundo) o `id` maior — arbitrário, mas estável entre
 * chamadas. Sem esse último critério a resposta dependeria da ordem física
 * das linhas.
 */
export const COST_REFERENCE_VALIDITY_ORDER = [
  { effectiveFrom: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] as const;

/**
 * Referência manual vigente para o item na data.
 *
 * A vigência é decidida por `effectiveFrom`: vale a de maior data até o dia
 * pedido, com o desempate de `COST_REFERENCE_VALIDITY_ORDER`. Alterar a
 * referência cria linha nova, então uma consulta histórica encontra a
 * referência que valia naquele dia — não a de hoje.
 */
export async function getManualCostReference(prisma: PrismaOrTx, itemId: string, referenceDate: Date) {
  return prisma.itemCostReference.findFirst({
    where: { itemId, effectiveFrom: { lte: fimDoDia(referenceDate) } },
    orderBy: [...COST_REFERENCE_VALIDITY_ORDER],
  });
}

export interface ManualReferenceResolution {
  referenceId: string;
  /** Na unidade do item. */
  unitCost: Prisma.Decimal;
  /** Como foi declarada. */
  declaredUnitCost: Prisma.Decimal;
  declaredUomCode: string;
  effectiveFrom: Date;
  note: string | null;
}

/**
 * Referência manual vigente, já convertida para a unidade do item.
 *
 * `null` quando não há referência ou quando a unidade declarada não
 * converte para a do item — um número em unidade incompatível não é custo,
 * e inventar equivalência seria pior que "não informado".
 */
export async function resolveManualReference(
  prisma: PrismaOrTx,
  params: ItemCostSelectionParams,
  units: readonly UnitLike[],
): Promise<ManualReferenceResolution | null> {
  const reference = await getManualCostReference(prisma, params.itemId, params.referenceDate);
  if (!reference) return null;
  if (!isUomCompatible(reference.uomCode, params.itemUnitCode, units)) return null;

  const itemUnitsPerReferenceUnit = convertUomDecimal(
    new Prisma.Decimal(1),
    reference.uomCode,
    params.itemUnitCode,
    units,
  );
  if (itemUnitsPerReferenceUnit.lessThanOrEqualTo(0)) return null;

  return {
    referenceId: reference.id,
    unitCost: reference.unitCost.dividedBy(itemUnitsPerReferenceUnit),
    declaredUnitCost: reference.unitCost,
    declaredUomCode: reference.uomCode,
    effectiveFrom: reference.effectiveFrom,
    note: reference.note,
  };
}

/**
 * "Válido desde" é dia de calendário gravado à meia-noite UTC. Formatar no
 * fuso do servidor (UTC-3) recuava um dia: 04/09 virava 03/09 no texto.
 */
export function diaDaVigencia(date: Date): string {
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function manualReferenceDetails(manual: ManualReferenceResolution): string {
  return `Referência manual de custo (R$ ${manual.declaredUnitCost.toString()}/${manual.declaredUomCode}, válida desde ${diaDaVigencia(manual.effectiveFrom)}) — estimativa, não custo real.`;
}

/**
 * A regra inteira, do passo 1 ao 6. Devolve a PRIMEIRA fonte disponível.
 */
export async function selectItemCostSource(
  prisma: PrismaOrTx,
  params: ItemCostSelectionParams,
  units: readonly UnitLike[],
): Promise<CostSourceResolution> {
  // Passos 1–3: compra real. Mesma função da fundação de custos.
  const foundation = await getItemCostReference(prisma, params.itemId, params.referenceDate);
  if (foundation.unitCost && foundation.source === "ESTIMATED_30D") {
    return { unitCost: foundation.unitCost, source: "WEIGHTED_AVG_30D", details: foundation.details };
  }
  if (foundation.unitCost && foundation.source === "ESTIMATED_90D") {
    return { unitCost: foundation.unitCost, source: "WEIGHTED_AVG_90D", details: foundation.details };
  }
  if (foundation.unitCost && foundation.source === "LAST_REAL_COST") {
    return { unitCost: foundation.unitCost, source: "LAST_REAL", details: foundation.details };
  }

  // Passo 4: oferta válida de fornecedor homologado.
  //
  // A prioridade é entre CATEGORIAS. Havendo ofertas válidas, a categoria
  // existe — e ambiguidade dentro dela (várias sem preferencial, ou mais de
  // um preferencial) NÃO autoriza pular para a categoria seguinte. O
  // resultado é explícito: ofertas disponíveis, seleção necessária. A
  // referência manual só entra aí por escolha de gente, forçada e com motivo.
  const offer = await resolveSupplierOfferCost(prisma, params, units);
  if (offer.unitCost || offer.source === "AMBIGUOUS_SUPPLIER_REFERENCE") return offer;

  // Passo 5: referência manual do item — só quando não há oferta nenhuma.
  const manual = await resolveManualReference(prisma, params, units);
  if (manual) {
    return { unitCost: manual.unitCost, source: "MANUAL_REFERENCE", details: manualReferenceDetails(manual) };
  }

  // Passo 6: desconhecido. Nunca zero.
  return { unitCost: null, source: "NO_COST", details: null };
}

/**
 * Oferta vigente de um fornecedor homologado. Regras rígidas de
 * elegibilidade — relação e fornecedor ativos, item homologado, preço em BRL
 * (sem câmbio nesta fase), vigência válida na data de referência e unidade
 * convertível. Oferta LEGACY_IMPORT sem vigência continua visível no
 * sourcing, mas nunca vira custo só por ser o único número disponível.
 */
async function resolveSupplierOfferCost(
  prisma: PrismaOrTx,
  params: ItemCostSelectionParams,
  units: readonly UnitLike[],
): Promise<CostSourceResolution> {
  const supplierItems = await prisma.supplierItem.findMany({
    where: {
      itemId: params.itemId,
      active: true,
      qualificationStatus: "APPROVED",
      supplier: { active: true },
    },
    include: {
      supplier: { select: { legalName: true } },
      offers: {
        where: {
          currencyCode: "BRL",
          effectiveAt: { not: null, lte: params.referenceDate },
          OR: [{ validUntil: null }, { validUntil: { gte: params.referenceDate } }],
        },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  const candidates: {
    preferred: boolean;
    supplierName: string;
    unitCost: Prisma.Decimal;
    offerPrice: Prisma.Decimal;
    priceUomCode: string;
  }[] = [];

  for (const supplierItem of supplierItems) {
    const offer = supplierItem.offers[0];
    if (!offer) continue;
    // Preço por unidade que não converte para a unidade do item não é
    // custo: transformá-lo em número seria inventar equivalência.
    if (!isUomCompatible(offer.priceUomCode, params.itemUnitCode, units)) continue;

    const itemUnitsPerPriceUnit = convertUomDecimal(
      new Prisma.Decimal(1),
      offer.priceUomCode,
      params.itemUnitCode,
      units,
    );
    if (itemUnitsPerPriceUnit.lessThanOrEqualTo(0)) continue;

    candidates.push({
      preferred: supplierItem.preferred,
      supplierName: supplierItem.supplier.legalName,
      unitCost: offer.unitPrice.dividedBy(itemUnitsPerPriceUnit),
      offerPrice: offer.unitPrice,
      priceUomCode: offer.priceUomCode,
    });
  }

  if (candidates.length === 0) {
    return { unitCost: null, source: "NO_COST", details: null };
  }

  // A. exatamente uma oferta válida: é ela.
  if (candidates.length === 1) {
    const only = candidates[0]!;
    return {
      unitCost: only.unitCost,
      source: "SUPPLIER_OFFER_SINGLE_APPROVED",
      details: `Oferta válida de ${only.supplierName} (R$ ${only.offerPrice.toString()}/${only.priceUomCode}), único fornecedor homologado — estimativa, não custo real.`,
    };
  }

  // B. várias, e exatamente um preferencial: é ele.
  const preferred = candidates.filter((candidate) => candidate.preferred);
  if (preferred.length === 1) {
    const chosen = preferred[0]!;
    return {
      unitCost: chosen.unitCost,
      source: "SUPPLIER_OFFER_PREFERRED",
      details: `Oferta válida de ${chosen.supplierName} (R$ ${chosen.offerPrice.toString()}/${chosen.priceUomCode}), fornecedor preferencial — estimativa, não custo real.`,
    };
  }

  // C/D. várias sem preferencial, ou mais de um preferencial (dado
  // inconsistente): ofertas disponíveis, seleção necessária. Escolher o
  // menor preço, ou o primeiro preferencial, seria decidir no lugar de gente.
  const causa =
    preferred.length > 1
      ? `Existem ${preferred.length} fornecedores marcados como preferenciais ao mesmo tempo para este item — situação inconsistente.`
      : "Existem várias ofertas válidas de fornecedor e nenhuma está definida como preferencial.";
  return {
    unitCost: null,
    source: "AMBIGUOUS_SUPPLIER_REFERENCE",
    details: `${causa} Defina a oferta preferencial ou escolha explicitamente outra fonte para este cálculo.`,
  };
}
