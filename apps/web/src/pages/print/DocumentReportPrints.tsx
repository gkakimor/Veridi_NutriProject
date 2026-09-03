import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { OrderOperationDTO, ProductionTraceabilityDTO } from "@veridi/shared";
import {
  BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  LOT_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@veridi/shared";
import { PrintSection, PrintTable, formatPrintDate, printOrDash } from "../../print/PrintLayout";
import { PrintSheet } from "../../print/PrintSheet";
import { getOrderOperationReport, getProductionTraceabilityReport } from "../../lib/reports-api";

/**
 * R-06 e R-14 impressos em rota dedicada.
 *
 * São consultas de DOCUMENTO ÚNICO (uma OP, um pedido), não listagens
 * tabulares — por isso não têm CSV e ganham um documento próprio em vez de
 * passar pelo template genérico de relatório. Mesma política: fora do
 * AppShell, pré-visualização e só então `window.print()`.
 */

function useDocumentReport<T>(load: () => Promise<T>, enabled: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    load()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o relatório"),
      );
    // Depende só dos parâmetros da rota, resolvidos pelo chamador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { data, error };
}

function MissingParameter({ message }: { message: string }) {
  return (
    <div className="print-screen">
      <article className="print-doc">
        <p className="form-alert" role="alert">{message}</p>
      </article>
    </div>
  );
}

