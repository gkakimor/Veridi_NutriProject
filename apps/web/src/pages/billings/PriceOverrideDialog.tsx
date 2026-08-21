import { useState } from "react";
import type { FormEvent } from "react";
import type { BillingDTO, BillingLineDTO } from "@veridi/shared";
import { ModalDialog } from "../../components/ModalDialog";
import { overrideBillingPrice } from "../../lib/billings-api";

interface PriceOverrideDialogProps {
  billingId: string;
  line: BillingLineDTO;
  onClose: () => void;
  onOverridden: (billing: BillingDTO) => void;
}

function formatBRL(value: string | null): string {
  if (!value) return "—";
  return `R$ ${Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * "Alterar preço de faturamento" — a exceção, não o campo.
 *
 * O preço acordado continua visível ao lado do novo, e não é substituído:
 * a diferença entre os dois É a evidência. Quem auditar o documento meses
 * depois vê os dois números, o motivo, o autor e a data, em vez de um
 * valor solitário que pode ou não ter sido o combinado.
 */
export function PriceOverrideDialog({
  billingId,
  line,
  onClose,
  onOverridden,
}: PriceOverrideDialogProps) {
  const [unitPrice, setUnitPrice] = useState(line.unitPrice ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const novo = Number(unitPrice.replace(",", "."));
  const igualAoAcordado = line.agreedUnitPrice !== null && novo === Number(line.agreedUnitPrice);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const atualizado = await overrideBillingPrice(billingId, line.id, {
        unitPrice: unitPrice.trim().replace(",", "."),
        reason: reason.trim(),
      });
      onOverridden(atualizado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao alterar o preço de faturamento");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    unitPrice.trim().length > 0 &&
    Number.isFinite(novo) &&
    novo >= 0 &&
    reason.trim().length >= 3 &&
    !saving;

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
          {line.quantity} {line.unitCode}
        </dd>
        <dt>Preço acordado</dt>
        <dd>{formatBRL(line.agreedUnitPrice)}</dd>
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
            onChange={(event) => setUnitPrice(event.target.value)}
          />
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

      {error && <p className="form-alert">{error}</p>}

      <div className="confirm-dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" form="price-override-form" className="btn btn--accent" disabled={!canSubmit}>
          {saving ? "Alterando…" : "Alterar preço"}
        </button>
      </div>
    </ModalDialog>
  );
}
