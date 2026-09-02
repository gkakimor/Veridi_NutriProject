import { Fragment, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import type { CustomerProductionOrderRowDTO } from "@veridi/shared";
import { LOT_STATUS_LABELS, PRODUCTION_ORDER_STATUS_LABELS } from "@veridi/shared";
import { getConsultationProductionOrder } from "../../lib/customer-consultation-api";
import { formatDateTime } from "../../lib/dates";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationError, ConsultationLoading, ConsultationNotFound } from "./DetailStates";
import { productionStatusBadgeClass } from "./ProductionTab";
import { useScopedDetail } from "./useScopedDetail";

/**
 * Detalhe CONSULTIVO de uma Ordem de Produção, dentro do shell do Cliente.
 *
 * Responde "o que esta ordem é e onde ela está", e só isso. Nenhuma ação
 * operacional mora aqui: não libera, não aponta produção, não consome
 * material, não edita. Quem precisa OPERAR usa a saída explícita — e é lá
 * que a conta de necessidade, reserva e sugestão de lote existe, porque é
 * lá que ela decide alguma coisa.
 *
 * Nada é recalculado: planejado, produzido e saldo já vêm derivados do
 * domínio. Refazer a subtração aqui criaria um segundo número para a mesma
 * pergunta, divergente no dia em que um apontamento fosse estornado.
 */
export function ProductionOrderPage() {
  const { customerId } = useConsultationContext();
  const { productionOrderId } = useParams<{ productionOrderId: string }>();

  const load = useCallback(
    () => getConsultationProductionOrder(customerId, productionOrderId ?? ""),
    [customerId, productionOrderId],
  );
  const detail = useScopedDetail<CustomerProductionOrderRowDTO>(
    load,
    `${customerId}:${productionOrderId}`,
  );

  const listTo = consultationPath(customerId, "producao");

  if (detail.notFound) {
    return (
      <ConsultationNotFound
        noun="Ordem de produção"
        feminine
        listLabel="Produção"
        listTo={listTo}
      />
    );
  }
  if (detail.error) {
    return <ConsultationError message={detail.error} listLabel="Produção" listTo={listTo} />;
  }
  if (detail.loading || !detail.data) {
    return <ConsultationLoading listLabel="Produção" listTo={listTo} />;
  }

  const order = detail.data;

  /*
   * Marcos, não campos: a ordem percorre criada → planejada → liberada →
   * iniciada → concluída, e o que ainda não aconteceu não tem data. Listar
   * as cinco sempre encheria a tela de "—" e faria o que já aconteceu
   * desaparecer no meio do que não aconteceu.
   */
  const milestones: { label: string; value: string | null }[] = [
    { label: "Criada em", value: order.createdAt },
    { label: "Planejada em", value: order.plannedAt },
    { label: "Liberada em", value: order.releasedAt },
    { label: "Iniciada em", value: order.startedAt },
    { label: "Concluída em", value: order.completedAt },
  ].filter((milestone) => milestone.value !== null);

  return (
    <>
      <ConsultationTrail steps={[{ label: "Produção", to: listTo }, { label: order.code }]} />

      <div className="doc-header">
        <div>
          <div className="doc-title">
            <h1>{order.code}</h1>
            <span className={productionStatusBadgeClass(order.status)}>
              {PRODUCTION_ORDER_STATUS_LABELS[order.status]}
            </span>
          </div>
        </div>
        <div className="table__actions">
          {/* A única saída para o módulo operacional. Clique comum, em
              qualquer outro lugar desta tela, continua dentro do cliente. */}
          <Link className="btn btn--secondary" to={`/producao/ordens/${order.id}`}>
            Abrir OP completa ↗
          </Link>
        </div>
      </div>

      <section className="consult-section">
        <h2>Ordem</h2>
        <dl className="definition-list">
          <dt>Produto</dt>
          <dd>
            {/*
             * O produto da ordem é, por construção, deste Cliente: o link
             * segue dentro da Consulta. Rascunho não congelou o snapshot e
             * fica sem produto — sem id não se inventa destino.
             */}
            {order.productId ? (
              <Link to={consultationPath(customerId, "produtos", order.productId)}>
                {[order.productCode, order.productName].filter(Boolean).join(" ")}
              </Link>
            ) : (
              "—"
            )}
          </dd>
          <dt>Item de produto acabado</dt>
          <dd>
            {order.finishedItemCode ? (
              <span className="is-code">{order.finishedItemCode}</span>
            ) : (
              "—"
            )}
          </dd>
          <dt>Pedido de origem</dt>
          <dd>
            {order.customerOrderId && order.customerOrderCode ? (
              <Link to={consultationPath(customerId, "pedidos", order.customerOrderId)}>
                {order.customerOrderCode}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </dl>
      </section>

      <section className="consult-section">
        <h2>Quantidades</h2>
        <dl className="definition-list">
          <dt>Planejada</dt>
          <dd>
            {order.plannedQuantity} {order.outputUnitCode}
          </dd>
          <dt>Produzida</dt>
          <dd>
            {order.producedQuantity} {order.outputUnitCode}
          </dd>
          <dt>Saldo</dt>
          <dd>
            {order.remainingQuantity} {order.outputUnitCode}
          </dd>
        </dl>
      </section>

      <section className="consult-section">
        <h2>Execução</h2>
        <dl className="definition-list">
          {/* Fragment, e não um wrapper: `.definition-list` é um grid de
              duas colunas com dt/dd como filhos diretos — uma div no meio
              viraria uma única célula e desalinharia a lista inteira. */}
          {milestones.map((milestone) => (
            <Fragment key={milestone.label}>
              <dt>{milestone.label}</dt>
              <dd>{formatDateTime(milestone.value)}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section className="consult-section">
        <h2>Lotes de produto acabado</h2>
        {order.finishedLots.length === 0 ? (
          <p className="page__subtitle">Esta ordem ainda não gerou lote de produto acabado.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Número de lote</th>
                  {/* Situação OPERACIONAL do lote — "o material pode ser
                      usado?". Não é a situação do laudo: aprovar o documento
                      não libera o lote, e chamar esta coluna de "Qualidade"
                      diria que sim. */}
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {order.finishedLots.map((lot) => (
                  <tr key={lot.id}>
                    <td className="is-code">{lot.code}</td>
                    <td>{lot.businessLotNumber ?? "—"}</td>
                    <td>{LOT_STATUS_LABELS[lot.status]}</td>
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
