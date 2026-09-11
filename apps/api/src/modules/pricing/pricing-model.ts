import { Prisma } from "@prisma/client";
import type {
  PricingEstimatedTaxMode,
  PricingIndustrialCostMode,
  PricingModelConfig,
  PricingModelEffect,
} from "@veridi/shared";
import { computePricingModelEffect } from "@veridi/shared";
import type { TierCostResult } from "./pricing-cost.js";
import "../../lib/decimal.js";

/**
 * O efeito do Modelo sobre o custo JÁ calculado de uma faixa — a mesma chamada
 * para a precificação, a prévia da política e a prévia de rebase.
 */
export function efeitoDoModeloNaFaixa(
  cost: TierCostResult,
  model: PricingModelConfig,
): PricingModelEffect {
  return computePricingModelEffect({
    quantity: cost.quantity.toString(),
    materialCostTotal: cost.materialsTotal ? cost.materialsTotal.toString() : null,
    materialCostQuality: cost.materialsQuality,
    calculatedCostTotal: cost.total ? cost.total.toString() : null,
    calculatedCostQuality: cost.quality,
    model,
  });
}

/**
 * As colunas do Modelo de Precificação — `PRODUCT_RULES.md` §84.
 *
 * São as mesmas em `PricingPolicyTemplateVersion` (a regra, na biblioteca) e em
 * `PricingVersion` (a cópia que a precificação do produto usa depois de
 * aplicada). Um tradutor só, nos dois sentidos, para que a cópia nunca perca um
 * campo no caminho — perder o valor de um modo desligado seria exatamente o
 * "desligar apaga" que o Modelo proíbe.
 */
export interface PricingModelColumns {
  industrialCostMode: PricingIndustrialCostMode;
  industrialCostPercentOfMaterials: Prisma.Decimal | null;
  industrialCostAmountPerUnit: Prisma.Decimal | null;
  industrialCostAmountTotal: Prisma.Decimal | null;
  estimatedTaxMode: PricingEstimatedTaxMode;
  estimatedTaxPercentOfSalePrice: Prisma.Decimal | null;
  estimatedTaxAmountPerUnit: Prisma.Decimal | null;
  estimatedTaxAmountTotal: Prisma.Decimal | null;
  externalAdditionalCosts: boolean;
}

const texto = (value: Prisma.Decimal | null): string | null => (value === null ? null : value.toString());
const decimal = (value: string | null): Prisma.Decimal | null =>
  value === null ? null : new Prisma.Decimal(value);

/** Linha do banco → Modelo, com os valores de todos os modos, ligados ou não. */
export function modeloDasColunas(row: PricingModelColumns): PricingModelConfig {
  return {
    industrialCostMode: row.industrialCostMode,
    industrialCostPercentOfMaterials: texto(row.industrialCostPercentOfMaterials),
    industrialCostAmountPerUnit: texto(row.industrialCostAmountPerUnit),
    industrialCostAmountTotal: texto(row.industrialCostAmountTotal),
    estimatedTaxMode: row.estimatedTaxMode,
    estimatedTaxPercentOfSalePrice: texto(row.estimatedTaxPercentOfSalePrice),
    estimatedTaxAmountPerUnit: texto(row.estimatedTaxAmountPerUnit),
    estimatedTaxAmountTotal: texto(row.estimatedTaxAmountTotal),
    externalAdditionalCosts: row.externalAdditionalCosts,
  };
}

/** Modelo → colunas, para gravar ou copiar. */
export function colunasDoModelo(model: PricingModelConfig): PricingModelColumns {
  return {
    industrialCostMode: model.industrialCostMode,
    industrialCostPercentOfMaterials: decimal(model.industrialCostPercentOfMaterials),
    industrialCostAmountPerUnit: decimal(model.industrialCostAmountPerUnit),
    industrialCostAmountTotal: decimal(model.industrialCostAmountTotal),
    estimatedTaxMode: model.estimatedTaxMode,
    estimatedTaxPercentOfSalePrice: decimal(model.estimatedTaxPercentOfSalePrice),
    estimatedTaxAmountPerUnit: decimal(model.estimatedTaxAmountPerUnit),
    estimatedTaxAmountTotal: decimal(model.estimatedTaxAmountTotal),
    externalAdditionalCosts: model.externalAdditionalCosts,
  };
}

/** Copia as colunas de uma linha para outra, sem passar por texto. */
export function copiarColunasDoModelo(row: PricingModelColumns): PricingModelColumns {
  return {
    industrialCostMode: row.industrialCostMode,
    industrialCostPercentOfMaterials: row.industrialCostPercentOfMaterials,
    industrialCostAmountPerUnit: row.industrialCostAmountPerUnit,
    industrialCostAmountTotal: row.industrialCostAmountTotal,
    estimatedTaxMode: row.estimatedTaxMode,
    estimatedTaxPercentOfSalePrice: row.estimatedTaxPercentOfSalePrice,
    estimatedTaxAmountPerUnit: row.estimatedTaxAmountPerUnit,
    estimatedTaxAmountTotal: row.estimatedTaxAmountTotal,
    externalAdditionalCosts: row.externalAdditionalCosts,
  };
}
