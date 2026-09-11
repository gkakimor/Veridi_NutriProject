import { useParams } from "react-router-dom";
import type { IndustrialCostCalculationSnapshotDTO } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { getIndustrialCostCalculation } from "../../lib/cost-calculation-api";
import { PdfScreen } from "../../pdf/PdfScreen";

/**
 * Cálculo de custo industrial em PDF.
 *
 * Documento de análise: de onde veio cada custo unitário, o que ficou
 * desconhecido e qual é a qualidade do resultado — cálculo parcial sai
 * dizendo que é parcial (ver `pdf/documents/CostCalculationPdf`). O arquivo
 * nasce no navegador sobre o cálculo que a API autenticada entrega; o motor
 * de PDF só carrega quando alguém gera o documento.
 */
export function CostCalculationPrintPage() {
  const { id } = useParams<{ id: string }>();
  // Quem gera o arquivo — não substitui quem calculou, que vem do snapshot.
  const geradoPor = useOptionalAuth()?.user?.name ?? null;
  return (
    <PdfScreen<IndustrialCostCalculationSnapshotDTO>
      load={() => getIndustrialCostCalculation(id!)}
      build={async (calculation) => {
        const { CostCalculationPdf, costCalculationPdfFileName } = await import(
          "../../pdf/documents/CostCalculationPdf"
        );
        return {
          document: (
            <CostCalculationPdf calculation={calculation} generatedAt={new Date()} generatedBy={geradoPor} />
          ),
          fileName: costCalculationPdfFileName(calculation),
        };
      }}
      // O id da rota é o do próprio cálculo.
      backTo={`/calculos-custo/${id}`}
    />
  );
}
