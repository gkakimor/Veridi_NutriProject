import type { PricingVersionDTO } from "@veridi/shared";
import {
  COMMISSION_BASE_DESCRIPTION,
  CONTRIBUTION_DEFINITION,
  COST_PER_1000_EXPLANATION,
  COST_PER_1000_LABEL,
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRICE_MODE_LABELS,
  PRICING_VERSION_STATUS_LABELS,
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
import { formatBRL, formatDate, formatPercent, formatQuantity, pdfFileName } from "../format";

/**
 * Simulação de preço e margem — documento INTERNO de precificação.
 *
 * Não é orçamento ao cliente e não é documento fiscal. O que ele mostra é
 * margem de CONTRIBUIÇÃO — impostos, despesas financeiras e frete comercial
 * não estão modelados. Cada faixa é recalculada para a SUA quantidade: o
 * custo total da faixa é dela, e o equivalente por 1.000 é comparação entre
 * faixas, com a ressalva escrita no papel.
 *
 * Paisagem: onze colunas de número não cabem em retrato. O documento só
 * representa a versão que a API entrega — mesmas funções e mesmos textos do
 * impresso HTML que ele substitui.
 */

export const PRICING_INTERNAL_NOTICE =
  "Documento interno de precificação. Não é orçamento ao cliente e não é documento fiscal.";

/**
 * Seção curta não se parte: título, linhas e ressalva na mesma folha — o
 * título não fica sozinho no pé da página. Acima disso o bloco poderia passar
 * de uma folha; aí a tabela quebra normalmente, com o cabeçalho repetido.
 */
const BLOCO_MAXIMO = 12;

/** Quantidade na mesma coluna visual nas três tabelas. */
const QUANTIDADE = 62;

/** Modo, o único texto da tabela, leva a sobra; os números têm largura fixa. */
const COLUNAS_FAIXAS: PdfColumn[] = [
  { header: "Quantidade", width: QUANTIDADE, align: "right" },
  { header: "Custo/un", width: 62, align: "right" },
  { header: "Modo", flex: 1 },
  { header: "Margem alvo", width: 62, align: "right" },
  { header: "Comissão", width: 52, align: "right" },
  { header: "Preço", width: 62, align: "right" },
  { header: "Margem resultante", width: 66, align: "right" },
  { header: "Markup", width: 54, align: "right" },
  { header: "Contribuição/un", width: 78, align: "right" },
  { header: "Receita", width: 80, align: "right" },
  { header: "Contribuição total", width: 80, align: "right" },
];

const COLUNAS_CUSTO: PdfColumn[] = [
  { header: "Quantidade", width: QUANTIDADE, align: "right" },
  { header: "Lotes de referência", width: 92, align: "right" },
  { header: "Custo total da faixa", width: 160, align: "right" },
  { header: COST_PER_1000_LABEL, width: 120, align: "right" },
  { header: "Qualidade", flex: 1 },
];

const COLUNAS_OBSERVACOES: PdfColumn[] = [
  { header: "Faixa", width: QUANTIDADE, align: "right" },
  { header: "Observação", flex: 1 },
];

/** "PREC-000007-V2.pdf" — código e versão da precificação. */
export function pricingPdfFileName(pricing: Pick<PricingVersionDTO, "code" | "versionNumber">): string {
  return pdfFileName(pricing.code, `V${pricing.versionNumber}`);
}

export function PricingPdf({
  pricing,
  generatedAt,
  generatedBy = null,
}: {
  pricing: PricingVersionDTO;
  generatedAt: Date;
  /** Quem gerou o arquivo — não substitui quem criou ou ativou a versão. */
  generatedBy?: string | null;
}) {
  const incompleteTiers = pricing.tiers.filter(
    (tier) => tier.costQuality === "PARTIAL" || tier.costQuality === "NO_COST",
  );
  const observacoes =
    pricing.warnings.length + pricing.tiers.reduce((total, tier) => total + tier.warnings.length, 0);

  return (
    <PdfDocument
      title="Simulação de preço e margem"
      code={pricing.label}
      status={PRICING_VERSION_STATUS_LABELS[pricing.status]}
      isDraft={pricing.status === "DRAFT"}
      headerLines={[
        `Qualidade do custo: ${INDUSTRIAL_COST_QUALITY_LABELS[pricing.costQuality]}`,
        generatedBy ? `Gerado por ${generatedBy}` : null,
      ]}
      footerNote={PRICING_INTERNAL_NOTICE}
      generatedAt={generatedAt}
      landscape
    >
      <PdfSection title="Dados da precificação">
        <PdfDataGrid
          fields={[
            { label: "Produto", value: `${pricing.productCode} — ${pricing.productName}`, span: 5 },
            { label: "Cliente", value: pricing.customerName ?? "—", span: 3 },
            { label: "Cálculo de custo", value: pricing.calculationCode, span: 2 },
            { label: "Estrutura", value: pricing.industrialCostVersionLabel, span: 2 },
            { label: "Formulação", value: `V${pricing.formulationVersionNumber}`, span: 2 },
            {
              label: "Data de referência do custo",
              value: formatDate(pricing.costReferenceDate),
              span: 3,
            },
            { label: "Criada por", value: pricing.createdByName ?? "—", span: 3 },
            {
              label: "Ativada",
              value: pricing.activatedAt
                ? `${formatDate(pricing.activatedAt)} — ${pricing.activatedByName ?? "—"}`
                : "—",
              span: 4,
            },
          ]}
        />
      </PdfSection>

      <PdfNotice>{PRICING_INTERNAL_NOTICE}</PdfNotice>
      {incompleteTiers.length > 0 ? (
        <PdfNotice>
          Custo incompleto — margem não calculável para as faixas afetadas. O valor apresentado
          nessas linhas é o subtotal conhecido, nunca o custo total.
        </PdfNotice>
      ) : null}

      <PdfSection title="Faixas de quantidade">
        <PdfTable
          columns={COLUNAS_FAIXAS}
          isEmpty={pricing.tiers.length === 0}
          emptyMessage="Nenhuma faixa de quantidade cadastrada."
        >
          {pricing.tiers.map((tier) => (
            <PdfTr key={tier.id}>
              <PdfTd>
                {formatQuantity(tier.quantity)} {tier.uomCode}
              </PdfTd>
              <PdfTd>
                {tier.industrialCostPerUnit === null ? "—" : formatUnitCost(tier.industrialCostPerUnit)}
              </PdfTd>
              <PdfTd>{PRICE_MODE_LABELS[tier.priceMode]}</PdfTd>
              <PdfTd>{formatPercent(tier.targetContributionMarginPercent)}</PdfTd>
              <PdfTd>{formatPercent(tier.commissionPercent)}</PdfTd>
              <PdfTd>{formatUnitCost(tier.selectedUnitPrice)}</PdfTd>
              <PdfTd>{formatPercent(tier.contributionMarginPercent)}</PdfTd>
              <PdfTd>{formatPercent(tier.markupPercent)}</PdfTd>
              <PdfTd>{formatUnitCost(tier.contributionPerUnit)}</PdfTd>
              <PdfTd>{tier.grossRevenue === null ? "—" : formatBRL(tier.grossRevenue)}</PdfTd>
              <PdfTd>{tier.contributionTotal === null ? "—" : formatBRL(tier.contributionTotal)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
        <PdfNote>
          {CONTRIBUTION_DEFINITION} {COMMISSION_BASE_DESCRIPTION}
        </PdfNote>
      </PdfSection>

      <PdfBlock keepTogether={pricing.tiers.length <= BLOCO_MAXIMO}>
        <PdfSection title="Custo por faixa">
          <PdfTable
            columns={COLUNAS_CUSTO}
            isEmpty={pricing.tiers.length === 0}
            emptyMessage="Nenhuma faixa de quantidade cadastrada."
          >
            {pricing.tiers.map((tier) => (
              <PdfTr key={tier.id}>
                <PdfTd>
                  {formatQuantity(tier.quantity)} {tier.uomCode}
                </PdfTd>
                <PdfTd>{tier.batchCount}</PdfTd>
                <PdfTd>
                  {tier.industrialCostTotal === null
                    ? `${formatBRL(tier.knownSubtotal)} (subtotal conhecido)`
                    : formatBRL(tier.industrialCostTotal)}
                </PdfTd>
                <PdfTd>{tier.costPer1000 === null ? "—" : formatBRL(tier.costPer1000)}</PdfTd>
                <PdfTd>{INDUSTRIAL_COST_QUALITY_LABELS[tier.costQuality]}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
          {/* Cada faixa é recalculada para a SUA quantidade — a coluna de custo
              total é dela. A equivalência é comparação entre faixas, e no papel
              a ressalva precisa vir escrita. */}
          <PdfNote>{COST_PER_1000_EXPLANATION}</PdfNote>
        </PdfSection>
      </PdfBlock>

      {observacoes > 0 ? (
        <PdfBlock keepTogether={observacoes <= BLOCO_MAXIMO}>
          <PdfSection title="Observações">
            <PdfTable columns={COLUNAS_OBSERVACOES}>
              {pricing.warnings.map((warning, index) => (
                <PdfTr key={`${index}-${warning.code}`}>
                  <PdfTd>—</PdfTd>
                  <PdfTd>{warning.message}</PdfTd>
                </PdfTr>
              ))}
              {pricing.tiers.flatMap((tier) =>
                tier.warnings.map((warning, index) => (
                  <PdfTr key={`${tier.id}-${index}-${warning.code}`}>
                    <PdfTd>
                      {formatQuantity(tier.quantity)} {tier.uomCode}
                    </PdfTd>
                    <PdfTd>{warning.message}</PdfTd>
                  </PdfTr>
                )),
              )}
            </PdfTable>
          </PdfSection>
        </PdfBlock>
      ) : null}
    </PdfDocument>
  );
}
