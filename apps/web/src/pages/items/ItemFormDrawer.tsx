import { useState } from "react";
import type { FormEvent } from "react";
import type { ItemDTO, ItemType, UnitOfMeasureDTO } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS, ITEM_TYPE_LABELS } from "@veridi/shared";
import { createItem, updateItem } from "../../lib/items-api";
import { ApiValidationError } from "../../lib/api-errors";

interface ItemFormDrawerProps {
  mode: "create" | "edit";
  item: ItemDTO | null;
  units: UnitOfMeasureDTO[];
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  type: ItemType | "";
  name: string;
  unitCode: string;
  controlsLot: boolean;
  controlsExpiry: boolean;
  externalBarcode: string;
}

function initialState(item: ItemDTO | null): FormState {
  if (item) {
    return {
      type: item.type,
      name: item.name,
      unitCode: item.unitCode,
      controlsLot: item.controlsLot,
      controlsExpiry: item.controlsExpiry,
      externalBarcode: item.externalBarcode ?? "",
    };
  }
  return {
    type: "",
    name: "",
    unitCode: "",
    controlsLot: true,
    controlsExpiry: true,
    externalBarcode: "",
  };
}

/**
 * Drawer contextual de criacao/edicao de item — padrao visual para os
 * proximos cadastros. Uma unica acao primaria: Salvar.
 */
export function ItemFormDrawer({
  mode,
  item,
  units,
  onClose,
  onSaved,
}: ItemFormDrawerProps) {
  const [form, setForm] = useState<FormState>(() => initialState(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleTypeChange(nextType: ItemType) {
    setForm((prev) => {
      if (mode === "edit") return { ...prev, type: nextType };
      const defaults = ITEM_TYPE_DEFAULTS[nextType];
      return {
        ...prev,
        type: nextType,
        controlsLot: defaults.controlsLot,
        controlsExpiry: defaults.controlsExpiry,
      };
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.type) {
      setError("Selecione o tipo do item.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    const trimmedBarcode = form.externalBarcode.trim();
    const payload = {
      type: form.type,
      name: form.name.trim(),
      unitCode: form.unitCode,
      controlsLot: form.controlsLot,
      controlsExpiry: form.controlsExpiry,
      // No edit sempre envia a chave (mesmo vazia) para permitir limpar um
      // barcode existente; no create so envia quando preenchido.
      ...(mode === "edit" || trimmedBarcode
        ? { externalBarcode: trimmedBarcode }
        : {}),
    };

    try {
      if (mode === "create") {
        await createItem(payload);
      } else if (item) {
        await updateItem(item.id, payload);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          nextFieldErrors[issue.path] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao salvar item");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="drawer__scrim"
        aria-label="Fechar"
        onClick={onClose}
      />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-drawer-title"
      >
        <div className="drawer__header">
          <div>
            <h2 className="drawer__title" id="item-drawer-title">
              {mode === "create" ? "Novo item" : item?.name}
            </h2>
            {mode === "edit" && item && (
              <p className="field-readonly-value">Código: {item.code}</p>
            )}
          </div>
          <button
            type="button"
            className="drawer__close"
            aria-label="Fechar"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div className="drawer__body">
            {error && <p className="form-alert">{error}</p>}

            <div className="field">
              <label htmlFor="item-type">Tipo *</label>
              <select
                id="item-type"
                required
                value={form.type}
                onChange={(event) =>
                  handleTypeChange(event.target.value as ItemType)
                }
              >
                <option value="" disabled>
                  Selecione…
                </option>
                {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {fieldErrors["type"] && (
                <p className="field__error">{fieldErrors["type"]}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="item-name">Nome *</label>
              <input
                id="item-name"
                type="text"
                required
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
              {fieldErrors["name"] && (
                <p className="field__error">{fieldErrors["name"]}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="item-unit">Unidade *</label>
              <select
                id="item-unit"
                required
                value={form.unitCode}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    unitCode: event.target.value,
                  }))
                }
              >
                <option value="" disabled>
                  Selecione…
                </option>
                {units.map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {unit.code} — {unit.label}
                  </option>
                ))}
              </select>
              {fieldErrors["unitCode"] && (
                <p className="field__error">{fieldErrors["unitCode"]}</p>
              )}
            </div>

            <div className="field field--checkbox">
              <input
                id="item-controls-lot"
                type="checkbox"
                checked={form.controlsLot}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    controlsLot: event.target.checked,
                  }))
                }
              />
              <label htmlFor="item-controls-lot">Controla lote</label>
            </div>

            <div className="field field--checkbox">
              <input
                id="item-controls-expiry"
                type="checkbox"
                checked={form.controlsExpiry}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    controlsExpiry: event.target.checked,
                  }))
                }
              />
              <label htmlFor="item-controls-expiry">Controla validade</label>
            </div>

            <div className="field">
              <label htmlFor="item-barcode">Barcode externo</label>
              <input
                id="item-barcode"
                type="text"
                value={form.externalBarcode}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    externalBarcode: event.target.value,
                  }))
                }
              />
              <p className="field__hint">
                Código de barras do fornecedor. Opcional.
              </p>
            </div>

            {mode === "edit" && item && (
              <div className="field">
                <span>Status</span>
                <p className="field-readonly-value">
                  {item.active ? "Ativo" : "Inativo"}
                </p>
                <p className="field__hint">
                  Use "Inativar"/"Reativar" na lista para alterar o status.
                </p>
              </div>
            )}
          </div>

          <div className="drawer__footer">
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
