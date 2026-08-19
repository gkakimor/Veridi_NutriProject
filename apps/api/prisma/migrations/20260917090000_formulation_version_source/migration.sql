-- Origem declarada de uma versão de formulação.
--
-- Voltar para uma receita antiga só é honesto para frente: a V1 não é
-- reativada, uma V3 nasce igual a ela. Sem registrar de qual versão a nova
-- foi tirada, o salto de custo entre V2 e V3 fica sem explicação meses
-- depois — a história existe no banco e não pode ser lida.
--
-- `sourceVersionNumber` é gravado junto com o id de propósito: o rótulo
-- ("V3 — criada a partir da V1") é histórico e não deve depender de join
-- para existir.
ALTER TABLE "formulation_versions"
  ADD COLUMN IF NOT EXISTS "sourceVersionId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceVersionNumber" INTEGER;

CREATE INDEX IF NOT EXISTS "formulation_versions_sourceVersionId_idx"
  ON "formulation_versions"("sourceVersionId");

ALTER TABLE "formulation_versions"
  DROP CONSTRAINT IF EXISTS "formulation_versions_sourceVersionId_fkey";

ALTER TABLE "formulation_versions"
  ADD CONSTRAINT "formulation_versions_sourceVersionId_fkey"
  FOREIGN KEY ("sourceVersionId") REFERENCES "formulation_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
