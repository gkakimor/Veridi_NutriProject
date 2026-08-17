import { useState } from "react";
import type { FormEvent } from "react";
import type { ItemDTO, ItemType, UnitOfMeasureDTO } from "@veridi/shared";
import { ITEM_TYPE_DEFAULTS, ITEM_TYPE_LABELS } from "@veridi/shared";
import { createItem, updateItem } from "../../lib/items-api";
import { ApiValidationError } from "../../lib/api-errors";
import { RelatedLinks } from "../../components/RelatedLinks";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import { SupplierItemsSection } from "../../components/SupplierItemsSection";
import {
  ITEM_FAMILIES,
  ITEM_FAMILY_LABELS,
  PACKAGING_SUBTYPES,
  PACKAGING_SUBTYPE_LABELS,
} from "@veridi/shared";
import { ToggleCard } from "../../components/ToggleCard";

interface ItemFormModalProps {
  mode: "create" | "edit";
  item: ItemDTO | null;
  units: UnitOfMeasureDTO[];
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: ItemDTO) => void;
}

interface FormState {
  type: ItemType | "";
  name: string;
  unitCode: string;
  controlsLot: boolean;
  controlsExpiry: boolean;
  requiresQualityRelease: boolean;
  requiresCoa: boolean;
  sourceName: string;
  declaredNutrient: string;
  family: string;
  defaultPurityPercent: string;
  packagingSubtype: string;
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
      requiresQualityRelease: item.requiresQualityRelease,
      requiresCoa: item.requiresCoa,
      sourceName: item.sourceName ?? "",
      declaredNutrient: item.declaredNutrient ?? "",
      family: item.family ?? "",
      defaultPurityPercent: item.defaultPurityPercent ?? "",
      packagingSubtype: item.packagingSubtype ?? "",
      externalBarcode: item.externalBarcode ?? "",
    };
  }
  return {
    type: "",
    name: "",
    unitCode: "",
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: true,
    // Exigir laudo é decisão explícita — nunca inferida do tipo do item.
    requiresCoa: false,
    sourceName: "",
    declaredNutrient: "",
    family: "",
    defaultPurityPercent: "",
    packagingSubtype: "",
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

  const structuralLocked = mode === "edit" && (item?.operationallyUsed ?? false);
  const structuralLockHint =
    "Este campo não pode ser alterado porque o item já possui histórico operacional.";

  function handleTypeChange(nextType: ItemType) {
    setForm((prev) => {
      if (mode === "edit") return { ...prev, type: nextType };
      const defaults = ITEM_TYPE_DEFAULTS[nextType];
      return {
        ...prev,
        type: nextType,
        controlsLot: defaults.controlsLot,
        controlsExpiry: defaults.controlsExpiry,
        requiresQualityRelease: defaults.requiresQualityRelease,
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
      requiresQualityRelease: form.requiresQualityRelease,
      requiresCoa: form.requiresCoa,
      // No edit sempre envia (mesmo vazio) para permitir limpar; no create
      // só quando preenchido. Vazio vira null — nunca um default silencioso.
      ...(mode === "edit" || form.sourceName.trim()
        ? { sourceName: form.sourceName.trim() }
        : {}),
      ...(mode === "edit" || form.declaredNutrient.trim()
        ? { declaredNutrient: form.declaredNutrient.trim() }
        : {}),
      ...(mode === "edit" || form.family ? { family: form.family } : {}),
      ...(mode === "edit" || form.defaultPurityPercent.trim()
        ? { defaultPurityPercent: form.defaultPurityPercent.trim().replace(",", ".") }
        : {}),
      ...(mode === "edit" || form.packagingSubtype
        ? { packagingSubtype: form.type === "PACKAGING" ? form.packagingSubtype : "" }
        : {}),
      // No edit sempre envia a chave (mesmo vazia) para permitir limpar um
      // barcode existente; no create so envia quando preenchido.
      ...(mode === "edit" || trimmedBarcode
        ? { externalBarcode: trimmedBarcode }
        : {}),
    };

    try {
      if (mode === "create") {
        const created = await createItem(payload);
        onSaved(created);
      } else if (item) {
        await updateItem(item.id, payload);
        onSaved();
      } else {
        onSaved();
      }
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

        {item && (
          <RelatedLinks
            links={[
              // Estoque do item tem tela própria: melhor destino que uma lista
              // filtrada.
              { label: "Estoque", to: `/estoque/${item.id}` },
              { label: "Lotes", to: `/estoque/lotes?itemId=${item.id}` },
              { label: "Movimentações", to: `/estoque/movimentacoes?itemId=${item.id}` },
              { label: "Fornecedores do item", to: `/compras/item-fornecedor?itemId=${item.id}` },
            ]}
          />
        )}

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
                disabled={structuralLocked}
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
              {structuralLocked && <p className="field__hint">{structuralLockHint}</p>}
            </div>

            <div className="field">
              <label htmlFor="item-unit">
                Unidade <span className="req">*</span>
              </label>
              <select
                id="item-unit"
                required
                disabled={structuralLocked}
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
              {structuralLocked && <p className="field__hint">{structuralLockHint}</p>}
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

        {/* Classificação industrial (capacidade 33) — insumo das
            capacidades de formulação e custeio. Tudo opcional. */}
        <FormSection
          title="Classificação industrial"
          subtitle="Fonte, nutriente declarado e pureza padrão usados pela formulação."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="item-source-name">Fonte</label>
              <input
                id="item-source-name"
                type="text"
                placeholder="Ex.: Cloridrato de tiamina"
                value={form.sourceName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sourceName: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="item-declared-nutrient">Nutriente declarado</label>
              <input
                id="item-declared-nutrient"
                type="text"
                placeholder="Ex.: Vitamina B1"
                value={form.declaredNutrient}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, declaredNutrient: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="item-family">Família</label>
              <select
                id="item-family"
                value={form.family}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, family: event.target.value }))
                }
              >
                <option value="">Não informada</option>
                {ITEM_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {ITEM_FAMILY_LABELS[family]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field field--narrow">
              <label htmlFor="item-purity">Pureza padrão (%)</label>
              <input
                id="item-purity"
                type="text"
                inputMode="decimal"
                placeholder="Ex.: 98,5"
                value={form.defaultPurityPercent}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, defaultPurityPercent: event.target.value }))
                }
              />
              {/* Vazio = desconhecida. Nunca é assumida como 100%. */}
              <p className="field__hint">
                Em branco significa pureza desconhecida — nunca 100%.
              </p>
              {fieldErrors["defaultPurityPercent"] && (
                <p className="field__error">{fieldErrors["defaultPurityPercent"]}</p>
              )}
            </div>

            {form.type === "PACKAGING" && (
              <div className="field">
                <label htmlFor="item-packaging-subtype">Subtipo de embalagem</label>
                <select
                  id="item-packaging-subtype"
                  value={form.packagingSubtype}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, packagingSubtype: event.target.value }))
                  }
                >
                  <option value="">Não informado</option>
                  {PACKAGING_SUBTYPES.map((subtype) => (
                    <option key={subtype} value={subtype}>
                      {PACKAGING_SUBTYPE_LABELS[subtype]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </FormSection>

        <FormSection
          title="Controles de rastreabilidade"
          subtitle={
            structuralLocked
              ? `Lote e validade: ${structuralLockHint.charAt(0).toLowerCase()}${structuralLockHint.slice(1)}`
              : "Definem como o estoque deste item será acompanhado."
          }
        >
          <div className="toggle-row">
            <ToggleCard
              id="item-controls-lot"
              checked={form.controlsLot}
              disabled={structuralLocked}
              onChange={(checked) =>
                setForm((prev) => ({ ...prev, controlsLot: checked }))
              }
              label="Controla lote"
              description="Cada recebimento gera lote interno com QR Code próprio."
            />
            <ToggleCard
              id="item-controls-expiry"
              checked={form.controlsExpiry}
              disabled={structuralLocked}
              onChange={(checked) =>
                setForm((prev) => ({ ...prev, controlsExpiry: checked }))
              }
              label="Controla validade"
              description="Habilita FEFO: o sistema sugere primeiro o lote que vence antes."
            />
            <ToggleCard
              id="item-requires-quality-release"
              checked={form.requiresQualityRelease}
              onChange={(checked) =>
                setForm((prev) => ({ ...prev, requiresQualityRelease: checked }))
              }
              label="Requer liberação da Qualidade"
              description="Novos lotes recebidos ficam indisponíveis até serem liberados."
            />
            <ToggleCard
              id="item-requires-coa"
              checked={form.requiresCoa}
              onChange={(checked) => setForm((prev) => ({ ...prev, requiresCoa: checked }))}
              label="Exige CoA / Laudo"
              description="Lotes deste item só são liberados com o laudo aprovado pela Qualidade."
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

      {/* Fornecedores existem depois que o item existe — o modal de criacao
          continua enxuto. */}
      {mode === "edit" && item && <SupplierItemsSection scope="item" id={item.id} />}
    </FullWorkspaceModal>
  );
}
