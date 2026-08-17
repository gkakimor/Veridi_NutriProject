-- Capacidade 41 — importador definitivo / saldo de abertura da migracao.
--
-- O saldo inicial precisa de um evento proprio: nao e recebimento de
-- compra (nao houve OC nem nota), nao e producao e nao e ajuste de
-- inventario (nada estava errado — o estoque simplesmente passou a existir
-- no ERP na data de corte). Sem isso, o unico caminho seria mentir sobre a
-- origem do estoque.

ALTER TYPE "LotOrigin" ADD VALUE 'OPENING_BALANCE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'OPENING_BALANCE';
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'OPENING_BALANCE';
