import type {
  BillingDTO,
  CustomerOrderDTO,
  LotDTO,
  LotTraceabilityDTO,
  ProductionOrderDTO,
  QuoteVersionDTO,
  RecipeSheetDTO,
  ProductionOrderMaterialCostDTO,
  PurchaseOrderDTO,
  ReceiptDTO,
  ShipmentDTO,
} from "@veridi/shared";
import {
  BILLING_NON_FISCAL_NOTICE,
  CONTROLLED_DOCUMENT_CODES,
  PRODUCTION_PART_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
  BILLING_STATUS_LABELS,
  COST_QUALITY_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  LOT_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@veridi/shared";
import {
  PrintLayout,
  PrintSection,
  PrintTable,
  formatPrintDate,
  formatPrintDateTime,
  printOrDash,
} from "./PrintLayout";
import { formatBRL } from "../lib/currency";

/**
 * Documentos imprimíveis — componentes PUROS sobre os DTOs que já existem.
 *
 * Documentos históricos (CONFIRMED/ISSUED/COMPLETED) imprimem o snapshot
 * gravado no próprio documento, nunca o cadastro atual: o nome do cliente
 * congelado no faturamento manda sobre o cadastro de hoje.
 */

function money(value: string | null): string {
  // Preço/custo desconhecido nunca vira zero.
  return value === null ? "—" : formatBRL(value);
}

/** Pedido do Cliente. */
export function CustomerOrderPrintDocument({ order }: { order: CustomerOrderDTO }) {
  return (
    <PrintLayout
      kind="Pedido do Cliente"
      code={order.code}
      status={CUSTOMER_ORDER_STATUS_LABELS[order.status]}
      isDraft={order.status === "DRAFT"}
      meta={[
        { label: "Cliente", value: printOrDash(order.customerName) },
        { label: "CNPJ", value: printOrDash(order.customerCnpj) },
        { label: "Data do pedido", value: formatPrintDate(order.orderDate) },
        { label: "Entrega solicitada", value: formatPrintDate(order.requestedDeliveryDate) },
      ]}
    >
      <PrintSection title="Produtos">
        <PrintTable
          columns={["Produto", "Pedido", "Reservado/Expedido", "Faturado", "Falta expedir", "Unidade"]}
          isEmpty={order.lines.length === 0}
          emptyMessage="Pedido sem produtos."
        >
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.productCode} — {line.productName}
              </td>
              <td className="is-number">{line.orderedQuantity}</td>
              <td className="is-number">{line.shippedQuantity}</td>
              <td className="is-number">{line.billedQuantity}</td>
              <td className="is-number">{line.outstandingQuantity}</td>
              <td>{line.unitCode}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      {order.notes && (
        <PrintSection title="Observações">
          <p>{order.notes}</p>
        </PrintSection>
      )}
    </PrintLayout>
  );
}

/** Ordem de Compra. */
export function PurchaseOrderPrintDocument({ order }: { order: PurchaseOrderDTO }) {
  return (
    <PrintLayout
      kind="Ordem de Compra"
      code={order.code}
      status={PURCHASE_ORDER_STATUS_LABELS[order.status]}
      isDraft={order.status === "DRAFT"}
      meta={[
        { label: "Fornecedor", value: order.supplierName },
        { label: "CNPJ", value: printOrDash(order.supplierCnpj) },
        { label: "Data do pedido", value: formatPrintDate(order.orderDate) },
        { label: "Previsão de entrega", value: formatPrintDate(order.expectedDeliveryDate) },
        {
          label: "Origem",
          value: order.origin === "CUSTOMER_ORDER" ? "Pedido do cliente" : "Manual",
        },
        { label: "Pedido relacionado", value: printOrDash(order.customerOrderCode) },
      ]}
    >
      <PrintSection title="Itens">
        <PrintTable
          columns={["Item", "Quantidade", "Unidade", "Preço previsto", "Total da linha", "Recebido", "Em aberto"]}
          isEmpty={order.lines.length === 0}
          emptyMessage="Ordem sem itens."
        >
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.itemCode} — {line.itemName}
              </td>
              <td className="is-number">{line.orderedQuantity}</td>
              <td>{line.unitCode}</td>
              <td className="is-number">{money(line.unitPrice)}</td>
              <td className="is-number">{money(line.lineTotal)}</td>
              <td className="is-number">{line.receivedQuantity}</td>
              <td className="is-number">{line.openQuantity}</td>
            </tr>
          ))}
        </PrintTable>
        {/* Valor previsto só existe com preço em todas as linhas. */}
        <p>
          <strong>Valor previsto:</strong>{" "}
          {order.orderTotal ? formatBRL(order.orderTotal) : "Preço incompleto — total não disponível"}
        </p>
      </PrintSection>

      {order.notes && (
        <PrintSection title="Observações">
          <p>{order.notes}</p>
        </PrintSection>
      )}
    </PrintLayout>
  );
}

