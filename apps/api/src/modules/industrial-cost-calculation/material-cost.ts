import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { IndustrialMaterialCostSource } from "@veridi/shared";
import { getItemCostReference } from "../../lib/cost-reference.js";
import type { UomDimension } from "@prisma/client";
import { convertUomDecimal, isUomCompatible } from "../items/uom.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export interface MaterialCostResolution {
  /** `null` sempre que o custo é desconhecido — nunca zero. */
  unitCost: Prisma.Decimal | null;
  source: IndustrialMaterialCostSource;
  details: string | null;
}

type UnitLike = { code: string; dimension: UomDimension; toBaseFactor: Prisma.Decimal };

/**
 * Referência de custo de material para o cálculo PROSPECTIVO.
 *
 * A hierarquia da Foundation continua sendo a fonte primária — média
 * ponderada de 30 dias, depois 90, depois último custo real. Só quando não
 * existe NENHUMA compra real conhecida é que se olha para a referência
 * comercial do fornecedor, e mesmo assim como estimativa explícita: oferta
 * é preço proposto, não custo incorrido.
 *
 * Nada aqui inventa decisão comercial: com vários fornecedores homologados
 * e nenhum preferencial, o custo fica desconhecido em vez de "o mais
 * barato".
 */
export async function resolveMaterialCost(
  prisma: PrismaOrTx,
  params: { itemId: string; itemUnitCode: string; referenceDate: Date },
  units: readonly UnitLike[],
): Promise<MaterialCostResolution> {
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

  return resolveSupplierOfferCost(prisma, params, units);
}

/**
 * Último recurso antes de "sem custo": a oferta vigente de um fornecedor
 * homologado. Regras rígidas de elegibilidade — relação e fornecedor
 * ativos, item homologado, preço em BRL (sem câmbio nesta fase), vigência
 * válida na data de referência e unidade convertível.
 *
 * Oferta LEGACY_IMPORT sem vigência continua visível no sourcing, mas nunca
 * vira custo só por ser o único número disponível.
 */
async function resolveSupplierOfferCost(
  prisma: PrismaOrTx,
  params: { itemId: string; itemUnitCode: string; referenceDate: Date },
  units: readonly UnitLike[],
): Promise<MaterialCostResolution> {
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

  const preferred = candidates.find((candidate) => candidate.preferred);
  if (preferred) {
    return {
      unitCost: preferred.unitCost,
      source: "SUPPLIER_OFFER_PREFERRED",
      details: `Referência comercial de ${preferred.supplierName} (R$ ${preferred.offerPrice.toString()}/${preferred.priceUomCode}) — estimativa, não custo real.`,
    };
  }

  if (candidates.length === 1) {
    const only = candidates[0]!;
    return {
      unitCost: only.unitCost,
      source: "SUPPLIER_OFFER_SINGLE_APPROVED",
      details: `Referência comercial de ${only.supplierName} (R$ ${only.offerPrice.toString()}/${only.priceUomCode}), único fornecedor homologado — estimativa, não custo real.`,
    };
  }

  // Escolher o menor preço seria tomar decisão de compra no lugar de gente.
  return {
    unitCost: null,
    source: "AMBIGUOUS_SUPPLIER_REFERENCE",
    details: `${candidates.length} fornecedores homologados com oferta vigente e nenhum preferencial.`,
  };
}
