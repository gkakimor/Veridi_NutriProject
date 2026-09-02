import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { CustomerOrderDTO } from "@veridi/shared";
import { CUSTOMER_ORDER_STATUS_LABELS } from "@veridi/shared";
import { listCustomerOrders } from "../../lib/customer-orders-api";
import { formatDate } from "../../lib/dates";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationCount, ConsultationPager } from "./ConsultationPager";
import { useScopedList } from "./useScopedList";

/**
 * Pedidos DESTE Cliente — `GET /customer-orders?customerId=`.
 *
 * Um pedido pode ter várias linhas; a coluna de produto mostra a primeira e
 * indica quantas mais existem, em vez de repetir o pedido uma vez por linha.
 * Quem precisa do detalhe abre o pedido.
 */
export function OrdersTab() {
  const { customerId } = useConsultationContext();
  const navigate = useNavigate();

  const load = useCallback(
    async (page: number, pageSize: number) => {
      const result = await listCustomerOrders({ customerId, page, pageSize });
      return { rows: result.customerOrders, total: result.total };
    },
    [customerId],
  );

  const list = useScopedList<CustomerOrderDTO>(load, customerId);

  function open(order: CustomerOrderDTO) {
    navigate(consultationPath(customerId, "pedidos", order.id));
  }

  function productLabel(order: CustomerOrderDTO): string {
    const [first, ...rest] = order.lines;
    if (!first) return "—";
    return rest.length > 0 ? `${first.productName} +${rest.length}` : first.productName;
  }

  return (
    <>
      <ConsultationTrail steps={[{ label: "Pedidos" }]} />

      {list.error && <p className="form-alert">{list.error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-flex">Produto</th>
              <th className="col-tight">Data</th>
              <th className="col-tight">Entrega pedida</th>
              <th className="col-tight">Situação</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((order) => (
              <tr
                key={order.id}
                tabIndex={0}
                onClick={() => open(order)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(order);
                }}
              >
                <td className="is-code col-tight">{order.code}</td>
                <td className="col-flex">{productLabel(order)}</td>
                <td className="col-tight">{formatDate(order.orderDate)}</td>
                <td className="col-tight">{formatDate(order.requestedDeliveryDate)}</td>
                <td className="col-tight">
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
                </td>
              </tr>
            ))}

            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="table__empty">
                  Nenhum pedido encontrado para este cliente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ConsultationCount list={list} noun="pedido" pluralNoun="pedidos" />
      </div>

      <ConsultationPager list={list} />
    </>
  );
}
