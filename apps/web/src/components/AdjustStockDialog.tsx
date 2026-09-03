import { useState } from "react";
import type { FormEvent } from "react";
import type { InventoryLotBreakdownDTO } from "@veridi/shared";
import { createInventoryAdjustment } from "../lib/inventory-api";
import { exigirDecimal } from "../lib/decimal-field";
import { ModalDialog } from "./ModalDialog";

interface AdjustStockDialogProps {
  itemId: string;
  unitCode: string;
  controlsLot: boolean;
  lots: InventoryLotBreakdownDTO[];
  onClose: () => void;
  onAdjusted: () => void;
}

type AdjustmentType = "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "LOSS";

const TYPE_OPTIONS: { value: AdjustmentType; label: string }[] = [
  { value: "ADJUSTMENT_IN", label: "Ajuste de entrada" },
  { value: "ADJUSTMENT_OUT", label: "Ajuste de saída" },
  { value: "LOSS", label: "Perda" },
];

/**
 * Fluxo explícito "Ajustar estoque" — usuário nunca edita saldo diretamente,
 * sempre gera um InventoryMovement rastreável com motivo obrigatório.
 */
export function AdjustStockDialog({
  itemId,
  unitCode,
  controlsLot,
  lots,
  onClose,
  onAdjusted,
}: AdjustStockDialogProps) {
  const [lotId, setLotId] = useState(lots[0]?.lotId ?? "");
  const [type, setType] = useState<AdjustmentType>("ADJUSTMENT_IN");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createInventoryAdjustment({
        itemId,
        ...(controlsLot ? { lotId } : {}),
        type,
        // `0,85` é o que a pessoa digita; a recusa acontece aqui, com o nome
        // do campo, e nenhum movimento é criado.
        quantity: exigirDecimal(quantity, `Quantidade (${unitCode})`),
        reason: reason.trim(),
      });
      onAdjusted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ajustar estoque");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    quantity.trim().length > 0 && reason.trim().length >= 3 && (!controlsLot || lotId);

  return (
    <>
      <ModalDialog labelledBy="adjust-stock-title" onClose={onClose}>
        <h2 id="adjust-stock-title">Ajustar estoque</h2>
        <p>Gera um movimento rastreável — não altera o saldo diretamente.</p>

        <form id="adjust-stock-form" onSubmit={handleSubmit} className="field-grid-2">
          {controlsLot && (
            <div className="field field--full">
              <label htmlFor="adjust-lot">
                Lote <span className="req">*</span>
              </label>
              <select id="adjust-lot" value={lotId} onChange={(event) => setLotId(event.target.value)}>
                {lots.length === 0 && <option value="">Nenhum lote disponível</option>}
                {lots.map((lot) => (
                  <option key={lot.lotId} value={lot.lotId}>
                    {lot.lotCode} — físico {lot.onHand} {unitCode}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="adjust-type">
              Tipo <span className="req">*</span>
            </label>
            <select
              id="adjust-type"
              value={type}
              onChange={(event) => setType(event.target.value as AdjustmentType)}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="adjust-quantity">
              Quantidade ({unitCode}) <span className="req">*</span>
            </label>
            <input
              id="adjust-quantity"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>

          <div className="field field--full">
            <label htmlFor="adjust-reason">
              Motivo <span className="req">*</span>
            </label>
            <textarea
              id="adjust-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </form>

        {error && <p className="form-alert" role="alert">{error}</p>}

        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="adjust-stock-form"
            className="btn btn--accent"
            disabled={!canSubmit || saving}
          >
            {saving ? "Salvando…" : "Confirmar ajuste"}
          </button>
        </div>
      </ModalDialog>
    </>
  );
}
