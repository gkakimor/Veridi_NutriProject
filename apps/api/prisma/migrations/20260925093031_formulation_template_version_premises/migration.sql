-- AlterTable
ALTER TABLE "formulation_template_versions" ADD COLUMN     "capsulesPerDose" INTEGER,
ADD COLUMN     "dosageForm" "DosageForm",
ADD COLUMN     "doseAmount" DECIMAL(24,12),
ADD COLUMN     "doseUomCode" TEXT,
ADD COLUMN     "expectedLossPercent" DECIMAL(9,6),
ADD COLUMN     "packageContentAmount" DECIMAL(24,12),
ADD COLUMN     "packageContentUomCode" TEXT,
ADD COLUMN     "presentationType" "PresentationType";

-- AddForeignKey
ALTER TABLE "formulation_template_versions" ADD CONSTRAINT "formulation_template_versions_doseUomCode_fkey" FOREIGN KEY ("doseUomCode") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulation_template_versions" ADD CONSTRAINT "formulation_template_versions_packageContentUomCode_fkey" FOREIGN KEY ("packageContentUomCode") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
