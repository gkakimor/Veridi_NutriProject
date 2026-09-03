-- Reconciliacao de material da Ordem de Producao.
--
-- Tres colunas anulaveis, aditivas: nenhuma linha existente muda de valor e
-- nenhuma leitura atual quebra. Escrita a mao de proposito — `migrate dev`
-- gerou junto um drift acumulado do repositorio (drop/recreate de dezenas de
-- foreign keys e DROP INDEX em indices reais) que nao tem relacao com esta
-- mudanca e nao pode viajar de carona ate producao.
--
-- Ordens ja concluidas continuam como estao. A regra nova vale para CONCLUIR,
-- nao para reescrever documento historico: reconciliar retroativamente uma OP
-- fechada inventaria uma justificativa que ninguem deu.

ALTER TABLE "production_order_requirements"
  ADD COLUMN "varianceReason" TEXT,
  ADD COLUMN "varianceAcceptedBy" TEXT,
  ADD COLUMN "varianceAcceptedAt" TIMESTAMP(3);
