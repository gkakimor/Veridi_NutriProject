import { useState } from "react";
import type { FormEvent } from "react";
import type { CustomerDTO } from "@veridi/shared";
import { BR_STATE_CODES } from "@veridi/shared";
import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { ApiValidationError } from "../../lib/api-errors";

interface CustomerFormDrawerProps {
  mode: "create" | "edit";
  customer: CustomerDTO | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  legalName: string;
  tradeName: string;
  cnpj: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  notes: string;
}

function initialState(customer: CustomerDTO | null): FormState {
  if (customer) {
    return {
      legalName: customer.legalName,
      tradeName: customer.tradeName ?? "",
      cnpj: customer.cnpj ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      city: customer.city ?? "",
      state: customer.state ?? "",
      notes: customer.notes ?? "",
    };
  }
  return {
    legalName: "",
    tradeName: "",
    cnpj: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    notes: "",
  };
}

/** Drawer contextual de criacao/edicao de cliente — mesmo padrao de Items. */
export function CustomerFormDrawer({
  mode,
  customer,
  onClose,
  onSaved,
}: CustomerFormDrawerProps) {
  const [form, setForm] = useState<FormState>(() => initialState(customer));
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
    const city = optionalField(form.city);
    const state = optionalField(form.state);
    const notes = optionalField(form.notes);

    const payload = {
      legalName: form.legalName.trim(),
      ...(tradeName ? { tradeName: tradeName.value } : {}),
      ...(cnpj ? { cnpj: cnpj.value } : {}),
      ...(email ? { email: email.value } : {}),
      ...(phone ? { phone: phone.value } : {}),
      ...(city ? { city: city.value } : {}),
      ...(state ? { state: state.value } : {}),
      ...(notes ? { notes: notes.value } : {}),
    };

    try {
      if (mode === "create") {
        await createCustomer(payload);
      } else if (customer) {
        await updateCustomer(customer.id, payload);
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
        setError(err instanceof Error ? err.message : "Falha ao salvar cliente");
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
        aria-labelledby="customer-drawer-title"
      >
        <div className="drawer__header">
          <div>
            <h2 className="drawer__title" id="customer-drawer-title">
              {mode === "create" ? "Novo cliente" : customer?.legalName}
            </h2>
            {mode === "edit" && customer && (
              <p className="field-readonly-value">Código: {customer.code}</p>
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
              <label htmlFor="customer-legal-name">Razão Social / Nome *</label>
              <input
                id="customer-legal-name"
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
              <label htmlFor="customer-trade-name">Nome Fantasia</label>
              <input
                id="customer-trade-name"
                type="text"
                value={form.tradeName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, tradeName: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="customer-cnpj">CNPJ</label>
              <input
                id="customer-cnpj"
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
              <label htmlFor="customer-email">Email</label>
              <input
                id="customer-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="customer-phone">Telefone</label>
              <input
                id="customer-phone"
                type="text"
                value={form.phone}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, phone: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="customer-city">Cidade</label>
              <input
                id="customer-city"
                type="text"
                value={form.city}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, city: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="customer-state">UF</label>
              <select
                id="customer-state"
                value={form.state}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, state: event.target.value }))
                }
              >
                <option value="">Selecione…</option>
                {BR_STATE_CODES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
              {fieldErrors["state"] && (
                <p className="field__error">{fieldErrors["state"]}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="customer-notes">Observações</label>
              <textarea
                id="customer-notes"
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </div>

            {mode === "edit" && customer && (
              <div className="field">
                <span>Status</span>
                <p className="field-readonly-value">
                  {customer.active ? "Ativo" : "Inativo"}
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
