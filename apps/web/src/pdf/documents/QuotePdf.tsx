import { Decimal, QUOTE_STATUS_LABELS } from "@veridi/shared";
import type { QuoteVersionDTO } from "@veridi/shared";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDocument,
  PdfSection,
  PdfSubheading,
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
  formatPdfDateTime,
  formatPercent,
  formatQuantity,
  formatUnitPriceBRL,
  orDash,
  pdfFileName,
} from "../format";

/**
 * Orçamento comercial — o documento de referência da fundação PDF.
 *
 * Documento de negociação: o rodapé de toda página diz que não é documento
 * fiscal, e o rascunho sai marcado para nunca ser confundido com proposta
 * apresentada. Cliente e projeto vêm prontos do servidor: o snapshot
 * congelado no envio ou, no rascunho, o cadastro atual que o envio vai
 * congelar — o documento não escolhe a fonte. Nada de custo, margem,
 * comissão ou código interno: é o papel que vai ao cliente.
 */

export const QUOTE_FOOTER_NOTE = "Documento comercial — não constitui documento fiscal.";

/**
 * Produto leva a sobra da largura; os números têm largura fixa, então preço e
 * total ficam na mesma coluna visual em toda linha e em toda página.
 */
const COLUNAS_ITENS: PdfColumn[] = [
  { header: "Produto", flex: 1 },
  { header: "Quantidade", width: 68, align: "right" },
  { header: "Unidade", width: 48, align: "center" },
  { header: "Preço unitário", width: 86, align: "right" },
  { header: "Total", width: 90, align: "right" },
];

/** Valor na última coluna, com a mesma largura do Total dos itens. */
const COLUNAS_PARCELAS: PdfColumn[] = [
  { header: "Parcela", flex: 1 },
  { header: "Vencimento", width: 110, align: "right" },
  { header: "Valor", width: 90, align: "right" },
];

export function quotePdfFileName(quote: Pick<QuoteVersionDTO, "code" | "versionNumber">): string {
  return pdfFileName(quote.code, `V${quote.versionNumber}`);
}

