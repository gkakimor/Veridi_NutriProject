-- CUSTOMER-PAYMENT-DEFAULTS-01 — forma de pagamento e pagamento padrão do Cliente.
--
-- Somente aditiva: tipo novo e colunas NULL, sem DEFAULT, sem NOT NULL, sem
-- UPDATE e sem backfill. Cliente, versão de orçamento e Pedido que já existiam
-- ficam com tudo NULL ("não informado"); nada é inferido do texto livre
-- `paymentTerms`, do legado nem de propostas aceitas.

-- CreateEnum
CREATE TYPE "PaymentInstrument" AS ENUM ('PIX', 'BOLETO', 'BANK_TRANSFER', 'CARD', 'OTHER');

-- AlterTable
ALTER TABLE "customer_orders" ADD COLUMN     "agreedPaymentInstrument" "PaymentInstrument";

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "defaultDownPaymentPercent" DECIMAL(7,4),
ADD COLUMN     "defaultInstallmentCount" INTEGER,
ADD COLUMN     "defaultInstallmentIntervalDays" INTEGER,
ADD COLUMN     "defaultMonthlyInterestPercent" DECIMAL(7,4),
ADD COLUMN     "defaultPaymentInstrument" "PaymentInstrument",
ADD COLUMN     "defaultPaymentMethod" "QuotePaymentMethod";

-- AlterTable
ALTER TABLE "quote_versions" ADD COLUMN     "paymentInstrument" "PaymentInstrument";
