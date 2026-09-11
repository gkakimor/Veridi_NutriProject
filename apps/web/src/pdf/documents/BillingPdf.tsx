import { BILLING_NON_FISCAL_NOTICE, BILLING_STATUS_LABELS, sinalDoValorComercial } from "@veridi/shared";
import type { BillingDTO } from "@veridi/shared";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDetails,
  PdfDocument,
  PdfNotice,
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
  formatPdfDateTime,
  formatQuantity,
  formatUnitPriceBRL,
  orDash,
  pdfFileName,
} from "../format";

/**
 * Faturamento — documento comercial/operacional, jamais fiscal.
 *
 * O aviso de que não é Nota Fiscal abre a primeira folha e se repete no rodapé
 * de todas. Cliente é o snapshot congelado no documento, nunca o cadastro
 * atual. Preço unitário sai com a precisão que tem (2 a 4 casas) ao lado do
 * total de linha em 2: o papel precisa fechar na conferência. Total só existe
 * com precificação completa — total parcial nunca vira total.
 */

/** As mesmas larguras do Orçamento: preço e total no mesmo lugar em todo documento comercial. */
const COLUNAS: PdfColumn[] = [
  { header: "Produto", flex: 1 },
  { header: "Quantidade", width: 68, align: "right" },
  { header: "Unidade", width: 48, align: "center" },
  { header: "Preço unitário", width: 86, align: "right" },
  { header: "Total", width: 90, align: "right" },
];

export function billingPdfFileName(billing: Pick<BillingDTO, "code">): string {
  return pdfFileName(billing.code);
}

export function BillingPdf({ billing, generatedAt }: { billing: BillingDTO; generatedAt: Date }) {
  const desconto = sinalDoValorComercial(billing.discountAmount);
  const ajuste = sinalDoValorComercial(billing.commercialAdjustmentAmount);

  return (
    <PdfDocument
      title="Faturamento"
      code={billing.code}
      status={BILLING_STATUS_LABELS[billing.status]}
      isDraft={billing.status === "DRAFT"}
      footerNote={BILLING_NON_FISCAL_NOTICE}
      generatedAt={generatedAt}
    >
      <PdfNotice>{BILLING_NON_FISCAL_NOTICE}</PdfNotice>

      <PdfSection title="Cliente">
        <PdfDataGrid
          fields={[
            { label: "Razão social", value: orDash(billing.customerName), span: 8 },
            { label: "CNPJ", value: billing.customerCnpj ? formatCnpj(billing.customerCnpj) : "—", span: 4 },
            { label: "Nome fantasia", value: billing.customerTradeName, span: 8, optional: true },
            { label: "Código do cliente", value: billing.customerCode, span: 4, optional: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Dados do faturamento">
        <PdfDataGrid
          fields={[
            { label: "Pedido", value: billing.customerOrderCode, span: 3 },
            { label: "Expedição", value: billing.shipmentCode, span: 3 },
            { label: "Emitido em", value: formatPdfDateTime(billing.issuedAt), span: 3 },
            { label: "Emitido por", value: orDash(billing.issuedBy), span: 3 },
            { label: "Referência externa", value: orDash(billing.externalReference), span: 6 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Itens faturados">
        <PdfTable columns={COLUNAS} isEmpty={billing.lines.length === 0} emptyMessage="Faturamento sem itens.">
          {billing.lines.map((line) => (
            <PdfBlock key={line.id}>
              <PdfTr continued>
                <PdfTd>{`${line.productCode} — ${line.productName}`}</PdfTd>
                <PdfTd>{formatQuantity(line.quantity)}</PdfTd>
                <PdfTd>{line.unitCode}</PdfTd>
                {/* Preço ausente é "—" — nunca zero. */}
                <PdfTd>{formatUnitPriceBRL(line.unitPrice)}</PdfTd>
                <PdfTd>{formatBRL(line.lineTotal)}</PdfTd>
              </PdfTr>
              <PdfTr>
                <PdfTd span={COLUNAS.length}>
                  <PdfDetails
                    items={[
                      { label: "Lote", value: orDash(line.lotCode) },
                      { label: "Lote Veridi", value: orDash(line.businessLotNumber) },
                    ]}
                  />
                </PdfTd>
              </PdfTr>
            </PdfBlock>
          ))}
        </PdfTable>
        <PdfTotals
          lines={
            billing.hasCompletePricing && billing.totalAmount
              ? [
                  { label: "Subtotal bruto", value: formatBRL(billing.grossAmount ?? billing.totalAmount) },
                  !desconto.zero && {
                    label: "Desconto comercial",
                    value: `− ${formatBRL(desconto.absoluto)}`,
                  },
                  // Só aparece quando existe: ajuste zero é ruído no papel.
                  !ajuste.zero && {
                    label: "Ajuste de fechamento",
                    value: `${ajuste.negativo ? "− " : "+ "}${formatBRL(ajuste.absoluto)}`,
                  },
                  { label: "Valor total", value: formatBRL(billing.totalAmount), grand: true },
                ]
              : [{ label: "Valor total", value: "Precificação incompleta — total não disponível" }]
          }
        />
      </PdfSection>
    </PdfDocument>
  );
}
