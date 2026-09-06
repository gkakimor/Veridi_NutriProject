-- PREC-MIG-P / PREC-P-TECH — preço TÉCNICO da precificação para DECIMAL(20,8).
--
-- BACKLOG #19 / PRODUCT_RULES.md §58: UNIT_PRICE técnico em `DECIMAL(20,8)`.
-- A cadeia da precificação nasce num motor de 40 dígitos e termina num
-- documento comercial de 4 casas; entre os dois havia DOIS cortes que ninguém
-- decidiu. O primeiro era este: `P = C ÷ (1 − margem − comissão)` produzia
-- `4.05318764` e a coluna de seis casas gravava `4.053188` — sem `.toFixed()`
-- no código, sem aviso, sem registro. Quem cortava era o PostgreSQL.
--
-- QUATRO colunas, a família técnica inteira. A cadeia
-- `PricingTier.selectedPriceSnapshot → QuoteLine.pricingSelectedUnitPriceSnapshot`
-- é cópia exata: alargar só a ponta trocaria um corte silencioso por outro,
-- no congelamento da proveniência. Move-se inteira ou não se move.
--
-- SOMENTE widening de precisão. Zero backfill, zero UPDATE, zero recálculo.
-- A parte inteira CRESCE de 8 para 12 dígitos (14,6 -> 20,8), então nenhum
-- valor existente pode estourar; o valor gravado permanece o mesmo e passa a
-- ser reescrito com zeros à direita (`4.053187` -> `4.05318700`). Casa que
-- nunca foi persistida não se reconstrói: uma faixa ativada antes desta
-- migration continua valendo o que valia.
--
-- PREÇO TÉCNICO NÃO É PREÇO COMERCIAL. O fechamento de 8 para 4 casas
-- continua acontecendo, e passa a ser explícito, em código de domínio
-- (`fecharPrecoUnitarioComercial`), na única fronteira onde faz sentido: o
-- vínculo da faixa com a linha do Orçamento. Depois dele, `QuoteLine.unitPrice`,
-- `CustomerOrderLine.agreedUnitPrice` e os dois preços de `BillingLine`
-- continuam em `DECIMAL(14,4)`, e a regra comercial #15 do total de documento
-- não muda: `subtotal = Σ round(quantidade × preço unitário comercial, 2)`.
--
-- Esta migration NÃO implementa BACKLOG #18 e não toca no total da Ordem de
-- Compra.
--
-- O diff gerado pelo Prisma traz junto o drift conhecido de BACKLOG #14
-- (chaves estrangeiras RESTRICT/SET NULL, renomeação de índices e
-- constraints). Removido na revisão linha a linha exigida por
-- TECH_BASELINE.md, "Migration order". Esta migration não o aplica.
--
-- FORA desta migration, de propósito — cada um com motivo próprio:
--   QuoteLine.unitPrice                UNIT_PRICE contratual editável — §58,
--                                      PREC-P-05: MANTER em 14,4 por decisão
--                                      do PO. É o preço do documento.
--   CustomerOrderLine.agreedUnitPrice  UNIT_PRICE contratual congelado — §58
--   BillingLine.agreedUnitPrice/.unitPrice  contratual/emitido — §58
--   PricingTier.commissionPerUnitSnapshot, .contributionPerUnitSnapshot e
--   QuoteLine.contributionPerUnitSnapshot   TECHNICAL_RESULT em 14,6; saem do
--                                      mesmo motor, mas a categoria é outra e
--                                      a decisão é do PREC-MIG-D.

ALTER TABLE "pricing_tiers" ALTER COLUMN "manualUnitPrice" SET DATA TYPE DECIMAL(20,8);
ALTER TABLE "pricing_tiers" ALTER COLUMN "suggestedPriceSnapshot" SET DATA TYPE DECIMAL(20,8);
ALTER TABLE "pricing_tiers" ALTER COLUMN "selectedPriceSnapshot" SET DATA TYPE DECIMAL(20,8);

ALTER TABLE "quote_lines" ALTER COLUMN "pricingSelectedUnitPriceSnapshot" SET DATA TYPE DECIMAL(20,8);
