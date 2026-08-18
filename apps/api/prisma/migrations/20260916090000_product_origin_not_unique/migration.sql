-- Um projeto multiproduto faz nascer vários produtos.
--
-- `originProjectId` era único: só um produto podia declarar que nasceu de um
-- projeto. Com três sabores desenvolvidos na mesma negociação, o segundo
-- produto batia no índice e a criação falhava — o vínculo de origem passa a
-- ser 1:N, que é o que ele sempre quis dizer.
DROP INDEX IF EXISTS "products_originProjectId_key";
CREATE INDEX IF NOT EXISTS "products_originProjectId_idx" ON "products"("originProjectId");
