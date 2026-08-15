-- InventoryMovement referencia Item/Lot/ReceiptLine, mas nenhum dos tres e
-- excluido fisicamente em producao (soft-delete/imutavel por convencao).
-- CASCADE aqui so importa para limpeza de fixture de teste (que exclui
-- Item/Lot/Receipt entre testes) nao esbarrar em RESTRICT.
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_itemId_fkey";
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_lotId_fkey";
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_receiptLineId_fkey";
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "receipt_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
