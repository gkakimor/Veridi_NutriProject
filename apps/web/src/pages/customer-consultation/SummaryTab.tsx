import { Link } from "react-router-dom";
import {
  CUSTOMER_COMMERCIAL_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TAX_PROFILE_LABELS,
  formatZipCode,
} from "@veridi/shared";
import { formatDate, formatDateTime } from "../../lib/dates";
import { commercialStatusBadgeClass } from "../customers/commercial-status-badge";
import { customerStatusBadgeClass } from "../customers/customer-status-badge";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";

/**
 * Resumo — a primeira resposta a "o que está acontecendo com este cliente?".
 *
 * Só contadores que o banco sabe responder com `count`, e cada um leva à aba
 * onde o detalhe vive. Nada de KPI que exigiria um motor novo: valor faturado
 * não aparece aqui de propósito. O valor de cada Faturamento é o do documento —
 * `totalAmount`, congelado na emissão com o desconto e o ajuste de fechamento —
 * e o total de um recorte tem conta única no servidor (`resumirValorFaturado`,
 * BILLED-VALUE-CANONICAL-01); somá-lo aqui seria uma segunda matemática de
 * dinheiro correndo em paralelo à do módulo.
 */
export function SummaryTab() {
  const { customerId, summary } = useConsultationContext();
  const { customer, counts, commercial, projectSummary, statusHistory } = summary;

  const cards: { label: string; value: number; segment: string }[] = [
    { label: "Projetos", value: counts.projects, segment: "projetos" },
    { label: "Pedidos", value: counts.orders, segment: "pedidos" },
    { label: "Pedidos em aberto", value: counts.openOrders, segment: "pedidos" },
    /*
     * "Em aberto" é o recorte que o domínio já tem
     * (`OPEN_PRODUCTION_ORDER_STATUSES`), o mesmo do painel e dos
     * relatórios — não um segundo agrupamento inventado aqui, que
     * divergiria no dia em que um status novo aparecesse.
     */
    { label: "Produção", value: counts.productionOrders, segment: "producao" },
    { label: "Produção em aberto", value: counts.openProductionOrders, segment: "producao" },
    { label: "Materiais do cliente", value: counts.materialLots, segment: "materiais" },
    { label: "Faturamentos", value: counts.billings, segment: "faturamentos" },
  ];

  const address = [
    [customer.street, customer.number].filter(Boolean).join(", "),
    customer.complement,
    customer.district,
    [customer.city, customer.state].filter(Boolean).join("/"),
    formatZipCode(customer.zipCode),
  ]
    .filter((part) => part && part.length > 0)
    .join(" · ");

  return (
    <>
      <ConsultationTrail steps={[{ label: "Resumo" }]} />

      <div className="consult-counters">
        {cards.map((card) => (
          <Link
            key={card.label}
            className="consult-counter"
            to={consultationPath(customerId, card.segment)}
            /*
             * Rótulo e número são dois blocos separados: lidos em sequência
             * viram "Projetos2", e "Projetos" sozinho não se distingue da aba
             * de mesmo nome. O nome acessível diz as duas coisas de uma vez.
             */
            aria-label={`${card.label}: ${card.value}`}
          >
            <span className="consult-counter__label">{card.label}</span>
            <strong className="consult-counter__value">{card.value}</strong>
          </Link>
        ))}
      </div>

      {/* Situação CADASTRAL (§95): pode vender para este cliente? O motivo do
          bloqueio em vigor e o histórico inteiro ficam aqui — o que foi
          bloqueado, por quem e por quê não se perde no desbloqueio seguinte. */}
      <section className="consult-section">
        <h2>Situação cadastral</h2>
        <dl className="definition-list">
          {/* "Situação atual", não "Situação": a seção comercial logo abaixo
              tem o rótulo dela, e dois "Situação" na mesma tela seriam duas
              respostas com o mesmo nome. */}
          <dt>Situação atual</dt>
          <dd>
            <span className={customerStatusBadgeClass(customer.status)}>
              {CUSTOMER_STATUS_LABELS[customer.status]}
            </span>
          </dd>
          {customer.block && (
            <>
              <dt>Motivo do bloqueio</dt>
              <dd>{customer.block.reason}</dd>
              <dt>Bloqueado em</dt>
              <dd>
                {formatDateTime(customer.block.blockedAt)}
                {customer.block.blockedByName ? ` · ${customer.block.blockedByName}` : ""}
              </dd>
            </>
          )}
          {customer.status === "INACTIVE" && (
            <>
              <dt>O que isso significa</dt>
              <dd>
                Cadastro arquivado: fora da lista padrão de Clientes e sem operação comercial
                nova. Nada foi excluído — o histórico abaixo, os documentos e os fatos
                comerciais continuam.
                {customer.blocked
                  ? " O bloqueio acima volta a valer se o cadastro for reativado."
                  : ""}
              </dd>
            </>
          )}
        </dl>

        <h3>Histórico da situação</h3>
        {statusHistory.length === 0 ? (
          <p>Nenhuma mudança de situação registrada.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-tight">Quando</th>
                  <th className="col-tight">De</th>
                  <th className="col-tight">Para</th>
                  <th className="col-flex">Motivo</th>
                  <th className="col-tight">Quem</th>
                </tr>
              </thead>
              <tbody>
                {statusHistory.map((evento) => (
                  <tr key={evento.id}>
                    <td className="col-tight">{formatDateTime(evento.changedAt)}</td>
                    <td className="col-tight">{CUSTOMER_STATUS_LABELS[evento.fromStatus]}</td>
                    <td className="col-tight">{CUSTOMER_STATUS_LABELS[evento.toStatus]}</td>
                    <td className="col-flex">{evento.reason}</td>
                    <td className="col-tight">{evento.changedByName ?? "Não disponível"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Situação comercial (§86): derivada da história comercial, com o motivo
          — nunca a cadastral acima, que é outra pergunta. */}
      <section className="consult-section">
        <h2>Situação comercial</h2>
        <dl className="definition-list">
          <dt>Situação</dt>
          <dd>
            <span className={commercialStatusBadgeClass(commercial.status)}>
              {CUSTOMER_COMMERCIAL_STATUS_LABELS[commercial.status]}
            </span>
          </dd>
          <dt>Motivo</dt>
          <dd>{commercial.reason}</dd>
          {commercial.status === "ACTIVE" && (
            <>
              <dt>Cliente desde</dt>
              <dd>
                {commercial.customerSince
                  ? formatDate(commercial.customerSince)
                  : "Data não registrada"}
              </dd>
            </>
          )}
          <dt>Projetos</dt>
          <dd>
            {`Em andamento: ${projectSummary.open} · Stand-by: ${projectSummary.standBy} · Aprovados: ${projectSummary.approved} · Cancelados: ${projectSummary.cancelled}`}
          </dd>
        </dl>
      </section>

      <section className="consult-section">
        <h2>Cadastro</h2>
        <dl className="definition-list">
          <dt>Razão Social</dt>
          <dd>{customer.legalName}</dd>
          <dt>Nome Fantasia</dt>
          <dd>{customer.tradeName ?? "—"}</dd>
          {/* "Não informado" é valor (§83), não ausência: nunca travessão. */}
          <dt>Perfil tributário</dt>
          <dd>{CUSTOMER_TAX_PROFILE_LABELS[customer.taxProfile]}</dd>
          <dt>Endereço</dt>
          <dd>{address.length > 0 ? address : "—"}</dd>
          <dt>Cadastrado em</dt>
          <dd>
            {formatDateTime(customer.createdAt)}
            {customer.createdByName ? ` · ${customer.createdByName}` : ""}
          </dd>
          <dt>Última alteração</dt>
          <dd>
            {formatDateTime(customer.updatedAt)}
            {customer.updatedByName ? ` · ${customer.updatedByName}` : ""}
          </dd>
        </dl>
      </section>
    </>
  );
}
