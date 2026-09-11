import { PURCHASE_ORDER_STATUS_LABELS } from "@veridi/shared";
import type { PurchaseOrderDTO } from "@veridi/shared";
import {
  PdfDataGrid,
  PdfDocument,
  PdfParagraph,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTotals,
  PdfTr,
  type PdfColumn,
} from "../components";
import {
  formatBRL,
  formatCnpj,
  formatDate,
  formatQuantity,
  formatUnitPriceBRL,
  orDash,
  pdfFileName,
} from "../format";

/**
 * Ordem de compra — o pedido ao fornecedor.
 *
 * O fornecedor é a informação principal. O preço é o PREVISTO (negociado),
 * nunca custo real, e preço ausente sai "—", nunca zero. Quantidade, recebido
 * e em aberto ficam lado a lado; o dinheiro fecha a linha na borda direita, em
 * colunas de largura fixa, com o valor previsto logo abaixo delas.
 */

const COLUNAS: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Quantidade", width: 60, align: "right" },
  { header: "Recebido", width: 56, align: "right" },
  { header: "Em aberto", width: 56, align: "right" },
  { header: "Unidade", width: 46, align: "center" },
  { header: "Preço previsto", width: 76, align: "right" },
  { header: "Total da linha", width: 80, align: "right" },
];

export function purchaseOrderPdfFileName(order: Pick<PurchaseOrderDTO, "code">): string {
  return pdfFileName(order.code);
}

export function PurchaseOrderPdf({ order, generatedAt }: { order: PurchaseOrderDTO; generatedAt: Date }) {
  return (
    <PdfDocument
      title="Ordem de compra"
      code={order.code}
      status={PURCHASE_ORDER_STATUS_LABELS[order.status]}
      isDraft={order.status === "DRAFT"}
      generatedAt={generatedAt}
    >
      <PdfSection title="Fornecedor">
        <PdfDataGrid
          fields={[
            { label: "Razão social", value: orDash(order.supplierName), span: 8 },
            { label: "CNPJ", value: order.supplierCnpj ? formatCnpj(order.supplierCnpj) : "—", span: 4 },
            { label: "Código do fornecedor", value: order.supplierCode, span: 4, optional: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Dados da ordem">
        <PdfDataGrid
          fields={[
            { label: "Data do pedido", value: formatDate(order.orderDate), span: 3 },
            { label: "Previsão de entrega", value: formatDate(order.expectedDeliveryDate), span: 3 },
            {
              label: "Origem",
              value: order.origin === "CUSTOMER_ORDER" ? "Pedido do cliente" : "Manual",
              span: 3,
            },
            { label: "Pedido relacionado", value: order.customerOrderCode, span: 3, optional: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Itens">
        <PdfTable columns={COLUNAS} isEmpty={order.lines.length === 0} emptyMessage="Ordem sem itens.">
          {/* Preço e total ausentes saem "—" pelo próprio formatador — nunca zero. */}
          {order.lines.map((line) => (
            <PdfTr key={line.id}>
              <PdfTd>{`${line.itemCode} — ${line.itemName}`}</PdfTd>
              <PdfTd>{formatQuantity(line.orderedQuantity)}</PdfTd>
              <PdfTd>{formatQuantity(line.receivedQuantity)}</PdfTd>
              <PdfTd>{formatQuantity(line.openQuantity)}</PdfTd>
              <PdfTd>{line.unitCode}</PdfTd>
              <PdfTd>{formatUnitPriceBRL(line.unitPrice)}</PdfTd>
              <PdfTd>{formatBRL(line.lineTotal)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
        <PdfTotals
          lines={[
            order.orderTotal
              ? { label: "Valor previsto", value: formatBRL(order.orderTotal), grand: true }
              : // Sem preço não há valor previsto: o papel diz isso, não inventa zero.
                { label: "Valor previsto", value: "Preço incompleto — total não disponível" },
          ]}
        />
      </PdfSection>

      {order.notes ? (
        <PdfSection title="Observações">
          <PdfParagraph>{order.notes}</PdfParagraph>
        </PdfSection>
      ) : null}
    </PdfDocument>
  );
}
