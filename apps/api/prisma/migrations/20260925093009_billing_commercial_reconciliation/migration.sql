-- AlterTable
ALTER TABLE "billings" ADD COLUMN     "commercialAdjustmentAmount" DECIMAL(14,2),
ADD COLUMN     "discountAmount" DECIMAL(14,2),
ADD COLUMN     "discountPercentSnapshot" DECIMAL(7,4),
ADD COLUMN     "grossAmount" DECIMAL(14,2),
ADD COLUMN     "totalAmount" DECIMAL(14,2);
