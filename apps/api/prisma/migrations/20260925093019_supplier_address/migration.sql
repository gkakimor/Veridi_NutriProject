-- Endereco estruturado do Fornecedor — SUPPLIER-ADDRESS-01.
--
-- Mesmo modelo do Cliente, campo a campo. Aditiva e toda nullable: os
-- fornecedores que ja existem continuam validos com tudo em NULL, e
-- nenhum fluxo de Compras passa a exigir endereco. `zipCode` guarda
-- somente digitos; a mascara 00000-000 e da UI.

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "city" TEXT,
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "zipCode" TEXT;
