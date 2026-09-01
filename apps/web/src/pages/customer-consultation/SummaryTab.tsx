import { Link } from "react-router-dom";
import { formatZipCode } from "@veridi/shared";
import { formatDateTime } from "../../lib/dates";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";

/**
 * Resumo — a primeira resposta a "o que está acontecendo com este cliente?".
 *
 * Só contadores que o banco sabe responder com `count`, e cada um leva à aba
 * onde o detalhe vive. Nada de KPI que exigiria um motor novo: valor faturado
 * não aparece aqui de propósito — o total do Faturamento nasce linha a linha
 * (`quantidade × preço`) e não é persistido, então somá-lo aqui seria uma
 * segunda matemática de dinheiro correndo em paralelo à do módulo.
 */
export function SummaryTab() {
  const { customerId, summary } = useConsultationContext();
  const { customer, counts } = summary;

  const cards: { label: string; value: number; segment: string }[] = [
    { label: "Projetos", value: counts.projects, segment: "projetos" },
    { label: "Pedidos", value: counts.orders, segment: "pedidos" },
    { label: "Pedidos em aberto", value: counts.openOrders, segment: "pedidos" },
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

      <section className="consult-section">
        <h2>Cadastro</h2>
        <dl className="definition-list">
          <dt>Razão Social</dt>
          <dd>{customer.legalName}</dd>
          <dt>Nome Fantasia</dt>
          <dd>{customer.tradeName ?? "—"}</dd>
          <dt>Endereço</dt>
          <dd>{address.length > 0 ? address : "—"}</dd>
          <dt>Situação</dt>
          <dd>{customer.active ? "Ativo" : "Inativo"}</dd>
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
