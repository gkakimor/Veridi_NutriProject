import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import {
  BillingPrintDocument,
  CustomerOrderPrintDocument,
  LotTraceabilityPrintDocument,
  ProductionOrderPrintDocument,
  QuotePrintDocument,
  RecipeSheetPrintDocument,
  PurchaseOrderPrintDocument,
  ReceiptPrintDocument,
  ShipmentPrintDocument,
} from "../../print/documents";
import { PrintActions } from "../../print/PrintLayout";

/**
 * Páginas de impressão dos documentos transacionais.
 *
 * Rodam FORA do `AppShell` (mesmo padrão da etiqueta de lote): sem topbar,
 * sidebar ou formulário — só o documento read-only. O PDF é gerado pelo
 * próprio navegador via `window.print()`; não existe motor de PDF no
 * backend.
 */
function PrintScreen<T>({
  load,
  render,
  backTo,
}: {
  load: () => Promise<T>;
  render: (data: T) => ReactNode;
  backTo: string;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o documento"),
      );
    // A carga depende só do id da rota, resolvido pelo `load` do chamador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="print-doc">
        <p className="form-alert">Não foi possível carregar o documento: {error}</p>
      </div>
    );
  }
  if (!data) return <div className="print-doc">Carregando…</div>;

  return (
    <>
      {render(data)}
      <PrintActions onBack={() => navigate(backTo)} />
    </>
  );
}

export function CustomerOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<CustomerOrderDTO>
      load={() => getCustomerOrder(id!)}
      render={(order) => <CustomerOrderPrintDocument order={order} />}
      backTo={`/comercial/pedidos/${id}`}
    />
  );
}

export function PurchaseOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<PurchaseOrderDTO>
      load={() => getPurchaseOrder(id!)}
      render={(order) => <PurchaseOrderPrintDocument order={order} />}
      backTo={`/compras/ordens/${id}`}
    />
  );
}

export function ReceiptPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<ReceiptDTO>
      load={() => getReceipt(id!)}
      render={(receipt) => <ReceiptPrintDocument receipt={receipt} />}
      backTo={`/compras/recebimentos/${id}`}
    />
  );
}

export function ProductionOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<{ order: ProductionOrderDTO; cost: ProductionOrderMaterialCostDTO | null }>
      load={async () => {
        const order = await getProductionOrder(id!);
        // Custo é complementar: se não estiver disponível, o documento
        // continua imprimível sem inventar número.
        const cost = await getProductionOrderMaterialCost(id!).catch(() => null);
        return { order, cost };
      }}
      render={({ order, cost }) => <ProductionOrderPrintDocument order={order} cost={cost} />}
      backTo={`/producao/ordens/${id}`}
    />
  );
}

export function RecipeSheetPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<RecipeSheetDTO>
      load={() => getRecipeSheet(id!)}
      render={(sheet) => <RecipeSheetPrintDocument sheet={sheet} />}
      backTo={`/producao/ordens/${id}/receita`}
    />
  );
}

export function QuotePrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<QuoteVersionDTO>
      load={() => getQuoteVersion(id!)}
      render={(quote) => <QuotePrintDocument quote={quote} />}
      backTo={`/comercial/projetos/${id}`}
    />
  );
}

export function ShipmentPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<ShipmentDTO>
      load={() => getShipment(id!)}
      render={(shipment) => <ShipmentPrintDocument shipment={shipment} />}
      backTo={`/comercial/expedicoes/${id}`}
    />
  );
}

export function BillingPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<BillingDTO>
      load={() => getBilling(id!)}
      render={(billing) => <BillingPrintDocument billing={billing} />}
      backTo={`/comercial/faturamento/${id}`}
    />
  );
}

export function LotTraceabilityPrintPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PrintScreen<{ lot: LotDTO; traceability: LotTraceabilityDTO }>
      load={async () => {
        const [lot, traceability] = await Promise.all([getLot(id!), getLotTraceability(id!)]);
        return { lot, traceability };
      }}
      render={({ lot, traceability }) => (
        <LotTraceabilityPrintDocument lot={lot} traceability={traceability} />
      )}
      backTo={`/estoque/lotes/${id}`}
    />
  );
}
