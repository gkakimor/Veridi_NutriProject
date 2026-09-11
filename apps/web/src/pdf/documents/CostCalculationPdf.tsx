import type { IndustrialCostCalculationSnapshotDTO } from "@veridi/shared";
import {
  COST_PER_1000_EXPLANATION,
  COST_PER_1000_LABEL,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
} from "@veridi/shared";
import { formatUnitCost } from "../../components/CostBreakdown";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDocument,
  PdfNote,
  PdfNotice,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatBRL, formatDate, formatPdfDateTime, formatPercent, formatQuantity, pdfFileName } from "../format";

/**
 * Cálculo de custo industrial — documento interno de análise.
 *
 * Mostra de onde veio cada custo unitário, o que ficou desconhecido e qual é
 * a qualidade do resultado. Cálculo parcial sai no papel dizendo que é
 * parcial: subtotal conhecido nunca se disfarça de total, e custo
 * desconhecido é "—", nunca zero.
 *
 * O documento só representa o cálculo congelado que a API entrega — mesmas
 * funções e mesmos textos do impresso HTML que ele substitui. Conta não se
 * faz aqui.
 */

export const COST_CALCULATION_FOOTER_NOTE = "Documento interno — custo industrial; não vai ao cliente.";

/** Largura dos valores: o subtotal cai na mesma coluna visual em toda tabela. */
const VALOR = 76;

/**
 * Seção curta não se parte: título e linhas na mesma folha — o título não
 * fica sozinho no pé da página. Acima disso o bloco poderia passar de uma
 * folha; aí a tabela quebra normalmente, com o cabeçalho repetido.
 */
const BLOCO_MAXIMO = 12;

/** Espaço inseparável entre o número de caixas e "cx": a quebra de linha não os separa. */
const INSEPARAVEL = String.fromCharCode(0xa0);

/** Item leva a sobra da largura; quantidade, moeda e origem têm largura fixa. */
const COLUNAS_MATERIAIS: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Quantidade", width: 72, align: "right" },
  { header: "Custo unitário", width: 72, align: "right" },
  { header: "Origem", width: 116 },
  { header: "Subtotal", width: VALOR, align: "right" },
];

const COLUNAS_RECURSOS: PdfColumn[] = [
  { header: "Recurso", flex: 1 },
  { header: "Tipo", width: 72 },
  { header: "Consumo", width: 72, align: "right" },
  { header: "Tarifa", width: 72, align: "right" },
  { header: "Subtotal", width: VALOR, align: "right" },
];

const COLUNAS_PREMISSAS: PdfColumn[] = [
  { header: "Descrição", flex: 1 },
  { header: "Categoria", width: 100 },
  { header: "Base de cálculo", width: 116 },
  { header: "Valor", width: 72, align: "right" },
  { header: "Subtotal", width: VALOR, align: "right" },
];

const COLUNAS_RESULTADO: PdfColumn[] = [
  { header: "Componente", flex: 1 },
  { header: "Valor", width: VALOR, align: "right" },
];

const COLUNAS_FORNECIDOS: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Quantidade", width: 72, align: "right" },
];

const COLUNAS_OBSERVACOES: PdfColumn[] = [{ header: "Observação", flex: 1 }];

/** "CALC-000123.pdf" — o código do cálculo congelado. */
export function costCalculationPdfFileName(
  calculation: Pick<IndustrialCostCalculationSnapshotDTO, "code">,
): string {
  return pdfFileName(calculation.code);
}

