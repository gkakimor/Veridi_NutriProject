import { useParams, useSearchParams } from "react-router-dom";
import type { ProductCmvResponse } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { getProductCmv } from "../../lib/product-cmv-api";
import { PdfScreen } from "../../pdf/PdfScreen";

/**
 * CMV em PDF — a base econômica congelada de uma quantidade.
 *
 * Mesma carga de antes (produto, quantidade e data de referência da rota); o
 * documento (`pdf/documents/CmvPdf`) entra por `import()`.
 */
export function CmvPrintPage() {
  const { productId } = useParams<{ productId: string }>();
  const [params] = useSearchParams();
  const quantity = params.get("quantity") ?? "1000";
  const referenceDate = params.get("referenceDate") ?? new Date().toISOString().slice(0, 10);
  const geradoPor = useOptionalAuth()?.user?.name ?? null;

  return (
    <PdfScreen<ProductCmvResponse>
      load={() => getProductCmv(productId!, { quantity, referenceDate })}
      build={async (data) => {
        const { CmvPdf, cmvPdfFileName } = await import("../../pdf/documents/CmvPdf");
        return {
          document: (
            <CmvPdf
              data={data}
              quantity={quantity}
              referenceDate={referenceDate}
              generatedAt={new Date()}
              generatedBy={geradoPor}
            />
          ),
          fileName: cmvPdfFileName(data, quantity, referenceDate),
        };
      }}
      backTo={`/produtos/${productId}/cmv?quantity=${quantity}&referenceDate=${referenceDate}`}
    />
  );
}
