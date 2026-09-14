import type { PricingModelConfig, PricingVersionDTO } from "@veridi/shared";
import {
  COMMISSION_BASE_DESCRIPTION,
  CONTRIBUTION_DEFINITION,
  COST_PER_1000_EXPLANATION,
  COST_PER_1000_LABEL,
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRICE_MODE_LABELS,
  PRICING_VERSION_STATUS_LABELS,
  textoDoCustoIndustrialNoPreco,
  textoDosImpostosNoPreco,
} from "@veridi/shared";
import { formatUnitCost } from "../../components/CostBreakdown";
import { custoQueFormaPreco, FORMATOS_DO_MODELO, usaModeloFlexivel } from "../../lib/pricing-cost";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDocument,
  PdfKeyValue,
  PdfNote,
  PdfNotice,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import {
  formatBRL,
  formatDate,
  formatPercent,
  formatQuantity,
  pdfFileName,
  formatIntegerPtBr,
} from "../format";

/**
 * Simulação de preço e margem — documento INTERNO de precificação.
 *
 * Não é orçamento ao cliente e não é documento fiscal. O que ele mostra é
 * margem de CONTRIBUIÇÃO — impostos, despesas financeiras e frete comercial
 * não estão modelados. Cada faixa é recalculada para a SUA quantidade: o
 * custo total da faixa é dela, e o equivalente por 1.000 é comparação entre
 * faixas, com a ressalva escrita no papel.
 *
 * O Modelo de Precificação da versão (§84) diz o que entra no custo que forma
 * o preço. No Modelo padrão esse custo é o do cálculo, e o papel é o de sempre.
 * Nos outros, os dois custos diferem de propósito: a tabela de preço mostra o
 * custo p/ preço — de onde saem preço, markup e contribuição —, a de custo
 * mostra o do cálculo, e a seção do Modelo diz o que foi considerado. Tudo sai
 * da versão como a API entrega; nada é recalculado aqui.
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
function colunasDasFaixas(custo: string): PdfColumn[] {
  return [
    { header: "Quantidade", width: QUANTIDADE, align: "right" },
    { header: custo, width: 62, align: "right" },
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
}

const COLUNAS_FAIXAS = colunasDasFaixas("Custo/un");

/**
 * Modelo flexível: o custo ao lado do preço é o que FORMOU preço, markup e
 * contribuição, com esse nome. O do cálculo mudaria de linha a conta de quem
 * confere o markup na mão.
 */
const COLUNAS_FAIXAS_MODELO = colunasDasFaixas("Custo p/ preço/un");

const COLUNAS_CUSTO: PdfColumn[] = [
  { header: "Quantidade", width: QUANTIDADE, align: "right" },
  { header: "Lotes de referência", width: 92, align: "right" },
  { header: "Custo total da faixa", width: 160, align: "right" },
  { header: COST_PER_1000_LABEL, width: 120, align: "right" },
  { header: "Qualidade", flex: 1 },
];

/**
 * Modelo flexível: a tabela de custo é a do CÁLCULO e diz isso na coluna — e o
 * custo do cálculo por unidade sai aqui, porque a tabela de preço mostra o
 * custo p/ preço.
 */
const COLUNAS_CUSTO_MODELO: PdfColumn[] = [
  { header: "Quantidade", width: QUANTIDADE, align: "right" },
  { header: "Lotes de referência", width: 92, align: "right" },
  { header: "Custo do cálculo da faixa", width: 160, align: "right" },
  { header: "Custo do cálculo/un", width: 80, align: "right" },
  { header: COST_PER_1000_LABEL, width: 120, align: "right" },
  { header: "Qualidade", flex: 1 },
];

const COLUNAS_OBSERVACOES: PdfColumn[] = [
  { header: "Faixa", width: QUANTIDADE, align: "right" },
  { header: "Observação", flex: 1 },
];

