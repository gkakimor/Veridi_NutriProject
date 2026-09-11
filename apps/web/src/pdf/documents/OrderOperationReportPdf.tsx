import {
  BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  hojeComercial,
} from "@veridi/shared";
import type { OrderOperationDTO } from "@veridi/shared";
import {
  PdfDataGrid,
  PdfDocument,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatBRL, formatDate, formatQuantity, orDash, pdfFileName } from "../format";

/**
 * R-14 — Pedido → Operação: a cadeia completa de um pedido.
 *
 * Consulta de documento único (um pedido), não listagem. O PDF escreve o que
 * a API devolveu, com as mesmas funções e os mesmos textos do impresso
 * anterior. Tabelas de até cinco colunas: retrato basta.
 */

export const R14_TITLE = "Pedido → Operação";

const COLUNAS_ITENS: PdfColumn[] = [
  { header: "Produto", flex: 1 },
  { header: "Quantidade", width: 80, align: "right" },
  { header: "Un.", width: 36, align: "center" },
];

const COLUNAS_PRODUCAO: PdfColumn[] = [
  { header: "OP", width: 72 },
  { header: "Produto", flex: 1 },
  { header: "Situação", width: 90 },
  { header: "Planejado", width: 80, align: "right" },
  { header: "Produzido", width: 80, align: "right" },
];

const COLUNAS_COMPRA: PdfColumn[] = [
  { header: "OC", width: 72 },
  { header: "Fornecedor", flex: 1 },
  { header: "Situação", width: 96 },
  { header: "Itens", width: 44, align: "right" },
  { header: "Entrega prevista", width: 80 },
];

const COLUNAS_EXPEDICAO: PdfColumn[] = [
  { header: "Expedição", width: 80 },
  { header: "Situação", flex: 1 },
  { header: "Confirmada em", width: 90 },
  { header: "Linhas", width: 60, align: "right" },
];

const COLUNAS_FATURAMENTO: PdfColumn[] = [
  { header: "Documento", width: 80 },
  { header: "Expedição", width: 80 },
  { header: "Situação", flex: 1 },
  { header: "Emitido em", width: 80 },
  { header: "Valor", width: 90, align: "right" },
];

/** "R-14-PED-000045-2026-09-11.pdf": relatório, pedido e dia da geração. */
export function orderOperationPdfFileName(data: Pick<OrderOperationDTO, "code">, generatedAt: Date): string {
  return pdfFileName("R-14", data.code, hojeComercial(generatedAt));
}

export function OrderOperationReportPdf({
  data,
  generatedAt,
  generatedBy,
}: {
  data: OrderOperationDTO;
  generatedAt: Date;
  generatedBy: string | null;
}) {
  return (
    <PdfDocument
      title={R14_TITLE}
      // A folha solta diz de que pedido é, não só de que relatório.
      code={`R-14 · ${data.code}`}
      headerLines={[`Gerado por ${orDash(generatedBy)}`]}
      generatedAt={generatedAt}
    >
      <PdfSection title="Pedido">
        <PdfDataGrid
          fields={[
            { label: "Pedido", value: data.code, span: 3 },
            { label: "Cliente", value: data.customerName, span: 9 },
            { label: "Situação", value: CUSTOMER_ORDER_STATUS_LABELS[data.status], span: 4 },
            { label: "Data do pedido", value: formatDate(data.orderDate), span: 4 },
            { label: "Entrega solicitada", value: formatDate(data.requestedDeliveryDate), span: 4 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Itens do pedido">
        <PdfTable columns={COLUNAS_ITENS} isEmpty={data.lines.length === 0} emptyMessage="Pedido sem linhas.">
          {data.lines.map((line) => (
            <PdfTr key={line.customerOrderLineId}>
              <PdfTd>{`${line.productCode} — ${line.productName}`}</PdfTd>
              <PdfTd>{formatQuantity(line.orderedQuantity)}</PdfTd>
              <PdfTd>{line.unitCode}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Ordens de produção">
        <PdfTable
          columns={COLUNAS_PRODUCAO}
          isEmpty={data.productionOrders.length === 0}
          emptyMessage="Nenhuma ordem de produção vinculada."
        >
          {data.productionOrders.map((order) => (
            <PdfTr key={order.productionOrderId}>
              <PdfTd>{order.code}</PdfTd>
              <PdfTd>{order.productCode}</PdfTd>
              <PdfTd>{PRODUCTION_ORDER_STATUS_LABELS[order.status]}</PdfTd>
              <PdfTd>{formatQuantity(order.plannedQuantity)}</PdfTd>
              <PdfTd>{formatQuantity(order.producedQuantity)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Ordens de compra">
        <PdfTable
          columns={COLUNAS_COMPRA}
          isEmpty={data.purchaseOrders.length === 0}
          emptyMessage="Nenhuma ordem de compra vinculada."
        >
          {data.purchaseOrders.map((order) => (
            <PdfTr key={order.purchaseOrderId}>
              <PdfTd>{order.code}</PdfTd>
              <PdfTd>{order.supplierName}</PdfTd>
              <PdfTd>{PURCHASE_ORDER_STATUS_LABELS[order.status]}</PdfTd>
              <PdfTd>{String(order.itemCount)}</PdfTd>
              <PdfTd>{formatDate(order.expectedDeliveryDate)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Expedições">
        <PdfTable columns={COLUNAS_EXPEDICAO} isEmpty={data.shipments.length === 0} emptyMessage="Nenhuma expedição.">
          {data.shipments.map((shipment) => (
            <PdfTr key={shipment.shipmentId}>
              <PdfTd>{shipment.code}</PdfTd>
              <PdfTd>
                {SHIPMENT_STATUS_LABELS[shipment.status as keyof typeof SHIPMENT_STATUS_LABELS] ??
                  shipment.status}
              </PdfTd>
              <PdfTd>{formatDate(shipment.confirmedAt)}</PdfTd>
              <PdfTd>{String(shipment.lines.length)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Faturamento">
        <PdfTable
          columns={COLUNAS_FATURAMENTO}
          isEmpty={data.billings.length === 0}
          emptyMessage="Nenhum faturamento emitido."
        >
          {data.billings.map((billing) => (
            <PdfTr key={billing.billingId}>
              <PdfTd>{billing.code}</PdfTd>
              <PdfTd>{orDash(billing.shipmentCode)}</PdfTd>
              <PdfTd>{BILLING_STATUS_LABELS[billing.status]}</PdfTd>
              <PdfTd>{formatDate(billing.issuedAt)}</PdfTd>
              {/* Valor só existe com precificação completa — nunca zero. O
                  impresso antigo escrevia o decimal cru ("2848.60"). */}
              <PdfTd>{formatBRL(billing.totalAmount)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>
    </PdfDocument>
  );
}
