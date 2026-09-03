import { useState } from "react";
import type { FormEvent } from "react";
import type { MaterialReservationLineDTO, ProductionOrderDTO } from "@veridi/shared";
import { addExtraReservation } from "../lib/production-orders-api";
import { exigirDecimal } from "../lib/decimal-field";
import { parseDecimalInput } from "../lib/decimal-input";
import { ModalDialog } from "./ModalDialog";

interface ExtraConsumptionDialogProps {
  productionOrderId: string;
  line: MaterialReservationLineDTO;
  onClose: () => void;
  onAdded: (order: ProductionOrderDTO) => void;
}

/**
 * "Adicionar consumo extra" — a ampliação explícita da reserva.
 *
 * O consumo real segue limitado ao reservado, e é isso que impede uma OP
 * de se servir sozinha do estoque livre e do que pertence a outra ordem.
 * O que este diálogo abre é o caminho para o desvio mais comum do chão de
 * fábrica: pesou-se um pouco mais do que a formulação previa.
 *
 * A tela mostra o saldo livre ANTES de o operador pedir. Descobrir o
 * limite só ao ser recusado é o que acontecia antes, e não ajudava
 * ninguém a decidir quanto pedir.
 */
export function ExtraConsumptionDialog({
  productionOrderId,
  line,
  onClose,
  onAdded,
}: ExtraConsumptionDialogProps) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [outroLote, setOutroLote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const livre = Number(line.lotFreeQuantity ?? "0");
  // Mesma leitura da vírgula em toda a web: um separador é casa decimal,
  // dois não se adivinha. `null` aqui é "ainda não dá para comparar".
  const digitado = parseDecimalInput(quantity);
  const pedido = digitado === null ? Number.NaN : Number(digitado);
  /* Só vale como excesso quando o lote é o mesmo — em outro lote o teto é
     o saldo de lá, que esta tela ainda não conhece. */
  const excede = !outroLote && quantity.trim().length > 0 && Number.isFinite(pedido) && pedido > livre;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const atualizada = await addExtraReservation(productionOrderId, line.id, {
        quantity: exigirDecimal(quantity, `Quantidade adicional (${line.unitCode})`),
        reason: reason.trim(),
        ...(outroLote && lotCode.trim() ? { lotCode: lotCode.trim() } : {}),
      });
      onAdded(atualizada);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao adicionar consumo extra");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    quantity.trim().length > 0 &&
    reason.trim().length >= 3 &&
    !excede &&
    (!outroLote || lotCode.trim().length > 0) &&
    !saving;

  return (
    <ModalDialog labelledBy="extra-consumption-title" onClose={onClose}>
      <h2 id="extra-consumption-title">Adicionar consumo extra</h2>
      <p>
        Amplia a reserva desta ordem para permitir consumir além do planejado. Não movimenta estoque
        — o consumo continua sendo registrado depois.
      </p>

      <dl className="definition-list">
        <div>
          <dt>Item</dt>
          <dd>
            {line.itemCode} — {line.itemName}
          </dd>
        </div>
        <div>
          <dt>Lote atual</dt>
          <dd>{line.lotCode ?? "sem controle de lote"}</dd>
        </div>
        <div>
          <dt>Reservado</dt>
          <dd>
            {line.quantity} {line.unitCode}
          </dd>
        </div>
        <div>
          <dt>Já consumido</dt>
          <dd>
            {line.consumedQuantity} {line.unitCode}
          </dd>
        </div>
        <div>
          <dt>Saldo reservado</dt>
          <dd>
            {line.remainingQuantity} {line.unitCode}
          </dd>
        </div>
        <div>
          <dt>Disponível não reservado</dt>
          <dd>
            {line.lotFreeQuantity ?? "—"} {line.lotFreeQuantity ? line.unitCode : ""}
          </dd>
        </div>
      </dl>

      <form id="extra-consumption-form" onSubmit={handleSubmit} className="field-grid-2">
        <div className="field">
          <label htmlFor="extra-quantity">
            Quantidade adicional ({line.unitCode}) <span className="req">*</span>
          </label>
          <input
            id="extra-quantity"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          {excede && (
            <p className="field__error">
              Acima do saldo livre deste lote ({line.lotFreeQuantity} {line.unitCode}). Estoque
              reservado por outra operação nunca é usado aqui.
            </p>
          )}
        </div>

        <div className="field field--checkbox">
          <label htmlFor="extra-other-lot">
            <input
              id="extra-other-lot"
              type="checkbox"
              checked={outroLote}
              onChange={(event) => setOutroLote(event.target.checked)}
            />
            Usar outro lote
          </label>
          <span className="field__hint">
            Quando o lote atual não tem saldo livre. O sistema nunca troca de lote sozinho.
          </span>
          {outroLote && (
            <input
              id="extra-lot-code"
              type="text"
              aria-label="Código do lote alternativo"
              placeholder="LT-20260815-000123"
              value={lotCode}
              onChange={(event) => setLotCode(event.target.value)}
            />
          )}
        </div>

        <div className="field field--full">
          <label htmlFor="extra-reason">
            Motivo <span className="req">*</span>
          </label>
          <textarea
            id="extra-reason"
            rows={3}
            placeholder="Ex.: ajuste de consumo durante produção"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="field__hint">Fica registrado com autor e data no histórico desta ordem.</p>
        </div>
      </form>

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="confirm-dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" form="extra-consumption-form" className="btn btn--accent" disabled={!canSubmit}>
          {saving ? "Adicionando…" : "Adicionar consumo extra"}
        </button>
      </div>
    </ModalDialog>
  );
}
