import { useLayoutEffect, useState } from "react";
import type {
  PaymentInstrument,
  QuotePaymentMethod,
  QuotePaymentScheduleDTO,
  QuoteVersionDTO,
  UpdateQuoteVersionInput,
} from "@veridi/shared";
import {
  LIMITES_INTEIROS_DAS_CONDICOES,
  PARCELADO_SEM_PARCELAS_MESSAGE,
  PAYMENT_INSTRUMENTS,
  PAYMENT_INSTRUMENT_LABELS,
  QUOTE_PAYMENT_METHOD_LABELS,
} from "@veridi/shared";
import { formatBRL } from "../../lib/currency";
import { formatDate } from "../../lib/dates";
import { emDias } from "../../lib/duration";
import { formatPercent } from "../../lib/percent";
import { condicaoPadraoPorExtenso, formaDePagamentoPorExtenso } from "../../lib/payment-condition";
import { previewQuotePaymentSchedule } from "../../lib/projects-api";
import { erroDoDecimal } from "../../lib/decimal-field";
import { erroDeInteiro, lerInteiroOpcional } from "../../lib/integer-input";
import { CASAS_PERCENTUAL, OPCOES_PERCENTUAL } from "../../lib/numeric-scales";
import { IntegerField, PercentField } from "../../components/NumericField";
import {
  type CamposDasCondicoes,
  type ChaveInteiraDaCondicao,
  aplicarPadraoDoCliente,
  condicoesAlteradas,
  hidratarRascunho,
  padraoDoClienteDifere,
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

/**
 * Os três percentuais desta tela, com o mesmo tratamento dos inteiros
 * (QUOTE-PERCENT-FIELDS-01): erro ligado ao campo por `id`, e entrada e juros
 * só existem no parcelado — à vista não aparecem, não valem e não travam.
 */
type ChavePercentualDaCondicao = "discountPercent" | "downPaymentPercent" | "monthlyInterestPercent";
const PERCENTUAIS: Record<
  ChavePercentualDaCondicao,
  { rotulo: string; erroId: string; soParcelado: boolean }
> = {
  discountPercent: { rotulo: "Desconto (%)", erroId: "quote-discount-error", soParcelado: false },
  downPaymentPercent: {
    rotulo: "Entrada (%)",
    erroId: "quote-down-payment-error",
    soParcelado: true,
  },
  monthlyInterestPercent: {
    rotulo: "Juros ao mês (%)",
    erroId: "quote-interest-error",
    soParcelado: true,
  },
};

/**
 * Os três inteiros desta tela. O limite de cada um vem da API
 * (`LIMITES_INTEIROS_DAS_CONDICOES`): a tela recusa o que o servidor recusaria,
 * ao lado do campo. Parcelas e intervalo só existem no parcelado.
 */
const INTEIROS: Record<
  ChaveInteiraDaCondicao,
  { rotulo: string; erroId: string; soParcelado: boolean }
> = {
  leadTimeDays: {
    rotulo: "Prazo de entrega (dias)",
    erroId: "quote-lead-time-error",
    soParcelado: false,
  },
  installmentCount: {
    rotulo: "Parcelas",
    erroId: "quote-installments-error",
    soParcelado: true,
  },
  installmentIntervalDays: {
    rotulo: "Intervalo (dias)",
    erroId: "quote-interval-error",
    soParcelado: true,
  },
};

interface Props {
  quote: QuoteVersionDTO;
  editable: boolean;
  saving: boolean;
  /**
   * Grava as condições. Devolvendo a promessa, o botão diz "Salvando…"
   * enquanto ELA está no ar — `saving` é o freio da seção inteira e acende
   * também quando outra ação da proposta grava.
   */
  onSave: (input: UpdateQuoteVersionInput) => Promise<unknown> | void;
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
  const [salvando, setSalvando] = useState(false);
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
   * `0,85` seguia como texto e voltava "Erro de validação" sem dizer onde. O
   * campo já não aceita letra; o que sobra é o `1.234` ambíguo. À vista,
   * entrada e juros não aparecem nem valem: o escondido não trava.
   */
  const erroDoPercentual = (chave: ChavePercentualDaCondicao): string | null => {
    const { rotulo, soParcelado } = PERCENTUAIS[chave];
    if (soParcelado && !parcelado) return null;
    return erroDoDecimal(rotulo, campos[chave], OPCOES_PERCENTUAL);
  };
  const temPercentualIlegivel = (Object.keys(PERCENTUAIS) as ChavePercentualDaCondicao[]).some(
    (chave) => erroDoPercentual(chave) !== null,
  );
  const ariaDoPercentual = (chave: ChavePercentualDaCondicao) =>
    erroDoPercentual(chave) === null
      ? {}
      : { "aria-invalid": true, "aria-describedby": PERCENTUAIS[chave].erroId };
  const avisoDoPercentual = (chave: ChavePercentualDaCondicao) => {
    const erro = erroDoPercentual(chave);
    return erro === null ? null : (
      <p className="field__error" id={PERCENTUAIS[chave].erroId}>
        {erro}
      </p>
    );
  };
  /*
   * Inteiro ilegível trava do mesmo jeito — e fica na tela como foi digitado.
   * Antes, `abc` no prazo virava `NaN`, o JSON escrevia `null`, e salvar
   * apagava o prazo gravado sem aviso (QUOTE-INT-FIELDS-01). Vazio segue: é
   * "não informado". À vista, parcelas e intervalo não aparecem nem valem.
   *
   * A exceção é Parcelas no parcelado: vazio ali não é "não informado", é a
   * condição que o servidor recusa — o plano sairia à vista com a proposta
   * dizendo parcelado (CUSTOMER-PAYMENT-DEFAULTS-01). Trava igual, com a frase
   * do servidor ao lado do campo.
   */
  const erroDoInteiro = (chave: ChaveInteiraDaCondicao): string | null => {
    const { rotulo, soParcelado } = INTEIROS[chave];
    if (soParcelado && !parcelado) return null;
    if (chave === "installmentCount" && lerInteiroOpcional(campos[chave]).tipo === "vazio") {
      return PARCELADO_SEM_PARCELAS_MESSAGE;
    }
    return erroDeInteiro(rotulo, campos[chave], LIMITES_INTEIROS_DAS_CONDICOES[chave]);
  };
  const temInteiroInvalido = (Object.keys(INTEIROS) as ChaveInteiraDaCondicao[]).some(
    (chave) => erroDoInteiro(chave) !== null,
  );
  const temCondicaoInvalida = temPercentualIlegivel || temInteiroInvalido;
  /** Liga o campo ao seu erro: quem usa leitor de tela ouve a regra junto do campo. */
  const ariaDoInteiro = (chave: ChaveInteiraDaCondicao) =>
    erroDoInteiro(chave) === null
      ? {}
      : { "aria-invalid": true, "aria-describedby": INTEIROS[chave].erroId };
  const avisoDoInteiro = (chave: ChaveInteiraDaCondicao) => {
    const erro = erroDoInteiro(chave);
    return erro === null ? null : (
      <p className="field__error" id={INTEIROS[chave].erroId}>
        {erro}
      </p>
    );
  };
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

  /*
   * O padrão ATUAL do cliente nos campos — só na tela. Não grava: vira
   * "Alterações não salvas", a mesma pendência que prende o envio e a saída
   * da página, e segue para Simular, Salvar ou Descartar como qualquer
   * digitação. Só aparece quando mudaria alguma coisa.
   */
  const padraoDoCliente = quote.customerPaymentDefaults ?? null;
  const podeAplicarPadrao = editable && padraoDoClienteDifere(campos, padraoDoCliente);

  function aplicarPadrao() {
    setRascunho((atual) => ({
      ...atual,
      campos: aplicarPadraoDoCliente(atual.campos, padraoDoCliente),
    }));
    setSimulacao(null);
    setErroSimulacao(null);
  }

  async function simular() {
    // Os botões já ficam presos: o que a tela não lê não sai dela por caminho nenhum.
    if (temCondicaoInvalida) return;
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

  async function salvar() {
    if (temCondicaoInvalida || salvando) return;
    const gravacao = onSave(paraEnvio(campos));
    // Quem grava sem devolver promessa não tem andamento a mostrar.
    if (!gravacao) return;
    setSalvando(true);
    try {
      await gravacao;
    } finally {
      setSalvando(false);
    }
  }

  // Simulação na tela vence o gravado: é o que a pessoa está decidindo agora.
  const exibido = simulacao ?? plano;
  const eSimulacao = simulacao !== null;

  return (
    <div className="quote-conditions">
      {editable ? (
        <div className="quote-workspace__conditions">
          <div className="field field--narrow">
            <label htmlFor="quote-valid-until">Validade da proposta</label>
            <input
              id="quote-valid-until"
              type="date"
              value={campos.validUntil}
              onChange={(event) => set("validUntil", event.target.value)}
            />
          </div>
          <div className="field field--narrow">
            <label htmlFor="quote-lead-time">Prazo de entrega (dias)</label>
            <IntegerField
              id="quote-lead-time"
              value={campos.leadTimeDays}
              onChangeValue={(valor) => set("leadTimeDays", valor)}
              {...ariaDoInteiro("leadTimeDays")}
            />
            {avisoDoInteiro("leadTimeDays")}
          </div>
          <div className="field field--narrow">
            <label htmlFor="quote-discount">Desconto (%)</label>
            <PercentField
              id="quote-discount"
              scale={CASAS_PERCENTUAL}
              value={campos.discountPercent}
              onChangeValue={(valor) => set("discountPercent", valor)}
              {...ariaDoPercentual("discountPercent")}
            />
            {avisoDoPercentual("discountPercent")}
            <p className="field__hint">Sobre o subtotal das linhas.</p>
          </div>
          {/* Forma é o meio (PIX, boleto...); condição é o prazo (à vista ou
              parcelado). A forma não muda valor nem plano. */}
          <div className="field field--narrow">
            <label htmlFor="quote-payment-instrument">Forma de pagamento</label>
            <select
              id="quote-payment-instrument"
              value={campos.paymentInstrument}
              onChange={(event) =>
                set("paymentInstrument", event.target.value as PaymentInstrument | "")
              }
            >
              <option value="">Não informada</option>
              {PAYMENT_INSTRUMENTS.map((forma) => (
                <option key={forma} value={forma}>
                  {PAYMENT_INSTRUMENT_LABELS[forma]}
                </option>
              ))}
            </select>
          </div>
          {/* O id técnico continua `quote-payment-method`: as E2E o seguem. */}
          <div className="field field--narrow">
            <label htmlFor="quote-payment-method">Condição de pagamento</label>
            <select
              id="quote-payment-method"
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
                <PercentField
                  id="quote-down-payment"
                  scale={CASAS_PERCENTUAL}
                  value={campos.downPaymentPercent}
                  onChangeValue={(valor) => set("downPaymentPercent", valor)}
                  {...ariaDoPercentual("downPaymentPercent")}
                />
                {avisoDoPercentual("downPaymentPercent")}
                <p className="field__hint">Vazio = sem entrada.</p>
              </div>
              <div className="field field--narrow">
                <label htmlFor="quote-installments">Parcelas</label>
                <IntegerField
                  id="quote-installments"
                  value={campos.installmentCount}
                  onChangeValue={(valor) => set("installmentCount", valor)}
                  {...ariaDoInteiro("installmentCount")}
                />
                {avisoDoInteiro("installmentCount")}
              </div>
              <div className="field field--narrow">
                <label htmlFor="quote-interval">Intervalo (dias)</label>
                <IntegerField
                  id="quote-interval"
                  value={campos.installmentIntervalDays}
                  onChangeValue={(valor) => set("installmentIntervalDays", valor)}
                  {...ariaDoInteiro("installmentIntervalDays")}
                />
                {avisoDoInteiro("installmentIntervalDays")}
                <p className="field__hint">Vazio = 30 dias.</p>
              </div>
              <div className="field field--narrow">
                <label htmlFor="quote-interest">Juros ao mês (%)</label>
                <PercentField
                  id="quote-interest"
                  scale={CASAS_PERCENTUAL}
                  value={campos.monthlyInterestPercent}
                  onChangeValue={(valor) => set("monthlyInterestPercent", valor)}
                  {...ariaDoPercentual("monthlyInterestPercent")}
                />
                {avisoDoPercentual("monthlyInterestPercent")}
                <p className="field__hint">Vazio ou 0 = sem juros.</p>
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="quote-notes">Observações comerciais</label>
            <textarea
              id="quote-notes"
              rows={2}
              value={campos.commercialNotes}
              onChange={(event) => set("commercialNotes", event.target.value)}
            />
          </div>
        </div>
      ) : (
        <CondicoesGravadas quote={quote} />
      )}

      {editable && (
        <div className="form-actions form-actions--split">
          {/* Ver o efeito de um lado; gravar ou desfazer do outro — simular
              não grava nada, e não pode ficar colado em quem grava. */}
          <div className="form-actions__group">
            {/* Preencher a tela com o padrão do cliente também não grava. */}
            {podeAplicarPadrao && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving || salvando}
                aria-describedby="quote-customer-default-hint"
                onClick={aplicarPadrao}
              >
                Aplicar padrão do cliente
              </button>
            )}
            {/* Aparece com a alteração: ver o efeito não pode custar salvar. */}
            {sujo && (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={simulando || temCondicaoInvalida}
                onClick={() => void simular()}
              >
                {simulando ? "Simulando…" : "Simular"}
              </button>
            )}
          </div>
          <div className="form-actions__group">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving || salvando || !sujo || temCondicaoInvalida}
              onClick={() => void salvar()}
            >
              {salvando ? "Salvando…" : "Salvar condições"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={saving || salvando || !sujo}
              onClick={descartar}
            >
              Descartar alterações
            </button>
            {/* Sem isto, "salvei?" só se responde recarregando a página. */}
            <span className={sujo ? "form-status form-status--dirty" : "form-status"} role="status">
              {sujo ? "Alterações não salvas" : "Tudo salvo"}
            </span>
          </div>
        </div>
      )}

      {podeAplicarPadrao && padraoDoCliente && (
        <p className="field__hint" id="quote-customer-default-hint">
          Padrão do cliente:{" "}
          {[
            padraoDoCliente.defaultPaymentInstrument
              ? formaDePagamentoPorExtenso(padraoDoCliente.defaultPaymentInstrument)
              : null,
            padraoDoCliente.defaultPaymentMethod ? condicaoPadraoPorExtenso(padraoDoCliente) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          . Aplicar só preenche forma e condição na tela — nada é gravado até salvar.
        </p>
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
                  {/* Intervalo vazio é 30 dias ("por mês"), como o plano calcula. */}
                  {exibido.installmentIntervalDays !== null && exibido.installmentIntervalDays !== 30
                    ? ` a cada ${emDias(exibido.installmentIntervalDays)}`
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
                    <td className="is-numeric">{emDias(parcela.dueInDays)}</td>
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

/**
 * As condições de uma versão que não se edita — enviada, aceita, recusada, ou
 * aberta por quem não negocia.
 *
 * Leitura, não formulário desabilitado (QUOTE-WORKSPACE-NAVIGATION-01): campo
 * cinza parece formulário esperando alguém, e esta versão não espera ninguém.
 * Os valores são os GRAVADOS, escritos como o documento do cliente os escreve
 * — prazo sem valor é "—", e à vista não há entrada, parcelas nem juros.
 */
function CondicoesGravadas({ quote }: { quote: QuoteVersionDTO }) {
  const parcelado = quote.paymentMethod === "INSTALLMENTS";
  return (
    <dl className="definition-list quote-conditions__read">
      <dt>Validade da proposta</dt>
      <dd>{formatDate(quote.validUntil)}</dd>
      <dt>Prazo de entrega</dt>
      <dd>{quote.leadTimeDays ? emDias(quote.leadTimeDays) : "—"}</dd>
      <dt>Desconto</dt>
      <dd>{quote.discountPercent ? formatPercent(quote.discountPercent) : "—"}</dd>
      <dt>Forma de pagamento</dt>
      <dd>{formaDePagamentoPorExtenso(quote.paymentInstrument)}</dd>
      <dt>Condição de pagamento</dt>
      <dd>{QUOTE_PAYMENT_METHOD_LABELS[quote.paymentMethod]}</dd>
      {parcelado && (
        <>
          <dt>Entrada</dt>
          <dd>{quote.downPaymentPercent ? formatPercent(quote.downPaymentPercent) : "Sem entrada"}</dd>
          {/* "Parcelas" é do plano logo abaixo, com valor e periodicidade. */}
          <dt>Número de parcelas</dt>
          <dd>{quote.installmentCount ?? "—"}</dd>
          <dt>Intervalo</dt>
          <dd>{emDias(quote.installmentIntervalDays ?? 30)}</dd>
          <dt>Juros ao mês</dt>
          <dd>
            {quote.monthlyInterestPercent && Number(quote.monthlyInterestPercent) > 0
              ? formatPercent(quote.monthlyInterestPercent)
              : "Sem juros"}
          </dd>
        </>
      )}
      <dt>Observações comerciais</dt>
      <dd>{quote.commercialNotes?.trim() ? quote.commercialNotes : "—"}</dd>
    </dl>
  );
}
