import { useEffect, useMemo, useState } from "react";
import type { QuotePaymentMethod, QuoteVersionDTO, UpdateQuoteVersionInput } from "@veridi/shared";
import { QUOTE_PAYMENT_METHOD_LABELS } from "@veridi/shared";
import { formatBRL } from "../../lib/currency";

/**
 * Condições comerciais da proposta.
 *
 * Antes, cada campo salvava sozinho ao perder o foco. Funcionava e ninguém
 * via: não havia botão, nem confirmação, nem sinal de pendência — quem
 * preenchia ficava procurando onde salvar, e quem saía da tela no meio não
 * sabia dizer se tinha guardado. Agora o formulário tem estado próprio, diz
 * quando há alteração pendente e só grava quando mandam gravar.
 *
 * Desconto, entrada, parcelas e juros entram; o plano de pagamento sai
 * calculado do backend. Valor de parcela não se digita — proposta impressa e
 * conta do sistema saindo de fontes diferentes divergem sem ninguém notar.
 */

interface Campos {
  validUntil: string;
  leadTimeDays: string;
  commercialNotes: string;
  discountPercent: string;
  paymentMethod: QuotePaymentMethod;
  downPaymentPercent: string;
  installmentCount: string;
  installmentIntervalDays: string;
  monthlyInterestPercent: string;
}

function camposDe(quote: QuoteVersionDTO): Campos {
  /** Percentual guardado com 4 casas vira "10" na tela, não "10.0000". */
  const percent = (value: string | null) => (value === null ? "" : String(Number(value)));
  return {
    validUntil: quote.validUntil ? quote.validUntil.slice(0, 10) : "",
    leadTimeDays: quote.leadTimeDays ? String(quote.leadTimeDays) : "",
    commercialNotes: quote.commercialNotes ?? "",
    discountPercent: percent(quote.discountPercent),
    paymentMethod: quote.paymentMethod,
    downPaymentPercent: percent(quote.downPaymentPercent),
    installmentCount: quote.installmentCount ? String(quote.installmentCount) : "",
    installmentIntervalDays: quote.installmentIntervalDays
      ? String(quote.installmentIntervalDays)
      : "",
    monthlyInterestPercent: percent(quote.monthlyInterestPercent),
  };
}

function paraEnvio(campos: Campos): UpdateQuoteVersionInput {
  const texto = (value: string) => (value.trim() === "" ? null : value.trim());
  const inteiro = (value: string) => (value.trim() === "" ? null : Number(value));
  return {
    validUntil: texto(campos.validUntil),
    leadTimeDays: inteiro(campos.leadTimeDays),
    commercialNotes: texto(campos.commercialNotes),
    discountPercent: texto(campos.discountPercent),
    paymentMethod: campos.paymentMethod,
    downPaymentPercent: texto(campos.downPaymentPercent),
    installmentCount: inteiro(campos.installmentCount),
    installmentIntervalDays: inteiro(campos.installmentIntervalDays),
    monthlyInterestPercent: texto(campos.monthlyInterestPercent),
  };
}

interface Props {
  quote: QuoteVersionDTO;
  editable: boolean;
  saving: boolean;
  onSave: (input: UpdateQuoteVersionInput) => void;
}

