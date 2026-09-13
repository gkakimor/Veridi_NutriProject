import type { CustomerOrderDTO, ProductionOrderSelectionDocument } from "@veridi/shared";
import { hojeComercial } from "@veridi/shared";
import { PdfBundle } from "../components";
import { CustomerOrderPdf } from "./CustomerOrderPdf";
import { ProductionOrderPdf } from "./ProductionOrderPdf";

/**
 * UM arquivo PDF para uma seleção em massa — BULK-DOCUMENTS-01.
 *
 * Nenhum layout novo: cada registro entra como o SEU documento oficial, o
 * mesmo do botão "PDF" da tela dele — cabeçalho, logo, corpo, rodapé e
 * numeração próprios —, um depois do outro, na ordem em que o servidor
 * resolveu a seleção (a da listagem).
 */

export type SelectionPdfBase = "pedidos-selecionados" | "ordens-producao-selecionadas";

/** `pedidos-selecionados-2026-09-12.pdf` — o dia de quem opera, não o UTC do navegador. */
export function selectionPdfFileName(base: SelectionPdfBase, dia: string = hojeComercial()): string {
  return `${base}-${dia}.pdf`;
}

export function CustomerOrdersSelectionPdf({
  orders,
  generatedAt,
}: {
  orders: CustomerOrderDTO[];
  generatedAt: Date;
}) {
  return (
    <PdfBundle title="Pedidos do cliente selecionados">
      {orders.map((order) => (
        <CustomerOrderPdf key={order.id} order={order} generatedAt={generatedAt} />
      ))}
    </PdfBundle>
  );
}

export function ProductionOrdersSelectionPdf({
  documents,
  generatedAt,
}: {
  documents: ProductionOrderSelectionDocument[];
  generatedAt: Date;
}) {
  return (
    <PdfBundle title="Ordens de produção selecionadas">
      {documents.map(({ order, cost }) => (
        <ProductionOrderPdf key={order.id} order={order} cost={cost} generatedAt={generatedAt} />
      ))}
    </PdfBundle>
  );
}
