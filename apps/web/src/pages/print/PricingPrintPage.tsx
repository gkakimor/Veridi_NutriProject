import { useParams } from "react-router-dom";
import type { PricingVersionDTO } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { getPricingVersion } from "../../lib/pricing-api";
import { PdfScreen } from "../../pdf/PdfScreen";

/**
 * Simulação de preço e margem em PDF.
 *
 * Documento INTERNO: não é orçamento ao cliente e não é documento fiscal; o
 * que ele mostra é margem de CONTRIBUIÇÃO (ver `pdf/documents/PricingPdf`).
 * Nasce no navegador sobre a versão que a API autenticada entrega; o motor de
 * PDF só carrega quando alguém gera o documento.
 */
export function PricingPrintPage() {
  const { id } = useParams<{ id: string }>();
  // Quem gera o arquivo — não substitui quem criou ou ativou a versão.
  const geradoPor = useOptionalAuth()?.user?.name ?? null;
  return (
    <PdfScreen<PricingVersionDTO>
      load={() => getPricingVersion(id!)}
      build={async (pricing) => {
        const { PricingPdf, pricingPdfFileName } = await import("../../pdf/documents/PricingPdf");
        return {
          document: <PricingPdf pricing={pricing} generatedAt={new Date()} generatedBy={geradoPor} />,
          fileName: pricingPdfFileName(pricing),
        };
      }}
      // O id da rota é o da própria versão de precificação.
      backTo={`/gestao/precificacao/${id}`}
    />
  );
}
