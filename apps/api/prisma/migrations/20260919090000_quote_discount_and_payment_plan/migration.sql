-- Desconto comercial e plano de pagamento no orçamento.
--
-- O plano é DERIVADO destes campos: valor de parcela não se digita, senão a
-- proposta impressa e a conta do sistema divergem sem ninguém perceber.
CREATE TYPE "QuotePaymentMethod" AS ENUM ('CASH', 'INSTALLMENTS');

ALTER TABLE "quote_versions"
  ADD COLUMN "discountPercent" DECIMAL(7,4),
  ADD COLUMN "paymentMethod" "QuotePaymentMethod" NOT NULL DEFAULT 'CASH',
  ADD COLUMN "downPaymentPercent" DECIMAL(7,4),
  ADD COLUMN "installmentCount" INTEGER,
  ADD COLUMN "installmentIntervalDays" INTEGER,
  ADD COLUMN "monthlyInterestPercent" DECIMAL(7,4);
