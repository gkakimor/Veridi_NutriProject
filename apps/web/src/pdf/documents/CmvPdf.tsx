import {
  CMV_GROUP_LABELS,
  COST_PER_1000_EXPLANATION,
  COST_PER_1000_LABEL,
  INDUSTRIAL_COST_QUALITY_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
} from "@veridi/shared";
import type { CmvComponentDTO, CmvGroup, ProductCmvResponse } from "@veridi/shared";
import {
  PdfDataGrid,
  PdfDocument,
  PdfNote,
  PdfNotice,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfText,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatBRL, formatDate, formatQuantity, formatUnitPriceBRL, orDash, pdfFileName } from "../format";

/**
 * CMV — a base econômica de uma quantidade.
 *
 * Imprime a BASE CONGELADA e nada mais. A simulação "com os dados de hoje"
 * orienta quem define o produto na tela; papel circula, e um número
 * provisório em PDF vira, dois dias depois, o custo que alguém usou para
 * fechar preço. O que sai daqui é o que se reproduz — cálculo salvo, com
 * código e data. Custo parcial sai dizendo que é parcial: subtotal conhecido
 * nunca se disfarça de total.
 *
 * O documento só representa a resposta da API; o cálculo do CMV não é tocado.
 */

export const CMV_FOOTER_NOTE = "Documento interno — base econômica congelada; não vai ao cliente.";

const GROUP_ORDER: CmvGroup[] = [
  "FORMULA_MATERIAL",
  "PACKAGING",
  "CUSTOMER_SUPPLIED",
  "INDUSTRIAL_RESOURCE",
  "OVERHEAD",
];

const COLUNAS_COMPONENTES: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Quantidade", width: 96, align: "right" },
  { header: "Origem do custo", width: 104 },
  { header: "Custo unitário", width: 74, align: "right" },
  { header: "Subtotal", width: 80, align: "right" },
];

const COLUNAS_RESULTADO: PdfColumn[] = [
  { header: "Medida", flex: 1 },
  { header: "Valor", width: 110, align: "right" },
];

const COLUNAS_PRECIFICACAO: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Valor", width: 190, align: "right" },
];

/** "CMV-PROD-000045-300-un-2026-09-09.pdf": produto, quantidade e data de referência. */
export function cmvPdfFileName(
  data: Pick<ProductCmvResponse, "productCode" | "outputUomCode">,
  quantity: string,
  referenceDate: string,
): string {
  return pdfFileName("CMV", data.productCode, quantity, data.outputUomCode, referenceDate);
}

/** Unidade de recurso vem como enum de tarifa ("HOUR") — no papel vira hora. */
function describeUnit(unitCode: string | null): string {
  if (!unitCode) return "";
  const tarifa = INDUSTRIAL_RATE_UOM_LABELS[unitCode as keyof typeof INDUSTRIAL_RATE_UOM_LABELS];
  return tarifa ?? unitCode;
}

function describeOrigin(costSource: string | null, customerSupplied: boolean): string {
  if (customerSupplied) return "Fornecido pelo cliente";
  if (!costSource) return "—";
  const label = (INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS as Record<string, string>)[costSource];
  return label ?? costSource;
}

/**
 * Quantidade da linha. Recurso com mais de um equivalente sai "2 × 4 hora" com
 * "Total: 8 hora" embaixo (§87) — valores da API: `requiredQuantity` é o total
 * e `quantityPerResource` o uso de cada um.
 */
function QuantidadeDoComponente({ component }: { component: CmvComponentDTO }) {
  if (!component.requiredQuantity) return <PdfText>—</PdfText>;
  const unidade = describeUnit(component.unitCode);
  const comUnidade = (quantidade: string) => [formatQuantity(quantidade), unidade].filter(Boolean).join(" ");
  if ((component.resourceCount ?? 1) > 1 && component.quantityPerResource) {
    return (
      <>
        <PdfText>{`${component.resourceCount} × ${comUnidade(component.quantityPerResource)}`}</PdfText>
        <PdfNote>{`Total: ${comUnidade(component.requiredQuantity)}`}</PdfNote>
      </>
    );
  }
  return <PdfText>{comUnidade(component.requiredQuantity)}</PdfText>;
}