export function CostCalculationPdf({
  calculation,
  generatedAt,
  generatedBy = null,
}: {
  calculation: IndustrialCostCalculationSnapshotDTO;
  generatedAt: Date;
  /** Quem gerou o arquivo — não substitui quem calculou, que vem do snapshot. */
  generatedBy?: string | null;
}) {
  const partial = calculation.totalIndustrialCost === null;
  /** A quantidade que este documento respondeu — repetida junto do total. */
  const base = `${formatQuantity(calculation.referenceOutputQuantity)} ${calculation.referenceOutputUomCode}`;

  return (
    <PdfDocument
      title="Cálculo de custo industrial"
      code={calculation.code}
      headerLines={[
        `Qualidade do custo: ${INDUSTRIAL_COST_QUALITY_LABELS[calculation.quality]}`,
        generatedBy ? `Gerado por ${generatedBy}` : null,
      ]}
      footerNote={COST_CALCULATION_FOOTER_NOTE}
      generatedAt={generatedAt}
    >
      <PdfSection title="Dados do cálculo">
        <PdfDataGrid
          fields={[
            {
              label: "Produto",
              value: `${calculation.productCode} — ${calculation.productName}`,
              span: 8,
            },
            { label: "Cliente", value: calculation.customerName ?? "—", span: 4 },
            { label: "Estrutura", value: calculation.industrialCostVersionLabel, span: 3 },
            { label: "Formulação", value: `V${calculation.formulationVersionNumber}`, span: 2 },
            { label: "Quantidade calculada", value: base, span: 3 },
            {
              label: "Data de referência de custo",
              value: formatDate(calculation.costReferenceDate),
              span: 4,
            },
            {
              label: "Calculado",
              value: `${formatPdfDateTime(calculation.calculatedAt)} — ${calculation.calculatedByName ?? "—"}`,
              span: 12,
            },
          ]}
        />
      </PdfSection>

      {partial ? (
        <PdfNotice>
          Cálculo parcial — existem premissas ou custos não informados. O valor apresentado é o
          subtotal conhecido e não representa o custo industrial total.
        </PdfNotice>
      ) : null}
      {calculation.structureStatusAtCalculation === "DRAFT" ? (
        <PdfNotice>Estrutura em rascunho no momento do cálculo: as premissas ainda podiam mudar.</PdfNotice>
      ) : null}

      {/* Custo desconhecido é "—" em toda coluna de dinheiro — nunca R$ 0,00. */}
      <PdfSection title="Materiais e embalagens">
        <PdfTable
          columns={COLUNAS_MATERIAIS}
          isEmpty={calculation.materials.length === 0}
          emptyMessage="A formulação vinculada não tem componentes."
        >
          {calculation.materials.map((material) => (
            <PdfTr key={material.itemId}>
              <PdfTd>
                {material.itemCode} — {material.itemName}
              </PdfTd>
              <PdfTd>
                {formatQuantity(material.requiredQuantity)} {material.unitCode}
              </PdfTd>
              <PdfTd>{formatUnitCost(material.unitCost)}</PdfTd>
              <PdfTd>{INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[material.costSource]}</PdfTd>
              <PdfTd>{material.subtotal === null ? "—" : formatBRL(material.subtotal)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfBlock keepTogether={calculation.resources.length <= BLOCO_MAXIMO}>
        <PdfSection title="Recursos industriais">
          <PdfTable
            columns={COLUNAS_RECURSOS}
            isEmpty={calculation.resources.length === 0}
            emptyMessage="Nenhum recurso declarado nesta estrutura."
          >
            {calculation.resources.map((resource) => (
              <PdfTr key={resource.resourceId}>
                <PdfTd>
                  {resource.resourceCode} — {resource.resourceName}
                </PdfTd>
                <PdfTd>{INDUSTRIAL_RESOURCE_TYPE_LABELS[resource.resourceType]}</PdfTd>
                <PdfTd>
                  {formatQuantity(resource.quantity)} {INDUSTRIAL_RATE_UOM_LABELS[resource.quantityUom]}
                </PdfTd>
                <PdfTd>{resource.rateValue === null ? "—" : formatBRL(resource.rateValue)}</PdfTd>
                <PdfTd>{resource.subtotal === null ? "—" : formatBRL(resource.subtotal)}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
        </PdfSection>
      </PdfBlock>

      <PdfBlock keepTogether={calculation.manualLines.length <= BLOCO_MAXIMO}>
        <PdfSection title="Premissas de custo">
          <PdfTable
            columns={COLUNAS_PREMISSAS}
            isEmpty={calculation.manualLines.length === 0}
            emptyMessage="Nenhuma premissa adicional registrada."
          >
            {calculation.manualLines.map((line) => (
              <PdfTr key={line.lineId}>
                <PdfTd>{line.description}</PdfTd>
                <PdfTd>{INDUSTRIAL_COST_CATEGORY_LABELS[line.category]}</PdfTd>
                <PdfTd>
                  {INDUSTRIAL_COST_BASIS_LABELS[line.calculationBasis]}
                  {line.computedUnits ? ` (${line.computedUnits}${INSEPARAVEL}cx)` : ""}
                </PdfTd>
                <PdfTd>
                  {line.rateValue === null
                    ? "—"
                    : line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST"
                      ? // O impresso antigo escrevia o decimal cru ("8.0000%").
                        formatPercent(line.rateValue)
                      : formatBRL(line.rateValue)}
                </PdfTd>
                <PdfTd>{line.subtotal === null ? "—" : formatBRL(line.subtotal)}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
        </PdfSection>
      </PdfBlock>

      {/* O resumo não se parte entre folhas: o total, a base que ele responde
          e a ressalva da equivalência se leem juntos. */}
      <PdfBlock>
        <PdfSection title="Resultado">
          <PdfTable columns={COLUNAS_RESULTADO}>
            <PdfTr>
              <PdfTd>Materiais e embalagens Veridi</PdfTd>
              <PdfTd>{formatBRL(calculation.materialsSubtotalKnown)}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Mão de obra</PdfTd>
              <PdfTd>{formatBRL(calculation.laborSubtotalKnown)}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Equipamentos</PdfTd>
              <PdfTd>{formatBRL(calculation.equipmentSubtotalKnown)}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Energia</PdfTd>
              <PdfTd>
                {calculation.energySubtotal === null ? "—" : formatBRL(calculation.energySubtotal)}
              </PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Embalagem secundária</PdfTd>
              <PdfTd>{formatBRL(calculation.secondaryPackagingSubtotalKnown)}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Serviços de terceiros</PdfTd>
              <PdfTd>{formatBRL(calculation.thirdPartySubtotalKnown)}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Outros custos diretos</PdfTd>
              <PdfTd>{formatBRL(calculation.otherSubtotalKnown)}</PdfTd>
            </PdfTr>
            <PdfTr emphasis>
              <PdfTd>Custo industrial direto</PdfTd>
              <PdfTd>
                {calculation.directIndustrialCost === null
                  ? "—"
                  : formatBRL(calculation.directIndustrialCost)}
              </PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Overhead</PdfTd>
              <PdfTd>{formatBRL(calculation.overheadSubtotalKnown)}</PdfTd>
            </PdfTr>
            {/* A base do cálculo já está nos dados do cálculo, mas quem lê um
                resumo financeiro lê a linha do total — e é ali que a
                quantidade precisa estar, ao lado do número que ela explica. */}
            <PdfTr emphasis>
              <PdfTd>Quantidade calculada</PdfTd>
              <PdfTd>{base}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd bold>
                {partial ? "Subtotal conhecido" : "Custo industrial total"} para {base}
              </PdfTd>
              <PdfTd bold>
                {partial
                  ? formatBRL(calculation.knownSubtotal)
                  : formatBRL(calculation.totalIndustrialCost)}
              </PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Custo por unidade</PdfTd>
              <PdfTd>{formatUnitCost(calculation.costPerUnit)}</PdfTd>
            </PdfTr>
            {/* No papel não há ⓘ para abrir: a ressalva vai impressa junto. */}
            <PdfTr>
              <PdfTd>
                {COST_PER_1000_LABEL}
                <PdfNote>{COST_PER_1000_EXPLANATION}</PdfNote>
              </PdfTd>
              <PdfTd>{calculation.costPer1000 === null ? "—" : formatBRL(calculation.costPer1000)}</PdfTd>
            </PdfTr>
          </PdfTable>
        </PdfSection>
      </PdfBlock>

      {calculation.hasCustomerSuppliedMaterials ? (
        <PdfBlock keepTogether={calculation.customerSuppliedMaterials.length <= BLOCO_MAXIMO}>
          <PdfSection title="Materiais fornecidos pelo cliente">
            <PdfTable columns={COLUNAS_FORNECIDOS}>
              {calculation.customerSuppliedMaterials.map((material) => (
                <PdfTr key={material.itemId}>
                  <PdfTd>
                    {material.itemCode} — {material.itemName}
                  </PdfTd>
                  <PdfTd>
                    {formatQuantity(material.requiredQuantity)} {material.unitCode}
                  </PdfTd>
                </PdfTr>
              ))}
            </PdfTable>
            <PdfNote>
              Pertencem à estrutura física do produto e não têm valor econômico atribuído à Veridi.
            </PdfNote>
          </PdfSection>
        </PdfBlock>
      ) : null}

      {calculation.warnings.length > 0 ? (
        <PdfBlock keepTogether={calculation.warnings.length <= BLOCO_MAXIMO}>
          <PdfSection title="Observações do cálculo">
            <PdfTable columns={COLUNAS_OBSERVACOES}>
              {calculation.warnings.map((warning) => (
                <PdfTr key={`${warning.code}-${warning.message}`}>
                  <PdfTd>{warning.message}</PdfTd>
                </PdfTr>
              ))}
            </PdfTable>
          </PdfSection>
        </PdfBlock>
      ) : null}
    </PdfDocument>
  );
}
