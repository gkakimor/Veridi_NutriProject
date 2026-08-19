import { Link } from "react-router-dom";
import type { CustomerOrderDTO, CustomerOrderLineDTO } from "@veridi/shared";
import { QUOTE_PAYMENT_METHOD_LABELS } from "@veridi/shared";
import { entityHref } from "../../components/EntityLink";
import { formatBRL } from "../../lib/currency";
import { formatPercent } from "../../lib/percent";
import { FormSection } from "../../components/FormSection";

/**
 * De onde veio este pedido.
 *
 * Existe para responder, meses depois, "por que este pedido foi fechado por
 * este valor" sem que ninguém precise reconstruir a negociação de memória: o
 * orçamento aceito, o projeto, o total acordado e a condição de pagamento,
 * com links por identidade — nunca busca textual.
 *
 * Pedido digitado direto não tem origem comercial, e dizer isso é melhor do
 * que omitir: sem a linha, quem lê fica em dúvida se a informação sumiu.
 */
export function CommercialOriginSection({ order }: { order: CustomerOrderDTO }) {
  const origem = order.commercialOrigin;

  if (!origem) {
    return (
      <FormSection
        title="Origem comercial"
        subtitle="Pedido criado diretamente em Comercial › Pedidos, sem orçamento de origem."
      >
        <p className="field__hint">
          Não há proposta vinculada. Pedidos criados direto continuam válidos — o preço acordado,
          quando existe, vive no orçamento do projeto.
        </p>
      </FormSection>
    );
  }

  const plano = origem.paymentSchedule;

  return (
    <FormSection
      title="Origem comercial"
      subtitle="O acordo que originou este pedido, congelado. Preço novo exige nova negociação."
    >
      <dl className="definition-list">
        <dt>Orçamento</dt>
        <dd>
          {origem.quoteVersionId && origem.projectId ? (
            <Link
              to={`${entityHref("project", origem.projectId)}?quoteVersionId=${origem.quoteVersionId}`}
            >
              {origem.quoteCode} · V{origem.quoteVersionNumber}
            </Link>
          ) : (
            `${origem.quoteCode} · V${origem.quoteVersionNumber}`
          )}
        </dd>

        <dt>Projeto</dt>
        <dd>
          {origem.projectId ? (
            <Link to={entityHref("project", origem.projectId)}>{origem.projectCode}</Link>
          ) : (
            (origem.projectCode ?? "—")
          )}
        </dd>

        <dt>Situação</dt>
        <dd>Aceito pelo cliente</dd>

        {origem.discountPercent && Number(origem.discountPercent) > 0 && (
          <>
            <dt>Subtotal dos produtos</dt>
            <dd>{formatBRL(origem.subtotalAmount)}</dd>
            <dt>Desconto</dt>
            <dd>{formatPercent(origem.discountPercent)}</dd>
          </>
        )}

        <dt>Total acordado</dt>
        <dd>
          <strong>{formatBRL(origem.totalAmount)}</strong>
        </dd>

        {plano && (
          <>
            <dt>Forma de pagamento</dt>
            <dd>
              {QUOTE_PAYMENT_METHOD_LABELS[plano.method]}
              {plano.method === "INSTALLMENTS" && plano.installments.length > 0 && (
                <>
                  {" — "}
                  {Number(plano.downPayment ?? 0) > 0
                    ? `entrada de ${formatBRL(plano.downPayment)} e `
                    : ""}
                  {plano.installments.length}× de {formatBRL(plano.installments[0]!.amount)}
                  {plano.monthlyInterestPercent
                    ? `, juros de ${formatPercent(plano.monthlyInterestPercent)} ao mês`
                    : " sem juros"}
                </>
              )}
            </dd>
            {plano.method === "INSTALLMENTS" && (
              <>
                <dt>Total a prazo</dt>
                <dd>{formatBRL(plano.totalPayable)}</dd>
              </>
            )}
          </>
        )}
      </dl>

      {/* O plano completo fica consultável sem sair da tela do pedido. */}
      {plano && plano.installments.length > 0 && (
        <details className="commercial-origin__plan">
          <summary>Ver o plano de pagamento acordado</summary>
          <table className="table">
            <thead>
              <tr>
                <th>Parcela</th>
                <th className="is-numeric">Valor</th>
                <th className="is-numeric">Vencimento</th>
              </tr>
            </thead>
            <tbody>
              {Number(plano.downPayment ?? 0) > 0 && (
                <tr>
                  <td>Entrada</td>
                  <td className="is-numeric">{formatBRL(plano.downPayment)}</td>
                  <td className="is-numeric">No aceite</td>
                </tr>
              )}
              {plano.installments.map((parcela) => (
                <tr key={parcela.number}>
                  <td>{parcela.number}ª parcela</td>
                  <td className="is-numeric">{formatBRL(parcela.amount)}</td>
                  <td className="is-numeric">{parcela.dueInDays} dias</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </FormSection>
  );
}

/**
 * O preço acordado de uma linha, com a origem logo abaixo.
 *
 * A origem é identidade — código da precificação e faixa, ou "preço manual".
 * Custo, margem e markup continuam sendo informação interna do orçamento.
 */
export function AgreedPriceCell({
  price,
}: {
  price: CustomerOrderLineDTO["agreedPrice"];
}) {
  if (!price) return <>—</>;
  const origem =
    price.source === "PRICING_TIER"
      ? price.pricingCode
        ? `${price.pricingCode} · faixa ${price.tierQuantity ?? ""} ${price.tierUomCode ?? ""}`.trim()
        : "Faixa de precificação"
      : "Preço manual";
  return (
    <>
      {formatBRL(price.unitPrice)}
      <span className="field__hint">{origem}</span>
    </>
  );
}
