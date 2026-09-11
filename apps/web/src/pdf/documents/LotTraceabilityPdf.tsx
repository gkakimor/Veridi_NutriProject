import { LOT_STATUS_LABELS } from "@veridi/shared";
import type {
  FinishedLotTraceabilityDTO,
  LotDTO,
  LotTraceabilityDTO,
  RawMaterialLotTraceabilityDTO,
} from "@veridi/shared";
import {
  PdfDataGrid,
  PdfDocument,
  PdfSection,
  PdfSubheading,
  PdfTable,
  PdfTd,
  PdfTr,
  type PdfColumn,
} from "../components";
import { formatDate, formatQuantity, formatQuantityWithUnit, orDash, pdfFileName } from "../format";

/**
 * Rastreabilidade de lote — backward para produto acabado (o que foi
 * realmente consumido e para onde o lote saiu), forward para insumo (em que
 * ordens e amostras ele foi consumido).
 *
 * Vai para auditoria e para o cliente, e circula sem link para conferir:
 * origem e destino ficam separados também no papel.
 */

/** Seis colunas, duas de código de lote e duas de texto longo: tabela densa. */
const COLUNAS_CONSUMIDOS: PdfColumn[] = [
  { header: "Item", flex: 4 },
  { header: "Lote interno", width: 80 },
  { header: "Lote de origem", width: 68 },
  { header: "Origem do material", flex: 3 },
  { header: "Quantidade", width: 56, align: "right" },
  { header: "Unidade", width: 42, align: "center" },
];

const COLUNAS_EXPEDICOES: PdfColumn[] = [
  { header: "Expedição", width: 66 },
  { header: "Pedido atendido", width: 66 },
  { header: "Cliente", flex: 1 },
  { header: "Data", width: 58 },
  { header: "Quantidade deste lote", width: 96, align: "right" },
];

/** Consumido e unidade fecham as duas tabelas do insumo, no mesmo lugar. */
const COLUNAS_ORDENS: PdfColumn[] = [
  { header: "OP", width: 66 },
  { header: "Produto", flex: 3 },
  { header: "Lotes de produto acabado gerados", flex: 2 },
  { header: "Consumido", width: 64, align: "right" },
  { header: "Unidade", width: 48, align: "center" },
];

const COLUNAS_AMOSTRAS: PdfColumn[] = [
  { header: "Amostra", width: 60 },
  { header: "Teste", flex: 3 },
  { header: "Projeto", flex: 3 },
  { header: "Cliente", flex: 3 },
  { header: "Consumido", width: 64, align: "right" },
  { header: "Unidade", width: 48, align: "center" },
];

export function lotTraceabilityPdfFileName(lot: Pick<LotDTO, "code">): string {
  return pdfFileName("Rastreabilidade", lot.code);
}

export function LotTraceabilityPdf({
  lot,
  traceability,
  generatedAt,
}: {
  lot: LotDTO;
  traceability: LotTraceabilityDTO;
  generatedAt: Date;
}) {
  /*
   * Lote Veridi é de produto acabado; fornecedor, lote do fornecedor e
   * recebimento, de insumo. O que não se aplica ao lote sai do papel; o que se
   * aplica e está vazio continua como "—" — ausência também é informação numa
   * rastreabilidade.
   */
  const acabado = traceability.kind === "FINISHED_GOOD";

  return (
    <PdfDocument title="Rastreabilidade de lote" code={lot.code} generatedAt={generatedAt}>
      <PdfSection title="Lote">
        <PdfDataGrid
          fields={[
            { label: "Item", value: `${lot.itemCode} — ${lot.itemName}`, span: 8 },
            { label: "Lote interno", value: lot.code, span: 4 },
            { label: "Lote Veridi", value: orDash(lot.businessLotNumber), span: 4, optional: !acabado },
            { label: "Lote do fornecedor", value: orDash(lot.supplierLot), span: 4, optional: acabado },
            { label: "Fornecedor", value: orDash(lot.supplierName), span: 8, optional: acabado },
            { label: "Validade", value: formatDate(lot.expiryDate), span: 4 },
            {
              label: "Qualidade",
              value: lot.isExpired ? "Vencido" : LOT_STATUS_LABELS[lot.status],
              span: 4,
            },
            { label: "Recebimento", value: orDash(lot.receiptCode), span: 4, optional: acabado },
          ]}
        />
      </PdfSection>

      {traceability.kind === "FINISHED_GOOD" ? (
        <ProdutoAcabado rastro={traceability} />
      ) : (
        <Insumo rastro={traceability} />
      )}
    </PdfDocument>
  );
}

