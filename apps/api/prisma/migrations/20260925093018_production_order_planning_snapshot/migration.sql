-- PLANNING-OP-SNAPSHOT-01 (PRODUCT_RULES §89): PLANEJAMENTO PREVISTO da Ordem
-- de Producao — a COPIA do Perfil de Producao padrao do Produto, tirada na
-- criacao da OP.
--
-- Aditiva: uma tabela nova, 1:1 com `production_orders`. Nenhuma OP existente
-- e tocada, e nenhuma e preenchida retroativamente — OP anterior a esta
-- migration continua sem perfil aplicado, que e situacao legitima.
--
-- Sem FK para perfil, versao ou recurso de proposito: a copia vale por valor,
-- e os ids guardados sao proveniencia para a capacidade futura, nunca canal de
-- leitura. Renomear ou desativar um recurso depois nao reescreve o historico.
--
-- A duracao prevista NAO e gravada: sai do motor canonico a cada leitura, para
-- a `plannedQuantity` do momento. Custo (Estrutura de Custos, CMV, Precificacao)
-- segue separado e intocado.

-- CreateTable
CREATE TABLE "production_order_planning_snapshots" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "sourceProfileId" TEXT NOT NULL,
    "sourceProfileCode" TEXT NOT NULL,
    "sourceProfileName" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "sourceVersionNumber" INTEGER NOT NULL,
    "referenceQuantity" DECIMAL(24,12) NOT NULL,
    "referenceUomCode" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_order_planning_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_order_planning_snapshots_productionOrderId_key" ON "production_order_planning_snapshots"("productionOrderId");

-- CreateIndex
CREATE INDEX "production_order_planning_snapshots_sourceVersionId_idx" ON "production_order_planning_snapshots"("sourceVersionId");

-- AddForeignKey
ALTER TABLE "production_order_planning_snapshots" ADD CONSTRAINT "production_order_planning_snapshots_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