/** Recebimento. */
export function ReceiptPrintDocument({ receipt }: { receipt: ReceiptDTO }) {
  return (
    <PrintLayout
      kind="Recebimento"
      code={receipt.code}
      meta={[
        { label: "Data", value: formatPrintDate(receipt.receivedAt) },
        { label: "Fornecedor", value: receipt.supplierName },
        { label: "Ordem de Compra", value: receipt.purchaseOrderCode },
        { label: "Nota fiscal", value: printOrDash(receipt.invoiceNumber) },
        { label: "Documento", value: printOrDash(receipt.documentReference) },
        { label: "Recebido por", value: printOrDash(receipt.createdBy) },
      ]}
    >
      <PrintSection title="Itens recebidos">
        <PrintTable
          columns={[
            "Item",
            "Quantidade",
            "Unidade",
            "Lote interno",
            "Lote do fornecedor",
            "Validade",
            "Localização",
            "Preço previsto",
            "Custo efetivo",
          ]}
          isEmpty={receipt.lines.length === 0}
          emptyMessage="Recebimento sem itens."
        >
          {receipt.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.itemCode} — {line.itemName}
              </td>
              <td className="is-number">{line.receivedQuantity}</td>
              <td>{line.unitCode}</td>
              <td>{printOrDash(line.lotCode)}</td>
              <td>{printOrDash(line.supplierLot)}</td>
              <td>{formatPrintDate(line.expiryDate)}</td>
              <td>{printOrDash(line.location)}</td>
              <td className="is-number">{money(line.purchaseUnitPrice)}</td>
              {/* Sem custo informado fica "—" e nunca zero. */}
              <td className="is-number">{money(line.actualUnitCost)}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>
    </PrintLayout>
  );
}

