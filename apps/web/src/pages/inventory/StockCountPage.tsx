import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ItemDTO, StockCountResultDTO } from "@veridi/shared";
import { listItems } from "../../lib/items-api";
import { getInventoryItem, createStockCount } from "../../lib/inventory-api";
import { FormSection } from "../../components/FormSection";

interface LotOption {
  lotId: string;
  lotCode: string;
  onHand: string;
}

/**
 * Estoque → Inventário Físico. Nunca altera o saldo diretamente — ao
 * confirmar, cria (no máximo) um InventoryMovement de ajuste pela diferença.
 */
export function StockCountPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState<ItemDTO[]>([]);
  const [itemId, setItemId] = useState("");
  const [selectedItem, setSelectedItem] = useState<ItemDTO | null>(null);

  const [lots, setLots] = useState<LotOption[]>([]);
  const [lotId, setLotId] = useState("");

  const [systemQuantity, setSystemQuantity] = useState<string | null>(null);
  const [countedQuantity, setCountedQuantity] = useState("");
  const [reason, setReason] = useState("");

  const [loadingScope, setLoadingScope] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockCountResultDTO | null>(null);

  useEffect(() => {
    listItems({ active: true, pageSize: 100 })
      .then((response) => setItems(response.items))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    setSelectedItem(items.find((item) => item.id === itemId) ?? null);
    setLotId("");
    setSystemQuantity(null);
    setResult(null);
  }, [itemId, items]);

  useEffect(() => {
    if (!itemId) return;
    setLoadingScope(true);
    getInventoryItem(itemId)
      .then((detail) => {
        if (detail.controlsLot) {
          setLots(detail.lots.map((lot) => ({ lotId: lot.lotId, lotCode: lot.lotCode, onHand: lot.onHand })));
          setSystemQuantity(null);
        } else {
          setLots([]);
          setSystemQuantity(detail.onHand);
        }
      })
      .catch(() => setError("Falha ao carregar saldo do sistema"))
      .finally(() => setLoadingScope(false));
  }, [itemId]);

  useEffect(() => {
    if (!selectedItem?.controlsLot) return;
    const lot = lots.find((candidate) => candidate.lotId === lotId);
    setSystemQuantity(lot ? lot.onHand : null);
  }, [lotId, lots, selectedItem]);

  const difference =
    systemQuantity !== null && countedQuantity.trim()
      ? (Number(countedQuantity) - Number(systemQuantity)).toString()
      : null;
  const hasDifference = difference !== null && Number(difference) !== 0;

  async function handleConfirm() {
    if (!itemId || systemQuantity === null) return;
    setSaving(true);
    setError(null);
    try {
      const response = await createStockCount({
        itemId,
        ...(selectedItem?.controlsLot ? { lotId } : {}),
        countedQuantity,
        ...(hasDifference ? { reason: reason.trim() } : {}),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao confirmar contagem");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setItemId("");
    setCountedQuantity("");
    setReason("");
    setResult(null);
  }

  const canConfirm =
    itemId &&
    systemQuantity !== null &&
    countedQuantity.trim().length > 0 &&
    (!selectedItem?.controlsLot || lotId) &&
    (!hasDifference || reason.trim().length >= 3);

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Inventário Físico</h1>
          <p className="page__subtitle">
            Contagem física vira ajuste rastreável — nunca sobrescreve o saldo diretamente.
          </p>
        </div>
      </div>

      <FormSection title="Contagem">
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="count-item">
              Item <span className="req">*</span>
            </label>
            <select id="count-item" value={itemId} onChange={(event) => setItemId(event.target.value)}>
              <option value="">Selecione…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
          </div>

          {selectedItem?.controlsLot && (
            <div className="field">
              <label htmlFor="count-lot">
                Lote <span className="req">*</span>
              </label>
              <select id="count-lot" value={lotId} onChange={(event) => setLotId(event.target.value)}>
                <option value="">Selecione…</option>
                {lots.map((lot) => (
                  <option key={lot.lotId} value={lot.lotId}>
                    {lot.lotCode}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>Saldo sistema</label>
            <div className="field-readonly-value">
              {loadingScope
                ? "Carregando…"
                : systemQuantity !== null
                  ? `${systemQuantity} ${selectedItem?.unitCode ?? ""}`
                  : "—"}
            </div>
          </div>

          <div className="field">
            <label htmlFor="count-quantity">
              Contagem física <span className="req">*</span>
            </label>
            <input
              id="count-quantity"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={countedQuantity}
              onChange={(event) => setCountedQuantity(event.target.value)}
              disabled={systemQuantity === null}
            />
          </div>

          <div className="field">
            <label>Diferença</label>
            <div className="field-readonly-value">
              {difference !== null ? `${difference} ${selectedItem?.unitCode ?? ""}` : "—"}
            </div>
          </div>

          {hasDifference && (
            <div className="field field--full">
              <label htmlFor="count-reason">
                Motivo <span className="req">*</span>
              </label>
              <textarea
                id="count-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          )}
        </div>

        {error && <p className="form-alert">{error}</p>}

        <div className="line-actions">
          <button
            type="button"
            className="btn btn--accent btn--sm"
            disabled={!canConfirm || saving}
            onClick={handleConfirm}
          >
            {saving ? "Confirmando…" : "Confirmar contagem"}
          </button>
        </div>
      </FormSection>

      {result && (
        <FormSection title="Resultado">
          <dl className="definition-list">
            <dt>Saldo sistema</dt>
            <dd>{result.systemQuantity}</dd>
            <dt>Contagem física</dt>
            <dd>{result.countedQuantity}</dd>
            <dt>Diferença</dt>
            <dd>{result.difference}</dd>
            <dt>Ajuste gerado</dt>
            <dd>
              {result.movementCreated
                ? `${result.movementCreated.type === "ADJUSTMENT_IN" ? "Ajuste de entrada" : "Ajuste de saída"} — ${result.movementCreated.quantity}`
                : "Nenhum — contagem confere com o sistema"}
            </dd>
          </dl>
          <div className="table__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={handleReset}>
              Nova contagem
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => navigate(`/estoque/${itemId}`)}
            >
              Ver item
            </button>
          </div>
        </FormSection>
      )}
    </>
  );
}
