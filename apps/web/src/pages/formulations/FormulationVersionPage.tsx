import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { FormulationVersionDTO, UnitOfMeasureDTO } from "@veridi/shared";
import { FORMULATION_VERSION_STATUS_LABELS } from "@veridi/shared";
import {
  activateFormulationVersion,
  createNewFormulationVersion,
  getFormulationVersion,
  updateFormulationVersion,
} from "../../lib/formulations-api";
import { listItems } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";

interface ItemOption {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  unitDimension: string;
  active: boolean;
}

interface ComponentRow {
  key: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemActive: boolean;
  stockUnitCode: string;
  quantity: string;
  unitCode: string;
  notes: string;
  stockEquivalentQuantity: string;
}

function statusBadgeClass(status: FormulationVersionDTO["status"]): string {
  switch (status) {
    case "ACTIVE":
      return "badge badge--active";
    case "DRAFT":
      return "badge badge--warn";
    case "INACTIVE":
      return "badge badge--neutral";
  }
}

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `component-${rowKeySeq}`;
}

function rowFromDTO(component: FormulationVersionDTO["components"][number]): ComponentRow {
  return {
    key: nextRowKey(),
    itemId: component.itemId,
    itemCode: component.itemCode,
    itemName: component.itemName,
    itemActive: component.itemActive,
    stockUnitCode: component.stockUnitCode,
    quantity: component.quantity,
    unitCode: component.unitCode,
    notes: component.notes ?? "",
    stockEquivalentQuantity: component.stockEquivalentQuantity,
  };
}

/**
 * Editor de versão de formulação — página própria (documento transacional),
 * não modal. DRAFT é totalmente editável; ACTIVE/INACTIVE são read-only por
 * construção (backend também bloqueia).
 */
