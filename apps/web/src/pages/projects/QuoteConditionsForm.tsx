import { useLayoutEffect, useState } from "react";
import type {
  QuotePaymentMethod,
  QuotePaymentScheduleDTO,
  QuoteVersionDTO,
  UpdateQuoteVersionInput,
} from "@veridi/shared";
import { QUOTE_PAYMENT_METHOD_LABELS } from "@veridi/shared";
import { formatBRL } from "../../lib/currency";
import { formatPercent } from "../../lib/percent";
import { previewQuotePaymentSchedule } from "../../lib/projects-api";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import {
  type CamposDasCondicoes,
  condicoesAlteradas,
  hidratarRascunho,
  paraEnvio,
  rascunhoDe,
} from "./quote-conditions-draft";

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
 *
 * Alterar as condições mostra "Simular": o plano abaixo descreve o que está
 * GRAVADO, e sem um jeito de ver o efeito antes a pessoa precisava salvar
 * para descobrir e salvar de novo para desfazer. Simular é uma chamada por
 * clique, não a cada tecla — recalcular no meio da digitação faria o
 * formulário conversar com o servidor o tempo todo para mostrar números que
 * ninguém pediu ainda.
 */

/** Os três percentuais desta tela — o que a leitura da vírgula alcança. */
const PERCENTUAIS: { chave: keyof CamposDasCondicoes; rotulo: string }[] = [
  { chave: "discountPercent", rotulo: "Desconto (%)" },
  { chave: "downPaymentPercent", rotulo: "Entrada (%)" },
  { chave: "monthlyInterestPercent", rotulo: "Juros ao mês (%)" },
];

interface Props {
  quote: QuoteVersionDTO;
  editable: boolean;
  saving: boolean;
  onSave: (input: UpdateQuoteVersionInput) => void;
  /**
   * Avisa se há condição alterada e não salva — a mesma pendência que o
   * formulário mostra em "Alterações não salvas". Quem envia a proposta
   * precisa dela: o envio congela o que está GRAVADO (QUOTE-SEND-DIRTY-01).
   */
  onPendenciaChange?: (pendente: boolean) => void;
}