/** Modelo padrão: uma linha basta — o custo da tabela de preço é o do cálculo. */
const MODELO_PADRAO =
  "Padrão — o preço se forma sobre o custo do cálculo; impostos estimados não entram na conta.";

/**
 * Os dois custos do Modelo flexível, cada um com o seu nome. No papel não há ⓘ,
 * e quem lê não pode concluir que precisam ser iguais.
 */
const DEFINICAO_DOS_DOIS_CUSTOS =
  "Custo p/ preço: o custo considerado na formação do preço — materiais mais o que o Modelo de Precificação desta versão manda considerar; preço, markup e contribuição saem dele. O custo do cálculo (CMV) fica na tabela de custo, como referência: os dois não precisam ser iguais.";

/*
 * O Modelo por extenso, com a base dita (§84). Modo desligado não leva valor:
 * o valor guardado de outro modo — ou debaixo da gestão externa — não entra na
 * conta, e escrito no papel pareceria entrar.
 */

function custoIndustrialNoPreco(modelo: PricingModelConfig): string {
  // As palavras são do shared: R-19, R-20 e CMV contam o Modelo com as mesmas.
  return textoDoCustoIndustrialNoPreco(modelo, FORMATOS_DO_MODELO);
}

function impostosNoPreco(modelo: PricingModelConfig): string {
  const texto = textoDosImpostosNoPreco(modelo, FORMATOS_DO_MODELO);
  if (modelo.externalAdditionalCosts) return texto;
  switch (modelo.estimatedTaxMode) {
    case "IGNORE":
      return texto;
    case "PERCENT_SALE_PRICE":
      // Percentual sobre a venda não é custo: vai ao divisor, como a comissão.
      return `${texto} — no divisor do preço, com margem e comissão`;
    case "PER_UNIT":
    case "TOTAL":
      return `${texto} — somados ao custo p/ preço`;
  }
}

function gestaoExterna(modelo: PricingModelConfig): string {
  return modelo.externalAdditionalCosts
    ? "Sim — custo industrial e impostos do Modelo ficam fora da conta; o custo de materiais continua calculado"
    : "Não";
}

