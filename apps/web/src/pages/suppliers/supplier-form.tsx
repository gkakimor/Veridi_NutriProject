import { useState } from "react";
import type { FormEvent } from "react";
import type { SupplierDTO } from "@veridi/shared";
import { formatBrPhone, maskPhoneInput } from "@veridi/shared";
import { RelatedLinks } from "../../components/RelatedLinks";
import { createSupplier, updateSupplier } from "../../lib/suppliers-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";

/**
 * O formulário de Fornecedor, uma vez só.
 *
 * Existe porque o cadastro passou a ter duas portas: o modal, aberto de
 * dentro de outra tela, e a página `/cadastros/fornecedores/novo`, que tem
 * URL própria e por isso sobrevive a refresh e a link direto. Duas
 * implementações dos mesmos campos divergiriam — uma ganharia uma validação
 * que a outra não tem, e a diferença só apareceria meses depois, num
 * registro que entrou por onde não devia.
 *
 * A divisão é a que o HTML já permitia: `useSupplierForm` guarda estado,
 * payload e submit; `SupplierFormFields` desenha os campos dentro do
 * `<form>`; e quem hospeda monta o próprio rodapé. O botão de commit não
 * precisa estar dentro do `<form>` — `type="submit" form="supplier-form"`
 * aciona um formulário em que o botão não está aninhado. Por isso o rodapé
 * precisa de UMA coisa daqui: `saving`.
 */

/** O `<form>` que o botão de commit aciona pelo atributo `form`. */
export const SUPPLIER_FORM_ID = "supplier-form";

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
      phone: formatBrPhone(supplier.phone) ?? "",
      notes: supplier.notes ?? "",
    };
  }
  return { legalName: "", tradeName: "", cnpj: "", email: "", phone: "", notes: "" };
}

export function useSupplierForm({
  mode,
  supplier,
  onSaved,
}: {
  mode: "create" | "edit";
  supplier: SupplierDTO | null;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: SupplierDTO) => void;
}) {
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

  return { form, setForm, saving, error, fieldErrors, handleSubmit, mode, supplier };
}

export type SupplierFormController = ReturnType<typeof useSupplierForm>;

export function SupplierFormFields({
  form,
  setForm,
  error,
  fieldErrors,
  handleSubmit,
  mode,
  supplier,
}: SupplierFormController) {
  return (
    <form id={SUPPLIER_FORM_ID} onSubmit={handleSubmit}>
      {error && <p className="form-alert">{error}</p>}

      {supplier && (
        <RelatedLinks
          links={[
            { label: "Ordens de compra", to: `/compras/ordens?supplierId=${supplier.id}` },
            {
              label: "Itens homologados",
              to: `/compras/item-fornecedor?supplierId=${supplier.id}`,
            },
          ]}
        />
      )}

      <FormSection
        title="Identificação"
        subtitle="Dados básicos do fornecedor usados em compras e recebimento."
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
              onChange={(event) => setForm((prev) => ({ ...prev, cnpj: event.target.value }))}
            />
            {fieldErrors["cnpj"] && <p className="field__error">{fieldErrors["cnpj"]}</p>}
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
              placeholder="contato@empresa.com.br"
              value={form.email}
              aria-invalid={fieldErrors["email"] ? true : undefined}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            {/* Sem isto, a recusa da API viraria "Corrija os campos
                destacados" sem nenhum campo destacado. */}
            {fieldErrors["email"] && <p className="field__error">{fieldErrors["email"]}</p>}
          </div>

          <div className="field">
            <label htmlFor="supplier-phone">Telefone</label>
            <input
              id="supplier-phone"
              type="text"
              inputMode="tel"
              placeholder="(11) 99999-8888"
              value={form.phone}
              aria-invalid={fieldErrors["phone"] ? true : undefined}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, phone: maskPhoneInput(event.target.value) }))
              }
            />
            {fieldErrors["phone"] && <p className="field__error">{fieldErrors["phone"]}</p>}
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
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </FormSection>

      {mode === "edit" && supplier && (
        <FormSection title="Status">
          <div className="status-line">
            <span className={supplier.active ? "badge badge--active" : "badge badge--inactive"}>
              {supplier.active ? "Ativo" : "Inativo"}
            </span>
            <span className="field__hint">
              Use "Inativar"/"Reativar" na lista para alterar o status.
            </span>
          </div>
        </FormSection>
      )}
    </form>
  );
}
