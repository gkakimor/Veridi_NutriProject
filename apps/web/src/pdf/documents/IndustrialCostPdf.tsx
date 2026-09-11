import {
  DIRECT_INDUSTRIAL_COST_DEFINITION,
  ENERGY_CALCULATION_MODE_LABELS,
  FORMULATION_COMPONENT_BASIS_LABELS,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_VERSION_STATUS_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  INDUSTRIAL_USAGE_BASIS_LABELS,
} from "@veridi/shared";
import type {
  FormulationComponentBasis,
  IndustrialCostMaterialDTO,
  IndustrialCostResourceUsageDTO,
  IndustrialCostVersionDTO,
} from "@veridi/shared";
import { formatUnitCost } from "../../components/CostBreakdown";
import {
  PdfDataGrid,
  PdfDocument,
  PdfNote,
  PdfNotice,
  PdfParagraph,
  PdfSection,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatPdfDateTime, formatPercent, formatQuantity, orDash, pdfFileName } from "../format";
import { PdfResourceUsage } from "./resource-usage";

/**
 * Estrutura de custos industriais — documento de ESTRUTURA E PREMISSAS.
 *
 * Não traz total: o custo industrial consolidado é calculado em outra etapa, e
 * chamar de custo o que ainda não foi calculado é a forma mais fácil de alguém
 * precificar errado — por isso o aviso vai impresso. Rascunho imprime a tarifa
 * de referência de hoje; versão ativa, a tarifa congelada na ativação. Tarifa
 * ausente permanece ausente no papel.
 *
 * O documento só representa a versão que a API entrega; conta não se faz aqui.
 */

export const INDUSTRIAL_COST_FOOTER_NOTE =
  "Documento interno — estrutura e premissas de custo; não é o custo calculado.";

/** Explica o que a estrutura sabe — e o que não sabe — sobre pureza e overage. */
export const PUREZA_OVERAGE_REGISTRO =
  "Pureza e overage: valores registrados no componente da Formulação. A estrutura de custos não informa o modo do componente nem se esses ajustes alteraram a quantidade — isso está na Formulação.";

const COLUNAS_MATERIAIS: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Quantidade", width: 62, align: "right" },
  { header: "Un.", width: 30, align: "center" },
  { header: "Base", width: 80 },
  { header: "Pureza", width: 44, align: "right" },
  { header: "Overage", width: 44, align: "right" },
  { header: "Fornecimento", width: 70 },
];

const COLUNAS_PREMISSAS: PdfColumn[] = [
  { header: "Categoria", width: 96 },
  { header: "Descrição", flex: 1 },
  { header: "Base de cálculo", width: 130 },
  { header: "Valor", width: 76, align: "right" },
];

function colunasRecursos(status: IndustrialCostVersionDTO["status"]): PdfColumn[] {
  return [
    { header: "Recurso", flex: 1 },
    { header: "Tipo", width: 62 },
    { header: "Consumo", width: 82, align: "right" },
    { header: "Base", width: 80 },
    { header: status === "DRAFT" ? "Tarifa de referência" : "Tarifa congelada", width: 84, align: "right" },
    { header: "Energia derivada", width: 62, align: "right" },
  ];
}

/** "EC-000012-V3.pdf": código e versão da estrutura. */
export function industrialCostPdfFileName(version: Pick<IndustrialCostVersionDTO, "code" | "versionNumber">): string {
  return pdfFileName(version.code, `V${version.versionNumber}`);
}

function tarifa(usage: IndustrialCostResourceUsageDTO, status: IndustrialCostVersionDTO["status"]): string {
  if (status === "DRAFT") {
    return usage.currentRate
      ? `${formatUnitCost(usage.currentRate.rateValue)} / ${INDUSTRIAL_RATE_UOM_LABELS[usage.currentRate.rateUom]}`
      : "—";
  }
  if (!usage.rateValueSnapshot || !usage.rateUomSnapshot) return "—";
  return `${formatUnitCost(usage.rateValueSnapshot)} / ${INDUSTRIAL_RATE_UOM_LABELS[usage.rateUomSnapshot]}`;
}