/** "TPP-000004 · V3 — Revenda Lucro Presumido": de onde o Modelo desta versão foi copiado. */
function politicaDeOrigem(pricing: PricingVersionDTO): string | null {
  if (!pricing.originPricingPolicyCode) return null;
  const versao =
    pricing.originPricingPolicyVersionNumber === null ? "" : ` · V${pricing.originPricingPolicyVersionNumber}`;
  const nome = pricing.originPricingPolicyName ? ` — ${pricing.originPricingPolicyName}` : "";
  return `${pricing.originPricingPolicyCode}${versao}${nome}`;
}

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
  // A mesma leitura da tela de Precificação: fora do Modelo padrão, o custo que
  // forma o preço deixa de ser o do cálculo.
  const modelo = usaModeloFlexivel(pricing) ? (pricing.pricingModel ?? null) : null;
  const incompleteTiers = pricing.tiers.filter(
    (tier) => tier.costQuality === "PARTIAL" || tier.costQuality === "NO_COST",
  );
  // Sem custo p/ preço não existe margem. Com Modelo flexível, cálculo parcial
  // não implica isso: um Modelo que não usa a conversão forma preço e margem
  // sobre os materiais.
  const precoSemCusto = pricing.tiers.some((tier) => custoQueFormaPreco(tier) === null);
  const origem = politicaDeOrigem(pricing);
  const observacoes =
    pricing.warnings.length + pricing.tiers.reduce((total, tier) => total + tier.warnings.length, 0);

  return (
    <PdfDocument
      title="Simulação de preço e margem"
      code={pricing.label}
      status={PRICING_VERSION_STATUS_LABELS[pricing.status]}
      isDraft={pricing.status === "DRAFT"}
      headerLines={[
        `${modelo ? "Qualidade do custo do cálculo" : "Qualidade do custo"}: ${INDUSTRIAL_COST_QUALITY_LABELS[pricing.costQuality]}`,
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
      {!modelo && incompleteTiers.length > 0 ? (
        <PdfNotice>
          Custo incompleto — margem não calculável para as faixas afetadas. O valor apresentado
          nessas linhas é o subtotal conhecido, nunca o custo total.
        </PdfNotice>
      ) : null}
      {modelo && precoSemCusto ? (
        <PdfNotice>Custo p/ preço incompleto — margem não calculável para as faixas afetadas.</PdfNotice>
      ) : null}
      {modelo && incompleteTiers.length > 0 ? (
        <PdfNotice>
          Custo do cálculo incompleto — a tabela de custo mostra o subtotal conhecido dessas faixas,
          nunca o custo total.
          {precoSemCusto
            ? ""
            : " O Modelo de Precificação desta versão não usa a parte que falta: preço e margem saíram do custo p/ preço."}
        </PdfNotice>
      ) : null}

      <PdfBlock>
        <PdfSection title="Modelo de Precificação">
          {origem ? <PdfKeyValue label="Política de origem:">{origem}</PdfKeyValue> : null}
          {modelo ? (
            <>
              <PdfKeyValue label="Custo industrial no preço:">{custoIndustrialNoPreco(modelo)}</PdfKeyValue>
              <PdfKeyValue label="Impostos estimados:">{impostosNoPreco(modelo)}</PdfKeyValue>
              <PdfKeyValue label="Custos adicionais administrados externamente:">
                {gestaoExterna(modelo)}
              </PdfKeyValue>
            </>
          ) : (
            <PdfKeyValue label="Modelo aplicado:">{MODELO_PADRAO}</PdfKeyValue>
          )}
        </PdfSection>
      </PdfBlock>

      <PdfSection title="Faixas de quantidade">
        <PdfTable
          columns={modelo ? COLUNAS_FAIXAS_MODELO : COLUNAS_FAIXAS}
          isEmpty={pricing.tiers.length === 0}
          emptyMessage="Nenhuma faixa de quantidade cadastrada."
        >
          {pricing.tiers.map((tier) => {
            // No Modelo padrão os dois custos são o mesmo, e a coluna segue a de sempre.
            const custo = modelo ? custoQueFormaPreco(tier) : tier.industrialCostPerUnit;
            return (
              <PdfTr key={tier.id}>
                <PdfTd>
                  {formatQuantity(tier.quantity)} {tier.uomCode}
                </PdfTd>
                <PdfTd>{custo === null ? "—" : formatUnitCost(custo)}</PdfTd>
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
            );
          })}
        </PdfTable>
        <PdfNote>
          {modelo ? `${DEFINICAO_DOS_DOIS_CUSTOS} ` : ""}
          {CONTRIBUTION_DEFINITION} {COMMISSION_BASE_DESCRIPTION}
        </PdfNote>
      </PdfSection>

      <PdfBlock keepTogether={pricing.tiers.length <= BLOCO_MAXIMO}>
        <PdfSection title="Custo por faixa">
          <PdfTable
            columns={modelo ? COLUNAS_CUSTO_MODELO : COLUNAS_CUSTO}
            isEmpty={pricing.tiers.length === 0}
            emptyMessage="Nenhuma faixa de quantidade cadastrada."
          >
            {pricing.tiers.map((tier) => (
              <PdfTr key={tier.id}>
                <PdfTd>
                  {formatQuantity(tier.quantity)} {tier.uomCode}
                </PdfTd>
                <PdfTd>{formatIntegerPtBr(tier.batchCount)}</PdfTd>
                <PdfTd>
                  {tier.industrialCostTotal === null
                    ? `${formatBRL(tier.knownSubtotal)} (subtotal conhecido)`
                    : formatBRL(tier.industrialCostTotal)}
                </PdfTd>
                {modelo ? <PdfTd>{formatUnitCost(tier.industrialCostPerUnit)}</PdfTd> : null}
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
