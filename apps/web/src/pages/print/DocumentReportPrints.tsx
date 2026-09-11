import { useSearchParams } from "react-router-dom";
import type { OrderOperationDTO, ProductionTraceabilityDTO } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { getOrderOperationReport, getProductionTraceabilityReport } from "../../lib/reports-api";
import { PdfScreen } from "../../pdf/PdfScreen";

/**
 * R-06 e R-14 em PDF, em rota dedicada.
 *
 * São consultas de DOCUMENTO ÚNICO (uma OP, um pedido), não listagens
 * tabulares — por isso não têm CSV e ganham um documento próprio em vez de
 * passar pelo documento genérico de relatório. Mesma política: fora do
 * AppShell, o dado vem da API autenticada e o arquivo é gerado no navegador.
 * O módulo do documento só carrega quando alguém gera o PDF.
 */

/** R-06 — Rastreabilidade por OP (consumo e produção REAIS). */
export function ProductionTraceabilityPrintPage() {
  const [params] = useSearchParams();
  const productionOrderId = params.get("productionOrderId") ?? "";
  // Quem gerou o documento — não substitui quem executou cada ato no sistema.
  const generatedBy = useOptionalAuth()?.user?.name ?? null;

  return (
    <PdfScreen<ProductionTraceabilityDTO>
      key={productionOrderId}
      load={async () => {
        if (!productionOrderId) throw new Error("Selecione a Ordem de Produção antes de imprimir.");
        return getProductionTraceabilityReport({ productionOrderId });
      }}
      build={async (data) => {
        const { ProductionTraceabilityReportPdf, productionTraceabilityPdfFileName } = await import(
          "../../pdf/documents/ProductionTraceabilityReportPdf"
        );
        const generatedAt = new Date();
        return {
          document: (
            <ProductionTraceabilityReportPdf data={data} generatedAt={generatedAt} generatedBy={generatedBy} />
          ),
          fileName: productionTraceabilityPdfFileName(data, generatedAt),
        };
      }}
      backTo="/relatorios/producao/rastreabilidade"
    />
  );
}

/** R-14 — Pedido → Operação: a cadeia completa de um pedido. */
export function OrderOperationPrintPage() {
  const [params] = useSearchParams();
  const customerOrderId = params.get("customerOrderId") ?? "";
  const generatedBy = useOptionalAuth()?.user?.name ?? null;

  return (
    <PdfScreen<OrderOperationDTO>
      key={customerOrderId}
      load={async () => {
        if (!customerOrderId) throw new Error("Selecione o pedido antes de imprimir.");
        return getOrderOperationReport({ customerOrderId });
      }}
      build={async (data) => {
        const { OrderOperationReportPdf, orderOperationPdfFileName } = await import(
          "../../pdf/documents/OrderOperationReportPdf"
        );
        const generatedAt = new Date();
        return {
          document: <OrderOperationReportPdf data={data} generatedAt={generatedAt} generatedBy={generatedBy} />,
          fileName: orderOperationPdfFileName(data, generatedAt),
        };
      }}
      backTo="/relatorios/comercial/pedido-operacao"
    />
  );
}
