import { useState } from "react";
import type { FormEvent } from "react";
import type { CustomerDTO } from "@veridi/shared";
import { BR_STATE_CODES, formatZipCode } from "@veridi/shared";
import { RelatedLinks } from "../../components/RelatedLinks";
import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";

interface CustomerFormModalProps {
  mode: "create" | "edit";
  customer: CustomerDTO | null;
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: CustomerDTO) => void;
}

interface FormState {
  legalName: string;
  tradeName: string;
  cnpj: string;
  email: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
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
      // CEP guardado só com dígitos; exibido com máscara.
      zipCode: formatZipCode(customer.zipCode) ?? "",
      street: customer.street ?? "",
      number: customer.number ?? "",
      complement: customer.complement ?? "",
      district: customer.district ?? "",
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
    zipCode: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    notes: "",
  };
}

/** Modal fullscreen de criacao/edicao de cliente — mesmo padrao de Items. */
export function CustomerFormModal({ mode, customer, onClose, onSaved }: CustomerFormModalProps) {
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
    const zipCode = optionalField(form.zipCode);
    const street = optionalField(form.street);
    const number = optionalField(form.number);
    const complement = optionalField(form.complement);
    const district = optionalField(form.district);
    const city = optionalField(form.city);
    const state = optionalField(form.state);
    const notes = optionalField(form.notes);

    const payload = {
      legalName: form.legalName.trim(),
      ...(tradeName ? { tradeName: tradeName.value } : {}),
      ...(cnpj ? { cnpj: cnpj.value } : {}),
      ...(email ? { email: email.value } : {}),
      ...(phone ? { phone: phone.value } : {}),
      ...(zipCode ? { zipCode: zipCode.value } : {}),
      ...(street ? { street: street.value } : {}),
      ...(number ? { number: number.value } : {}),
      ...(complement ? { complement: complement.value } : {}),
      ...(district ? { district: district.value } : {}),
      ...(city ? { city: city.value } : {}),
      ...(state ? { state: state.value } : {}),
      ...(notes ? { notes: notes.value } : {}),
    };

    try {
      if (mode === "create") {
        const created = await createCustomer(payload);
        onSaved(created);
      } else if (customer) {
        await updateCustomer(customer.id, payload);
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
        setError(err instanceof Error ? err.message : "Falha ao salvar cliente");
      }
    } finally {
      setSaving(false);
    }
  }

  const codeChip = mode === "create" ? "Código gerado ao salvar" : customer?.code;

  const footer =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O cliente será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="customer-form" className="btn btn--accent" disabled={saving}>
            {saving ? "Criando…" : "Criar cliente"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração:{" "}
          {customer ? new Date(customer.updatedAt).toLocaleDateString("pt-BR") : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="customer-form" className="btn btn--accent" disabled={saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </>
    );

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Clientes"
      crumbActive={mode === "create" ? "Novo" : "Editar"}
      title={mode === "create" ? "Novo cliente" : customer?.legalName}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <form id="customer-form" onSubmit={handleSubmit}>
        {error && <p className="form-alert">{error}</p>}

        {customer && (
          <RelatedLinks
            links={[
              { label: "Projetos", to: `/comercial/projetos?customerId=${customer.id}` },
              { label: "Pedidos", to: `/comercial/pedidos?customerId=${customer.id}` },
              { label: "Faturamentos", to: `/comercial/faturamento?customerId=${customer.id}` },
              {
                label: "Materiais do cliente",
                to: `/estoque/materiais-de-clientes?customerId=${customer.id}`,
              },
            ]}
          />
        )}

        <FormSection
          title="Identificação"
          subtitle="Dados basicos do cliente usados em produtos e ordens de producao."
        >
          <div className="field-grid-2">
            <div className="field field--full">
              <label htmlFor="customer-legal-name">
                Razão Social / Nome <span className="req">*</span>
              </label>
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
          </div>
        </FormSection>

        <FormSection title="Contato">
          <div className="field-grid-2">
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

          </div>
        </FormSection>

        {/* Endereço estruturado — usado depois em OP, documentos GMP e
            expedição. Sem integração de CEP: o usuário digita. */}
        <FormSection title="Endereço">
          <div className="field-grid-2">
            <div className="field field--narrow">
              <label htmlFor="customer-zip">CEP</label>
              <input
                id="customer-zip"
                type="text"
                inputMode="numeric"
                placeholder="00000-000"
                value={form.zipCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, zipCode: event.target.value }))
                }
              />
              {fieldErrors["zipCode"] && (
                <p className="field__error">{fieldErrors["zipCode"]}</p>
              )}
            </div>

            <div className="field field--full">
              <label htmlFor="customer-street">Logradouro</label>
              <input
                id="customer-street"
                type="text"
                value={form.street}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, street: event.target.value }))
                }
              />
            </div>

            <div className="field field--narrow">
              <label htmlFor="customer-number">Número</label>
              <input
                id="customer-number"
                type="text"
                value={form.number}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, number: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="customer-complement">Complemento</label>
              <input
                id="customer-complement"
                type="text"
                value={form.complement}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, complement: event.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="customer-district">Bairro</label>
              <input
                id="customer-district"
                type="text"
                value={form.district}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, district: event.target.value }))
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
          </div>
        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="customer-notes">Notas internas</label>
            <textarea
              id="customer-notes"
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, notes: event.target.value }))
              }
            />
          </div>
        </FormSection>

        {mode === "edit" && customer && (
          <FormSection title="Status">
            <div className="status-line">
              <span
                className={customer.active ? "badge badge--active" : "badge badge--inactive"}
              >
                {customer.active ? "Ativo" : "Inativo"}
              </span>
              <span className="field__hint">
                Use "Inativar"/"Reativar" na lista para alterar o status.
              </span>
            </div>
          </FormSection>
        )}
      </form>
    </FullWorkspaceModal>
  );
}
