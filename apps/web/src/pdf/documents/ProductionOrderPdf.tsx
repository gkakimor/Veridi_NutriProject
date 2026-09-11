import {
  CONTROLLED_DOCUMENT_CODES,
  COST_QUALITY_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
} from "@veridi/shared";
import type { ProductionOrderDTO, ProductionOrderMaterialCostDTO } from "@veridi/shared";
import { formatPartShare } from "../../lib/part-share";
import {
  PdfBlock,
  PdfDataGrid,
  PdfDetails,
  PdfDocument,
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
  formatQuantityWithUnit,
  orDash,
  pdfFileName,
} from "../format";
import { ControlledRevisionSection } from "./controlled-revision";

/**
 * Ordem de produção — documento controlado R.PRO.002.
 *
 * Numeração OFICIAL quando já existe (nasce no RELEASE); antes disso, o código
 * interno, e o documento sai marcado como rascunho. O cliente é o snapshot
 * congelado no RELEASE, nunca o cadastro atual. O custo de material é
 * complementar: sem ele o documento sai inteiro, e custo PARTIAL/NO_COST nunca
 * aparece como total fechado.
 */

/** "Por parte" fecha a linha da matéria-prima, como no documento de sempre. */
const COLUNAS_MATERIA_PRIMA: PdfColumn[] = [
  { header: "Item", flex: 2 },
  { header: "Necessário", width: 62, align: "right" },
  { header: "Unidade", width: 44, align: "center" },
  { header: "Fornecimento", width: 66 },
  { header: "Proprietário esperado", flex: 1 },
  { header: "Por parte", width: 104, align: "right" },
];

const COLUNAS_EMBALAGEM: PdfColumn[] = [
  { header: "Item", flex: 2 },
  { header: "Necessário", width: 62, align: "right" },
  { header: "Unidade", width: 44, align: "center" },
  { header: "Fornecimento", width: 66 },
  { header: "Proprietário esperado", flex: 1 },
];

const COLUNAS_DISPONIBILIDADE: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Necessário", width: 62, align: "right" },
  { header: "Reservado", width: 62, align: "right" },
  { header: "Disponível", width: 62, align: "right" },
  { header: "Falta", width: 62, align: "right" },
  { header: "Unidade", width: 44, align: "center" },
];

const COLUNAS_CONSUMO: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Lote", width: 94 },
  { header: "Quantidade", width: 64, align: "right" },
  { header: "Unidade", width: 44, align: "center" },
  { header: "Consumido em", width: 78 },
  { header: "Por", width: 72 },
];

/** O motivo é texto livre: vai na linha de detalhe, com a largura inteira. */
const COLUNAS_CONSUMO_EXTRA: PdfColumn[] = [
  { header: "Item", flex: 1 },
  { header: "Lote", width: 94 },
  { header: "Quantidade adicional", width: 76, align: "right" },
  { header: "Solicitado por", width: 90 },
  { header: "Quando", width: 78 },
];

const COLUNAS_PRODUCAO: PdfColumn[] = [
  { header: "Lote produzido", width: 100 },
  { header: "Lote Veridi", width: 80 },
  { header: "Quantidade", width: 70, align: "right" },
  { header: "Apontado em", width: 80 },
  { header: "Por", flex: 1 },
];

/** "007/26" → `OP-007-26.pdf`; antes do RELEASE, o código interno: `OP-000123.pdf`. */
export function productionOrderPdfFileName(order: Pick<ProductionOrderDTO, "code" | "officialNumber">): string {
  return order.officialNumber ? pdfFileName("OP", order.officialNumber) : pdfFileName(order.code);
}

