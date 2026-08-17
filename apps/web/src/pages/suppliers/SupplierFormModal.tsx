import { useState } from "react";
import type { FormEvent } from "react";
import type { SupplierDTO } from "@veridi/shared";
import { RelatedLinks } from "../../components/RelatedLinks";
import { createSupplier, updateSupplier } from "../../lib/suppliers-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import { SupplierItemsSection } from "../../components/SupplierItemsSection";

interface SupplierFormModalProps {
  mode: "create" | "edit";
  supplier: SupplierDTO | null;
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: SupplierDTO) => void;
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

/** Modal fullscreen de criacao/edicao de fornecedor — mesmo padrao de Items. */
export function SupplierFormModal({ mode, supplier, onClose, onSaved }: SupplierFormModalProps) {
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
        const created = await createSupplier(payload);
        onSaved(created);
      } else if (supplier) {
        await updateSupplier(supplier.id, payload);
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
        setError(err instanceof Error ? err.message : "Falha ao salvar fornecedor");
      }
    } finally {
      setSaving(false);
    }
  }

  const codeChip = mode === "create" ? "Código gerado ao salvar" : supplier?.code;

  const footer =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O fornecedor será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="supplier-form" className="btn btn--accent" disabled={saving}>
            {saving ? "Criando…" : "Criar fornecedor"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração:{" "}
          {supplier ? new Date(supplier.updatedAt).toLocaleDateString("pt-BR") : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="supplier-form" className="btn btn--accent" disabled={saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </>
    );

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Fornecedores"
      crumbActive={mode === "create" ? "Novo" : "Editar"}
      title={mode === "create" ? "Novo fornecedor" : supplier?.legalName}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <form id="supplier-form" onSubmit={handleSubmit}>
        {error && <p className="form-alert">{error}</p>}

        {supplier && (
          <RelatedLinks
            links={[
              { label: "Ordens de compra", to: `/compras/ordens?supplierId=${supplier.id}` },
              { label: "Itens homologados", to: `/compras/item-fornecedor?supplierId=${supplier.id}` },
            ]}
          />
        )}

        <FormSection
          title="Identificação"
          subtitle="Dados basicos do fornecedor usados em compras e recebimento."
        >
          <div className="field-grid-2">
            <div className="field field--full">
              <label htmlFor="supplier-legal-name">
                Razão Social / Nome <span className="req">*</span>
              </label>
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
          </div>
        </FormSection>

        <FormSection title="Contato" subtitle="Usados para tratativas de compra e recebimento.">
          <div className="field-grid-2">
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
          </div>
        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="supplier-notes">Notas internas</label>
            <textarea
              id="supplier-notes"
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, notes: event.target.value }))
              }
            />
          </div>
        </FormSection>

        {mode === "edit" && supplier && (
          <FormSection title="Status">
            <div className="status-line">
              <span
                className={supplier.active ? "badge badge--active" : "badge badge--inactive"}
              >
                {supplier.active ? "Ativo" : "Inativo"}
              </span>
              <span className="field__hint">
                Use "Inativar"/"Reativar" na lista para alterar o status.
              </span>
            </div>
          </FormSection>
        )}
      </form>

      {mode === "edit" && supplier && (
        <SupplierItemsSection scope="supplier" id={supplier.id} />
      )}
    </FullWorkspaceModal>
  );
}
