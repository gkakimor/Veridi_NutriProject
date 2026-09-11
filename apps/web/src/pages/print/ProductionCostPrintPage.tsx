import { useParams } from "react-router-dom";
import type { ProductionOrderCostDTO } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { getProductionOrderCost } from "../../lib/cost-calculation-api";
import { PdfScreen } from "../../pdf/PdfScreen";

/**
 * Custo industrial de uma produção em PDF, documento SEPARADO da OP.
 *
 * A Ordem de Produção impressa (R.PRO.002) é documento controlado de chão de
 * fábrica: custo não entra lá. Este arquivo diz exatamente o que é —
 * materiais realizados somados a custos industriais PADRÃO aplicados (ver
 * `pdf/documents/ProductionCostPdf`). Nasce no navegador sobre o custo que a
 * API autenticada entrega; o motor de PDF só carrega quando alguém gera.
 */
export function ProductionCostPrintPage() {
  const { id } = useParams<{ id: string }>();
  // Quem gera o arquivo — não substitui quem executou a produção.
  const geradoPor = useOptionalAuth()?.user?.name ?? null;
  return (
    <PdfScreen<ProductionOrderCostDTO>
      load={() => getProductionOrderCost(id!)}
      build={async (cost) => {
        const { ProductionCostPdf, productionCostPdfFileName } = await import(
          "../../pdf/documents/ProductionCostPdf"
        );
        return {
          document: <ProductionCostPdf cost={cost} generatedAt={new Date()} generatedBy={geradoPor} />,
          fileName: productionCostPdfFileName(cost),
        };
      }}
      // O id da rota é o da própria Ordem de Produção.
      backTo={`/producao/ordens/${id}`}
    />
  );
}
