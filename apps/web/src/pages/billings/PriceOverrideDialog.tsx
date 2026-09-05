import { useState } from "react";
import type { FormEvent } from "react";
import type { BillingDTO, BillingLineDTO } from "@veridi/shared";
import { calcularTotaisFaturamento } from "@veridi/shared";
import { ModalDialog } from "../../components/ModalDialog";
import { CalcHint } from "../../components/help/CalcHint";
import { overrideBillingPrice } from "../../lib/billings-api";
import { formatBRL, formatUnitPriceBRL } from "../../lib/currency";
import { exigirDecimal } from "../../lib/decimal-field";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import { formatQuantity } from "../../lib/quantity";

interface PriceOverrideDialogProps {
  /** O documento inteiro — alterar uma linha muda o total dele. */
  billing: BillingDTO;
  line: BillingLineDTO;
  onClose: () => void;
  onOverridden: (billing: BillingDTO) => void;
}

/**
 * "Alterar preço de faturamento" — a exceção, não o campo.
 *
 * O preço acordado continua visível ao lado do novo, e não é substituído:
 * a diferença entre os dois É a evidência. Quem auditar o documento meses
 * depois vê os dois números, o motivo, o autor e a data, em vez de um
 * valor solitário que pode ou não ter sido o combinado.
 *
 * ## A consequência aparece antes de confirmar
 *
 * Antes, digitar 13,25 no lugar de 12,50 não mostrava nada: o operador
 * confirmava a alteração do preço unitário sem ver o que ela fazia com a
 * linha nem com o documento, e só descobria o total depois — quando desfazer
 * já custava outra alteração, com outro motivo, no histórico. Agora a linha e
 * o documento aparecem em prévia enquanto se digita, pela MESMA função que a
 * API usa para emitir (`calcularTotaisFaturamento`), ao lado do que está
 * gravado e sempre nomeados.
 *
 * A prévia não grava nada e não toca no histórico: quem persiste é o botão
 * "Alterar preço".
 */
