import { useParams } from "react-router-dom";
import type { IndustrialCostVersionDTO } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { getIndustrialCostVersion } from "../../lib/industrial-costs-api";
import { PdfScreen } from "../../pdf/PdfScreen";

/**
 * Estrutura de custos industriais em PDF.
 *
 * Mesma carga de antes; o documento (`pdf/documents/IndustrialCostPdf`) entra
 * por `import()` — o motor de PDF só chega a quem gera um documento. Quem
 * gerou vai no cabeçalho, como na folha impressa anterior.
 */
export function IndustrialCostPrintPage() {
  const { id } = useParams<{ id: string }>();
  const geradoPor = useOptionalAuth()?.user?.name ?? null;

  return (
    <PdfScreen<IndustrialCostVersionDTO>
      load={() => getIndustrialCostVersion(id!)}
      build={async (version) => {
        const { IndustrialCostPdf, industrialCostPdfFileName } = await import(
          "../../pdf/documents/IndustrialCostPdf"
        );
        return {
          document: <IndustrialCostPdf version={version} generatedAt={new Date()} generatedBy={geradoPor} />,
          fileName: industrialCostPdfFileName(version),
        };
      }}
      backTo={(version) => `/produtos/${version.productId}/custos`}
    />
  );
}
