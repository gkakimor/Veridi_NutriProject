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
-- Tudo aditivo: uma tabela nova. Nenhum dado existente muda. Escrita a mao,
-- como as anteriores: `migrate dev` arrasta um drift do repositorio que nao
-- pertence a esta mudanca.
--
-- As duas fontes novas (MANUAL_REFERENCE, MANUAL_REFERENCE_FORCED) vivem no
-- tipo de @veridi/shared e viajam dentro do JSON do calculo salvo. O enum
-- "IndustrialMaterialCostSource" do banco nao e usado por coluna nenhuma e
-- fica como esta: esta migration precede, na ordem dos nomes, a que criou o
-- enum, entao nao pode alteralo — e nao precisa.
--
-- Depende so de tabelas anteriores a ela na ordem: items (20260815),
-- units_of_measure (20260815) e users (20260904090000).

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
