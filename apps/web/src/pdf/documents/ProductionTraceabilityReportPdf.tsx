import { LOT_STATUS_LABELS, PRODUCTION_ORDER_STATUS_LABELS, hojeComercial } from "@veridi/shared";
import type { ProductionTraceabilityDTO } from "@veridi/shared";
import {
  PdfDataGrid,
  PdfDocument,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatDate, formatQuantity, orDash, pdfFileName } from "../format";

/**
 * R-06 — Rastreabilidade por Ordem de Produção.
 *
 * Consulta de documento único (uma OP), não listagem: consumo e produção
 * REAIS — o que foi efetivamente consumido e apontado; reserva e sugestão
 * FEFO não entram. O PDF escreve o que a API devolveu, com as mesmas
 * funções e os mesmos textos do impresso anterior.
 */

export const R06_TITLE = "Rastreabilidade por Ordem de Produção";

/** Código de lote inteiro na coluna: `LT-20260903-000803` não quebra. */
const COLUNAS_CONSUMO: PdfColumn[] = [
  { header: "Item", flex: 1.4 },
  { header: "Lote interno", width: 92 },
  { header: "Lote do fornecedor", width: 78 },
  { header: "Fornecedor", flex: 1 },
  { header: "Quantidade", width: 66, align: "right" },
  { header: "Un.", width: 30, align: "center" },
];

const COLUNAS_PRODUCAO: PdfColumn[] = [
  { header: "Lote interno", width: 92 },
  { header: "Lote Veridi", width: 80 },
  { header: "Quantidade", width: 66, align: "right" },
  { header: "Un.", width: 30, align: "center" },
  { header: "Validade", width: 58 },
  { header: "Situação", flex: 1 },
];

/** "R-06-OP-000010-2026-09-11.pdf": relatório, OP e dia da geração. */
export function productionTraceabilityPdfFileName(
  data: Pick<ProductionTraceabilityDTO, "productionOrderCode">,
  generatedAt: Date,
): string {
  return pdfFileName("R-06", data.productionOrderCode, hojeComercial(generatedAt));
}

export function ProductionTraceabilityReportPdf({
  data,
  generatedAt,
  generatedBy,
}: {
  data: ProductionTraceabilityDTO;
  generatedAt: Date;
  generatedBy: string | null;
}) {
  return (
    <PdfDocument
      title={R06_TITLE}
      // A folha solta diz de que OP é, não só de que relatório.
      code={`R-06 · ${data.productionOrderCode}`}
      headerLines={[`Gerado por ${orDash(generatedBy)}`]}
      generatedAt={generatedAt}
    >
      <PdfSection title="Ordem de produção">
        <PdfDataGrid
          fields={[
            { label: "Ordem de produção", value: data.productionOrderCode, span: 3 },
            { label: "Produto", value: `${data.productCode} — ${data.productName}`, span: 9 },
            { label: "Situação", value: PRODUCTION_ORDER_STATUS_LABELS[data.status], span: 3 },
            {
              label: "Planejado × produzido",
              value: `${formatQuantity(data.plannedQuantity)} / ${formatQuantity(data.producedQuantity)} ${data.unitCode}`,
              span: 5,
            },
            { label: "Concluída em", value: formatDate(data.completedAt), span: 4 },
          ]}
        />
      </PdfSection>

      <PdfSection title="Materiais consumidos">
        <PdfTable
          columns={COLUNAS_CONSUMO}
          isEmpty={data.consumed.length === 0}
          emptyMessage="Nenhum consumo registrado."
        >
          {data.consumed.map((row, index) => (
            <PdfTr key={`${row.itemId}-${row.lotId ?? index}`}>
              <PdfTd>{`${row.itemCode} — ${row.itemName}`}</PdfTd>
              <PdfTd>{orDash(row.lotCode)}</PdfTd>
              <PdfTd>{orDash(row.supplierLot)}</PdfTd>
              <PdfTd>{orDash(row.supplierName)}</PdfTd>
              <PdfTd>{formatQuantity(row.quantity)}</PdfTd>
              <PdfTd>{row.unitCode}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Produto acabado produzido">
        <PdfTable
          columns={COLUNAS_PRODUCAO}
          isEmpty={data.produced.length === 0}
          emptyMessage="Nenhuma produção apontada."
        >
          {data.produced.map((row) => (
            <PdfTr key={row.lotId}>
              <PdfTd>{row.lotCode}</PdfTd>
              <PdfTd>{orDash(row.businessLotNumber)}</PdfTd>
              <PdfTd>{formatQuantity(row.quantity)}</PdfTd>
              <PdfTd>{row.unitCode}</PdfTd>
              <PdfTd>{formatDate(row.expiryDate)}</PdfTd>
              <PdfTd>{`${LOT_STATUS_LABELS[row.status]}${row.isExpired ? " — vencido" : ""}`}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>
    </PdfDocument>
  );
}