export function PriceOverrideDialog({
  billing,
  line,
  onClose,
  onOverridden,
}: PriceOverrideDialogProps) {
  const [unitPrice, setUnitPrice] = useState(line.unitPrice ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mesma leitura da vírgula em toda a web; `null` é "ainda não é número"
  // (inclui negativo, que o parser central nunca aceita).
  const digitado = unitPrice.trim();
  const precoNovo = parseDecimalInput(unitPrice);
  const ilegivel = digitado !== "" && precoNovo === null;
  const igualAoAcordado =
    line.agreedUnitPrice !== null &&
    precoNovo !== null &&
    Number(precoNovo) === Number(line.agreedUnitPrice);

  /*
   * Prévia do documento com ESTA linha ao preço digitado — as demais entram
   * como estão gravadas. Preço ilegível ou em branco não vira zero: a linha
   * fica sem total, o documento fica sem prévia, e a tela diz por quê.
   */
  const previa = calcularTotaisFaturamento(
    billing.lines.map((row) =>
      row.id === line.id
        ? { quantity: row.quantity, unitPrice: precoNovo }
        : { quantity: row.quantity, unitPrice: row.unitPrice },
    ),
  );
  const indiceDaLinha = billing.lines.findIndex((row) => row.id === line.id);
  const previaDaLinha = previa.lineTotals[indiceDaLinha] ?? null;
  const previaDoDocumento = previa.totalAmount;
  const documentoTemOutrasLinhas = billing.lines.length > 1;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const atualizado = await overrideBillingPrice(billing.id, line.id, {
        unitPrice: exigirDecimal(unitPrice, "Preço faturado"),
        reason: reason.trim(),
      });
      onOverridden(atualizado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao alterar o preço de faturamento");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = precoNovo !== null && reason.trim().length >= 3 && !saving;

  return (
    <ModalDialog labelledBy="price-override-title" onClose={onClose}>
      <h2 id="price-override-title">Alterar preço de faturamento</h2>
      <p>
        O preço acordado no Pedido continua registrado. Faturar outro valor não o apaga — passa a
        constar a diferença, com motivo e autor.
      </p>

      <dl className="definition-list">
        <dt>Produto</dt>
        <dd>
          {line.productCode} — {line.productName}
        </dd>
        <dt>Quantidade</dt>
        <dd>
          {formatQuantity(line.quantity)} {line.unitCode}
        </dd>
        <dt>Preço acordado</dt>
        <dd>{formatUnitPriceBRL(line.agreedUnitPrice)}</dd>
      </dl>

      <form id="price-override-form" onSubmit={handleSubmit} className="field-grid-2">
        <div className="field">
          <label htmlFor="override-price">
            Preço faturado <span className="req">*</span>
          </label>
          <input
            id="override-price"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={unitPrice}
            aria-invalid={ilegivel || undefined}
            aria-describedby={ilegivel ? "override-price-error" : undefined}
            className={ilegivel ? "is-invalid" : undefined}
            onChange={(event) => setUnitPrice(event.target.value)}
          />
          {ilegivel && (
            <p className="field__error" id="override-price-error">
              {mensagemDecimalInvalido("Preço faturado")}
            </p>
          )}
          {igualAoAcordado && (
            <p className="field__hint">
              Igual ao acordado — confirmar remove a marca de alteração desta linha.
            </p>
          )}
        </div>

        <div className="field field--full">
          <label htmlFor="override-reason">
            Motivo <span className="req">*</span>
          </label>
          <textarea
            id="override-reason"
            rows={3}
            placeholder="Ex.: desconto comercial autorizado nesta remessa"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </form>

      {/* Prévia e gravado lado a lado, cada um com o seu nome: em cima o que
          confirmar vai produzir, embaixo o que o documento diz hoje. */}
      <div className="quote-plan quote-plan--simulated">
        <h3 className="quote-plan__title">
          Prévia <em>— ainda não confirmada</em>
        </h3>
        <dl className="definition-list">
          <dt>Total da linha (prévia)</dt>
          <dd>
            {previaDaLinha !== null ? (
              <>
                <strong>{formatBRL(previaDaLinha)}</strong>{" "}
                <CalcHint
                  label="Total da linha (prévia)"
                  operandos={[
                    { valor: formatUnitPriceBRL(precoNovo), papel: "preço faturado nesta prévia" },
                    {
                      valor: formatQuantity(line.quantity),
                      papel: `quantidade em ${line.unitCode}`,
                    },
                  ]}
                  resultado={formatBRL(previaDaLinha)}
                  esperado={Number(precoNovo) * Number(line.quantity)}
                  nota="A quantidade vem da expedição confirmada e não muda aqui."
                />
              </>
            ) : (
              <span className="field__hint">— Informe um preço faturado válido.</span>
            )}
          </dd>
          <dt>Total do documento (prévia)</dt>
          <dd>
            {previaDoDocumento !== null ? (
              <strong>{formatBRL(previaDoDocumento)}</strong>
            ) : (
              <span className="field__hint">
                {documentoTemOutrasLinhas
                  ? "— Alguma linha do documento está sem preço: total parcial não existe."
                  : "— Informe um preço faturado válido."}
              </span>
            )}
          </dd>
        </dl>
        {/* O gravado continua à vista e nomeado — é o que o documento vale
            enquanto ninguém confirma. */}
        <dl className="definition-list">
          <dt>Total da linha gravado</dt>
          <dd>{formatBRL(line.lineTotal)}</dd>
          <dt>Total do documento gravado</dt>
          <dd>{formatBRL(billing.totalAmount)}</dd>
        </dl>
      </div>

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="confirm-dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="submit"
          form="price-override-form"
          className="btn btn--accent"
          disabled={!canSubmit}
        >
          {saving ? "Alterando…" : "Alterar preço"}
        </button>
      </div>
    </ModalDialog>
  );
}