export function QuoteConditionsForm({
  quote,
  editable,
  saving,
  onSave,
  onPendenciaChange,
}: Props) {
  const [rascunho, setRascunho] = useState(() => rascunhoDe(quote));
  const [simulacao, setSimulacao] = useState<QuotePaymentScheduleDTO | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [erroSimulacao, setErroSimulacao] = useState<string | null>(null);
  /** A leitura da proposta que o rascunho já absorveu. */
  const [absorvida, setAbsorvida] = useState({ quote, editable });

  /*
   * Toda leitura da proposta chega como objeto NOVO — inclusive a recarga que
   * vem depois de adicionar, editar ou remover uma linha, com as condições
   * gravadas intactas. O objeto só avisa que houve leitura; quem decide o que
   * fazer com ela é `hidratarRascunho`, pela identidade da versão e pelo valor
   * de cada campo: outra versão carrega o gravado, a mesma versão preserva o
   * que foi alterado aqui. Antes, objeto novo refazia o formulário, e o que
   * estava digitado sumia ao adicionar um produto (QUOTE-DRAFT-STATE-01).
   *
   * A leitura é absorvida DURANTE o render, não num efeito. Com efeito, a tela
   * era desenhada uma vez com a versão nova e o rascunho da anterior — a E2E
   * viu a validade digitada na V2 dentro da V1 enviada. Aqui o React refaz o
   * render antes de desenhar, e nenhum quadro mistura as duas.
   *
   * A simulação sai em qualquer leitura: ela foi calculada sobre as linhas de
   * antes, e o subtotal pode ter mudado.
   */
  if (absorvida.quote !== quote || absorvida.editable !== editable) {
    setAbsorvida({ quote, editable });
    setRascunho((atual) => hidratarRascunho(atual, quote, editable));
    setSimulacao(null);
    setErroSimulacao(null);
  }

  const { base, campos } = rascunho;
  const sujo = condicoesAlteradas(base, campos).length > 0;

  /*
   * "Enviar ao cliente" mora fora deste formulário e não pode ficar liberado
   * enquanto há condição por salvar — o envio congela o gravado, e a tela
   * estaria mostrando outra coisa. O pai recebe a MESMA pendência daqui, num
   * efeito de layout: o valor chega antes de a tela ser pintada. Sem
   * formulário na tela, não há pendência.
   */
  useLayoutEffect(() => {
    onPendenciaChange?.(sujo);
    return () => onPendenciaChange?.(false);
  }, [sujo, onPendenciaChange]);

  const parcelado = campos.paymentMethod === "INSTALLMENTS";
  /*
   * Percentual que a tela não consegue ler trava simular e salvar. Antes,
   * `0,85` seguia como texto e voltava "Erro de validação" sem dizer onde.
   */
  const erroDoPercentual = (chave: keyof CamposDasCondicoes): string | null => {
    const rotulo = PERCENTUAIS.find((campo) => campo.chave === chave)?.rotulo;
    const valor = campos[chave];
    if (!rotulo || valor.trim() === "" || parseDecimalInput(valor) !== null) return null;
    return mensagemDecimalInvalido(rotulo);
  };
  const temPercentualIlegivel = PERCENTUAIS.some(
    ({ chave }) => erroDoPercentual(chave) !== null,
  );
  const plano = quote.paymentSchedule;

  function set<K extends keyof CamposDasCondicoes>(chave: K, valor: CamposDasCondicoes[K]) {
    setRascunho((atual) => ({ ...atual, campos: { ...atual.campos, [chave]: valor } }));
    // A simulação anterior descrevia outros números: mantê-la na tela depois
    // de mexer num campo seria a mesma armadilha que ela veio resolver.
    setSimulacao(null);
    setErroSimulacao(null);
  }

  /** Volta ao gravado — e a simulação, que descrevia os valores descartados, sai junto. */
  function descartar() {
    setRascunho((atual) => ({ ...atual, campos: atual.base }));
    setSimulacao(null);
    setErroSimulacao(null);
  }

  async function simular() {
    setSimulando(true);
    setErroSimulacao(null);
    try {
      setSimulacao(await previewQuotePaymentSchedule(quote.id, paraEnvio(campos)));
    } catch (err) {
      setSimulacao(null);
      setErroSimulacao(err instanceof Error ? err.message : "Não foi possível simular");
    } finally {
      setSimulando(false);
    }
  }

  // Simulação na tela vence o gravado: é o que a pessoa está decidindo agora.
  const exibido = simulacao ?? plano;
  const eSimulacao = simulacao !== null;

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
            aria-invalid={erroDoPercentual("discountPercent") !== null || undefined}
          />
          {erroDoPercentual("discountPercent") && (
            <p className="field__error">{erroDoPercentual("discountPercent")}</p>
          )}
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
                aria-invalid={erroDoPercentual("downPaymentPercent") !== null || undefined}
              />
              {erroDoPercentual("downPaymentPercent") && (
                <p className="field__error">{erroDoPercentual("downPaymentPercent")}</p>
              )}
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
                aria-invalid={erroDoPercentual("monthlyInterestPercent") !== null || undefined}
              />
              {erroDoPercentual("monthlyInterestPercent") && (
                <p className="field__error">{erroDoPercentual("monthlyInterestPercent")}</p>
              )}
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
          {/* Aparece com a alteração: ver o efeito não pode custar salvar. */}
          {sujo && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={simulando || temPercentualIlegivel}
              onClick={() => void simular()}
            >
              {simulando ? "Simulando…" : "Simular"}
            </button>
          )}
          <button
            type="button"
            className="btn btn--secondary"
            disabled={saving || !sujo || temPercentualIlegivel}
            onClick={() => onSave(paraEnvio(campos))}
          >
            Salvar condições
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={saving || !sujo}
            onClick={descartar}
          >
            Descartar alterações
          </button>
          {/* Sem isto, "salvei?" só se responde recarregando a página. */}
          <span className={sujo ? "form-status form-status--dirty" : "form-status"} role="status">
            {sujo ? "Alterações não salvas" : "Tudo salvo"}
          </span>
        </div>
      )}

      {erroSimulacao && <p className="form-alert" role="alert">{erroSimulacao}</p>}

      {/* Sem simular, o bloco descreve o que ESTÁ GRAVADO, e diz isso quando
          há alteração pendente: um plano que se apresentasse como o atual
          enquanto os campos dizem outra coisa é pior do que não mostrar. */}
      {exibido && (
        <div className={eSimulacao ? "quote-plan quote-plan--simulated" : "quote-plan"}>
          <h4 className="quote-plan__title">
            {eSimulacao ? (
              <>
                Simulação <em>— ainda não salva</em>
              </>
            ) : (
              <>Plano de pagamento {sujo && <em>— referente ao que está salvo</em>}</>
            )}
          </h4>
          <dl className="definition-list">
            <dt>Subtotal dos produtos</dt>
            <dd>{formatBRL(exibido.subtotal)}</dd>
            {exibido.discountPercent && (
              <>
                <dt>Desconto ({formatPercent(exibido.discountPercent)})</dt>
                <dd>− {formatBRL(exibido.discountAmount)}</dd>
              </>
            )}
            <dt>
              <strong>Total {exibido.method === "CASH" ? "à vista" : "da proposta"}</strong>
            </dt>
            <dd>
              <strong>{formatBRL(exibido.total)}</strong>
            </dd>
            {exibido.method === "INSTALLMENTS" && (
              <>
                {exibido.downPayment && Number(exibido.downPayment) > 0 && (
                  <>
                    <dt>Entrada ({formatPercent(exibido.downPaymentPercent)})</dt>
                    <dd>{formatBRL(exibido.downPayment)}</dd>
                  </>
                )}
                <dt>Parcelas</dt>
                <dd>
                  {exibido.installments.length}× de{" "}
                  {formatBRL(exibido.installments[0]?.amount ?? null)}
                  {exibido.installmentIntervalDays !== 30
                    ? ` a cada ${exibido.installmentIntervalDays} dias`
                    : " por mês"}
                </dd>
                {exibido.monthlyInterestPercent && (
                  <>
                    <dt>Juros</dt>
                    <dd>
                      {formatPercent(exibido.monthlyInterestPercent)} ao mês —{" "}
                      {formatBRL(exibido.interestAmount)} no total
                    </dd>
                  </>
                )}
                <dt>
                  <strong>Total a prazo</strong>
                </dt>
                <dd>
                  <strong>{formatBRL(exibido.totalPayable)}</strong>
                </dd>
              </>
            )}
          </dl>

          {exibido.installments.length > 1 && (
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th className="is-numeric">Valor</th>
                  <th className="is-numeric">Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {exibido.installments.map((parcela) => (
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