/** Ordem de Produção. */
export function ProductionOrderPrintDocument({
  order,
  cost,
}: {
  order: ProductionOrderDTO;
  cost: ProductionOrderMaterialCostDTO | null;
}) {
  return (
    <PrintLayout
      kind="Ordem de Produção"
      // Numeração OFICIAL quando já existe (nasce no RELEASE); antes disso,
      // o código interno — e o documento sai marcado como rascunho.
      code={order.officialNumber ?? order.code}
      status={PRODUCTION_ORDER_STATUS_LABELS[order.status]}
      isDraft={order.status === "DRAFT" || order.status === "PLANNED"}
      documentCode={CONTROLLED_DOCUMENT_CODES.PRODUCTION_ORDER}
      revision={order.productionOrderRevision}
      meta={[
        { label: "OP interna", value: order.code },
        { label: "Produto", value: `${order.productCode} — ${order.productName}` },
        { label: "Formulação", value: printOrDash(order.formulationVersionLabel) },
        { label: "Planejado", value: `${order.plannedQuantity} ${order.outputUnitCode}` },
        { label: "Produzido", value: `${order.producedQuantity} ${order.outputUnitCode}` },
        {
          label: "Partes",
          value: order.numberOfParts > 1 ? `${order.numberOfParts} partes` : "Parte única",
        },
        { label: "Início", value: formatPrintDateTime(order.startedAt) },
        { label: "Conclusão", value: formatPrintDateTime(order.completedAt) },
        { label: "Pedido do cliente", value: printOrDash(order.customerOrderCode) },
      ]}
    >
      <PrintSection title="Cliente">
        {/* Snapshot congelado no RELEASE — nunca o cadastro atual. */}
        <dl className="print-doc__meta">
          <div>
            <dt>Cliente</dt>
            <dd>
              {printOrDash(order.customerCode)} — {printOrDash(order.customerName)}
            </dd>
          </div>
          <div>
            <dt>Nome fantasia</dt>
            <dd>{printOrDash(order.customerTradeName)}</dd>
          </div>
          <div>
            <dt>CNPJ</dt>
            <dd>{printOrDash(order.customerCnpj)}</dd>
          </div>
          <div>
            <dt>Endereço</dt>
            <dd>
              {[
                order.customerStreet,
                order.customerNumber,
                order.customerComplement,
                order.customerDistrict,
              ]
                .filter(Boolean)
                .join(", ") || "—"}
            </dd>
          </div>
          <div>
            <dt>Cidade / UF</dt>
            <dd>
              {[order.customerCity, order.customerState].filter(Boolean).join(" / ") || "—"}
            </dd>
          </div>
          <div>
            <dt>CEP</dt>
            <dd>{printOrDash(order.customerZipCode)}</dd>
          </div>
        </dl>
      </PrintSection>
      <PrintSection title="Matérias-primas">
        <PrintTable
          columns={[
            "Item",
            "Necessário",
            "Unidade",
            "Fornecimento",
            "Proprietário esperado",
            "Por parte",
          ]}
          isEmpty={order.requirements.filter((row) => row.itemType === "RAW_MATERIAL").length === 0}
          emptyMessage="Ordem sem matéria-prima calculada."
        >
          {order.requirements
            .filter((requirement) => requirement.itemType === "RAW_MATERIAL")
            .map((requirement) => (
              <tr key={requirement.id}>
                <td>
                  {requirement.itemCode} — {requirement.itemName}
                </td>
                <td className="is-number">{requirement.requiredQuantity}</td>
                <td>{requirement.stockUnitCode}</td>
                <td>{SUPPLY_RESPONSIBILITY_LABELS[requirement.supplyResponsibility]}</td>
                <td>{printOrDash(requirement.eligibleOwnerCustomerName)}</td>
                <td className="is-number">
                  {order.numberOfParts > 1
                    ? `${(Number(requirement.requiredQuantity) / order.numberOfParts).toFixed(6)} × ${order.numberOfParts}`
                    : "—"}
                </td>
              </tr>
            ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Materiais de embalagem">
        <PrintTable
          columns={["Item", "Necessário", "Unidade", "Fornecimento", "Proprietário esperado"]}
          isEmpty={order.requirements.filter((row) => row.itemType !== "RAW_MATERIAL").length === 0}
          emptyMessage="Sem embalagem nesta ordem."
        >
          {order.requirements
            .filter((requirement) => requirement.itemType !== "RAW_MATERIAL")
            .map((requirement) => (
              <tr key={requirement.id}>
                <td>
                  {requirement.itemCode} — {requirement.itemName}
                </td>
                <td className="is-number">{requirement.requiredQuantity}</td>
                <td>{requirement.stockUnitCode}</td>
                <td>{SUPPLY_RESPONSIBILITY_LABELS[requirement.supplyResponsibility]}</td>
                <td>{printOrDash(requirement.eligibleOwnerCustomerName)}</td>
              </tr>
            ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Dados para impressão do lote">
        <dl className="print-doc__meta">
          <div>
            <dt>Lote comercial sugerido</dt>
            <dd>{printOrDash(order.suggestedBusinessLotNumber)}</dd>
          </div>
          <div>
            <dt>Vida útil</dt>
            <dd>{order.shelfLifeMonths ? `${order.shelfLifeMonths} meses` : "—"}</dd>
          </div>
          <div>
            <dt>Observações de rótulo</dt>
            <dd>{printOrDash(order.labelInstructions)}</dd>
          </div>
        </dl>
      </PrintSection>

      <PrintSection title="Disponibilidade de materiais">
        <PrintTable
          columns={["Item", "Necessário", "Reservado", "Disponível", "Falta", "Unidade"]}
          isEmpty={order.requirements.length === 0}
          emptyMessage="Ordem sem necessidade calculada."
        >
          {order.requirements.map((requirement) => (
            <tr key={requirement.id}>
              <td>
                {requirement.itemCode} — {requirement.itemName}
              </td>
              <td className="is-number">{requirement.requiredQuantity}</td>
              <td className="is-number">{requirement.reserved}</td>
              <td className="is-number">{requirement.available}</td>
              <td className="is-number">{requirement.shortage}</td>
              <td>{requirement.stockUnitCode}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Consumo real">
        <PrintTable
          columns={["Item", "Lote", "Quantidade", "Unidade", "Consumido em", "Por"]}
          isEmpty={order.consumptions.length === 0}
          emptyMessage="Nenhum consumo registrado."
        >
          {order.consumptions.map((consumption) => (
            <tr key={consumption.id}>
              <td>
                {consumption.itemCode} — {consumption.itemName}
              </td>
              <td>{printOrDash(consumption.lotCode)}</td>
              <td className="is-number">{consumption.quantity}</td>
              <td>{consumption.unitCode}</td>
              <td>{formatPrintDateTime(consumption.consumedAt)}</td>
              <td>{printOrDash(consumption.consumedBy)}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Produção realizada">
        <PrintTable
          columns={["Lote produzido", "Lote Veridi", "Quantidade", "Apontado em", "Por"]}
          isEmpty={order.outputs.length === 0}
          emptyMessage="Nenhum apontamento de produção."
        >
          {order.outputs.map((output) => (
            <tr key={output.id}>
              <td>{printOrDash(output.lotCode)}</td>
              <td>{printOrDash(output.businessLotNumber)}</td>
              <td className="is-number">{output.quantity}</td>
              <td>{formatPrintDateTime(output.producedAt)}</td>
              <td>{printOrDash(output.producedBy)}</td>
            </tr>
          ))}
        </PrintTable>
        <p>
          <strong>Planejado × realizado:</strong> {order.plannedQuantity} / {order.producedQuantity}{" "}
          {order.outputUnitCode}
        </p>
      </PrintSection>

      {cost && (
        <PrintSection title="Custo de material">
          {/* Custo PARTIAL/NO_COST nunca aparece como total fechado: o
              subtotal conhecido é rotulado como tal e a qualidade é visível. */}
          <p>
            <strong>Qualidade do custo:</strong> {COST_QUALITY_LABELS[cost.quality]}
          </p>
          <p>
            <strong>Custo total de material:</strong>{" "}
            {cost.totalMaterialCost
              ? formatBRL(cost.totalMaterialCost)
              : `Indisponível — subtotal conhecido ${
                  cost.knownMaterialCostSubtotal ? formatBRL(cost.knownMaterialCostSubtotal) : "—"
                }`}
          </p>
          <p>
            <strong>Custo por unidade produzida:</strong>{" "}
            {cost.materialUnitCost ? formatBRL(cost.materialUnitCost) : "—"}
          </p>
        </PrintSection>
      )}
    </PrintLayout>
  );
}

/** Expedição — comprovante/romaneio operacional, nunca documento fiscal. */
export function ShipmentPrintDocument({ shipment }: { shipment: ShipmentDTO }) {
  return (
    <PrintLayout
      kind="Expedição"
      code={shipment.code}
      status={SHIPMENT_STATUS_LABELS[shipment.status]}
      isDraft={shipment.status === "DRAFT"}
      notice="Comprovante operacional de expedição — não é Nota Fiscal."
      meta={[
        { label: "Pedido", value: shipment.customerOrderCode },
        { label: "Cliente", value: printOrDash(shipment.customerName) },
        { label: "Data da expedição", value: formatPrintDate(shipment.shipmentDate) },
        { label: "Confirmada em", value: formatPrintDateTime(shipment.confirmedAt) },
        { label: "Confirmada por", value: printOrDash(shipment.confirmedBy) },
      ]}
    >
      <PrintSection title="Produtos expedidos">
        <PrintTable
          columns={["Produto", "Lote", "Lote Veridi", "Quantidade", "Unidade", "Conferido em", "Conferido por"]}
          isEmpty={shipment.lines.length === 0}
          emptyMessage="Expedição sem itens."
        >
          {shipment.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.productCode} — {line.productName}
              </td>
              <td>{printOrDash(line.lotCode)}</td>
              <td>{printOrDash(line.businessLotNumber)}</td>
              <td className="is-number">{line.quantity}</td>
              <td>{line.unitCode}</td>
              <td>{formatPrintDateTime(line.verifiedAt)}</td>
              <td>{printOrDash(line.verifiedBy)}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>
    </PrintLayout>
  );
}

/** Faturamento — documento comercial/operacional, jamais fiscal. */
export function BillingPrintDocument({ billing }: { billing: BillingDTO }) {
  return (
    <PrintLayout
      kind="Faturamento"
      code={billing.code}
      status={BILLING_STATUS_LABELS[billing.status]}
      isDraft={billing.status === "DRAFT"}
      notice={BILLING_NON_FISCAL_NOTICE}
      meta={[
        { label: "Pedido", value: billing.customerOrderCode },
        { label: "Expedição", value: billing.shipmentCode },
        { label: "Cliente", value: printOrDash(billing.customerName) },
        { label: "CNPJ", value: printOrDash(billing.customerCnpj) },
        { label: "Emitido em", value: formatPrintDateTime(billing.issuedAt) },
        { label: "Emitido por", value: printOrDash(billing.issuedBy) },
        { label: "Referência externa", value: printOrDash(billing.externalReference) },
      ]}
    >
      <PrintSection title="Itens faturados">
        <PrintTable
          columns={["Produto", "Lote", "Lote Veridi", "Quantidade", "Unidade", "Preço unitário", "Total"]}
          isEmpty={billing.lines.length === 0}
          emptyMessage="Faturamento sem itens."
        >
          {billing.lines.map((line) => (
            <tr key={line.id}>
              <td>
                {line.productCode} — {line.productName}
              </td>
              <td>{printOrDash(line.lotCode)}</td>
              <td>{printOrDash(line.businessLotNumber)}</td>
              <td className="is-number">{line.quantity}</td>
              <td>{line.unitCode}</td>
              <td className="is-number">{money(line.unitPrice)}</td>
              <td className="is-number">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </PrintTable>
        {/* Total só com precificação completa — parcial nunca vira total. */}
        <p>
          <strong>Valor total:</strong>{" "}
          {billing.hasCompletePricing && billing.totalAmount
            ? formatBRL(billing.totalAmount)
            : "Precificação incompleta — total não disponível"}
        </p>
      </PrintSection>
    </PrintLayout>
  );
}

/** Rastreabilidade de lote (backward para PA, forward para insumo). */
export function LotTraceabilityPrintDocument({
  lot,
  traceability,
}: {
  lot: LotDTO;
  traceability: LotTraceabilityDTO;
}) {
  const meta = [
    { label: "Item", value: `${lot.itemCode} — ${lot.itemName}` },
    { label: "Lote interno", value: lot.code },
    { label: "Lote Veridi", value: printOrDash(lot.businessLotNumber) },
    { label: "Lote do fornecedor", value: printOrDash(lot.supplierLot) },
    { label: "Fornecedor", value: printOrDash(lot.supplierName) },
    { label: "Validade", value: formatPrintDate(lot.expiryDate) },
    { label: "Qualidade", value: lot.isExpired ? "Vencido" : LOT_STATUS_LABELS[lot.status] },
    { label: "Recebimento", value: printOrDash(lot.receiptCode) },
  ];

  return (
    <PrintLayout kind="Rastreabilidade de Lote" code={lot.code} meta={meta}>
      {traceability.kind === "FINISHED_GOOD" ? (
        <>
          <PrintSection title="Produção">
            <dl className="print-doc__meta">
              <div>
                <dt>Produto</dt>
                <dd>
                  {traceability.productCode} — {traceability.productName}
                </dd>
              </div>
              <div>
                <dt>Ordem de Produção</dt>
                <dd>{traceability.productionOrderCode}</dd>
              </div>
              <div>
                <dt>Quantidade produzida</dt>
                <dd>
                  {traceability.producedQuantity} {traceability.unitCode}
                </dd>
              </div>
            </dl>
          </PrintSection>

          <PrintSection title="Materiais realmente consumidos">
            <PrintTable
              columns={["Item", "Lote interno", "Lote do fornecedor", "Fornecedor", "Quantidade", "Unidade"]}
              isEmpty={traceability.consumedMaterials.length === 0}
              emptyMessage="Nenhum consumo registrado para este lote."
            >
              {traceability.consumedMaterials.map((material) => (
                <tr key={`${material.itemId}-${material.lotId ?? "sem-lote"}`}>
                  <td>
                    {material.itemCode} — {material.itemName}
                  </td>
                  <td>{printOrDash(material.lotCode)}</td>
                  <td>{printOrDash(material.supplierLot)}</td>
                  <td>{printOrDash(material.supplierName)}</td>
                  <td className="is-number">{material.quantity}</td>
                  <td>{material.unitCode}</td>
                </tr>
              ))}
            </PrintTable>
          </PrintSection>
        </>
      ) : (
        <PrintSection title="Ordens de Produção que consumiram este lote">
          <PrintTable
            columns={["OP", "Produto", "Consumido", "Unidade", "Lotes de produto acabado gerados"]}
            isEmpty={traceability.usedIn.length === 0}
            emptyMessage="Este lote ainda não foi consumido em nenhuma Ordem de Produção."
          >
            {traceability.usedIn.map((usage) => (
              <tr key={usage.productionOrderId}>
                <td>{usage.productionOrderCode}</td>
                <td>
                  {usage.productCode} — {usage.productName}
                </td>
                <td className="is-number">{usage.consumedQuantity}</td>
                <td>{usage.unitCode}</td>
                <td>
                  {usage.finishedLots
                    .map((finished) => `${finished.lotCode} (${finished.producedQuantity})`)
                    .join(", ") || "—"}
                </td>
              </tr>
            ))}
          </PrintTable>

          <PrintTable
            columns={["Amostra", "Teste", "Projeto", "Cliente", "Consumido", "Unidade"]}
            isEmpty={traceability.usedInSamples.length === 0}
            emptyMessage="Este lote nunca foi consumido em amostra."
          >
            {traceability.usedInSamples.map((usage) => (
              <tr key={usage.sampleId}>
                <td>{usage.sampleCode}</td>
                <td>{usage.testLabel}</td>
                <td>
                  {usage.projectCode} — {usage.projectName}
                </td>
                <td>{usage.customerName}</td>
                <td className="is-number">{usage.consumedQuantity}</td>
                <td>{usage.unitCode}</td>
              </tr>
            ))}
          </PrintTable>
        </PrintSection>
      )}
    </PrintLayout>
  );
}

/**
 * Folha de Receita (R.COQ.003) impressa — registro de execução por parte,
 * com pesagem real, lote e operador. Cada parte é uma seção própria; o
 * objetivo é um documento A4 legível, não reproduzir a planilha.
 */
export function RecipeSheetPrintDocument({ sheet }: { sheet: RecipeSheetDTO }) {
  return (
    <PrintLayout
      kind="Folha de Receita"
      code={sheet.officialNumber ?? sheet.productionOrderCode}
      status={PRODUCTION_ORDER_STATUS_LABELS[sheet.status]}
      documentCode={CONTROLLED_DOCUMENT_CODES.RECIPE_SHEET}
      revision={sheet.recipeSheetRevision}
      meta={[
        { label: "OP interna", value: sheet.productionOrderCode },
        { label: "Produto", value: `${sheet.productCode} — ${sheet.productName}` },
        { label: "Cliente", value: printOrDash(sheet.customerName) },
        { label: "Formulação", value: printOrDash(sheet.formulationVersionLabel) },
        { label: "Planejado", value: `${sheet.plannedQuantity} ${sheet.outputUnitCode}` },
        { label: "Partes", value: String(sheet.numberOfParts) },
      ]}
    >
      {sheet.parts.map((part) => (
        <PrintSection
          key={part.id}
          title={`Parte ${part.partNumber} / ${sheet.numberOfParts} — ${PRODUCTION_PART_STATUS_LABELS[part.status]}`}
        >
          <PrintTable
            columns={[
              "Item",
              "Fonte",
              "Lote interno",
              "Lote fornecedor",
              "Proprietário",
              "Planejado",
              "Pesado",
              "Unidade",
              "Data/hora",
              "Executado por",
              "Observação",
            ]}
            isEmpty={part.weighings.length === 0}
            emptyMessage="Nenhuma pesagem registrada nesta parte."
          >
            {part.weighings.map((weighing) => (
              <tr key={weighing.id}>
                <td>
                  {weighing.itemCode} — {weighing.itemName}
                </td>
                <td>
                  {printOrDash(
                    part.requirements.find(
                      (requirement) =>
                        requirement.requirementId === weighing.productionOrderRequirementId,
                    )?.sourceName ?? null,
                  )}
                </td>
                <td>{printOrDash(weighing.lotCode)}</td>
                <td>{printOrDash(weighing.supplierLot)}</td>
                <td>{weighing.ownerType === "CUSTOMER" ? "Cliente" : "Veridi"}</td>
                <td className="is-number">{weighing.plannedQuantity}</td>
                <td className="is-number">{weighing.actualQuantity}</td>
                <td>{weighing.uomCode}</td>
                <td>{formatPrintDateTime(weighing.executedAt)}</td>
                <td>{weighing.executedByName}</td>
                <td>{printOrDash(weighing.notes)}</td>
              </tr>
            ))}
          </PrintTable>

          <p>
            {part.startedByName && (
              <>
                <strong>Iniciada por:</strong> {part.startedByName} em{" "}
                {formatPrintDateTime(part.startedAt)}.{" "}
              </>
            )}
            {part.completedByName && (
              <>
                <strong>Concluída por:</strong> {part.completedByName} em{" "}
                {formatPrintDateTime(part.completedAt)}.
              </>
            )}
          </p>
        </PrintSection>
      ))}

      {sheet.packagingRequirements.length > 0 && (
        <PrintSection title="Materiais de embalagem (total da OP)">
          <PrintTable
            columns={["Item", "Fornecimento", "Total", "Unidade"]}
            isEmpty={false}
            emptyMessage=""
          >
            {sheet.packagingRequirements.map((row) => (
              <tr key={row.requirementId}>
                <td>
                  {row.itemCode} — {row.itemName}
                </td>
                <td>{SUPPLY_RESPONSIBILITY_LABELS[row.supplyResponsibility]}</td>
                <td className="is-number">{row.totalQuantity}</td>
                <td>{row.unitCode}</td>
              </tr>
            ))}
          </PrintTable>
        </PrintSection>
      )}
    </PrintLayout>
  );
}

/**
 * Orçamento comercial. Documento de negociação — não é documento fiscal, e
 * o rodapé diz isso explicitamente. Rascunho é impresso marcado como tal,
 * para nunca ser confundido com uma proposta formalmente apresentada.
 */
export function QuotePrintDocument({ quote }: { quote: QuoteVersionDTO }) {
  const isDraft = quote.status === "DRAFT";

  return (
    <PrintLayout
      kind="Orçamento comercial"
      code={`${quote.code} · V${quote.versionNumber}`}
      status={QUOTE_STATUS_LABELS[quote.status]}
      isDraft={isDraft}
      notice="Documento comercial — não é documento fiscal."
      meta={[
        { label: "Projeto", value: printOrDash(quote.projectCode ?? quote.projectName) },
        { label: "Conceito", value: printOrDash(quote.projectConcept) },
        { label: "Canal", value: printOrDash(quote.projectChannel) },
        { label: "Data", value: formatPrintDate(quote.quoteDate) },
        { label: "Validade", value: formatPrintDate(quote.validUntil) },
        { label: "Enviado em", value: formatPrintDateTime(quote.sentAt) },
      ]}
    >
      <PrintSection title="Cliente">
        {/* Snapshot congelado no envio — nunca o cadastro atual. */}
        <dl className="print-doc__meta">
          <div>
            <dt>Cliente</dt>
            <dd>
              {printOrDash(quote.customerCode)} — {printOrDash(quote.customerName)}
            </dd>
          </div>
          <div>
            <dt>Nome fantasia</dt>
            <dd>{printOrDash(quote.customerTradeName)}</dd>
          </div>
          <div>
            <dt>CNPJ</dt>
            <dd>{printOrDash(quote.customerCnpj)}</dd>
          </div>
          <div>
            <dt>Endereço</dt>
            <dd>
              {[quote.customerStreet, quote.customerNumber, quote.customerComplement, quote.customerDistrict]
                .filter(Boolean)
                .join(", ") || "—"}
            </dd>
          </div>
          <div>
            <dt>Cidade / UF</dt>
            <dd>{[quote.customerCity, quote.customerState].filter(Boolean).join(" / ") || "—"}</dd>
          </div>
          <div>
            <dt>CEP</dt>
            <dd>{printOrDash(quote.customerZipCode)}</dd>
          </div>
        </dl>
      </PrintSection>

      <PrintSection title="Proposta">
        <PrintTable
          columns={["Produto", "Quantidade", "Unidade", "Preço unitário", "Moeda", "Total"]}
          isEmpty={false}
          emptyMessage=""
        >
          <tr>
            <td>{printOrDash(quote.projectName)}</td>
            <td className="is-number">{printOrDash(quote.quotedQuantity)}</td>
            <td>{printOrDash(quote.uomCode)}</td>
            {/* Preço ausente é "não precificado" — nunca zero. */}
            <td className="is-number">{quote.unitPrice ? formatBRL(quote.unitPrice) : "—"}</td>
            <td>{quote.currencyCode}</td>
            <td className="is-number">{quote.total ? formatBRL(quote.total) : "—"}</td>
          </tr>
        </PrintTable>

        <dl className="print-doc__meta">
          <div>
            <dt>Condições de pagamento</dt>
            <dd>{printOrDash(quote.paymentTerms)}</dd>
          </div>
          <div>
            <dt>Prazo de entrega</dt>
            <dd>{quote.leadTimeDays ? `${quote.leadTimeDays} dias` : "—"}</dd>
          </div>
          <div>
            <dt>Observações</dt>
            <dd>{printOrDash(quote.commercialNotes)}</dd>
          </div>
        </dl>
      </PrintSection>
    </PrintLayout>
  );
}