export function FormulationVersionPage() {
  const navigate = useNavigate();
  const { productId, versionId } = useParams<{ productId: string; versionId: string }>();

  const [version, setVersion] = useState<FormulationVersionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [basisQuantity, setBasisQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [components, setComponents] = useState<ComponentRow[]>([]);

  const [activeItems, setActiveItems] = useState<ItemOption[]>([]);
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);

  const syncFromServer = useCallback((dto: FormulationVersionDTO) => {
    setBasisQuantity(dto.basisQuantity);
    setNotes(dto.notes ?? "");
    setComponents(dto.components.map(rowFromDTO));
  }, []);

  const load = useCallback(() => {
    if (!versionId) return;
    setLoading(true);
    setNotFound(false);
    getFormulationVersion(versionId)
      .then((dto) => {
        setVersion(dto);
        syncFromServer(dto);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [versionId, syncFromServer]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      listItems({ type: "RAW_MATERIAL", active: true, pageSize: 100 }),
      listItems({ type: "PACKAGING", active: true, pageSize: 100 }),
    ])
      .then(([raw, packaging]) =>
        setActiveItems(
          [...raw.items, ...packaging.items].map((item) => ({
            id: item.id,
            code: item.code,
            name: item.name,
            unitCode: item.unitCode,
            unitDimension: item.unit.dimension,
            active: item.active,
          })),
        ),
      )
      .catch(() => setActiveItems([]));
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  const isDraft = version?.status === "DRAFT";

  function optionsForRow(row: ComponentRow): ItemOption[] {
    const usedByOtherRows = new Set(components.filter((c) => c.key !== row.key).map((c) => c.itemId));
    const base = activeItems.filter((item) => !usedByOtherRows.has(item.id));
    if (row.itemId && !base.some((item) => item.id === row.itemId)) {
      return [
        ...base,
        {
          id: row.itemId,
          code: row.itemCode,
          name: row.itemName,
          unitCode: row.stockUnitCode,
          unitDimension: "",
          active: row.itemActive,
        },
      ];
    }
    return base;
  }

  function unitOptionsForRow(row: ComponentRow): UnitOfMeasureDTO[] {
    const selected = activeItems.find((item) => item.id === row.itemId);
    if (!selected) return units;
    return units.filter((unit) => unit.dimension === selected.unitDimension);
  }

  function handleAddComponent() {
    setComponents((prev) => [
      ...prev,
      {
        key: nextRowKey(),
        itemId: "",
        itemCode: "",
        itemName: "",
        itemActive: true,
        stockUnitCode: "",
        quantity: "",
        unitCode: "",
        notes: "",
        stockEquivalentQuantity: "",
      },
    ]);
  }

  function handleRemoveComponent(key: string) {
    setComponents((prev) => prev.filter((row) => row.key !== key));
  }

  function handleComponentItemChange(key: string, itemId: string) {
    const item = activeItems.find((option) => option.id === itemId);
    setComponents((prev) =>
      prev.map((row) =>
        row.key === key
          ? {
              ...row,
              itemId,
              itemCode: item?.code ?? "",
              itemName: item?.name ?? "",
              itemActive: item?.active ?? true,
              stockUnitCode: item?.unitCode ?? "",
              unitCode: item?.unitCode ?? "",
            }
          : row,
      ),
    );
  }

  function handleComponentFieldChange(
    key: string,
    field: "quantity" | "unitCode" | "notes",
    value: string,
  ) {
    setComponents((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  async function handleSaveDraft() {
    if (!versionId) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const componentsPayload = components
      .filter((row) => row.itemId)
      .map((row) => ({
        itemId: row.itemId,
        quantity: row.quantity.trim(),
        unitCode: row.unitCode,
        ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
      }));

    try {
      const updated = await updateFormulationVersion(versionId, {
        basisQuantity: basisQuantity.trim(),
        notes: notes.trim(),
        components: componentsPayload,
      });
      setVersion(updated);
      syncFromServer(updated);
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) nextFieldErrors[issue.path] = issue.message;
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao salvar rascunho");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    if (!versionId) return;
    setActivateDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      const updated = await activateFormulationVersion(versionId);
      setVersion(updated);
      syncFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ativar formulação");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateNewVersion() {
    if (!versionId) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createNewFormulationVersion(versionId);
      navigate(`/producao/formulacoes/${productId}/versoes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar nova versão");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Formulação</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !version) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Versão não encontrada</h1>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate(`/producao/formulacoes/${productId ?? ""}`)}
          >
            ← Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Produção / Formulações / {version.productName}</div>
          <div className="doc-title">
            <h1>Formulação {version.versionLabel}</h1>
            <span className={statusBadgeClass(version.status)}>
              {FORMULATION_VERSION_STATUS_LABELS[version.status]}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => navigate(`/producao/formulacoes/${productId}`)}
        >
          ← Voltar
        </button>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

        <FormSection
          title="Produto e base"
          subtitle={
            isDraft
              ? "Enquanto rascunho, tudo pode ser alterado livremente."
              : "Versão ativa/inativa é somente leitura — para alterar, crie uma nova versão."
          }
        >
          <dl className="definition-list">
            <dt>Produto</dt>
            <dd>
              <span className="code">{version.productCode}</span> {version.productName}
            </dd>
            <dt>Item de saída</dt>
            <dd>
              <span className="code">{version.outputItemCode}</span> {version.outputItemName}
            </dd>
          </dl>

          <div className="field field--narrow">
            <label htmlFor="version-basis">
              Base da formulação ({version.outputUnitCode}) <span className="req">*</span>
            </label>
            {isDraft ? (
              <input
                id="version-basis"
                type="text"
                inputMode="decimal"
                value={basisQuantity}
                onChange={(event) => setBasisQuantity(event.target.value)}
              />
            ) : (
              <p className="field-readonly-value">
                {version.basisQuantity} {version.outputUnitCode}
              </p>
            )}
            {fieldErrors["basisQuantity"] && (
              <p className="field__error">{fieldErrors["basisQuantity"]}</p>
            )}
          </div>
        </FormSection>

        <FormSection
          title="Componentes"
          subtitle="Somente matérias-primas e embalagens. Unidade pode diferir da unidade de estoque, desde que compatível."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Quantidade</th>
                  <th>Unidade</th>
                  <th>Equivalente estoque</th>
                  {isDraft && <th aria-hidden="true" />}
                </tr>
              </thead>
              <tbody>
                {components.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {isDraft ? (
                        <select
                          value={row.itemId}
                          onChange={(event) => handleComponentItemChange(row.key, event.target.value)}
                        >
                          <option value="">Selecione…</option>
                          {optionsForRow(row).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.code} — {item.name}
                              {!item.active ? " (inativo)" : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <span className="code">{row.itemCode}</span> {row.itemName}
                        </>
                      )}
                      {!row.itemActive && (
                        <div className="field__hint">Item inativo — mantido pelo histórico.</div>
                      )}
                    </td>
                    <td>{row.stockUnitCode || "—"}</td>
                    <td>
                      {isDraft ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={row.quantity}
                          onChange={(event) =>
                            handleComponentFieldChange(row.key, "quantity", event.target.value)
                          }
                        />
                      ) : (
                        row.quantity
                      )}
                    </td>
                    <td>
                      {isDraft ? (
                        <select
                          value={row.unitCode}
                          onChange={(event) =>
                            handleComponentFieldChange(row.key, "unitCode", event.target.value)
                          }
                        >
                          <option value="">—</option>
                          {unitOptionsForRow(row).map((unit) => (
                            <option key={unit.code} value={unit.code}>
                              {unit.code}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.unitCode
                      )}
                    </td>
                    <td>
                      {row.stockEquivalentQuantity} {row.stockUnitCode}
                    </td>
                    {isDraft && (
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label="Remover componente"
                          onClick={() => handleRemoveComponent(row.key)}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {components.length === 0 && (
                  <tr>
                    <td colSpan={isDraft ? 6 : 5} className="table__empty">
                      Nenhum componente adicionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isDraft && (
            <div className="line-actions">
              <button type="button" className="btn btn--secondary btn--sm" onClick={handleAddComponent}>
                + Adicionar componente
              </button>
            </div>
          )}
        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="version-notes">Notas técnicas</label>
            <textarea
              id="version-notes"
              rows={3}
              disabled={!isDraft}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </FormSection>
      </div>

      <div className="doc-actions">
        <div className="doc-actions__primary">
          {isDraft && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveDraft}>
              {saving ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {isDraft && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => setActivateDialogOpen(true)}
            >
              Ativar versão
            </button>
          )}
          {version.status === "ACTIVE" && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={handleCreateNewVersion}
            >
              Criar nova versão
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={activateDialogOpen}
        title={`Ativar formulação ${version.versionLabel}?`}
        message="Esta versão passará a ser a formulação oficial do produto; a versão ativa anterior (se houver) será inativada; a versão ativada não poderá mais ser editada — futuras alterações exigirão uma nova versão."
        confirmLabel="Ativar versão"
        confirmTone="accent"
        onCancel={() => setActivateDialogOpen(false)}
        onConfirm={handleActivate}
      />
    </>
  );
}
