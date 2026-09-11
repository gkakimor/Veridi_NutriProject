-- PRICING-TEMPLATE-FLEX-01 — Modelo de Precificação flexível (PRODUCT_RULES.md §84).
--
-- Aditiva. O Modelo (pricing_policy_template_versions) e a precificação
-- (pricing_versions) ganham o que entra no custo que forma o preço: custo
-- industrial e impostos estimados com modo EXPLÍCITO, uma coluna de valor por
-- modo (a base está no nome), gestão externa e, no Modelo, os perfis
-- tributários indicados. Os defaults são o comportamento de antes
-- (CALCULATED, IGNORE, false, []): nenhuma linha existente muda de preço e
-- nenhum backfill é necessário. pricing_tiers ganha o custo que formou o preço
-- e o % de imposto sobre a venda, congelados na ativação — nulos nas faixas
-- ativadas antes, que formaram o preço sobre costPerUnitSnapshot.

-- CreateEnum
CREATE TYPE "PricingIndustrialCostMode" AS ENUM ('CALCULATED', 'IGNORE', 'PERCENT_MATERIAL_COST', 'PER_UNIT', 'TOTAL');

-- CreateEnum
CREATE TYPE "PricingEstimatedTaxMode" AS ENUM ('IGNORE', 'PERCENT_SALE_PRICE', 'PER_UNIT', 'TOTAL');

-- AlterTable
ALTER TABLE "pricing_policy_template_versions" ADD COLUMN     "applicableTaxProfiles" "CustomerTaxProfile"[] DEFAULT ARRAY[]::"CustomerTaxProfile"[],
ADD COLUMN     "estimatedTaxAmountPerUnit" DECIMAL(20,8),
ADD COLUMN     "estimatedTaxAmountTotal" DECIMAL(14,4),
ADD COLUMN     "estimatedTaxMode" "PricingEstimatedTaxMode" NOT NULL DEFAULT 'IGNORE',
ADD COLUMN     "estimatedTaxPercentOfSalePrice" DECIMAL(7,4),
ADD COLUMN     "externalAdditionalCosts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "industrialCostAmountPerUnit" DECIMAL(20,8),
ADD COLUMN     "industrialCostAmountTotal" DECIMAL(14,4),
ADD COLUMN     "industrialCostMode" "PricingIndustrialCostMode" NOT NULL DEFAULT 'CALCULATED',
ADD COLUMN     "industrialCostPercentOfMaterials" DECIMAL(7,4);

-- AlterTable
ALTER TABLE "pricing_tiers" ADD COLUMN     "estimatedTaxPercentSnapshot" DECIMAL(7,4),
ADD COLUMN     "pricingCostPerUnitSnapshot" DECIMAL(24,12);

-- AlterTable
ALTER TABLE "pricing_versions" ADD COLUMN     "estimatedTaxAmountPerUnit" DECIMAL(20,8),
ADD COLUMN     "estimatedTaxAmountTotal" DECIMAL(14,4),
ADD COLUMN     "estimatedTaxMode" "PricingEstimatedTaxMode" NOT NULL DEFAULT 'IGNORE',
ADD COLUMN     "estimatedTaxPercentOfSalePrice" DECIMAL(7,4),
ADD COLUMN     "externalAdditionalCosts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "industrialCostAmountPerUnit" DECIMAL(20,8),
ADD COLUMN     "industrialCostAmountTotal" DECIMAL(14,4),
ADD COLUMN     "industrialCostMode" "PricingIndustrialCostMode" NOT NULL DEFAULT 'CALCULATED',
ADD COLUMN     "industrialCostPercentOfMaterials" DECIMAL(7,4);