/** Percentual registrado: `null` é "não informado" ("—"); 0% continua 0%. */
function percentual(valor: string | null): string {
  return valor === null ? "—" : formatPercent(valor);
}

function base(material: IndustrialCostMaterialDTO): string {
  return FORMULATION_COMPONENT_BASIS_LABELS[material.basis as FormulationComponentBasis] ?? material.basis;
}

export function IndustrialCostPdf({
  version,
  generatedAt,
  generatedBy,
}: {
  version: IndustrialCostVersionDTO;
  generatedAt: Date;
  generatedBy?: string | null | undefined;
}) {
  // Snapshot congelado na ativação: renomear produto/cliente depois não
  // reescreve o documento já emitido.
  const productCode = version.productCodeSnapshot ?? version.productCode;
  const productName = version.productNameSnapshot ?? version.productName;
  const customerName = version.customerNameSnapshot ?? version.customerName;

  return (
    <PdfDocument
      title="Estrutura de custos industriais"
      code={`${version.code} · V${version.versionNumber}`}
      status={INDUSTRIAL_COST_VERSION_STATUS_LABELS[version.status]}
      isDraft={version.status === "DRAFT"}
      headerLines={[generatedBy ? `Gerado por ${generatedBy}` : null]}
      footerNote={INDUSTRIAL_COST_FOOTER_NOTE}
      generatedAt={generatedAt}
    >
      <PdfNotice>
        Documento de estrutura e premissas de custo. O custo industrial consolidado é calculado separadamente.
      </PdfNotice>

      <PdfSection title="Produto e referência">
        <PdfDataGrid
          fields={[
            { label: "Produto", value: `${productCode} — ${productName}`, span: 8 },
            { label: "Formulação", value: `V${version.formulationVersionNumber}`, span: 4 },
            { label: "Cliente", value: orDash(customerName), span: 8 },
            {
              label: "Base de referência",
              value: `${formatQuantity(version.referenceOutputQuantity)} ${version.referenceOutputUomCode}`,
              span: 4,
            },
            {
              label: "Unidades por caixa",
              value: version.unitsPerShippingBox === null ? "—" : String(version.unitsPerShippingBox),
              span: 4,
            },
            { label: "Situação", value: version.complete ? "Completa" : "Com pendências", span: 4 },
            { label: "Criada por", value: orDash(version.createdByName), span: 4 },
            {
              label: "Ativada",
              value: version.activatedAt
                ? `${formatPdfDateTime(version.activatedAt)} — ${orDash(version.activatedByName)}`
                : null,
              span: 8,
              optional: true,
            },
          ]}
        />
      </PdfSection>

      <PdfSection title="Matérias-primas e embalagens (da formulação)">
        <PdfTable
          columns={COLUNAS_MATERIAIS}
          dense
          isEmpty={version.materials.length === 0}
          emptyMessage="A formulação vinculada não tem componentes."
        >
          {version.materials.map((material) => (
            <PdfTr key={material.itemId}>
              <PdfTd>{`${material.itemCode} — ${material.itemName}`}</PdfTd>
              <PdfTd>{formatQuantity(material.quantity)}</PdfTd>
              <PdfTd>{material.unitCode}</PdfTd>
              <PdfTd>{base(material)}</PdfTd>
              <PdfTd>{percentual(material.purityPercentApplied)}</PdfTd>
              <PdfTd>{percentual(material.overagePercent)}</PdfTd>
              {/* Material do cliente pertence à estrutura física, não ao custo
                  de aquisição da Veridi. */}
              <PdfTd>{material.customerSupplied ? "Fornecido pelo cliente" : "Veridi"}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
        {version.materials.length > 0 ? <PdfNote>{PUREZA_OVERAGE_REGISTRO}</PdfNote> : null}
      </PdfSection>

      <PdfSection title="Premissas de custo adicionais">
        <PdfTable
          columns={COLUNAS_PREMISSAS}
          isEmpty={version.lines.length === 0}
          emptyMessage="Nenhuma premissa adicional registrada."
        >
          {version.lines.map((line) => (
            <PdfTr key={line.id}>
              <PdfTd>{INDUSTRIAL_COST_CATEGORY_LABELS[line.category]}</PdfTd>
              <PdfTd>{line.description}</PdfTd>
              <PdfTd>{INDUSTRIAL_COST_BASIS_LABELS[line.calculationBasis]}</PdfTd>
              {/* Valor desconhecido continua "—": nunca R$ 0,00. */}
              <PdfTd>
                {line.rateValue === null
                  ? "—"
                  : line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST"
                    ? formatPercent(line.rateValue)
                    : formatUnitCost(line.rateValue)}
              </PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
        <PdfParagraph muted>Custo industrial direto: {DIRECT_INDUSTRIAL_COST_DEFINITION}</PdfParagraph>
      </PdfSection>

      <PdfSection title="Recursos industriais">
        <PdfTable
          columns={colunasRecursos(version.status)}
          dense
          isEmpty={version.resourceUsages.length === 0}
          emptyMessage="Nenhum recurso declarado nesta estrutura."
        >
          {version.resourceUsages.map((usage) => (
            <PdfTr key={usage.id}>
              <PdfTd>{`${usage.resourceCode} — ${usage.resourceNameSnapshot ?? usage.resourceName}`}</PdfTd>
              <PdfTd>{INDUSTRIAL_RESOURCE_TYPE_LABELS[usage.resourceType]}</PdfTd>
              {/* "2 × 2 hora" e o total do servidor embaixo (§87). */}
              <PdfTd>
                <PdfResourceUsage
                  resourceCount={usage.resourceCount}
                  usageQuantity={usage.usageQuantity}
                  totalUsageQuantity={usage.totalUsageQuantity}
                  usageUom={usage.usageUom}
                />
              </PdfTd>
              <PdfTd>{INDUSTRIAL_USAGE_BASIS_LABELS[usage.usageBasis]}</PdfTd>
              <PdfTd>{tarifa(usage, version.status)}</PdfTd>
              {/* Potência desconhecida deixa a energia em aberto — nunca 0 kWh. */}
              <PdfTd>{usage.derivedEnergyKwh ? `${formatQuantity(usage.derivedEnergyKwh)} kWh` : "—"}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
        <PdfParagraph muted>
          Energia: {ENERGY_CALCULATION_MODE_LABELS[version.energyCalculationMode]}
          {version.energyCalculationMode === "FROM_EQUIPMENT"
            ? version.derivedEnergyKwh
              ? ` — ${formatQuantity(version.derivedEnergyKwh)} kWh por lote de referência`
              : " — em aberto: há equipamento sem potência informada"
            : ""}
          .{" "}
          {version.status === "DRAFT"
            ? "Rascunho: as tarifas exibidas são a referência de hoje e ainda podem mudar."
            : "As tarifas exibidas foram congeladas na ativação desta versão."}
        </PdfParagraph>
      </PdfSection>

      {version.pendencies.length > 0 ? (
        <PdfSection title="Pendências">
          <PdfTable columns={[{ header: "Pendência", flex: 1 }]}>
            {version.pendencies.map((pendency, indice) => (
              <PdfTr key={`${indice}-${pendency.description}`}>
                <PdfTd>{pendency.description}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
        </PdfSection>
      ) : null}

      {version.notes ? (
        <PdfSection title="Observações">
          <PdfParagraph>{version.notes}</PdfParagraph>
        </PdfSection>
      ) : null}
    </PdfDocument>
  );
}
