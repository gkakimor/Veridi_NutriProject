-- PRODUCTION-ROUTE-ASSIGNMENT-01 — proveniencia do roteiro gravado na OP.
--
-- Duas colunas aditivas e nulas na copia do roteiro: a ORIGEM da aplicacao que
-- ficou e o MOTIVO informado. Copias anteriores ficam com as duas nulas —
-- "origem nao registrada" — e nada e inferido nem preenchido depois. Sem
-- historico de trocas: a linha continua uma por OP.

-- CreateEnum
CREATE TYPE "ProductionRouteApplicationSource" AS ENUM ('AUTO_PRODUCT_DEFAULT', 'MANUAL_ORDER', 'PRODUCT_DEFAULT_APPLIED', 'DEFAULT_AND_APPLIED', 'LEGACY_REPAIR');

-- AlterTable
ALTER TABLE "production_order_planning_snapshots" ADD COLUMN     "applicationReason" TEXT,
ADD COLUMN     "applicationSource" "ProductionRouteApplicationSource";
