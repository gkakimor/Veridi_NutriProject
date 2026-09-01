import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import type { CustomerOrderDTO } from "@veridi/shared";
import {
  CUSTOMER_ORDER_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@veridi/shared";
import { getConsultationOrder } from "../../lib/customer-consultation-api";
import { formatDate } from "../../lib/dates";
import { formatBRL } from "../../lib/currency";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationError, ConsultationLoading, ConsultationNotFound } from "./DetailStates";
import { useScopedDetail } from "./useScopedDetail";

/**
 * Detalhe CONSULTIVO de um Pedido, dentro do shell do Cliente.
 *
 * Reúne o que já existe no `CustomerOrderDTO` — origem comercial, linhas com
 * preço acordado e saldo, OPs geradas, expedições e faturamentos. Nada é
 * recalculado aqui: quantidade expedida, saldo e quantidade faturada já vêm
 * derivados do domínio, e refazer essa conta na tela criaria um segundo
 * número para a mesma pergunta.
 *
 * Sem ação transacional: não confirma, não cancela, não expede, não fatura.
 */

/** Rótulo por enum que o DTO expõe como `string` — mantém o texto, nunca o código cru. */
function label(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

export function OrderPage() {
  const { customerId } = useConsultationContext();
  const { orderId } = useParams<{ orderId: string }>();

  const load = useCallback(
    () => getConsultationOrder(customerId, orderId ?? ""),
    [customerId, orderId],
  );
  const detail = useScopedDetail<CustomerOrderDTO>(load, `${customerId}:${orderId}`);

  const listTo = consultationPath(customerId, "pedidos");

  if (detail.notFound) {
    return <ConsultationNotFound noun="Pedido" listLabel="Pedidos" listTo={listTo} />;
  }
  if (detail.error) {
    return <ConsultationError message={detail.error} listLabel="Pedidos" listTo={listTo} />;
  }
  if (detail.loading || !detail.data) {
    return <ConsultationLoading listLabel="Pedidos" listTo={listTo} />;
  }

  const order = detail.data;
  const origin = order.commercialOrigin;

  return (
    <>
      <ConsultationTrail steps={[{ label: "Pedidos", to: listTo }, { label: order.code }]} />

      <div className="doc-header">
        <div>
          <div className="doc-title">
            <h1>{order.code}</h1>
            <span
              className={
                order.status === "CANCELLED"
                  ? "badge badge--err"
                  : order.status === "SHIPPED"
                    ? "badge badge--active"
                    : "badge badge--neutral"
              }
            >
              {CUSTOMER_ORDER_STATUS_LABELS[order.status]}
            </span>
          </div>
        </div>
        <div className="table__actions">
          <Link className="btn btn--secondary" to={`/comercial/pedidos/${order.id}`}>
            Abrir pedido completo ↗
          </Link>
        </div>
      </div>

      <section className="consult-section">
        <h2>Pedido</h2>
        <dl className="definition-list">
          <dt>Data</dt>
          <dd>{formatDate(order.orderDate)}</dd>
          <dt>Entrega pedida</dt>
          <dd>{formatDate(order.requestedDeliveryDate)}</dd>
          <dt>Projeto de origem</dt>
          <dd>
            {/*
             * Navegação consultiva entre entidades do MESMO Cliente: o
             * projeto de origem deste pedido é, por construção, deste
             * cliente. O link continua dentro da Consulta.
             */}
            {origin?.projectId && origin.projectCode ? (
              <Link to={consultationPath(customerId, "projetos", origin.projectId)}>
                {origin.projectCode}
              </Link>
            ) : (
              "—"
            )}
          </dd>
          <dt>Orçamento de origem</dt>
          <dd>
            {origin ? `${origin.quoteCode} · V${origin.quoteVersionNumber}` : "—"}
          </dd>
          <dt>Valor do orçamento aceito</dt>
          <dd>{formatBRL(origin?.totalAmount ?? null)}</dd>
        </dl>
      </section>

      <section className="consult-section">
        <h2>Produtos</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Pedido</th>
                <th>Expedido</th>
                <th>Saldo</th>
                <th>Faturado</th>
                <th>Preço acordado</th>
                <th>Total da linha</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <span className="is-code">{line.productCode}</span> {line.productName}
                  </td>
                  <td>
                    {line.orderedQuantity} {line.unitCode}
                  </td>
                  <td>
                    {line.shippedQuantity} {line.unitCode}
                  </td>
                  <td>
                    {line.outstandingQuantity} {line.unitCode}
                  </td>
                  <td>
                    {line.billedQuantity} {line.unitCode}
                  </td>
                  <td>{formatBRL(line.agreedPrice?.unitPrice ?? null)}</td>
                  <td>{formatBRL(line.agreedPrice?.lineTotal ?? null)}</td>
                </tr>
              ))}

              {order.lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="table__empty">
                    Nenhum produto neste pedido.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="consult-section">
        <h2>Ordens de produção</h2>
        {order.generatedProductionOrders.length === 0 ? (
          <p className="page__subtitle">Nenhuma ordem de produção gerada por este pedido.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>OP</th>
                  <th>Produto</th>
                  <th>Planejado</th>
                  <th>Produzido</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {order.generatedProductionOrders.map((po) => (
                  <tr key={po.id}>
                    <td className="is-code">{po.code}</td>
                    <td>{po.productName}</td>
                    <td>
                      {po.plannedQuantity} {po.outputUnitCode}
                    </td>
                    <td>
                      {po.producedQuantity} {po.outputUnitCode}
                    </td>
                    <td>{PRODUCTION_ORDER_STATUS_LABELS[po.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="consult-section">
        <h2>Expedições</h2>
        {order.shipments.length === 0 ? (
          <p className="page__subtitle">Nenhuma expedição para este pedido.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Data</th>
                  <th>Quantidade</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {order.shipments.map((shipment) => (
                  <tr key={shipment.id}>
                    <td className="is-code">{shipment.code}</td>
                    <td>{formatDate(shipment.shipmentDate)}</td>
                    <td>{shipment.totalQuantity}</td>
                    <td>{label(SHIPMENT_STATUS_LABELS, shipment.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="consult-section">
        <h2>Faturamentos</h2>
        {order.billings.length === 0 ? (
          <p className="page__subtitle">Nenhum faturamento para este pedido.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Emitido em</th>
                  <th>Quantidade</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {order.billings.map((billing) => (
                  <tr key={billing.id}>
                    <td className="is-code">
                      {/* Também do mesmo Cliente: segue dentro da Consulta. */}
                      <Link to={consultationPath(customerId, "faturamentos", billing.id)}>
                        {billing.code}
                      </Link>
                    </td>
                    <td>{formatDate(billing.issuedAt)}</td>
                    <td>{billing.totalQuantity}</td>
                    <td>{formatBRL(billing.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
