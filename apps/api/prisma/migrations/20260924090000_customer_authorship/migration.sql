-- Autoria do cadastro de Cliente.
--
-- Aditiva e nullable de proposito: cliente criado antes desta capacidade, ou
-- importado do legado, nao tem autor conhecido. Nenhum backfill — atribuir os
-- registros existentes ao admin que roda a migration inventaria um fato.
-- A tela mostra "Nao disponivel" quando a coluna esta nula.

ALTER TABLE "customers" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "customers" ADD COLUMN "createdByNameSnapshot" TEXT;
ALTER TABLE "customers" ADD COLUMN "updatedByUserId" TEXT;
ALTER TABLE "customers" ADD COLUMN "updatedByNameSnapshot" TEXT;

-- ON DELETE SET NULL: desativar/remover um usuario nunca apaga o cliente. O
-- snapshot do nome sobrevive ao vinculo, que e justamente para o que ele serve.
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
