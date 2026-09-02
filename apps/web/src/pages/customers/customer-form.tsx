import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CustomerDTO } from "@veridi/shared";
import {
  BR_STATE_CODES,
  formatBrPhone,
  isValidBrPhone,
  isValidCnpj,
  isValidEmail,
  maskCnpjInput,
  maskPhoneInput,
  maskZipCodeInput,
  formatZipCode,
  normalizeCnpj,
} from "@veridi/shared";
import { RelatedLinks } from "../../components/RelatedLinks";
import { createCustomer, updateCustomer } from "../../lib/customers-api";
import { ApiValidationError } from "../../lib/api-errors";
import { FormSection } from "../../components/FormSection";
import { formatDateTime } from "../../lib/dates";
import { isCompleteZipCode, lookupCep } from "../../lib/cep-api";

/**
 * O formulário de Cliente, uma vez só.
 *
 * Existe porque o cadastro passou a ter duas portas: o modal, aberto de
 * dentro de outra tela, e a página `/cadastros/clientes/novo`, que tem URL
 * própria e por isso sobrevive a refresh e a link direto. Duas
 * implementações dos mesmos campos divergiriam — e aqui a divergência seria
 * cara: validação de CNPJ, máscara de telefone e a regra de sobrescrita do
 * preenchimento por CEP são detalhe fino demais para viver em dois lugares.
 *
 * A divisão é a que o HTML já permitia: `useCustomerForm` guarda estado,
 * payload e submit; `CustomerFormFields` desenha os campos dentro do
 * `<form>`; e quem hospeda monta o próprio rodapé. O botão de commit não
 * precisa estar dentro do `<form>` — `type="submit" form="customer-form"`
 * aciona um formulário em que o botão não está aninhado. Por isso o rodapé
 * precisa de UMA coisa daqui: `saving`.
 */

/** O `<form>` que o botão de commit aciona pelo atributo `form`. */
export const CUSTOMER_FORM_ID = "customer-form";

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

/** Campos que a consulta de CEP pode preencher. Número nunca entra. */
type AddressField = "street" | "district" | "city" | "state";
const CEP_FILLED_FIELDS: AddressField[] = ["street", "district", "city", "state"];

type CepStatus = "idle" | "loading" | "found" | "not_found" | "unavailable";

const CEP_MESSAGES: Record<Exclude<CepStatus, "idle" | "found">, string> = {
  loading: "Buscando endereço…",
  not_found: "CEP não encontrado. Preencha o endereço manualmente.",
  unavailable:
    "Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.",
};

