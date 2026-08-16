import { useState } from "react";
import type { FormEvent } from "react";
import type { ItemDTO, SupplierDTO, SupplierItemDetailDTO } from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import { createSupplierItem } from "../../lib/supplier-items-api";

/**
 * Nova relação item × fornecedor.
 *
 * A relação nasce sempre PENDENTE: cadastrar um fornecedor para o item não
 * é homologá-lo — isso é ato da Qualidade, em outra ação.
 */
export function SupplierItemFormModal({
  items,
  suppliers,
  onClose,
  onSaved,
}: {
  items: ItemDTO[];
  suppliers: SupplierDTO[];
  onClose: () => void;
  onSaved: (created: SupplierItemDetailDTO) => void;
}) {
  const [itemId, setItemId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierItemCode, setSupplierItemCode] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Produto acabado é produzido, não comprado — fica fora da lista.
  const purchasableItems = items.filter(
    (item) => item.type === "RAW_MATERIAL" || item.type === "PACKAGING",
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createSupplierItem({
        itemId,
        supplierId,
        ...(supplierItemCode.trim() ? { supplierItemCode: supplierItemCode.trim() } : {}),
        ...(commercialNotes.trim() ? { commercialNotes: commercialNotes.trim() } : {}),
      });
      onSaved(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar a relação");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Compras / Item × Fornecedor"
      crumbActive="Nova"
      title="Nova relação item × fornecedor"
      footer={
        <>
          <span className="modal-fullscreen__foot-meta">
            A relação será criada como <b>Pendente</b> — homologar é ação da Qualidade.
          </span>
          <div className="modal-fullscreen__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              form="supplier-item-form"
              className="btn btn--accent"
              disabled={saving || !itemId || !supplierId}
            >
              {saving ? "Criando…" : "Criar relação"}
            </button>
          </div>
        </>
      }
    >
      <form id="supplier-item-form" onSubmit={handleSubmit}>
        {error && <p className="form-alert">{error}</p>}

        <FormSection title="Relação">
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="supplier-item-item">Item</label>
              <select
                id="supplier-item-item"
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {purchasableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-supplier">Fornecedor</label>
              <select
                id="supplier-item-supplier"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.code} — {supplier.legalName}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-code">Código do item no fornecedor</label>
              <input
                id="supplier-item-code"
                type="text"
                value={supplierItemCode}
                onChange={(event) => setSupplierItemCode(event.target.value)}
                placeholder="Ex.: VC-ASC-001"
              />
              <span className="field__hint">
                Referência do catálogo do fornecedor — não é o código interno nem o legado.
              </span>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-notes">Observações comerciais</label>
              <input
                id="supplier-item-notes"
                type="text"
                value={commercialNotes}
                onChange={(event) => setCommercialNotes(event.target.value)}
              />
            </div>
          </div>
        </FormSection>
      </form>
    </FullWorkspaceModal>
  );
}