export function QuotePdf({ quote, generatedAt }: { quote: QuoteVersionDTO; generatedAt: Date }) {
  const plano = quote.paymentSchedule;
  const descontoAplicado = plano ? new Decimal(plano.discountAmount).greaterThan(0) : false;
  const endereco = [
    quote.customerStreet,
    quote.customerNumber,
    quote.customerComplement,
    quote.customerDistrict,
  ]
    .filter(Boolean)
    .join(", ");
  const cidadeUf = [quote.customerCity, quote.customerState].filter(Boolean).join(" / ");
  const projeto = [quote.projectCode, quote.projectName].filter(Boolean).join(" — ");
  const formaDePagamento = plano
    ? plano.method === "CASH"
      ? "À vista"
      : `Parcelado em ${plano.installments.length}×`
    : orDash(quote.paymentTerms);

  return (
    <PdfDocument
      title="Orçamento comercial"
      code={`${quote.code} · V${quote.versionNumber}`}
      status={QUOTE_STATUS_LABELS[quote.status]}
      isDraft={quote.status === "DRAFT"}
      footerNote={QUOTE_FOOTER_NOTE}
      generatedAt={generatedAt}
    >
      <PdfSection title="Cliente">
        <PdfDataGrid
          fields={[
            { label: "Razão social", value: orDash(quote.customerName), span: 8 },
            { label: "CNPJ", value: quote.customerCnpj ? formatCnpj(quote.customerCnpj) : "—", span: 4 },
            { label: "Nome fantasia", value: quote.customerTradeName, span: 8, optional: true },
            { label: "Código do cliente", value: quote.customerCode, span: 4, optional: true },
            { label: "Endereço", value: endereco, span: 12, optional: true },
            { label: "Cidade / UF", value: cidadeUf, span: 8, optional: true },
            { label: "CEP", value: quote.customerZipCode, span: 4, optional: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Proposta">
        <PdfDataGrid
          fields={[
            { label: "Projeto", value: orDash(projeto), span: 6 },
            { label: "Data do orçamento", value: formatDate(quote.quoteDate), span: 3 },
            {
              label: "Enviado em",
              value: quote.sentAt ? formatPdfDateTime(quote.sentAt) : null,
              span: 3,
              optional: true,
            },
            { label: "Conceito", value: quote.projectConcept, span: 6, optional: true },
            { label: "Canal", value: quote.projectChannel, span: 6, optional: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Produtos">
        <PdfTable columns={COLUNAS_ITENS}>
          {quote.lines.map((line) => (
            <PdfTr key={line.id}>
              <PdfTd>{line.productName}</PdfTd>
              <PdfTd>{formatQuantity(line.quotedQuantity)}</PdfTd>
              <PdfTd>{orDash(line.uomCode)}</PdfTd>
              {/* Preço ausente é "não precificado" — nunca zero. */}
              <PdfTd>{line.unitPrice ? formatUnitPriceBRL(line.unitPrice) : "—"}</PdfTd>
              <PdfTd>{line.total ? formatBRL(line.total) : "—"}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
        <PdfTotals
          lines={[
            plano && descontoAplicado ? { label: "Subtotal", value: formatBRL(plano.subtotal) } : null,
            plano && descontoAplicado
              ? {
                  label: `Desconto (${formatPercent(plano.discountPercent)})`,
                  value: `− ${formatBRL(plano.discountAmount)}`,
                }
              : null,
            // Total parcial não existe: com linha sem preço, não há total.
            { label: "Total geral", value: quote.total ? formatBRL(quote.total) : "—", grand: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Condições comerciais">
        <PdfDataGrid
          fields={[
            { label: "Forma de pagamento", value: formaDePagamento, span: 4 },
            {
              label: "Prazo de entrega",
              value: quote.leadTimeDays ? `${quote.leadTimeDays} dias` : "—",
              span: 4,
            },
            { label: "Validade", value: formatDate(quote.validUntil), span: 2 },
            { label: "Moeda", value: quote.currencyCode, span: 2 },
            { label: "Condições de pagamento", value: quote.paymentTerms, span: 12, optional: true },
            { label: "Observações", value: quote.commercialNotes, span: 12, optional: true },
          ]}
        />

        {/* O documento do cliente mostra o parcelamento inteiro, parcela por
            parcela: "12×" sem dizer de quanto obriga o cliente a refazer a
            conta — e a conta dele pode não bater. */}
        {plano && plano.method === "INSTALLMENTS" && plano.installments.length > 0 ? (
          // Plano curto não se parte: subtítulo e parcelas na mesma folha.
          <PdfBlock keepTogether={plano.installments.length <= 12}>
            <PdfSubheading title="Plano de pagamento" />
            <PdfTable columns={COLUNAS_PARCELAS}>
              {new Decimal(plano.downPayment ?? 0).greaterThan(0) ? (
                <PdfTr>
                  <PdfTd>Entrada ({formatPercent(plano.downPaymentPercent)})</PdfTd>
                  <PdfTd>No aceite</PdfTd>
                  <PdfTd>{formatBRL(plano.downPayment)}</PdfTd>
                </PdfTr>
              ) : null}
              {plano.installments.map((parcela) => (
                <PdfTr key={parcela.number}>
                  <PdfTd>{parcela.number}ª parcela</PdfTd>
                  <PdfTd>{parcela.dueInDays} dias</PdfTd>
                  <PdfTd>{formatBRL(parcela.amount)}</PdfTd>
                </PdfTr>
              ))}
              <PdfTr emphasis>
                <PdfTd span={2} bold>
                  Total a prazo
                  {plano.monthlyInterestPercent
                    ? ` (juros de ${formatPercent(plano.monthlyInterestPercent)} ao mês)`
                    : ""}
                </PdfTd>
                <PdfTd bold>{formatBRL(plano.totalPayable)}</PdfTd>
              </PdfTr>
            </PdfTable>
          </PdfBlock>
        ) : null}
      </PdfSection>
    </PdfDocument>
  );
}