export function ProductionOrderPdf({
  order,
  cost,
  generatedAt,
}: {
  order: ProductionOrderDTO;
  cost: ProductionOrderMaterialCostDTO | null;
  generatedAt: Date;
}) {
  const materiasPrimas = order.requirements.filter((requirement) => requirement.itemType === "RAW_MATERIAL");
  const embalagens = order.requirements.filter((requirement) => requirement.itemType !== "RAW_MATERIAL");
  // Ampliações de reserva ficam num bloco próprio: o consumo já aparece acima;
  // o que faltava no papel era POR QUE foi além do planejado, quem pediu e quando.
  const ampliacoes = order.requirements
    .flatMap((requirement) => requirement.reservationLines)
    .filter((linha) => linha.extraReason !== null && linha.releasedAt === null);
  const endereco = [order.customerStreet, order.customerNumber, order.customerComplement, order.customerDistrict]
    .filter(Boolean)
    .join(", ");
  const cidadeUf = [order.customerCity, order.customerState].filter(Boolean).join(" / ");

  return (
    <PdfDocument
      title="Ordem de produção"
      code={order.officialNumber ?? order.code}
      status={PRODUCTION_ORDER_STATUS_LABELS[order.status]}
      isDraft={order.status === "DRAFT" || order.status === "PLANNED"}
      documentCode={CONTROLLED_DOCUMENT_CODES.PRODUCTION_ORDER}
      generatedAt={generatedAt}
    >
      <ControlledRevisionSection
        documentCode={CONTROLLED_DOCUMENT_CODES.PRODUCTION_ORDER}
        revision={order.productionOrderRevision}
      />

      <PdfSection title="Dados da ordem">
        <PdfDataGrid
          fields={[
            { label: "OP interna", value: order.code, span: 3 },
            { label: "Produto", value: `${order.productCode} — ${order.productName}`, span: 9 },
            { label: "Formulação", value: orDash(order.formulationVersionLabel), span: 3 },
            {
              label: "Planejado",
              value: formatQuantityWithUnit(order.plannedQuantity, order.outputUnitCode),
              span: 3,
            },
            {
              label: "Produzido",
              value: formatQuantityWithUnit(order.producedQuantity, order.outputUnitCode),
              span: 3,
            },
            {
              label: "Partes",
              value: order.numberOfParts > 1 ? `${order.numberOfParts} partes` : "Parte única",
              span: 3,
            },
            { label: "Início", value: formatPdfDateTime(order.startedAt), span: 3 },
            { label: "Conclusão", value: formatPdfDateTime(order.completedAt), span: 3 },
            { label: "Pedido do cliente", value: orDash(order.customerOrderCode), span: 3 },
          ]}
        />
      </PdfSection>

      {/* Snapshot congelado no RELEASE — nunca o cadastro atual. */}
      <PdfSection title="Cliente">
        <PdfDataGrid
          fields={[
            { label: "Razão social", value: orDash(order.customerName), span: 8 },
            { label: "CNPJ", value: order.customerCnpj ? formatCnpj(order.customerCnpj) : "—", span: 4 },
            { label: "Nome fantasia", value: order.customerTradeName, span: 8, optional: true },
            { label: "Código do cliente", value: order.customerCode, span: 4, optional: true },
            { label: "Endereço", value: endereco, span: 12, optional: true },
            { label: "Cidade / UF", value: cidadeUf, span: 8, optional: true },
            { label: "CEP", value: order.customerZipCode, span: 4, optional: true },
          ]}
        />
      </PdfSection>

      <PdfSection title="Matérias-primas">
        <PdfTable
          columns={COLUNAS_MATERIA_PRIMA}
          isEmpty={materiasPrimas.length === 0}
          emptyMessage="Ordem sem matéria-prima calculada."
        >
          {/*
            O rateio é o MESMO que a produção executa — `splitDecimal`, do pacote
            compartilhado, via `formatPartShare`. O documento não divide por
            conta própria: a Folha de Receita pesa por este número.
          */}
          {materiasPrimas.map((requirement) => (
            <PdfTr key={requirement.id}>
              <PdfTd>{`${requirement.itemCode} — ${requirement.itemName}`}</PdfTd>
              <PdfTd>{formatQuantity(requirement.requiredQuantity)}</PdfTd>
              <PdfTd>{requirement.stockUnitCode}</PdfTd>
              <PdfTd>{SUPPLY_RESPONSIBILITY_LABELS[requirement.supplyResponsibility]}</PdfTd>
              <PdfTd>{orDash(requirement.eligibleOwnerCustomerName)}</PdfTd>
              <PdfTd>{formatPartShare(requirement.requiredQuantity, order.numberOfParts)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Materiais de embalagem">
        <PdfTable columns={COLUNAS_EMBALAGEM} isEmpty={embalagens.length === 0} emptyMessage="Sem embalagem nesta ordem.">
          {embalagens.map((requirement) => (
            <PdfTr key={requirement.id}>
              <PdfTd>{`${requirement.itemCode} — ${requirement.itemName}`}</PdfTd>
              <PdfTd>{formatQuantity(requirement.requiredQuantity)}</PdfTd>
              <PdfTd>{requirement.stockUnitCode}</PdfTd>
              <PdfTd>{SUPPLY_RESPONSIBILITY_LABELS[requirement.supplyResponsibility]}</PdfTd>
              <PdfTd>{orDash(requirement.eligibleOwnerCustomerName)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      {/* Seção curta: título e campos na mesma folha. */}
      <PdfBlock>
        <PdfSection title="Dados para impressão do lote">
          <PdfDataGrid
            fields={[
              { label: "Lote comercial sugerido", value: orDash(order.suggestedBusinessLotNumber), span: 6 },
              {
                label: "Vida útil",
                value: order.shelfLifeMonths ? `${order.shelfLifeMonths} meses` : "—",
                span: 6,
              },
              { label: "Observações de rótulo", value: orDash(order.labelInstructions), span: 12 },
            ]}
          />
        </PdfSection>
      </PdfBlock>

      <PdfSection title="Disponibilidade de materiais">
        <PdfTable
          columns={COLUNAS_DISPONIBILIDADE}
          isEmpty={order.requirements.length === 0}
          emptyMessage="Ordem sem necessidade calculada."
        >
          {order.requirements.map((requirement) => (
            <PdfTr key={requirement.id}>
              <PdfTd>{`${requirement.itemCode} — ${requirement.itemName}`}</PdfTd>
              <PdfTd>{formatQuantity(requirement.requiredQuantity)}</PdfTd>
              <PdfTd>{formatQuantity(requirement.reserved)}</PdfTd>
              <PdfTd>{formatQuantity(requirement.available)}</PdfTd>
              <PdfTd>{formatQuantity(requirement.shortage)}</PdfTd>
              <PdfTd>{requirement.stockUnitCode}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Consumo real">
        <PdfTable columns={COLUNAS_CONSUMO} isEmpty={order.consumptions.length === 0} emptyMessage="Nenhum consumo registrado.">
          {order.consumptions.map((consumption) => (
            <PdfTr key={consumption.id}>
              <PdfTd>{`${consumption.itemCode} — ${consumption.itemName}`}</PdfTd>
              <PdfTd>{orDash(consumption.lotCode)}</PdfTd>
              <PdfTd>{formatQuantity(consumption.quantity)}</PdfTd>
              <PdfTd>{consumption.unitCode}</PdfTd>
              <PdfTd>{formatPdfDateTime(consumption.consumedAt)}</PdfTd>
              <PdfTd>{orDash(consumption.consumedBy)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      {ampliacoes.length > 0 ? (
        <PdfSection title="Consumo extra autorizado">
          <PdfTable columns={COLUNAS_CONSUMO_EXTRA}>
            {ampliacoes.map((linha) => (
              <PdfBlock key={linha.id}>
                <PdfTr continued>
                  <PdfTd>{`${linha.itemCode} — ${linha.itemName}`}</PdfTd>
                  <PdfTd>{orDash(linha.lotCode)}</PdfTd>
                  <PdfTd>{formatQuantityWithUnit(linha.quantity, linha.unitCode)}</PdfTd>
                  <PdfTd>{orDash(linha.extraRequestedBy)}</PdfTd>
                  <PdfTd>{formatPdfDateTime(linha.extraRequestedAt)}</PdfTd>
                </PdfTr>
                <PdfTr>
                  <PdfTd span={COLUNAS_CONSUMO_EXTRA.length}>
                    <PdfDetails items={[{ label: "Motivo", value: orDash(linha.extraReason) }]} />
                  </PdfTd>
                </PdfTr>
              </PdfBlock>
            ))}
          </PdfTable>
        </PdfSection>
      ) : null}

      <PdfSection title="Produção realizada">
        <PdfTable columns={COLUNAS_PRODUCAO} isEmpty={order.outputs.length === 0} emptyMessage="Nenhum apontamento de produção.">
          {order.outputs.map((output) => (
            <PdfTr key={output.id}>
              <PdfTd>{orDash(output.lotCode)}</PdfTd>
              <PdfTd>{orDash(output.businessLotNumber)}</PdfTd>
              <PdfTd>{formatQuantity(output.quantity)}</PdfTd>
              <PdfTd>{formatPdfDateTime(output.producedAt)}</PdfTd>
              <PdfTd>{orDash(output.producedBy)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
        <PdfTotals
          lines={[
            {
              label: "Planejado × realizado",
              value: `${formatQuantity(order.plannedQuantity)} / ${formatQuantity(order.producedQuantity)} ${order.outputUnitCode}`,
            },
          ]}
        />
      </PdfSection>

      {cost ? (
        <PdfBlock>
          <PdfSection title="Custo de material">
            {/* Custo PARTIAL/NO_COST nunca aparece como total fechado: o subtotal
                conhecido é rotulado como tal e a qualidade é visível. */}
            <PdfDataGrid
              fields={[
                { label: "Qualidade do custo", value: COST_QUALITY_LABELS[cost.quality], span: 3 },
                {
                  label: "Custo total de material",
                  value: cost.totalMaterialCost
                    ? formatBRL(cost.totalMaterialCost)
                    : `Indisponível — subtotal conhecido ${
                        cost.knownMaterialCostSubtotal ? formatBRL(cost.knownMaterialCostSubtotal) : "—"
                      }`,
                  span: 5,
                },
                {
                  label: "Custo por unidade produzida",
                  value: cost.materialUnitCost ? formatBRL(cost.materialUnitCost) : "—",
                  span: 4,
                },
              ]}
            />
          </PdfSection>
        </PdfBlock>
      ) : null}
    </PdfDocument>
  );
}
