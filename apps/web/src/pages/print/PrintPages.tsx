import { useParams } from "react-router-dom";
import type {
  BillingDTO,
  CustomerOrderDTO,
  LotDTO,
  LotTraceabilityDTO,
  ProductionOrderDTO,
  ProductionOrderMaterialCostDTO,
  QuoteVersionDTO,
  RecipeSheetDTO,
  PurchaseOrderDTO,
  ReceiptDTO,
  ShipmentDTO,
} from "@veridi/shared";
import { getCustomerOrder } from "../../lib/customer-orders-api";
import { getPurchaseOrder } from "../../lib/purchase-orders-api";
import { getReceipt } from "../../lib/receiving-api";
import { getProductionOrder } from "../../lib/production-orders-api";
import { getProductionOrderMaterialCost } from "../../lib/costs-api";
import { getRecipeSheet } from "../../lib/recipe-api";
import { getQuoteVersion } from "../../lib/projects-api";
import { getShipment } from "../../lib/shipments-api";
import { getBilling } from "../../lib/billings-api";
import { getLot, getLotTraceability } from "../../lib/lots-api";
import { PdfScreen } from "../../pdf/PdfScreen";

/**
 * Documentos transacionais em PDF.
 *
 * Rodam FORA do `AppShell` (mesmo padrão da etiqueta de lote): a tela carrega
 * o dado pela API autenticada, gera o PDF no navegador e mostra o próprio
 * arquivo. Cada documento entra por `import()` dentro de `build` — o motor de
 * PDF só chega ao navegador de quem gera um documento. Orientação da folha
 * (a Folha de Receita é paisagem) é decisão do documento, não da tela.
 */

export function CustomerOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<CustomerOrderDTO>
      load={() => getCustomerOrder(id!)}
      build={async (order) => {
        const { CustomerOrderPdf, customerOrderPdfFileName } = await import("../../pdf/documents/CustomerOrderPdf");
        return {
          document: <CustomerOrderPdf order={order} generatedAt={new Date()} />,
          fileName: customerOrderPdfFileName(order),
        };
      }}
      backTo={`/comercial/pedidos/${id}`}
    />
  );
}

export function PurchaseOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<PurchaseOrderDTO>
      load={() => getPurchaseOrder(id!)}
      build={async (order) => {
        const { PurchaseOrderPdf, purchaseOrderPdfFileName } = await import("../../pdf/documents/PurchaseOrderPdf");
        return {
          document: <PurchaseOrderPdf order={order} generatedAt={new Date()} />,
          fileName: purchaseOrderPdfFileName(order),
        };
      }}
      backTo={`/compras/ordens/${id}`}
    />
  );
}

export function ReceiptPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<ReceiptDTO>
      load={() => getReceipt(id!)}
      build={async (receipt) => {
        const { ReceiptPdf, receiptPdfFileName } = await import("../../pdf/documents/ReceiptPdf");
        return {
          document: <ReceiptPdf receipt={receipt} generatedAt={new Date()} />,
          fileName: receiptPdfFileName(receipt),
        };
      }}
      backTo={`/compras/recebimentos/${id}`}
    />
  );
}

export function ProductionOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<{ order: ProductionOrderDTO; cost: ProductionOrderMaterialCostDTO | null }>
      load={async () => {
        const order = await getProductionOrder(id!);
        // Custo é complementar: se não estiver disponível, o documento
        // continua imprimível sem inventar número.
        const cost = await getProductionOrderMaterialCost(id!).catch(() => null);
        return { order, cost };
      }}
      build={async ({ order, cost }) => {
        const { ProductionOrderPdf, productionOrderPdfFileName } = await import(
          "../../pdf/documents/ProductionOrderPdf"
        );
        return {
          document: <ProductionOrderPdf order={order} cost={cost} generatedAt={new Date()} />,
          fileName: productionOrderPdfFileName(order),
        };
      }}
      backTo={`/producao/ordens/${id}`}
    />
  );
}

export function RecipeSheetPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<RecipeSheetDTO>
      load={() => getRecipeSheet(id!)}
      build={async (sheet) => {
        const { RecipeSheetPdf, recipeSheetPdfFileName } = await import("../../pdf/documents/RecipeSheetPdf");
        return {
          document: <RecipeSheetPdf sheet={sheet} generatedAt={new Date()} />,
          fileName: recipeSheetPdfFileName(sheet),
        };
      }}
      backTo={`/producao/ordens/${id}/receita`}
    />
  );
}

export function QuotePrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<QuoteVersionDTO>
      load={() => getQuoteVersion(id!)}
      build={async (quote) => {
        const { QuotePdf, quotePdfFileName } = await import("../../pdf/documents/QuotePdf");
        return {
          document: <QuotePdf quote={quote} generatedAt={new Date()} />,
          fileName: quotePdfFileName(quote),
        };
      }}
      // O id da rota é o da versão do orçamento; o projeto vem do documento.
      backTo={(quote) => `/comercial/projetos/${quote.projectId}`}
    />
  );
}

export function ShipmentPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<ShipmentDTO>
      load={() => getShipment(id!)}
      build={async (shipment) => {
        const { ShipmentPdf, shipmentPdfFileName } = await import("../../pdf/documents/ShipmentPdf");
        return {
          document: <ShipmentPdf shipment={shipment} generatedAt={new Date()} />,
          fileName: shipmentPdfFileName(shipment),
        };
      }}
      backTo={`/comercial/expedicoes/${id}`}
    />
  );
}

export function BillingPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<BillingDTO>
      load={() => getBilling(id!)}
      build={async (billing) => {
        const { BillingPdf, billingPdfFileName } = await import("../../pdf/documents/BillingPdf");
        return {
          document: <BillingPdf billing={billing} generatedAt={new Date()} />,
          fileName: billingPdfFileName(billing),
        };
      }}
      backTo={`/comercial/faturamento/${id}`}
    />
  );
}

export function LotTraceabilityPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PdfScreen<{ lot: LotDTO; traceability: LotTraceabilityDTO }>
      load={async () => {
        const [lot, traceability] = await Promise.all([getLot(id!), getLotTraceability(id!)]);
        return { lot, traceability };
      }}
      build={async ({ lot, traceability }) => {
        const { LotTraceabilityPdf, lotTraceabilityPdfFileName } = await import(
          "../../pdf/documents/LotTraceabilityPdf"
        );
        return {
          document: <LotTraceabilityPdf lot={lot} traceability={traceability} generatedAt={new Date()} />,
          fileName: lotTraceabilityPdfFileName(lot),
        };
      }}
      backTo={`/estoque/lotes/${id}`}
    />
  );
}
