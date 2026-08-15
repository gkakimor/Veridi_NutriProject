import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ProductDTO } from "@veridi/shared";
import { createProduct, updateProduct } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { listItems } from "../../lib/items-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";

interface ProductFormModalProps {
  mode: "create" | "edit";
  product: ProductDTO | null;
  onClose: () => void;
  onSaved: () => void;
}

interface CustomerOption {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  active: boolean;
}

interface FinishedItemOption {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface FormState {
  name: string;
  externalCode: string;
  customerId: string;
  finishedProductItemId: string;
  notes: string;
}

function initialState(product: ProductDTO | null): FormState {
  if (product) {
    return {
      name: product.name,
      externalCode: product.externalCode ?? "",
      customerId: product.customerId ?? "",
      finishedProductItemId: product.finishedProductItemId ?? "",
      notes: product.notes ?? "",
    };
  }
  return { name: "", externalCode: "", customerId: "", finishedProductItemId: "", notes: "" };
}

/** Modal fullscreen de criacao/edicao de produto — mesmo padrao de Items. */
export function ProductFormModal({ mode, product, onClose, onSaved }: ProductFormModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [activeCustomers, setActiveCustomers] = useState<CustomerOption[]>([]);
  const [activeFinishedItems, setActiveFinishedItems] = useState<FinishedItemOption[]>([]);

  useEffect(() => {
    listCustomers({ active: true, pageSize: 100 })
      .then((result) => setActiveCustomers(result.customers))
      .catch(() => setActiveCustomers([]));
    listItems({ type: "FINISHED_PRODUCT", active: true, pageSize: 100 })
      .then((result) => setActiveFinishedItems(result.items))
      .catch(() => setActiveFinishedItems([]));
  }, []);

  // Vinculo historico: se o cliente/item associado nao estiver mais na lista
  // de ativos (foi inativado depois), ele continua aparecendo no select.
  const customerOptions: CustomerOption[] = useMemo(() => {
    if (!product?.customer || activeCustomers.some((c) => c.id === product.customer?.id)) {
      return activeCustomers;
    }
    return [...activeCustomers, { ...product.customer, active: false }];
  }, [activeCustomers, product]);

  const finishedItemOptions: FinishedItemOption[] = useMemo(() => {
    if (
      !product?.finishedProductItem ||
      activeFinishedItems.some((item) => item.id === product.finishedProductItem?.id)
    ) {
      return activeFinishedItems;
    }
    return [...activeFinishedItems, { ...product.finishedProductItem, active: false }];
  }, [activeFinishedItems, product]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError(null);
    setFieldErrors({});

    // No edit sempre envia as chaves opcionais (mesmo vazias) para permitir
    // limpar/desvincular; no create so envia quando preenchido.
    const optionalField = (value: string) =>
      mode === "edit" || value.trim() ? { value: value.trim() } : null;

    const externalCode = optionalField(form.externalCode);
    const customerId = optionalField(form.customerId);
    const finishedProductItemId = optionalField(form.finishedProductItemId);
    const notes = optionalField(form.notes);

    const payload = {
      name: form.name.trim(),
      ...(externalCode ? { externalCode: externalCode.value } : {}),
      ...(customerId ? { customerId: customerId.value } : {}),
      ...(finishedProductItemId ? { finishedProductItemId: finishedProductItemId.value } : {}),
      ...(notes ? { notes: notes.value } : {}),
    };

    try {
      if (mode === "create") {
        await createProduct(payload);
      } else if (product) {
        await updateProduct(product.id, payload);
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
        setError(err instanceof Error ? err.message : "Falha ao salvar produto");
      }
    } finally {
      setSaving(false);
    }
  }

  const codeChip =
    mode === "create" ? "Código gerado automaticamente ao salvar" : product?.code;

  const footer =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O produto será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="product-form" className="btn btn--accent" disabled={saving}>
            {saving ? "Criando…" : "Criar produto"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração:{" "}
          {product ? new Date(product.updatedAt).toLocaleDateString("pt-BR") : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="product-form" className="btn btn--accent" disabled={saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </>
    );

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Produtos"
      crumbActive={mode === "create" ? "Novo" : "Editar"}
      title={mode === "create" ? "Novo produto" : product?.name}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <form id="product-form" onSubmit={handleSubmit}>
        {error && <p className="form-alert">{error}</p>}

        <FormSection
          title="Identificação"
          subtitle="Definição comercial/industrial do produto fabricado pela Veridi."
        >
          <div className="field-grid-2">
            <div className="field field--full">
              <label htmlFor="product-name">
                Nome <span className="req">*</span>
              </label>
              <input
                id="product-name"
                type="text"
                required
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
              {fieldErrors["name"] && <p className="field__error">{fieldErrors["name"]}</p>}
            </div>

            <div className="field field--full">
              <label htmlFor="product-external-code">Referência externa</label>
              <input
                id="product-external-code"
                type="text"
                placeholder="Ex.: código legado, código do cliente…"
                value={form.externalCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, externalCode: event.target.value }))
                }
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Vínculos"
          subtitle="Cliente e item de produto acabado associados — opcionais."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="product-customer">Cliente</label>
              <select
                id="product-customer"
                value={form.customerId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, customerId: event.target.value }))
                }
              >
                <option value="">Nenhum</option>
                {customerOptions.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.code} — {customer.tradeName ?? customer.legalName}
                    {!customer.active ? " (inativo)" : ""}
                  </option>
                ))}
              </select>
              {fieldErrors["customerId"] && (
                <p className="field__error">{fieldErrors["customerId"]}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="product-finished-item">Item de produto acabado</label>
              <select
                id="product-finished-item"
                value={form.finishedProductItemId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, finishedProductItemId: event.target.value }))
                }
              >
                <option value="">Nenhum</option>
                {finishedItemOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                    {!item.active ? " (inativo)" : ""}
                  </option>
                ))}
              </select>
              {fieldErrors["finishedProductItemId"] && (
                <p className="field__error">{fieldErrors["finishedProductItemId"]}</p>
              )}
            </div>
          </div>
        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="product-notes">Notas internas</label>
            <textarea
              id="product-notes"
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, notes: event.target.value }))
              }
            />
          </div>
        </FormSection>

        {mode === "edit" && product && (
          <FormSection title="Status">
            <div className="status-line">
              <span className={product.active ? "badge badge--active" : "badge badge--inactive"}>
                {product.active ? "Ativo" : "Inativo"}
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
