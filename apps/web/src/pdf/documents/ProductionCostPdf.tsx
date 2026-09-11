import type { ProductionOrderCostDTO } from "@veridi/shared";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  REALIZED_COST_STATUS_LABELS,
} from "@veridi/shared";
import { formatUnitCost } from "../../components/CostBreakdown";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDocument,
  PdfNotice,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatBRL, formatPdfDateTime, formatPercent, formatQuantity, pdfFileName } from "../format";

/**
 * Custo industrial de uma produção — documento SEPARADO da Ordem de Produção.
 *
 * A OP impressa (R.PRO.002) é documento controlado de chão de fábrica: custo
 * não entra lá. Aqui o papel diz exatamente o que é — materiais realizados
 * somados a custos industriais PADRÃO aplicados, nunca "horas reais", que
 * ninguém mediu. Custo desconhecido é "—", nunca zero, e cálculo parcial
 * mostra o subtotal conhecido com esse nome.
 *
 * O documento só representa o custo que a API entrega — mesmas funções e
 * mesmos textos do impresso HTML que ele substitui.
 */

export const PRODUCTION_COST_FOOTER_NOTE = "Documento interno — custo industrial; não vai ao cliente.";

/** Largura dos valores: o subtotal cai na mesma coluna visual em toda tabela. */
const VALOR = 76;

/**
 * Seção curta não se parte: título e linhas na mesma folha — o título não
 * fica sozinho no pé da página. Acima disso o bloco poderia passar de uma
 * folha; aí a tabela quebra normalmente, com o cabeçalho repetido.
 */
const BLOCO_MAXIMO = 12;

/**
 * Consumo é a tabela mais larga do documento — código de lote inteiro e
 * carimbo de consumo. Célula justa (`dense`) para o código do lote caber sem
 * quebrar: coluna cortada é dado perdido.
 */
const COLUNAS_MATERIAIS: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Lote", width: 82 },
  { header: "Quantidade", width: 62, align: "right" },
  { header: "Consumido em", width: 68 },
  { header: "Custo unitário", width: 70, align: "right" },
  { header: "Subtotal", width: VALOR, align: "right" },
];

const COLUNAS_PADRAO: PdfColumn[] = [
  { header: "Componente", flex: 1 },
  { header: "Tipo", width: 72 },
  { header: "Quantidade aplicada", width: 96, align: "right" },
  { header: "Tarifa", width: 72, align: "right" },
  { header: "Subtotal", width: VALOR, align: "right" },
];

const COLUNAS_RESULTADO: PdfColumn[] = [
  { header: "Componente", flex: 1 },
  { header: "Valor", width: VALOR, align: "right" },
];

const COLUNAS_OBSERVACOES: PdfColumn[] = [{ header: "Observação", flex: 1 }];

/**
 * "Custo-producao-OP-000087.pdf" — o código real é o da OP; o prefixo separa
 * este arquivo do da própria Ordem de Produção, que sai com o mesmo código.
 */
export function productionCostPdfFileName(cost: Pick<ProductionOrderCostDTO, "productionOrderCode">): string {
  return pdfFileName("Custo-producao", cost.productionOrderCode);
}