function initialState(customer: CustomerDTO | null): FormState {
  if (customer) {
    return {
      legalName: customer.legalName,
      tradeName: customer.tradeName ?? "",
      cnpj: customer.cnpj ?? "",
      email: customer.email ?? "",
      // Guardados crus; exibidos com máscara.
      phone: formatBrPhone(customer.phone) ?? "",
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

/**
 * Validação de tela. A regra continua valendo no servidor — isto aqui existe
 * para o operador ver o erro ao lado do campo, não para ser a autoridade.
 */
function validateField(field: keyof FormState, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (field === "email" && !isValidEmail(trimmed)) return "E-mail inválido.";
  if (field === "phone" && !isValidBrPhone(trimmed)) {
    return "Informe um telefone com DDD.";
  }
  if (field === "cnpj" && !isValidCnpj(trimmed)) return "CNPJ inválido.";
  if (field === "zipCode" && !isCompleteZipCode(trimmed)) {
    return "CEP deve ter 8 dígitos.";
  }
  return null;
}

const VALIDATED_FIELDS: (keyof FormState)[] = ["email", "phone", "cnpj", "zipCode"];

export function useCustomerForm({
  mode,
  customer,
  onSaved,
}: {
  mode: "create" | "edit";
  customer: CustomerDTO | null;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: CustomerDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [cepStatus, setCepStatus] = useState<CepStatus>("idle");

  /**
   * O que a última consulta escreveu, e para qual CEP. Serve à regra de
   * sobrescrita: o que o operador digitou é dele; o que veio da consulta
   * anterior pode ser trocado quando o CEP muda. Um `ref` basta — não é
   * estado de renderização, e uma máquina de estados aqui seria exagero.
   */
  const autoFilled = useRef<{ zip: string; values: Partial<Record<AddressField, string>> }>({
    zip: "",
    values: {},
  });

  function setField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Erro some assim que o operador começa a corrigir.
    if (clientErrors[field]) {
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function handleBlur(field: keyof FormState) {
    const message = validateField(field, form[field]);
    setClientErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  async function handleZipLookup(raw: string) {
    if (!isCompleteZipCode(raw)) return;
    const digits = raw.replace(/\D/g, "");
    // Mesmo CEP já consultado com sucesso: não repete a chamada.
    if (autoFilled.current.zip === digits && cepStatus === "found") return;

    setCepStatus("loading");
    const result = await lookupCep(digits);

    if (result.status !== "found") {
      setCepStatus(result.status);
      return;
    }

    /**
     * Lido ANTES do `setForm`: o updater só roda na renderização seguinte, e
     * até lá o `ref` já teria o resultado desta consulta — a comparação
     * passaria a ser contra o valor novo e nada seria substituído.
     */
    const previousAuto = autoFilled.current.values;
    autoFilled.current = { zip: digits, values: { ...result.address } };

    setForm((prev) => {
      const next = { ...prev };
      for (const field of CEP_FILLED_FIELDS) {
        const current = prev[field];
        // Preenche o vazio; substitui apenas o que a consulta anterior pôs.
        const overwritable = current.trim() === "" || current === previousAuto[field];
        if (overwritable) next[field] = result.address[field];
      }
      return next;
    });
    setCepStatus("found");
    setClientErrors((prev) => {
      const next = { ...prev };
      delete next["zipCode"];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const nextClientErrors: Record<string, string> = {};
    for (const field of VALIDATED_FIELDS) {
      const message = validateField(field, form[field]);
      if (message) nextClientErrors[field] = message;
    }
    if (Object.keys(nextClientErrors).length > 0) {
      setClientErrors(nextClientErrors);
      setError("Corrija os campos destacados.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    setClientErrors({});

    // No edit sempre envia as chaves opcionais (mesmo vazias) para permitir
    // limpar um valor existente; no create so envia quando preenchido.
    const optionalField = (value: string) =>
      mode === "edit" || value.trim() ? { value: value.trim() } : null;

    const tradeName = optionalField(form.tradeName);
    // CNPJ e telefone viajam normalizados: a máscara é só da tela.
    const cnpj = optionalField(form.cnpj.trim() ? normalizeCnpj(form.cnpj) : "");
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

  /** Erro da tela tem precedência: é o mais recente que o operador viu. */
  const errorFor = (field: string): string | undefined =>
    clientErrors[field] ?? fieldErrors[field];

  return {
    form,
    setField,
    saving,
    error,
    fieldErrors,
    cepStatus,
    setCepStatus,
    handleBlur,
    handleZipLookup,
    handleSubmit,
    errorFor,
    mode,
    customer,
  };
}

export type CustomerFormController = ReturnType<typeof useCustomerForm>;

export function CustomerFormFields({
  form,
  setField,
  error,
  fieldErrors,
  cepStatus,
  setCepStatus,
  handleBlur,
  handleZipLookup,
  handleSubmit,
  errorFor,
  mode,
  customer,
}: CustomerFormController) {
  /** Liga input, `aria-invalid` e a mensagem, para leitor de tela também. */
  function fieldProps(field: keyof FormState) {
    const message = errorFor(field);
    return {
      ...(message ? { "aria-invalid": true as const } : {}),
      ...(message ? { "aria-describedby": `customer-${field}-error` } : {}),
      onBlur: () => handleBlur(field),
    };
  }

  function fieldError(field: keyof FormState) {
    const message = errorFor(field);
    if (!message) return null;
    return (
      <p className="field__error" id={`customer-${field}-error`}>
        {message}
      </p>
    );
  }

  return (
    <form id={CUSTOMER_FORM_ID} onSubmit={handleSubmit}>
      {error && <p className="form-alert">{error}</p>}

      {customer && (
        <RelatedLinks
          links={[
            /*
             * Os quatro atalhos abaixo continuam levando ao módulo, como
             * sempre levaram: "quero ir trabalhar em Pedidos deste
             * cliente". A Consulta completa é a alternativa, não a
             * substituta — "quero acompanhar o cliente como contexto".
             */
            {
              label: "Consulta completa",
              to: `/consultas/clientes/${customer.id}/resumo`,
              highlight: true,
            },
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
        subtitle="Dados básicos do cliente usados em produtos e ordens de produção."
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
              onChange={(event) => setField("legalName", event.target.value)}
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
              onChange={(event) => setField("tradeName", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-cnpj">CNPJ</label>
            {/* `type="text"`: o CNPJ alfanumérico tem letras nas 12
                primeiras posições, e `type="number"` as descartaria. */}
            <input
              id="customer-cnpj"
              type="text"
              autoCapitalize="characters"
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              onChange={(event) => setField("cnpj", maskCnpjInput(event.target.value))}
              {...fieldProps("cnpj")}
            />
            {fieldError("cnpj") ?? (
              <p className="field__hint">Aceita o formato numérico e o alfanumérico.</p>
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
              placeholder="contato@empresa.com.br"
              value={form.email}
              onChange={(event) => setField("email", event.target.value)}
              {...fieldProps("email")}
            />
            {fieldError("email")}
          </div>

          <div className="field">
            <label htmlFor="customer-phone">Telefone</label>
            <input
              id="customer-phone"
              type="text"
              inputMode="tel"
              placeholder="(11) 99999-8888"
              value={form.phone}
              onChange={(event) => setField("phone", maskPhoneInput(event.target.value))}
              {...fieldProps("phone")}
            />
            {fieldError("phone")}
          </div>
        </div>
      </FormSection>

      {/* Endereço estruturado — usado depois em OP, documentos GMP e
          expedição. O CEP preenche o que estiver vazio; o operador manda
          no que digitou. */}
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
              onChange={(event) => {
                const masked = maskZipCodeInput(event.target.value);
                setField("zipCode", masked);
                if (cepStatus !== "idle") setCepStatus("idle");
              }}
              onBlur={() => {
                handleBlur("zipCode");
                void handleZipLookup(form.zipCode);
              }}
              {...(errorFor("zipCode") ? { "aria-invalid": true as const } : {})}
              {...(errorFor("zipCode")
                ? { "aria-describedby": "customer-zipCode-error" }
                : {})}
            />
            {fieldError("zipCode")}
            {cepStatus !== "idle" && cepStatus !== "found" && (
              <p
                className={
                  cepStatus === "loading" ? "field__hint" : "field__hint field__hint--error"
                }
                role="status"
              >
                {CEP_MESSAGES[cepStatus]}
              </p>
            )}
          </div>

          <div className="field field--full">
            <label htmlFor="customer-street">Logradouro</label>
            <input
              id="customer-street"
              type="text"
              value={form.street}
              onChange={(event) => setField("street", event.target.value)}
            />
          </div>

          <div className="field field--narrow">
            <label htmlFor="customer-number">Número</label>
            <input
              id="customer-number"
              type="text"
              value={form.number}
              onChange={(event) => setField("number", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-complement">Complemento</label>
            <input
              id="customer-complement"
              type="text"
              value={form.complement}
              onChange={(event) => setField("complement", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-district">Bairro</label>
            <input
              id="customer-district"
              type="text"
              value={form.district}
              onChange={(event) => setField("district", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-city">Cidade</label>
            <input
              id="customer-city"
              type="text"
              value={form.city}
              onChange={(event) => setField("city", event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="customer-state">UF</label>
            <select
              id="customer-state"
              value={form.state}
              onChange={(event) => setField("state", event.target.value)}
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
            onChange={(event) => setField("notes", event.target.value)}
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

      {/* Só depois de existir registro: em "Novo cliente" não há o que
          mostrar, e um bloco de metadados vazio só ocupa a tela. */}
      {mode === "edit" && customer && (
        <FormSection
          title="Informações do cadastro"
          subtitle="Quem registrou e quando. Preenchido a partir do usuário autenticado."
        >
          <dl className="definition-list">
            <dt>Cadastrado em</dt>
            <dd>{formatDateTime(customer.createdAt)}</dd>
            <dt>Por</dt>
            <dd>{customer.createdByName ?? "Não disponível"}</dd>
            <dt>Última alteração</dt>
            <dd>{formatDateTime(customer.updatedAt)}</dd>
            <dt>Por</dt>
            <dd>{customer.updatedByName ?? "Não disponível"}</dd>
          </dl>
          {!customer.createdByName && (
            <p className="field__hint">
              Cliente cadastrado antes do registro de autoria, ou importado do sistema
              anterior. O autor não foi atribuído a ninguém.
            </p>
          )}
        </FormSection>
      )}
    </form>
  );
}
