import { RECEIPT_SOURCE_TYPE_LABELS } from "@veridi/shared";
import type { ReceiptDTO } from "@veridi/shared";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDetails,
  PdfDocument,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import {
  formatBRL,
  formatDate,
  formatQuantity,
  formatUnitPriceBRL,
  orDash,
  pdfFileName,
} from "../format";

/**
 * Recebimento — o que de fato chegou, lote a lote.
 *
 * Cada item recebido é uma linha principal (item, lote interno, quantidade e
 * valores) seguida da linha de detalhe do lote (lote do fornecedor, validade,
 * localização): nove colunas não cabem em retrato sem cortar o nome do item,
 * e as duas linhas nunca se separam entre folhas. Custo efetivo desconhecido
 * sai "—", nunca zero.
 */

const COLUNAS: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Lote interno", width: 94 },
  { header: "Quantidade", width: 60, align: "right" },
  { header: "Unidade", width: 46, align: "center" },
  { header: "Preço previsto", width: 76, align: "right" },
  { header: "Custo efetivo", width: 76, align: "right" },
];

export function receiptPdfFileName(receipt: Pick<ReceiptDTO, "code">): string {
  return pdfFileName(receipt.code);
}

export function ReceiptPdf({ receipt, generatedAt }: { receipt: ReceiptDTO; generatedAt: Date }) {
  // Material enviado pelo cliente não tem fornecedor nem OC: o dono é o cliente.
  const doCliente = receipt.sourceType === "CUSTOMER_SUPPLIED";

  return (
    <PdfDocument title="Recebimento" code={receipt.code} generatedAt={generatedAt}>
      <PdfSection title="Origem">
        <PdfDataGrid
          fields={[
            { label: "Origem", value: RECEIPT_SOURCE_TYPE_LABELS[receipt.sourceType], span: doCliente ? 4 : 3 },
            doCliente
              ? { label: "Cliente", value: orDash(receipt.customerName), span: 8 }
              : { label: "Fornecedor", value: orDash(receipt.supplierName), span: 6 },
            !doCliente && { label: "Ordem de compra", value: orDash(receipt.purchaseOrderCode), span: 3 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Dados do recebimento">
        <PdfDataGrid
          fields={[
            { label: "Data", value: formatDate(receipt.receivedAt), span: 3 },
            { label: "Nota fiscal", value: orDash(receipt.invoiceNumber), span: 3 },
            { label: "Documento", value: orDash(receipt.documentReference), span: 3 },
            { label: "Recebido por", value: orDash(receipt.createdBy), span: 3 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Itens recebidos">
        <PdfTable columns={COLUNAS} isEmpty={receipt.lines.length === 0} emptyMessage="Recebimento sem itens.">
          {receipt.lines.map((line) => (
            <PdfBlock key={line.id}>
              <PdfTr continued>
                <PdfTd>{`${line.itemCode} — ${line.itemName}`}</PdfTd>
                <PdfTd>{orDash(line.lotCode)}</PdfTd>
                <PdfTd>{formatQuantity(line.receivedQuantity)}</PdfTd>
                <PdfTd>{line.unitCode}</PdfTd>
                <PdfTd>{formatUnitPriceBRL(line.purchaseUnitPrice)}</PdfTd>
                {/* Sem custo informado fica "—" e nunca zero. */}
                <PdfTd>{formatBRL(line.actualUnitCost)}</PdfTd>
              </PdfTr>
              <PdfTr>
                <PdfTd span={COLUNAS.length}>
                  <PdfDetails
                    items={[
                      { label: "Lote do fornecedor", value: orDash(line.supplierLot) },
                      { label: "Validade", value: formatDate(line.expiryDate) },
                      { label: "Localização", value: orDash(line.location) },
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
