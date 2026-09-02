import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { BillingDTO } from "@veridi/shared";
import { BILLING_STATUS_LABELS } from "@veridi/shared";
import { listBillings } from "../../lib/billings-api";
import { formatDate } from "../../lib/dates";
import { formatBRL } from "../../lib/currency";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationCount, ConsultationPager } from "./ConsultationPager";
import { useScopedList } from "./useScopedList";

/**
 * Faturamentos DESTE Cliente — `GET /billings?customerId=`.
 *
 * O cliente vive no Pedido de origem; o endpoint já resolve essa relação, e
 * é por ela que o recorte acontece no servidor.
 *
 * O total de cada linha vem pronto do DTO. Quando o faturamento ainda tem
 * linha sem preço, `totalAmount` é nulo de propósito — somar só o que tem
 * preço apresentaria um valor incompleto como se fosse o total.
 */
export function BillingsTab() {
  const { customerId } = useConsultationContext();
  const navigate = useNavigate();

  const load = useCallback(
    async (page: number, pageSize: number) => {
      const result = await listBillings({ customerId, page, pageSize });
      return { rows: result.billings, total: result.total };
    },
    [customerId],
  );

  const list = useScopedList<BillingDTO>(load, customerId);

  function open(billing: BillingDTO) {
    navigate(consultationPath(customerId, "faturamentos", billing.id));
  }

  return (
    <>
      <ConsultationTrail steps={[{ label: "Faturamentos" }]} />

      {list.error && <p className="form-alert">{list.error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              {/* Nenhuma coluna aqui é texto variável — código, pedido, data,
                  badge de situação, quantidade e valor são todos curtos. Sem
                  uma coluna de texto para receber a sobra, a tabela (que é
                  `width: 100%`) espalha a folga por todas; deixar duas sem
                  classe só concentrava a folga nelas: Total ia a 555px em
                  1600, largura que não carrega informação nenhuma. */}
              <th className="col-tight">Código</th>
              <th className="col-tight">Pedido</th>
              <th className="col-tight">Data</th>
              <th className="col-tight">Situação</th>
              <th className="col-tight">Quantidade</th>
              <th className="col-tight">Total</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((billing) => (
              <tr
                key={billing.id}
                tabIndex={0}
                onClick={() => open(billing)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(billing);
                }}
              >
                <td className="is-code col-tight">{billing.code}</td>
                <td className="is-code col-tight">{billing.customerOrderCode}</td>
                <td className="col-tight">
                  {formatDate(billing.issuedAt ?? billing.shipmentDate)}
                </td>
                <td className="col-tight">
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
                </td>
                <td className="col-tight">{billing.totalQuantity}</td>
                <td className="col-tight">
                  {billing.hasCompletePricing ? (
                    formatBRL(billing.totalAmount)
                  ) : (
                    <span className="badge badge--warn">Valores incompletos</span>
                  )}
                </td>
              </tr>
            ))}

            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="table__empty">
                  Nenhum faturamento encontrado para este cliente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ConsultationCount list={list} noun="faturamento" pluralNoun="faturamentos" />
      </div>

      <ConsultationPager list={list} />
    </>
  );
}
