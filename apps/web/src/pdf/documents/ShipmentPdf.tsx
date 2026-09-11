import { SHIPMENT_STATUS_LABELS } from "@veridi/shared";
import type { ShipmentDTO } from "@veridi/shared";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDetails,
  PdfDocument,
  PdfNotice,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatDate, formatPdfDateTime, formatQuantity, orDash, pdfFileName } from "../format";

/**
 * Expedição — comprovante/romaneio operacional, nunca documento fiscal.
 *
 * O aviso abre a primeira folha e se repete no rodapé de todas. Cada produto
 * expedido é uma linha principal (produto, lotes, quantidade) seguida da
 * conferência física do lote; as duas nunca se separam entre folhas.
 */

export const SHIPMENT_NON_FISCAL_NOTICE = "Comprovante operacional de expedição — não é Nota Fiscal.";

const COLUNAS: PdfColumn[] = [
  { header: "Produto", flex: 1 },
  { header: "Lote", width: 96 },
  { header: "Lote Veridi", width: 72 },
  { header: "Quantidade", width: 64, align: "right" },
  { header: "Unidade", width: 48, align: "center" },
];

export function shipmentPdfFileName(shipment: Pick<ShipmentDTO, "code">): string {
  return pdfFileName(shipment.code);
}

export function ShipmentPdf({ shipment, generatedAt }: { shipment: ShipmentDTO; generatedAt: Date }) {
  return (
    <PdfDocument
      title="Expedição"
      code={shipment.code}
      status={SHIPMENT_STATUS_LABELS[shipment.status]}
      isDraft={shipment.status === "DRAFT"}
      footerNote={SHIPMENT_NON_FISCAL_NOTICE}
      generatedAt={generatedAt}
    >
      <PdfNotice>{SHIPMENT_NON_FISCAL_NOTICE}</PdfNotice>

      <PdfSection title="Pedido e cliente">
        <PdfDataGrid
          fields={[
            { label: "Cliente", value: orDash(shipment.customerName), span: 8 },
            { label: "Pedido", value: shipment.customerOrderCode, span: 4 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Saída">
        <PdfDataGrid
          fields={[
            { label: "Data da expedição", value: formatDate(shipment.shipmentDate), span: 4 },
            { label: "Confirmada em", value: formatPdfDateTime(shipment.confirmedAt), span: 4 },
            { label: "Confirmada por", value: orDash(shipment.confirmedBy), span: 4 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Produtos expedidos">
        <PdfTable columns={COLUNAS} isEmpty={shipment.lines.length === 0} emptyMessage="Expedição sem itens.">
          {shipment.lines.map((line) => (
            <PdfBlock key={line.id}>
              <PdfTr continued>
                <PdfTd>{`${line.productCode} — ${line.productName}`}</PdfTd>
                <PdfTd>{orDash(line.lotCode)}</PdfTd>
                <PdfTd>{orDash(line.businessLotNumber)}</PdfTd>
                <PdfTd>{formatQuantity(line.quantity)}</PdfTd>
                <PdfTd>{line.unitCode}</PdfTd>
              </PdfTr>
              <PdfTr>
                <PdfTd span={COLUNAS.length}>
                  <PdfDetails
                    items={[
                      { label: "Conferido em", value: formatPdfDateTime(line.verifiedAt) },
                      { label: "Conferido por", value: orDash(line.verifiedBy) },
                    ]}
                  />
                </PdfTd>
              </PdfTr>
            </PdfBlock>
          ))}
        </PdfTable>
      </PdfSection>
    </PdfDocument>
  );
}
