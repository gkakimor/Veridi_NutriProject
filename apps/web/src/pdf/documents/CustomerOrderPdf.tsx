import { CUSTOMER_ORDER_STATUS_LABELS } from "@veridi/shared";
import type { CustomerOrderDTO } from "@veridi/shared";
import {
  PdfDataGrid,
  PdfDocument,
  PdfNotice,
  PdfParagraph,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatCnpj, formatDate, formatQuantity, orDash, pdfFileName } from "../format";

/**
 * Pedido do cliente — documento INTERNO de acompanhamento.
 *
 * A folha mostra reservado, faturado e falta expedir: posição de atendimento,
 * assunto de dentro da fábrica. Os documentos irmãos que vão ao cliente já
 * dizem o que são; este saía sem dizer nada e podia ser entregue no balcão
 * como se fosse confirmação de pedido. O aviso abre a primeira folha e a
 * natureza do documento fica no rodapé de todas.
 */

export const CUSTOMER_ORDER_INTERNAL_NOTICE =
  "Documento interno de acompanhamento — mostra reservado, faturado e falta expedir; não é documento fiscal nem confirmação ao cliente.";

export const CUSTOMER_ORDER_FOOTER_NOTE =
  "Documento interno — não é documento fiscal nem confirmação ao cliente.";

/** Produto leva a sobra da largura; as quantidades ficam em colunas fixas. */
const COLUNAS: PdfColumn[] = [
  { header: "Produto", flex: 1 },
  { header: "Pedido", width: 64, align: "right" },
  { header: "Reservado/Expedido", width: 92, align: "right" },
  { header: "Faturado", width: 64, align: "right" },
  { header: "Falta expedir", width: 68, align: "right" },
  { header: "Unidade", width: 48, align: "center" },
];

export function customerOrderPdfFileName(order: Pick<CustomerOrderDTO, "code">): string {
  return pdfFileName(order.code);
}

export function CustomerOrderPdf({ order, generatedAt }: { order: CustomerOrderDTO; generatedAt: Date }) {
  /*
   * Origem comercial: sem ela ninguém sabe de qual proposta o pedido saiu. Só
   * a identidade — o acordo inteiro continua no orçamento.
   */
  const origemComercial = order.commercialOrigin
    ? `${order.commercialOrigin.quoteCode} · V${order.commercialOrigin.quoteVersionNumber}`
    : null;

  return (
    <PdfDocument
      title="Pedido do cliente"
      code={order.code}
      status={CUSTOMER_ORDER_STATUS_LABELS[order.status]}
      isDraft={order.status === "DRAFT"}
      footerNote={CUSTOMER_ORDER_FOOTER_NOTE}
      generatedAt={generatedAt}
    >
      <PdfNotice>{CUSTOMER_ORDER_INTERNAL_NOTICE}</PdfNotice>

      <PdfSection title="Cliente">
        <PdfDataGrid
          fields={[
            { label: "Razão social", value: orDash(order.customerName), span: 8 },
            { label: "CNPJ", value: order.customerCnpj ? formatCnpj(order.customerCnpj) : "—", span: 4 },
            { label: "Nome fantasia", value: order.customerTradeName, span: 8, optional: true },
            { label: "Código do cliente", value: order.customerCode, span: 4, optional: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Dados do pedido">
        <PdfDataGrid
          fields={[
            { label: "Data do pedido", value: formatDate(order.orderDate), span: 3 },
            { label: "Entrega solicitada", value: formatDate(order.requestedDeliveryDate), span: 3 },
            { label: "Origem comercial", value: origemComercial, span: 6, optional: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Produtos">
        <PdfTable columns={COLUNAS} isEmpty={order.lines.length === 0} emptyMessage="Pedido sem produtos.">
          {order.lines.map((line) => (
            <PdfTr key={line.id}>
              <PdfTd>{`${line.productCode} — ${line.productName}`}</PdfTd>
              <PdfTd>{formatQuantity(line.orderedQuantity)}</PdfTd>
              <PdfTd>{formatQuantity(line.shippedQuantity)}</PdfTd>
              <PdfTd>{formatQuantity(line.billedQuantity)}</PdfTd>
              <PdfTd>{formatQuantity(line.outstandingQuantity)}</PdfTd>
              <PdfTd>{line.unitCode}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      {order.notes ? (
        <PdfSection title="Observações">
          <PdfParagraph>{order.notes}</PdfParagraph>
        </PdfSection>
      ) : null}
    </PdfDocument>
  );
}
