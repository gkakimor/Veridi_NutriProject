import { useState } from "react";
import type { FormEvent } from "react";
import type { ItemDTO, ItemType, UnitOfMeasureDTO } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS, ITEM_TYPE_LABELS } from "@veridi/shared";
import { createItem, updateItem } from "../../lib/items-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import { ToggleCard } from "../../components/ToggleCard";

interface ItemFormModalProps {
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
 * Modal fullscreen de criacao/edicao de item — padrao visual para os
 * proximos cadastros. Uma unica acao de commit (lima) por superficie.
 */
export function ItemFormModal({ mode, item, units, onClose, onSaved }: ItemFormModalProps) {
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

  const footer =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O item será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="item-form"
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Criando…" : "Criar item"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração:{" "}
          {item ? new Date(item.updatedAt).toLocaleDateString("pt-BR") : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="item-form"
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </>
    );

  const codeChip = mode === "create" ? "Código gerado ao salvar" : item?.code;

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Itens"
      crumbActive={mode === "create" ? "Novo" : "Editar"}
      title={mode === "create" ? "Novo item" : item?.name}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <form id="item-form" onSubmit={handleSubmit}>
        {error && <p className="form-alert">{error}</p>}

        <FormSection
          title="Identificação"
          subtitle="Dados básicos do item usados em compras, estoque e produção."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="item-type">
                Tipo <span className="req">*</span>
              </label>
              <select
                id="item-type"
                required
                value={form.type}
                onChange={(event) => handleTypeChange(event.target.value as ItemType)}
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
              <label htmlFor="item-unit">
                Unidade <span className="req">*</span>
              </label>
              <select
                id="item-unit"
                required
                value={form.unitCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, unitCode: event.target.value }))
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

            <div className="field field--full">
              <label htmlFor="item-name">
                Nome <span className="req">*</span>
              </label>
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
          </div>
        </FormSection>

        <FormSection
          title="Controles de rastreabilidade"
          subtitle="Definem como o estoque deste item será acompanhado."
        >
          <div className="toggle-row">
            <ToggleCard
              id="item-controls-lot"
              checked={form.controlsLot}
              onChange={(checked) =>
                setForm((prev) => ({ ...prev, controlsLot: checked }))
              }
              label="Controla lote"
              description="Cada recebimento gera lote interno com QR Code próprio."
            />
            <ToggleCard
              id="item-controls-expiry"
              checked={form.controlsExpiry}
              onChange={(checked) =>
                setForm((prev) => ({ ...prev, controlsExpiry: checked }))
              }
              label="Controla validade"
              description="Habilita FEFO: o sistema sugere primeiro o lote que vence antes."
            />
          </div>
        </FormSection>

        <FormSection
          title="Códigos"
          subtitle="Identificadores externos para leitura no recebimento."
        >
          <div className="field">
            <label htmlFor="item-barcode">Barcode externo</label>
            <input
              id="item-barcode"
              type="text"
              placeholder="Ex.: 7891234567890"
              value={form.externalBarcode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, externalBarcode: event.target.value }))
              }
            />
            <p className="field__hint">Código de barras do fornecedor. Opcional.</p>
          </div>
        </FormSection>

        {mode === "edit" && item && (
          <FormSection title="Status">
            <div className="status-line">
              <span className={item.active ? "badge badge--active" : "badge badge--inactive"}>
                {item.active ? "Ativo" : "Inativo"}
              </span>
              <span className="field__hint">
                Use "Inativar"/"Reativar" na lista para alterar o status. Itens
                inativos continuam visíveis no histórico.
              </span>
            </div>
          </FormSection>
        )}
      </form>
    </FullWorkspaceModal>
  );
}
