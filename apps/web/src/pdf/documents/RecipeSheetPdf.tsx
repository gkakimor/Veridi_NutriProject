import {
  CONTROLLED_DOCUMENT_CODES,
  Decimal,
  PRODUCTION_ORDER_STATUS_LABELS,
  PRODUCTION_PART_STATUS_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
} from "@veridi/shared";
import type { RecipeSheetDTO, RecipeSheetPartDTO } from "@veridi/shared";
import {
  PdfDataGrid,
  PdfDocument,
  PdfNotice,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfText,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatPdfDateTime, formatQuantity, formatQuantityWithUnit, orDash, pdfFileName } from "../format";
import { ControlledRevisionSection } from "./controlled-revision";

/**
 * Folha de receita (R.COQ.003) — registro de execução por parte, com pesagem
 * real, lote e operador. Cada parte é uma seção própria; o objetivo é um
 * documento A4 legível, não reproduzir a planilha.
 *
 * Paisagem, e tabela densa: 11 colunas de pesagem não cabem em retrato — a
 * coluna "Observação", que é onde a operação escreve, ficava fora da folha.
 */

/** Item leva a maior fatia da sobra; código, lote, número e carimbo têm largura fixa. */
const COLUNAS_PESAGEM: PdfColumn[] = [
  { header: "Item", flex: 4 },
  { header: "Fonte", flex: 2 },
  { header: "Lote interno", width: 80 },
  { header: "Lote fornecedor", width: 64 },
  { header: "Proprietário", width: 62 },
  { header: "Planejado", width: 50, align: "right" },
  { header: "Pesado", width: 50, align: "right" },
  { header: "Unidade", width: 40, align: "center" },
  { header: "Data/hora", width: 66 },
  { header: "Executado por", width: 66 },
  { header: "Observação", flex: 2 },
];

const COLUNAS_EMBALAGEM: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Fornecimento", width: 90 },
  { header: "Total", width: 90, align: "right" },
  { header: "Unidade", width: 60, align: "center" },
];

/** A folha é da OP: "007/26" → `Folha-de-Receita-OP-007-26.pdf`. */
export function recipeSheetPdfFileName(
  sheet: Pick<RecipeSheetDTO, "officialNumber" | "productionOrderCode">,
): string {
  return sheet.officialNumber
    ? pdfFileName("Folha-de-Receita", "OP", sheet.officialNumber)
    : pdfFileName("Folha-de-Receita", sheet.productionOrderCode);
}

/*
 * Folha sem pesagem e parte "Pendente" numa OP que já consumiu o material
 * descreve, no papel, uma produção que não aconteceu. Auditoria de qualidade
 * lê este documento sozinho: ele precisa dizer por qual caminho o material foi
 * baixado. A comparação é a do próprio Decimal — nunca por `Number`.
 */
function consumidoSemPesagem(part: RecipeSheetPartDTO): boolean {
  return (
    part.weighings.length === 0 &&
    part.requirements.some((requirement) => new Decimal(requirement.consumedQuantity).greaterThan(0))
  );
}

export function RecipeSheetPdf({ sheet, generatedAt }: { sheet: RecipeSheetDTO; generatedAt: Date }) {
  return (
    <PdfDocument
      title="Folha de receita"
      code={sheet.officialNumber ?? sheet.productionOrderCode}
      status={PRODUCTION_ORDER_STATUS_LABELS[sheet.status]}
      documentCode={CONTROLLED_DOCUMENT_CODES.RECIPE_SHEET}
      generatedAt={generatedAt}
      landscape
    >
      <ControlledRevisionSection
        documentCode={CONTROLLED_DOCUMENT_CODES.RECIPE_SHEET}
        revision={sheet.recipeSheetRevision}
      />

      <PdfSection title="Dados da ordem">
        <PdfDataGrid
          fields={[
            { label: "OP interna", value: sheet.productionOrderCode, span: 2 },
            { label: "Produto", value: `${sheet.productCode} — ${sheet.productName}`, span: 4 },
            { label: "Cliente", value: orDash(sheet.customerName), span: 4 },
            { label: "Formulação", value: orDash(sheet.formulationVersionLabel), span: 2 },
            {
              label: "Planejado",
              value: formatQuantityWithUnit(sheet.plannedQuantity, sheet.outputUnitCode),
              span: 2,
            },
            { label: "Partes", value: String(sheet.numberOfParts), span: 2 },
          ]}
        />
      </PdfSection>

      {sheet.parts.map((part) => (
        <PdfSection
          key={part.id}
          title={`Parte ${part.partNumber} / ${sheet.numberOfParts} — ${PRODUCTION_PART_STATUS_LABELS[part.status]}`}
        >
          <PdfDataGrid
            fields={[
              {
                label: "Iniciada por",
                value: part.startedByName ? `${part.startedByName} em ${formatPdfDateTime(part.startedAt)}` : null,
                span: 4,
                optional: true,
              },
              {
                label: "Concluída por",
                value: part.completedByName
                  ? `${part.completedByName} em ${formatPdfDateTime(part.completedAt)}`
                  : null,
                span: 4,
                optional: true,
              },
            ]}
          />

          {consumidoSemPesagem(part) ? (
            <PdfNotice>
              <PdfText bold>Material registrado via Consumo Real da OP.</PdfText> A pesagem por partes não foi
              utilizada nesta ordem; o consumo de cada material está na Ordem de Produção, com lote, quantidade e
              responsável.
            </PdfNotice>
          ) : null}

          <PdfTable
            columns={COLUNAS_PESAGEM}
            dense
            isEmpty={part.weighings.length === 0}
            emptyMessage="Nenhuma pesagem registrada nesta parte."
          >
            {part.weighings.map((weighing) => (
              <PdfTr key={weighing.id}>
                <PdfTd>{`${weighing.itemCode} — ${weighing.itemName}`}</PdfTd>
                <PdfTd>
                  {orDash(
                    part.requirements.find(
                      (requirement) => requirement.requirementId === weighing.productionOrderRequirementId,
                    )?.sourceName ?? null,
                  )}
                </PdfTd>
                <PdfTd>{orDash(weighing.lotCode)}</PdfTd>
                <PdfTd>{orDash(weighing.supplierLot)}</PdfTd>
                <PdfTd>{weighing.ownerType === "CUSTOMER" ? "Cliente" : "Veridi"}</PdfTd>
                <PdfTd>{formatQuantity(weighing.plannedQuantity)}</PdfTd>
                <PdfTd>{formatQuantity(weighing.actualQuantity)}</PdfTd>
                <PdfTd>{weighing.uomCode}</PdfTd>
                <PdfTd>{formatPdfDateTime(weighing.executedAt)}</PdfTd>
                <PdfTd>{weighing.executedByName}</PdfTd>
                <PdfTd>{orDash(weighing.notes)}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
        </PdfSection>
      ))}

      {sheet.packagingRequirements.length > 0 ? (
        <PdfSection title="Materiais de embalagem (total da OP)">
          <PdfTable columns={COLUNAS_EMBALAGEM}>
            {sheet.packagingRequirements.map((row) => (
              <PdfTr key={row.requirementId}>
                <PdfTd>{`${row.itemCode} — ${row.itemName}`}</PdfTd>
                <PdfTd>{SUPPLY_RESPONSIBILITY_LABELS[row.supplyResponsibility]}</PdfTd>
                <PdfTd>{formatQuantity(row.totalQuantity)}</PdfTd>
                <PdfTd>{row.unitCode}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
        </PdfSection>
      ) : null}
    </PdfDocument>
  );
}