export function ProductionCostPdf({
  cost,
  generatedAt,
  generatedBy = null,
}: {
  cost: ProductionOrderCostDTO;
  generatedAt: Date;
  /** Quem gerou o arquivo — não substitui quem executou a produção. */
  generatedBy?: string | null;
}) {
  const partial = cost.totalIndustrialCost === null;
  const linhasPadrao = cost.standardApplied.length + cost.standardAppliedManual.length;

  return (
    <PdfDocument
      title="Custo industrial da produção"
      code={cost.productionOrderCode}
      status={REALIZED_COST_STATUS_LABELS[cost.status]}
      headerLines={[
        `Qualidade do custo: ${INDUSTRIAL_COST_QUALITY_LABELS[cost.quality]}`,
        generatedBy ? `Gerado por ${generatedBy}` : null,
      ]}
      footerNote={PRODUCTION_COST_FOOTER_NOTE}
      generatedAt={generatedAt}
    >
      <PdfSection title="Dados da produção">
        <PdfDataGrid
          fields={[
            { label: "Produto", value: `${cost.productCode} — ${cost.productName}`, span: 6 },
            { label: "Estrutura de custos", value: cost.industrialCostVersionLabel ?? "—", span: 4 },
            {
              label: "Formulação",
              value: cost.formulationVersionNumber ? `V${cost.formulationVersionNumber}` : "—",
              span: 2,
            },
            {
              label: "Produzido",
              value: `${formatQuantity(cost.producedQuantity)} ${cost.outputUnitCode}`,
              span: 3,
            },
            {
              label: "Proporção aplicada",
              // O impresso antigo escrevia o decimal cru ("0.95").
              value: cost.allocationFactor ? formatQuantity(cost.allocationFactor) : "—",
              span: 3,
            },
            {
              label: "Congelado em",
              value: cost.snapshotCreatedAt ? formatPdfDateTime(cost.snapshotCreatedAt) : "—",
              span: 3,
            },
          ]}
        />
      </PdfSection>

      <PdfNotice>
        {cost.hybrid
          ? "Híbrido: materiais realizados + custos industriais padrão aplicados. As horas de operador, de máquina e o consumo de energia não são medidos — são premissas da estrutura de custos."
          : "Materiais realizados. Os custos industriais adicionais dependem de estrutura de custos vinculada."}
      </PdfNotice>
      {partial ? (
        <PdfNotice>
          Cálculo parcial — existem custos não informados. O valor apresentado é o subtotal
          conhecido.
        </PdfNotice>
      ) : null}

      <PdfSection title="Materiais realizados">
        <PdfTable
          columns={COLUNAS_MATERIAIS}
          isEmpty={cost.materials.length === 0}
          emptyMessage="Nenhum consumo registrado."
          dense
        >
          {cost.materials.map((material) => (
            <PdfTr key={material.consumptionId}>
              <PdfTd>
                {material.itemCode} — {material.itemName}
              </PdfTd>
              <PdfTd>{material.lotCode ?? "—"}</PdfTd>
              <PdfTd>
                {formatQuantity(material.quantity)} {material.unitCode}
              </PdfTd>
              <PdfTd>{formatPdfDateTime(material.consumedAt)}</PdfTd>
              <PdfTd>{material.customerSupplied ? "Material do cliente" : formatUnitCost(material.unitCost)}</PdfTd>
              <PdfTd>{material.subtotal === null ? "—" : formatBRL(material.subtotal)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfBlock keepTogether={linhasPadrao <= BLOCO_MAXIMO}>
        <PdfSection title="Custos industriais padrão aplicados">
          <PdfTable
            columns={COLUNAS_PADRAO}
            isEmpty={linhasPadrao === 0}
            emptyMessage="Sem estrutura de custos vinculada — custos industriais adicionais não estruturados."
          >
            {cost.standardApplied.map((resource) => (
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
            {cost.standardAppliedManual.map((line) => (
              <PdfTr key={line.lineId}>
                <PdfTd>{line.description}</PdfTd>
                <PdfTd>Premissa</PdfTd>
                <PdfTd>{line.computedUnits ?? "—"}</PdfTd>
                <PdfTd>
                  {/* Premissa percentual é percentual: o impresso antigo a
                      escrevia como dinheiro ("R$ 8,00" para 8%). */}
                  {line.rateValue === null
                    ? "—"
                    : line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST"
                      ? formatPercent(line.rateValue)
                      : formatBRL(line.rateValue)}
                </PdfTd>
                <PdfTd>{line.subtotal === null ? "—" : formatBRL(line.subtotal)}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
        </PdfSection>
      </PdfBlock>

      {/* O resumo não se parte entre folhas. */}
      <PdfBlock>
        <PdfSection title="Resultado">
          <PdfTable columns={COLUNAS_RESULTADO}>
            <PdfTr>
              <PdfTd>Materiais realizados</PdfTd>
              <PdfTd>{formatBRL(cost.actualMaterialCostKnown)}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Custos padrão aplicados</PdfTd>
              <PdfTd>{formatBRL(cost.standardAppliedCostKnown)}</PdfTd>
            </PdfTr>
            <PdfTr emphasis>
              <PdfTd bold>{partial ? "Subtotal conhecido" : "Custo industrial da produção"}</PdfTd>
              <PdfTd bold>
                {partial ? formatBRL(cost.knownSubtotal) : formatBRL(cost.totalIndustrialCost)}
              </PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Custo por unidade produzida</PdfTd>
              <PdfTd>{formatUnitCost(cost.costPerProducedUnit)}</PdfTd>
            </PdfTr>
          </PdfTable>
        </PdfSection>
      </PdfBlock>

      {cost.warnings.length > 0 ? (
        <PdfBlock keepTogether={cost.warnings.length <= BLOCO_MAXIMO}>
          <PdfSection title="Observações do cálculo">
            <PdfTable columns={COLUNAS_OBSERVACOES}>
              {cost.warnings.map((warning) => (
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