export function CmvPdf({
  data,
  quantity,
  referenceDate,
  generatedAt,
  generatedBy,
}: {
  data: ProductCmvResponse;
  /** Quantidade pedida na tela (parâmetro da rota). */
  quantity: string;
  referenceDate: string;
  generatedAt: Date;
  generatedBy?: string | null | undefined;
}) {
  const simulation = data.simulation;
  const parcial = simulation !== null && simulation.totalCost === null;

  return (
    <PdfDocument
      title="CMV — custo da mercadoria vendida"
      code={data.calculationCode ? `${data.productCode} · ${data.calculationCode}` : data.productCode}
      headerLines={[
        simulation ? `Qualidade do custo: ${INDUSTRIAL_COST_QUALITY_LABELS[simulation.quality]}` : "Sem base econômica",
        generatedBy ? `Gerado por ${generatedBy}` : null,
      ]}
      footerNote={CMV_FOOTER_NOTE}
      generatedAt={generatedAt}
    >
      {/* O papel diz de qual retrato fala: sem isto, um PDF de três semanas
          atrás é indistinguível do custo de hoje. */}
      <PdfNotice>
        Base econômica congelada. Os valores descrevem os documentos citados abaixo, não o estado atual do
        cadastro.
      </PdfNotice>
      {data.unavailableReason ? <PdfNotice>{data.unavailableReason}</PdfNotice> : null}
      {parcial ? (
        <PdfNotice>
          CMV parcial — há custos não informados. O valor apresentado é o subtotal conhecido e não representa o
          custo total.
        </PdfNotice>
      ) : null}
      {data.basisFormulationVersionNumber !== null &&
      data.formulationVersionNumber !== null &&
      data.basisFormulationVersionNumber !== data.formulationVersionNumber ? (
        <PdfNotice>
          Este CMV descreve a formulação V{data.basisFormulationVersionNumber}; a formulação ativa do produto é V
          {data.formulationVersionNumber}.
        </PdfNotice>
      ) : null}

      <PdfSection title="Produto e base">
        <PdfDataGrid
          fields={[
            { label: "Produto", value: `${data.productCode} — ${data.productName}`, span: 8 },
            { label: "Cliente", value: orDash(data.customerName), span: 4 },
            { label: "Quantidade", value: `${formatQuantity(quantity)} ${data.outputUomCode}`, span: 3 },
            { label: "Data de referência", value: formatDate(referenceDate), span: 3 },
            {
              label: "Formulação usada",
              value: data.basisFormulationVersionNumber ? `V${data.basisFormulationVersionNumber}` : "—",
              span: 3,
            },
            { label: "Estrutura de custos", value: orDash(data.industrialCostVersionLabel), span: 3 },
            {
              label: "Base de produção",
              value: data.referenceOutputQuantity
                ? `${formatQuantity(data.referenceOutputQuantity)} ${data.referenceOutputUomCode ?? ""}`.trim()
                : "—",
              span: 4,
            },
            {
              label: "Cálculo de referência",
              value: data.calculationCode
                ? `${data.calculationCode} · ${formatDate(data.calculationReferenceDate)}`
                : "—",
              span: 8,
            },
          ]}
        />
      </PdfSection>

      {simulation
        ? GROUP_ORDER.map((group) => {
            const rows = simulation.components.filter((component) => component.group === group);
            if (rows.length === 0) return null;
            return (
              <PdfSection key={group} title={CMV_GROUP_LABELS[group]}>
                <PdfTable columns={COLUNAS_COMPONENTES}>
                  {rows.map((component, index) => (
                    <PdfTr key={`${group}-${component.code}-${index}`}>
                      {/* Linha que não é item de estoque tem `code` técnico — o
                          modo de rateio, o tipo do recurso: sai só o nome. */}
                      <PdfTd>{component.itemId ? `${component.code} — ${component.name}` : component.name}</PdfTd>
                      <PdfTd>
                        <QuantidadeDoComponente component={component} />
                      </PdfTd>
                      <PdfTd>{describeOrigin(component.costSource, component.customerSupplied)}</PdfTd>
                      <PdfTd>{component.unitCost ? formatBRL(component.unitCost) : "—"}</PdfTd>
                      <PdfTd>{component.totalCost ? formatBRL(component.totalCost) : "—"}</PdfTd>
                    </PdfTr>
                  ))}
                </PdfTable>
              </PdfSection>
            );
          })
        : null}

      {simulation ? (
        <PdfSection title="Resultado">
          <PdfTable columns={COLUNAS_RESULTADO}>
            <PdfTr>
              <PdfTd>Quantidade calculada</PdfTd>
              <PdfTd>{`${formatQuantity(simulation.quantity)} ${simulation.uomCode}`}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Lotes de referência</PdfTd>
              <PdfTd>{formatQuantity(simulation.batchCount)}</PdfTd>
            </PdfTr>
            <PdfTr emphasis>
              <PdfTd bold>
                {`${parcial ? "Subtotal conhecido" : "CMV total"} para ${formatQuantity(simulation.quantity)} ${simulation.uomCode}`}
              </PdfTd>
              <PdfTd bold>{formatBRL(parcial ? simulation.knownSubtotal : simulation.totalCost)}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>CMV por unidade</PdfTd>
              <PdfTd>{simulation.costPerUnit ? formatBRL(simulation.costPerUnit) : "—"}</PdfTd>
            </PdfTr>
            {/* No papel não há ⓘ para abrir: a explicação vai impressa junto,
                senão o comparativo volta a parecer produção de 1.000. */}
            <PdfTr>
              <PdfTd>
                <PdfText>{COST_PER_1000_LABEL}</PdfText>
                <PdfNote>{COST_PER_1000_EXPLANATION}</PdfNote>
              </PdfTd>
              <PdfTd>{simulation.costPer1000 ? formatBRL(simulation.costPer1000) : "—"}</PdfTd>
            </PdfTr>
          </PdfTable>
        </PdfSection>
      ) : null}

      {/* Preço só sai no papel para quem a API deixou ver: o gate é o mesmo da
          tela, e o PDF não é uma segunda porta. */}
      {data.pricing ? (
        <PdfSection title="Precificação vigente">
          <PdfTable columns={COLUNAS_PRECIFICACAO}>
            <PdfTr>
              <PdfTd>Versão</PdfTd>
              <PdfTd>{data.pricing.pricingVersionLabel}</PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Faixa desta quantidade</PdfTd>
              <PdfTd>
                {data.pricing.tierQuantity
                  ? formatQuantity(data.pricing.tierQuantity)
                  : "Não há faixa para esta quantidade exata"}
              </PdfTd>
            </PdfTr>
            <PdfTr>
              <PdfTd>Preço unitário</PdfTd>
              <PdfTd>{data.pricing.unitPrice ? formatUnitPriceBRL(data.pricing.unitPrice) : "—"}</PdfTd>
            </PdfTr>
          </PdfTable>
        </PdfSection>
      ) : null}

      {simulation && simulation.warnings.length > 0 ? (
        <PdfSection title="Observações do cálculo">
          <PdfTable columns={[{ header: "Observação", flex: 1 }]}>
            {simulation.warnings.map((warning, index) => (
              <PdfTr key={`${warning.code}-${index}`}>
                <PdfTd>{warning.message}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
        </PdfSection>
      ) : null}
    </PdfDocument>
  );
}