function ProdutoAcabado({ rastro }: { rastro: FinishedLotTraceabilityDTO }) {
  const destino = rastro.commercialDestination;
  return (
    <>
      <PdfSection title="Produção">
        <PdfDataGrid
          fields={[
            { label: "Produto", value: `${rastro.productCode} — ${rastro.productName}`, span: 6 },
            { label: "Ordem de Produção", value: rastro.productionOrderCode, span: 3 },
            {
              label: "Quantidade produzida",
              value: formatQuantityWithUnit(rastro.producedQuantity, rastro.unitCode),
              span: 3,
            },
          ]}
        />
      </PdfSection>

      <PdfSection title="Materiais realmente consumidos">
        <PdfTable
          columns={COLUNAS_CONSUMIDOS}
          dense
          isEmpty={rastro.consumedMaterials.length === 0}
          emptyMessage="Nenhum consumo registrado para este lote."
        >
          {rastro.consumedMaterials.map((material) => (
            <PdfTr key={`${material.itemId}-${material.lotId ?? "sem-lote"}`}>
              <PdfTd>{`${material.itemCode} — ${material.itemName}`}</PdfTd>
              <PdfTd>{orDash(material.lotCode)}</PdfTd>
              <PdfTd>{orDash(material.supplierLot)}</PdfTd>
              <PdfTd>
                {material.ownerType === "CUSTOMER"
                  ? `Material do cliente — ${material.ownerCustomerName ?? "cliente não identificado"}`
                  : orDash(material.supplierName)}
              </PdfTd>
              <PdfTd>{formatQuantity(material.quantity)}</PdfTd>
              <PdfTd>{material.unitCode}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      {/*
        Fecha a cadeia fornecedor → cliente no mesmo documento, em seção
        separada: cliente é destino, não origem de material. O pedido de ORIGEM
        (por que o lote foi produzido) e as SAÍDAS (para onde ele foi, com o
        pedido realmente atendido em cada linha) ficam separados: um lote
        produzido para um pedido pode ter saído atendendo outro.
      */}
      {destino ? (
        <PdfSection title="Destino comercial">
          <PdfDataGrid
            fields={[
              {
                label: "Pedido de origem",
                value: destino.customerOrderCode ?? "Produzido para estoque — sem pedido de origem",
                span: 6,
              },
              destino.customerName
                ? {
                    label: "Cliente do pedido de origem",
                    value: [destino.customerCode, destino.customerName].filter(Boolean).join(" — "),
                    span: 6,
                  }
                : null,
              {
                label: "Projeto",
                value: destino.projectCode
                  ? [destino.projectCode, destino.projectName].filter(Boolean).join(" — ")
                  : "—",
                span: 6,
              },
            ]}
          />
          <PdfSubheading title="Saídas deste lote" />
          <PdfTable
            columns={COLUNAS_EXPEDICOES}
            isEmpty={destino.shipments.length === 0}
            emptyMessage="Este lote ainda não foi expedido."
          >
            {destino.shipments.map((shipment) => (
              <PdfTr key={shipment.shipmentId}>
                <PdfTd>{shipment.shipmentCode}</PdfTd>
                <PdfTd>{shipment.customerOrderCode}</PdfTd>
                <PdfTd>{`${shipment.customerCode} — ${shipment.customerName}`}</PdfTd>
                <PdfTd>{formatDate(shipment.shipmentDate)}</PdfTd>
                <PdfTd>{formatQuantityWithUnit(shipment.quantity, rastro.unitCode)}</PdfTd>
              </PdfTr>
            ))}
          </PdfTable>
        </PdfSection>
      ) : null}
    </>
  );
}

function Insumo({ rastro }: { rastro: RawMaterialLotTraceabilityDTO }) {
  return (
    <PdfSection title="Ordens de Produção que consumiram este lote">
      <PdfTable
        columns={COLUNAS_ORDENS}
        isEmpty={rastro.usedIn.length === 0}
        emptyMessage="Este lote ainda não foi consumido em nenhuma Ordem de Produção."
      >
        {rastro.usedIn.map((usage) => (
          <PdfTr key={usage.productionOrderId}>
            <PdfTd>{usage.productionOrderCode}</PdfTd>
            <PdfTd>{`${usage.productCode} — ${usage.productName}`}</PdfTd>
            <PdfTd>
              {usage.finishedLots
                .map((finished) => `${finished.lotCode} (${formatQuantity(finished.producedQuantity)})`)
                .join(", ") || "—"}
            </PdfTd>
            <PdfTd>{formatQuantity(usage.consumedQuantity)}</PdfTd>
            <PdfTd>{usage.unitCode}</PdfTd>
          </PdfTr>
        ))}
      </PdfTable>

      <PdfSubheading title="Amostras que consumiram este lote" />
      <PdfTable
        columns={COLUNAS_AMOSTRAS}
        isEmpty={rastro.usedInSamples.length === 0}
        emptyMessage="Este lote nunca foi consumido em amostra."
      >
        {rastro.usedInSamples.map((usage) => (
          <PdfTr key={usage.sampleId}>
            <PdfTd>{usage.sampleCode}</PdfTd>
            <PdfTd>{usage.testLabel}</PdfTd>
            <PdfTd>{`${usage.projectCode} — ${usage.projectName}`}</PdfTd>
            <PdfTd>{usage.customerName}</PdfTd>
            <PdfTd>{formatQuantity(usage.consumedQuantity)}</PdfTd>
            <PdfTd>{usage.unitCode}</PdfTd>
          </PdfTr>
        ))}
      </PdfTable>
    </PdfSection>
  );
}
