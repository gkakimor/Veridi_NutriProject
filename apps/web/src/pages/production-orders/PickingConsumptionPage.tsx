import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProductionOrderDTO } from "@veridi/shared";
import { listProductionOrders } from "../../lib/production-orders-api";

function statusBadgeClass(status: ProductionOrderDTO["status"]): string {
  return status === "IN_PRODUCTION" ? "badge badge--warn" : "badge badge--active";
}

function statusLabel(status: ProductionOrderDTO["status"]): string {
  return status === "IN_PRODUCTION" ? "Em produção" : "Liberada";
}

function pickingSummary(order: ProductionOrderDTO): string {
  const lines = order.requirements.flatMap((requirement) =>
    requirement.reservationLines.filter((line) => line.releasedAt === null),
  );
  const confirmed = lines.filter((line) => line.pickingStatus === "CONFIRMED").length;
  return `${confirmed}/${lines.length} lotes conferidos`;
}

function consumptionSummary(order: ProductionOrderDTO): string {
  const total = order.requirements.length;
  const fullyConsumed = order.requirements.filter(
    (requirement) => Number(requirement.remainingReservedQuantity) <= 0,
  ).length;
  return `${fullyConsumed}/${total} materiais consumidos`;
}

/** Produção → Picking / Consumo. Lista só OPs RELEASED/IN_PRODUCTION — a ação acontece na própria página da OP. */
export function PickingConsumptionPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<ProductionOrderDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    Promise.all([
      listProductionOrders({ status: "RELEASED", pageSize: 100 }),
      listProductionOrders({ status: "IN_PRODUCTION", pageSize: 100 }),
    ])
      .then(([released, inProduction]) => {
        setOrders([...released.productionOrders, ...inProduction.productionOrders]);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar ordens de produção");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Picking / Consumo</h1>
          <p className="page__subtitle">
            Ordens de produção liberadas ou em produção — conferência de lotes e consumo real.
          </p>
        </div>
      </div>

      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>OP</th>
              <th>Produto</th>
              <th>Status</th>
              <th>Picking</th>
              <th>Consumo</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                tabIndex={0}
                onClick={() => navigate(`/producao/ordens/${order.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/producao/ordens/${order.id}`);
                }}
              >
                <td className="is-code">{order.code}</td>
                <td>
                  {order.productCode} — {order.productName}
                </td>
                <td>
                  <span className={statusBadgeClass(order.status)}>{statusLabel(order.status)}</span>
                </td>
                <td>{pickingSummary(order)}</td>
                <td>{consumptionSummary(order)}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/producao/ordens/${order.id}`)}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={6} className="table__empty">
                  Nenhuma ordem liberada ou em produção no momento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {orders.length} {orders.length === 1 ? "ordem" : "ordens"}
        </div>
      </div>
    </>
  );
}