/** R-06 — Rastreabilidade por OP (consumo e produção REAIS). */
export function ProductionTraceabilityPrintPage() {
  const [params] = useSearchParams();
  const productionOrderId = params.get("productionOrderId") ?? "";

  const { data, error } = useDocumentReport<ProductionTraceabilityDTO>(
    () => getProductionTraceabilityReport({ productionOrderId }),
    productionOrderId !== "",
  );

  if (!productionOrderId) {
    return <MissingParameter message="Selecione a Ordem de Produção antes de imprimir." />;
  }
  if (error) return <MissingParameter message={error} />;
  if (!data) return <div className="print-screen">Carregando…</div>;

  return (
    <PrintSheet
      sheetCode="R-06"
      title="Rastreabilidade por Ordem de Produção"
      backTo="/relatorios/producao/rastreabilidade"
      meta={[
        { label: "Ordem de produção", value: data.productionOrderCode },
        { label: "Produto", value: `${data.productCode} — ${data.productName}` },
        { label: "Situação", value: PRODUCTION_ORDER_STATUS_LABELS[data.status] },
        {
          label: "Planejado × produzido",
          value: `${data.plannedQuantity} / ${data.producedQuantity} ${data.unitCode}`,
        },
        { label: "Concluída em", value: formatPrintDate(data.completedAt) },
      ]}
    >
      <PrintSection title="Materiais consumidos">
        <PrintTable
          columns={["Item", "Lote interno", "Lote do fornecedor", "Fornecedor", "Quantidade", "Un."]}
          isEmpty={data.consumed.length === 0}
          emptyMessage="Nenhum consumo registrado."
        >
          {data.consumed.map((row, index) => (
            <tr key={`${row.itemId}-${row.lotId ?? index}`}>
              <td>
                {row.itemCode} — {row.itemName}
              </td>
              <td>{printOrDash(row.lotCode)}</td>
              <td>{printOrDash(row.supplierLot)}</td>
              <td>{printOrDash(row.supplierName)}</td>
              <td className="is-number">{row.quantity}</td>
              <td>{row.unitCode}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Produto acabado produzido">
        <PrintTable
          columns={["Lote interno", "Lote Veridi", "Quantidade", "Un.", "Validade", "Situação"]}
          isEmpty={data.produced.length === 0}
          emptyMessage="Nenhuma produção apontada."
        >
          {data.produced.map((row) => (
            <tr key={row.lotId}>
              <td>{row.lotCode}</td>
              <td>{printOrDash(row.businessLotNumber)}</td>
              <td className="is-number">{row.quantity}</td>
              <td>{row.unitCode}</td>
              <td>{formatPrintDate(row.expiryDate)}</td>
              <td>
                {LOT_STATUS_LABELS[row.status]}
                {row.isExpired ? " — vencido" : ""}
              </td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>
    </PrintSheet>
  );
}

/** R-14 — Pedido → Operação: a cadeia completa de um pedido. */
export function OrderOperationPrintPage() {
  const [params] = useSearchParams();
  const customerOrderId = params.get("customerOrderId") ?? "";

  const { data, error } = useDocumentReport<OrderOperationDTO>(
    () => getOrderOperationReport({ customerOrderId }),
    customerOrderId !== "",
  );

  if (!customerOrderId) {
    return <MissingParameter message="Selecione o pedido antes de imprimir." />;
  }
  if (error) return <MissingParameter message={error} />;
  if (!data) return <div className="print-screen">Carregando…</div>;

  return (
    <PrintSheet
      sheetCode="R-14"
      title="Pedido → Operação"
      backTo="/relatorios/comercial/pedido-operacao"
      landscape
      meta={[
        { label: "Pedido", value: data.code },
        { label: "Cliente", value: data.customerName },
        { label: "Situação", value: CUSTOMER_ORDER_STATUS_LABELS[data.status] },
        { label: "Data do pedido", value: formatPrintDate(data.orderDate) },
        { label: "Entrega solicitada", value: formatPrintDate(data.requestedDeliveryDate) },
      ]}
    >
      <PrintSection title="Itens do pedido">
        <PrintTable
          columns={["Produto", "Quantidade", "Un."]}
          isEmpty={data.lines.length === 0}
          emptyMessage="Pedido sem linhas."
        >
          {data.lines.map((line) => (
            <tr key={line.customerOrderLineId}>
              <td>
                {line.productCode} — {line.productName}
              </td>
              <td className="is-number">{line.orderedQuantity}</td>
              <td>{line.unitCode}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Ordens de produção">
        <PrintTable
          columns={["OP", "Produto", "Situação", "Planejado", "Produzido"]}
          isEmpty={data.productionOrders.length === 0}
          emptyMessage="Nenhuma ordem de produção vinculada."
        >
          {data.productionOrders.map((order) => (
            <tr key={order.productionOrderId}>
              <td>{order.code}</td>
              <td>{order.productCode}</td>
              <td>{PRODUCTION_ORDER_STATUS_LABELS[order.status]}</td>
              <td className="is-number">{order.plannedQuantity}</td>
              <td className="is-number">{order.producedQuantity}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Ordens de compra">
        <PrintTable
          columns={["OC", "Fornecedor", "Situação", "Itens", "Entrega prevista"]}
          isEmpty={data.purchaseOrders.length === 0}
          emptyMessage="Nenhuma ordem de compra vinculada."
        >
          {data.purchaseOrders.map((order) => (
            <tr key={order.purchaseOrderId}>
              <td>{order.code}</td>
              <td>{order.supplierName}</td>
              <td>{PURCHASE_ORDER_STATUS_LABELS[order.status]}</td>
              <td className="is-number">{order.itemCount}</td>
              <td>{formatPrintDate(order.expectedDeliveryDate)}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Expedições">
        <PrintTable
          columns={["Expedição", "Situação", "Confirmada em", "Linhas"]}
          isEmpty={data.shipments.length === 0}
          emptyMessage="Nenhuma expedição."
        >
          {data.shipments.map((shipment) => (
            <tr key={shipment.shipmentId}>
              <td>{shipment.code}</td>
              <td>
                {SHIPMENT_STATUS_LABELS[shipment.status as keyof typeof SHIPMENT_STATUS_LABELS] ??
                  shipment.status}
              </td>
              <td>{formatPrintDate(shipment.confirmedAt)}</td>
              <td className="is-number">{shipment.lines.length}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Faturamento">
        <PrintTable
          columns={["Documento", "Expedição", "Situação", "Emitido em", "Valor"]}
          isEmpty={data.billings.length === 0}
          emptyMessage="Nenhum faturamento emitido."
        >
          {data.billings.map((billing) => (
            <tr key={billing.billingId}>
              <td>{billing.code}</td>
              <td>{printOrDash(billing.shipmentCode)}</td>
              <td>{BILLING_STATUS_LABELS[billing.status]}</td>
              <td>{formatPrintDate(billing.issuedAt)}</td>
              {/* Valor só existe com precificação completa — nunca zero. */}
              <td className="is-number">{printOrDash(billing.totalAmount)}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>
    </PrintSheet>
  );
}
