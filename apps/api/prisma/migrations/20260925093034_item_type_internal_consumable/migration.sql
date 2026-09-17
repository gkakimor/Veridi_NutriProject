-- AlterEnum
ALTER TYPE "ItemType" ADD VALUE 'INTERNAL_CONSUMABLE';

-- Sequence dedicada do novo tipo — a mesma convenção dos três originais
-- (20260815090000_items_and_uom): nextval é atômico, então o código UC-000001
-- nunca depende de MAX(code)+1 e nunca colide sob concorrência.
--
-- Fica na MESMA migration do valor de enum de propósito: um tipo sem a
-- sequence dele criaria item sem código, e nenhuma das duas metades tem
-- sentido sozinha. `ALTER TYPE ... ADD VALUE` e `CREATE SEQUENCE` convivem na
-- mesma transação porque o valor novo não é USADO aqui — só declarado.
CREATE SEQUENCE "item_code_internal_consumable_seq" START WITH 1;
