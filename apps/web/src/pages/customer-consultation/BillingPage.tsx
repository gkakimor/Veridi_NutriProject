import { formatQuantity } from "../../lib/quantity";
import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import type { BillingDTO } from "@veridi/shared";
import { BILLING_NON_FISCAL_NOTICE, BILLING_STATUS_LABELS } from "@veridi/shared";
import { getConsultationBilling } from "../../lib/customer-consultation-api";
import { formatDate } from "../../lib/dates";
import { formatBRL } from "../../lib/currency";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationError, ConsultationLoading, ConsultationNotFound } from "./DetailStates";
import { useScopedDetail } from "./useScopedDetail";

/**
 * Detalhe CONSULTIVO de um Faturamento, dentro do shell do Cliente.
 *
 * Somente leitura: não emite, não cancela e não altera preço. O acordado e o
 * faturado aparecem LADO A LADO porque a diferença entre os dois é a
 * evidência de um override — escondê-la faria a consulta contar uma história
 * mais limpa do que a real.
 */
export function BillingPage() {
  const { customerId } = useConsultationContext();
  const { billingId } = useParams<{ billingId: string }>();

  const load = useCallback(
    () => getConsultationBilling(customerId, billingId ?? ""),
    [customerId, billingId],
  );
  const detail = useScopedDetail<BillingDTO>(load, `${customerId}:${billingId}`);

  const listTo = consultationPath(customerId, "faturamentos");

  if (detail.notFound) {
    return <ConsultationNotFound noun="Faturamento" listLabel="Faturamentos" listTo={listTo} />;
  }
  if (detail.error) {
    return (
      <ConsultationError message={detail.error} listLabel="Faturamentos" listTo={listTo} />
    );
  }
  if (detail.loading || !detail.data) {
    return <ConsultationLoading listLabel="Faturamentos" listTo={listTo} />;
  }

  const billing = detail.data;

  return (
    <>
      <ConsultationTrail
        steps={[{ label: "Faturamentos", to: listTo }, { label: billing.code }]}
      />

      <div className="doc-header">
        <div>
          <div className="doc-title">
            <h1>{billing.code}</h1>
            <span
              className={
                billing.status === "ISSUED"
                  ? "badge badge--active"
                  : billing.status === "CANCELLED"
                    ? "badge badge--err"
                    : "badge badge--neutral"
              }
            >
              {BILLING_STATUS_LABELS[billing.status]}
            </span>
          </div>
          <p className="page__subtitle">{BILLING_NON_FISCAL_NOTICE}</p>
        </div>
        <div className="table__actions">
          <Link className="btn btn--secondary" to={`/comercial/faturamento/${billing.id}`}>
            Abrir faturamento completo ↗
          </Link>
        </div>
      </div>

      <section className="consult-section">
        <h2>Faturamento</h2>
        <dl className="definition-list">
          <dt>Pedido</dt>
          <dd>
            {/* Mesmo Cliente por construção: o link segue dentro da Consulta. */}
            <Link to={consultationPath(customerId, "pedidos", billing.customerOrderId)}>
              {billing.customerOrderCode}
            </Link>
          </dd>
          <dt>Expedição</dt>
          <dd>{billing.shipmentCode}</dd>
          <dt>Emitido em</dt>
          <dd>{formatDate(billing.issuedAt)}</dd>
          <dt>Referência externa</dt>
          <dd>{billing.externalReference ?? "—"}</dd>
          <dt>Total</dt>
          <dd>
            {billing.hasCompletePricing ? (
              formatBRL(billing.totalAmount)
            ) : (
              <span className="badge badge--warn">Valores incompletos</span>
            )}
          </dd>
        </dl>
      </section>

      <section className="consult-section">
        <h2>Produtos faturados</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Lote</th>
                <th>Quantidade</th>
                <th>Preço acordado</th>
                <th>Preço faturado</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {billing.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <span className="is-code">{line.productCode}</span> {line.productName}
                  </td>
                  <td className="is-code">{line.lotCode ?? "—"}</td>
                  <td>
                    {formatQuantity(line.quantity)} {line.unitCode}
                  </td>
                  <td>{formatBRL(line.agreedUnitPrice)}</td>
                  <td>
                    {formatBRL(line.unitPrice)}
                    {line.priceOverridden && (
                      <span className="badge badge--info">Preço alterado</span>
                    )}
                  </td>
                  <td>{formatBRL(line.lineTotal)}</td>
                </tr>
              ))}

              {billing.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="table__empty">
                    Nenhum produto neste faturamento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