export function QuoteConditionsForm({ quote, editable, saving, onSave }: Props) {
  const original = useMemo(() => camposDe(quote), [quote]);
  const [campos, setCampos] = useState<Campos>(original);

  // Recarregar a proposta (ou trocar de versão) descarta o rascunho de tela:
  // o formulário passa a descrever o que está gravado.
  useEffect(() => setCampos(original), [original]);

  const sujo = useMemo(
    () => (Object.keys(original) as (keyof Campos)[]).some((k) => original[k] !== campos[k]),
    [original, campos],
  );
  const parcelado = campos.paymentMethod === "INSTALLMENTS";
  const plano = quote.paymentSchedule;

  function set<K extends keyof Campos>(chave: K, valor: Campos[K]) {
    setCampos((atual) => ({ ...atual, [chave]: valor }));
  }

  return (
    <div className="quote-conditions">
      <div className="quote-workspace__conditions">
        <div className="field field--narrow">
          <label htmlFor="quote-valid-until">Validade da proposta</label>
          <input
            id="quote-valid-until"
            type="date"
            disabled={!editable}
            value={campos.validUntil}
            onChange={(event) => set("validUntil", event.target.value)}
          />
        </div>
        <div className="field field--narrow">
          <label htmlFor="quote-lead-time">Prazo de entrega (dias)</label>
          <input
            id="quote-lead-time"
            type="text"
            inputMode="numeric"
            disabled={!editable}
            value={campos.leadTimeDays}
            onChange={(event) => set("leadTimeDays", event.target.value)}
          />
        </div>
        <div className="field field--narrow">
          <label htmlFor="quote-discount">Desconto (%)</label>
          <input
            id="quote-discount"
            type="text"
            inputMode="decimal"
            disabled={!editable}
            value={campos.discountPercent}
            onChange={(event) => set("discountPercent", event.target.value)}
          />
          <p className="field__hint">Sobre o subtotal das linhas.</p>
        </div>
        <div className="field field--narrow">
          <label htmlFor="quote-payment-method">Forma de pagamento</label>
          <select
            id="quote-payment-method"
            disabled={!editable}
            value={campos.paymentMethod}
            onChange={(event) => set("paymentMethod", event.target.value as QuotePaymentMethod)}
          >
            {(Object.keys(QUOTE_PAYMENT_METHOD_LABELS) as QuotePaymentMethod[]).map((method) => (
              <option key={method} value={method}>
                {QUOTE_PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </div>

        {parcelado && (
          <>
            <div className="field field--narrow">
              <label htmlFor="quote-down-payment">Entrada (%)</label>
              <input
                id="quote-down-payment"
                type="text"
                inputMode="decimal"
                disabled={!editable}
                value={campos.downPaymentPercent}
                onChange={(event) => set("downPaymentPercent", event.target.value)}
              />
              <p className="field__hint">Vazio = sem entrada.</p>
            </div>
            <div className="field field--narrow">
              <label htmlFor="quote-installments">Parcelas</label>
              <input
                id="quote-installments"
                type="text"
                inputMode="numeric"
                disabled={!editable}
                value={campos.installmentCount}
                onChange={(event) => set("installmentCount", event.target.value)}
              />
            </div>
            <div className="field field--narrow">
              <label htmlFor="quote-interval">Intervalo (dias)</label>
              <input
                id="quote-interval"
                type="text"
                inputMode="numeric"
                disabled={!editable}
                value={campos.installmentIntervalDays}
                onChange={(event) => set("installmentIntervalDays", event.target.value)}
              />
              <p className="field__hint">Vazio = 30 dias.</p>
            </div>
            <div className="field field--narrow">
              <label htmlFor="quote-interest">Juros ao mês (%)</label>
              <input
                id="quote-interest"
                type="text"
                inputMode="decimal"
                disabled={!editable}
                value={campos.monthlyInterestPercent}
                onChange={(event) => set("monthlyInterestPercent", event.target.value)}
              />
              <p className="field__hint">Vazio ou 0 = sem juros.</p>
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="quote-notes">Observações comerciais</label>
          <textarea
            id="quote-notes"
            rows={2}
            disabled={!editable}
            value={campos.commercialNotes}
            onChange={(event) => set("commercialNotes", event.target.value)}
          />
        </div>
      </div>

      {editable && (
        <div className="line-actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={saving || !sujo}
            onClick={() => onSave(paraEnvio(campos))}
          >
            Salvar condições
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={saving || !sujo}
            onClick={() => setCampos(original)}
          >
            Descartar alterações
          </button>
          {/* Sem isto, "salvei?" só se responde recarregando a página. */}
          <span className={sujo ? "form-status form-status--dirty" : "form-status"} role="status">
            {sujo ? "Alterações não salvas" : "Tudo salvo"}
          </span>
        </div>
      )}

      {/* O plano descreve o que ESTÁ GRAVADO. Enquanto houver alteração
          pendente ele não muda — recalcular no rascunho de tela mostraria um
          parcelamento que a proposta ainda não tem. */}
      {plano && (
        <div className="quote-plan">
          <h4 className="quote-plan__title">
            Plano de pagamento {sujo && <em>— referente ao que está salvo</em>}
          </h4>
          <dl className="definition-list">
            <dt>Subtotal dos produtos</dt>
            <dd>{formatBRL(plano.subtotal)}</dd>
            {plano.discountPercent && (
              <>
                <dt>Desconto ({Number(plano.discountPercent)}%)</dt>
                <dd>− {formatBRL(plano.discountAmount)}</dd>
              </>
            )}
            <dt>
              <strong>Total {plano.method === "CASH" ? "à vista" : "da proposta"}</strong>
            </dt>
            <dd>
              <strong>{formatBRL(plano.total)}</strong>
            </dd>
            {plano.method === "INSTALLMENTS" && (
              <>
                {plano.downPayment && Number(plano.downPayment) > 0 && (
                  <>
                    <dt>Entrada ({Number(plano.downPaymentPercent)}%)</dt>
                    <dd>{formatBRL(plano.downPayment)}</dd>
                  </>
                )}
                <dt>Parcelas</dt>
                <dd>
                  {plano.installments.length}× de{" "}
                  {formatBRL(plano.installments[0]?.amount ?? null)}
                  {plano.installmentIntervalDays !== 30
                    ? ` a cada ${plano.installmentIntervalDays} dias`
                    : " por mês"}
                </dd>
                {plano.monthlyInterestPercent && (
                  <>
                    <dt>Juros</dt>
                    <dd>
                      {Number(plano.monthlyInterestPercent)}% ao mês —{" "}
                      {formatBRL(plano.interestAmount)} no total
                    </dd>
                  </>
                )}
                <dt>
                  <strong>Total a prazo</strong>
                </dt>
                <dd>
                  <strong>{formatBRL(plano.totalPayable)}</strong>
                </dd>
              </>
            )}
          </dl>

          {plano.installments.length > 1 && (
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th className="is-numeric">Valor</th>
                  <th className="is-numeric">Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {plano.installments.map((parcela) => (
                  <tr key={parcela.number}>
                    <td>{parcela.number}ª</td>
                    <td className="is-numeric">{formatBRL(parcela.amount)}</td>
                    <td className="is-numeric">{parcela.dueInDays} dias</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
