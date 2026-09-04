-- Referencia manual de custo do Item, com historico por vigencia.
--
-- Uma referencia e uma ESTIMATIVA declarada por gente: nao e compra, nao e
-- recebimento, nao e valor pago. Entra na selecao automatica de fonte de
-- custo como ultima fonte antes de "desconhecido":
--
--   compra real 30 dias > compra real 90 dias > ultima compra real
--   > oferta valida de fornecedor > referencia manual > desconhecido.
--
-- Historico: alterar a referencia INSERE uma linha nova; nada e apagado nem
-- reescrito. A referencia valida numa data e a de maior "effectiveFrom" ate
-- aquele dia. Calculos salvos congelam o valor usado no proprio documento,
-- entao nenhum custo historico e reinterpretado por esta migration.
--
-- Tudo aditivo: tabela nova, dois valores novos num enum que nenhuma coluna
-- usa (a fonte viaja dentro do JSON do calculo salvo). Nenhum dado existente
-- muda. Escrita a mao, como as anteriores: `migrate dev` arrasta um drift do
-- repositorio que nao pertence a esta mudanca.

CREATE TABLE "item_cost_references" (
  "id"                    TEXT NOT NULL,
  "itemId"                TEXT NOT NULL,
  "unitCost"              DECIMAL(14,4) NOT NULL,
  "currencyCode"          VARCHAR(3) NOT NULL DEFAULT 'BRL',
  "uomCode"               TEXT NOT NULL,
  "effectiveFrom"         TIMESTAMP(3) NOT NULL,
  "note"                  TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId"       TEXT,
  "createdByNameSnapshot" TEXT,
  CONSTRAINT "item_cost_references_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "item_cost_references_itemId_effectiveFrom_idx"
  ON "item_cost_references"("itemId", "effectiveFrom");

ALTER TABLE "item_cost_references"
  ADD CONSTRAINT "item_cost_references_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "item_cost_references"
  ADD CONSTRAINT "item_cost_references_uomCode_fkey"
  FOREIGN KEY ("uomCode") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "item_cost_references"
  ADD CONSTRAINT "item_cost_references_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "IndustrialMaterialCostSource" ADD VALUE IF NOT EXISTS 'MANUAL_REFERENCE';
ALTER TYPE "IndustrialMaterialCostSource" ADD VALUE IF NOT EXISTS 'MANUAL_REFERENCE_FORCED';
