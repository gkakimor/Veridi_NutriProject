import { formatQuantity } from "../../lib/quantity";
import { useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CustomerProductionOrderRowDTO, ProductionOrderStatus } from "@veridi/shared";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@veridi/shared";
import { listConsultationProductionOrders } from "../../lib/customer-consultation-api";
import { formatDate } from "../../lib/dates";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationCount, ConsultationPager } from "./ConsultationPager";
import { useScopedList } from "./useScopedList";

/**
 * Produção DESTE Cliente — `GET /customers/:id/consultation/production-orders`.
 *
 * A ordem chega aqui pelo vínculo com o Cliente, e só por ele. Produção que
 * a Veridi faz para o próprio estoque não tem cliente: não é omissão da
 * tela, é o dado. Por isso o estado vazio explica o recorte em vez de
 * apenas dizer "nada encontrado" — para a maioria dos clientes a aba estará
 * vazia estando correta, e uma aba vazia sem explicação parece defeito.
 */

/** Mesmo mapa de cor da lista operacional — a mesma situação não muda de cor entre telas. */
export function productionStatusBadgeClass(status: ProductionOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "PLANNED":
    case "RELEASED":
    case "COMPLETED":
      return "badge badge--active";
    case "IN_PRODUCTION":
    case "BLOCKED":
      return "badge badge--warn";
    case "CANCELLED":
      return "badge badge--err";
  }
}

export function ProductionTab() {
  const { customerId } = useConsultationContext();
  const navigate = useNavigate();

  const load = useCallback(
    async (page: number, pageSize: number) => {
      const result = await listConsultationProductionOrders(customerId, { page, pageSize });
      return { rows: result.rows, total: result.total };
    },
    [customerId],
  );

  const list = useScopedList<CustomerProductionOrderRowDTO>(load, customerId);

  function open(row: CustomerProductionOrderRowDTO) {
    navigate(consultationPath(customerId, "producao", row.id));
  }

  return (
    <>
      <ConsultationTrail steps={[{ label: "Produção" }]} />

      {list.error && <p className="form-alert" role="alert">{list.error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              {/* Só o produto é texto de tamanho imprevisível; código,
                  quantidade, badge e data são todos curtos e ganham a folga
                  que não precisam se ficarem sem classe. */}
              <th className="col-tight">OP</th>
              <th className="col-flex">Produto</th>
              <th className="col-tight">Pedido</th>
              <th className="col-tight">Planejado</th>
              <th className="col-tight">Produzido</th>
              <th className="col-tight">Situação</th>
              <th className="col-tight">Criada em</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => open(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(row);
                }}
              >
                <td className="is-code col-tight">{row.code}</td>
                <td className="col-flex">
                  {/*
                   * Destino CONSULTIVO: o produto desta ordem é do mesmo
                   * cliente, então o link continua sob este cabeçalho. Sair
                   * para o módulo aqui trocaria o assunto num clique comum.
                   *
                   * Rascunho ainda não congelou o snapshot: sem produto não
                   * há link para inventar.
                   */}
                  {row.productId ? (
                    <Link
                      className="entity-link"
                      to={consultationPath(customerId, "produtos", row.productId)}
                      // A linha inteira é clicável; sem isto o clique sobe e
                      // a navegação da linha vence o link.
                      onClick={(event) => event.stopPropagation()}
                    >
                      {[row.productCode, row.productName].filter(Boolean).join(" ")}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="is-code col-tight">
                  {row.customerOrderId && row.customerOrderCode ? (
                    <Link
                      className="entity-link"
                      to={consultationPath(customerId, "pedidos", row.customerOrderId)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.customerOrderCode}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="col-tight">
                  {formatQuantity(row.plannedQuantity)} {row.outputUnitCode}
                </td>
                <td className="col-tight">
                  {formatQuantity(row.producedQuantity)} {row.outputUnitCode}
                </td>
                <td className="col-tight">
                  <span className={productionStatusBadgeClass(row.status)}>
                    {PRODUCTION_ORDER_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td className="col-tight">{formatDate(row.createdAt)}</td>
              </tr>
            ))}

            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  <div>Nenhuma ordem de produção encontrada para este cliente.</div>
                  <small>
                    Aqui só entram ordens que apontam para um cliente; o que a Veridi produz
                    para o próprio estoque não tem cliente e fica de fora.
                  </small>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ConsultationCount list={list} noun="ordem" pluralNoun="ordens" />
      </div>

      <ConsultationPager list={list} />
    </>
  );
}
