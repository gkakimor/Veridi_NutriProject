import { useState } from "react";
import type { FormEvent } from "react";
import type { SupplierDTO } from "@veridi/shared";
import { createSupplier, updateSupplier } from "../../lib/suppliers-api";
import { ApiValidationError } from "../../lib/api-errors";

interface SupplierFormDrawerProps {
  mode: "create" | "edit";
  supplier: SupplierDTO | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  legalName: string;
  tradeName: string;
  cnpj: string;
  email: string;
  phone: string;
  notes: string;
}

function initialState(supplier: SupplierDTO | null): FormState {
  if (supplier) {
    return {
      legalName: supplier.legalName,
      tradeName: supplier.tradeName ?? "",
      cnpj: supplier.cnpj ?? "",
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      notes: supplier.notes ?? "",
    };
  }
  return { legalName: "", tradeName: "", cnpj: "", email: "", phone: "", notes: "" };
}

/** Drawer contextual de criacao/edicao de fornecedor — mesmo padrao de Items. */
export function SupplierFormDrawer({
  mode,
  supplier,
  onClose,
  onSaved,
}: SupplierFormDrawerProps) {
  const [form, setForm] = useState<FormState>(() => initialState(supplier));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError(null);
    setFieldErrors({});

    // No edit sempre envia as chaves opcionais (mesmo vazias) para permitir
    // limpar um valor existente; no create so envia quando preenchido.
    const optionalField = (value: string) =>
      mode === "edit" || value.trim() ? { value: value.trim() } : null;

    const tradeName = optionalField(form.tradeName);
    const cnpj = optionalField(form.cnpj);
    const email = optionalField(form.email);
    const phone = optionalField(form.phone);
    const notes = optionalField(form.notes);

    const payload = {
      legalName: form.legalName.trim(),
      ...(tradeName ? { tradeName: tradeName.value } : {}),
      ...(cnpj ? { cnpj: cnpj.value } : {}),
      ...(email ? { email: email.value } : {}),
      ...(phone ? { phone: phone.value } : {}),
      ...(notes ? { notes: notes.value } : {}),
    };

    try {
      if (mode === "create") {
        await createSupplier(payload);
      } else if (supplier) {
        await updateSupplier(supplier.id, payload);
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
        setError(err instanceof Error ? err.message : "Falha ao salvar fornecedor");
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
        aria-labelledby="supplier-drawer-title"
      >
        <div className="drawer__header">
          <div>
            <h2 className="drawer__title" id="supplier-drawer-title">
              {mode === "create" ? "Novo fornecedor" : supplier?.legalName}
            </h2>
            {mode === "edit" && supplier && (
              <p className="field-readonly-value">Código: {supplier.code}</p>
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
              <label htmlFor="supplier-legal-name">Razão Social / Nome *</label>
              <input
                id="supplier-legal-name"
                type="text"
                required
                value={form.legalName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, legalName: event.target.value }))
                }
              />
              {fieldErrors["legalName"] && (
                <p className="field__error">{fieldErrors["legalName"]}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="supplier-trade-name">Nome Fantasia</label>
              <input
                id="supplier-trade-name"
                type="text"
                value={form.tradeName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, tradeName: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-cnpj">CNPJ</label>
              <input
                id="supplier-cnpj"
                type="text"
                placeholder="00.000.000/0000-00"
                value={form.cnpj}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, cnpj: event.target.value }))
                }
              />
              {fieldErrors["cnpj"] && (
                <p className="field__error">{fieldErrors["cnpj"]}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="supplier-email">Email</label>
              <input
                id="supplier-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-phone">Telefone</label>
              <input
                id="supplier-phone"
                type="text"
                value={form.phone}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, phone: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-notes">Observações</label>
              <textarea
                id="supplier-notes"
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </div>

            {mode === "edit" && supplier && (
              <div className="field">
                <span>Status</span>
                <p className="field-readonly-value">
                  {supplier.active ? "Ativo" : "Inativo"}
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
